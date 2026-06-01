import type { NativeHelloResponse } from './types'

export function shapeCompileResponse(
  localResponse: Record<string, unknown>,
  session: Pick<NativeHelloResponse, 'port'>
): Record<string, any> {
  return {
    ...localResponse,
    compileGroup: 'standard',
    clsiServerId: 'local',
    pdfDownloadDomain: `http://127.0.0.1:${session.port}`,
    pdfCachingMinChunkSize: 0,
    validationProblems: null,
  }
}
