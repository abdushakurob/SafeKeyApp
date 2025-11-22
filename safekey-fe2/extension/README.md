# SafeKey Browser Extension – Source Code

## Overview
This repository contains the source code for the **SafeKey** browser extension, which provides a Web3‑native password manager and integrates with the SafeKey web‑app backend.

## Prerequisites
- **Operating System**: Windows 10/11 (or any OS that can run Node.js). The extension can also be built on macOS/Linux.
- **Node.js**: v20.x (the LTS version at the time of publishing).
- **npm**: v10.x (comes with the Node.js installer).
- **Git** (optional) – for cloning the repository.

## Repository Layout
```
extension/
├─ public/               # Static assets (manifest.json, icons, logo)
├─ src/                  # Extension source code (TS, HTML, CSS)
│   ├─ background/       # Background script
│   ├─ popup/            # Popup UI (HTML, TS)
│   ├─ content/          # Content script
│   ├─ shared/           # Shared constants & heartbeat
│   └─ services/         # API service (blockchain)
├─ dist/                 # Build output (generated after `npm run build`)
├─ package.json          # npm scripts & dependencies
├─ vite.config.ts        # Vite configuration for bundling
└─ README.md             # **This file** – build instructions
```
All source files (TypeScript, CSS, HTML) are human‑written. No generated or minified source files are included.

## Build Instructions
1. **Clone or download** the repository.
2. Open a terminal and navigate to the extension directory:
   ```bash
   cd "C:\Users\st\Documents\New folder\SafeKeyApp\safekey-fe2\extension"
   ```
3. **Install exact dependencies** (using the lockfile):
   ```bash
   npm ci
   ```
4. **Build the extension** – this runs TypeScript compilation and bundles the code with Vite:
   ```bash
   npm run build
   ```
   The compiled files are placed in the `dist/` folder.
5. **Package for Firefox** – creates a Firefox‑compatible ZIP with forward‑slash paths:
   ```bash
   npm run package-firefox
   ```
   The resulting archive `safekey-firefox.zip` appears in the root of the `extension/` folder and can be uploaded to AMO.

## npm Scripts (defined in `package.json`)
- `dev` – Starts Vite in development mode (watch mode).
- `build` – TypeScript compilation (`tsc -b`) + Vite production build.
- `preview` – Serves the built files locally for testing.
- `lint` – Runs ESLint on the source.
- `package-firefox` – Executes the `create-firefox-zip.js` script to produce `safekey-firefox.zip`.

## Environment Requirements
- **Node.js**: v20.x (tested with 20.14.0).
- **npm**: v10.x (tested with 10.8.0).
- **Operating System**: Any OS that can run Node.js. The extension itself runs in Chrome/Firefox.

## Important Notes for Reviewers
- The `manifest.json` in `public/` contains the required `browser_specific_settings.gecko.data_collection_permissions` block with a valid `required` permission (`cookies`).
- All assets (icons, logo) are stored under `public/icons/` and referenced in the manifest.
- No source files are pre‑minified; the build step performs bundling and minification automatically.
- The `create-firefox-zip.js` script uses the **archiver** npm package (included as a devDependency) to generate a ZIP that complies with AMO’s file‑path requirements.

---
**End of README**
