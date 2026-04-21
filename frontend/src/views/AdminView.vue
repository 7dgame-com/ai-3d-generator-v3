<template>
  <div class="page">
    <section class="hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">{{ t('nav.admin') }}</p>
        <h2>{{ t('admin.quotaOverviewTitle') }}</h2>
        <p class="hero-description">{{ t('admin.dashboardSubtitle') }}</p>
      </div>

      <div v-if="heroInitialLoading" class="summary-grid" data-test="hero-skeleton">
        <article
          v-for="index in 5"
          :key="`hero-skeleton-${index}`"
          class="summary-card summary-card--skeleton"
        >
          <span class="skeleton-block skeleton-block--label"></span>
          <span class="skeleton-block skeleton-block--value"></span>
          <span class="skeleton-block skeleton-block--meta"></span>
        </article>
      </div>
      <div v-else class="summary-grid">
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

      <div v-if="providerInitialLoading" class="provider-grid" data-test="provider-skeleton">
        <article
          v-for="index in providerSkeletonCount"
          :key="`provider-skeleton-${index}`"
          class="provider-card provider-card--skeleton"
        >
          <div class="provider-card__top">
            <div class="provider-card__skeleton-copy">
              <span class="skeleton-block skeleton-block--name"></span>
              <span class="skeleton-block skeleton-block--subtitle"></span>
            </div>
            <span class="status-pill status-pill--skeleton"></span>
          </div>

          <div class="provider-metrics">
            <div class="metric-card metric-card--skeleton">
              <span class="skeleton-block skeleton-block--label"></span>
              <span class="skeleton-block skeleton-block--metric"></span>
            </div>
            <div class="metric-card metric-card--skeleton">
              <span class="skeleton-block skeleton-block--label"></span>
              <span class="skeleton-block skeleton-block--metric"></span>
            </div>
          </div>

          <span class="skeleton-block skeleton-block--paragraph"></span>

          <div class="provider-actions provider-actions--skeleton">
            <span class="skeleton-block skeleton-block--input"></span>
            <div class="actions">
              <span class="skeleton-block skeleton-block--button"></span>
              <span class="skeleton-block skeleton-block--button"></span>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="provider-grid">
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

      <div
        v-if="sitePowerInitialLoading"
        class="quota-console quota-console--skeleton"
        data-test="site-power-skeleton"
      >
        <div class="quota-console__head">
          <div class="quota-console__skeleton-copy">
            <span class="skeleton-block skeleton-block--title"></span>
            <span class="skeleton-block skeleton-block--subtitle"></span>
          </div>
          <span class="quota-status-pill status-pill--skeleton"></span>
        </div>

        <div class="quota-kpi-strip">
          <article
            v-for="index in 4"
            :key="`quota-kpi-skeleton-${index}`"
            class="quota-kpi quota-kpi--skeleton"
          >
            <span class="skeleton-block skeleton-block--label"></span>
            <span class="skeleton-block skeleton-block--value"></span>
          </article>
        </div>

        <div class="quota-console__grid">
          <section class="pond-chamber pond-chamber--skeleton">
            <span class="skeleton-block skeleton-block--label"></span>
            <div class="pond-chamber__tank pond-chamber__tank--skeleton">
              <div class="pond-chamber__fill pond-chamber__fill--skeleton"></div>
            </div>
          </section>

          <section class="wallet-cockpit wallet-cockpit--skeleton">
            <span class="skeleton-block skeleton-block--label"></span>
            <div class="wallet-cockpit__reserve wallet-cockpit__reserve--skeleton">
              <div class="wallet-cockpit__track wallet-cockpit__track--skeleton">
                <div class="wallet-cockpit__fill wallet-cockpit__fill--skeleton"></div>
              </div>
              <span class="skeleton-block skeleton-block--metric"></span>
            </div>

            <dl class="wallet-cockpit__metrics wallet-cockpit__metrics--skeleton">
              <div v-for="index in 6" :key="`quota-metric-skeleton-${index}`">
                <dt class="skeleton-block skeleton-block--dt"></dt>
                <dd class="skeleton-block skeleton-block--dd"></dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <div v-else-if="quotaStatus" class="quota-console">
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

            <div class="wallet-cockpit__cycle">
              <div class="wallet-cockpit__cycle-head">
                <span class="section-label">{{ t('admin.cycleProgress') }}</span>
                <strong>{{ cycleProgressPercentLabel }}</strong>
              </div>
              <div
                class="wallet-cockpit__track wallet-cockpit__track--cycle"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="cycleProgressState?.percent ?? 0"
                :aria-valuetext="cycleProgressPercentLabel"
                data-test="cycle-progress"
              >
                <div class="wallet-cockpit__fill wallet-cockpit__fill--cycle" :style="cycleProgressFillStyle">
                  <span class="wallet-cockpit__sheen"></span>
                </div>
              </div>
              <span class="wallet-cockpit__meta">{{ cycleProgressDurationLabel }}</span>
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
                <dt>{{ t('admin.cycleProgress') }}</dt>
                <dd>{{ cycleProgressPercentLabel }}</dd>
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

      <div v-if="usageInitialLoading" class="usage-grid usage-grid--skeleton" data-test="usage-skeleton">
        <div class="trend-board trend-board--skeleton">
          <div class="trend-bars trend-bars--skeleton">
            <article
              v-for="(height, index) in [42, 68, 51, 80, 61, 73]"
              :key="`usage-skeleton-bar-${index}`"
              class="trend-bar-card"
            >
              <div class="trend-bar-shell">
                <div class="trend-bar-fill trend-bar-fill--skeleton" :style="{ height: `${height}%` }"></div>
              </div>
              <span class="skeleton-block skeleton-block--metric"></span>
              <span class="skeleton-block skeleton-block--meta"></span>
            </article>
          </div>
        </div>

        <div class="ranking-board ranking-board--skeleton">
          <h4>{{ t('admin.userRankingTitle') }}</h4>
          <ol class="ranking-list">
            <li
              v-for="index in 5"
              :key="`usage-skeleton-rank-${index}`"
              class="ranking-item ranking-item--skeleton"
            >
              <div class="ranking-item__skeleton-copy">
                <span class="skeleton-block skeleton-block--label"></span>
                <span class="skeleton-block skeleton-block--meta"></span>
              </div>
              <span class="skeleton-block skeleton-block--metric"></span>
            </li>
          </ol>
        </div>
      </div>
      <div v-else class="usage-grid">
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
      class="compat-recharge-dialog"
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
                :min="0.01"
                :precision="2"
                :step="0.1"
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
              <strong>{{ formatHoursDuration(compatRechargePreview.totalHours) }}</strong>
            </div>
            <div class="preview-card">
              <span>{{ t('admin.compatPreviewCycleHours') }}</span>
              <strong>{{ formatMinutesDuration(compatRechargePreview.cycleDuration) }}</strong>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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
