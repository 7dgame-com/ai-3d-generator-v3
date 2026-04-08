<template>
  <div class="page">
    <section class="panel">
      <h2>{{ t('admin.title') }}</h2>
      <div class="provider-grid">
        <article v-for="provider in providers" :key="provider" class="provider-card">
          <h3>{{ provider }}</h3>
          <p>{{ configs[provider]?.apiKeyMasked || t('admin.notConfigured') }}</p>
          <el-input v-model="draftKeys[provider]" type="password" :placeholder="t('admin.apiKeyPlaceholder')" />
          <div class="actions">
            <el-button @click="loadBalance(provider)">{{ t('admin.checkBalance') }}</el-button>
            <el-button type="primary" @click="save(provider)">{{ t('common.save') }}</el-button>
          </div>
          <p v-if="balances[provider] !== undefined">{{ t('admin.balance', { available: balances[provider] }) }}</p>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>{{ t('admin.quotaTitle') }}</h2>
        <el-button :loading="quotaLoading" @click="loadQuotaStatus">{{ t('admin.loadQuota') }}</el-button>
      </div>

      <div class="quota-toolbar">
        <label class="field">
          <span>{{ t('admin.userId') }}</span>
          <el-input-number v-model="targetUserId" :min="1" :precision="0" :step="1" controls-position="right" />
        </label>
        <label class="field">
          <span>{{ t('admin.provider') }}</span>
          <el-select v-model="rechargeForm.provider_id" placeholder="Provider">
            <el-option v-for="provider in providers" :key="provider" :label="provider" :value="provider" />
          </el-select>
        </label>
      </div>

      <div v-if="quotaStatuses.length > 0" class="status-grid">
        <article v-for="status in quotaStatuses" :key="status.provider_id" class="status-card">
          <div class="status-head">
            <h3>{{ status.provider_id }}</h3>
            <el-tag type="info">{{ t('admin.statusLabel') }}</el-tag>
          </div>
          <dl class="status-list">
            <div>
              <dt>{{ t('admin.walletBalance') }}</dt>
              <dd>{{ status.wallet_balance }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.poolBalance') }}</dt>
              <dd>{{ status.pool_balance }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.poolBaseline') }}</dt>
              <dd>{{ status.pool_baseline }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.cyclesRemaining') }}</dt>
              <dd>{{ status.cycles_remaining }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.cycleStartedAt') }}</dt>
              <dd>{{ formatDateTime(status.cycle_started_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.nextCycleAt') }}</dt>
              <dd>{{ formatDateTime(status.next_cycle_at) }}</dd>
            </div>
          </dl>
        </article>
      </div>
      <el-empty
        v-else
        :description="targetUserId ? t('admin.noQuotaData') : t('admin.quotaEmpty')"
      />

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
          <el-input-number v-model="rechargeForm.total_duration" :min="rechargeForm.cycle_duration" :precision="0" :step="60" />
        </label>
        <label class="field">
          <span>{{ t('admin.cycleDuration') }}</span>
          <el-input-number v-model="rechargeForm.cycle_duration" :min="60" :max="43200" :precision="0" :step="60" />
        </label>
      </div>

      <div class="actions">
        <el-button type="primary" :loading="rechargeLoading" @click="submitRecharge">
          {{ t('admin.recharge') }}
        </el-button>
      </div>
    </section>

    <section class="panel">
      <h2>{{ t('admin.usageTitle') }}</h2>
      <p>{{ adminUsage?.totalCredits ?? 0 }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAdminBalance,
  getAdminConfig,
  getAdminCreditStatus,
  getAdminUsage,
  getEnabledProviders,
  rechargeAdminCredits,
  saveAdminConfig,
  type ProviderCreditStatus,
} from '../api'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const providers = ref<string[]>([])
const configs = reactive<Record<string, { configured: boolean; apiKeyMasked?: string }>>({})
const balances = reactive<Record<string, number | undefined>>({})
const draftKeys = reactive<Record<string, string>>({})
const adminUsage = ref<{ totalCredits: number } | null>(null)

const targetUserId = ref<number | undefined>()
const quotaStatuses = ref<ProviderCreditStatus[]>([])
const quotaLoading = ref(false)
const rechargeLoading = ref(false)
const rechargeForm = reactive({
  provider_id: '',
  wallet_amount: 300,
  pool_amount: 100,
  total_duration: 43200,
  cycle_duration: 1440,
})

onMounted(async () => {
  const providerResponse = await getEnabledProviders()
  providers.value = providerResponse.data.providers ?? []
  if (providers.value.length > 0) {
    rechargeForm.provider_id = providers.value[0]
  }
  await Promise.all(providers.value.map(loadConfig))
  adminUsage.value = (await getAdminUsage()).data
})

async function loadConfig(provider: string) {
  configs[provider] = (await getAdminConfig(provider)).data
}

async function loadBalance(provider: string) {
  const response = await getAdminBalance(provider)
  balances[provider] = response.data.available
}

async function save(provider: string) {
  try {
    await saveAdminConfig(draftKeys[provider], provider)
    await loadConfig(provider)
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
    quotaStatuses.value = response.data.data ?? []
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
  if (!rechargeForm.provider_id) {
    ElMessage.warning(t('common.required', { field: t('admin.provider') }))
    return
  }

  rechargeLoading.value = true
  try {
    await rechargeAdminCredits({
      userId: targetUserId.value,
      provider_id: rechargeForm.provider_id,
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

function formatDateTime(value: string | null) {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString(locale.value)
}
</script>

<style scoped>
.page {
  display: grid;
  gap: 20px;
}

.panel {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}

.provider-grid,
.status-grid,
.recharge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.provider-card,
.status-card {
  border: 1px solid #e8edf5;
  border-radius: 12px;
  padding: 16px;
}

.quota-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 280px));
  gap: 16px;
  margin-bottom: 16px;
}

.field {
  display: grid;
  gap: 8px;
  font-size: 14px;
  color: #445068;
}

.status-head,
.actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.actions {
  margin-top: 16px;
}

.status-list {
  display: grid;
  gap: 12px;
  margin: 16px 0 0;
}

.status-list div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eef2f7;
}

.status-list dt {
  color: #667085;
}

.status-list dd {
  margin: 0;
  font-weight: 600;
  color: #0f172a;
}
</style>
