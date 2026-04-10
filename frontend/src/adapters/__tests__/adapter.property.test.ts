import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tripo3DFrontendAdapter } from '../Tripo3DFrontendAdapter'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Feature: frontend-direct-api, Property 1: 适配器请求构造完整性', () => {
  const adapter = new Tripo3DFrontendAdapter()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('text_to_model requests always include type and prompt with non-empty taskId response', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 100 }), async (prompt) => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 'task-text-001' } }))

        const output = await adapter.createTask(
          'api-key',
          { type: 'text_to_model', prompt },
          '/tripo'
        )

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(String(options.body)) as { type: string; prompt: string }
        expect(body.type).toBe('text_to_model')
        expect(body.prompt).toBe(prompt)
        expect(output.taskId.length).toBeGreaterThan(0)
        mockFetch.mockReset()
      }),
      { numRuns: 100 }
    )
  })

  it('image_to_model requests always include file payload and resolved file_token', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 64 }), async (content) => {
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ data: { image_token: 'img-token-property' } }))
          .mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 'task-image-001' } }))

        const imageFile = new File([content], 'input.png', { type: 'image/png' })
        const output = await adapter.createTask(
          'api-key',
          { type: 'image_to_model', imageFile },
          '/tripo'
        )

        const [uploadUrl, uploadOptions] = mockFetch.mock.calls[0] as [string, RequestInit]
        expect(uploadUrl).toBe('/tripo/upload')
        expect(uploadOptions.credentials).toBe('omit')
        expect(uploadOptions.headers).toEqual(
          expect.objectContaining({
            Authorization: 'Bearer api-key',
          })
        )
        const uploadBody = uploadOptions.body as FormData
        expect(uploadBody).toBeInstanceOf(FormData)
        expect(uploadBody.get('file')).toBeInstanceOf(File)

        const [createUrl, createOptions] = mockFetch.mock.calls[1] as [string, RequestInit]
        expect(createUrl).toBe('/tripo/task')
        expect(createOptions.credentials).toBe('omit')
        expect(createOptions.headers).toEqual(
          expect.objectContaining({
            Authorization: 'Bearer api-key',
            'Content-Type': 'application/json',
          })
        )
        const createBody = JSON.parse(String(createOptions.body)) as {
          file: { type: string; file_token: string }
        }
        expect(createBody.file.type).toBe('image')
        expect(createBody.file.file_token).toBe('img-token-property')
        expect(output.taskId.length).toBeGreaterThan(0)
        mockFetch.mockReset()
      }),
      { numRuns: 100 }
    )
  })
})
