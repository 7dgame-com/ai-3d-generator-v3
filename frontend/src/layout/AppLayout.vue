<template>
  <div class="app-layout">
    <header class="header">
      <div>
        <h1>{{ t('pluginMeta.name') }}</h1>
        <p>{{ t('pluginMeta.description') }}</p>
      </div>
      <nav class="nav">
        <router-link to="/">{{ t('nav.generator') }}</router-link>
        <router-link v-if="can('view-usage')" to="/history">{{ t('nav.history') }}</router-link>
        <router-link v-if="can('admin-config')" to="/admin">{{ t('nav.admin') }}</router-link>
      </nav>
    </header>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../composables/usePermissions'

const { t } = useI18n()
const { can, fetchAllowedActions } = usePermissions()

onMounted(() => {
  void fetchAllowedActions()
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: #f4f7fb;
}

.header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  padding: 24px 32px;
  background: #ffffff;
  border-bottom: 1px solid #e8edf5;
}

.header h1 {
  margin: 0;
  font-size: 24px;
}

.header p {
  margin: 6px 0 0;
  color: #667085;
}

.nav {
  display: flex;
  gap: 16px;
}

.nav a {
  color: #344054;
  text-decoration: none;
  font-weight: 600;
}

.nav a.router-link-active {
  color: #2563eb;
}

.content {
  padding: 24px 32px 40px;
}
</style>
