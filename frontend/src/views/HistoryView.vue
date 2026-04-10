<template>
  <section class="panel">
    <h2>{{ t('history.title') }}</h2>
    <p>{{ t('history.summary', { total: summary?.totalPower ?? 0, month: summary?.monthPower ?? 0, tasks: summary?.taskCount ?? 0 }) }}</p>
    <el-table :data="history">
      <el-table-column prop="taskId" :label="t('history.colTaskId')" />
      <el-table-column prop="type" :label="t('history.colType')" />
      <el-table-column prop="powerUsed" :label="t('history.colPower')" />
      <el-table-column prop="status" :label="t('history.colStatus')" />
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getUsageHistory, getUsageSummary, type UsageHistoryItem } from '../api'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const summary = ref<{ totalCredits: number; totalPower: number; monthCredits: number; monthPower: number; taskCount: number } | null>(null)
const history = ref<UsageHistoryItem[]>([])

onMounted(async () => {
  const [summaryResponse, historyResponse] = await Promise.all([getUsageSummary(), getUsageHistory()])
  summary.value = summaryResponse.data
  history.value = historyResponse.data.data ?? []
})
</script>

<style scoped>
.panel {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
}
</style>
