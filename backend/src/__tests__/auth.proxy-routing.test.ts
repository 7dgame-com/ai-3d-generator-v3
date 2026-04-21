import type { NextFunction, Request, Response } from 'express';

const mockAxiosGet = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  },
}));

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  return res;
}

describe('auth middleware main backend wiring', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAxiosGet.mockReset();
    delete process.env.APP_API_1_URL;
    delete process.env.APP_API_1_WEIGHT;
    delete process.env.APP_API_2_URL;
    delete process.env.APP_API_2_WEIGHT;
  });

  it('prefers APP_API_N_URL when forwarding verify-token requests', async () => {
    process.env.APP_API_1_URL = 'http://primary-api.internal:8081';
    process.env.APP_API_1_WEIGHT = '100';
    mockAxiosGet.mockResolvedValue({
      data: {
        data: {
          id: 24,
          username: 'demo-user',
          roles: ['root'],
        },
      },
    });

    const { auth } = await import('../middleware/auth');
    const req = {
      headers: {
        authorization: 'Bearer test-token',
      },
    } as unknown as Request & { user?: { userId: number; username?: string; roles?: string[] } };
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await auth(req, res, next);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'http://primary-api.internal:8081/v1/plugin/verify-token',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        timeout: 5000,
      })
    );
    expect(req.user).toEqual(
      expect.objectContaining({
        userId: 24,
        username: 'demo-user',
        roles: ['root'],
      })
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('translates upstream auth failures into a 401 response', async () => {
    mockAxiosGet.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403 },
    });

    const { auth } = await import('../middleware/auth');
    const req = {
      headers: {
        authorization: 'Bearer test-token',
      },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await auth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 1001, message: 'Token 无效或已过期' });
  });

  it('falls back to the default APP_API_1_URL when APP_API_N_URL is absent', async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        data: {
          id: 25,
          username: 'fallback-user',
          roles: ['user'],
        },
      },
    });

    const { auth } = await import('../middleware/auth');
    const req = {
      headers: {
        authorization: 'Bearer test-token',
      },
    } as unknown as Request & { user?: { userId: number; username?: string; roles?: string[] } };
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await auth(req, res, next);

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'http://localhost:8081/v1/plugin/verify-token',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        timeout: 5000,
      })
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
