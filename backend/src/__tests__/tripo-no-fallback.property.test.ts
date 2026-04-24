import * as fc from 'fast-check';
import axios from 'axios';
import { Tripo3DAdapter } from '../adapters/Tripo3DAdapter';
import { REGION_ENDPOINTS, type TripoRegion } from '../services/regionProbe';

/**
 * **Validates: Requirements 2.4, 2.5**
 *
 * Property 5: 单一端点，无跨域名 fallback
 *
 * For any API method call (createTask, getTaskStatus, getBalance, verifyApiKey),
 * regardless of success or failure, Tripo3DAdapter SHALL only send requests to
 * the single endpoint corresponding to the configured region — never to the
 * other region's domain.
 */

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/* ------------------------------------------------------------------ */
/*  Domain helpers                                                    */
/* ------------------------------------------------------------------ */

const DOMAIN_MAP: Record<TripoRegion, string> = {
  ai: 'api.tripo3d.ai',
  com: 'api.tripo3d.com',
};

function otherRegion(region: TripoRegion): TripoRegion {
  return region === 'ai' ? 'com' : 'ai';
}

/* ------------------------------------------------------------------ */
/*  Tracked fetch mock — records all URLs called via global.fetch     */
/* ------------------------------------------------------------------ */

let fetchCalledUrls: string[] = [];
const originalFetch = global.fetch;

function installFetchMock(shouldSucceed: boolean): void {
  fetchCalledUrls = [];
  global.fetch = jest.fn().mockImplementation((url: string) => {
    fetchCalledUrls.push(url);
    if (shouldSucceed) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            code: 0,
            data: {
              task_id: 'task-123',
              status: 'success',
              progress: 100,
              output: { model: 'https://example.com/model.glb' },
            },
          }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ code: -1, message: 'Server error' }),
    });
  });
}

function restoreFetch(): void {
  global.fetch = originalFetch;
  fetchCalledUrls = [];
}

/* ------------------------------------------------------------------ */
/*  Tracked axios mock — records all URLs called via axios            */
/* ------------------------------------------------------------------ */

let axiosCalledUrls: string[] = [];

function installAxiosMock(shouldSucceed: boolean): void {
  axiosCalledUrls = [];

  mockedAxios.isAxiosError.mockImplementation(
    (error) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  );

  const successHandler = (url: string) => {
    axiosCalledUrls.push(url);
    return Promise.resolve({
      data: { code: 0, data: { balance: 100, frozen: 0, task_id: 'task-abc' } },
    });
  };

  const failureHandler = (url: string) => {
    axiosCalledUrls.push(url);
    const err = Object.assign(new Error('Network Error'), {
      isAxiosError: true,
      response: { status: 500, data: { message: 'Server error' } },
      code: 'ERR_NETWORK',
    });
    return Promise.reject(err);
  };

  const handler = shouldSucceed ? successHandler : failureHandler;

  mockedAxios.get.mockImplementation(handler as unknown as typeof mockedAxios.get);
  mockedAxios.post.mockImplementation(handler as unknown as typeof mockedAxios.post);
}

function clearAxiosMock(): void {
  axiosCalledUrls = [];
  mockedAxios.get.mockReset();
  mockedAxios.post.mockReset();
}

/* ------------------------------------------------------------------ */
/*  Collect all URLs called across both HTTP clients                  */
/* ------------------------------------------------------------------ */

function getAllCalledUrls(): string[] {
  return [...axiosCalledUrls, ...fetchCalledUrls];
}

/* ------------------------------------------------------------------ */
/*  API method exercisers                                             */
/* ------------------------------------------------------------------ */

type ApiMethodName = 'verifyApiKey' | 'getBalance' | 'getTaskStatus' | 'createTask';

/**
 * Calls the specified adapter method, swallowing any errors (we only
 * care about which URLs were contacted, not whether the call succeeded).
 */
async function exerciseMethod(
  adapter: Tripo3DAdapter,
  method: ApiMethodName,
  apiKey: string,
): Promise<void> {
  try {
    switch (method) {
      case 'verifyApiKey':
        await adapter.verifyApiKey(apiKey);
        break;
      case 'getBalance':
        await adapter.getBalance(apiKey);
        break;
      case 'getTaskStatus':
        await adapter.getTaskStatus(apiKey, 'task-id-123');
        break;
      case 'createTask':
        await adapter.createTask(apiKey, {
          type: 'text_to_model',
          prompt: 'a red chair',
        });
        break;
    }
  } catch {
    // Intentionally swallowed — we only inspect called URLs
  }
}

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const regionArb = fc.constantFrom<TripoRegion>('ai', 'com');
const apiKeyArb = fc.string({ minLength: 1, maxLength: 64 });
const methodArb = fc.constantFrom<ApiMethodName>(
  'verifyApiKey',
  'getBalance',
  'getTaskStatus',
  'createTask',
);
const outcomeArb = fc.constantFrom(true, false); // success or failure

/* ------------------------------------------------------------------ */
/*  Property tests                                                    */
/* ------------------------------------------------------------------ */

describe('Feature: tripo3d-dual-region, Property 5: 单一端点无跨域名 fallback', () => {
  afterEach(() => {
    restoreFetch();
    clearAxiosMock();
  });

  it(
    'every API method only contacts the configured region endpoint, never the other domain',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          regionArb,
          apiKeyArb,
          methodArb,
          outcomeArb,
          async (region, apiKey, method, shouldSucceed) => {
            // Arrange
            installAxiosMock(shouldSucceed);
            installFetchMock(shouldSucceed);

            const adapter = new Tripo3DAdapter(region);

            // Act
            await exerciseMethod(adapter, method, apiKey);

            // Assert — at least one URL was called
            const calledUrls = getAllCalledUrls();
            expect(calledUrls.length).toBeGreaterThanOrEqual(1);

            const expectedDomain = DOMAIN_MAP[region];
            const forbiddenDomain = DOMAIN_MAP[otherRegion(region)];

            // Every called URL must contain the configured region's domain
            for (const url of calledUrls) {
              expect(url).toContain(expectedDomain);
            }

            // No called URL may contain the other region's domain
            for (const url of calledUrls) {
              expect(url).not.toContain(forbiddenDomain);
            }

            // Cleanup for next iteration
            restoreFetch();
            clearAxiosMock();
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'on failure, no fallback attempt is made to the other domain (mock call count is exactly 1)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          regionArb,
          apiKeyArb,
          methodArb,
          async (region, apiKey, method) => {
            // Arrange — always fail
            installAxiosMock(false);
            installFetchMock(false);

            const adapter = new Tripo3DAdapter(region);

            // Act
            await exerciseMethod(adapter, method, apiKey);

            // Assert — exactly one HTTP call was made (no retry to other domain)
            const calledUrls = getAllCalledUrls();
            expect(calledUrls).toHaveLength(1);

            // And that single call targeted the correct domain
            expect(calledUrls[0]).toContain(DOMAIN_MAP[region]);

            // Cleanup for next iteration
            restoreFetch();
            clearAxiosMock();
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
