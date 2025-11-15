# SafeKey Extension

Browser extension for SafeKey password manager.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build extension:
```bash
npm run build
```

3. Load extension in browser:
   - Chrome: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select the `dist` folder
   - Firefox: Go to `about:debugging`, click "This Firefox", click "Load Temporary Add-on", select `dist/manifest.json`

## Features

- Session storage (synced from web app)
- Form detection
- Auto-fill credentials




