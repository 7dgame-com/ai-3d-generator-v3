<template>
  <div class="page">
    <section class="hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">{{ t('nav.admin') }}</p>
        <h2>{{ t('admin.quotaOverviewTitle') }}</h2>
        <p class="hero-description">{{ t('admin.dashboardSubtitle') }}</p>
      </div>

      <div class="summary-grid">
        <article v-for="card in summaryCards" :key="card.key" class="summary-card" :data-tone="card.tone">
          <span class="summary-label">{{ card.label }}</span>
          <strong class="summary-value">{{ card.value }}</strong>
          <span class="summary-meta">{{ card.meta }}</span>
        </article>
      </div>
    </section>

    <section v-if="isRootUser" class="panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.providerOpsTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.providerOpsHint') }}</p>
        </div>
        <el-button :loading="providerLoading" @click="loadProviderData">{{ t('admin.refresh') }}</el-button>
      </div>

      <div class="provider-grid">
        <article
          v-for="provider in providers"
          :key="provider"
          class="provider-card"
          :data-configured="String(configs[provider]?.configured ?? false)"
        >
          <div class="provider-card__top">
            <div>
              <p class="provider-name">{{ provider }}</p>
              <p class="provider-subtitle">
                {{ t('admin.configuredKey') }}:
                <span>{{ configs[provider]?.apiKeyMasked || t('admin.notConfigured') }}</span>
              </p>
              <p v-if="provider === 'tripo3d' && configs[provider]?.region" class="provider-region-label">
                {{ configs[provider]?.region === 'ai' ? t('admin.regionInternational') : t('admin.regionDomestic') }}
              </p>
            </div>
            <span class="status-pill" :data-ready="String(configs[provider]?.configured ?? false)">
              {{ configs[provider]?.configured ? t('admin.providerStatusConfigured') : t('admin.providerStatusMissing') }}
            </span>
          </div>

          <div class="provider-metrics">
            <div class="metric-card">
              <span>{{ t('admin.balancePowerLabel') }}</span>
              <strong>{{ formatPower(balances[provider]?.availablePower ?? 0) }}</strong>
            </div>
            <div class="metric-card">
              <span>{{ t('admin.rawBalance') }}</span>
              <strong>{{ formatRawCredits(balances[provider]?.available) }}</strong>
            </div>
          </div>

          <p class="provider-footnote">{{ formatProviderBalanceFootnote(provider) }}</p>

          <div class="provider-actions">
            <el-input
              v-model="draftKeys[provider]"
              type="password"
              :placeholder="t('admin.apiKeyPlaceholder')"
              show-password
            />
            <div class="actions">
              <el-button @click="loadBalance(provider)">{{ t('admin.checkBalance') }}</el-button>
              <el-button type="primary" @click="save(provider)">{{ t('common.save') }}</el-button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="panel quota-panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.accountQuotaTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.accountQuotaHint') }}</p>
        </div>
        <div class="panel-actions">
          <el-button :loading="quotaLoading" @click="loadQuotaData">{{ t('admin.refresh') }}</el-button>
          <el-button type="danger" plain :loading="resetLoading" @click="resetAllUsage">
            {{ t('admin.resetAllUsage') }}
          </el-button>
        </div>
      </div>

      <div class="quota-config">
        <div class="quota-limit-control">
          <span>{{ t('admin.defaultQuotaLimit') }}</span>
          <el-input-number
            v-model="quotaLimitDraft"
            :min="0"
            :precision="2"
            :step="10"
          />
          <el-button type="primary" :loading="limitSaving" @click="saveDefaultLimit">
            {{ t('common.save') }}
          </el-button>
        </div>
        <div class="quota-summary-strip">
          <article class="quota-kpi">
            <span>{{ t('admin.usedUserCount') }}</span>
            <strong>{{ quotaSummary?.used_user_count ?? 0 }}</strong>
          </article>
          <article class="quota-kpi">
            <span>{{ t('admin.totalUsedPower') }}</span>
            <strong>{{ formatPower(quotaSummary?.total_used_power ?? 0) }}</strong>
          </article>
          <article class="quota-kpi">
            <span>{{ t('admin.tableRemainingPower') }}</span>
            <strong>{{ formatPower(quotaSummary?.total_remaining_power ?? 0) }}</strong>
          </article>
        </div>
      </div>

      <div class="user-quota-toolbar">
        <el-input
          v-model="userSearch"
          :placeholder="t('admin.userSearchPlaceholder')"
          clearable
          @keyup.enter="searchUserQuotas"
          @clear="searchUserQuotas"
        />
        <el-button type="primary" :loading="userQuotaLoading" @click="searchUserQuotas">
          {{ t('admin.search') }}
        </el-button>
      </div>

      <el-table
        v-loading="userQuotaLoading"
        :data="userQuotas"
        class="quota-table"
        table-layout="fixed"
      >
        <el-table-column :label="t('admin.user')" min-width="180">
          <template #default="{ row }">
            <div class="user-cell">
              <strong>{{ row.nickname || row.username || `#${row.id}` }}</strong>
              <span>#{{ row.id }} {{ row.username || '' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.usedPower')" width="150">
          <template #default="{ row }">{{ formatPower(row.quota?.used_power ?? 0) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.remainingPower')" width="150">
          <template #default="{ row }">{{ formatPower(row.quota?.remaining_power ?? quotaLimit) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.updatedAt')" width="190">
          <template #default="{ row }">{{ formatDateTime(row.quota?.updated_at ?? null) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.actions')" width="160">
          <template #default="{ row }">
            <el-button
              v-if="canResetSingleUser(row)"
              size="small"
              type="danger"
              plain
              :loading="resetUserLoadingId === row.id"
              @click="resetSingleUserUsage(row)"
            >
              {{ t('admin.resetSingleUserUsage') }}
            </el-button>
            <span v-else class="muted-action">-</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="userQuotaPagination.total > userQuotaPagination.pageSize"
        class="pagination"
        background
        layout="prev, pager, next"
        :current-page="userQuotaPagination.page"
        :page-size="userQuotaPagination.pageSize"
        :total="userQuotaPagination.total"
        @current-change="changeUserQuotaPage"
      />
    </section>

    <section v-if="isRootUser" class="panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.usageTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.usageTrendTitle') }}</p>
        </div>
      </div>

      <div class="usage-grid">
        <div class="trend-board">
          <div v-if="trendRows.length > 0" class="trend-bars">
            <article v-for="item in trendRows" :key="item.date" class="trend-bar-card">
              <div class="trend-bar-shell">
                <div class="trend-bar-fill" :style="trendBarStyle(item.power, maxTrendPower)"></div>
              </div>
              <strong>{{ formatPower(item.power) }}</strong>
              <span>{{ item.date }}</span>
            </article>
          </div>
          <el-empty v-else :description="t('admin.noQuotaData')" />
        </div>

        <div class="ranking-board">
          <h4>{{ t('admin.userRankingTitle') }}</h4>
          <ol v-if="rankedUsers.length > 0" class="ranking-list">
            <li v-for="item in rankedUsers" :key="item.userId" class="ranking-item">
              <div>
                <strong>{{ item.username }}</strong>
                <span>#{{ item.userId }}</span>
              </div>
              <span>{{ formatPower(item.power) }}</span>
            </li>
          </ol>
          <el-empty v-else :description="t('admin.noQuotaData')" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAdminBalance,
  getAdminConfig,
  getAdminUsage,
  getEnabledProviders,
  getQuotaSummary,
  getUserQuotas,
  resetQuotaUsage,
  resetUserQuotaUsage,
  saveAdminConfig,
  updateDefaultQuotaLimit,
  type Pagination,
  type QuotaSummary,
  type UserQuotaItem,
} from '../api'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../composables/usePermissions'

