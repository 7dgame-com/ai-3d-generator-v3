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

function createFile(name: string, type = 'image/png') {
  return new File(['image'], name, { type })
}

function createDragPayload(file: File) {
  return {
    dataTransfer: {
      files: [file],
      types: ['Files'],
    },
  }
}

describe('GeneratorView drag upload', () => {
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
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    })
    mocks.can.mockReturnValue(true)

    let objectUrlCounter = 0
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:preview-${++objectUrlCounter}`),
        revokeObjectURL: vi.fn(),
      })
    )

    class MockFileReader {
      result: string | ArrayBuffer | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null

      readAsDataURL(file: Blob) {
        this.result = `data:${file.type};base64,ZmFrZQ==`
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>)
      }
    }

    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
  })

  it('adds drag-active styling while files hover over the upload area', async () => {
    const wrapper = await mountView()
    const dropzone = wrapper.get('[data-test="image-dropzone"]')

    await dropzone.trigger('dragenter', createDragPayload(createFile('hover.png')))
    expect(dropzone.classes()).toContain('drag-active')

    await dropzone.trigger('dragleave', createDragPayload(createFile('hover.png')))
    expect(dropzone.classes()).not.toContain('drag-active')
  })

  it('accepts dropped files on the preview area and replaces the current preview', async () => {
    const wrapper = await mountView()
    const dropzone = wrapper.get('[data-test="image-dropzone"]')

    await dropzone.trigger('drop', createDragPayload(createFile('first.png')))
    await flushPromises()

    expect(wrapper.get('[data-test="image-preview"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="image-preview-img"]').attributes('src')).toBe('blob:preview-1')

    const preview = wrapper.get('[data-test="image-preview"]')
    await preview.trigger('dragenter', createDragPayload(createFile('second.png')))
    expect(dropzone.classes()).toContain('drag-active')

    await preview.trigger('drop', createDragPayload(createFile('second.png')))
    await flushPromises()

    expect(wrapper.get('[data-test="image-preview-img"]').attributes('src')).toBe('blob:preview-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
    expect(dropzone.classes()).not.toContain('drag-active')
  })
})
