// Web Push notifications (see ../notifications.md, "Server-assisted").
//
// The server already receives workout data via sync, so it can decide when to
// remind entirely from its own tables. A ticker scans for due reminders and
// pushes them to every registered browser subscription, waking the closed PWA
// through the vendor push service. "Due" is derived from workout rows plus a
// persistent sent-log, so the scheduler is idempotent and crash-safe.
//
// All push state is server-only (never synced): VAPID keys, the per-device
// subscriptions (which hold secrets), and the sent-log.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
)

func newUUID() string { return uuid.NewString() }

// Server-only tables; created idempotently on every boot (the server applies
// schema.sql only to a fresh DB, so IF NOT EXISTS covers existing ones too).
const pushDDL = `
CREATE TABLE IF NOT EXISTS push_config (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    vapid_public  TEXT NOT NULL,
    vapid_private TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           TEXT PRIMARY KEY,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    device_label TEXT,
    created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_notifications (
    kind       TEXT NOT NULL,
    workout_id TEXT NOT NULL,
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (kind, workout_id)
);
`

type vapidKeys struct{ public, private string }

// ensurePush creates the push tables and resolves the VAPID keypair. Env
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) wins if set — for stable keys across
// DB resets — otherwise a pair is generated once and persisted in SQLite so
// existing subscriptions keep working across restarts.
func ensurePush(db *sql.DB) (vapidKeys, error) {
	if _, err := db.Exec(pushDDL); err != nil {
		return vapidKeys{}, fmt.Errorf("push ddl: %w", err)
	}
	if pub, priv := envOr("VAPID_PUBLIC_KEY", ""), envOr("VAPID_PRIVATE_KEY", ""); pub != "" && priv != "" {
		return vapidKeys{public: pub, private: priv}, nil
	}
	var k vapidKeys
	err := db.QueryRow("SELECT vapid_public, vapid_private FROM push_config WHERE id = 1").
		Scan(&k.public, &k.private)
	if err == sql.ErrNoRows {
		priv, pub, gerr := webpush.GenerateVAPIDKeys()
		if gerr != nil {
			return vapidKeys{}, gerr
		}
		if _, err := db.Exec("INSERT INTO push_config (id, vapid_public, vapid_private) VALUES (1, ?, ?)", pub, priv); err != nil {
			return vapidKeys{}, err
		}
		slog.Info("generated and stored a VAPID keypair")
		return vapidKeys{public: pub, private: priv}, nil
	}
	if err != nil {
		return vapidKeys{}, err
	}
	return k, nil
}

// GET /push/vapid-public-key — the client needs the public key to subscribe.
func (s *server) handleVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"key": s.vapid.public})
}

type subscribeRequest struct {
	Endpoint    string            `json:"endpoint"`
	Keys        map[string]string `json:"keys"`
	DeviceLabel string            `json:"device_label"`
}

// POST /push/subscribe — upsert one browser's push subscription by endpoint.
func (s *server) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	var req subscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Endpoint == "" || req.Keys["p256dh"] == "" || req.Keys["auth"] == "" {
		http.Error(w, "missing endpoint or keys", http.StatusBadRequest)
		return
	}
	// Upsert on the unique endpoint so re-subscribing refreshes the keys.
	_, err := s.db.Exec(`
		INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, device_label, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
			device_label = excluded.device_label`,
		newUUID(), req.Endpoint, req.Keys["p256dh"], req.Keys["auth"], req.DeviceLabel,
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// POST /push/unsubscribe — drop a subscription by endpoint.
func (s *server) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if _, err := s.db.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", req.Endpoint); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ── Scheduler ────────────────────────────────────────────────────────────

type workoutRow struct {
	ID, Name, State, ScheduledOn, StartedAt, CompletedAt string
}

type notifPrefs struct {
	Enabled      bool
	NextWorkout  bool
	StaleWorkout bool
	ReminderTime string // local HH:MM
}

type dueNotif struct {
	Kind, WorkoutID, Title, Body, URL string
}

// How long after a workout starts we nudge about it still being open.
const staleAfter = 45 * time.Minute

// dueNotifications is the pure heart of the scheduler: given the current time,
// candidate workouts, the already-sent set (keyed "kind|workout_id"), and the
// user's prefs, return the reminders to fire now. Kept side-effect-free so it
// is unit-testable (push_test.go).
func dueNotifications(now time.Time, workouts []workoutRow, sent map[string]bool, prefs notifPrefs) []dueNotif {
	if !prefs.Enabled {
		return nil
	}
	var out []dueNotif
	for _, wk := range workouts {
		switch wk.State {
		case "scheduled":
			if !prefs.NextWorkout || wk.ScheduledOn == "" || sent["next_workout|"+wk.ID] {
				continue
			}
			due, ok := reminderInstant(wk.ScheduledOn, prefs.ReminderTime, now.Location())
			// Fire once the target time passes, but only on the day itself — a
			// long-missed workout shouldn't trigger an ancient reminder.
			if ok && !now.Before(due) && now.Sub(due) < 24*time.Hour {
				out = append(out, dueNotif{
					Kind: "next_workout", WorkoutID: wk.ID,
					Title: "Workout day 💪",
					Body:  workoutName(wk.Name) + " is on your plan today.",
					URL:   "/workout/",
				})
			}
		case "in_progress":
			if !prefs.StaleWorkout || wk.StartedAt == "" || wk.CompletedAt != "" || sent["stale_workout|"+wk.ID] {
				continue
			}
			if started, err := time.Parse(time.RFC3339, wk.StartedAt); err == nil && now.Sub(started) >= staleAfter {
				out = append(out, dueNotif{
					Kind: "stale_workout", WorkoutID: wk.ID,
					Title: "Still training? ⏱️",
					Body:  "You started " + workoutName(wk.Name) + " a while ago — finish it to save your sets.",
					URL:   "/workout/",
				})
			}
		}
	}
	return out
}

func workoutName(n string) string {
	if n == "" {
		return "Your workout"
	}
	return n
}

// reminderInstant combines a local date (YYYY-MM-DD) and a HH:MM in the given
// location into an instant. The server assumes its local timezone matches the
// user's — true for a self-hosted single-user box (documented shortcoming).
func reminderInstant(dateStr, hhmm string, loc *time.Location) (time.Time, bool) {
	d, err := time.ParseInLocation("2006-01-02", dateStr, loc)
	if err != nil {
		return time.Time{}, false
	}
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return time.Time{}, false
	}
	return time.Date(d.Year(), d.Month(), d.Day(), h, m, 0, 0, loc), true
}

