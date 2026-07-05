package main

import (
	"database/sql"
	"log/slog"
	"time"
)

// Seeding system for testing, activated with SEED=true (see plan.md). Only
// runs against an empty database; inserts a couple of exercises so a fresh
// client pulling from this server has something to show.
func seed(db *sql.DB) error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM exercises").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		slog.Info("seed skipped: database not empty")
		return nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	rows := []struct {
		id, name, parts, desc, mt string
	}{
		{"00000000-0000-4000-8000-000000000001", "Bench Press", `["chest","triceps","shoulders"]`, "Barbell bench press on a flat bench.", "weight_reps"},
		{"00000000-0000-4000-8000-000000000002", "Pull-up", `["lats","biceps","traps"]`, "Bodyweight pull-up, palms away.", "reps"},
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lastSeq int64
	if err := tx.QueryRow("SELECT last_seq FROM sync_state WHERE id = 1").Scan(&lastSeq); err != nil {
		return err
	}
	for _, r := range rows {
		lastSeq++
		_, err := tx.Exec(`INSERT INTO exercises
			(id, name, body_parts, description, video_url, image_urls, measurement_type, updated_at, deleted_at, server_seq)
			VALUES (?, ?, ?, ?, NULL, '[]', ?, ?, NULL, ?)`,
			r.id, r.name, r.parts, r.desc, r.mt, now, lastSeq)
		if err != nil {
			return err
		}
	}
	if _, err := tx.Exec("UPDATE sync_state SET last_seq = ? WHERE id = 1", lastSeq); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	slog.Info("seeded sample exercises", "count", len(rows))
	return nil
}
