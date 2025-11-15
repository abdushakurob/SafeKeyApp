# SafeKey Web App

Web application for SafeKey password manager.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Add your credentials to `.env`:
```
VITE_ENOKI_API_KEY=your_enoki_api_key_here
VITE_OAUTH_CLIENT_ID=your_google_oauth_client_id_here
```

4. Run development server:
```bash
npm run dev
```

## Features

- ✅ OAuth login with Google (via Enoki)
- ✅ Credential management UI
- ✅ Blockchain storage (Sui)
- ✅ Extension sync
- ✅ SEAL integration for master key derivation

## Environment Variables

- `VITE_ENOKI_API_KEY` - Your Enoki API key
- `VITE_OAUTH_CLIENT_ID` - Your Google OAuth client ID
- `VITE_SAFEKEY_PACKAGE_ID` - SafeKey smart contract package ID
- `VITE_SEAL_PACKAGE_ID` - SEAL package ID
