# Workoutt

This project is a workout tracker and planner. The primary features are:

## Key decisions

- **Single-user, self-hosted.** No auth, no accounts. "Sign-up" is a one-time onboarding flow. Sync only needs to handle one user's devices.
- **Local-first architecture.** The client-side store (IndexedDB) is the source of truth from day one. The Go backend is a sync target added in Phase 3, not a dependency of Phases 1–2. This makes offline-first additive instead of a rewrite.
    - All entities use UUIDs (or ULIDs) as primary keys so offline clients can create records without a server round-trip. No autoincrement integer keys.
    - Conflict resolution: last-write-wins using a client-set `updated_at` timestamp on every entity (acceptable for single-user; worst case one edit is lost on clock skew). Deletes are soft (tombstone rows with `deleted_at`) so deletions sync too.
    - Sync cursor: do NOT use wall-clock time to decide "what changed since last sync" — clock skew and in-flight writes cause silently missed rows. Instead the server assigns a monotonically increasing integer `server_seq` (one global counter) to every row it accepts during a push; clients pull with "all rows where `server_seq` > my stored high-water mark" and advance the mark. `updated_at` is only for conflict resolution; `server_seq` is only for the cursor.
- **Units.** Store all values in canonical metric (kg, km, seconds). Display unit (kg/lbs, km/mi) is a user preference set during onboarding and applied at render time only.
- **PRs are derived, not stored.** Personal records are computed from logged workout data (and can be cached/materialized if slow). This avoids the "PR table disagrees with workout log" problem.
- **Storage durability.** Browsers treat IndexedDB as evictable cache — iOS Safari wipes it after ~7 days of site inactivity unless the PWA is installed to the home screen, and any browser can evict under storage pressure. Until sync exists (Phase 3), IndexedDB holds the ONLY copy of the data. Mitigations: call `navigator.storage.persist()` on first launch, ship the client-side JSON export in Phase 1 (it is the only backup until sync), and prefer building sync before PWA-installability polish if the app is in real daily use.
- **State does not survive navigation.** Astro is an MPA: every page navigation is a full reload and all in-memory Svelte state is lost. Rule: IndexedDB is the only state that survives navigation. Any user input that matters — especially set entries during an active workout — must be written to IndexedDB immediately when entered, never held only in component state.
- **Dates vs timestamps.** Scheduled workout dates are local calendar dates stored as `YYYY-MM-DD` strings ("Tuesday's workout" is a calendar concept; UTC timestamps cause off-by-one-day bugs around midnight and timezone changes). UTC ISO 8601 timestamps are used only for record-keeping fields like `updated_at`, `completed_at`, `deleted_at`.

