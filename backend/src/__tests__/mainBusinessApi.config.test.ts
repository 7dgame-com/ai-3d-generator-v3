describe('main business proxy naming', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.APP_API_1_URL;
    delete process.env.APP_API_1_WEIGHT;
    delete process.env.APP_API_2_URL;
    delete process.env.APP_API_2_WEIGHT;
  });

  it('prefers APP_API_N_URL over legacy main business proxy settings', async () => {
    process.env.APP_API_1_URL = 'http://primary-api.internal:8081/';
    process.env.APP_API_1_WEIGHT = '60';
    process.env.APP_API_2_URL = 'http://backup-api.internal:8081/';
    process.env.APP_API_2_WEIGHT = '40';

    const { getMainBusinessApiBaseUrl, buildMainBusinessApiUrl, resolveMainBusinessApiConfig } = await import('../config/mainBusinessApi');

    expect(resolveMainBusinessApiConfig()).toMatchObject({
      mode: 'app-api',
      upstreams: [
        { url: 'http://primary-api.internal:8081', weight: 60, envKey: 'APP_API_1_URL' },
        { url: 'http://backup-api.internal:8081', weight: 40, envKey: 'APP_API_2_URL' },
      ],
    });
    expect(getMainBusinessApiBaseUrl()).toBe('http://primary-api.internal:8081');
    expect(buildMainBusinessApiUrl('/v1/files')).toBe('http://primary-api.internal:8081/v1/files');
  });

  it('falls back to the default APP_API_1_URL when APP_API_N_URL is absent', async () => {
    const { getMainBusinessApiBaseUrl, buildMainBusinessApiUrl, resolveMainBusinessApiConfig } = await import('../config/mainBusinessApi');

    expect(resolveMainBusinessApiConfig()).toMatchObject({
      mode: 'app-api',
      upstreams: [
        { url: 'http://localhost:8081', weight: 1, envKey: 'APP_API_1_URL' },
      ],
    });
    expect(getMainBusinessApiBaseUrl()).toBe('http://localhost:8081');
    expect(buildMainBusinessApiUrl('/v1/resources')).toBe('http://localhost:8081/v1/resources');
  });
});
