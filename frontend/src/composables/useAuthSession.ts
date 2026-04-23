import { computed, readonly, ref } from 'vue'
import { verifyToken } from '../api'

const roles = ref<string[]>([])
const loaded = ref(false)
const loading = ref(false)
let loadingPromise: Promise<void> | null = null
const isRootUser = computed(() => roles.value.includes('root'))

export function useAuthSession() {
  async function fetchSession(force = false) {
    if (loaded.value && !force) {
      return
    }

    if (loadingPromise && !force) {
      await loadingPromise
      return
    }

    loading.value = true
    loadingPromise = (async () => {
      try {
        const response = await verifyToken()
        const payload =
          (response.data as { data?: { roles?: string[] } }).data ??
          (response.data as { roles?: string[] })
        roles.value = Array.isArray(payload.roles) ? payload.roles : []
        loaded.value = true
      } catch (error) {
        roles.value = []
        loaded.value = false
        throw error
      } finally {
        loading.value = false
        loadingPromise = null
      }
    })()

    await loadingPromise
  }

  return {
    roles: readonly(roles),
    loaded: readonly(loaded),
    loading: readonly(loading),
    isRootUser,
    fetchSession,
  }
}
