import type { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { auth } from '../middleware/auth';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when upstream says token is invalid', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValue({ response: { status: 401 }, message: 'Unauthorized' });

    const req = {
      headers: { authorization: 'Bearer test-token' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await auth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ code: 1001, message: 'Token 无效或已过期' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 when verify-token dependency is unavailable', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValue({ message: 'timeout', response: undefined });

    const req = {
      headers: { authorization: 'Bearer test-token' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await auth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: '认证服务暂时不可用',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
