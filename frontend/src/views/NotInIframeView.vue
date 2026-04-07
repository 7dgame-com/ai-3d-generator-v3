<template>
  <section class="state-card">
    <h2>{{ t('state.notInIframeTitle') }}</h2>
    <p>{{ t('state.notInIframeDesc') }}</p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.state-card {
  max-width: 560px;
  margin: 80px auto;
  padding: 32px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
}
</style>
