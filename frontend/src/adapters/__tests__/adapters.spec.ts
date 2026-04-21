import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hyper3DFrontendAdapter } from '../Hyper3DFrontendAdapter'
import { Tripo3DFrontendAdapter } from '../Tripo3DFrontendAdapter'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('frontend provider adapters', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Tripo createTask builds text_to_model request and parses taskId', async () => {
    const adapter = new Tripo3DFrontendAdapter()
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 'task-001' } }))

    const result = await adapter.createTask(
      'api-key',
      { type: 'text_to_model', prompt: 'a red chair' },
      '/tripo'
    )

    expect(result).toEqual({
      taskId: 'task-001',
      pollingKey: 'task-001',
      estimatedCreditCost: 30,
    })
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/tripo/task')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('omit')
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
        'Content-Type': 'application/json',
      })
    )
    expect(JSON.parse(String(options.body))).toEqual(
      expect.objectContaining({
        type: 'text_to_model',
        prompt: 'a red chair',
      })
    )
  })

  it('Tripo createTask uploads image first and then creates task with file token', async () => {
    const adapter = new Tripo3DFrontendAdapter()
    const imageFile = new File(['image-bytes'], 'ref.png', { type: 'image/png' })
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: { image_token: 'img-token-001' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 'task-002' } }))

    const result = await adapter.createTask(
      'api-key',
      { type: 'image_to_model', imageFile },
      '/tripo'
    )

    expect(result.taskId).toBe('task-002')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [uploadUrl, uploadOptions] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(uploadUrl).toBe('/tripo/upload')
    expect(uploadOptions.body).toBeInstanceOf(FormData)
    expect(uploadOptions.credentials).toBe('omit')
    expect(uploadOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
      })
    )
    const uploadForm = uploadOptions.body as FormData
    expect(uploadForm.get('file')).toBeInstanceOf(File)
    const [createUrl, createOptions] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(createUrl).toBe('/tripo/task')
    expect(createOptions.credentials).toBe('omit')
    expect(createOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
        'Content-Type': 'application/json',
      })
    )
    expect(JSON.parse(String(createOptions.body))).toEqual(
      expect.objectContaining({
        type: 'image_to_model',
        file: expect.objectContaining({
          type: 'image',
          file_token: 'img-token-001',
        }),
      })
    )
  })

  it('Tripo createTask falls back to /tripo-alt when the primary proxy upload fails', async () => {
    const adapter = new Tripo3DFrontendAdapter()
    const imageFile = new File(['image-bytes'], 'ref.png', { type: 'image/png' })
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'upstream timeout' }, 502))
      .mockResolvedValueOnce(jsonResponse({ data: { image_token: 'img-token-002' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { task_id: 'task-004' } }))

    const result = await adapter.createTask(
      'api-key',
      { type: 'image_to_model', imageFile },
      '/tripo'
    )

    expect(result).toEqual({
      taskId: 'task-004',
      pollingKey: 'task-004',
      estimatedCreditCost: 30,
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/tripo/upload')
    expect(mockFetch.mock.calls[1]?.[0]).toBe('/tripo-alt/upload')
    expect(mockFetch.mock.calls[2]?.[0]).toBe('/tripo-alt/task')
  })

  it('Tripo getTaskStatus parses success output and thumbnail', async () => {
    const adapter = new Tripo3DFrontendAdapter()
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: {
          status: 'success',
          progress: 100,
          thumbnail: 'https://cdn.example.com/thumb.webp',
          result: {
            credit_cost: 30,
            pbr_model: { url: 'https://cdn.example.com/model.glb' },
          },
        },
      })
    )

    const result = await adapter.getTaskStatus('api-key', 'task-003', '/tripo')
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/tripo/task/task-003')
    expect(options.credentials).toBe('omit')
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        progress: 100,
        creditCost: 30,
        outputUrl: 'https://cdn.example.com/model.glb',
        thumbnailUrl: 'https://cdn.example.com/thumb.webp',
      })
    )
  })

  it('Tripo getTaskStatus falls back to /tripo-alt when the primary proxy returns 404', async () => {
    const adapter = new Tripo3DFrontendAdapter()
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            status: 'success',
            progress: 100,
            result: {
              credit_cost: 30,
              pbr_model: { url: 'https://cdn.example.com/model-fallback.glb' },
            },
          },
        })
      )

    const result = await adapter.getTaskStatus('api-key', 'task-005', '/tripo')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/tripo/task/task-005')
    expect(mockFetch.mock.calls[1]?.[0]).toBe('/tripo-alt/task/task-005')
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        outputUrl: 'https://cdn.example.com/model-fallback.glb',
        creditCost: 30,
      })
    )
  })

  it('Hyper createTask sends multipart request and parses polling key', async () => {
    const adapter = new Hyper3DFrontendAdapter()
    const imageFile = new File(['image-bytes'], 'ref.png', { type: 'image/png' })
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        uuid: 'hyper-task-001',
        jobs: [{ subscription_key: 'sub-001' }],
      })
    )

    const result = await adapter.createTask(
      'api-key',
      { type: 'image_to_model', prompt: 'a robot', imageFile },
      '/hyper'
    )

    expect(result).toEqual({
      taskId: 'hyper-task-001',
      pollingKey: 'sub-001',
      estimatedCreditCost: 0.5,
    })
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/hyper/rodin')
    expect(options.credentials).toBe('omit')
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
      })
    )
    const form = options.body as FormData
    expect(form.get('prompt')).toBe('a robot')
    expect(form.get('tier')).toBe('Gen-2')
    expect(form.get('images')).toBeInstanceOf(File)
  })

  it('Hyper createTask surfaces upstream error details when the provider returns JSON on non-2xx', async () => {
    const adapter = new Hyper3DFrontendAdapter()
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'Upstream unavailable',
          message: 'getaddrinfo ENOTFOUND oneapi',
        },
        500
      )
    )

    await expect(
      adapter.createTask(
        'api-key',
        { type: 'text_to_model', prompt: 'balloon house' },
        '/hyper'
      )
    ).rejects.toThrow('Upstream unavailable: getaddrinfo ENOTFOUND oneapi')
  })

  it('Hyper getTaskStatus handles completed jobs and download result', async () => {
    const adapter = new Hyper3DFrontendAdapter()
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          jobs: [
            { status: 'Done' },
            { status: 'Done' },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          list: [
            { filename: 'render.jpg', url: 'https://cdn.example.com/render.jpg' },
            { filename: 'base_basic_pbr.glb', url: 'https://cdn.example.com/model.glb' },
          ],
        })
      )

    const result = await adapter.getTaskStatus(
      'api-key',
      'hyper-task-002',
      '/hyper',
      'sub-002'
    )

    const [statusUrl, statusOptions] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(statusUrl).toBe('/hyper/status')
    expect(statusOptions.credentials).toBe('omit')
    expect(statusOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
        'Content-Type': 'application/json',
        accept: 'application/json',
      })
    )

    const [downloadUrl, downloadOptions] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(downloadUrl).toBe('/hyper/download')
    expect(downloadOptions.credentials).toBe('omit')
    expect(downloadOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
        'Content-Type': 'application/json',
        accept: 'application/json',
      })
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        progress: 100,
        outputUrl: 'https://cdn.example.com/model.glb',
        thumbnailUrl: 'https://cdn.example.com/render.jpg',
      })
    )
  })
})
