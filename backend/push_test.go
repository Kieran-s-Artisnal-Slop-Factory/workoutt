package main

import (
	"path/filepath"
	"testing"
	"time"
)

// Exercises every scheduler SQL statement (loadPrefs / loadCandidateWorkouts /
// loadSent / loadSubscriptions + the sent-log insert) against the real schema.
func TestSchedulerQueries(t *testing.T) {
	db, err := openDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := ensurePush(db); err != nil {
		t.Fatal(err)
	}
	srv := &server{db: db}
	now := time.Now()

	mustExec := func(q string, args ...any) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	mustExec(`INSERT INTO user_profile (id, updated_at, notifications_enabled, notify_next_workout,
		notify_stale_workout, next_workout_reminder_time) VALUES ('p1', ?, 1, 1, 1, '08:00')`,
		now.UTC().Format(time.RFC3339))
	mustExec(`INSERT INTO workouts (id, name, state, started_at, updated_at)
		VALUES ('w1', 'Leg Day', 'in_progress', ?, ?)`,
		now.Add(-50*time.Minute).UTC().Format(time.RFC3339), now.UTC().Format(time.RFC3339))
	mustExec(`INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at)
		VALUES ('s1', 'https://push.example/x', 'k', 'a', ?)`, now.UTC().Format(time.RFC3339))

	prefs, ok, err := srv.loadPrefs()
	if err != nil || !ok || !prefs.Enabled || !prefs.StaleWorkout || prefs.ReminderTime != "08:00" {
		t.Fatalf("loadPrefs = %+v ok=%v err=%v", prefs, ok, err)
	}
	workouts, err := srv.loadCandidateWorkouts()
	if err != nil || len(workouts) != 1 || workouts[0].State != "in_progress" {
		t.Fatalf("loadCandidateWorkouts = %+v err=%v", workouts, err)
	}
	subs, err := srv.loadSubscriptions()
	if err != nil || len(subs) != 1 {
		t.Fatalf("loadSubscriptions = %+v err=%v", subs, err)
	}
	due := dueNotifications(now, workouts, map[string]bool{}, prefs)
	if len(due) != 1 || due[0].Kind != "stale_workout" {
		t.Fatalf("expected 1 stale due, got %+v", due)
	}
	// Record + read-back the sent-log (the dedupe mechanism).
	mustExec("INSERT OR IGNORE INTO sent_notifications (kind, workout_id, sent_at) VALUES (?, ?, ?)",
		due[0].Kind, due[0].WorkoutID, now.UTC().Format(time.RFC3339))
	sent, err := srv.loadSent()
	if err != nil || !sent["stale_workout|w1"] {
		t.Fatalf("loadSent = %+v err=%v", sent, err)
	}
	// With it recorded, it's no longer due.
	if again := dueNotifications(now, workouts, sent, prefs); len(again) != 0 {
		t.Fatalf("expected 0 after sent, got %+v", again)
	}
}

func TestDueNotifications(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 7, 17, 9, 0, 0, 0, loc) // 09:00 on a workout day
	today := "2026-07-17"
	prefs := notifPrefs{Enabled: true, NextWorkout: true, StaleWorkout: true, ReminderTime: "08:00"}

	scheduled := workoutRow{ID: "w1", Name: "Push Day", State: "scheduled", ScheduledOn: today}
	staleStart := now.Add(-50 * time.Minute).Format(time.RFC3339)
	inProgress := workoutRow{ID: "w2", Name: "Leg Day", State: "in_progress", StartedAt: staleStart}

	has := func(due []dueNotif, kind, id string) bool {
		for _, d := range due {
			if d.Kind == kind && d.WorkoutID == id {
				return true
			}
		}
		return false
	}

	t.Run("master switch off fires nothing", func(t *testing.T) {
		off := prefs
		off.Enabled = false
		if got := dueNotifications(now, []workoutRow{scheduled, inProgress}, nil, off); len(got) != 0 {
			t.Fatalf("expected 0, got %d", len(got))
		}
	})

	t.Run("scheduled after reminder time is due", func(t *testing.T) {
		got := dueNotifications(now, []workoutRow{scheduled}, nil, prefs)
		if !has(got, "next_workout", "w1") {
			t.Fatalf("expected next_workout for w1, got %+v", got)
		}
	})

	t.Run("already sent is skipped", func(t *testing.T) {
		sent := map[string]bool{"next_workout|w1": true}
		if got := dueNotifications(now, []workoutRow{scheduled}, sent, prefs); len(got) != 0 {
			t.Fatalf("expected 0 (sent), got %d", len(got))
		}
	})

	t.Run("before reminder time is not due", func(t *testing.T) {
		early := time.Date(2026, 7, 17, 7, 30, 0, 0, loc) // 07:30, before 08:00
		if got := dueNotifications(early, []workoutRow{scheduled}, nil, prefs); len(got) != 0 {
			t.Fatalf("expected 0 (too early), got %d", len(got))
		}
	})

	t.Run("long-past scheduled day is not due", func(t *testing.T) {
		old := workoutRow{ID: "w3", Name: "Old", State: "scheduled", ScheduledOn: "2026-07-10"}
		if got := dueNotifications(now, []workoutRow{old}, nil, prefs); len(got) != 0 {
			t.Fatalf("expected 0 (ancient), got %d", len(got))
		}
	})

	t.Run("stale open workout is due after 45m", func(t *testing.T) {
		got := dueNotifications(now, []workoutRow{inProgress}, nil, prefs)
		if !has(got, "stale_workout", "w2") {
			t.Fatalf("expected stale_workout for w2, got %+v", got)
		}
	})

	t.Run("recently started workout is not stale", func(t *testing.T) {
		fresh := workoutRow{ID: "w4", State: "in_progress", StartedAt: now.Add(-10 * time.Minute).Format(time.RFC3339)}
		if got := dueNotifications(now, []workoutRow{fresh}, nil, prefs); len(got) != 0 {
			t.Fatalf("expected 0 (fresh), got %d", len(got))
		}
	})

	t.Run("completed workout is never stale", func(t *testing.T) {
		done := inProgress
		done.CompletedAt = now.Format(time.RFC3339)
		if got := dueNotifications(now, []workoutRow{done}, nil, prefs); len(got) != 0 {
			t.Fatalf("expected 0 (completed), got %d", len(got))
		}
	})

	t.Run("per-kind toggles are respected", func(t *testing.T) {
		noStale := prefs
		noStale.StaleWorkout = false
		got := dueNotifications(now, []workoutRow{scheduled, inProgress}, nil, noStale)
		if has(got, "stale_workout", "w2") {
			t.Fatalf("stale disabled but fired: %+v", got)
		}
		if !has(got, "next_workout", "w1") {
			t.Fatalf("next_workout should still fire: %+v", got)
		}
	})
}

func TestReminderInstant(t *testing.T) {
	got, ok := reminderInstant("2026-07-17", "08:30", time.UTC)
	if !ok {
		t.Fatal("expected ok")
	}
	want := time.Date(2026, 7, 17, 8, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if _, ok := reminderInstant("bad-date", "08:30", time.UTC); ok {
		t.Fatal("expected failure on bad date")
	}
	if _, ok := reminderInstant("2026-07-17", "99:99", time.UTC); ok {
		t.Fatal("expected failure on bad time")
	}
}
