import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import AdminView from '../AdminView.vue'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const mocks = vi.hoisted(() => ({
  getAdminBalance: vi.fn(),
  getAdminConfig: vi.fn(),
  getAdminUsage: vi.fn(),
  getEnabledProviders: vi.fn(),
  getSitePowerStatus: vi.fn(),
  rechargeSitePower: vi.fn(),
  saveAdminConfig: vi.fn(),
  elMessageError: vi.fn(),
  elMessageSuccess: vi.fn(),
  elMessageWarning: vi.fn(),
}))

vi.mock('../../api', () => ({
  getAdminBalance: mocks.getAdminBalance,
  getAdminConfig: mocks.getAdminConfig,
  getAdminUsage: mocks.getAdminUsage,
  getEnabledProviders: mocks.getEnabledProviders,
  getSitePowerStatus: mocks.getSitePowerStatus,
  rechargeSitePower: mocks.rechargeSitePower,
  saveAdminConfig: mocks.saveAdminConfig,
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: mocks.elMessageError,
    success: mocks.elMessageSuccess,
    warning: mocks.elMessageWarning,
  },
}))

const globalStubs = {
  ElInput: defineComponent({ template: '<input />' }),
  ElInputNumber: defineComponent({ template: '<input type="number" />' }),
  ElButton: defineComponent({
    props: ['disabled', 'loading', 'type'],
    emits: ['click'],
    template: '<button type="button" :disabled="disabled || loading" @click="$emit(`click`)"><slot /></button>',
  }),
  ElTag: defineComponent({ template: '<span><slot /></span>' }),
  ElEmpty: defineComponent({
    props: ['description'],
    template: '<div data-test="empty-state">{{ description }}</div>',
  }),
  ElDialog: defineComponent({
    props: ['modelValue'],
    template: '<section v-if="modelValue"><slot /></section>',
  }),
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function createQuotaStatus() {
  return {
    wallet_balance: 60,
    pool_balance: 40,
    pool_baseline: 20,
    cycles_remaining: 8,
    cycle_duration: 1440,
    total_duration: 10080,
    cycle_started_at: '2026-04-11T00:00:00.000Z',
    next_cycle_at: '2026-04-12T00:00:00.000Z',
  }
}

describe('AdminView initial loading skeletons', () => {
  let tripoBalanceDeferred: Deferred<{ data: { configured: boolean; available: number; availablePower: number } }>
  let hyperBalanceDeferred: Deferred<{ data: { configured: boolean; available: number; availablePower: number } }>
  let usageDeferred: Deferred<{
    data: {
      totalCredits: number
      totalPower: number
      userRanking: []
      dailyTrend: []
    }
  }>
  let sitePowerDeferred: Deferred<{
    data: {
      data: ReturnType<typeof createQuotaStatus> | null
    }
  }>

  beforeEach(() => {
    tripoBalanceDeferred = createDeferred()
    hyperBalanceDeferred = createDeferred()
    usageDeferred = createDeferred()
    sitePowerDeferred = createDeferred()

    mocks.getEnabledProviders.mockReset()
    mocks.getAdminConfig.mockReset()
    mocks.getAdminBalance.mockReset()
    mocks.getAdminUsage.mockReset()
    mocks.getSitePowerStatus.mockReset()
    mocks.rechargeSitePower.mockReset()
    mocks.saveAdminConfig.mockReset()
    mocks.elMessageError.mockReset()
    mocks.elMessageSuccess.mockReset()
    mocks.elMessageWarning.mockReset()

    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d', 'hyper3d'] } })
    mocks.getAdminConfig.mockResolvedValue({
      data: { configured: true, apiKeyMasked: 'sk-***' },
    })
    mocks.getAdminBalance.mockImplementation((provider: string) => (
      provider === 'tripo3d' ? tripoBalanceDeferred.promise : hyperBalanceDeferred.promise
    ))
    mocks.getAdminUsage.mockImplementation(() => usageDeferred.promise)
    mocks.getSitePowerStatus.mockImplementation(() => sitePowerDeferred.promise)

    i18n.global.locale.value = 'zh-CN'
  })

  it('shows section-level skeletons before the first requests finish', async () => {
    const wrapper = mount(AdminView, {
      global: {
        plugins: [i18n],
        stubs: globalStubs,
      },
    })

    await Promise.resolve()

    expect(wrapper.find('[data-test="hero-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="provider-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="site-power-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="usage-skeleton"]').exists()).toBe(true)
  })

  it('drops the section skeletons after the initial requests settle', async () => {
    const wrapper = mount(AdminView, {
      global: {
        plugins: [i18n],
        stubs: globalStubs,
      },
    })

    await Promise.resolve()

    tripoBalanceDeferred.resolve({ data: { configured: true, available: 12, availablePower: 34 } })
    hyperBalanceDeferred.resolve({ data: { configured: true, available: 8, availablePower: 21 } })
    usageDeferred.resolve({
      data: { totalCredits: 0, totalPower: 55, userRanking: [], dailyTrend: [] },
    })
    sitePowerDeferred.resolve({ data: { data: createQuotaStatus() } })
    await flushPromises()

    expect(wrapper.find('[data-test="hero-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="provider-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="site-power-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="usage-skeleton"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(i18n.global.t('admin.quotaOverviewTitle'))
  })

  it('shows the quota empty state instead of a permanent skeleton after a null first response', async () => {
    mocks.getAdminBalance.mockResolvedValue({
      data: { configured: true, available: 12, availablePower: 34 },
    })
    mocks.getAdminUsage.mockResolvedValue({
      data: {
        totalCredits: 0,
        totalPower: 0,
        userRanking: [],
        dailyTrend: [],
      },
    })

    const quotaNullDeferred = createDeferred<{ data: { data: null } }>()
    mocks.getSitePowerStatus.mockImplementation(() => quotaNullDeferred.promise)

    const wrapper = mount(AdminView, {
      global: {
        plugins: [i18n],
        stubs: globalStubs,
      },
    })

    await Promise.resolve()
    expect(wrapper.find('[data-test="site-power-skeleton"]').exists()).toBe(true)

    quotaNullDeferred.resolve({ data: { data: null } })
    await flushPromises()

    expect(wrapper.find('[data-test="site-power-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="empty-state"]').text()).toContain(i18n.global.t('admin.quotaEmpty'))
  })

  it('does not coerce missing raw provider credits to zero', async () => {
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d'] } })
    mocks.getAdminConfig.mockResolvedValue({ data: { configured: false } })
    mocks.getAdminBalance.mockResolvedValue({ data: { configured: false } })
    mocks.getAdminUsage.mockResolvedValue({
      data: {
        totalCredits: 0,
        totalPower: 0,
        userRanking: [],
        dailyTrend: [],
      },
    })
    mocks.getSitePowerStatus.mockResolvedValue({ data: { data: createQuotaStatus() } })

    const wrapper = mount(AdminView, {
      global: {
        plugins: [i18n],
        stubs: globalStubs,
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('原始 credits：-')
    expect(wrapper.text()).not.toContain('原始 credits：0')
  })
})
