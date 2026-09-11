# Rexio

A Roblox account manager for Linux and Windows. Add accounts once, then
launch straight into the game logged in as whichever one you click — no
re-entering passwords, no browser round-trip.

## Features

- **Account switching** — store multiple Roblox accounts, launch any of them
  with one click.
- **Avatars & presence** — shows each account's real avatar and whether
  it's online / in a game.
- **Drag to reorder**, with a confirm step before removing an account.
- **In-app FastFlag editor** — Sober's `config.json` on Linux, or Roblox's
  `ClientAppSettings.json` on Windows — instead of hand-editing files.
- **System tray** with a quick-launch menu; configurable minimize-to-tray.
- **Start on login**, desktop notifications, auto-retry on flaky Roblox API
  calls, passphrase-protected account backup/restore.

## How it works

Accounts are added by logging in once through an embedded Roblox login page.
Rexio reads the resulting `.ROBLOSECURITY` cookie (never your password),
encrypts it at rest via Electron's `safeStorage` (your OS keyring / libsecret
on Linux, DPAPI on Windows), and stores it locally — nothing leaves your
machine.

To launch, Rexio exchanges that cookie for a short-lived Roblox auth ticket
and builds a `roblox-player:` launch URI.

- **Linux**: hands the URI directly to Sober's Flatpak process, so a crash
  can be detected and reported instead of failing silently.
- **Windows**: hands the URI to the OS via the `roblox-player:` protocol
  handler that the official Roblox installer registers.

## Requirements

- **Linux**: [Sober](https://sober.vinegarhq.org) installed via Flatpak
  (`org.vinegarhq.Sober`)
- **Windows**: the official Roblox client installed
- Node.js 18+ (for building from source)

## Development

```bash
npm install
npm start
```

## Building installers

Linux (.deb):

```bash
npm run dist
```

Output: `dist/rexio_<version>_amd64.deb`.

Windows (NSIS installer):

```bash
npm run dist:win
```

Output: `dist/Rexio Setup <version>.exe`. Note: for a polished result you'll
want a real multi-resolution `.ico` file instead of the raw `.png` — swap the
`win.icon` path in `package.json` once you have one.

## Auto-updates

Rexio checks GitHub Releases for new versions on startup (packaged builds
only). To enable this for your own fork:

1. Update the `build.publish` block in `package.json` with your GitHub
   username/repo.
2. Set a `GH_TOKEN` environment variable with a GitHub personal access token
   before running `npm run dist -- --publish always` (or the Windows
   equivalent) to upload the build as a release asset.

## Notes / limitations

- **Linux**: launching assumes Sober is installed and registered as the
  `roblox-player:` protocol handler. Other Roblox-on-Linux setups
  (Grapejuice, raw Wine) aren't supported yet.
- **Windows**: the FastFlag file (`ClientAppSettings.json`) lives inside a
  version-specific folder that Roblox regenerates on every update, wiping
  your custom flags — and Roblox only honors a small allowlist of flags
  there regardless.
- Editing FastFlags incorrectly can stop the client from launching. On
  Linux, delete `~/.var/app/org.vinegarhq.Sober/config/sober/config.json`
  and Sober will regenerate it. On Windows, delete
  `ClientAppSettings.json` from the version folder.
- This is a personal-use tool, not affiliated with Roblox Corporation or
  the Sober/Vinegar project.

## License

MIT (or pick whatever you prefer — add a LICENSE file before publishing).
