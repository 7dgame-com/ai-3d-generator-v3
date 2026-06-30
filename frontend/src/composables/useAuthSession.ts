import { computed, readonly, ref } from 'vue'
import { verifyToken } from '../api'

export interface AuthOrganization {
  id?: number
  name?: string
  title?: string
}

export interface AuthUser {
  id: number
  username?: string
  nickname?: string | null
  roles?: string[]
  organizations?: AuthOrganization[]
}

const user = ref<AuthUser | null>(null)
const roles = computed(() => user.value?.roles ?? [])
const loaded = ref(false)
const loading = ref(false)
let loadingPromise: Promise<void> | null = null
const isRootUser = computed(() => roles.value.includes('root'))

function normalizeUser(payload: unknown): AuthUser | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const raw = payload as Record<string, unknown>
  const id = Number(raw.id ?? raw.user_id)
  if (!Number.isInteger(id) || id <= 0) {
    return null
  }

  return {
    id,
    username: typeof raw.username === 'string' ? raw.username : undefined,
    nickname: typeof raw.nickname === 'string' || raw.nickname === null ? raw.nickname : undefined,
    roles: Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === 'string') : [],
    organizations: Array.isArray(raw.organizations)
      ? raw.organizations.flatMap((item): AuthOrganization[] => {
        if (!item || typeof item !== 'object') return []
        const organization = item as Record<string, unknown>
        const organizationId = Number(organization.id)
        return [{
          id: Number.isInteger(organizationId) && organizationId > 0 ? organizationId : undefined,
          name: typeof organization.name === 'string' ? organization.name : undefined,
          title: typeof organization.title === 'string' ? organization.title : undefined,
        }]
      })
      : [],
  }
}

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
          (response.data as { data?: unknown }).data ??
          response.data
        user.value = normalizeUser(payload)
        loaded.value = true
      } catch (error) {
        user.value = null
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
    user: readonly(user),
    roles: readonly(roles),
    loaded: readonly(loaded),
    loading: readonly(loading),
    isRootUser,
    fetchSession,
  }
}
