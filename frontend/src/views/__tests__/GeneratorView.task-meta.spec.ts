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
  createTask: vi.fn(),
  downloadTaskFile: vi.fn(),
  fetchThumbnailBlob: vi.fn(),
  getEnabledProviders: vi.fn(),
  listTasks: vi.fn(),
  startPolling: vi.fn(),
  stopAllPolling: vi.fn(),
  uploadToMain: vi.fn(),
  fetchAllowedActions: vi.fn(),
  can: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../../api', () => ({
  createTask: mocks.createTask,
  downloadTaskFile: mocks.downloadTaskFile,
  fetchThumbnailBlob: mocks.fetchThumbnailBlob,
  getEnabledProviders: mocks.getEnabledProviders,
  listTasks: mocks.listTasks,
}))

vi.mock('../../composables/usePermissions', () => ({
  usePermissions: () => ({
    can: mocks.can,
    fetchAllowedActions: mocks.fetchAllowedActions,
  }),
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

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({
      push: mocks.push,
    }),
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
    template: '<div><slot /></div>',
  }),
  ElOption: defineComponent({
    props: ['label', 'value'],
    template: '<div><slot /></div>',
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

describe('Feature: hyper3d-gen2-upgrade, GeneratorView task metadata', () => {
  beforeEach(() => {
    mocks.showCreditDialog.value = false
    mocks.isAdmin.value = true
    mocks.checkCredits.mockReset()
    mocks.triggerDialog.mockReset()
    mocks.closeDialog.mockReset()
    mocks.createTask.mockReset()
    mocks.downloadTaskFile.mockReset()
    mocks.fetchThumbnailBlob.mockReset()
    mocks.getEnabledProviders.mockReset()
    mocks.listTasks.mockReset()
    mocks.startPolling.mockReset()
    mocks.stopAllPolling.mockReset()
    mocks.uploadToMain.mockReset()
    mocks.fetchAllowedActions.mockReset()
    mocks.can.mockReset()
    mocks.push.mockReset()

    mocks.fetchAllowedActions.mockResolvedValue(undefined)
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['hyper3d', 'tripo3d'] } })
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-meta-1',
            providerId: 'hyper3d',
            type: 'text_to_model',
            prompt: 'chair',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:02:30.000Z',
            downloadExpired: false,
          },
          {
            taskId: 'task-meta-2',
            providerId: 'tripo3d',
            type: 'image_to_model',
            prompt: 'lamp',
            status: 'processing',
            progress: 67,
            creditCost: 0,
            outputUrl: null,
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: null,
            downloadExpired: false,
          },
        ],
        total: 2,
      },
    })
    mocks.can.mockReturnValue(true)
    i18n.global.locale.value = 'en-US'
  })

  it('renders provider label, credit cost, and generation duration in the metadata row', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Hyper3D')
    expect(wrapper.text()).toContain('30 credits')
    expect(wrapper.text()).toContain('2 min 30 sec')
  })

  it('omits duration when the task has not completed yet', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Tripo3D')
    expect(wrapper.text()).not.toContain('0 min 0 sec')
  })
})
