jest.mock('axios');

import axios from 'axios';
import { requestMainBusinessApiGet, resolveMainBusinessApiConfig } from '../config/mainBusinessApi';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('main business api upstream routing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APP_API_1_URL: 'http://primary.example.com',
      APP_API_1_WEIGHT: '60',
      APP_API_2_URL: 'http://secondary.example.com',
      APP_API_2_WEIGHT: '40',
    };
    mockedAxios.get.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses APP_API_N_URL as the active upstream set', () => {
    expect(resolveMainBusinessApiConfig()).toMatchObject({
      mode: 'app-api',
      upstreams: [
        { url: 'http://primary.example.com', weight: 60, envKey: 'APP_API_1_URL' },
        { url: 'http://secondary.example.com', weight: 40, envKey: 'APP_API_2_URL' },
      ],
    });
  });

  it('fails over to the next APP_API upstream on retryable upstream errors', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { id: 24, username: 'demo-user', roles: ['root'] } },
      } as never);

    const result = await requestMainBusinessApiGet('/v1/plugin/verify-token', {
      key: '',
      headers: {
        Authorization: 'Bearer test-token',
      },
    });

    expect(result.response.status).toBe(200);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'http://primary.example.com/v1/plugin/verify-token',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        timeout: 5000,
      })
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'http://secondary.example.com/v1/plugin/verify-token',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        timeout: 5000,
      })
    );
  });

  it('does not fail over when the upstream returns a non-retryable auth error', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403 },
    });

    await expect(
      requestMainBusinessApiGet('/v1/plugin/verify-token', {
        key: '',
        headers: {
          Authorization: 'Bearer test-token',
        },
      })
    ).rejects.toMatchObject({
      response: { status: 403 },
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://primary.example.com/v1/plugin/verify-token',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        timeout: 5000,
      })
    );
  });
});
