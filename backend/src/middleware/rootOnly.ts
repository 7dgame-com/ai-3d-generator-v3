import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';

export function requireRootUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authReq = req as AuthenticatedRequest;
  const roles = Array.isArray(authReq.user?.roles) ? authReq.user.roles : [];

  if (!roles.includes('root')) {
    res.status(403).json({ code: 2003, message: '仅 root 账号可访问此页面' });
    return;
  }

  next();
}
