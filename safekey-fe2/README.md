# SafeKey v2 - Web App + Extension Architecture

This is the new architecture for SafeKey with separation between web app and extension.

## Structure

```
safekey-fe2/
├── extension/          # Browser extension (lightweight - storage + autofill)
├── web-app/            # Web application (full UI - OAuth, credential management)
└── shared/             # Shared types and utilities (optional)
```

## Quick Start

### Web App
```bash
cd web-app
npm install
npm run dev
```

### Extension
```bash
cd extension
npm install
npm run build
```

## Architecture

- **Web App**: Handles OAuth login, Enoki wallet, credential management, transaction signing
- **Extension**: Stores session data, detects forms, auto-fills credentials

See `ARCHITECTURE_PLAN.md` for detailed architecture documentation.




