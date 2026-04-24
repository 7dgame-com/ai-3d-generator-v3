/**
 * Tripo3D region resolver.
 *
 * Reads the `tripo3d_region` key from the `system_config` table and returns
 * the stored region (`'ai'` or `'com'`). Falls back to `'com'` when the key
 * is missing, empty, or contains an invalid value — ensuring backward
 * compatibility with deployments that pre-date the dual-region feature.
 */

import { query } from '../db/connection'
import type { TripoRegion } from './regionProbe'

/**
 * Returns the currently configured Tripo3D region.
 *
 * Resolution order:
 * 1. Read `tripo3d_region` from `system_config`
 * 2. If the value is `'ai'` or `'com'`, return it
 * 3. Otherwise (missing / empty / invalid) → default to `'com'`
 */
export async function getTripoRegion(): Promise<TripoRegion> {
  const rows = await query<Array<{ value: string }>>(
    'SELECT `value` FROM system_config WHERE `key` = ? LIMIT 1',
    ['tripo3d_region'],
  )
  const region = rows?.[0]?.value
  if (region === 'ai' || region === 'com') return region
  return 'com'
}
