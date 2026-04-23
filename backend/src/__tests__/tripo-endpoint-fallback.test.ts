import axios from 'axios';
import { Tripo3DAdapter } from '../adapters/Tripo3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function timeoutAxiosError(message = 'timeout') {
  return {
    isAxiosError: true,
    code: 'ETIMEDOUT',
    message,
  };
}

function statusAxiosError(status: number, message = `HTTP ${status}`) {
  return {
    isAxiosError: true,
    message,
    response: {
      status,
    },
  };
}

function jsonFetchResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

describe('Tripo3DAdapter endpoint fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
    mockedAxios.isAxiosError.mockImplementation((error) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError));
    global.fetch = jest.fn();
  });

  it('falls back to the secondary Tripo base when verifyApiKey times out on the primary base', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(timeoutAxiosError())
      .mockResolvedValueOnce({ data: { code: 0 } } as never);

    const adapter = new Tripo3DAdapter();

    await expect(adapter.verifyApiKey('api-key')).resolves.toBeUndefined();

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.tripo3d.com/v2/openapi/user/balance',
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key' },
      })
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.tripo3d.ai/v2/openapi/user/balance',
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key' },
      })
    );
  });

  it('falls back to the secondary Tripo base when verifyApiKey gets a 401 on the primary base', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(statusAxiosError(401, 'Authentication failed'))
      .mockResolvedValueOnce({ data: { code: 0 } } as never);

    const adapter = new Tripo3DAdapter();

    await expect(adapter.verifyApiKey('api-key')).resolves.toBeUndefined();

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.tripo3d.com/v2/openapi/user/balance',
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key' },
      })
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.tripo3d.ai/v2/openapi/user/balance',
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key' },
      })
    );
  });

  it('falls back to the secondary Tripo base when getBalance times out on the primary base', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(timeoutAxiosError())
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            balance: 88,
            frozen: 5,
          },
        },
      } as never);

    const adapter = new Tripo3DAdapter();
    const balance = await adapter.getBalance('api-key');

    expect(balance).toEqual({
      available: 88,
      frozen: 5,
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.tripo3d.com/v2/openapi/user/balance',
      expect.any(Object)
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.tripo3d.ai/v2/openapi/user/balance',
      expect.any(Object)
    );
  });

  it('falls back to the secondary Tripo base when getBalance gets a 401 on the primary base', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(statusAxiosError(401, 'Authentication failed'))
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            balance: 500,
            frozen: 0,
          },
        },
      } as never);

    const adapter = new Tripo3DAdapter();
    const balance = await adapter.getBalance('api-key');

    expect(balance).toEqual({
      available: 500,
      frozen: 0,
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.tripo3d.com/v2/openapi/user/balance',
      expect.any(Object)
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.tripo3d.ai/v2/openapi/user/balance',
      expect.any(Object)
    );
  });

  it('retries the image upload flow against the secondary base and returns a polling key hint for it', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(timeoutAxiosError())
      .mockResolvedValueOnce({
        data: {
          data: {
            image_token: 'img-token-002',
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            task_id: 'task-002',
          },
        },
      } as never);

    const adapter = new Tripo3DAdapter();
    const result = await adapter.createTask('api-key', {
      type: 'image_to_model',
      imageBase64: 'ZmFrZS1pbWFnZQ==',
      mimeType: 'image/png',
    });

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      'https://api.tripo3d.com/v2/openapi/upload',
      expect.anything(),
      expect.any(Object)
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.tripo3d.ai/v2/openapi/upload',
      expect.anything(),
      expect.any(Object)
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      3,
      'https://api.tripo3d.ai/v2/openapi/task',
      expect.objectContaining({
        type: 'image_to_model',
      }),
      expect.any(Object)
    );
    expect(result).toEqual({
      taskId: 'task-002',
      pollingKey: 'tripo-base:https://api.tripo3d.ai/v2/openapi',
      estimatedCost: 30,
    });
  });

  it('uses the polling key base hint when checking task status', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonFetchResponse({
        code: 0,
        data: {
          task_id: 'task-003',
          status: 'success',
          progress: 100,
          result: {
            credit_cost: 30,
            pbr_model: {
              url: 'https://cdn.example.com/model.glb',
            },
          },
        },
      })
    );

    const adapter = new Tripo3DAdapter() as Tripo3DAdapter & {
      getTaskStatus(apiKey: string, taskId: string, pollingKey?: string): ReturnType<Tripo3DAdapter['getTaskStatus']>;
    };
    const result = await adapter.getTaskStatus(
      'api-key',
      'task-003',
      'tripo-base:https://api.tripo3d.com/v2/openapi'
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tripo3d.com/v2/openapi/task/task-003',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer api-key',
          'Content-Type': 'application/json',
        },
      })
    );
    expect(result).toMatchObject({
      status: 'success',
      outputUrl: 'https://cdn.example.com/model.glb',
      creditCost: 30,
    });
  });
});
