import { computed, readonly, ref } from 'vue'
import { verifyToken } from '../api'

const roles = ref<string[]>([])
const loaded = ref(false)
const loading = ref(false)
const isRootUser = computed(() => roles.value.includes('root'))

export function useAuthSession() {
  async function fetchSession(force = false) {
    if ((loaded.value || loading.value) && !force) {
      return
    }

    loading.value = true
    try {
      const response = await verifyToken()
      const payload =
        (response.data as { data?: { roles?: string[] } }).data ??
        (response.data as { roles?: string[] })
      roles.value = Array.isArray(payload.roles) ? payload.roles : []
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  return {
    roles: readonly(roles),
    loaded: readonly(loaded),
    loading: readonly(loading),
    isRootUser,
    fetchSession,
  }
}
