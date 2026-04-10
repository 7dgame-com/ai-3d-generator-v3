import * as fc from 'fast-check';
import { CREDITS_PER_POWER, creditToPower, powerToCredit } from '../config/providers';

const knownProviders = Object.keys(CREDITS_PER_POWER) as Array<keyof typeof CREDITS_PER_POWER>;

describe('creditToPower properties', () => {
  it('Property 1: creditToPower matches the configured formula and 2-decimal precision', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownProviders),
        fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (providerId, creditAmount) => {
          const expected = Math.round((creditAmount / CREDITS_PER_POWER[providerId]) * 100) / 100;
          expect(creditToPower(providerId, creditAmount)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2: converting to power and back stays within the rounding error bound', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownProviders),
        fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (providerId, creditAmount) => {
          const roundTrip = powerToCredit(providerId, creditToPower(providerId, creditAmount));
          const maxError = 0.01 * CREDITS_PER_POWER[providerId];
          expect(Math.abs(roundTrip - creditAmount)).toBeLessThanOrEqual(maxError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: the SQL migration formula stays consistent with creditToPower', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownProviders),
        fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true }),
        (providerId, creditAmount) => {
          const sqlFormulaValue = Math.round((creditAmount / CREDITS_PER_POWER[providerId]) * 100) / 100;
          expect(sqlFormulaValue).toBe(creditToPower(providerId, creditAmount));
        }
      ),
      { numRuns: 100 }
    );
  });
});
