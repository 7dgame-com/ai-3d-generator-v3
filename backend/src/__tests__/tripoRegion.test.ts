import { getTripoRegion } from '../services/tripoRegion'
import { query } from '../db/connection'

/* ------------------------------------------------------------------ */
/*  Mock the DB connection module                                     */
/* ------------------------------------------------------------------ */

jest.mock('../db/connection', () => ({
  query: jest.fn(),
}))

const mockedQuery = query as jest.MockedFunction<typeof query>

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('getTripoRegion', () => {
  beforeEach(() => {
    mockedQuery.mockReset()
  })

  it('returns "ai" when tripo3d_region is "ai"', async () => {
    mockedQuery.mockResolvedValue([{ value: 'ai' }])

    const region = await getTripoRegion()
    expect(region).toBe('ai')

    expect(mockedQuery).toHaveBeenCalledWith(
      'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
      ['tripo3d_region'],
    )
  })

  it('returns "com" when tripo3d_region is "com"', async () => {
    mockedQuery.mockResolvedValue([{ value: 'com' }])

    const region = await getTripoRegion()
    expect(region).toBe('com')
  })

  it('returns "com" when tripo3d_region does not exist (empty result)', async () => {
    mockedQuery.mockResolvedValue([])

    const region = await getTripoRegion()
    expect(region).toBe('com')
  })

  it('returns "com" when tripo3d_region is an invalid value', async () => {
    mockedQuery.mockResolvedValue([{ value: 'invalid-region' }])

    const region = await getTripoRegion()
    expect(region).toBe('com')
  })
})
