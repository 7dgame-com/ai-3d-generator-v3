import axios from 'axios';
import dns from 'node:dns/promises';
import type { Response } from 'express';
import { downloadFile } from '../controllers/download';

const mockQuery = jest.fn();
const mockIsDownloadExpired = jest.fn();

jest.mock('axios');
jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn(),
  },
}));
jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock('../utils/urlExpiry', () => ({
  isDownloadExpired: (...args: unknown[]) => mockIsDownloadExpired(...args),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLookup = dns.lookup as unknown as jest.Mock;

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  } as unknown as Response;
}

describe('download controller provider proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLookup.mockReset();
  });

  it('proxies provider downloads with IPv4-only stream agents', async () => {
    const pipe = jest.fn();
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-005',
        status: 'success',
        provider_id: 'tripo3d',
        output_url: 'https://cdn.example.com/model.glb',
        completed_at: '2026-04-08T00:01:00.000Z',
      },
    ]);
    mockIsDownloadExpired.mockReturnValue(false);
    mockedLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    mockedAxios.get.mockResolvedValueOnce({
      data: { pipe },
      headers: {
        'content-length': '1234',
      },
    } as never);

    const req = {
      params: { taskId: 'task-005' },
      query: {},
      user: { userId: 1 },
    } as unknown as Parameters<typeof downloadFile>[0];
    const res = createResponse();

    await downloadFile(req, res);

    expect(mockedAxios.get).toHaveBeenCalledWith('https://cdn.example.com/model.glb', {
      responseType: 'stream',
      timeout: 30000,
      httpAgent: expect.anything(),
      httpsAgent: expect.anything(),
      proxy: false,
      maxRedirects: 0,
    });
    expect((res.setHeader as jest.Mock)).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="task-005.glb"'
    );
    expect(pipe).toHaveBeenCalledWith(res);
  });
});
