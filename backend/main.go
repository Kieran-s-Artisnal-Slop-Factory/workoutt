// Workoutt sync backend (Phase 3, see ../plan.md).
//
// Single-user, self-hosted, no auth. The client (frontend/) is local-first;
// this server is a sync target: POST /sync/push (LWW on updated_at, stamps
// server_seq from one global counter), GET /sync/pull?since=<server_seq>,
// GET /backup (sqlite file), plus optional static serving of the built
// frontend so everything runs on one origin.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Permissive CORS so a separately-hosted frontend (or dev server) can sync.
// Fine for a single-user LAN app; tighten if ever exposed publicly.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	dbPath := envOr("DB_PATH", "workoutt.db")
	db, err := openDB(dbPath)
	if err != nil {
		slog.Error("open database", "path", dbPath, "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if os.Getenv("SEED") == "true" {
		if err := seed(db); err != nil {
			slog.Error("seed", "error", err)
			os.Exit(1)
		}
	}

	srv := &server{db: db, dbPath: dbPath}

	// Web Push notifications (see notifications.md). Resolve VAPID keys and
	// start the reminder scheduler.
	vapid, err := ensurePush(db)
	if err != nil {
		slog.Error("init push", "error", err)
		os.Exit(1)
	}
	srv.vapid = vapid
	interval := 60 * time.Second
	if v := os.Getenv("NOTIFY_INTERVAL_SECONDS"); v != "" {
		if secs, perr := strconv.Atoi(v); perr == nil && secs > 0 {
			interval = time.Duration(secs) * time.Second
		}
	}
	srv.startScheduler(context.Background(), interval)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /sync/push", srv.handlePush)
	mux.HandleFunc("GET /sync/pull", srv.handlePull)
	mux.HandleFunc("GET /backup", srv.handleBackup)
	mux.HandleFunc("GET /push/vapid-public-key", srv.handleVAPIDPublicKey)
	mux.HandleFunc("POST /push/subscribe", srv.handleSubscribe)
	mux.HandleFunc("POST /push/unsubscribe", srv.handleUnsubscribe)

	if staticDir := envOr("STATIC_DIR", ""); staticDir != "" {
		if _, err := os.Stat(staticDir); err == nil {
			mux.Handle("/", http.FileServer(http.Dir(staticDir)))
			slog.Info("serving static frontend", "dir", staticDir)
		} else {
			slog.Warn("STATIC_DIR not found, skipping static serving", "dir", staticDir)
		}
	}

	addr := ":" + envOr("PORT", "8080")
	slog.Info("workoutt backend listening", "addr", addr, "db", dbPath)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
