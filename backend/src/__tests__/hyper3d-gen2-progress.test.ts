import axios from 'axios';
import * as fc from 'fast-check';
import { Hyper3DAdapter } from '../adapters/Hyper3DAdapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Feature: hyper3d-gen2-upgrade, Hyper3DAdapter.getTaskStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns queued with 0 progress when jobs array is missing', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-queued');

    expect(result).toEqual({
      status: 'queued',
      progress: 0,
    });
  });

  it('returns failed with 0 progress when any sub-job fails', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jobs: [
          { uuid: 'job-1', status: 'Done' },
          { uuid: 'job-2', status: 'Generating' },
          { uuid: 'job-3', status: 'Failed' },
        ],
      },
    } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-failed');

    expect(result).toEqual({
      status: 'failed',
      progress: 0,
      errorMessage: '任务生成失败',
    });
  });

  it('returns processing with percentage derived from done jobs', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        jobs: [
          { uuid: 'job-1', status: 'Done' },
          { uuid: 'job-2', status: 'Done' },
          { uuid: 'job-3', status: 'Generating' },
          { uuid: 'job-4', status: 'Waiting' },
          { uuid: 'job-5', status: 'Waiting' },
          { uuid: 'job-6', status: 'Waiting' },
        ],
      },
    } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-progress');

    expect(result).toEqual({
      status: 'processing',
      progress: 33,
    });
  });

  it('downloads the GLB once all sub-jobs are done', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          jobs: [
            { uuid: 'job-1', status: 'Done' },
            { uuid: 'job-2', status: 'Done' },
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        data: {
          list: [{ name: 'model.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' }],
        },
      } as never);

    const adapter = new Hyper3DAdapter();
    const result = await adapter.getTaskStatus('api-key', 'task-done');

    expect(result).toMatchObject({
      status: 'success',
      progress: 100,
      outputUrl: 'https://cdn.example.com/model.glb',
    });
  });

  it('Property 1: progress equals the Done job ratio when no job has failed', async () => {
    const adapter = new Hyper3DAdapter();

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('Waiting', 'Generating', 'Done'), { minLength: 1, maxLength: 10 }),
        async (statuses) => {
          mockedAxios.post.mockReset();
          mockedAxios.post.mockResolvedValueOnce({
            data: {
              jobs: statuses.map((status, index) => ({
                uuid: `job-${index + 1}`,
                status,
              })),
            },
          } as never);

          if (statuses.every((status) => status === 'Done')) {
            mockedAxios.post.mockResolvedValueOnce({
              data: {
                list: [{ name: 'model.glb', type: 'glb', url: 'https://cdn.example.com/model.glb' }],
              },
            } as never);
          }

          const result = await adapter.getTaskStatus('api-key', 'task-property-progress');
          const doneCount = statuses.filter((status) => status === 'Done').length;
          const expectedProgress = Math.round((doneCount / statuses.length) * 100);

          expect(result.status).toBe(doneCount === statuses.length ? 'success' : 'processing');
          expect(result.progress).toBe(doneCount === statuses.length ? 100 : expectedProgress);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2: any Failed sub-job yields failed status and zero progress', async () => {
    const adapter = new Hyper3DAdapter();

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('Waiting', 'Generating', 'Done', 'Failed'), { minLength: 1, maxLength: 10 }).filter(
          (statuses) => statuses.includes('Failed')
        ),
        async (statuses) => {
          mockedAxios.post.mockReset();
          mockedAxios.post.mockResolvedValueOnce({
            data: {
              jobs: statuses.map((status, index) => ({
                uuid: `job-${index + 1}`,
                status,
              })),
            },
          } as never);

          const result = await adapter.getTaskStatus('api-key', 'task-property-failed');

          expect(result).toEqual({
            status: 'failed',
            progress: 0,
            errorMessage: '任务生成失败',
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
