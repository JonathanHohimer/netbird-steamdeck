# NetBird for Steam Deck (Decky Plugin)

Decky Loader plugin that installs and controls [NetBird](https://netbird.io/) from Steam Deck **Gaming Mode**.

SteamOS is immutable, so the usual NetBird Linux installer often fails or does not persist across updates. This plugin uses the Deck-friendly layout discussed in [NetBird #4584](https://github.com/netbirdio/netbird/issues/4584): binary under `/opt/netbird`, systemd service registration, and `/etc` keep-files so PATH helpers survive SteamOS updates.

For a file-by-file map of the repo, see [STRUCTURE.md](STRUCTURE.md).

## Features

- **Install / update / uninstall** NetBird under `/opt/netbird`
- Start / stop the NetBird systemd service
- Connect / disconnect (`netbird up` / `netbird down`)
- Setup-key login and SSO login (SSO uses `--no-browser` and shows a copyable URL)
- Custom management URL for self-hosted NetBird
- Network select / deselect / select-all
- Detailed status from `netbird status --json` (peers, management, signal, relays)
- Advanced panel to run remaining `netbird …` CLI commands

## Prerequisites

1. Steam Deck with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed
2. This plugin installed (ships with the `root` flag so it can write `/opt` and manage the service)

You do **not** need a separate NetBird install first.

## Install the plugin

### From a release zip

1. Open [Releases](https://github.com/JonathanHohimer/netbird-steamdeck/releases) and download **NetBird.zip**
2. In Gaming Mode: Decky → store gear → **Developer** → **Install plugin from ZIP**
3. Or unzip (you should see a single `NetBird/` folder) and copy it to `~/homebrew/plugins/NetBird`

CI builds `NetBird.zip` with this layout (not a zip nested inside another zip):

```text
NetBird.zip
└── NetBird/
    ├── dist/index.js
    ├── main.py
    ├── plugin.json
    ├── package.json
    ├── README.md
    └── LICENSE
```

Each push to `main` publishes/updates a GitHub Release tagged from `package.json` (e.g. `v1.1.4`) with that zip attached.

### Build from source

```bash
pnpm i
pnpm run build
```

Create a sideload zip:

```bash
mkdir -p NetBird/dist
cp dist/index.js NetBird/dist/
cp main.py plugin.json package.json README.md LICENSE NetBird/
zip -r NetBird.zip NetBird
```

Required package contents:

```text
NetBird/
  dist/index.js      # built frontend
  main.py            # Python backend
  plugin.json
  package.json
  README.md
  LICENSE
```

CI builds this zip on push/tags via [`.github/workflows/build.yml`](.github/workflows/build.yml).

## First-time NetBird setup on Deck

1. Open Decky → **NetBird**
2. **Install (Steam Deck)** → **Install NetBird**  
   Downloads the latest GitHub `linux_amd64` release into `/opt/netbird`, installs the service, and enables it on boot
3. Authenticate:
   - **Setup key:** paste key → **Connect with setup key**, or
   - **SSO login:** tap SSO → copy the URL → open it in a browser (phone or Desktop Mode) → finish auth
4. Optionally set a self-hosted **Management URL** and save it
5. Toggle **Connected** to bring the mesh up or down

## UI map

| Section | Purpose |
|---|---|
| NetBird / CLI | Shows resolved binary path and version |
| Install (Steam Deck) | Install, update, uninstall, start/stop service |
| Connection | Up/down toggle, IP, FQDN, peer counts |
| Authentication | Management URL, setup key, SSO URL, logout |
| Networks | List and toggle selected networks |
| Status detail | Structured status + raw detail text |
| Advanced / CLI | Run arbitrary `netbird` args (no shell) |

## What the managed install writes

| Path | Role |
|---|---|
| `/opt/netbird/bin/netbird` | Client binary (persists with `/home`) |
| `/etc/profile.d/netbird.sh` | Adds `/opt/netbird/bin` to PATH |
| `/etc/atomic-update.conf.d/netbird.conf` | Keeps the profile snippet across SteamOS updates |
| `/etc/systemd/system/netbird.service` | Daemon unit from `netbird service install` |
| `/var/lib/netbird` | NetBird runtime state (keys, config) |

**Uninstall managed NetBird** removes the `/opt/netbird` tree, profile/atomic keep files, and the systemd unit. External installs (Homebrew, Distrobox, etc.) are left alone unless they live under `/opt/netbird`.

Setup keys are **not** persisted. The management URL is stored in Decky’s plugin settings directory.

## Architecture (short)

```text
┌─────────────────────┐     callable()      ┌──────────────────┐
│ React UI (@decky/ui)│ ─────────────────► │ main.py (root)   │
│ src/index.tsx       │                     │ subprocess / HTTP│
└─────────────────────┘                     └────────┬─────────┘
                                                     │
                                      ┌──────────────┼──────────────┐
                                      ▼              ▼              ▼
                               /opt/netbird     GitHub releases   systemctl
                               netbird CLI
```

Frontend talks to the backend with `@decky/api` `callable()`. The backend resolves `/opt/netbird/bin/netbird` first, then falls back to PATH / other known locations.

## Development

```bash
pnpm i
pnpm run build   # → dist/index.js
pnpm run watch   # rebuild on change
```

- Frontend: TypeScript/React in [`src/`](src/)
- Backend: Python in [`main.py`](main.py)
- Types for Decky Python APIs: [`decky.pyi`](decky.pyi)

Reload the plugin in Decky after copying an updated build (or reinstall the zip).

## Troubleshooting

| Symptom | What to try |
|---|---|
| CLI “Not found” | Use **Install NetBird**; confirm the plugin has root (`plugin.json` flags) |
| Latest release shows SSL / CERTIFICATE_VERIFY_FAILED | Reinstall plugin ≥1.1.1 — HTTPS uses Decky’s `certifi` CA bundle |
| Permission denied `/opt/netbird` | `plugin.json` must use `"flags": ["root"]` (not `_root`). Reinstall the zip and restart Decky |
| Plugin privileges shows NOT root | Same as above — Decky only elevates for the exact flag `root` |
| `libcrypto.so.3` / OPENSSL errors during service install | Fixed in ≥1.1.3 by clearing Decky’s `LD_LIBRARY_PATH` for child processes — reinstall the plugin zip |
| Unit present but disabled / service not detected | Use **Enable & start service**; ≥1.1.4 also treats a reachable daemon socket as active |
| SSO does nothing in Game Mode | ≥1.1.4 streams the login URL; enable **Show QR for SSO** (uses `netbird --qr`) to scan from a phone, or **Copy SSO URL** |
| Install fails downloading | Deck needs network; check the **Install log** section (and Copy install log) |
| Service inactive after reboot | **Start service**, or reinstall so `systemctl enable` runs again |
| SSO does nothing in Game Mode | Copy the shown URL and open it on another device |
| Status empty | Service must be running; use **Start service** then refresh |

## Security notes

- The backend runs as root so it can manage `/opt` and systemd
- Setup keys are passed as CLI args and not written to plugin settings; they are redacted from plugin logs
- The Advanced CLI runner rejects shell metacharacters and never invokes a shell

## License

BSD-3-Clause — see [LICENSE](LICENSE).
