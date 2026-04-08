import axios from 'axios';
import * as fc from 'fast-check';
import { Hyper3DAdapter } from '../adapters/Hyper3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

type DownloadItem = { name?: string; filename?: string; type?: string; url?: string };

function mockStatusAndDownload(jobs: Array<{ uuid: string; status: string }>, downloadList?: DownloadItem[]): void {
  mockedAxios.post.mockResolvedValueOnce({
    data: {
      jobs,
    },
  } as never);

  if (downloadList) {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        list: downloadList,
      },
    } as never);
  }
}

describe('Preservation: Hyper3D status handling', () => {
  const adapter = new Hyper3DAdapter();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves processing=90 when all jobs are done but the glb is still unavailable', async () => {
    mockStatusAndDownload(
      [{ uuid: 'job-1', status: 'Done' }],
      [{ name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' }]
    );

    const result = await adapter.getTaskStatus('api-key', 'task-missing-glb');

    expect(result).toEqual({
      status: 'processing',
      progress: 90,
    });
  });

  it('preserves success with undefined thumbnailUrl when no thumbnail assets exist', async () => {
    mockStatusAndDownload(
      [{ uuid: 'job-1', status: 'Done' }],
      [{ name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' }]
    );

    const result = await adapter.getTaskStatus('api-key', 'task-no-thumbnails');

    expect(result).toMatchObject({
      status: 'success',
      progress: 100,
      outputUrl: 'https://cdn.example.com/model.glb',
    });
    expect(result.thumbnailUrl).toBeUndefined();
  });

  it('preserves queued when jobs are empty', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { jobs: [] } } as never);

    const result = await adapter.getTaskStatus('api-key', 'task-empty-jobs');

    expect(result).toEqual({
      status: 'queued',
      progress: 0,
    });
  });

  it('preserves failed when any sub-job fails', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jobs: [
          { uuid: 'job-1', status: 'Done' },
          { uuid: 'job-2', status: 'Failed' },
        ],
      },
    } as never);

    const result = await adapter.getTaskStatus('api-key', 'task-failed');

    expect(result).toEqual({
      status: 'failed',
      progress: 0,
      errorMessage: '任务生成失败',
    });
  });

  it('Property 2A: done jobs without a glb keep polling at 90%', async () => {
    const baseItems: DownloadItem[] = [
      { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
      { name: 'render.jpg', url: 'https://cdn.example.com/render.jpg' },
      { name: 'notes.txt', url: 'https://cdn.example.com/notes.txt' },
      { name: 'wireframe.obj', url: 'https://cdn.example.com/wireframe.obj' },
    ];

    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(baseItems, { minLength: 0, maxLength: baseItems.length }), async (list) => {
        const hasGlb = list.some((item) => item.type === 'glb' || item.name?.endsWith('.glb'));
        fc.pre(!hasGlb);

        mockedAxios.post.mockReset();
        mockStatusAndDownload([{ uuid: 'job-1', status: 'Done' }], list);

        const result = await adapter.getTaskStatus('api-key', 'task-property-missing-glb');

        expect(result).toEqual({
          status: 'processing',
          progress: 90,
        });
      }),
      { numRuns: 50 }
    );
  });

  it('Property 2B: no render.jpg and no preview.webp preserves undefined thumbnailUrl', async () => {
    const baseItems: DownloadItem[] = [
      { name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
      { name: 'albedo.png', url: 'https://cdn.example.com/albedo.png' },
      { name: 'notes.txt', url: 'https://cdn.example.com/notes.txt' },
      { name: 'wireframe.obj', url: 'https://cdn.example.com/wireframe.obj' },
    ];

    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(baseItems, { minLength: 1, maxLength: baseItems.length }), async (list) => {
        const hasGlb = list.some((item) => item.type === 'glb' || item.name?.endsWith('.glb'));
        const hasRender = list.some((item) => item.name === 'render.jpg' || item.filename === 'render.jpg');
        const hasPreview = list.some((item) => item.name?.includes('preview.webp') || item.url?.includes('preview.webp'));
        fc.pre(hasGlb && !hasRender && !hasPreview);

        mockedAxios.post.mockReset();
        mockStatusAndDownload([{ uuid: 'job-1', status: 'Done' }], list);

        const result = await adapter.getTaskStatus('api-key', 'task-property-no-thumbnail-assets');

        expect(result).toMatchObject({
          status: 'success',
          progress: 100,
          outputUrl: 'https://cdn.example.com/model.glb',
        });
        expect(result.thumbnailUrl).toBeUndefined();
      }),
      { numRuns: 50 }
    );
  });
});
