/// <reference types="vite/client" />

declare module 'cos-js-sdk-v5' {
  const COS: new (options: Record<string, unknown>) => {
    uploadFile: (
      options: Record<string, unknown>,
      callback: (error: Error | null, data: { Location?: string }) => void
    ) => void
  }
  export default COS
}