import { getCycleProgress } from './adminCycleProgress'

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
const cycleNowMs = ref(Date.now())
const providerListInitialLoaded = ref(false)
const providerDetailsInitialLoaded = ref(false)
const adminUsageInitialLoaded = ref(false)
const sitePowerInitialLoaded = ref(false)
const compatRechargeForm = reactive({
  totalPower: 0,
  walletPercent: 50,
  poolPercent: 50,
  totalDays: 7,
  totalHours: 0,
  cycleHours: 24,
})
let cycleProgressTimer: number | null = null

const totalWallet = computed(() => quotaStatus.value?.wallet_balance ?? 0)
const totalPool = computed(() => quotaStatus.value?.pool_balance ?? 0)
const totalBaseline = computed(() => quotaStatus.value?.pool_baseline ?? 0)
const totalQuota = computed(() => totalWallet.value + totalPool.value)
const providerInitialLoading = computed(() =>
  !providerListInitialLoaded.value || !providerDetailsInitialLoaded.value
)
const usageInitialLoading = computed(() => !adminUsageInitialLoaded.value)
const sitePowerInitialLoading = computed(() => !sitePowerInitialLoaded.value)
const heroInitialLoading = computed(() =>
  providerInitialLoading.value || usageInitialLoading.value || sitePowerInitialLoading.value
)
const providerSkeletonCount = computed(() =>
  providerListInitialLoaded.value && providers.value.length > 0 ? providers.value.length : 2
)
const providerConsoleTotalPower = computed(() =>
  Number(
    providers.value
      .reduce((sum, provider) => sum + (balances[provider]?.availablePower ?? 0), 0)
      .toFixed(2)
  )
)
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
  const cycleDuration = roundHoursToMinutes(compatRechargeForm.cycleHours)
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
    cycleDuration,
    totalHours,
  }
})
const cycleProgressState = computed(() => getCycleProgress(quotaStatus.value, cycleNowMs.value))
const cycleProgressPercentLabel = computed(() =>
  cycleProgressState.value ? `${cycleProgressState.value.percent}%` : '--'
)
const cycleProgressDurationLabel = computed(() => {
  if (!cycleProgressState.value) {
    return '-'
  }

  return `${formatCompactDuration(cycleProgressState.value.elapsedMinutes)} / ${formatCompactDuration(cycleProgressState.value.totalMinutes)}`
})
const cycleProgressFillStyle = computed(() => ({
  width: `${cycleProgressState.value?.fillPercent ?? 0}%`,
}))

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

