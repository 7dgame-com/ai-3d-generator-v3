import { Response } from 'express';
import axios from 'axios';
import { query } from '../db/connection';
import { AuthenticatedRequest } from '../middleware/auth';
import { isDownloadExpired } from '../utils/urlExpiry';

interface TaskThumbnailRow {
  task_id: string;
  status: string;
  thumbnail_url: string | null;
  completed_at: string | null;
}

export async function downloadThumbnail(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { taskId } = req.params;
  const userId = req.user.userId;

  const rows = await query<TaskThumbnailRow[]>(
    'SELECT task_id, status, thumbnail_url, completed_at FROM tasks WHERE task_id = ? AND user_id = ?',
    [taskId, userId]
  );

  if (!rows || rows.length === 0) {
    res.status(404).json({ code: 4041, message: '任务不存在' });
    return;
  }

  const task = rows[0];
  if (task.status !== 'success' || !task.thumbnail_url) {
    res.status(404).json({ code: 4042, message: '缩略图不存在' });
    return;
  }

  if (isDownloadExpired(task.thumbnail_url, task.completed_at)) {
    res.status(410).json({ code: 'THUMBNAIL_EXPIRED', message: '缩略图链接已过期' });
    return;
  }

  try {
    const upstream = await axios.get(task.thumbnail_url, {
      responseType: 'stream',
      timeout: 30000,
    });

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/webp');
    const contentLength = upstream.headers['content-length'];
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    upstream.data.pipe(res);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[ThumbnailController] 代理请求失败:', err.message);
      res.status(502).json({ code: 3002, message: 'AI 服务暂时不可用', detail: err.message });
    } else {
      console.error('[ThumbnailController] 未知错误:', String(err));
      res.status(500).json({ code: 5001, message: '服务器内部错误' });
    }
  }
}
