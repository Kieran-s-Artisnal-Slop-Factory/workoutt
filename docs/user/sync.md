# Syncing your data (and how Workoutt stores it)

Workoutt works completely offline — but if you want your data shared
between devices (say, your phone at the gym and your laptop at home), you
can run a small sync server. This guide explains how the storage works and
how to set syncing up.

## How Workoutt stores your data ("offline-first")

Workoutt has no accounts and no company server. Everything you enter is
stored **in your browser, on your device** — which is why the app works
with no internet at all, even installed on your phone in airplane mode.

Syncing, when you turn it on, adds a server *you* control as a meeting
point:

```
  your phone  ←→  your sync server  ←→  your laptop
```

- Every device keeps its own full copy and works offline.
- Whenever a device is online, it quietly sends its recent changes to the
  server and fetches what other devices sent (automatically about every 15
  minutes, on app open, or when you press *Sync now* in Settings).
- If the same thing was edited on two devices, the **most recent edit
  wins**. Nothing is ever half-merged.
- Deleting something on one device deletes it everywhere once they've
  synced.

**One caution about offline-only mode:** browsers can clear site data
under storage pressure or if you clear browsing data. If you stay
offline-only, use Settings → Export regularly to keep a backup file.
Syncing largely removes this worry, since the server holds a full copy.

## Setting up a sync server

You need a computer that's usually on and reachable from your devices — a
home server, a Raspberry Pi, a NAS, or a small cloud machine all work.

### The easy way: Docker

1. Install [Docker](https://docs.docker.com/get-docker/) on the server
   machine.
2. Get the Workoutt code onto it (download or `git clone`).
3. From the project folder, run:

   ```sh
   docker compose up -d
   ```

That's it. The server listens on port **8080** and stores its database on
a named Docker volume — so your data survives updates and container
rebuilds. It also serves the app itself, so you can simply browse to
`http://<server-address>:8080` and use Workoutt from there.

### Without Docker

If you have Go installed you can run the backend directly:

```sh
cd backend
go run .
```

Useful settings (environment variables):

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | which port to listen on |
| `DB_PATH` | `workoutt.db` | where the database file lives — keep this somewhere backed up |
| `STATIC_DIR` | *(off)* | folder with the built app, to serve it from the same address |

### A note on security

The server has **no login** — it's designed for a private home network,
for one person. Don't expose it directly to the internet. If you need
access from outside your home, put it behind a VPN (e.g. Tailscale or
WireGuard) or a reverse proxy that adds a password.

## Connecting the app to your server

You can connect during first-time setup, or any time later:

1. Open **Settings** (or, on a fresh install, the setup screen).
2. Under data storage, choose **Sync mode**.
3. Enter the server address, e.g. `http://192.168.1.10:8080` — use your
   server's actual address. (If you're using the app *served by* the
   server — you browsed to the server's address — you can leave the URL
   empty; it syncs with itself.)
4. Press **Test connection**. You should see "Connected to sync server
   successfully." If not, the message will tell you what's likely wrong
   (wrong address, server not running, etc.).
5. Save. The app syncs immediately, then keeps itself in sync in the
   background.

Settings also shows the time of the last successful sync and any error
from the last attempt, plus a **Sync now** button.

### Adding a second device

Just install/open Workoutt on the new device, go through setup, choose
Sync mode, and enter the same server address. On its first sync it
downloads everything — your exercises, programs, history, records, and
achievements all appear.

## Backups

Even with sync, backups are cheap insurance:

- **From any device:** Settings → Export gives you a JSON file of your
  data (choose "Templates and user information" for everything). The same
  place lets you import it back later.
- **From the server:** browsing to `http://<server-address>:8080/backup`
  downloads the server's complete database file.

Keep a copy somewhere safe (cloud drive, second disk) every now and then.
