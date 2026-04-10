<template>
  <div class="page">
    <section class="hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">{{ t('nav.admin') }}</p>
        <h2>{{ t('admin.quotaOverviewTitle') }}</h2>
        <p class="hero-description">{{ t('admin.dashboardSubtitle') }}</p>
      </div>

      <div class="summary-grid">
        <article
          v-for="card in summaryCards"
          :key="card.key"
          class="summary-card"
          :data-tone="card.tone"
        >
          <span class="summary-label">{{ card.label }}</span>
          <strong class="summary-value">{{ card.value }}</strong>
          <span class="summary-meta">{{ card.meta }}</span>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.providerOpsTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.providerOpsHint') }}</p>
        </div>
        <el-button type="primary" @click="openCompatRechargeModal">
          {{ t('admin.compatRechargeAction') }}
        </el-button>
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

          <p class="provider-footnote">
            {{
              t('admin.balancePower', {
                availablePower: balances[provider]?.availablePower ?? 0,
                available: balances[provider]?.available ?? 0,
              })
            }}
          </p>

          <div class="provider-actions">
            <el-input
              v-model="draftKeys[provider]"
              type="password"
              :placeholder="t('admin.apiKeyPlaceholder')"
            />
            <div class="actions">
              <el-button @click="loadBalance(provider)">{{ t('admin.checkBalance') }}</el-button>
              <el-button type="primary" @click="save(provider)">{{ t('common.save') }}</el-button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.quotaOverviewTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.quotaOverviewHint') }}</p>
        </div>
        <el-button :loading="quotaLoading" @click="loadQuotaStatus">{{ t('admin.loadQuota') }}</el-button>
      </div>

      <div v-if="quotaStatus" class="quota-console">
        <div class="quota-console__head">
          <div>
            <h4>{{ t('admin.quotaOverviewTitle') }}</h4>
            <p>{{ t('admin.quotaOverviewHint') }}</p>
          </div>
          <span class="quota-status-pill" :data-tone="quotaStatusTone">{{ quotaStatusLabel }}</span>
        </div>

        <div class="quota-kpi-strip">
          <article v-for="item in quotaKpis" :key="item.key" class="quota-kpi">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>

        <div class="quota-console__grid">
          <section class="pond-chamber">
            <span class="section-label">{{ t('admin.pondChamberTitle') }}</span>
            <div class="pond-chamber__tank">
              <div class="pond-chamber__fill" :style="poolFillStyle(quotaStatus)">
                <span class="pond-chamber__glow"></span>
              </div>
              <div class="pond-chamber__overlay">
                <strong>{{ formatPower(quotaStatus.pool_balance) }}</strong>
                <small>{{ t('admin.poolBaseline') }} {{ formatPower(quotaStatus.pool_baseline) }}</small>
              </div>
            </div>
          </section>

          <section class="wallet-cockpit">
            <span class="section-label">{{ t('admin.walletScheduleTitle') }}</span>
            <div class="wallet-cockpit__reserve">
              <div class="wallet-cockpit__track">
                <div class="wallet-cockpit__fill" :style="walletFillStyle(quotaStatus)"></div>
              </div>
              <strong>{{ formatPower(quotaStatus.wallet_balance) }}</strong>
            </div>

            <dl class="wallet-cockpit__metrics">
              <div>
                <dt>{{ t('admin.poolBaseline') }}</dt>
                <dd>{{ formatPower(quotaStatus.pool_baseline) }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.cyclesRemaining') }}</dt>
                <dd>{{ quotaStatus.cycles_remaining }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.cycleStartedAt') }}</dt>
                <dd>{{ formatDateTime(quotaStatus.cycle_started_at) }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.nextCycleAt') }}</dt>
                <dd>{{ formatDateTime(quotaStatus.next_cycle_at) }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.totalDuration') }}</dt>
                <dd>{{ quotaStatus.total_duration }}</dd>
              </div>
              <div>
                <dt>{{ t('admin.cycleDuration') }}</dt>
                <dd>{{ quotaStatus.cycle_duration }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <el-empty
        v-else
        :description="t('admin.quotaEmpty')"
      />
    </section>

    <section class="panel">
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
          <el-empty v-else :description="t('admin.queryFailed')" />
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

    <el-dialog
      v-model="showCompatRechargeModal"
      :title="t('admin.rechargeTitle')"
      width="760px"
    >
      <div class="compat-console">
        <section class="compat-console__form">
          <p class="panel-hint">{{ t('admin.rechargeHint') }}</p>

          <div class="compat-grid">
            <label class="field field--wide">
              <span>{{ t('admin.compatTotalPower') }}</span>
              <el-input-number
                v-model="compatRechargeForm.totalPower"
                :min="0"
                :precision="2"
                :step="10"
              />
            </label>
            <label class="field">
              <span>{{ t('admin.compatWalletPercent') }}</span>
              <el-input-number
                v-model="compatRechargeForm.walletPercent"
                :min="0"
                :max="100"
                :precision="0"
              />
            </label>
            <label class="field">
              <span>{{ t('admin.compatPoolPercent') }}</span>
              <el-input-number
                v-model="compatRechargeForm.poolPercent"
                :min="0"
                :max="100"
                :precision="0"
              />
            </label>
            <label class="field">
              <span>{{ t('admin.compatTotalDays') }}</span>
              <el-input-number
                v-model="compatRechargeForm.totalDays"
                :min="0"
                :precision="0"
              />
            </label>
            <label class="field">
              <span>{{ t('admin.compatTotalHours') }}</span>
              <el-input-number
                v-model="compatRechargeForm.totalHours"
                :min="0"
                :max="23"
                :precision="0"
              />
            </label>
            <label class="field field--wide">
              <span>{{ t('admin.compatCycleHours') }}</span>
              <el-input-number
                v-model="compatRechargeForm.cycleHours"
                :min="1"
                :precision="0"
              />
            </label>
          </div>
        </section>

        <aside class="compat-console__preview">
          <h4>{{ t('admin.previewDockTitle') }}</h4>
          <div class="compat-console__preview-grid">
            <div class="preview-card">
              <span>{{ t('admin.compatPreviewWallet') }}</span>
              <strong>{{ formatPower(compatRechargePreview.walletAmount) }}</strong>
            </div>
            <div class="preview-card">
              <span>{{ t('admin.compatPreviewPool') }}</span>
              <strong>{{ formatPower(compatRechargePreview.poolAmount) }}</strong>
            </div>
            <div class="preview-card">
              <span>{{ t('admin.compatPreviewTotalHours') }}</span>
              <strong>{{ compatRechargePreview.totalHours }}h</strong>
            </div>
            <div class="preview-card">
              <span>{{ t('admin.compatPreviewCycleHours') }}</span>
              <strong>{{ compatRechargeForm.cycleHours }}h</strong>
            </div>
          </div>
        </aside>
      </div>

      <template #footer>
        <div class="dialog-actions">
          <el-button @click="showCompatRechargeModal = false">{{ t('common.cancel') }}</el-button>
          <el-button
            type="primary"
            :loading="compatRechargeLoading"
            @click="submitCompatRecharge"
          >
            {{ t('admin.recharge') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAdminBalance,
  getAdminConfig,
  getAdminUsage,
  getEnabledProviders,
  getSitePowerStatus,
  rechargeSitePower,
  saveAdminConfig,
  type PowerAccountStatus,
} from '../api'
import { useI18n } from 'vue-i18n'

interface AdminUsageSnapshot {
  totalCredits: number
  totalPower: number
  userRanking: Array<{ userId: number; username: string; credits: number; power: number }>
  dailyTrend: Array<{ date: string; credits: number; power: number }>
}

const { t, locale } = useI18n()
const providers = ref<string[]>([])
const configs = reactive<Record<string, { configured: boolean; apiKeyMasked?: string }>>({})
const balances = reactive<Record<string, { available?: number; availablePower?: number; configured?: boolean } | undefined>>({})
const draftKeys = reactive<Record<string, string>>({})
const adminUsage = ref<AdminUsageSnapshot | null>(null)

const quotaStatus = ref<PowerAccountStatus | null>(null)
const quotaLoading = ref(false)
const showCompatRechargeModal = ref(false)
const compatRechargeLoading = ref(false)
const compatRechargeForm = reactive({
  totalPower: 0,
  walletPercent: 50,
  poolPercent: 50,
  totalDays: 7,
  totalHours: 0,
  cycleHours: 24,
})

const totalWallet = computed(() => quotaStatus.value?.wallet_balance ?? 0)
const totalPool = computed(() => quotaStatus.value?.pool_balance ?? 0)
const totalBaseline = computed(() => quotaStatus.value?.pool_baseline ?? 0)
const totalQuota = computed(() => totalWallet.value + totalPool.value)
const maxWalletBalance = computed(() => Math.max(1, quotaStatus.value?.wallet_balance ?? 0))
const maxTrendPower = computed(() =>
  Math.max(1, ...(adminUsage.value?.dailyTrend ?? []).map((item) => item.power))
)
const rankedUsers = computed(() => adminUsage.value?.userRanking ?? [])
const trendRows = computed(() => adminUsage.value?.dailyTrend ?? [])
const quotaStatusTone = computed(() => {
  const status = quotaStatus.value
  if (!status) {
    return 'standby'
  }

  const total = status.wallet_balance + status.pool_balance
  if (total <= 0) {
    return 'depleted'
  }
  if (status.wallet_balance <= 0 || status.pool_balance <= 0) {
    return 'low'
  }

  return 'online'
})
const quotaStatusLabel = computed(() => {
  if (quotaStatusTone.value === 'online') {
    return t('admin.statusOnline')
  }
  if (quotaStatusTone.value === 'low') {
    return t('admin.statusLowReserve')
  }
  if (quotaStatusTone.value === 'depleted') {
    return t('admin.statusDepleted')
  }

  return t('admin.statusStandby')
})
const quotaKpis = computed(() => [
  {
    key: 'total',
    label: t('admin.totalPowerCard'),
    value: formatPower(totalQuota.value),
  },
  {
    key: 'wallet',
    label: t('admin.walletBalance'),
    value: formatPower(totalWallet.value),
  },
  {
    key: 'pool',
    label: t('admin.poolBalance'),
    value: formatPower(totalPool.value),
  },
  {
    key: 'cycles',
    label: t('admin.cyclesRemaining'),
    value: String(quotaStatus.value?.cycles_remaining ?? 0),
  },
])
const compatRechargePreview = computed(() => {
  const totalHours = compatRechargeForm.totalDays * 24 + compatRechargeForm.totalHours
  const walletAmount = Number(
    (compatRechargeForm.totalPower * compatRechargeForm.walletPercent / 100).toFixed(2)
  )
  const poolAmount = Number(
    (compatRechargeForm.totalPower * compatRechargeForm.poolPercent / 100).toFixed(2)
  )

  return {
    walletAmount,
    poolAmount,
    totalDuration: totalHours * 60,
    cycleDuration: compatRechargeForm.cycleHours * 60,
    totalHours,
  }
})

const summaryCards = computed(() => [
  {
    key: 'quota',
    tone: 'ocean',
    label: t('admin.totalPowerCard'),
    value: formatPower(totalQuota.value),
    meta: t('admin.providerCountValue', { count: providers.value.length }),
  },
  {
    key: 'wallet',
    tone: 'sun',
    label: t('admin.walletTotal'),
    value: formatPower(totalWallet.value),
    meta: t('admin.walletBalance'),
  },
  {
    key: 'pool',
    tone: 'mint',
    label: t('admin.poolTotal'),
    value: formatPower(totalPool.value),
    meta: t('admin.poolLevel'),
  },
  {
    key: 'baseline',
    tone: 'slate',
    label: t('admin.poolBaselineTotal'),
    value: formatPower(totalBaseline.value),
    meta: t('admin.poolBaseline'),
  },
  {
    key: 'usage',
    tone: 'rose',
    label: t('admin.usageTitle'),
    value: formatPower(adminUsage.value?.totalPower ?? 0),
    meta: t('admin.userRankingTitle'),
  },
])

onMounted(async () => {
  try {
    const providerResponse = await getEnabledProviders()
    providers.value = providerResponse.data.providers ?? []
    await Promise.allSettled(
      providers.value.map(async (provider) => {
        await loadConfig(provider)
        await loadBalance(provider)
      })
    )
    adminUsage.value = (await getAdminUsage()).data
    await loadQuotaStatus(false)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  }
})

async function loadConfig(provider: string) {
  configs[provider] = (await getAdminConfig(provider)).data
}

async function loadBalance(provider: string) {
  const response = await getAdminBalance(provider)
  balances[provider] = {
    configured: response.data.configured,
    available: response.data.available,
    availablePower: response.data.availablePower,
  }
}

async function save(provider: string) {
  try {
    await saveAdminConfig(draftKeys[provider], provider)
    await Promise.all([loadConfig(provider), loadBalance(provider)])
    draftKeys[provider] = ''
    ElMessage.success(t('common.saved'))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

async function loadQuotaStatus(showSuccess = true) {
  quotaLoading.value = true
  try {
    const response = await getSitePowerStatus()
    quotaStatus.value = response.data.data ?? null
    if (showSuccess) {
      ElMessage.success(t('admin.quotaLoaded'))
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    quotaLoading.value = false
  }
}

function openCompatRechargeModal() {
  const totalPower =
    (balances.tripo3d?.availablePower ?? 0) +
    (balances.hyper3d?.availablePower ?? 0)

  compatRechargeForm.totalPower = Number(totalPower.toFixed(2))
  showCompatRechargeModal.value = true
}

async function submitCompatRecharge() {
  if (compatRechargeForm.walletPercent + compatRechargeForm.poolPercent !== 100) {
    ElMessage.warning(t('admin.compatRechargeValidationPercent'))
    return
  }
  if (
    compatRechargePreview.value.totalHours <= 0 ||
    compatRechargePreview.value.totalHours < compatRechargeForm.cycleHours
  ) {
    ElMessage.warning(t('admin.compatRechargeValidationDuration'))
    return
  }

  compatRechargeLoading.value = true
  try {
    await rechargeSitePower({
      total_power: compatRechargeForm.totalPower,
      wallet_percent: compatRechargeForm.walletPercent,
      pool_percent: compatRechargeForm.poolPercent,
      wallet_amount: compatRechargePreview.value.walletAmount,
      pool_amount: compatRechargePreview.value.poolAmount,
      total_duration: compatRechargePreview.value.totalDuration,
      cycle_duration: compatRechargePreview.value.cycleDuration,
    })
    ElMessage.success(t('admin.rechargeSuccess'))
    await loadQuotaStatus(false)
    showCompatRechargeModal.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.rechargeFailed'))
  } finally {
    compatRechargeLoading.value = false
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

function formatRawCredits(value?: number) {
  if (typeof value !== 'number') {
    return '-'
  }
  return value.toFixed(2)
}

function poolFillStyle(status: PowerAccountStatus) {
  const ratio =
    status.pool_baseline > 0
      ? Math.min(status.pool_balance / status.pool_baseline, 1)
      : status.pool_balance > 0
        ? 1
        : 0

  return {
    height: `${Math.max(ratio * 100, status.pool_balance > 0 ? 10 : 0)}%`,
  }
}

function walletFillStyle(status: PowerAccountStatus) {
  const ratio = Math.min(status.wallet_balance / maxWalletBalance.value, 1)
  return {
    width: `${Math.max(ratio * 100, status.wallet_balance > 0 ? 8 : 0)}%`,
  }
}

function trendBarStyle(power: number, maxPower: number) {
  const ratio = maxPower > 0 ? Math.min(power / maxPower, 1) : 0
  return {
    height: `${Math.max(ratio * 100, power > 0 ? 10 : 0)}%`,
  }
}
</script>

<style scoped>
.page {
  --panel-bg: rgba(255, 255, 255, 0.9);
  --panel-border: rgba(148, 163, 184, 0.18);
  --ink-strong: #10233d;
  --ink-soft: #5c6b81;
  --ocean: linear-gradient(145deg, #083c6d, #1d6fb8);
  --mint: linear-gradient(145deg, #0e7490, #14b8a6);
  --sun: linear-gradient(145deg, #b45309, #f59e0b);
  --slate: linear-gradient(145deg, #334155, #64748b);
  --rose: linear-gradient(145deg, #be123c, #fb7185);
  display: grid;
  gap: 22px;
}

.hero-panel,
.panel {
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.72)),
    linear-gradient(180deg, rgba(248, 250, 252, 0.94), rgba(239, 246, 255, 0.84));
  border: 1px solid var(--panel-border);
  border-radius: 28px;
  box-shadow: 0 26px 60px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(14px);
}

.hero-panel {
  overflow: hidden;
  padding: 28px;
  background:
    radial-gradient(circle at top left, rgba(125, 211, 252, 0.3), transparent 38%),
    radial-gradient(circle at 85% 20%, rgba(253, 224, 71, 0.28), transparent 26%),
    linear-gradient(145deg, #061826, #0f3b5f 58%, #155e75);
  color: #f8fafc;
}

.hero-copy {
  max-width: 720px;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(226, 232, 240, 0.88);
}

.hero-panel h2,
.panel h3,
.ranking-board h4,
.quota-card h4 {
  margin: 0;
  color: inherit;
}

.hero-description,
.panel-hint {
  margin: 8px 0 0;
  color: rgba(226, 232, 240, 0.78);
  max-width: 760px;
}

.panel {
  padding: 24px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.panel-head h3,
.ranking-board h4,
.quota-card h4 {
  color: var(--ink-strong);
}

.panel-hint {
  color: var(--ink-soft);
}

.summary-grid,
.provider-grid,
.usage-grid,
.compat-grid {
  display: grid;
  gap: 16px;
}

.summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  margin-top: 24px;
}

.summary-card {
  min-height: 132px;
  padding: 18px;
  border-radius: 22px;
  display: grid;
  gap: 10px;
  align-content: start;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

.summary-card[data-tone='ocean'] {
  background: var(--ocean);
}

.summary-card[data-tone='mint'] {
  background: var(--mint);
}

.summary-card[data-tone='sun'] {
  background: var(--sun);
}

.summary-card[data-tone='slate'] {
  background: var(--slate);
}

.summary-card[data-tone='rose'] {
  background: var(--rose);
}

.summary-label,
.summary-meta {
  color: rgba(255, 255, 255, 0.82);
}

.summary-value {
  font-size: 28px;
  line-height: 1.1;
}

.provider-grid {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.provider-card,
.quota-card,
.trend-board,
.ranking-board {
  background: var(--panel-bg);
  border: 1px solid rgba(226, 232, 240, 0.86);
  border-radius: 22px;
  padding: 18px;
}

.provider-card__top,
.quota-card__head,
.actions,
.ranking-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.provider-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink-strong);
}

.provider-subtitle {
  margin: 8px 0 0;
  color: var(--ink-soft);
}

.status-pill {
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(148, 163, 184, 0.16);
  color: #334155;
}

.status-pill[data-ready='true'] {
  background: rgba(20, 184, 166, 0.14);
  color: #0f766e;
}

.provider-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.metric-card {
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(226, 232, 240, 0.68));
  border: 1px solid rgba(203, 213, 225, 0.7);
}

.metric-card span,
.widget-label {
  display: block;
  color: var(--ink-soft);
  font-size: 13px;
}

.metric-card strong,
.wallet-meter strong,
.pond-overlay strong,
.trend-bar-card strong {
  display: block;
  margin-top: 6px;
  color: var(--ink-strong);
  font-size: 18px;
}

.provider-actions {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.provider-footnote {
  margin: 14px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
}

.field {
  display: grid;
  gap: 8px;
  color: var(--ink-soft);
  font-size: 14px;
}

.field--wide {
  max-width: 320px;
}

.compat-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.compat-grid .field--wide {
  grid-column: 1 / -1;
  max-width: none;
}

.quota-visual-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 18px;
}

.quota-visuals {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
  align-items: center;
}

.pond-shell {
  position: relative;
  height: 184px;
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(14, 116, 144, 0.18);
  background:
    linear-gradient(180deg, rgba(224, 242, 254, 0.8), rgba(186, 230, 253, 0.45)),
    repeating-linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.28) 0,
      rgba(255, 255, 255, 0.28) 1px,
      transparent 1px,
      transparent 28px
    );
}

.pond-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.86), rgba(14, 116, 144, 0.96));
  transition: height 220ms ease;
}

.pond-fill__glow {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 12px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
}

.pond-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 14px;
}

.pond-overlay small {
  color: rgba(15, 23, 42, 0.62);
}

.wallet-meter {
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 251, 235, 0.98), rgba(254, 243, 199, 0.72));
  border: 1px solid rgba(245, 158, 11, 0.24);
}

.wallet-meter__track {
  height: 18px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(217, 119, 6, 0.12);
}

.wallet-meter__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #f59e0b, #b45309);
  transition: width 220ms ease;
}

.status-list {
  display: grid;
  gap: 10px;
  margin: 18px 0 0;
}

.status-list div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.status-list dt {
  color: var(--ink-soft);
}

.status-list dd {
  margin: 0;
  color: var(--ink-strong);
  font-weight: 700;
  text-align: right;
}

.actions {
  margin-top: 18px;
  align-items: center;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.compat-preview {
  margin: 18px 0 0;
}

.usage-grid {
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
}

.trend-bars {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 14px;
  align-items: end;
}

.trend-bar-card {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.trend-bar-shell {
  width: 100%;
  min-height: 180px;
  display: flex;
  align-items: flex-end;
  padding: 10px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(241, 245, 249, 0.94), rgba(226, 232, 240, 0.78));
}

.trend-bar-fill {
  width: 100%;
  border-radius: 12px 12px 8px 8px;
  background: linear-gradient(180deg, #22c55e, #15803d);
  transition: height 220ms ease;
}

.trend-bar-card span {
  color: var(--ink-soft);
  font-size: 13px;
  text-align: center;
}

.ranking-list {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.ranking-item {
  padding: 14px 0;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  color: var(--ink-strong);
}

.ranking-item strong,
.ranking-item span {
  display: block;
}

.ranking-item div span {
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: 13px;
}

@media (max-width: 960px) {
  .usage-grid,
  .quota-visuals,
  .compat-grid {
    grid-template-columns: 1fr;
  }

  .provider-card__top,
  .panel-head,
  .quota-card__head,
  .actions,
  .ranking-item {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
