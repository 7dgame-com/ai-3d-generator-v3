import { computed, readonly, ref } from 'vue'

type HostContextPayload = {
  pluginId?: unknown
  group?: unknown
  organizationId?: unknown
  organizationName?: unknown
  organizationTitle?: unknown
}

const config = ref<Record<string, unknown>>({})
const configLoaded = ref(false)

function readHostContext(value: Record<string, unknown>): HostContextPayload {
  const hostContext = value.hostContext
  const hostContextPayload = hostContext && typeof hostContext === 'object'
    ? hostContext as HostContextPayload
    : {}

  return {
    pluginId: hostContextPayload.pluginId ?? value.pluginId,
    group: hostContextPayload.group ?? value.group,
    organizationId: hostContextPayload.organizationId ?? value.organizationId,
    organizationName: hostContextPayload.organizationName ?? value.organizationName,
    organizationTitle: hostContextPayload.organizationTitle ?? value.organizationTitle,
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (/^[1-9]\d*$/.test(normalized)) {
      return Number(normalized)
    }
  }

  return null
}

function isOrganizationGroup(group: string): boolean {
  return group.startsWith('org:') && group !== 'org:public'
}

function organizationNameFromGroup(group: string): string {
  return isOrganizationGroup(group) ? group.slice('org:'.length).trim() : ''
}

export function setHostPluginConfig(value: Record<string, unknown>) {
  config.value = value
  configLoaded.value = true
}

export function clearHostPluginConfig() {
  config.value = {}
  configLoaded.value = false
}

export function useHostPluginContext() {
  const hostContext = computed(() => readHostContext(config.value))
  const pluginId = computed(() => normalizeString(hostContext.value.pluginId))
  const group = computed(() => normalizeString(hostContext.value.group))
  const isPublicPluginGroup = computed(() => group.value === 'org:public')
  const configuredOrganizationName = computed(() => normalizeString(hostContext.value.organizationName))
  const groupOrganizationName = computed(() => organizationNameFromGroup(group.value))
  const currentOrganizationName = computed(() => configuredOrganizationName.value || groupOrganizationName.value)
  const currentOrganizationId = computed(() => normalizePositiveInteger(hostContext.value.organizationId))
  const currentOrganizationTitle = computed(() => normalizeString(hostContext.value.organizationTitle))
  const hasOrganizationContext = computed(() =>
    !isPublicPluginGroup.value
    && (currentOrganizationId.value !== null || currentOrganizationName.value.length > 0)
  )

  return {
    config: readonly(config),
    configLoaded: readonly(configLoaded),
    pluginId,
    group,
    isPublicPluginGroup,
    currentOrganizationId,
    currentOrganizationName,
    currentOrganizationTitle,
    hasOrganizationContext,
  }
}
