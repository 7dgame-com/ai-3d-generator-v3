import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  roles: { value: [] as string[] },
  loaded: { value: false },
  loading: { value: false },
  isRootUser: { value: false },
}))

vi.mock('../useAuthSession', () => ({
  useAuthSession: () => ({
    fetchSession: mocks.fetchSession,
    roles: mocks.roles,
    loaded: mocks.loaded,
    loading: mocks.loading,
    isRootUser: mocks.isRootUser,
  }),
}))

describe('usePermissions role awareness', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchSession.mockReset()
    mocks.roles.value = []
    mocks.loaded.value = false
    mocks.loading.value = false
    mocks.isRootUser.value = false
  })

  it('marks the session as root when verify-token returns the root role', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.roles.value = ['root', 'admin']
      mocks.loaded.value = true
      mocks.isRootUser.value = true
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('generate-model')).toBe(true)
    expect(permissions.can('admin-config')).toBe(true)
    expect(permissions.isRootUser.value).toBe(true)
  })

  it('keeps the session non-root when verify-token omits the root role', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.roles.value = ['admin']
      mocks.loaded.value = true
      mocks.isRootUser.value = false
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('generate-model')).toBe(true)
    expect(permissions.can('admin-config')).toBe(false)
    expect(permissions.isRootUser.value).toBe(false)
  })
})
