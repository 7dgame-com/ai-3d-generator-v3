<template>
  <el-dialog
    :model-value="visible"
    :title="t('creditDialog.title')"
    width="460px"
    @close="closeDialog"
    @update:model-value="handleVisibleChange"
  >
    <p class="message">
      {{ isAdmin ? t('creditDialog.adminMessage') : t('creditDialog.userMessage') }}
    </p>

    <template #footer>
      <el-button v-if="isAdmin" type="primary" @click="goToAdmin">
        {{ t('creditDialog.goToAdmin') }}
      </el-button>
      <el-button v-else type="primary" @click="closeDialog">
        {{ t('creditDialog.understood') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  visible: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'go-admin'): void
}>()

const { t } = useI18n()

function handleVisibleChange(value: boolean) {
  if (!value) {
    emit('update:visible', false)
  }
}

function closeDialog() {
  emit('update:visible', false)
}

function goToAdmin() {
  emit('go-admin')
}
</script>

<style scoped>
.message {
  margin: 0;
  color: #445068;
  line-height: 1.6;
}
</style>
