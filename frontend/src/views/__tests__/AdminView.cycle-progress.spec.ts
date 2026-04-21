import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import AdminView from '../AdminView.vue'

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
    template: '<div>{{ description }}</div>',
  }),
  ElDialog: defineComponent({
    props: ['modelValue'],
    template: '<section v-if="modelValue"><slot /></section>',
  }),
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

describe('AdminView cycle progress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-11T12:00:00.000Z'))

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

    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d'] } })
    mocks.getAdminConfig.mockResolvedValue({
      data: { configured: true, apiKeyMasked: 'sk-***' },
    })
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
    mocks.getSitePowerStatus.mockResolvedValue({
      data: { data: createQuotaStatus() },
    })

    i18n.global.locale.value = 'zh-CN'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the current cycle progress and refreshes it over time', async () => {
    const wrapper = mount(AdminView, {
      global: {
        plugins: [i18n],
        stubs: globalStubs,
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('admin.cycleProgress'))
    expect(wrapper.text()).toContain('50%')
    expect(wrapper.get('[data-test="cycle-progress"]').attributes('aria-valuenow')).toBe('50')

    vi.setSystemTime(new Date('2026-04-11T18:00:00.000Z'))
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(wrapper.text()).toContain('75%')
    expect(wrapper.get('[data-test="cycle-progress"]').attributes('aria-valuenow')).toBe('75')
  })
})
