declare module 'overleaf-editor-core' {
  export const Change: any
  export const Chunk: any
  export const Snapshot: any
}

declare module 'overleaf-editor-core-source' {
  const core: {
    Change: any
    Chunk: any
    Snapshot: any
  }
  export default core
}
