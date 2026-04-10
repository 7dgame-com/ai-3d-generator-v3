import { creditToPower, getEstimatedCreditCost } from '../config/providers';

function safeCreditToPower(providerId: string, creditCost: number): number {
  try {
    return creditToPower(providerId, creditCost);
  } catch {
    return 0;
  }
}

export function getProviderDefaultCreditCost(providerId: string): number {
  try {
    return getEstimatedCreditCost(providerId);
  } catch {
    return 0;
  }
}

export function normalizeTaskBilling(input: {
  providerId: string;
  creditCost: unknown;
  powerCost: unknown;
  status?: string;
}): { creditCost: number; powerCost: number } {
  const creditCost = Number(input.creditCost ?? 0);
  const powerCost = Number(input.powerCost ?? 0);
  const status = input.status ?? 'success';

  if (powerCost > 0) {
    return { creditCost, powerCost };
  }

  if (creditCost > 0) {
    return {
      creditCost,
      powerCost: safeCreditToPower(input.providerId, creditCost),
    };
  }

  if (status === 'success') {
    const fallbackCreditCost = getProviderDefaultCreditCost(input.providerId);
    if (fallbackCreditCost > 0) {
      return {
        creditCost: fallbackCreditCost,
        powerCost: safeCreditToPower(input.providerId, fallbackCreditCost),
      };
    }
  }

  return { creditCost, powerCost };
}
