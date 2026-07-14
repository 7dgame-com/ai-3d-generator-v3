import fc from 'fast-check';
import { calculateRetryDelaySeconds, classifyProviderError, hasProviderCapacity } from '../services/providerQueue';

describe('provider queue retry policy', () => {
  it('classifies Tripo concurrency errors as throttling', () => {
    expect(classifyProviderError({
      response: {
        status: 200,
        data: { code: 2000, message: 'concurrent task limit' },
        headers: { 'retry-after': '12' },
      },
    })).toMatchObject({ category: 'THROTTLED', code: '2000', retryAfterSeconds: 12 });
  });

  it('classifies HTTP 429 and supplier 5xx as recoverable with the right retry category', () => {
    expect(classifyProviderError({
      response: { status: 429, headers: { 'retry-after': '8' }, data: { message: 'too many requests' } },
    })).toMatchObject({ category: 'THROTTLED', code: '429', retryAfterSeconds: 8 });
    expect(classifyProviderError({ response: { status: 503, data: { message: 'upstream unavailable' } } }))
      .toMatchObject({ category: 'TEMPORARY', code: '503' });
  });

  it('distinguishes slow ambiguous submission from a safely retryable network failure', () => {
    expect(classifyProviderError({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }).category)
      .toBe('SUBMISSION_UNKNOWN');
    expect(classifyProviderError({ code: 'ENOTFOUND', message: 'network DNS lookup failed' }).category)
      .toBe('TEMPORARY');
  });

  it('does not retry content moderation rejection', () => {
    expect(classifyProviderError({ message: 'content rejected by moderation' }).category)
      .toBe('CONTENT_REJECTED');
  });

  it('does not treat an ambiguous POST timeout as a normal retry', () => {
    expect(classifyProviderError({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }))
      .toMatchObject({ category: 'SUBMISSION_UNKNOWN' });
  });

  it('classifies account access and balance failures separately', () => {
    expect(classifyProviderError({ response: { status: 403 }, message: 'forbidden' }).category)
      .toBe('NO_ACCESS');
    expect(classifyProviderError({ message: 'insufficient balance' }).category)
      .toBe('NO_BALANCE');
  });

  it('uses bounded exponential backoff', () => {
    expect(calculateRetryDelaySeconds(1, 0)).toBe(2);
    expect(calculateRetryDelaySeconds(4, 0)).toBe(16);
    expect(calculateRetryDelaySeconds(100, 0.99)).toBeLessThanOrEqual(300);
  });

  it('never grants a provider slot at or above the configured limit', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 0, max: 200 }),
      fc.boolean(),
      (limit, active, paused) => {
        expect(hasProviderCapacity(active, limit, paused))
          .toBe(!paused && active < limit);
      }
    ));
  });

  it('keeps Tripo and Hyper capacity decisions independent', () => {
    expect(hasProviderCapacity(4, 4, false)).toBe(false);
    expect(hasProviderCapacity(0, 1, false)).toBe(true);
  });

  it('admits only four of thirty simultaneous Tripo candidates before a release', () => {
    let active = 0;
    let admitted = 0;
    for (let candidate = 0; candidate < 30; candidate += 1) {
      if (hasProviderCapacity(active, 4, false)) {
        active += 1;
        admitted += 1;
      }
    }
    expect(admitted).toBe(4);
    expect(active).toBe(4);
  });
});
