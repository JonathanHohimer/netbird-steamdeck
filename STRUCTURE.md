# Project structure

This repository is a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin. It has two runtime halves that ship together:

1. **Frontend** — React/TypeScript UI injected into Steam Gaming Mode (`src/` → `dist/index.js`)
2. **Backend** — Python process started by Decky (`main.py`) that shells out to NetBird and manages the Steam Deck install under `/opt/netbird`

```text
netbird-steamdeck/
├── .github/workflows/build.yml   # CI: pnpm build + NetBird.zip artifact/release
├── assets/                       # Static assets (logo, etc.)
├── src/                          # Frontend TypeScript sources
│   ├── index.tsx                 # Plugin entry (definePlugin + panel layout)
│   ├── api.ts                    # Typed callable() wrappers → Python methods
│   ├── types.ts                  # Shared TS types for API payloads
│   ├── types.d.ts                # Module shims for image imports
│   └── components/               # UI sections
│       ├── Install.tsx           # Install / update / uninstall / service
│       ├── Connection.tsx        # Up/down + summary fields
│       ├── Auth.tsx              # Management URL, setup key, SSO
│       ├── Networks.tsx          # Network list toggles
│       ├── Status.tsx            # Detailed status / peers / raw detail
│       └── CliRunner.tsx         # Raw netbird argument runner
├── main.py                       # Python backend (all Decky RPC methods)
├── decky.pyi                     # Type stubs for the decky Python module
├── plugin.json                   # Decky plugin metadata + flags
├── package.json                  # npm/pnpm metadata + frontend deps
├── pnpm-lock.yaml                # Locked frontend dependencies
├── rollup.config.js              # Bundler config (@decky/rollup)
├── tsconfig.json                 # TypeScript compiler options
├── LICENSE                       # BSD-3-Clause
├── README.md                     # User / developer documentation
└── STRUCTURE.md                  # This file
```

Build outputs (gitignored):

```text
dist/index.js          # Bundled frontend loaded by Decky
out/NetBird.zip        # Optional local sideload package
node_modules/          # pnpm install output
```

---

## Runtime packaging

When installed on the Deck, Decky expects approximately:

```text
~/homebrew/plugins/NetBird/
  dist/index.js
  main.py
  plugin.json
  package.json
  README.md
  LICENSE
```

| File | Role |
|---|---|
| `plugin.json` | Name, author, `api_version: 1`, publish metadata, `root` flag |
| `package.json` | Version string Decky/UI may surface; build scripts for developers |
| `dist/index.js` | Frontend bundle from `pnpm run build` |
| `main.py` | Backend `Plugin` class; every async method is an RPC |

---

## Frontend (`src/`)

### `index.tsx`

- Calls `definePlugin()` from `@decky/api`
- Renders the side-menu content: header + all panel sections
- Owns shared state: binary info, connection status, management URL, setup key, SSO URL, busy flag
- Polls `status` every few seconds while the panel is open

### `api.ts`

Thin typed wrappers around `callable("python_method_name")`.  
Example: `installNetbird("")` → Python `Plugin.install_netbird(version="")`.

### `types.ts`

Shared shapes for command results, install status, parsed NetBird `--json` status, networks, etc.

### Components

| Component | Backend methods used | Responsibility |
|---|---|---|
| `Install.tsx` | `get_install_status`, `install_netbird`, `update_netbird`, `uninstall_netbird`, `service_start`, `service_stop` | Steam Deck managed lifecycle |
| `Connection.tsx` | `up`, `down`, status props | Connect toggle + IP/FQDN/peers summary |
| `Auth.tsx` | `set_management_url`, `up`, `login`, `logout` | Auth settings + SSO URL copy |
| `Networks.tsx` | `networks_list`, `networks_select`, `networks_deselect` | Per-network toggles and select-all |
| `Status.tsx` | status props / refresh | Peers table + raw detail |
| `CliRunner.tsx` | `run_command` | Escape hatch for other CLI verbs |

