/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENOKI_API_KEY: string
  readonly VITE_OAUTH_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}




