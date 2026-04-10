/**
 * 从签名 URL 中提取过期时间戳（毫秒）。
 *
 * 支持的格式：
 * - CloudFront 签名 URL（Tripo3D）：从 Policy 参数中解析 AWS:EpochTime
 * - AWS S3 预签名 URL：X-Amz-Date + X-Amz-Expires
 * - 火山引擎 TOS 预签名 URL（Hyper3D）：X-Tos-Date + X-Tos-Expires
 * - 通用 Expires 参数：直接读取 Unix 时间戳
 *
 * 解析失败时返回 null，调用方应 fallback 到 completed_at + 24h。
 */
export function parseUrlExpiry(url: string): number | null {
  try {
    const u = new URL(url);

    // 1. CloudFront Policy（Tripo3D 使用）
    const policy = u.searchParams.get('Policy');
    if (policy) {
      return parseCloudFrontPolicy(policy);
    }

    // 2. 通用 Expires / expires 参数
    const expires = u.searchParams.get('Expires') ?? u.searchParams.get('expires');
    if (expires) {
      const epoch = Number(expires);
      if (!isNaN(epoch) && epoch > 0) {
        return epoch * 1000; // 转为毫秒
      }
    }

    // 3. AWS S3 预签名 URL 的 X-Amz-Date + X-Amz-Expires
    const amzDate = u.searchParams.get('X-Amz-Date');
    const amzExpires = u.searchParams.get('X-Amz-Expires');
    if (amzDate && amzExpires) {
      const parsed = parseDateExpiresPair(amzDate, amzExpires);
      if (parsed !== null) return parsed;
    }

    // 4. 火山引擎 TOS 预签名 URL（Hyper3D 使用）的 X-Tos-Date + X-Tos-Expires
    const tosDate = u.searchParams.get('X-Tos-Date');
    const tosExpires = u.searchParams.get('X-Tos-Expires');
    if (tosDate && tosExpires) {
      const parsed = parseDateExpiresPair(tosDate, tosExpires);
      if (parsed !== null) return parsed;
    }
  } catch {
    // URL 解析失败，返回 null
  }
  return null;
}

/**
 * 根据 outputUrl 和 thumbnailUrl 计算最早过期时间。
 * 若无法从 URL 中解析，则回退到 completedAt + 24 小时。
 */
export function computeExpiresAt(
  outputUrl: string | null,
  thumbnailUrl: string | null,
  completedAt: Date
): Date {
  const baseTime = completedAt instanceof Date && !isNaN(completedAt.getTime())
    ? completedAt.getTime()
    : Date.now();
  const fallback = new Date(baseTime + 24 * 60 * 60 * 1000);

  const candidates: number[] = [];
  if (outputUrl) {
    const outputExpiry = parseUrlExpiry(outputUrl);
    if (outputExpiry !== null) {
      candidates.push(outputExpiry);
    }
  }

  if (thumbnailUrl) {
    const thumbnailExpiry = parseUrlExpiry(thumbnailUrl);
    if (thumbnailExpiry !== null) {
      candidates.push(thumbnailExpiry);
    }
  }

  if (candidates.length === 0) {
    return fallback;
  }

  return new Date(Math.min(...candidates));
}

/**
 * 解析 "日期 + 有效秒数" 格式的签名参数。
 * 日期格式: 20260408T023924Z（AWS S3 / 火山引擎 TOS 通用）
 */
function parseDateExpiresPair(dateStr: string, expiresStr: string): number | null {
  const m = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const start = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime();
  const seconds = Number(expiresStr);
  if (isNaN(seconds) || seconds <= 0) return null;
  return start + seconds * 1000;
}

function parseCloudFrontPolicy(policyB64: string): number | null {
  try {
    // CloudFront URL-safe base64: - → +, _ → /, ~ → =
    const standard = policyB64.replace(/-/g, '+').replace(/_/g, '/').replace(/~/g, '=');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');

    // 找到完整的 JSON（可能有 trailing bytes）
    let depth = 0;
    let end = 0;
    for (let i = 0; i < decoded.length; i++) {
      if (decoded[i] === '{') depth++;
      else if (decoded[i] === '}') depth--;
      if (depth === 0 && i > 0) { end = i + 1; break; }
    }

    const policy = JSON.parse(decoded.slice(0, end));
    const epoch = policy?.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime'];
    if (typeof epoch === 'number' && epoch > 0) {
      return epoch * 1000; // 转为毫秒
    }
  } catch {
    // 解析失败
  }
  return null;
}

/**
 * 判断 output_url 是否已过期。
 * 优先从 URL 签名中解析过期时间，fallback 到 completed_at + 24h。
 */
export function isDownloadExpired(outputUrl: string | null, completedAt: string | null): boolean {
  const now = Date.now();

  // 尝试从 URL 解析精确过期时间
  if (outputUrl) {
    const urlExpiry = parseUrlExpiry(outputUrl);
    if (urlExpiry !== null) {
      return now > urlExpiry;
    }
  }

  // Fallback: completed_at + 24 小时
  if (completedAt) {
    const FALLBACK_EXPIRY_MS = 24 * 60 * 60 * 1000;
    return now - new Date(completedAt).getTime() > FALLBACK_EXPIRY_MS;
  }

  return false;
}
