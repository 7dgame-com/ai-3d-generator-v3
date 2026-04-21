import fs from 'node:fs';
import path from 'node:path';
import type { Response, NextFunction } from 'express';
import { requireRootUser } from '../middleware/rootOnly';
import type { AuthenticatedRequest } from '../middleware/auth';

function createResponseDouble() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as unknown as jest.Mock).mockReturnValue(res);
  return res;
}

describe('root-only admin access', () => {
  it('rejects non-root users in the root-only middleware', () => {
    const req = {
      user: {
        userId: 9,
        roles: ['admin'],
      },
    } as AuthenticatedRequest;
    const res = createResponseDouble();
    const next = jest.fn() as NextFunction;

    requireRootUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 2003, message: '仅 root 账号可访问此页面' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows root users through the root-only middleware', () => {
    const req = {
      user: {
        userId: 1,
        roles: ['root', 'admin'],
      },
    } as AuthenticatedRequest;
    const res = createResponseDouble();
    const next = jest.fn() as NextFunction;

    requireRootUser(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('wires requireRootUser into both admin route groups', () => {
    const adminRouteSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'admin.ts'),
      'utf8'
    );
    const creditsRouteSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'credits.ts'),
      'utf8'
    );

    expect(adminRouteSource).toContain('requireRootUser');
    expect(adminRouteSource).toContain("router.use('/admin', auth, requireRootUser, adminRouter)");
    expect(adminRouteSource).not.toContain('requirePermission');
    expect(creditsRouteSource).toContain('requireRootUser');
    expect(creditsRouteSource).toContain("router.get('/credits/status', auth, getSitePowerStatusHandler as unknown as RequestHandler);");
    expect(creditsRouteSource).not.toContain('requirePermission');
  });
});