## Features
- user metrics tracking
    - Personal Records (PR's), derived from logged sets
        - Weight/rep based
            - Max weight lifted per rep-count (e.g. best 1RM, best 5RM, best 10RM)
            - Max volume in a single set (weight × reps)
        - Rep based (bodyweight exercises)
            - Max reps in a single set
        - Time based
            - Longest time (e.g. plank)
            - Shortest time (e.g. timed run — paired with distance where applicable)
        - Distance based
            - Longest distance
            - Best pace (distance+time exercises)
    - Optional weight loss/gain tracking
        - Initial weight entry during onboarding
        - current weight can be entered at any time
- Ability to specify exercises
    - Give exercises a name, and one or more body parts they target (e.g. pull-ups target lats, biceps, and traps)
    - Have a description
    - Have an optional link to a video showing off how to do the exercise
    - Have an optional set of images to show off examples of the exercise
    - Specify measurement type: rep, weight+rep, distance, time, distance+time (e.g. 5km run in 28min), or weight+time (e.g. weighted plank)
    - Have a page to search existing exercises and learn more about them
- Ability to specify workout templates
    - Templates that specify the sets and exercises that make up the workout
    - Pull in a list of exercises, and set number of sets and optionally supersets
- Performing workouts (the core loop)
    - Start today's scheduled workout (or an ad-hoc one from any template) from the homepage
    - Active workout screen: work through the template exercise by exercise, entering actual weight/reps/time/distance per set and checking sets off as completed
    - Sets/reps actually performed can differ from what the template prescribed (add/remove sets, swap weight)
    - Finish or abandon a workout; finished workouts are saved as workout instances in history
- programming system
    - Ability to specify program templates
        - Program templates will have a number of workout templates, and you will set which ones and how many a week you want to do
            - For example
                - choose a chest day workout template, and a leg day template
                - choose a frequency of 4 workouts a week
                - Program length of 3 months
                - a preference for sunday, tuesday, thursday, friday
        - Preferred days are a pool the scheduler picks from; frequency is the source of truth (e.g. frequency 3 with 4 preferred days means 3 of those 4 days get used each week)
    - Scheduling and "bumping"
        - If a scheduled workout is missed, it is bumped to the next available preferred day, and the rest of the week shifts as needed
        - A workout can also be explicitly skipped (it does not reschedule, and is recorded as skipped)
        - Bumping does not extend the program end date; the program simply completes with fewer sessions if too many are skipped
        - A workout instance has a state: scheduled, in progress, completed, skipped, or bumped
    - Assign yourself a current program from a template, and keep track of past programs
        - For past programs you should keep track of any personal records achieved during them, and any weight loss/gain during that time (if applicable)



## Phase 1

- [x] Design the data schema that addresses all the features laid out in the features section, confirming before committing to it
    - [x] One logical schema, designed for both targets up front: define the IndexedDB object stores (source of truth) and the mirroring sqlite schema (sync target) together, so field names, types, and keys line up 1:1 before any code is written
        - [x] Write the sqlite DDL now (it doubles as the schema's documentation and is ready for sqlc in Phase 3), even though the server itself isn't built until Phase 3
    - [x] UUID primary keys, `updated_at` on every entity, soft deletes via `deleted_at`, and a nullable integer `server_seq` column on every synced table (null until the server first accepts the row — see the sync cursor decision above)
    - [x] Templates should be stored separately from instances of the events when they occur
        - [x] For example a workout template should guide what the workout should look like, but the actual workout may end up with different number of reps/sets based on what the user actually did
- [x] Scaffold out the project frontend and backend in separate folders
- [x] Frontend
    - [x] Data layer: IndexedDB (via the `idb` npm package — accepted dependency exception, ~1KB promise wrapper over the raw event-based API) + Svelte 5 rune-based stores that all pages read/write (no mock data needed — this is the real store from day one)
        - [x] Version the IndexedDB schema from day one: maintain an ordered list of upgrade functions run from `onupgradeneeded`, one per schema version, same discipline as server migrations. Once sync exists (Phase 3), client migrations and the sqlite schema must change in lockstep.
        - [x] Request persistent storage on first launch via `navigator.storage.persist()`; if denied, show a warning that data is evictable until the PWA is installed
    - [x] Data export (backup): a settings/menu action that serializes the entire IndexedDB contents to one downloadable JSON file with a versioned envelope (`{schemaVersion, exportedAt, data: {<storeName>: rows[]}}`), plus a matching import that restores from that file. This is the only backup until sync ships in Phase 3, which is why it lands in Phase 1.
    - [x] Seed script that populates IndexedDB with sample exercises/templates/history for development
    - [x] Minimal onboarding flow (first launch): display units (kg/lbs, km/mi), initial weight, age, height, experience level by years of workout experience (beginner <1 year, intermediate <5, advanced 5+)
    - [x] Define the initial styles
        - [x] Define plain CSS theme with configurable variables for color, font-size, padding, etc.
        - [x] Re-usable "base" Components
            - [x] Card
            - [x] Floating Action Button Nav
            - [x] Navbar w/hamburger menu on mobile
            - [x] Charts (using Observable Plot — conscious exception to the few-dependencies rule)
                - [x] Bar chart (use this component https://kieranwood.ca/components/stacks/astro-svelte/observable-plot/barchart/ )
                - [x] Line chart (use this component https://kieranwood.ca/components/stacks/astro-svelte/observable-plot/linechart/ )
            - [x] Accordion
    - [x] Build out initial Pages
        - [x] Homepage
            - [x] Shows details about your next workout
                - [x] When next workout is
                - [x] Which workout it is this week
                - [x] If it was already "bumped"
                - [x] Button to start it (goes to the Active workout page)
            - [x] Shows details about your program
                - [x] How many workouts out of the total you're through
                - [x] When it ends
        - [x] Active workout page (core loop)
            - [x] Step through the workout's exercises and sets, entering actual values per set and checking them off
            - [x] Persist every set entry/edit to IndexedDB the moment it happens (the workout instance sits in "in progress" state) — navigating away or closing the tab mid-workout must lose nothing, and returning to the page resumes where the user left off
            - [x] Add/remove sets and adjust values vs. what the template prescribed
            - [x] Finish or abandon the workout; finishing saves it to history
        - [x] Exercise overview page
            - [x] Be able to look at and manage exercises that can be used in workouts
        - [x] Workout Overview page
            - [x] Be able to look at and manage workout templates
            - [x] Be able to view past workouts
        - [x] Program overview page
            - [x] Be able to look at and manage Program templates
        - [x] Records page
            - [x] Show information about current and previous PR's, when they were achieved, and what the values were


## Phase 2

- [ ] Frontend
    - [x] Program scheduling logic: generate the schedule from frequency + preferred days, implement bump/skip handling and workout instance states
    - [x] Weight tracking entry + history chart
    - [ ] Polish onboarding (validation, editing preferences later from a settings page)

## Phase 3

- [ ] Frontend
    - [x] Make app an installable PWA (service worker, manifest, asset caching)
        - [x] App already works fully offline (IndexedDB is the source of truth); the PWA work is installability + caching + a "not currently syncing" indicator
    - [x] Add syncing system
        - [x] Push: send all locally created/modified rows since the last successful push; the server resolves conflicts by `updated_at` last-write-wins, stamps each accepted row with the next `server_seq`, and returns the assigned sequence numbers for the client to store
        - [x] Pull: request all rows with `server_seq` greater than the client's stored high-water mark; apply them locally (tombstone rows delete their local counterparts) and advance the mark
        - [x] Sync status indicator: show "not currently syncing" when offline or the server is unreachable (offline badge in navbar + sync status card in Settings)
- [x] Backend
    - [x] Go server with sqlite mirror of the client schema (NOTE: the sync engine uses plain database/sql with table metadata instead of sqlc — sync rows are schemaless JSON with booleans/arrays that don't map onto sqlc's sql.Null* types without per-table marshal glue; adopt sqlc if/when typed app queries appear server-side)
    - [x] Sync endpoints: `POST /sync/push` (accept client rows, resolve conflicts by `updated_at` last-write-wins, stamp each accepted row with the next value from a single global `server_seq` counter, return the assigned values) and `GET /sync/pull?since=<server_seq>` (return all rows — including tombstones — with `server_seq` greater than `since`)
    - [x] Seeding system behind an environment variable flag for testing (SEED=true)
    - [x] Server-side backup endpoint (download the sqlite DB file directly; complements the Phase 1 client-side JSON export)


## Technical requirements

* Frontend
    * fully static Astro frontend (will be compiled to static files using the static adapter, so no backend processing can be done on it)
        * Astro is MPA by default; keep the app shell inside a single Svelte island per page and rely on the service worker + view transitions so navigation still feels app-like
        * Because every navigation is a full page reload, no in-memory state survives it — see "State does not survive navigation" in Key decisions
    * Svelte 5 with runes for reactivity
    * Plain CSS (No tailwind, no component library)
        * custom theme variables defined under `:root`
            * For example `--bg-color`, `--text-color`
            * Make use of modern CSS features like `light-dark()` for light/dark theming
            * Go with a bright orange color as the primary brand color
    * PWA with full offline support that can sync to the server
        * IndexedDB is the client store and the source of truth (see Key decisions)
        * Offline should have full feature parity, but inform user they're not currently syncing
    * Use as few dependencies as possible (accepted exceptions: Observable Plot for charts, `idb` for promise-based IndexedDB access)
* Backend (Phase 3)
    * Go
    * Plain http library for routing, no framework
    * slog for logging
    * sqlite DB to store data in (modernc.org/sqlite — pure Go, no cgo, so cross-compiles and runs on Alpine)
    * sqlc for DB management (deviation: the generic sync engine uses database/sql + table metadata — see the Phase 3 backend note; revisit sqlc when the server grows typed queries)
    * No auth (single-user, self-hosted); if it's ever exposed publicly, put it behind a reverse proxy with basic auth
    * A seeding system and environment variable flag for testing that can be used to activate the seeding
* Dockerize the setup so a single `docker compose up` command can be used to bring everything up
    * The sqlite DB file must live on a named Docker volume — without one, recreating the container destroys all synced data
