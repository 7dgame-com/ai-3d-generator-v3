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

      <div class="quota-toolbar">
        <label class="field field--wide">
          <span>{{ t('admin.userId') }}</span>
          <el-input-number
            v-model="targetUserId"
            :min="1"
            :precision="0"
            :step="1"
            controls-position="right"
          />
        </label>
      </div>

      <div v-if="quotaStatus" class="quota-visual-grid">
        <article class="quota-card">
          <div class="quota-card__head">
            <div>
              <h4>{{ t('admin.totalPowerCard') }}</h4>
              <p>{{ t('admin.powerValue', { value: totalQuota }) }}</p>
            </div>
            <el-tag type="info">{{ t('admin.statusLabel') }}</el-tag>
          </div>

          <div class="quota-visuals">
            <div class="pond-widget">
              <span class="widget-label">{{ t('admin.poolLevel') }}</span>
              <div class="pond-shell">
                <div class="pond-fill" :style="poolFillStyle(quotaStatus)">
                  <span class="pond-fill__glow"></span>
                </div>
                <div class="pond-overlay">
                  <strong>{{ formatPower(quotaStatus.pool_balance) }}</strong>
                  <small>{{ t('admin.poolBaseline') }} {{ formatPower(quotaStatus.pool_baseline) }}</small>
                </div>
              </div>
            </div>

            <div class="wallet-widget">
              <span class="widget-label">{{ t('admin.walletReserve') }}</span>
              <div class="wallet-meter">
                <div class="wallet-meter__track">
                  <div class="wallet-meter__fill" :style="walletFillStyle(quotaStatus)"></div>
                </div>
                <strong>{{ formatPower(quotaStatus.wallet_balance) }}</strong>
              </div>
            </div>
          </div>

          <dl class="status-list">
            <div>
              <dt>{{ t('admin.walletBalance') }}</dt>
              <dd>{{ formatPower(quotaStatus.wallet_balance) }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.poolBalance') }}</dt>
              <dd>{{ formatPower(quotaStatus.pool_balance) }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.poolBaseline') }}</dt>
              <dd>{{ formatPower(quotaStatus.pool_baseline) }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.cyclesRemaining') }}</dt>
              <dd>{{ quotaStatus.cycles_remaining }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.cycleDuration') }}</dt>
              <dd>{{ quotaStatus.cycle_duration }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.totalDuration') }}</dt>
              <dd>{{ quotaStatus.total_duration }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.cycleStartedAt') }}</dt>
              <dd>{{ formatDateTime(quotaStatus.cycle_started_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.nextCycleAt') }}</dt>
              <dd>{{ formatDateTime(quotaStatus.next_cycle_at) }}</dd>
            </div>
          </dl>
        </article>
      </div>
      <el-empty
        v-else
        :description="targetUserId ? t('admin.noQuotaData') : t('admin.quotaEmpty')"
      />
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>{{ t('admin.rechargeTitle') }}</h3>
          <p class="panel-hint">{{ t('admin.rechargeHint') }}</p>
        </div>
      </div>

      <div class="recharge-grid">
        <label class="field">
          <span>{{ t('admin.walletAmount') }}</span>
          <el-input-number v-model="rechargeForm.wallet_amount" :min="1" :precision="2" :step="10" />
        </label>
        <label class="field">
          <span>{{ t('admin.poolAmount') }}</span>
          <el-input-number v-model="rechargeForm.pool_amount" :min="0" :precision="2" :step="10" />
        </label>
        <label class="field">
          <span>{{ t('admin.totalDuration') }}</span>
          <el-input-number
            v-model="rechargeForm.total_duration"
            :min="rechargeForm.cycle_duration"
            :precision="0"
            :step="60"
          />
        </label>
        <label class="field">
          <span>{{ t('admin.cycleDuration') }}</span>
          <el-input-number
            v-model="rechargeForm.cycle_duration"
            :min="60"
            :max="43200"
            :precision="0"
            :step="60"
          />
        </label>
      </div>

      <div class="actions">
        <el-button type="primary" :loading="rechargeLoading" @click="submitRecharge">
          {{ t('admin.recharge') }}
        </el-button>
      </div>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAdminBalance,
  getAdminConfig,
  getAdminCreditStatus,
  getAdminUsage,
  getEnabledProviders,
  rechargeAdminCredits,
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

const targetUserId = ref<number | undefined>()
const quotaStatus = ref<PowerAccountStatus | null>(null)
const quotaLoading = ref(false)
const rechargeLoading = ref(false)
const rechargeForm = reactive({
  wallet_amount: 300,
  pool_amount: 100,
  total_duration: 43200,
  cycle_duration: 1440,
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

async function loadQuotaStatus() {
  if (!targetUserId.value) {
    ElMessage.warning(t('common.required', { field: t('admin.userId') }))
    return
  }

  quotaLoading.value = true
  try {
    const response = await getAdminCreditStatus(targetUserId.value)
    quotaStatus.value = response.data.data ?? null
    ElMessage.success(t('admin.quotaLoaded'))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    quotaLoading.value = false
  }
}

async function submitRecharge() {
  if (!targetUserId.value) {
    ElMessage.warning(t('common.required', { field: t('admin.userId') }))
    return
  }

  rechargeLoading.value = true
  try {
    await rechargeAdminCredits({
      userId: targetUserId.value,
      wallet_amount: rechargeForm.wallet_amount,
      pool_amount: rechargeForm.pool_amount,
      total_duration: rechargeForm.total_duration,
      cycle_duration: rechargeForm.cycle_duration,
    })
    ElMessage.success(t('admin.rechargeSuccess'))
    await loadQuotaStatus()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.rechargeFailed'))
  } finally {
    rechargeLoading.value = false
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
.recharge-grid,
.usage-grid {
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

.quota-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 320px));
  gap: 16px;
  margin-bottom: 18px;
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

.recharge-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.actions {
  margin-top: 18px;
  align-items: center;
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
  .quota-visuals {
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
