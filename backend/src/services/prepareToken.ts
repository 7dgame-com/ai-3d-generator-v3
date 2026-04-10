import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

export interface PrepareTokenPayload {
  userId: number;
  providerId: string;
  tempTaskId: string;
  estimatedPower: number;
}

export interface VerifiedPrepareTokenPayload extends PrepareTokenPayload {
  iat: number;
  exp: number;
}

function getPrepareTokenSecret(): string {
  const secret = process.env.PREPARE_TOKEN_SECRET;
  if (!secret) {
    throw new Error('PREPARE_TOKEN_SECRET environment variable is not set');
  }
  return secret;
}

export function signPrepareToken(payload: PrepareTokenPayload): string {
  return jwt.sign(payload, getPrepareTokenSecret(), { expiresIn: '15m' });
}

export function verifyPrepareToken(token: string): VerifiedPrepareTokenPayload {
  try {
    return jwt.verify(token, getPrepareTokenSecret()) as VerifiedPrepareTokenPayload;
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw Object.assign(new Error('prepareToken 已过期'), {
        code: 'PREPARE_TOKEN_EXPIRED',
        status: 401,
      });
    }

    if (error instanceof JsonWebTokenError) {
      throw Object.assign(new Error('prepareToken 无效'), {
        code: 'INVALID_PREPARE_TOKEN',
        status: 401,
      });
    }

    throw error;
  }
}

export function isPrepareTokenTaskMatch(tempTaskId: string, ledgerTaskId: string): boolean {
  return tempTaskId === ledgerTaskId;
}
