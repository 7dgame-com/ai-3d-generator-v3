interface CycleProgressInput {
  cycle_started_at: string | null
  next_cycle_at: string | null
  cycle_duration: number
}

export interface CycleProgressSnapshot {
  elapsedMinutes: number
  fillPercent: number
  percent: number
  totalMinutes: number
}

export function getCycleProgress(
  status: CycleProgressInput | null | undefined,
  nowMs: number = Date.now()
): CycleProgressSnapshot | null {
  if (!status?.cycle_started_at) {
    return null
  }

  const startedAtMs = Date.parse(status.cycle_started_at)
  if (!Number.isFinite(startedAtMs)) {
    return null
  }

  const nextCycleMs = resolveNextCycleMs(status, startedAtMs)
  const totalMinutes = Math.max(0, Math.round((nextCycleMs - startedAtMs) / 60_000))
  if (totalMinutes <= 0) {
    return null
  }

  const totalMs = totalMinutes * 60_000
  const elapsedMs = Math.min(Math.max(nowMs - startedAtMs, 0), totalMs)
  const fillPercent = Number(((elapsedMs / totalMs) * 100).toFixed(2))

  return {
    elapsedMinutes: Math.floor(elapsedMs / 60_000),
    fillPercent,
    percent: Math.round(fillPercent),
    totalMinutes,
  }
}

function resolveNextCycleMs(status: CycleProgressInput, startedAtMs: number) {
  if (status.next_cycle_at) {
    const parsedNextCycleMs = Date.parse(status.next_cycle_at)
    if (Number.isFinite(parsedNextCycleMs) && parsedNextCycleMs > startedAtMs) {
      return parsedNextCycleMs
    }
  }

  return startedAtMs + Math.max(status.cycle_duration, 0) * 60_000
}
