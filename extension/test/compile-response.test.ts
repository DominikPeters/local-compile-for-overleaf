import { describe, expect, it } from 'vitest'
import { shapeCompileResponse } from '../src/compile-response'

describe('shapeCompileResponse', () => {
  it('adds the Overleaf compile fields expected by the PDF preview', () => {
    expect(
      shapeCompileResponse(
        {
          status: 'success',
          outputFiles: [],
        },
        { port: 4567 }
      )
    ).toMatchObject({
      status: 'success',
      outputFiles: [],
      compileGroup: 'standard',
      clsiServerId: 'local',
      pdfDownloadDomain: 'http://127.0.0.1:4567',
      pdfCachingMinChunkSize: 0,
      validationProblems: null,
    })
  })
})
