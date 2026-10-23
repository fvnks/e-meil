# e-Meil

A desktop email client built with Tauri 2, Rust and Svelte 5. Available for Windows and Linux.

## Why does this exist?

I switched to Linux a while back and, as much as I looked, I couldn't find an email client that actually worked the way I wanted. Some were too complicated, others had features I never used, and a few just felt like they were fighting me. So I built my own.

It's not the first project of its kind I've seen, but for me it makes sense to have something that does what I need without the noise: connect my accounts without fuss, organise mail the way I think, and not steal my attention with unnecessary animations.

## What you can do

- Connect **Microsoft 365** accounts (Outlook, Hotmail, Live) with built-in sign-in: you don't need to configure anything — the app opens a window and handles the rest.
- Connect **Gmail** accounts with OAuth 2.0 (using Thunderbird's public desktop identity, same precedent as Microsoft using DavMail's — the wizard explains this when you add the account).
- Add any **IMAP** or **POP3** account you have, with or without encryption.
- Read mail in plain text or HTML (with scripts blocked for safety).
- Send messages with attachments up to 25 MB.
- Search on the server, not just locally.
- Save drafts on the server.
- Desktop notifications when new mail arrives.
- Outlook-style keyboard shortcuts: `Ctrl+N` to compose, `Ctrl+F` to search, `Ctrl+R` to reply.
- A keyboard-navigable context menu.
- Proper dark mode, not just inverted colours.
- Adjustable colour themes from Settings.

## What it doesn't have (yet)

- No custom sync server: each account connects directly to its provider.
- No demo data: the app is empty until you add an account.
- Conversation threads work well on Microsoft Graph and IMAP; POP3 has no threading because the protocol doesn't support it.
- On Linux the `.deb` package updates via `apt`; AppImage and MSI/NSIS use e-Meil's built-in updater.

## Requirements

- Node.js 20+ and [pnpm](https://pnpm.io)
- Rust (stable) with Cargo
- Tauri 2 CLI (`@tauri-apps/cli`, included in project dependencies)
- On Linux: libwebkit2gtk-4.1, libgtk-3, libayatana-appindicator3, librsvg2, patchelf and libssl

## Build and run

```bash
# Install dependencies
pnpm install

# Web interface only (Vite, http://127.0.0.1:5173)
pnpm dev

# Full desktop app (Tauri)
pnpm tauri dev

# Verify everything compiles cleanly
pnpm build

# Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Build installers
pnpm tauri build
```

Installers are produced in `src-tauri/target/release/bundle/`:
- **Windows**: MSI and NSIS
- **Linux**: AppImage and `.deb`

## Automated verification

The project includes scripts that run against a real browser (Chrome with CDP):

```bash
# Accessibility test: focus trapping in modals (Tab/Shift+Tab/Escape)
node scripts/verify-modal-a11y.mjs http://127.0.0.1:5173/

# Mobile responsive: drawer, read pane and composer full-screen
node scripts/verify-responsive.mjs http://127.0.0.1:5173/

# Keyboard navigation: context menu (arrows, Home/End, Escape)
node scripts/verify-keyboard.mjs http://127.0.0.1:5173/

# WCAG contrast audit against styles.css
node scripts/contrast-audit.mjs

# Performance benchmark
pnpm run test:performance http://127.0.0.1:4173/
```

Lighthouse accessibility score: **100/100**.

## Current status

- `svelte-check`: 0 errors, 0 warnings
- `cargo test`: 26 tests passing
- Verification scripts: all green
- Installers: available at [Releases](https://github.com/fvnks/e-meil/releases)

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) for more detail.

## License

MIT.
