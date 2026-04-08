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
