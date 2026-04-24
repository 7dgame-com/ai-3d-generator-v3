import * as fc from 'fast-check'
import { getTripoRegion } from '../services/tripoRegion'
import { query } from '../db/connection'

/* ------------------------------------------------------------------ */
/*  Validates: Requirements 1.8, 3.4, 8.3                             */
/* ------------------------------------------------------------------ */

jest.mock('../db/connection', () => ({
  query: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Random string that is NOT 'ai' or 'com' — models invalid / missing region values. */
const invalidRegionArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.string().filter((s) => s !== 'ai' && s !== 'com'),
)

/** Valid region values. */
const validRegionArb = fc.constantFrom('ai' as const, 'com' as const)

/* ------------------------------------------------------------------ */
/*  Property test                                                     */
/* ------------------------------------------------------------------ */

describe('Feature: tripo3d-dual-region, Property 3: 默认区域回退', () => {
  beforeEach(() => {
    mockedQuery.mockReset()
  })

  it(
    'returns "com" for any non-"ai"/non-"com" value (including empty, undefined, invalid strings)',
    async () => {
      await fc.assert(
        fc.asyncProperty(invalidRegionArb, async (invalidValue) => {
          // Simulate DB returning a row with the invalid value, or empty result
          if (invalidValue === undefined || invalidValue === null) {
            // Simulate key not existing in DB (empty result set)
            mockedQuery.mockResolvedValue([])
          } else {
            mockedQuery.mockResolvedValue([{ value: invalidValue }])
          }

          const region = await getTripoRegion()
          expect(region).toBe('com')

          // Verify the correct query was issued
          expect(mockedQuery).toHaveBeenCalledWith(
            'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
            ['tripo3d_region'],
          )
        }),
        { numRuns: 100 },
      )
    },
  )

  it(
    'returns the original value for valid region values ("ai" or "com")',
    async () => {
      await fc.assert(
        fc.asyncProperty(validRegionArb, async (validValue) => {
          mockedQuery.mockResolvedValue([{ value: validValue }])

          const region = await getTripoRegion()
          expect(region).toBe(validValue)

          expect(mockedQuery).toHaveBeenCalledWith(
            'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
            ['tripo3d_region'],
          )
        }),
        { numRuns: 100 },
      )
    },
  )
})
