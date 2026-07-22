# NetBird for Steam Deck (Decky Plugin)

## Disclaimer

This software is provided as-is for convenience and personal use. It is shared publicly in case others find it useful, but it is offered without warranty of any kind. By choosing to install or run it, you assume all associated risk—including any impact to your Steam Deck, network, or data. The author is not liable for damages or other consequences arising from its use. Support and updates are provided on a best-effort basis and may not be available promptly.

## Security notes

- The backend runs as root so it can manage `/opt` and systemd
- Setup keys are passed as CLI args and not written to plugin settings; they are redacted from plugin logs
- The Advanced CLI runner rejects shell metacharacters and never invokes a shell

## AI assistance

This project was created in whole or in part with the assistance of AI (Cursor). Human review and testing remain the author’s responsibility.


Decky Loader plugin that installs and controls [NetBird](https://netbird.io/) from **Gaming Mode** on Steam Deck and compatible immutable Linux handhelds.

SteamOS and similar gaming distributions are immutable, so the usual NetBird Linux installer often fails or does not persist across updates. This plugin uses the Deck-friendly layout discussed in [NetBird #4584](https://github.com/netbirdio/netbird/issues/4584): binary under `/opt/netbird` when `/opt` is writable, `/var/opt/netbird` otherwise, systemd service registration, and SteamOS keep-files when available.

For a file-by-file map of the repo, see [STRUCTURE.md](STRUCTURE.md).

# Screenshots

## Main Screen

<img width="519" height="675" alt="decky1" src="https://github.com/user-attachments/assets/04a77046-1ae2-465a-9d02-65e82f47bc0c" />

<img width="522" height="681" alt="decky2" src="https://github.com/user-attachments/assets/6829e1b8-6bba-44d5-9cd2-c90adb52ea20" />

## Service Management
<img width="515" height="675" alt="decky3" src="https://github.com/user-attachments/assets/ab414216-c972-45c0-8a22-fa4460088b44" />

<img width="516" height="680" alt="decky4" src="https://github.com/user-attachments/assets/edf85fb7-94d8-485f-8aec-9a2cb1ceb5d2" />

## Advanced
<img width="511" height="689" alt="decky5" src="https://github.com/user-attachments/assets/53b74733-c728-4133-842e-a7eadfaa4262" />


## Features

- **Install / update / uninstall** NetBird under `/opt/netbird` or `/var/opt/netbird`
- Start / stop / enable the NetBird systemd service
- Connect / disconnect (`netbird up` / `netbird down`)
- Setup-key login and SSO login (SSO uses `--no-browser` / `--qr`, copyable URL, optional QR)
- Custom management URL for self-hosted NetBird (edited under Advanced)
- Network select / deselect / select-all
- Public IP check via `curl ifconfig.me`
- Detailed status from `netbird status --json` (peers, management, signal, relays)
- Advanced panel for remaining `netbird …` CLI commands, install log, and clearing `/var/lib/netbird`
- When NetBird is not installed: banner on the main view with a shortcut to Service management; Connection / Auth / Networks controls stay disabled

## Prerequisites

1. A Steam Deck or compatible x86_64/aarch64 Linux handheld with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed
2. This plugin installed (ships with the `root` flag so it can manage the install and service)

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

Each push to `main` publishes/updates a GitHub Release tagged from `package.json` (e.g. `v1.1.14`) with that zip attached.

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
2. If you see **NetBird isn’t installed yet**, tap **Open Service management →** (or **More → Service management →**)
3. **Install NetBird**  
   Downloads the latest matching GitHub release (`linux_amd64` or `linux_arm64`) into the selected managed path, installs the service, and enables it on boot
4. Go **← Back** to the main view
5. Authenticate:
   - **Setup key:** paste key → **Connect with setup key**, or
   - **SSO login:** tap SSO → open/copy the URL or scan the QR → finish auth on another device
6. Optionally set a self-hosted **Management URL** under **Advanced →** and save it
7. Toggle **Connected** to bring the mesh up or down

## UI map

| View / section | Purpose |
|---|---|
| **Not-installed banner** | Shown when the CLI is missing; opens Service management |
| **Connection** | Up/down toggle, NetBird IP / FQDN / peers, optional management URL (read-only if non-default), public IP test |
| **NetBird / CLI** | Resolved binary path and version (or “Checking…” / not found) |
| **Authentication** | Setup key, SSO (QR / URL / open / copy), logout |
| **Networks** | List and toggle selected networks; select/deselect all |
| **More → Service management** | Install, update, uninstall, start/stop/enable service, wipe `/var/lib/netbird` |
| **More → Advanced** | Management URL editor, status detail / raw, install log, raw CLI runner |

Service management and Advanced are sub-views with **← Back** to main. They stay available even when NetBird is not installed.

## What the managed install writes

| Path | Role |
|---|---|
| `/opt/netbird/bin/netbird` | Client binary when `/opt` is writable |
| `/var/opt/netbird/bin/netbird` | Client binary fallback when `/opt` is read-only |
| `/etc/profile.d/netbird.sh` | Adds the selected binary directory to PATH |
| `/etc/atomic-update.conf.d/netbird.conf` | Keeps the profile snippet across SteamOS updates; only written when this mechanism exists |
| `/etc/systemd/system/netbird.service` | Daemon unit from `netbird service install` |
| `/var/lib/netbird` | NetBird runtime state (keys, config) |

**Uninstall managed NetBird** removes the managed `/opt/netbird` and `/var/opt/netbird` trees, profile/atomic keep files, and the systemd unit. External installs (Homebrew, Distrobox, etc.) are left alone.

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
                          /opt or /var/opt/netbird  GitHub releases  systemctl
                               netbird CLI
```

Frontend talks to the backend with `@decky/api` `callable()`. The backend prefers the selected managed install root, then falls back to the other managed root, PATH, and other known locations.

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
| Banner / CLI “Not found” | Open **Service management** → **Install NetBird**; confirm the plugin has root (`plugin.json` flags) |
| Latest release shows SSL / CERTIFICATE_VERIFY_FAILED | Reinstall plugin ≥1.1.1 — HTTPS uses Decky’s `certifi` CA bundle |
| Permission denied `/opt/netbird` | `plugin.json` must use `"flags": ["root"]` (not `_root`). Reinstall the zip and restart Decky |
| Plugin privileges shows NOT root | Same as above — Decky only elevates for the exact flag `root` |
| `libcrypto.so.3` / OPENSSL errors during service install | Fixed in ≥1.1.3 by clearing Decky’s `LD_LIBRARY_PATH` for child processes — reinstall the plugin zip |
| Unit present but disabled / service not detected | Use **Enable & start service**; ≥1.1.4 also treats a reachable daemon socket as active |
| SSO does nothing in Game Mode | Enable **Show QR for SSO** (uses `netbird --qr`) to scan from a phone, or **Open** / **Copy SSO URL** |
| Install fails downloading | Deck needs network; check the **Install log** under Advanced (and Copy install log) |
| Service inactive after reboot | **Start service**, or reinstall so `systemctl enable` runs again |
| Status empty | Service must be running; use **Start service** then refresh |
| Stuck / wrong peer identity after reinstall | Service management → clear `/var/lib/netbird`, then re-authenticate |

## License

BSD-3-Clause — see [LICENSE](LICENSE).
