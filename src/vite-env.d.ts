/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

// Declaration for Vite's Web Worker imports
declare module '*.worker.ts?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}

declare module '*.worker?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}
