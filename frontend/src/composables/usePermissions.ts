import { computed, readonly } from 'vue'
import { useAuthSession } from './useAuthSession'

export type PermissionAction =
  | 'generate-model'
  | 'download-model'
  | 'upload-to-main'
  | 'view-usage'
  | 'admin-config'

type PermissionState = Record<PermissionAction, boolean>

export function usePermissions() {
  const { roles, loaded, loading, isRootUser, fetchSession } = useAuthSession()
  const permissions = computed<PermissionState>(() => ({
    'generate-model': loaded.value,
    'download-model': loaded.value,
    'upload-to-main': loaded.value,
    'view-usage': loaded.value,
    'admin-config': loaded.value && isRootUser.value,
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
    fetchAllowedActions,
    can,
    hasAny,
  }
}