onMounted(() => {
  cycleProgressTimer = window.setInterval(() => {
    cycleNowMs.value = Date.now()
  }, 1000)

  void Promise.allSettled([
    loadInitialProviders(),
    loadInitialUsage(),
    loadQuotaStatus(false, { markInitialLoaded: true }),
  ])
})

onBeforeUnmount(() => {
  if (cycleProgressTimer !== null) {
    window.clearInterval(cycleProgressTimer)
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

async function loadInitialProviders() {
  try {
    const providerResponse = await getEnabledProviders()
    providers.value = providerResponse.data.providers ?? []
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    providerListInitialLoaded.value = true
  }

  if (providers.value.length === 0) {
    providerDetailsInitialLoaded.value = true
    return
  }

  await Promise.allSettled(
    providers.value.map(async (provider) => {
      try {
        await Promise.all([loadConfig(provider), loadBalance(provider)])
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
      }
    })
  )
  providerDetailsInitialLoaded.value = true
}

async function loadInitialUsage() {
  try {
    adminUsage.value = (await getAdminUsage()).data
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('admin.queryFailed'))
  } finally {
    adminUsageInitialLoaded.value = true
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

async function loadQuotaStatus(showSuccess = true, options: { markInitialLoaded?: boolean } = {}) {
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
    if (options.markInitialLoaded) {
      sitePowerInitialLoaded.value = true
    }
  }
}

function openCompatRechargeModal() {
  compatRechargeForm.totalPower = providerConsoleTotalPower.value
  showCompatRechargeModal.value = true
}

async function submitCompatRecharge() {
  if (compatRechargeForm.walletPercent + compatRechargeForm.poolPercent !== 100) {
    ElMessage.warning(t('admin.compatRechargeValidationPercent'))
    return
  }
  if (
    compatRechargePreview.value.totalDuration <= 0 ||
    compatRechargePreview.value.totalDuration < compatRechargePreview.value.cycleDuration
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

function roundHoursToMinutes(value: number) {
  return Math.max(0, Math.round(value * 60))
}

function formatHoursDuration(value: number) {
  return t('admin.durationHoursValue', { value })
}

function formatMinutesDuration(value: number) {
  return t('admin.durationMinutesValue', { value })
}

function formatCompactDuration(totalMinutes: number) {
  if (totalMinutes >= 60) {
    const totalHours = totalMinutes / 60
    const roundedHours = Number.isInteger(totalHours) ? totalHours : Number(totalHours.toFixed(1))
    return formatHoursDuration(roundedHours)
  }

  return formatMinutesDuration(totalMinutes)
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
  --console-bg: #d7cbbb;
  --console-bg-strong: #eee4d8;
  --panel-bg: rgba(248, 242, 233, 0.86);
  --panel-border: rgba(33, 28, 22, 0.12);
  --ink-strong: #1f1b16;
  --ink-soft: rgba(31, 27, 22, 0.62);
  --ocean: linear-gradient(160deg, #11283a, #225977 70%, #2385a4);
  --mint: linear-gradient(160deg, #1f605e, #2f9085);
  --sun: linear-gradient(160deg, #6c3317, #d16b27);
  --slate: linear-gradient(160deg, #433b35, #766c61);
  --rose: linear-gradient(160deg, #6f3a33, #b56258);
  --pond-a: #48bfd3;
  --pond-b: #1c7281;
  --wallet-a: #ffb05f;
  --wallet-b: #cb541f;
  --status-bg: #24201c;
  --status-ink: #f3d691;
  --dock-bg: linear-gradient(180deg, #25201b, #3a2b1f);
  display: grid;
  gap: 22px;
  font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
}

.hero-panel,
.panel {
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.68)),
    linear-gradient(180deg, rgba(246, 239, 231, 0.96), rgba(234, 224, 211, 0.88));
  border: 1px solid var(--panel-border);
  border-radius: 30px;
  box-shadow: 0 26px 60px rgba(28, 21, 16, 0.14);
  backdrop-filter: blur(14px);
}

.hero-panel {
  overflow: hidden;
  padding: 28px;
  background:
    radial-gradient(circle at top left, rgba(90, 213, 245, 0.2), transparent 30%),
    radial-gradient(circle at 80% 18%, rgba(255, 160, 79, 0.18), transparent 24%),
    linear-gradient(155deg, #171d24, #25445a 60%, #18748f);
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
.quota-console h4,
.compat-console__preview h4 {
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
.quota-console h4 {
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
  border-radius: 24px;
  display: grid;
  gap: 10px;
  align-content: start;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

.summary-card--skeleton,
.provider-card--skeleton,
.metric-card--skeleton,
.quota-console--skeleton,
.quota-kpi--skeleton,
.pond-chamber--skeleton,
.wallet-cockpit--skeleton,
.trend-board--skeleton,
.ranking-board--skeleton {
  box-shadow: none;
}

.skeleton-block,
.status-pill--skeleton {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
}

.skeleton-block::after,
.status-pill--skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.58), transparent);
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

.skeleton-block--label {
  width: 38%;
  height: 12px;
}

.skeleton-block--value {
  width: 64%;
  height: 34px;
}

.skeleton-block--meta {
  width: 46%;
  height: 12px;
}

.skeleton-block--name {
  width: 132px;
  height: 18px;
}

.skeleton-block--subtitle {
  width: 180px;
  height: 12px;
  margin-top: 10px;
}

.skeleton-block--metric {
  width: 72px;
  height: 18px;
}

.skeleton-block--paragraph {
  width: 100%;
  height: 12px;
}

.skeleton-block--input {
  width: 100%;
  height: 40px;
  border-radius: 14px;
}

.skeleton-block--button {
  width: 96px;
  height: 38px;
}

.skeleton-block--title {
  width: 160px;
  height: 20px;
}

.skeleton-block--dt {
  width: 88px;
  height: 12px;
}

.skeleton-block--dd {
  width: 64px;
  height: 16px;
  margin-left: auto;
}

.provider-card__skeleton-copy,
.quota-console__skeleton-copy,
.ranking-item__skeleton-copy {
  display: grid;
  gap: 10px;
}

.status-pill--skeleton {
  width: 72px;
  min-height: 28px;
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
.trend-board,
.ranking-board {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 24px;
  padding: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.provider-card__top,
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
  background: rgba(33, 28, 22, 0.08);
  color: #4e443a;
}

.status-pill[data-ready='true'] {
  background: rgba(36, 122, 112, 0.14);
  color: #155a54;
}

.provider-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.metric-card {
  padding: 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(243, 236, 226, 0.72));
  border: 1px solid rgba(123, 106, 89, 0.12);
}

.metric-card span {
  display: block;
  color: var(--ink-soft);
  font-size: 13px;
}

.metric-card strong,
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

.provider-actions--skeleton .actions {
  margin-top: 0;
}

.provider-actions :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 14px;
}

.provider-footnote {
  margin: 14px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
}

.quota-console {
  position: relative;
  border-radius: 28px;
  border: 1px solid rgba(33, 28, 22, 0.1);
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 138, 71, 0.14), transparent 24%),
    linear-gradient(180deg, rgba(251, 247, 240, 0.92), rgba(235, 225, 212, 0.9));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 20px 38px rgba(29, 21, 16, 0.12);
  overflow: hidden;
}

.quota-console__head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding: 18px 18px 14px;
  border-bottom: 1px solid rgba(33, 28, 22, 0.08);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.32), transparent);
}

.quota-console__head p {
  margin: 6px 0 0;
  color: var(--ink-soft);
  line-height: 1.45;
}

.quota-status-pill {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--status-bg);
  color: var(--status-ink);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.quota-status-pill[data-tone='low'] {
  background: #5c2f14;
  color: #ffcf93;
}

.quota-status-pill[data-tone='depleted'] {
  background: #5a2323;
  color: #ffc1b6;
}

.quota-status-pill[data-tone='standby'] {
  background: #3d3933;
  color: #d2c8ba;
}

.quota-kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 18px 0;
}

.quota-kpi {
  border-radius: 20px;
  padding: 14px;
  border: 1px solid rgba(33, 28, 22, 0.08);
  background: rgba(255, 255, 255, 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.quota-kpi span {
  display: block;
  font-size: 11px;
  color: rgba(31, 27, 22, 0.54);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.quota-kpi strong {
  display: block;
  margin-top: 10px;
  font-size: 28px;
  line-height: 1;
  color: var(--ink-strong);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

.quota-console__grid {
  display: grid;
  grid-template-columns: 1.08fr 0.92fr;
  gap: 14px;
  align-items: stretch;
  padding: 14px 18px 18px;
}

.section-label {
  display: block;
  color: rgba(31, 27, 22, 0.56);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pond-chamber,
.wallet-cockpit {
  border-radius: 24px;
  border: 1px solid rgba(33, 28, 22, 0.1);
  background: rgba(248, 242, 233, 0.78);
  padding: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.pond-chamber__tank {
  position: relative;
  margin-top: 14px;
  min-height: 286px;
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(24, 87, 98, 0.12);
  background:
    radial-gradient(circle at 50% -10%, rgba(255, 255, 255, 0.34), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.08)),
    repeating-linear-gradient(
      180deg,
      rgba(31, 27, 22, 0.04) 0,
      rgba(31, 27, 22, 0.04) 1px,
      transparent 1px,
      transparent 38px
    ),
    linear-gradient(180deg, rgba(24, 56, 64, 0.09), rgba(17, 35, 42, 0.18));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 16px 28px rgba(19, 30, 35, 0.08);
}

.pond-chamber__tank::before,
.pond-chamber__tank::after {
  content: '';
  position: absolute;
  inset: 14px;
  border-radius: 18px;
  pointer-events: none;
}

.pond-chamber__tank::before {
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.pond-chamber__tank::after {
  inset: auto 18px 20px 18px;
  height: 56px;
  border-radius: 20px 20px 10px 10px;
  background: linear-gradient(180deg, rgba(9, 22, 27, 0), rgba(9, 22, 27, 0.16));
}

.pond-chamber__fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.28), transparent 34%),
    linear-gradient(180deg, rgba(115, 220, 240, 0.96), rgba(35, 135, 150, 0.98)),
    linear-gradient(180deg, var(--pond-a), var(--pond-b));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    0 -18px 40px rgba(38, 155, 171, 0.18);
  transition: height 220ms ease;
}

.pond-chamber__tank--skeleton {
  min-height: 286px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.08)),
    rgba(72, 191, 211, 0.18);
}

.pond-chamber__fill--skeleton {
  height: 72%;
}

.pond-chamber__glow {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.2);
}

.pond-chamber__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 18px;
  background: linear-gradient(180deg, rgba(13, 28, 33, 0.02), rgba(13, 28, 33, 0.18));
}

.pond-chamber__overlay strong {
  font-size: 34px;
  line-height: 1;
  color: var(--ink-strong);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

.pond-chamber__overlay small {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(31, 27, 22, 0.66);
}

.wallet-cockpit {
  display: grid;
  gap: 14px;
}

.wallet-cockpit__reserve {
  border-radius: 22px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(255, 244, 227, 0.9), rgba(248, 224, 190, 0.68));
  border: 1px solid rgba(202, 97, 32, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.44),
    0 16px 24px rgba(99, 58, 22, 0.08);
}

.wallet-cockpit__track {
  height: 16px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(103, 51, 18, 0.12);
}

.wallet-cockpit__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--wallet-a), var(--wallet-b));
  box-shadow: 0 0 30px rgba(255, 144, 70, 0.28);
  transition: width 220ms ease;
}

