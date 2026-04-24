import axios from 'axios';
import { Tripo3DAdapter, type RegionResolver } from '../adapters/Tripo3DAdapter';
import { REGION_ENDPOINTS } from '../services/regionProbe';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Tripo3DAdapter construction and endpoint resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
    );
  });

  // --- providerId ---

  it('providerId is always "tripo3d" for region "com"', () => {
    const adapter = new Tripo3DAdapter('com');
    expect(adapter.providerId).toBe('tripo3d');
  });

  it('providerId is always "tripo3d" for region "ai"', () => {
    const adapter = new Tripo3DAdapter('ai');
    expect(adapter.providerId).toBe('tripo3d');
  });

  it('providerId is always "tripo3d" when using default constructor', () => {
    const adapter = new Tripo3DAdapter();
    expect(adapter.providerId).toBe('tripo3d');
  });

  it('providerId is always "tripo3d" when using a RegionResolver', () => {
    const resolver: RegionResolver = async () => 'ai';
    const adapter = new Tripo3DAdapter(resolver);
    expect(adapter.providerId).toBe('tripo3d');
  });

  // --- region "com" → .com endpoint ---

  it('new Tripo3DAdapter("com") uses the .com endpoint', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { code: 0, data: { balance: 100, frozen: 0 } },
    } as never);

    const adapter = new Tripo3DAdapter('com');
    await adapter.getBalance('test-key');

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.com}/user/balance`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
  });

  // --- region "ai" → .ai endpoint ---

  it('new Tripo3DAdapter("ai") uses the .ai endpoint', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { code: 0, data: { balance: 200, frozen: 5 } },
    } as never);

    const adapter = new Tripo3DAdapter('ai');
    await adapter.getBalance('test-key');

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.ai}/user/balance`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
  });

  // --- default constructor → "com" ---

  it('new Tripo3DAdapter() defaults to the .com endpoint', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { code: 0, data: { balance: 50, frozen: 0 } },
    } as never);

    const adapter = new Tripo3DAdapter();
    await adapter.getBalance('test-key');

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.com}/user/balance`,
      expect.any(Object),
    );
  });

  // --- RegionResolver callback ---

  it('uses a RegionResolver callback to dynamically resolve the region', async () => {
    const resolver: RegionResolver = jest.fn(async () => 'ai' as const);

    mockedAxios.get.mockResolvedValue({
      data: { code: 0, data: { balance: 300, frozen: 0 } },
    } as never);

    const adapter = new Tripo3DAdapter(resolver);
    await adapter.getBalance('test-key');

    expect(resolver).toHaveBeenCalled();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.ai}/user/balance`,
      expect.any(Object),
    );
  });

  it('RegionResolver is called on each API invocation (not cached)', async () => {
    let callCount = 0;
    const resolver: RegionResolver = async () => {
      callCount++;
      return callCount === 1 ? 'com' : 'ai';
    };

    mockedAxios.get.mockResolvedValue({
      data: { code: 0, data: { balance: 100, frozen: 0 } },
    } as never);

    const adapter = new Tripo3DAdapter(resolver);

    // First call → resolver returns 'com'
    await adapter.getBalance('test-key');
    expect(mockedAxios.get).toHaveBeenLastCalledWith(
      `${REGION_ENDPOINTS.com}/user/balance`,
      expect.any(Object),
    );

    // Second call → resolver returns 'ai'
    await adapter.getBalance('test-key');
    expect(mockedAxios.get).toHaveBeenLastCalledWith(
      `${REGION_ENDPOINTS.ai}/user/balance`,
      expect.any(Object),
    );

    expect(callCount).toBe(2);
  });

  // --- verifyApiKey also uses the correct endpoint ---

  it('verifyApiKey uses the correct endpoint for region "ai"', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { code: 0 },
    } as never);

    const adapter = new Tripo3DAdapter('ai');
    await adapter.verifyApiKey('test-key');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.ai}/user/balance`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
  });

  it('verifyApiKey uses the correct endpoint for region "com"', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { code: 0 },
    } as never);

    const adapter = new Tripo3DAdapter('com');
    await adapter.verifyApiKey('test-key');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${REGION_ENDPOINTS.com}/user/balance`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property-Based Tests                                              */
/*  Validates: Requirements 2.2, 2.3, 2.7                            */
/* ------------------------------------------------------------------ */

import * as fc from 'fast-check';

describe('Feature: tripo3d-dual-region, Property 4: 区域到端点映射与 providerId 不变性', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Arbitraries                                                     */
  /* ---------------------------------------------------------------- */

  /** The two valid region values. */
  const regionArb = fc.constantFrom('ai' as const, 'com' as const);

  /* ---------------------------------------------------------------- */
  /*  Property: providerId is always 'tripo3d' regardless of region   */
  /* ---------------------------------------------------------------- */

  it('providerId is always "tripo3d" for any valid region', () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const adapter = new Tripo3DAdapter(region);
        expect(adapter.providerId).toBe('tripo3d');
      }),
      { numRuns: 100 },
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Property: baseUrl contains the correct domain for the region    */
  /* ---------------------------------------------------------------- */

  it('uses the endpoint URL matching the region domain', async () => {
    const expectedDomains: Record<'ai' | 'com', string> = {
      ai: 'api.tripo3d.ai',
      com: 'api.tripo3d.com',
    };

    await fc.assert(
      fc.asyncProperty(regionArb, async (region) => {
        mockedAxios.get.mockResolvedValue({
          data: { code: 0, data: { balance: 100, frozen: 0 } },
        } as never);

        const adapter = new Tripo3DAdapter(region);

        // Exercise the adapter to observe which URL it calls
        await adapter.getBalance('test-key');

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        const calledUrl: string = mockedAxios.get.mock.calls[0][0];
        expect(calledUrl).toContain(expectedDomains[region]);

        // Also verify the full REGION_ENDPOINTS mapping is used
        expect(calledUrl).toBe(`${REGION_ENDPOINTS[region]}/user/balance`);

        // Clean up mock call history for next iteration
        mockedAxios.get.mockClear();
      }),
      { numRuns: 100 },
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Property: providerId invariance with RegionResolver callback    */
  /* ---------------------------------------------------------------- */

  it('providerId is always "tripo3d" when using a RegionResolver', () => {
    fc.assert(
      fc.property(regionArb, (region) => {
        const resolver: RegionResolver = async () => region;
        const adapter = new Tripo3DAdapter(resolver);
        expect(adapter.providerId).toBe('tripo3d');
      }),
      { numRuns: 100 },
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Property: RegionResolver also maps to the correct endpoint      */
  /* ---------------------------------------------------------------- */

  it('RegionResolver maps to the correct endpoint URL', async () => {
    const expectedDomains: Record<'ai' | 'com', string> = {
      ai: 'api.tripo3d.ai',
      com: 'api.tripo3d.com',
    };

    await fc.assert(
      fc.asyncProperty(regionArb, async (region) => {
        mockedAxios.get.mockResolvedValue({
          data: { code: 0, data: { balance: 100, frozen: 0 } },
        } as never);

        const resolver: RegionResolver = async () => region;
        const adapter = new Tripo3DAdapter(resolver);

        await adapter.getBalance('test-key');

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        const calledUrl: string = mockedAxios.get.mock.calls[0][0];
        expect(calledUrl).toContain(expectedDomains[region]);
        expect(calledUrl).toBe(`${REGION_ENDPOINTS[region]}/user/balance`);

        mockedAxios.get.mockClear();
      }),
      { numRuns: 100 },
    );
  });
});
