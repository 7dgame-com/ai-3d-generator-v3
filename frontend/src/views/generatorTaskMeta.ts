import { creditToPower } from '../utils/providerBilling'

/** Return the power value to display; falls back to credit→power conversion for legacy data */
export function displayPower(powerCost: number, creditCost: number, providerId?: string): number {
  if (powerCost > 0) return powerCost
  if (creditCost > 0) {
    const converted = creditToPower(providerId, creditCost)
    if (converted > 0) return converted
  }
  return 0
}

/** Format file size in human-readable form */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function providerLabel(providerId: string): string {
  if (providerId === 'hyper3d') {
    return 'Hyper3D'
  }

  if (providerId === 'tripo3d') {
    return 'Tripo3D'
  }

  return providerId
}

export function formatDateTime(isoString: string, locale?: string): string {
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return isoString

  const lang = locale ?? 'zh-CN'
  const pad = (n: number) => String(n).padStart(2, '0')

  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())

  if (lang.startsWith('zh') || lang === 'ja-JP') {
    return `${month}-${day} ${hours}:${minutes}`
  }

  if (lang === 'th-TH') {
    return `${day}/${month} ${hours}:${minutes}`
  }

  return `${month}-${day} ${hours}:${minutes}`
}

export function formatDuration(start: string, end: string, locale: string): string {
  const diffMs = Date.parse(end) - Date.parse(start)
  const totalSeconds = Math.max(0, Math.round(diffMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (locale.startsWith('zh')) {
    return `${minutes} 分 ${seconds} 秒`
  }

  if (locale === 'ja-JP') {
    return `${minutes} 分 ${seconds} 秒`
  }

  if (locale === 'th-TH') {
    return `${minutes} นาที ${seconds} วินาที`
  }

  return `${minutes} min ${seconds} sec`
}

export function formatExpiryCountdown(
  expiresAt: string | null,
  nowMs: number = Date.now()
): { text: string; urgent: boolean } | null {
  if (!expiresAt) {
    return null
  }

  const expiryMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiryMs) || expiryMs <= nowMs) {
    return null
  }

  const remainingMs = expiryMs - nowMs
  const urgent = remainingMs < 60 * 60 * 1000
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor(remainingMs / (60 * 60 * 1000))
  const hoursWithinDay = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))

  return {
    text:
      days > 0
        ? `剩余 ${days}天${hoursWithinDay}小时${minutes}分`
        : hours > 0
          ? `剩余 ${hours}小时${minutes}分`
          : `剩余 ${minutes}分`,
    urgent,
  }
}
