import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import GeneratorView from '../GeneratorView.vue'

const mocks = vi.hoisted(() => ({
  showCreditDialog: { value: false, __v_isRef: true },
  isAdmin: { value: true, __v_isRef: true },
  themeName: { value: 'edu-friendly', __v_isRef: true },
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
  fetchAllowedActions: vi.fn(),
  can: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../../api', () => ({
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

vi.mock('../../composables/useDirectTaskCreation', () => ({
  useDirectTaskCreation: () => ({
    createTask: mocks.directCreateTask,
    isCreating: { value: false, __v_isRef: true },
  }),
}))

vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({
    themeName: mocks.themeName,
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
  ElIcon: defineComponent({
    template: '<span><slot /></span>',
  }),
  ElPagination: defineComponent({
    props: ['currentPage', 'pageSize', 'total'],
    emits: ['current-change', 'update:current-page'],
    template:
      '<div data-test="pagination"><button data-test="page-2" @click="$emit(\'update:current-page\', 2); $emit(\'current-change\', 2)">2</button></div>',
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
    mocks.themeName.value = 'edu-friendly'
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
            powerCost: 1,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:02:30.000Z',
            downloadExpired: false,
            expiresAt: '2026-04-08T01:30:00.000Z',
          },
          {
            taskId: 'task-meta-2',
            providerId: 'tripo3d',
            directModeTask: true,
            type: 'image_to_model',
            prompt: 'lamp',
            status: 'processing',
            progress: 67,
            creditCost: 0,
            powerCost: 0,
            outputUrl: null,
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: null,
            downloadExpired: false,
            expiresAt: null,
          },
        ],
        total: 25,
        page: 1,
        pageSize: 20,
      },
    })
    mocks.can.mockReturnValue(true)
    i18n.global.locale.value = 'en-US'
  })

  it('renders provider label, power cost, and generation duration in the metadata row', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Hyper3D')
    expect(wrapper.text()).toContain('1 power')
    expect(wrapper.text()).toContain('2 min 30 sec')
  })

  it('falls back to the provider default power when a successful task was persisted with zero cost', async () => {
    mocks.listTasks.mockResolvedValueOnce({
      data: {
        data: [
          {
            taskId: 'task-meta-fallback',
            providerId: 'tripo3d',
            type: 'text_to_model',
            prompt: 'cat house',
            status: 'success',
            progress: 100,
            creditCost: 0,
            powerCost: 0,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
            downloadExpired: false,
            expiresAt: '2026-04-08T01:30:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Tripo3D')
    expect(wrapper.text()).toContain('1 power')
  })

  it('omits duration when the task has not completed yet', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Tripo3D')
    expect(wrapper.text()).not.toContain('0 min 0 sec')
  })

  it('resumes polling direct-mode tasks after reload so progress can continue updating', async () => {
    await mountView()

    expect(mocks.startPolling).toHaveBeenCalledWith('task-meta-2', expect.any(Function))
  })

  it('renders the expiry countdown for successful tasks with expiresAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'))

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('剩余 1小时30分')

    vi.useRealTimers()
  })

  it('shows pagination and reloads the selected page', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-test="pagination"]').exists()).toBe(true)

    await wrapper.get('[data-test="page-2"]').trigger('click')
    await flushPromises()

    expect(mocks.listTasks).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
  })

  it('posts a host navigation event when clicking a created resource entry', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    mocks.listTasks.mockResolvedValueOnce({
      data: {
        data: [
          {
            taskId: 'task-meta-resource',
            providerId: 'tripo3d',
            type: 'text_to_model',
            prompt: '小狗',
            status: 'success',
            progress: 100,
            creditCost: 30,
            powerCost: 1,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: 5391,
            errorMessage: null,
            createdAt: '2026-04-10T04:11:00.000Z',
            completedAt: '2026-04-10T04:12:07.000Z',
            downloadExpired: false,
            expiresAt: '2026-04-11T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    i18n.global.locale.value = 'zh-CN'

    const wrapper = await mountView()

    expect(wrapper.get('[data-test="task-resource-task-meta-resource"]').text()).toBe('查看')

    await wrapper.get('[data-test="task-resource-task-meta-resource"]').trigger('click')

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'EVENT',
        id: expect.any(String),
        payload: {
          event: 'navigate-host',
          path: '/resource/polygen/index',
          query: {
            lang: 'zh-CN',
            theme: 'edu-friendly',
            resourceId: '5391',
            open: '1',
          },
        },
      },
      '*',
    )

    postMessageSpy.mockRestore()
  })
})
