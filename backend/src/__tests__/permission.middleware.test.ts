import type { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { requirePermission } from '../middleware/permission';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('permission middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 when upstream denies permission', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValue({ response: { status: 403 }, message: 'Forbidden' });

    const middleware = requirePermission('admin-config');
    const req = {
      headers: { authorization: 'Bearer test-token' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(403);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ code: 2003, message: '没有权限执行此操作' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 when permission service is unavailable', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValue({ message: 'timeout', response: undefined });

    const middleware = requirePermission('generate-model');
    const req = {
      headers: { authorization: 'Bearer test-token' },
    } as unknown as Request;
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      code: 'PERMISSION_SERVICE_UNAVAILABLE',
      message: '权限服务暂时不可用',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
