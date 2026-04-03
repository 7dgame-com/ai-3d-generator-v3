import { readonly, ref } from 'vue'
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

const loaded = ref(false)
const loading = ref(false)

export function usePermissions() {
  async function fetchAllowedActions(force = false) {
    if ((loaded.value || loading.value) && !force) {
      return
    }

    loading.value = true
    try {
      const response = await getAllowedActions()
      const actions =
        (response.data as { data?: { actions?: string[] } }).data?.actions ??
        (response.data as { actions?: string[] }).actions ??
        []
      const wildcard = actions.includes('*')
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
    loaded: readonly(loaded),
    loading: readonly(loading),
    fetchAllowedActions,
    can,
    hasAny,
  }
}
