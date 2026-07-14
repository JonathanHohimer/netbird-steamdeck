# NetBird for Steam Deck (Decky Plugin)

Control [NetBird](https://netbird.io/) from Steam Gaming Mode via [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).

This plugin does **not** install NetBird. Install the NetBird client on your Deck first, then use this plugin to connect, disconnect, authenticate, select networks, view status, and run arbitrary CLI commands.

## Features

- Connect / disconnect (`netbird up` / `netbird down`)
- Setup key login and SSO login (SSO uses `--no-browser` and shows a copyable URL)
- Custom management URL for self-hosted NetBird
- Network list with select / deselect / select-all
- Detailed status from `netbird status --json` (peers, management, signal, relays)
- Advanced panel to run any `netbird …` subcommand

## Prerequisites

1. Steam Deck with Decky Loader installed
2. NetBird client installed and working in Desktop Mode, for example:
   - `netbird` on `PATH`, or one of:
     - `/usr/bin/netbird`
     - `/usr/local/bin/netbird`
     - `/opt/netbird/netbird`
     - `/home/deck/.local/bin/netbird`
3. NetBird daemon/service running (`netbird service start` or your install’s equivalent)

## Install the plugin

### From a release zip

1. Download the latest `NetBird.zip` (or `netbird-steamdeck-vX.Y.Z.zip`) from Releases
2. In Gaming Mode: Decky → store gear → Developer → Install plugin from ZIP
3. Or copy the unzipped `NetBird` folder to `~/homebrew/plugins/NetBird`

### From source

```bash
pnpm i
pnpm run build
```

Package for Decky:

```text
NetBird/
  dist/index.js
  main.py
  plugin.json
  package.json
  README.md
  LICENSE
```

Zip the `NetBird` folder and install via Decky as above.

## Usage

1. Open the Decky menu → **NetBird**
2. Confirm the CLI path is found at the top
3. **Authentication**
   - Optionally set a self-hosted **Management URL** and save it
   - **Setup key:** paste a key → Connect with setup key
   - **SSO:** tap SSO login → copy the URL → open it in a browser (phone or Deck Desktop) and finish auth
4. Toggle **Connected** to bring the tunnel up or down
5. Use **Networks** to select which routed networks are active
6. Use **Status detail** for peers and connection diagnostics
7. Use **Advanced / CLI** for anything else (`service status`, `debug`, etc.)

Setup keys are not saved by the plugin. The management URL is stored under Decky’s plugin settings directory.

## Development

```bash
pnpm i
pnpm run build   # outputs dist/index.js
pnpm run watch   # rebuild on change
```

Backend entrypoint is `main.py`. Frontend lives in `src/`.

## License

BSD-3-Clause (see [LICENSE](LICENSE)).