.wallet-cockpit__track--skeleton {
  background: rgba(103, 51, 18, 0.1);
}

.wallet-cockpit__fill--skeleton {
  width: 72%;
}

.wallet-cockpit__reserve strong {
  display: block;
  margin-top: 12px;
  font-size: 34px;
  line-height: 1;
  color: var(--ink-strong);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

.wallet-cockpit__cycle {
  display: grid;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid rgba(202, 97, 32, 0.14);
}

.wallet-cockpit__cycle-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.wallet-cockpit__cycle-head strong {
  color: var(--ink-strong);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

.wallet-cockpit__track--cycle {
  height: 14px;
  background: rgba(24, 116, 143, 0.12);
}

.wallet-cockpit__fill--cycle {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, var(--pond-a), var(--pond-b));
  transition: width 900ms linear;
}

.wallet-cockpit__sheen {
  position: absolute;
  inset: 0 auto 0 -30%;
  width: 30%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: cycle-progress-sheen 2.8s linear infinite;
}

.wallet-cockpit__meta {
  color: var(--ink-soft);
  font-size: 13px;
}

.wallet-cockpit__metrics {
  display: grid;
  gap: 10px;
  margin: 0;
}

.wallet-cockpit__metrics--skeleton dt,
.wallet-cockpit__metrics--skeleton dd {
  display: block;
}

.wallet-cockpit__metrics div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 18px;
  border: 1px solid rgba(33, 28, 22, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(247, 238, 225, 0.68));
}

