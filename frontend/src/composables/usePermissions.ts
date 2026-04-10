import { computed, readonly, ref } from 'vue'
import { getAllowedActions } from '../api'

export type PermissionAction =
  | 'generate-model'
  | 'download-model'
  | 'upload-to-main'
  | 'view-usage'
  | 'admin-config'

type PermissionState = Record<PermissionAction, boolean>

const permissions = ref<PermissionState>({
  'generate-model': false,
  'download-model': false,
  'upload-to-main': false,
  'view-usage': false,
  'admin-config': false,
})
const roles = ref<string[]>([])

const loaded = ref(false)
const loading = ref(false)
const isRootUser = computed(() => roles.value.includes('root'))

export function usePermissions() {
  async function fetchAllowedActions(force = false) {
    if ((loaded.value || loading.value) && !force) {
      return
    }

    loading.value = true
    try {
      const response = await getAllowedActions()
      const payload =
        (response.data as { data?: { actions?: string[]; roles?: string[] } }).data ??
        (response.data as { actions?: string[]; roles?: string[] })
      const actions = payload.actions ?? []
      const wildcard = actions.includes('*')
      roles.value = Array.isArray(payload.roles) ? payload.roles : []
      ;(Object.keys(permissions.value) as PermissionAction[]).forEach((key) => {
        permissions.value[key] = wildcard || actions.includes(key)
      })
      loaded.value = true
    } finally {
      loading.value = false
    }
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
