import jwt from 'jsonwebtoken';
import {
  signPrepareToken,
  verifyPrepareToken,
  isPrepareTokenTaskMatch,
  type PrepareTokenPayload,
} from '../services/prepareToken';

describe('prepareToken service', () => {
  const originalSecret = process.env.PREPARE_TOKEN_SECRET;

  beforeEach(() => {
    process.env.PREPARE_TOKEN_SECRET = 'prepare-token-secret-for-tests';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.PREPARE_TOKEN_SECRET;
      return;
    }
    process.env.PREPARE_TOKEN_SECRET = originalSecret;
  });

  it('signs and verifies a prepare token payload', () => {
    const payload: PrepareTokenPayload = {
      userId: 42,
      providerId: 'tripo3d',
      tempTaskId: 'temp:42:1710000000000',
      estimatedPower: 1,
    };

    const token = signPrepareToken(payload);
    const decoded = verifyPrepareToken(token);

    expect(decoded).toEqual(
      expect.objectContaining({
        userId: 42,
        providerId: 'tripo3d',
        tempTaskId: 'temp:42:1710000000000',
        estimatedPower: 1,
      })
    );
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(15 * 60);
  });

  it('rejects an expired prepare token', () => {
    const expiredToken = jwt.sign(
      {
        userId: 1,
        providerId: 'hyper3d',
        tempTaskId: 'temp:1:expired',
        estimatedPower: 1,
      },
      process.env.PREPARE_TOKEN_SECRET!,
      { expiresIn: -1 }
    );

    expect(() => verifyPrepareToken(expiredToken)).toThrow(
      expect.objectContaining({
        code: 'PREPARE_TOKEN_EXPIRED',
        status: 401,
      })
    );
  });

  it('rejects a tampered prepare token', () => {
    const payload: PrepareTokenPayload = {
      userId: 9,
      providerId: 'tripo3d',
      tempTaskId: 'temp:9:1710000000000',
      estimatedPower: 1,
    };
    const token = signPrepareToken(payload);
    const tampered = `${token}tampered`;

    expect(() => verifyPrepareToken(tampered)).toThrow(
      expect.objectContaining({
        code: 'INVALID_PREPARE_TOKEN',
        status: 401,
      })
    );
  });

  it('detects whether a task matches the token temp task id', () => {
    expect(isPrepareTokenTaskMatch('temp:1:123', 'temp:1:123')).toBe(true);
    expect(isPrepareTokenTaskMatch('temp:1:123', 'task-real-001')).toBe(false);
  });
});
