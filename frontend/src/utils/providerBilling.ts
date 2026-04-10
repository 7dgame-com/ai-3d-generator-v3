export const PROVIDER_BILLING = {
  tripo3d: {
    creditsPerPower: 30,
    estimatedCreditCost: 30,
  },
  hyper3d: {
    creditsPerPower: 0.5,
    estimatedCreditCost: 0.5,
  },
} as const

const CREDITS_PER_POWER: Record<string, number> = {
  tripo3d: PROVIDER_BILLING.tripo3d.creditsPerPower,
  hyper3d: PROVIDER_BILLING.hyper3d.creditsPerPower,
}

export function creditToPower(providerId: string | undefined, creditCost: number): number {
  if (!providerId || creditCost <= 0) {
    return 0
  }

  const ratio = CREDITS_PER_POWER[providerId]
  if (!ratio) {
    return 0
  }

  return Math.round((creditCost / ratio) * 100) / 100
}

export function getEstimatedCreditCost(providerId: string | undefined): number {
  if (!providerId) {
    return 0
  }

  return PROVIDER_BILLING[providerId as keyof typeof PROVIDER_BILLING]?.estimatedCreditCost ?? 0
}

export function getProviderDefaultCreditCost(providerId: string | undefined): number {
  return getEstimatedCreditCost(providerId)
}