interface AdminUsageSnapshot {
  totalCredits: number
  totalPower: number
  userRanking: Array<{ userId: number; username: string; credits: number; power: number }>
  dailyTrend: Array<{ date: string; credits: number; power: number }>
}

const { t, locale } = useI18n()
const {
  isRootUser,
} = usePermissions()
const providers = ref<string[]>([])
const configs = reactive<Record<string, { configured: boolean; apiKeyMasked?: string; region?: 'ai' | 'com' }>>({})
const balances = reactive<Record<string, { available?: number; availablePower?: number; configured?: boolean } | undefined>>({})
const draftKeys = reactive<Record<string, string>>({})
const adminUsage = ref<AdminUsageSnapshot | null>(null)
const quotaSummary = ref<QuotaSummary | null>(null)
const quotaLimitDraft = ref(0)
const userSearch = ref('')
const userQuotas = ref<UserQuotaItem[]>([])
const userQuotaPagination = ref<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 })

const providerLoading = ref(false)
const quotaLoading = ref(false)
const limitSaving = ref(false)
const resetLoading = ref(false)
const resetUserLoadingId = ref<number | null>(null)
const userQuotaLoading = ref(false)

const providerConsoleTotalPower = computed(() =>
  Number(
    providers.value
      .reduce((sum, provider) => sum + (balances[provider]?.availablePower ?? 0), 0)
      .toFixed(2)
  )
)
const quotaLimit = computed(() => quotaSummary.value?.quota_limit ?? 0)
const maxTrendPower = computed(() =>
  Math.max(1, ...(adminUsage.value?.dailyTrend ?? []).map((item) => item.power))
)
const rankedUsers = computed(() => adminUsage.value?.userRanking ?? [])
const trendRows = computed(() => adminUsage.value?.dailyTrend ?? [])
const summaryCards = computed(() => {
  const cards = [
    {
      key: 'limit',
      label: t('admin.defaultQuotaLimit'),
      value: formatPower(quotaLimit.value),
      meta: t('admin.defaultQuotaLimitMeta'),
      tone: 'green',
    },
    {
      key: 'used',
      label: t('admin.totalUsedPower'),
      value: formatPower(quotaSummary.value?.total_used_power ?? 0),
      meta: t('admin.usedUserCountMeta', { count: quotaSummary.value?.used_user_count ?? 0 }),
      tone: 'orange',
    },
  ]

  if (!isRootUser.value) {
    return cards
  }

  return [
    {
      key: 'provider',
      label: t('admin.providerTotalPower'),
      value: formatPower(providerConsoleTotalPower.value),
      meta: t('admin.providerTotalPowerMeta'),
      tone: 'blue',
    },
    ...cards,
    {
      key: 'usage',
      label: t('admin.usageTitle'),
      value: formatPower(adminUsage.value?.totalPower ?? 0),
      meta: t('admin.usageTotalMeta'),
      tone: 'purple',
    },
  ]
})

