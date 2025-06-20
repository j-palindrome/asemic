/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OSC_PORT: string
  readonly VITE_OSC_HOST: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
