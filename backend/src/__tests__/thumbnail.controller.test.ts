import axios from 'axios';
import type { Response } from 'express';
import { downloadThumbnail } from '../controllers/thumbnail';

const mockQuery = jest.fn();
const mockIsDownloadExpired = jest.fn();

jest.mock('axios');
jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock('../utils/urlExpiry', () => ({
  isDownloadExpired: (...args: unknown[]) => mockIsDownloadExpired(...args),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  } as unknown as Response;
}

describe('thumbnail controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 410 when thumbnail URL is expired', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-004',
        status: 'success',
        thumbnail_url: 'https://cdn.example.com/preview.webp',
        completed_at: '2026-04-08T00:01:00.000Z',
      },
    ]);
    mockIsDownloadExpired.mockReturnValue(true);

    const req = {
      params: { taskId: 'task-004' },
      user: { userId: 1 },
    } as unknown as Parameters<typeof downloadThumbnail>[0];
    const res = createResponse();

    await downloadThumbnail(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(410);
  });

  it('proxies thumbnail image bytes for a valid task thumbnail', async () => {
    const pipe = jest.fn();
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-005',
        status: 'success',
        thumbnail_url: 'https://cdn.example.com/preview.webp',
        completed_at: '2026-04-08T00:01:00.000Z',
      },
    ]);
    mockIsDownloadExpired.mockReturnValue(false);
    mockedAxios.get.mockResolvedValueOnce({
      data: { pipe },
      headers: {
        'content-type': 'image/webp',
        'content-length': '1234',
      },
    } as never);

    const req = {
      params: { taskId: 'task-005' },
      user: { userId: 1 },
    } as unknown as Parameters<typeof downloadThumbnail>[0];
    const res = createResponse();

    await downloadThumbnail(req, res);

    expect(mockedAxios.get).toHaveBeenCalledWith('https://cdn.example.com/preview.webp', {
      responseType: 'stream',
      timeout: 30000,
    });
    expect((res.setHeader as jest.Mock)).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(pipe).toHaveBeenCalledWith(res);
  });
});