async function loadProviderData() {
  if (!isRootUser.value) {
    return
  }

  providerLoading.value = true
  try {
    const providerResponse = await getEnabledProviders()
    providers.value = providerResponse.data.providers

    await Promise.all(
      providers.value.map(async (provider) => {
        const [configResponse] = await Promise.all([
          getAdminConfig(provider),
          loadBalance(provider),
        ])
        configs[provider] = configResponse.data
      })
    )
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    providerLoading.value = false
  }
}

async function loadBalance(provider: string) {
  try {
    const response = await getAdminBalance(provider)
    balances[provider] = response.data
  } catch {
    balances[provider] = { configured: false, availablePower: 0, available: 0 }
  }
}

async function save(provider: string) {
  const key = draftKeys[provider]?.trim()
  if (!key) {
    ElMessage.warning(t('admin.apiKeyRequired'))
    return
  }

  try {
    const response = await saveAdminConfig(key, provider)
    configs[provider] = {
      configured: true,
      apiKeyMasked: `${key.slice(0, 8)}****`,
      region: response.data.region,
    }
    draftKeys[provider] = ''
    ElMessage.success(t('common.saved'))
    await loadBalance(provider)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

async function loadQuotaData() {
  quotaLoading.value = true
  try {
    const summaryResponse = await getQuotaSummary()
    quotaSummary.value = summaryResponse.data.data
    quotaLimitDraft.value = quotaSummary.value.quota_limit
    if (isRootUser.value) {
      const usageResponse = await getAdminUsage()
      adminUsage.value = usageResponse.data
    } else {
      adminUsage.value = null
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    quotaLoading.value = false
  }
}

async function saveDefaultLimit() {
  limitSaving.value = true
  try {
    const response = await updateDefaultQuotaLimit(quotaLimitDraft.value)
    quotaSummary.value = response.data.data
    quotaLimitDraft.value = quotaSummary.value.quota_limit
    ElMessage.success(t('common.saved'))
    await loadUserQuotas(userQuotaPagination.value.page)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('common.saveFailed'))
  } finally {
    limitSaving.value = false
  }
}

async function resetAllUsage() {
  try {
    await ElMessageBox.confirm(
      t('admin.resetUsageConfirmMessage'),
      t('admin.resetUsageConfirmTitle'),
      {
        confirmButtonText: t('admin.resetAllUsage'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
  } catch {
    return
  }

  resetLoading.value = true
  try {
    const response = await resetQuotaUsage()
    quotaSummary.value = response.data.data.summary
    quotaLimitDraft.value = quotaSummary.value.quota_limit
    ElMessage.success(t('admin.resetUsageSuccess', {
      count: response.data.data.affectedUsers,
      power: response.data.data.clearedPower,
    }))
    await loadUserQuotas(userQuotaPagination.value.page)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.resetUsageFailed'))
  } finally {
    resetLoading.value = false
  }
}

function canResetSingleUser(row: UserQuotaItem) {
  const roles = row.roles ?? []
  return roles.includes('user')
    && !roles.some((role) => role === 'root' || role === 'admin' || role === 'manager')
}

async function resetSingleUserUsage(row: UserQuotaItem) {
  try {
    await ElMessageBox.confirm(
      t('admin.resetSingleUserConfirmMessage', {
        user: row.nickname || row.username || `#${row.id}`,
      }),
      t('admin.resetUsageConfirmTitle'),
      {
        confirmButtonText: t('admin.resetSingleUserUsage'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
  } catch {
    return
  }

  resetUserLoadingId.value = row.id
  try {
    const response = await resetUserQuotaUsage(row.id)
    quotaSummary.value = response.data.data.summary
    quotaLimitDraft.value = quotaSummary.value.quota_limit
    ElMessage.success(t('admin.resetSingleUserSuccess', {
      user: row.nickname || row.username || `#${row.id}`,
      power: response.data.data.clearedPower,
    }))
    await loadUserQuotas(userQuotaPagination.value.page)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.resetUsageFailed'))
  } finally {
    resetUserLoadingId.value = null
  }
}

async function searchUserQuotas() {
  await loadUserQuotas(1)
}

async function changeUserQuotaPage(page: number) {
  await loadUserQuotas(page)
}

async function loadUserQuotas(page = 1) {
  userQuotaLoading.value = true
  try {
    const response = await getUserQuotas({
      search: userSearch.value.trim() || undefined,
      page,
      pageSize: userQuotaPagination.value.pageSize,
    })
    userQuotas.value = response.data.data
    userQuotaPagination.value = response.data.pagination
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    userQuotaLoading.value = false
  }
}

function formatDateTime(value: string | Date | null) {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString(locale.value)
}

function formatPower(value: number) {
  return t('admin.powerValue', { value: Number(value.toFixed(2)) })
}

function formatRawCredits(value: number | undefined) {
  if (value === undefined) {
    return '-'
  }
  return Number(value.toFixed(2))
}

function formatProviderBalanceFootnote(provider: string) {
  const balance = balances[provider]
  if (!balance?.configured) {
    return t('admin.balanceUnavailable')
  }
  return t('admin.balancePower', {
    availablePower: Number((balance.availablePower ?? 0).toFixed(2)),
    available: Number((balance.available ?? 0).toFixed(2)),
  })
}

function trendBarStyle(value: number, maxValue: number) {
  const ratio = Math.max(0.08, Math.min(1, value / maxValue))
  return { height: `${ratio * 100}%` }
}

onMounted(async () => {
  const tasks = [
    loadQuotaData(),
    loadUserQuotas(),
  ]
  if (isRootUser.value) {
    tasks.push(loadProviderData())
  }
  await Promise.all(tasks)
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24px;
  background: #f6f8fb;
  color: #18202f;
}

.hero-panel,
.panel {
  max-width: 1180px;
  margin: 0 auto 18px;
}

.hero-panel {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.5fr);
  gap: 18px;
  align-items: stretch;
}

.hero-copy,
.panel {
  border: 1px solid #dce4ef;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 14px 32px rgba(24, 32, 47, 0.06);
}

.hero-copy {
  padding: 24px;
}

.eyebrow {
  margin: 0 0 10px;
  color: #3f63d7;
  font-size: 13px;
  font-weight: 700;
}

h2,
h3,
h4,
p {
  margin: 0;
}

h2 {
  font-size: 28px;
  line-height: 1.25;
}

h3 {
  font-size: 18px;
}

.hero-description,
.panel-hint,
.provider-subtitle,
.provider-footnote,
.user-cell span,
.summary-meta {
  color: #657187;
}

.hero-description {
  margin-top: 10px;
  line-height: 1.6;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.provider-card,
.metric-card,
.quota-kpi,
.trend-board,
.ranking-board {
  border: 1px solid #dce4ef;
  background: #ffffff;
  border-radius: 8px;
}

.summary-card {
  padding: 18px;
}

.summary-label,
.quota-kpi span,
.metric-card span {
  display: block;
  color: #657187;
  font-size: 13px;
}

.summary-value {
  display: block;
  margin: 8px 0 6px;
  font-size: 24px;
}

.panel {
  padding: 20px;
}

.panel-head,
.provider-card__top,
.provider-actions,
.panel-actions,
.quota-limit-control,
.user-quota-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.panel-head {
  justify-content: space-between;
  margin-bottom: 18px;
}

.panel-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.provider-card {
  padding: 16px;
}

.provider-card__top,
.provider-actions {
  justify-content: space-between;
}

.provider-name {
  font-weight: 800;
}

.provider-region-label {
  margin-top: 4px;
  color: #3f63d7;
  font-size: 12px;
}

.status-pill {
  flex: none;
  border-radius: 999px;
  padding: 5px 10px;
  background: #f2f5fa;
  color: #657187;
  font-size: 12px;
  font-weight: 700;
}

.status-pill[data-ready='true'] {
  background: #e7f7ef;
  color: #137a47;
}

.provider-metrics,
.quota-summary-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}

.provider-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric-card,
.quota-kpi {
  padding: 12px;
}

.metric-card strong,
.quota-kpi strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
}

.provider-actions .el-input {
  min-width: 0;
}

.actions {
  display: flex;
  gap: 8px;
}

.quota-config {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.4fr);
  gap: 16px;
  margin-bottom: 16px;
}

.quota-limit-control {
  justify-content: flex-start;
  border: 1px solid #dce4ef;
  border-radius: 8px;
  padding: 14px;
  background: #fbfcfe;
}

.quota-scope-badge {
  display: grid;
  gap: 6px;
  align-content: center;
  border: 1px solid #dce4ef;
  border-radius: 8px;
  padding: 14px;
  background: #fbfcfe;
}

.quota-limit-control span,
.quota-scope-badge span {
  font-weight: 700;
}

.quota-scope-badge strong {
  color: #3f63d7;
}

.user-quota-toolbar {
  margin-bottom: 14px;
}

.user-quota-toolbar .el-input {
  max-width: 360px;
}

.quota-table {
  width: 100%;
}

.user-cell {
  display: grid;
  gap: 2px;
}

.muted-action {
  color: #9aa5b5;
}

.pagination {
  justify-content: flex-end;
  margin-top: 16px;
}

.usage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 16px;
}

.trend-board,
.ranking-board {
  padding: 16px;
}

.trend-bars {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
  gap: 10px;
  align-items: end;
  min-height: 220px;
}

.trend-bar-card {
  display: grid;
  gap: 8px;
  align-content: end;
  min-height: 210px;
}

.trend-bar-shell {
  display: flex;
  align-items: end;
  height: 150px;
  border-radius: 6px;
  background: #eef3f8;
  overflow: hidden;
}

.trend-bar-fill {
  width: 100%;
  background: #3f63d7;
  border-radius: 6px 6px 0 0;
}

.trend-bar-card strong,
.trend-bar-card span {
  text-align: center;
}

.trend-bar-card span {
  color: #657187;
  font-size: 12px;
}

.ranking-board h4 {
  margin-bottom: 10px;
}

.ranking-list {
  display: grid;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ranking-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #edf1f6;
}

.ranking-item div {
  display: grid;
  gap: 2px;
}

.ranking-item span {
  color: #657187;
}

@media (max-width: 900px) {
  .page {
    padding: 16px;
  }

  .hero-panel,
  .quota-config,
  .usage-grid {
    grid-template-columns: 1fr;
  }

  .summary-grid,
  .quota-summary-strip {
    grid-template-columns: 1fr;
  }

  .panel-head,
  .provider-card__top,
  .provider-actions,
  .quota-limit-control,
  .user-quota-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .panel-actions,
  .actions {
    width: 100%;
  }

  .actions .el-button,
  .panel-actions .el-button,
  .user-quota-toolbar .el-button {
    flex: 1;
  }
}
</style>
