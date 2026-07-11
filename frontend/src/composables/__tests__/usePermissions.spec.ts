import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  user: { value: null as null | {
    roles?: string[]
    organizations?: Array<{ id?: number; name?: string; title?: string }>
  } },
  roles: { value: [] as string[] },
  loaded: { value: false },
  loading: { value: false },
  isRootUser: { value: false },
  currentOrganizationId: { value: null as number | null },
  currentOrganizationName: { value: '' },
  currentOrganizationTitle: { value: '' },
  hasOrganizationContext: { value: false },
}))

vi.mock('../useAuthSession', () => ({
  useAuthSession: () => ({
    fetchSession: mocks.fetchSession,
    user: mocks.user,
    roles: mocks.roles,
    loaded: mocks.loaded,
    loading: mocks.loading,
    isRootUser: mocks.isRootUser,
  }),
}))

vi.mock('../useHostPluginContext', () => ({
  useHostPluginContext: () => ({
    currentOrganizationId: mocks.currentOrganizationId,
    currentOrganizationName: mocks.currentOrganizationName,
    currentOrganizationTitle: mocks.currentOrganizationTitle,
    hasOrganizationContext: mocks.hasOrganizationContext,
  }),
}))

describe('usePermissions role awareness', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchSession.mockReset()
    mocks.user.value = null
    mocks.roles.value = []
    mocks.loaded.value = false
    mocks.loading.value = false
    mocks.isRootUser.value = false
    mocks.currentOrganizationId.value = null
    mocks.currentOrganizationName.value = ''
    mocks.currentOrganizationTitle.value = ''
    mocks.hasOrganizationContext.value = false
  })

  it('marks the session as root when verify-token returns the root role', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.roles.value = ['root', 'admin']
      mocks.user.value = { roles: ['root', 'admin'], organizations: [] }
      mocks.loaded.value = true
      mocks.isRootUser.value = true
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('generate-model')).toBe(true)
    expect(permissions.can('admin-config')).toBe(true)
    expect(permissions.can('manage-quota')).toBe(true)
    expect(permissions.isRootUser.value).toBe(true)
  })

  it('allows admin sessions to manage quotas without root access', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.roles.value = ['admin']
      mocks.user.value = { roles: ['admin'], organizations: [] }
      mocks.loaded.value = true
      mocks.isRootUser.value = false
    })

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('generate-model')).toBe(true)
    expect(permissions.can('admin-config')).toBe(false)
    expect(permissions.can('manage-quota')).toBe(true)
    expect(permissions.isRootUser.value).toBe(false)
  })

  it('tracks organization membership separately from quota management access', async () => {
    mocks.fetchSession.mockImplementation(async () => {
      mocks.roles.value = ['user', 'manager']
      mocks.user.value = {
        roles: ['user', 'manager'],
        organizations: [{ id: 7, name: 'school-a', title: 'School A' }],
      }
      mocks.loaded.value = true
      mocks.isRootUser.value = false
    })
    mocks.currentOrganizationId.value = 12
    mocks.currentOrganizationName.value = 'school-b'
    mocks.hasOrganizationContext.value = true

    const { usePermissions } = await import('../usePermissions')
    const permissions = usePermissions()

    await permissions.fetchAllowedActions(true)

    expect(permissions.can('admin-config')).toBe(false)
    expect(permissions.can('manage-quota')).toBe(true)
    expect(permissions.belongsToCurrentOrganization.value).toBe(false)
  })
})
