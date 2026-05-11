/**
 * DownloadController
 *
 * GET /api/download/:taskId
 *   - 从 tasks 表获取 output_url
 *   - 代理请求文件流，以 {task_id}.{format} 命名返回给客户端
 *   - 当前仅支持 glb；其他格式会明确返回 422
 *   - 完成超过 24 小时的任务视为过期，返回 410 Gone
 */

import { Response } from 'express';
import axios from 'axios';
import dns from 'node:dns/promises';
import net from 'node:net';
import { query } from '../db/connection';
import { AuthenticatedRequest } from '../middleware/auth';
import { isDownloadExpired } from '../utils/urlExpiry';

type DownloadFormat = 'glb' | 'fbx' | 'obj';
const ALLOWED_FORMATS: DownloadFormat[] = ['glb', 'fbx', 'obj'];

interface TaskRow {
  task_id: string;
  status: string;
  provider_id: string;
  output_url: string | null;
  completed_at: string | null;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map((p) => Number(p));
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

export async function isSafeDownloadUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  if (net.isIP(parsed.hostname)) {
    if (parsed.hostname.includes(':')) {
      return !isPrivateIPv6(parsed.hostname);
    }
    return !isPrivateIPv4(parsed.hostname);
  }

  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    if (records.length === 0) {
      return false;
    }
    return records.every((record) => {
      if (record.family === 6) return !isPrivateIPv6(record.address);
      return !isPrivateIPv4(record.address);
    });
  } catch {
    return false;
  }
}

/**
 * GET /api/download/:taskId
 * 代理下载输出文件
 */
export async function downloadFile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { taskId } = req.params;
  const userId = req.user.userId;

  const rawFormat = (req.query.format as string) || 'glb';
  const format: DownloadFormat = ALLOWED_FORMATS.includes(rawFormat as DownloadFormat)
    ? (rawFormat as DownloadFormat)
    : 'glb';

  const rows = await query<TaskRow[]>(
    'SELECT task_id, status, provider_id, output_url, completed_at FROM tasks WHERE task_id = ? AND user_id = ?',
    [taskId, userId]
  );

  if (!rows || rows.length === 0) {
    res.status(404).json({ code: 4041, message: '任务不存在' });
    return;
  }

  const task = rows[0];

  if (task.status !== 'success') {
    res.status(400).json({ code: 4001, message: '任务尚未完成' });
    return;
  }

  if (!task.output_url) {
    res.status(404).json({ code: 4042, message: '输出文件不存在' });
    return;
  }

  // 检查是否过期（从 URL 签名解析精确过期时间）
  if (isDownloadExpired(task.output_url, task.completed_at)) {
    res.status(410).json({ code: 'DOWNLOAD_EXPIRED', message: '下载链接已过期' });
    return;
  }

  if (format !== 'glb') {
    res.status(422).json({
      code: 'UNSUPPORTED_DOWNLOAD_FORMAT',
      message: `当前任务仅支持 glb 下载，provider=${task.provider_id}`,
    });
    return;
  }

  if (!(await isSafeDownloadUrl(task.output_url))) {
    res.status(400).json({ code: 'INVALID_OUTPUT_URL', message: '输出文件地址不安全或不可用' });
    return;
  }

  try {
    const upstream = await axios.get(task.output_url, {
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 0,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${task.task_id}.${format}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const contentLength = upstream.headers['content-length'];
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    upstream.data.pipe(res);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error('[DownloadController] 代理请求失败:', err.message);
      res.status(502).json({ code: 3002, message: 'AI 服务暂时不可用', detail: err.message });
    } else {
      console.error('[DownloadController] 未知错误:', String(err));
      res.status(500).json({ code: 5001, message: '服务器内部错误' });
    }
  }
}