.wallet-cockpit__metrics dt {
  color: var(--ink-soft);
}

.wallet-cockpit__metrics dd {
  margin: 0;
  color: var(--ink-strong);
  font-weight: 800;
  text-align: right;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
}

.compat-console {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  margin-top: 4px;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(33, 28, 22, 0.1);
  background: linear-gradient(180deg, rgba(252, 248, 242, 0.94), rgba(238, 228, 216, 0.92));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 18px 28px rgba(26, 18, 12, 0.08);
}

.compat-console__form {
  padding: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 28%);
}

.compat-console__form .panel-hint {
  margin-top: 0;
  color: var(--ink-soft);
}

.field {
  display: grid;
  gap: 8px;
  color: var(--ink-soft);
  font-size: 14px;
}

.field--wide {
  grid-column: 1 / -1;
  max-width: none;
}

.compat-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.field :deep(.el-input-number) {
  width: 100%;
}

.field :deep(.el-input-number .el-input__wrapper) {
  min-height: 44px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.compat-console__preview {
  position: relative;
  padding: 20px;
  color: #f9efe0;
  border-left: 1px solid rgba(255, 228, 193, 0.08);
  background:
    radial-gradient(circle at 80% 0%, rgba(255, 125, 59, 0.18), transparent 30%),
    var(--dock-bg);
}

.compat-console__preview::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 24%),
    repeating-linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.04) 0,
      rgba(255, 255, 255, 0.04) 1px,
      transparent 1px,
      transparent 46px
    );
  pointer-events: none;
}

