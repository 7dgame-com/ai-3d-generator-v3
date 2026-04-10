import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllowedActions: vi.fn(),
}))

vi.mock('../../api', () => ({
  getAllowedActions: mocks.getAllowedActions,
}))

describe('usePermissions role awareness', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.getAllowedActions.mockReset()
  })

  it('marks the session as root when allowed-actions returns the root role', async () => {
    mocks.getAllowedActions.mockResolvedValue({
      data: {
        data: {
          actions: ['admin-config', 'view-usage'],
          roles: ['root', 'admin'],
        },
      },
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('admin-config')).toBe(true)
    expect(permissions.isRootUser.value).toBe(true)
  })

  it('keeps the session non-root when allowed-actions omits the root role', async () => {
    mocks.getAllowedActions.mockResolvedValue({
      data: {
        data: {
          actions: ['admin-config'],
          roles: ['admin'],
        },
      },
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('admin-config')).toBe(true)
    expect(permissions.isRootUser.value).toBe(false)
  })
})
