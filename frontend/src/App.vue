<template>
  <router-view />
  <span class="app-version">{{ appVersion }}</span>
</template>

<script setup lang="ts">
import { usePluginMessageBridge } from './composables/usePluginMessageBridge'
import { removeAllTokens, setToken } from './utils/token'
import { setThemeFromConfig } from './composables/useTheme'

declare const __APP_VERSION__: string
const appVersion = `v${__APP_VERSION__}`

usePluginMessageBridge({
  onInit: ({ token, config }) => {
    if (token) {
      setToken(token)
    }
    setThemeFromConfig(config)
  },
  onTokenUpdate: (token) => {
    if (token) {
      setToken(token)
    }
  },
  onDestroy: () => {
    removeAllTokens()
  },
})
</script>

<style scoped>
.app-version {
  position: fixed;
  right: 12px;
  bottom: 8px;
  font-size: 11px;
  color: #b2b8c2;
  pointer-events: none;
}
</style>
