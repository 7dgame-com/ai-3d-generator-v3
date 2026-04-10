export async function startSiteScheduler(): Promise<void> {
  return Promise.resolve();
}

export function stopSiteScheduler(): void {
  // placeholder; implemented in a later task
}

export async function scheduleNextSiteCycle(
  _cycleDurationMinutes: number,
  _nextCycleAt: Date
): Promise<void> {
  return Promise.resolve();
}
