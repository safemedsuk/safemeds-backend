// `file-type` is ESM-only and ships an "exports" map that `moduleResolution:
// node` (classic) can't resolve for types, even though the dynamic
// `import('file-type')` works fine at runtime. Minimal ambient declaration
// covering only what this codebase uses.
declare module 'file-type' {
  export interface FileTypeResult {
    ext: string
    mime: string
  }

  export function fileTypeFromBuffer(
    input: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>
}
