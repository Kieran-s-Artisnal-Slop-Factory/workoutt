# Workoutt

A workout tracker and program planner that runs entirely in your browser —
no account, no company server, works offline, installable as an app.

**Try it now: [kieranwood.ca/workoutt](https://kieranwood.ca/workoutt)** —
it runs fully in your browser; nothing is uploaded anywhere.

## What it does

- **Track workouts** — log your sets, reps, weights, times, and distances
  as you train. Every exercise type is supported (weights, bodyweight,
  timed holds, cardio with distance and pace). Personal records are derived
  automatically from what you log — heaviest lift, most reps, best pace —
  with full progression history, plus optional body-weight tracking.
- **Plan programs** — build reusable workout templates, then schedule them
  as a multi-week program across your preferred training days. A guided
  walkthrough can generate a complete starter program matched to your
  experience level and equipment. Miss a day and the schedule bumps the
  workout forward automatically; a monthly calendar shows everything
  scheduled and completed, with drag-to-reschedule.

## How it's built

### Offline-first

Your data lives **on your device** (IndexedDB), and the app is a PWA — it
loads and works with no connection at all. There are no accounts and no
third-party services; the app is fully functional without ever touching a
network. Export/import gives you file-based backups from the Settings page.

### Optional sync

If you want your data on more than one device, you can self-host the small
Go sync server (a single binary, or `docker compose up`). Devices keep
working offline and reconcile in the background whenever they're online:
last write wins per record, deletions propagate, and the server holds a
full copy as an extra backup. Syncing is opt-in — offline-only is a fully
supported way to use the app forever.

### Other features

- **Achievements** — milestones that unlock automatically from your
  training history: account-wide (streaks, workout counts), per-exercise
  (cumulative volume, reps, time, distance), and per-program (finish every
  scheduled workout, run a program multiple times).
- **Pet game** — an optional collection game: training earns XP that grows
  pixel-art companions from babies into jacked beasts. Hatch eggs earned by
  working out, collect all 14 species, and pick who's gaining XP. Purely
  cosmetic, off by default, and it never touches your training data.
- **Records views** — all-time PRs or scoped to a single program run, with
  highlighted lifts pinned to the top.
- **Theming** — light/dark plus five color themes.

## Documentation

- **[docs/](docs/README.md)** — the documentation index:
  - **[docs/user/](docs/README.md#for-users)** — plain-language guides:
    building a program (fitness concepts included), records &
    achievements, and setting up sync.
  - **[docs/dev/](docs/README.md#for-developers)** — technical docs: the
    data model, the sync protocol, records/achievements internals,
    onboarding & default content, theming, and seeding.
- **[backend/README.md](backend/README.md)** — sync server endpoints,
  configuration, and design notes.
- **[pets.md](pets.md)** / **[acheivements.md](acheivements.md)** — design
  plans for the pet game and achievements systems.

## Running locally

```sh
# Frontend (Astro + Svelte) — http://localhost:4321
cd frontend && npm install && npm run dev

# Optional sync backend (Go) — http://localhost:8080
cd backend && go run .

# Or everything at once (built frontend served by the backend on :8080)
docker compose up
```
