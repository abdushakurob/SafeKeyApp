#!/usr/bin/env node

/**
 * SafeKey Extension Development Guide
 * Quick reference for building and testing the extension
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

console.log(`
╔════════════════════════════════════════════════════════════════╗
║               SafeKey Browser Extension                         ║
║              Chrome & Firefox Development Guide                 ║
╚════════════════════════════════════════════════════════════════╝

📦 QUICK START COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔨 Build Extension:
   npm run build:extension

🧪 Test in Chrome:
   1. npm run build:extension
   2. Go to chrome://extensions/
   3. Enable "Developer mode"
   4. Click "Load unpacked"
   5. Select ./dist/extension

🦊 Test in Firefox:
   1. npm run build:extension
   2. Go to about:debugging
   3. Click "This Firefox"
   4. Click "Load Temporary Add-on"
   5. Select ./dist/extension/manifest.json

💻 Development Mode:
   npm run dev:extension

📁 PROJECT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

src/
├── popup/              Entry point for extension popup UI
│   ├── popup.html     
│   ├── popup.tsx      React component
│   └── popup.css      Styles
├── background/         Service worker for extension logic
│   └── background.ts  
├── content/           Scripts injected into web pages
│   └── content.ts     
└── [existing files]   Your main React app

public/extension/
└── manifest.json      Extension manifest (MV3)

dist/extension/        ← Built extension (load this!)
├── popup.html
├── popup.js
├── background.js
├── content.js
└── manifest.json

🔌 COMMUNICATION FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Popup ←→ Background Service Worker ←→ Content Script
(UI)     (Logic & Storage)              (Page Access)

Example - Send message from popup:
  chrome.runtime.sendMessage({ type: 'ACTION' }, (response) => {
    console.log(response)
  })

Example - Listen in background:
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'ACTION') {
      sendResponse({ status: 'done' })
    }
  })

📋 PERMISSIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current permissions in manifest.json:
  - storage: Save/load data locally
  - scripting: Inject content scripts
  - tabs: Access tab information
  - activeTab: Access current tab
  - host_permissions: <all_urls> (all websites)

Need more? Edit public/extension/manifest.json

🚀 DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Chrome Web Store:
  1. Build: npm run build:extension
  2. Zip: dist/extension/
  3. Upload to https://chrome.google.com/webstore/devconsole

Firefox Add-ons:
  1. Build: npm run build:extension
  2. Zip: dist/extension/
  3. Upload to https://addons.mozilla.org/

🐛 TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extension not loading?
  → Check dist/extension/ exists and has manifest.json
  → Check browser console (F12) for errors
  → Verify manifest.json is valid JSON

Chrome API not working?
  → Add permission to manifest.json
  → Check Chrome version (need 120+ for MV3)
  → Content scripts need background worker for APIs

Build errors?
  → Run: npm install
  → Run: npm run lint
  → Check error messages

💡 TIPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Use chrome.storage.local for persistent data
• Access extension logs via chrome://extensions/ (Developer mode)
• Content scripts can't access all Chrome APIs (use background worker)
• Reload extension after code changes (Extensions page)
• Use console.log() for debugging in each context

📚 RESOURCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Chrome API Docs: https://developer.chrome.com/docs/extensions/mv3/
  Firefox API Docs: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/
  Manifest Format: https://developer.chrome.com/docs/extensions/mv3/manifest/
  Vite Docs: https://vitejs.dev/
  React Docs: https://react.dev/

═══════════════════════════════════════════════════════════════════

For detailed information, see EXTENSION_README.md
`)
