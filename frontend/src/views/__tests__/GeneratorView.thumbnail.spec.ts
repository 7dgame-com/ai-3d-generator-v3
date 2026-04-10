import fs from 'fs'
import path from 'path'
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
  fetchAllowedActions: vi.fn(),
  can: vi.fn(),
  push: vi.fn(),
  elMessageError: vi.fn(),
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

describe('GeneratorView thumbnail preview', () => {
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
    mocks.fetchAllowedActions.mockReset()
    mocks.can.mockReset()
    mocks.push.mockReset()
    mocks.elMessageError.mockReset()

    mocks.fetchAllowedActions.mockResolvedValue(undefined)
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d'] } })
    mocks.fetchThumbnailBlob.mockResolvedValue({ data: new Blob(['thumb']) })
    mocks.can.mockReturnValue(true)
    i18n.global.locale.value = 'en-US'
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:thumbnail'),
        revokeObjectURL: vi.fn(),
      })
    )
  })

  it('renders blob-backed thumbnails for valid thumbnails and placeholders otherwise', async () => {
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-thumb-ok',
            type: 'text_to_model',
            prompt: 'chair',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: 'https://cdn.example.com/preview.webp',
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
            downloadExpired: false,
          },
          {
            taskId: 'task-thumb-expired',
            type: 'text_to_model',
            prompt: 'table',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: 'https://cdn.example.com/expired-preview.webp',
            thumbnailExpired: true,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
            downloadExpired: false,
          },
          {
            taskId: 'task-thumb-missing',
            type: 'text_to_model',
            prompt: 'lamp',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: null,
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
            downloadExpired: false,
          },
        ],
        total: 3,
      },
    })

    const wrapper = await mountView()

    const image = wrapper.get('[data-test="task-thumbnail-task-thumb-ok"]')
    expect(mocks.fetchThumbnailBlob).toHaveBeenCalledWith('task-thumb-ok')
    expect(image.attributes('src')).toBe('blob:thumbnail')
    expect(image.classes()).toContain('task-thumbnail-image')

    expect(wrapper.get('[data-test="task-thumbnail-placeholder-task-thumb-expired"]').classes()).toContain(
      'task-thumbnail-placeholder'
    )
    expect(wrapper.get('[data-test="task-thumbnail-placeholder-task-thumb-missing"]').classes()).toContain(
      'task-thumbnail-placeholder'
    )
  })

  it('falls back to the placeholder when thumbnail image loading fails', async () => {
    mocks.fetchThumbnailBlob.mockRejectedValueOnce(new Error('thumbnail failed'))
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-thumb-error',
            type: 'text_to_model',
            prompt: 'sofa',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://cdn.example.com/model.glb',
            thumbnailUrl: 'https://cdn.example.com/preview.webp',
            thumbnailExpired: false,
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
            downloadExpired: false,
          },
        ],
        total: 1,
      },
    })

    const wrapper = await mountView()
    expect(wrapper.find('[data-test="task-thumbnail-task-thumb-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="task-thumbnail-placeholder-task-thumb-error"]').exists()).toBe(true)
  })

  it('refreshes a cached thumbnail when a task transitions from processing to success', async () => {
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-thumb-transition',
            type: 'text_to_model',
            prompt: 'robot',
            status: 'processing',
            progress: 92,
            creditCost: 30,
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
        total: 1,
      },
    })

    const wrapper = await mountView()
    const updateTask = mocks.startPolling.mock.calls[0]?.[1] as ((task: Record<string, unknown>) => void) | undefined

    expect(updateTask).toBeTypeOf('function')
    expect(mocks.fetchThumbnailBlob).not.toHaveBeenCalled()

    ;(wrapper.vm as unknown as { thumbnailBlobUrls: Record<string, string> }).thumbnailBlobUrls = {
      'task-thumb-transition': 'blob:stale-preview',
    }

    updateTask?.({
      taskId: 'task-thumb-transition',
      type: 'text_to_model',
      prompt: 'robot',
      status: 'success',
      progress: 100,
      creditCost: 30,
      outputUrl: 'https://cdn.example.com/model.glb',
      thumbnailUrl: 'https://cdn.example.com/render.jpg',
      thumbnailExpired: false,
      resourceId: null,
      errorMessage: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      completedAt: '2026-04-08T00:01:00.000Z',
      downloadExpired: false,
    })
    await flushPromises()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-preview')
    expect(mocks.fetchThumbnailBlob).toHaveBeenCalledWith('task-thumb-transition')
  })

  it('keeps the thumbnail style contract in the SFC source', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../GeneratorView.vue'), 'utf8')

    expect(source).toMatch(/\.task-thumbnail-image[\s\S]*width:\s*80px/i)
    expect(source).toMatch(/\.task-thumbnail-image[\s\S]*height:\s*80px/i)
    expect(source).toMatch(/\.task-thumbnail-image[\s\S]*object-fit:\s*cover/i)
  })
})
