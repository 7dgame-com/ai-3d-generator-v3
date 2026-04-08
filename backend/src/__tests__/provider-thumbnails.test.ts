import axios from 'axios';
import { Hyper3DAdapter } from '../adapters/Hyper3DAdapter';
import { Tripo3DAdapter } from '../adapters/Tripo3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('provider thumbnail extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('extracts Tripo3D thumbnailUrl from task thumbnail data on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: 'task-tripo-1',
          status: 'success',
          progress: 100,
          thumbnail: 'https://cdn.example.com/thumb.png',
          result: {
            credit_cost: 30,
            pbr_model: {
              url: 'https://cdn.example.com/model.glb',
            },
          },
        },
      }),
    });

    const adapter = new Tripo3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-tripo-1');

    expect(result).toMatchObject({
      status: 'success',
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
    });
  });

  it('returns undefined thumbnailUrl when Tripo3D response has no thumbnail data', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: 'task-tripo-2',
          status: 'success',
          progress: 100,
          result: {
            credit_cost: 30,
            pbr_model: {
              url: 'https://cdn.example.com/model.glb',
            },
          },
        },
      }),
    });

    const adapter = new Tripo3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-tripo-2');

    expect((result as { thumbnailUrl?: string }).thumbnailUrl).toBeUndefined();
  });

  it('keeps polling for Hyper3D when only preview.webp is available', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          jobs: [{ uuid: 'task-hyper-1', status: 'Done' }],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          list: [
            { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
            { name: 'model.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
          ],
        },
      } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-hyper-1');

    expect(result).toEqual({
      status: 'processing',
      progress: 95,
    });
  });

  it('returns undefined thumbnailUrl when Hyper3D download list has no preview asset', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          jobs: [{ uuid: 'task-hyper-2', status: 'Done' }],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          list: [{ name: 'model.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' }],
        },
      } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-hyper-2');

    expect(result.outputUrl).toBe('https://cdn.example.com/model.glb');
    expect((result as { thumbnailUrl?: string }).thumbnailUrl).toBeUndefined();
  });
});
