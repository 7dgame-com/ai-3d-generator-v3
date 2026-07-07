import { computed, readonly } from 'vue'
import { useAuthSession } from './useAuthSession'
import { useHostPluginContext } from './useHostPluginContext'

export type PermissionAction =
  | 'generate-model'
  | 'download-model'
  | 'upload-to-main'
  | 'view-usage'
  | 'admin-config'
  | 'manage-quota'

type PermissionState = Record<PermissionAction, boolean>

function normalizeOrganizationName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeOrganizationId(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function usePermissions() {
  const { user, roles, loaded, loading, isRootUser, fetchSession } = useAuthSession()
  const {
    currentOrganizationId,
    currentOrganizationName,
    currentOrganizationTitle,
    hasOrganizationContext,
  } = useHostPluginContext()

  const isOrganizationAdmin = computed(() =>
    roles.value.includes('admin') || roles.value.includes('manager')
  )
  const userOrganizations = computed(() => user.value?.organizations ?? [])
  const fallbackOrganization = computed(() =>
    userOrganizations.value.length === 1 ? userOrganizations.value[0] : null
  )
  const effectiveOrganizationId = computed(() =>
    currentOrganizationId.value ?? normalizeOrganizationId(fallbackOrganization.value?.id)
  )
  const effectiveOrganizationName = computed(() =>
    currentOrganizationName.value || fallbackOrganization.value?.name || ''
  )
  const effectiveOrganizationTitle = computed(() =>
    currentOrganizationTitle.value || fallbackOrganization.value?.title || effectiveOrganizationName.value
  )
  const hasQuotaOrganizationContext = computed(() =>
    hasOrganizationContext.value || fallbackOrganization.value !== null
  )
  const belongsToCurrentOrganization = computed(() => {
    if (!hasQuotaOrganizationContext.value) {
      return false
    }

    const expectedId = effectiveOrganizationId.value
    const expectedName = normalizeOrganizationName(effectiveOrganizationName.value)

    return userOrganizations.value.some((organization) => {
      const organizationId = normalizeOrganizationId(organization.id)
      if (expectedId !== null && organizationId === expectedId) {
        return true
      }

      if (!expectedName) {
        return false
      }

      return normalizeOrganizationName(organization.name) === expectedName
        || normalizeOrganizationName(organization.title) === expectedName
    })
  })
  const canManageQuota = computed(() =>
    loaded.value && (
      isRootUser.value
      || isOrganizationAdmin.value
    )
  )

  const permissions = computed<PermissionState>(() => ({
    'generate-model': loaded.value,
    'download-model': loaded.value,
    'upload-to-main': loaded.value,
    'view-usage': loaded.value,
    'admin-config': loaded.value && isRootUser.value,
    'manage-quota': canManageQuota.value,
  }))

  async function fetchAllowedActions(force = false) {
    await fetchSession(force)
  }

  function can(action: PermissionAction) {
    return permissions.value[action]
  }

  function hasAny() {
    return Object.values(permissions.value).some(Boolean)
  }

  return {
    permissions: readonly(permissions),
    roles: readonly(roles),
    loaded: readonly(loaded),
    loading: readonly(loading),
    isRootUser,
    isOrganizationAdmin,
    canManageQuota,
    currentOrganizationId: effectiveOrganizationId,
    currentOrganizationName: effectiveOrganizationName,
    currentOrganizationTitle: effectiveOrganizationTitle,
    hasOrganizationContext: hasQuotaOrganizationContext,
    belongsToCurrentOrganization,
    fetchAllowedActions,
    can,
    hasAny,
  }
}
