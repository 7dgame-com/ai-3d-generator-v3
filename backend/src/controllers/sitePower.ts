import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { sitePowerManager, type SiteRechargeParams } from '../services/sitePowerManager';
import { scheduleNextSiteCycle } from '../services/siteQuotaScheduler';

export async function getStatusHandler(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const status = await sitePowerManager.getAccountStatus();
    res.json({ data: status });
  } catch (err) {
    console.error('[SitePowerController] GET /credits/status error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function getAdminSitePowerStatusHandler(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const status = await sitePowerManager.getAccountStatus();
    res.json({ data: status });
  } catch (err) {
    console.error('[SitePowerController] GET /admin/site-power-status error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}

export async function rechargeSitePowerHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    await sitePowerManager.recharge(req.body as SiteRechargeParams);
    const status = await sitePowerManager.getAccountStatus();
    if (status.next_cycle_at) {
      await scheduleNextSiteCycle(
        status.cycle_duration || (req.body as SiteRechargeParams).cycle_duration,
        new Date(status.next_cycle_at)
      );
    }
    res.json({ success: true, data: status });
  } catch (err: any) {
    if (err.code === 'INVALID_AMOUNT' || err.code === 'INVALID_PARAMS') {
      res.status(422).json({ code: err.code, message: err.message });
      return;
    }
    console.error('[SitePowerController] POST /admin/site-power-recharge error:', err);
    res.status(500).json({ code: 5001, message: '服务器内部错误' });
  }
}
