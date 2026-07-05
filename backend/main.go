// Workoutt sync backend.
//
// Phase 3 scope (see ../plan.md): sqlite mirror of the client schema managed
// with sqlc, POST /sync/push and GET /sync/pull?since=<server_seq> endpoints,
// a seeding system behind an env flag, and a backup endpoint that serves the
// sqlite file. Until then this is a stub that proves the toolchain works.
package main

import (
	"log/slog"
	"net/http"
	"os"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	slog.Info("workoutt backend listening", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
