/// <reference types="vite/client" />
/// <reference types="./electron.d.ts" />

interface ImportMetaEnv {
  readonly VITE_OSC_PORT: string
  readonly VITE_OSC_HOST: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
