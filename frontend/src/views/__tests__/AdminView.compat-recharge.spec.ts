import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  ElInput: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input type="text" :value="modelValue" @input="$emit(`update:modelValue`, $event.target.value)" />',
  }),
  ElInputNumber: defineComponent({
    props: ['modelValue', 'min', 'max', 'precision', 'step'],
    emits: ['update:modelValue'],
    template: `
      <input
        type="number"
        :value="modelValue"
        :data-min="min"
        :data-max="max"
        :data-precision="precision"
        :data-step="step"
        @input="$emit('update:modelValue', Number($event.target.value))"
      />
    `,
  }),
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
    template: '<section v-if="modelValue" data-test="compat-dialog"><slot /><slot name="footer" /></section>',
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

async function mountView() {
  const wrapper = mount(AdminView, {
    global: {
      plugins: [i18n],
      stubs: globalStubs,
    },
  })

  await flushPromises()
  return wrapper
}

function findButton(wrapper: VueWrapper, label: string) {
  const button = wrapper
    .findAll('button')
    .find((candidate) => candidate.text().trim() === label)

  expect(button, `expected button "${label}"`).toBeTruthy()
  return button!
}

function findNumberInput(wrapper: VueWrapper, label: string) {
  const field = wrapper
    .findAll('label')
    .find((candidate) => candidate.text().includes(label))

  expect(field, `expected field "${label}"`).toBeTruthy()
  return field!.get('input[type="number"]')
}

describe('AdminView compat recharge cycle duration', () => {
  beforeEach(() => {
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
    mocks.rechargeSitePower.mockResolvedValue({ data: { ok: true } })

    i18n.global.locale.value = 'zh-CN'
  })

  it('allows fractional cycle hours and submits rounded cycle minutes', async () => {
    const wrapper = await mountView()

    await findButton(wrapper, i18n.global.t('admin.compatRechargeAction')).trigger('click')
    await flushPromises()

    const cycleInput = findNumberInput(wrapper, i18n.global.t('admin.compatCycleHours'))
    expect(cycleInput.attributes('data-precision')).toBe('2')

    await cycleInput.setValue('0.1')
    await flushPromises()

    expect(wrapper.text()).toContain('6分钟')

    await findButton(wrapper, i18n.global.t('admin.recharge')).trigger('click')
    await flushPromises()

    expect(mocks.rechargeSitePower).toHaveBeenCalledWith(
      expect.objectContaining({
        cycle_duration: 6,
      })
    )
    expect(mocks.elMessageWarning).not.toHaveBeenCalled()
  })
})
