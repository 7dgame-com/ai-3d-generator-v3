import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import GeneratorView from '../GeneratorView.vue'

const mocks = vi.hoisted(() => ({
  showCreditDialog: { value: false, __v_isRef: true },
  isAdmin: { value: true, __v_isRef: true },
  checkCredits: vi.fn(),
  triggerDialog: vi.fn(),
  closeDialog: vi.fn(),
  directCreateTask: vi.fn(),
  downloadTaskFile: vi.fn(),
  fetchThumbnailBlob: vi.fn(),
  getEnabledProviders: vi.fn(),
  listTasks: vi.fn(),
  startPolling: vi.fn(),
  stopAllPolling: vi.fn(),
  uploadToMain: vi.fn(),
  push: vi.fn(),
  elMessageError: vi.fn(),
}))

vi.mock('../../api', () => ({
  downloadTaskFile: mocks.downloadTaskFile,
  fetchThumbnailBlob: mocks.fetchThumbnailBlob,
  getEnabledProviders: mocks.getEnabledProviders,
  listTasks: mocks.listTasks,
}))

vi.mock('../../composables/useTaskPoller', () => ({
  useTaskPoller: () => ({
    startPolling: mocks.startPolling,
    stopAllPolling: mocks.stopAllPolling,
  }),
}))

vi.mock('../../composables/useUploadService', () => ({
  useUploadService: () => ({
    uploadToMain: mocks.uploadToMain,
  }),
}))

vi.mock('../../composables/useCreditCheck', () => ({
  useCreditCheck: () => ({
    showCreditDialog: mocks.showCreditDialog,
    isAdmin: mocks.isAdmin,
    checkCredits: mocks.checkCredits,
    triggerDialog: mocks.triggerDialog,
    closeDialog: mocks.closeDialog,
  }),
}))

vi.mock('../../composables/useDirectTaskCreation', () => ({
  useDirectTaskCreation: () => ({
    createTask: mocks.directCreateTask,
    isCreating: { value: false, __v_isRef: true },
  }),
}))

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({
      push: mocks.push,
    }),
  }
})

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessage: {
      error: mocks.elMessageError,
    },
  }
})

vi.mock('../../components/CreditDialog.vue', () => ({
  default: defineComponent({
    name: 'CreditDialog',
    props: {
      visible: Boolean,
      isAdmin: Boolean,
    },
    template: '<div data-test="credit-dialog" />',
  }),
}))

const globalStubs = {
  ElSelect: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div data-test="provider-select"><slot /></div>',
  }),
  ElOption: defineComponent({
    props: ['label', 'value'],
    template: '<div data-test="provider-option">{{ label }}</div>',
  }),
  ElTabs: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div><slot /></div>',
  }),
  ElTabPane: defineComponent({
    props: ['label', 'name'],
    template: '<section><slot /></section>',
  }),
  ElInput: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
  ElButton: defineComponent({
    props: ['disabled', 'loading', 'text'],
    emits: ['click'],
    template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  }),
  ElEmpty: defineComponent({
    props: ['description'],
    template: '<div>{{ description }}</div>',
  }),
  ElTag: defineComponent({
    props: ['type', 'size'],
    template: '<span><slot /></span>',
  }),
  ElProgress: defineComponent({
    props: ['percentage'],
    template: '<div>{{ percentage }}</div>',
  }),
  ElIcon: defineComponent({
    template: '<span><slot /></span>',
  }),
  ElPagination: defineComponent({
    template: '<div />',
  }),
  CreditDialog: false,
}

async function mountView() {
  const wrapper = mount(GeneratorView, {
    global: {
      plugins: [i18n],
      stubs: globalStubs,
    },
  })

  await flushPromises()
  return wrapper
}

describe('GeneratorView provider selector', () => {
  beforeEach(() => {
    mocks.showCreditDialog.value = false
    mocks.isAdmin.value = true
    mocks.checkCredits.mockReset()
    mocks.triggerDialog.mockReset()
    mocks.closeDialog.mockReset()
    mocks.directCreateTask.mockReset()
    mocks.downloadTaskFile.mockReset()
    mocks.fetchThumbnailBlob.mockReset()
    mocks.getEnabledProviders.mockReset()
    mocks.listTasks.mockReset()
    mocks.startPolling.mockReset()
    mocks.stopAllPolling.mockReset()
    mocks.uploadToMain.mockReset()
    mocks.push.mockReset()
    mocks.elMessageError.mockReset()

    mocks.fetchThumbnailBlob.mockResolvedValue({ data: new Blob(['thumb']) })
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    })
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d'] } })
    i18n.global.locale.value = 'en-US'
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:thumbnail'),
        revokeObjectURL: vi.fn(),
      })
    )
  })

  it('shows a fixed provider label instead of a dropdown when only one provider is enabled', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-test="provider-select"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="single-provider-label"]').text()).toBe('tripo3d')
  })

  it('keeps the dropdown when multiple providers are enabled', async () => {
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d', 'hyper3d'] } })

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="single-provider-label"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="provider-select"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="provider-option"]').map((option) => option.text())).toEqual([
      'tripo3d',
      'hyper3d',
    ])
  })
})
