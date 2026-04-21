import axios from 'axios';
import { Tripo3DAdapter } from '../adapters/Tripo3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Tripo3DAdapter image upload flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads image_to_model input as multipart form and creates task with image file type', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          data: {
            image_token: 'img-token-001',
          },
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            task_id: 'task-001',
          },
        },
      } as never);

    const adapter = new Tripo3DAdapter();
    const result = await adapter.createTask('api-key', {
      type: 'image_to_model',
      imageBase64: 'ZmFrZS1pbWFnZQ==',
      mimeType: 'image/png',
    });

    expect(result.taskId).toBe('task-001');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    const [uploadUrl, uploadBody, uploadConfig] = mockedAxios.post.mock.calls[0] ?? [];
    expect(uploadUrl).toBe('https://api.tripo3d.com/v2/openapi/upload');
    expect(typeof (uploadBody as { getHeaders?: () => Record<string, string> })?.getHeaders).toBe('function');
    expect(uploadConfig?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer api-key',
      })
    );
    expect(String(uploadConfig?.headers?.['Content-Type'] ?? '')).not.toContain('application/json');

    const [, createBody] = mockedAxios.post.mock.calls[1] ?? [];
    expect(createBody).toEqual(
      expect.objectContaining({
        type: 'image_to_model',
        file: expect.objectContaining({
          type: 'image',
          file_token: 'img-token-001',
        }),
      })
    );
  });
});
