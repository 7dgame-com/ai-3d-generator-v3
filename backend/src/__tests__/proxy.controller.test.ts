import type { Response } from 'express';
import { proxyProviderRequest } from '../controllers/proxy';

const mockFetch = jest.fn();
const originalFetch = global.fetch;

const mockIsEnabled = jest.fn();

jest.mock('../adapters/ProviderRegistry', () => ({
  providerRegistry: {
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
  },
}));

function createResponse() {
  const payload: { body?: unknown } = {};
  const headers = new Map<string, string>();

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn((body: unknown) => {
      payload.body = body;
      return res;
    }),
    send: jest.fn((body: unknown) => {
      payload.body = body;
      return res;
    }),
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
  } as unknown as Response;

  return { res, payload, headers };
}

describe('proxyProviderRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockIsEnabled.mockReturnValue(true);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('rejects proxy requests without X-Provider-Api-Key', async () => {
    const req = {
      method: 'POST',
      params: { providerId: 'tripo3d', 0: 'task' },
      query: {},
      body: {},
      headers: {},
      header: jest.fn(() => undefined),
    } as unknown as Parameters<typeof proxyProviderRequest>[0];
    const { res, payload } = createResponse();

    await proxyProviderRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(payload.body).toEqual({
      code: 4001,
      message: '参数错误',
      errors: ['X-Provider-Api-Key 不能为空'],
    });
  });

  it('forwards JSON request to provider endpoint with bearer auth', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from('{"ok":true}'),
    });

    const req = {
      method: 'POST',
      params: { providerId: 'tripo3d', 0: 'task' },
      query: { foo: 'bar' },
      body: { prompt: 'chair' },
      headers: { 'content-type': 'application/json' },
      header: jest.fn((name: string) => {
        if (name.toLowerCase() === 'x-provider-api-key') return 'provider-secret';
        if (name.toLowerCase() === 'content-type') return 'application/json';
        return undefined;
      }),
    } as unknown as Parameters<typeof proxyProviderRequest>[0];
    const { res, payload, headers } = createResponse();

    await proxyProviderRequest(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(String(calledUrl)).toBe('https://api.tripo3d.ai/v2/openapi/task?foo=bar');
    const upstreamHeaders = calledInit.headers as Headers;
    expect(upstreamHeaders.get('Authorization')).toBe('Bearer provider-secret');
    expect(upstreamHeaders.get('content-type')).toBe('application/json');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(headers.get('content-type')).toBe('application/json');
    expect(Buffer.isBuffer(payload.body)).toBe(true);
    expect((payload.body as Buffer).toString('utf8')).toBe('{"ok":true}');
  });
});
