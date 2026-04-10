import {
  CREDITS_PER_POWER,
  PROVIDER_BILLING,
  creditToPower,
  getEstimatedCreditCost,
  powerToCredit,
} from '../config/providers';

describe('creditToPower / powerToCredit', () => {
  it('converts tripo3d credits to power with the fixed credits-per-power table', () => {
    expect(creditToPower('tripo3d', 20)).toBe(0.67);
    expect(creditToPower('tripo3d', 30)).toBe(1);
  });

  it('converts hyper3d credits to power with the fixed credits-per-power table', () => {
    expect(creditToPower('hyper3d', 0.5)).toBe(1);
    expect(creditToPower('hyper3d', 1)).toBe(2);
  });

  it('rounds to 2 decimals', () => {
    expect(creditToPower('tripo3d', 10)).toBe(0.33);
    expect(creditToPower('tripo3d', 100)).toBe(3.33);
  });

  it('converts power back to provider credits', () => {
    const tripo = powerToCredit('tripo3d', 1);
    expect(tripo).toBe(30);
    const hyper = powerToCredit('hyper3d', 1);
    expect(hyper).toBe(0.5);
  });

  it('keeps the configured billing table in sync with known providers', () => {
    expect(CREDITS_PER_POWER).toEqual({
      tripo3d: 30,
      hyper3d: 0.5,
    });
    expect(PROVIDER_BILLING).toEqual({
      tripo3d: {
        creditsPerPower: 30,
        estimatedCreditCost: 30,
      },
      hyper3d: {
        creditsPerPower: 0.5,
        estimatedCreditCost: 0.5,
      },
    });
  });

  it('exposes estimated provider credit costs from the shared billing table', () => {
    expect(getEstimatedCreditCost('tripo3d')).toBe(30);
    expect(getEstimatedCreditCost('hyper3d')).toBe(0.5);
  });

  it('throws for unknown providers', () => {
    expect(() => creditToPower('unknown-provider', 10)).toThrow('Unknown provider: unknown-provider');
    expect(() => powerToCredit('unknown-provider', 1)).toThrow('Unknown provider: unknown-provider');
    expect(() => getEstimatedCreditCost('unknown-provider')).toThrow('Unknown provider: unknown-provider');
  });
});
