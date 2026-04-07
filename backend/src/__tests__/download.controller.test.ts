import type { Response } from 'express';
import { downloadFile } from '../controllers/download';

const mockQuery = jest.fn();

jest.mock('../db/connection', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function createResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  } as unknown as Response;
  return res;
}

describe('download controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 422 for unsupported non-glb formats instead of renaming the same file', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        task_id: 'task-001',
        status: 'success',
        provider_id: 'tripo3d',
        output_url: 'https://example.com/model.glb',
      },
    ]);

    const req = {
      params: { taskId: 'task-001' },
      query: { format: 'fbx' },
      user: { userId: 1 },
    } as unknown as Parameters<typeof downloadFile>[0];
    const res = createResponse();

    await downloadFile(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(422);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      code: 'UNSUPPORTED_DOWNLOAD_FORMAT',
      message: '当前任务仅支持 glb 下载，provider=tripo3d',
    });
  });
});
