import type { Request, Response as ExpressResponse } from 'express';
import { providerRegistry } from '../adapters/ProviderRegistry';

const TRIPO_API_BASE = 'https://api.tripo3d.ai/v2/openapi';
const HYPER3D_API_BASE = process.env.HYPER3D_API_BASE || 'https://api.hyper3d.com/api/v2';

function resolveProviderBaseUrl(providerId: string): string | null {
  if (providerId === 'tripo3d') {
    return TRIPO_API_BASE;
  }

  if (providerId === 'hyper3d') {
    return HYPER3D_API_BASE;
  }

  return null;
}

function appendQueryParams(url: URL, query: Request['query']): void {
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        url.searchParams.append(key, String(value));
      }
      continue;
    }

    url.searchParams.append(key, String(rawValue));
  }
}

function buildUpstreamUrl(baseUrl: string, pathSuffix: string, query: Request['query']): URL {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = pathSuffix.replace(/^\/+/, '');
  const upstream = new URL(`${normalizedBase}/${normalizedPath}`);
  appendQueryParams(upstream, query);
  return upstream;
}

function buildUpstreamHeaders(req: Request, apiKey: string): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiKey}`);

  const passthroughHeaders = ['content-type', 'accept'] as const;
  for (const headerName of passthroughHeaders) {
    const headerValue = req.header(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  return headers;
}

function resolveUpstreamBody(req: Request): { body?: unknown; stream: boolean } {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return { body: undefined, stream: false };
  }

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    return { body: JSON.stringify(req.body ?? {}), stream: false };
  }

  return { body: req as unknown, stream: true };
}

function copyUpstreamHeaders(upstream: Response, res: ExpressResponse): void {
  for (const [name, value] of upstream.headers.entries()) {
    if (name === 'transfer-encoding' || name === 'content-length' || name === 'connection') {
      continue;
    }
    res.setHeader(name, value);
  }
}

export async function proxyProviderRequest(req: Request, res: ExpressResponse): Promise<void> {
  const { providerId } = req.params as { providerId?: string };
  const pathSuffix = String(req.params[0] ?? '');
  const apiKey = req.header('X-Provider-Api-Key');

  if (!providerId || !providerRegistry.isEnabled(providerId)) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  if (!apiKey) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['X-Provider-Api-Key 不能为空'] });
    return;
  }

  if (!pathSuffix) {
    res.status(422).json({ code: 4001, message: '参数错误', errors: ['代理路径不能为空'] });
    return;
  }

  const baseUrl = resolveProviderBaseUrl(providerId);
  if (!baseUrl) {
    res.status(422).json({ code: 'INVALID_PROVIDER', message: '无效或未启用的服务提供商' });
    return;
  }

  const upstreamUrl = buildUpstreamUrl(baseUrl, pathSuffix, req.query);
  const headers = buildUpstreamHeaders(req, apiKey);
  const bodyState = resolveUpstreamBody(req);

  try {
    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers,
      body: bodyState.body as RequestInit['body'],
    };
    if (bodyState.stream) {
      requestInit.duplex = 'half';
    }

    const upstream = await fetch(upstreamUrl, requestInit);
    copyUpstreamHeaders(upstream, res);

    const payload = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(payload);
  } catch (error) {
    console.error('[ProxyController] 请求转发失败:', (error as Error).message);
    res.status(502).json({ code: 'PROVIDER_UNAVAILABLE', message: 'AI 服务暂时不可用' });
  }
}