UI primitives come from `@decky/ui` (`PanelSection`, `ToggleField`, `ButtonItem`, `TextField`, `Field`). Toasts come from `@decky/api`.

---

## Backend (`main.py`)

Decky instantiates `Plugin` and exposes its `async` methods to the frontend.

### Lifecycle

| Method | When |
|---|---|
| `_main` | Plugin load |
| `_unload` | Plugin disable/unload |

### Binary resolution

Order of preference:

1. `/opt/netbird/bin/netbird` (managed install)
2. `PATH` via `shutil.which("netbird")`
3. Fallbacks: `/usr/bin`, `/usr/local/bin`, Homebrew path, etc.

### Install management (Steam Deck)

| Method | Behavior |
|---|---|
| `get_install_status` | Local version, managed flag, service active/enabled, latest GitHub tag |
| `install_netbird` | Download release tarball → `/opt/netbird/bin`, write persist files, `service install` + `enable` + `start` |
| `update_netbird` | Same as install with latest version |
| `uninstall_netbird` | `down` / `service uninstall`, remove `/opt/netbird` + profile/atomic files + unit |
| `service_start` / `service_stop` | Prefer `netbird service …`, fall back to `systemctl` |

Managed host files written by install:

- `/opt/netbird/bin/netbird`
- `/etc/profile.d/netbird.sh`
- `/etc/atomic-update.conf.d/netbird.conf`
- `/etc/systemd/system/netbird.service` (via NetBird’s own installer)

### CLI control

| Method | NetBird CLI |
|---|---|
| `status` | `status --json` (+ optional `--detail`) |
| `up` / `down` | `up` / `down` |
| `login` / `logout` | `login` / `logout` |
| `networks_list` | `networks list` (parse human output) |
| `networks_select` / `networks_deselect` | `networks select[-a]` / `deselect` |
| `run_command` | Arbitrary argv after `netbird` (no shell; blocks metacharacters) |
| `get_settings` / `set_management_url` | JSON settings under Decky settings dir |

Helpers of note:

- `_redact_cmd` — hides setup keys in logs
- `_extract_auth_url` — pulls SSO URLs from CLI output for Gaming Mode
- `_parse_networks_list` — best-effort parse of `networks list` text
- `_http_json` / `_http_download` — GitHub release fetch (stdlib `urllib`)

### Settings storage

`DECKY_PLUGIN_SETTINGS_DIR/settings.json` currently stores:

```json
{ "management_url": "https://…" }
```

Setup keys are intentionally not stored.

---

## Config / build tooling

| File | Purpose |
|---|---|
| `plugin.json` | Decky identity; `"flags": ["root"]` so install/service ops can write system paths |
| `package.json` | Plugin version + `pnpm` scripts (`build`, `watch`) |
| `rollup.config.js` | Uses `@decky/rollup` preset to emit `dist/index.js` |
| `tsconfig.json` | Strict TS compile options for `src/` |
| `decky.pyi` | Editor/type hints for `import decky` (not shipped as runtime) |
| `.gitignore` | Ignores `dist/`, `node_modules/`, `out/`, caches |
| `.github/workflows/build.yml` | Install deps, build, zip plugin, upload artifact; attach zip on tags |

---

## Data flow

```text
User taps Install
    → Install.tsx calls installNetbird()
    → Decky RPC → main.py install_netbird()
    → GitHub Releases download
    → write /opt/netbird + persist files
    → netbird service install/enable/start
    → frontend refreshes get_install_status / status

User toggles Connected
    → Connection.tsx → up()/down()
    → netbird up|down (optional --setup-key / --management-url / --no-browser)
    → status poll updates UI
```

---

## Extending the plugin

1. **New backend capability** — add an `async def` on `Plugin` in `main.py`, then wrap it in `src/api.ts`.
2. **New UI section** — add a component under `src/components/` and mount it from `src/index.tsx`.
3. **Rebuild** — `pnpm run build`, then reinstall/reload the plugin zip on the Deck.

Keep CLI invocations as argv lists (never `shell=True`). Prefer `/opt/netbird/bin/netbird` for Deck-managed installs.
