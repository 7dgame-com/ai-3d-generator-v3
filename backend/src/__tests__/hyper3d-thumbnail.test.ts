import axios from 'axios';
import * as fc from 'fast-check';
import { Hyper3DAdapter } from '../adapters/Hyper3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

type DownloadItem = { name?: string; filename?: string; type?: string; url?: string };

function mockCompletedTask(downloadList: DownloadItem[]): void {
  mockedAxios.post
    .mockResolvedValueOnce({
      data: {
        jobs: [{ uuid: 'job-1', status: 'Done' }],
      },
    } as never)
    .mockResolvedValueOnce({
      data: {
        list: downloadList,
      },
    } as never);
}

describe('Bug condition: Hyper3D thumbnail selection', () => {
  const adapter = new Hyper3DAdapter();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects render.jpg when both render.jpg and preview.webp exist', async () => {
    mockCompletedTask([
      { name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
      { name: 'render.jpg', url: 'https://cdn.example.com/render.jpg' },
      { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
    ]);

    const result = await adapter.getTaskStatus('api-key', 'task-hyper-render-ready');

    expect(result).toMatchObject({
      status: 'success',
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/render.jpg',
    });
  });

  it('keeps polling when glb is ready and only preview.webp is available', async () => {
    mockCompletedTask([
      { name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
      { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
    ]);

    const result = await adapter.getTaskStatus('api-key', 'task-hyper-render-pending');

    expect(result).toEqual({
      status: 'processing',
      progress: 95,
    });
  });

  it('Property 1A: render.jpg always wins when render and glb are both present', async () => {
    const baseItems: DownloadItem[] = [
      { name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
      { name: 'render.jpg', url: 'https://cdn.example.com/render.jpg' },
      { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
      { name: 'albedo.png', url: 'https://cdn.example.com/albedo.png' },
      { name: 'notes.txt', url: 'https://cdn.example.com/notes.txt' },
      { name: 'wireframe.obj', url: 'https://cdn.example.com/wireframe.obj' },
    ];

    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(baseItems, { minLength: 3, maxLength: baseItems.length }), async (list) => {
        const hasGlb = list.some((item) => item.type === 'glb' || item.name?.endsWith('.glb'));
        const hasRender = list.some((item) => item.name === 'render.jpg' || item.filename === 'render.jpg');

        fc.pre(hasGlb && hasRender);

        mockedAxios.post.mockReset();
        mockCompletedTask(list);

        const result = await adapter.getTaskStatus(
          'api-key',
          `task-hyper-property-render-ready-${Math.random().toString(36).slice(2)}`
        );

        expect(result.status).toBe('success');
        expect(result.outputUrl).toBe('https://cdn.example.com/model.glb');
        expect(result.thumbnailUrl).toBe('https://cdn.example.com/render.jpg');
      }),
      { numRuns: 50 }
    );
  });

  it('Property 1B: keeps polling when preview.webp exists but render.jpg is still missing', async () => {
    const baseItems: DownloadItem[] = [
      { name: 'base_basic_pbr.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' },
      { name: 'preview.webp', url: 'https://cdn.example.com/preview.webp' },
      { name: 'albedo.png', url: 'https://cdn.example.com/albedo.png' },
      { name: 'notes.txt', url: 'https://cdn.example.com/notes.txt' },
      { name: 'wireframe.obj', url: 'https://cdn.example.com/wireframe.obj' },
    ];

    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(baseItems, { minLength: 2, maxLength: baseItems.length }), async (list) => {
        const hasGlb = list.some((item) => item.type === 'glb' || item.name?.endsWith('.glb'));
        const hasPreview = list.some((item) => item.name?.includes('preview.webp') || item.url?.includes('preview.webp'));
        const hasRender = list.some((item) => item.name === 'render.jpg' || item.filename === 'render.jpg');

        fc.pre(hasGlb && hasPreview && !hasRender);

        mockedAxios.post.mockReset();
        mockCompletedTask(list);

        const result = await adapter.getTaskStatus(
          'api-key',
          `task-hyper-property-render-pending-${Math.random().toString(36).slice(2)}`
        );

        expect(result).toEqual({
          status: 'processing',
          progress: 95,
        });
      }),
      { numRuns: 50 }
    );
  });
});