// startScheduler runs the tick loop until ctx is cancelled.
func (s *server) startScheduler(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := s.runScheduleTick(time.Now()); err != nil {
					slog.Error("notification tick", "error", err)
				}
			}
		}
	}()
}

// runScheduleTick loads state, computes due reminders, sends them, and records
// the sends. Best-effort: a reminder is marked sent once attempted so a flaky
// push service never causes a spam loop.
func (s *server) runScheduleTick(now time.Time) error {
	prefs, ok, err := s.loadPrefs()
	if err != nil || !ok || !prefs.Enabled {
		return err
	}
	workouts, err := s.loadCandidateWorkouts()
	if err != nil {
		return err
	}
	sent, err := s.loadSent()
	if err != nil {
		return err
	}
	due := dueNotifications(now, workouts, sent, prefs)
	if len(due) == 0 {
		return nil
	}
	subs, err := s.loadSubscriptions()
	if err != nil || len(subs) == 0 {
		return err
	}
	for _, d := range due {
		s.sendToAll(d, subs)
		if _, err := s.db.Exec(
			"INSERT OR IGNORE INTO sent_notifications (kind, workout_id, sent_at) VALUES (?, ?, ?)",
			d.Kind, d.WorkoutID, now.UTC().Format(time.RFC3339)); err != nil {
			slog.Error("record sent notification", "error", err)
		}
	}
	return nil
}

func (s *server) loadPrefs() (notifPrefs, bool, error) {
	var p notifPrefs
	var enabled, next, stale int
	err := s.db.QueryRow(`SELECT notifications_enabled, notify_next_workout, notify_stale_workout,
		next_workout_reminder_time FROM user_profile WHERE deleted_at IS NULL LIMIT 1`).
		Scan(&enabled, &next, &stale, &p.ReminderTime)
	if err == sql.ErrNoRows {
		return p, false, nil
	}
	if err != nil {
		return p, false, err
	}
	p.Enabled, p.NextWorkout, p.StaleWorkout = enabled == 1, next == 1, stale == 1
	return p, true, nil
}

func (s *server) loadCandidateWorkouts() ([]workoutRow, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(name,''), state, COALESCE(scheduled_on,''),
		COALESCE(started_at,''), COALESCE(completed_at,'')
		FROM workouts
		WHERE deleted_at IS NULL AND state IN ('scheduled','in_progress')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []workoutRow
	for rows.Next() {
		var w workoutRow
		if err := rows.Scan(&w.ID, &w.Name, &w.State, &w.ScheduledOn, &w.StartedAt, &w.CompletedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *server) loadSent() (map[string]bool, error) {
	rows, err := s.db.Query("SELECT kind, workout_id FROM sent_notifications")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sent := map[string]bool{}
	for rows.Next() {
		var kind, id string
		if err := rows.Scan(&kind, &id); err != nil {
			return nil, err
		}
		sent[kind+"|"+id] = true
	}
	return sent, rows.Err()
}

type storedSub struct {
	id, endpoint, p256dh, auth string
}

func (s *server) loadSubscriptions() ([]storedSub, error) {
	rows, err := s.db.Query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []storedSub
	for rows.Next() {
		var sub storedSub
		if err := rows.Scan(&sub.id, &sub.endpoint, &sub.p256dh, &sub.auth); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// sendToAll pushes one reminder to every subscription, pruning any the push
// service reports as gone (404/410).
func (s *server) sendToAll(d dueNotif, subs []storedSub) {
	payload, _ := json.Marshal(map[string]string{
		"title": d.Title, "body": d.Body, "url": d.URL, "tag": d.Kind + ":" + d.WorkoutID,
	})
	for _, sub := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{
			Endpoint: sub.endpoint,
			Keys:     webpush.Keys{P256dh: sub.p256dh, Auth: sub.auth},
		}, &webpush.Options{
			Subscriber:      envOr("VAPID_SUBJECT", "mailto:admin@workoutt.local"),
			VAPIDPublicKey:  s.vapid.public,
			VAPIDPrivateKey: s.vapid.private,
			TTL:             int(staleAfter.Seconds()),
		})
		if err != nil {
			slog.Warn("push send failed", "endpoint", sub.endpoint, "error", err)
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
			if _, derr := s.db.Exec("DELETE FROM push_subscriptions WHERE id = ?", sub.id); derr == nil {
				slog.Info("pruned dead push subscription", "endpoint", sub.endpoint)
			}
		}
	}
}