.compat-console__preview h4 {
  position: relative;
  color: #f9efe0;
}

.compat-console__preview-grid {
  position: relative;
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.preview-card {
  border-radius: 18px;
  padding: 12px;
  border: 1px solid rgba(255, 237, 214, 0.06);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.preview-card span {
  display: block;
  font-size: 11px;
  color: rgba(249, 239, 224, 0.58);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.preview-card strong {
  display: block;
  margin-top: 8px;
  font-size: 24px;
  line-height: 1.1;
  color: #f9efe0;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
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

.dialog-actions :deep(.el-button) {
  min-width: 86px;
  border-radius: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.dialog-actions :deep(.el-button--default) {
  border-color: rgba(96, 82, 68, 0.16);
  background: rgba(255, 255, 255, 0.74);
  color: var(--ink-strong);
}

.dialog-actions :deep(.el-button--primary) {
  border-color: rgba(189, 88, 31, 0.22);
  background: linear-gradient(135deg, #ffb15d, #cd571f);
  box-shadow: 0 14px 24px rgba(189, 88, 31, 0.18);
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(231, 220, 205, 0.84));
}

.trend-bar-fill {
  width: 100%;
  border-radius: 12px 12px 8px 8px;
  background: linear-gradient(180deg, #2eab6d, #17613d);
  transition: height 220ms ease;
}

.trend-bar-fill--skeleton {
  background: linear-gradient(180deg, rgba(148, 163, 184, 0.56), rgba(100, 116, 139, 0.9));
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
  border-bottom: 1px solid rgba(123, 106, 89, 0.14);
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

.ranking-item--skeleton {
  align-items: center;
}

@keyframes cycle-progress-sheen {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(420%);
  }
}

@keyframes skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (max-width: 960px) {
  .quota-kpi-strip,
  .quota-console__grid,
  .usage-grid,
  .compat-console,
  .compat-grid {
    grid-template-columns: 1fr;
  }

  .provider-card__top,
  .panel-head,
  .actions,
  .ranking-item,
  .quota-console__head {
    flex-direction: column;
    align-items: stretch;
  }

  .compat-console__preview {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>

<style>
.compat-recharge-dialog {
  border-radius: 28px;
  overflow: hidden;
  border: 1px solid rgba(33, 28, 22, 0.12);
  background: linear-gradient(180deg, rgba(245, 239, 231, 0.98), rgba(233, 224, 211, 0.96));
  box-shadow: 0 36px 90px rgba(20, 14, 10, 0.28);
}

.compat-recharge-dialog .el-dialog__header {
  margin: 0;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(33, 28, 22, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.12));
}

.compat-recharge-dialog .el-dialog__title {
  color: #2a241d;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.compat-recharge-dialog .el-dialog__headerbtn {
  top: 18px;
  right: 18px;
}

.compat-recharge-dialog .el-dialog__headerbtn .el-dialog__close {
  color: rgba(42, 36, 29, 0.46);
}

.compat-recharge-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: rgba(42, 36, 29, 0.8);
}

.compat-recharge-dialog .el-dialog__body {
  padding: 0 16px 8px;
}

.compat-recharge-dialog .el-dialog__footer {
  padding: 0 16px 18px;
  background: linear-gradient(180deg, rgba(252, 248, 242, 0), rgba(252, 248, 242, 0.92));
}
</style>
