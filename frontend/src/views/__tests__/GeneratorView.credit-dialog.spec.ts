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
    emits: ['go-admin', 'update:visible'],
    template: `
      <div data-test="credit-dialog" :data-visible="String(visible)" :data-admin="String(isAdmin)">
        <button data-test="go-admin" @click="$emit('go-admin')">go-admin</button>
      </div>
    `,
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

function createInsufficientCreditsError() {
  return {
    response: {
      data: {
        code: 'INSUFFICIENT_CREDITS',
      },
    },
  }
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

describe('GeneratorView credit dialog integration', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn())
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-model'),
      revokeObjectURL: vi.fn(),
    })
    mocks.showCreditDialog.value = false
    mocks.isAdmin.value = true
    mocks.checkCredits.mockReset()
    mocks.triggerDialog.mockReset()
    mocks.closeDialog.mockReset()
    mocks.directCreateTask.mockReset()
    mocks.downloadTaskFile.mockReset()
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
    mocks.downloadTaskFile.mockResolvedValue({
      data: new Blob(['model']),
      headers: {
        'content-disposition': 'attachment; filename="model.glb"',
      },
    })
    mocks.getEnabledProviders.mockResolvedValue({ data: { providers: ['tripo3d'] } })
    mocks.listTasks.mockResolvedValue({ data: { data: [], total: 0 } })
    mocks.can.mockReturnValue(true)
    i18n.global.locale.value = 'en-US'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('checks credits on mount and passes dialog state through to CreditDialog', async () => {
    mocks.showCreditDialog.value = true
    mocks.isAdmin.value = false

    const wrapper = await mountView()

    expect(mocks.checkCredits).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-test="credit-dialog"]').attributes('data-visible')).toBe('true')
    expect(wrapper.get('[data-test="credit-dialog"]').attributes('data-admin')).toBe('false')
  })

  it('downloads through the authenticated backend endpoint and saves the model locally', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-download-1',
            type: 'text_to_model',
            prompt: 'chair',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://provider.example.com/long-signed-url',
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
          },
        ],
        total: 1,
      },
    })

    const wrapper = await mountView()
    const downloadButton = wrapper.findAll('button').find((button) => button.text() === 'Download')

    await downloadButton?.trigger('click')

    expect(mocks.downloadTaskFile).toHaveBeenCalledWith('task-download-1')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-model')
    expect(globalThis.open).not.toHaveBeenCalled()

    clickSpy.mockRestore()
  })

  it('uses the response filename when the backend provides content-disposition', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mocks.listTasks.mockResolvedValue({
      data: {
        data: [
          {
            taskId: 'task-download-2',
            type: 'text_to_model',
            prompt: 'table',
            status: 'success',
            progress: 100,
            creditCost: 30,
            outputUrl: 'https://provider.example.com/long-signed-url',
            resourceId: null,
            errorMessage: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            completedAt: '2026-04-08T00:01:00.000Z',
          },
        ],
        total: 1,
      },
    })
    mocks.downloadTaskFile.mockResolvedValue({
      data: new Blob(['model']),
      headers: {
        'content-disposition': 'attachment; filename="task-download-2.glb"',
      },
    })

    const wrapper = await mountView()
    const downloadButton = wrapper.findAll('button').find((button) => button.text() === 'Download')

    await downloadButton?.trigger('click')

    const links = wrapper.element.ownerDocument.body.querySelectorAll('a[download="task-download-2.glb"]')
    expect(mocks.downloadTaskFile).toHaveBeenCalledWith('task-download-2')
    expect(links.length).toBe(0)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
  })

  it('navigates to /admin and closes the dialog when CreditDialog emits go-admin', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-test="go-admin"]').trigger('click')

    expect(mocks.push).toHaveBeenCalledWith('/admin')
    expect(mocks.closeDialog).toHaveBeenCalledTimes(1)
  })

  it('opens the credit dialog instead of showing a toast when text task creation returns INSUFFICIENT_CREDITS', async () => {
    mocks.directCreateTask.mockRejectedValue(createInsufficientCreditsError())

    const wrapper = await mountView()
    await wrapper.get('textarea').setValue('cute dragon')
    await wrapper.findAll('button').find((button) => button.text() === 'Generate')?.trigger('click')

    expect(mocks.triggerDialog).toHaveBeenCalledTimes(1)
    expect(mocks.elMessageError).not.toHaveBeenCalled()
  })

  it('opens the credit dialog instead of showing a toast when image task creation returns INSUFFICIENT_CREDITS', async () => {
    const originalFileReader = globalThis.FileReader
    class FileReaderMock {
      result: string | null = null
      onload: null | (() => void) = null

      readAsDataURL() {
        this.result = 'data:image/png;base64,Zm9v'
        this.onload?.()
      }
    }

    mocks.directCreateTask.mockRejectedValue(createInsufficientCreditsError())
    globalThis.FileReader = FileReaderMock as unknown as typeof FileReader

    try {
      const wrapper = await mountView()
      const file = new File(['foo'], 'credit.png', { type: 'image/png' })
      const fileInput = wrapper.get('input[type="file"]')

      Object.defineProperty(fileInput.element, 'files', {
        configurable: true,
        value: [file],
      })

      await fileInput.trigger('change')
      await flushPromises()
      await wrapper.findAll('button').at(1)?.trigger('click')

      expect(mocks.triggerDialog).toHaveBeenCalledTimes(1)
      expect(mocks.elMessageError).not.toHaveBeenCalled()
    } finally {
      globalThis.FileReader = originalFileReader
    }
  })

  it('shows the upstream provider error message when task creation fails without a platform error code', async () => {
    mocks.directCreateTask.mockRejectedValue(
      new Error('Upstream unavailable: getaddrinfo ENOTFOUND oneapi')
    )

    const wrapper = await mountView()
    await wrapper.get('textarea').setValue('cute dragon')
    await wrapper.findAll('button').find((button) => button.text() === 'Generate')?.trigger('click')

    expect(mocks.triggerDialog).not.toHaveBeenCalled()
    expect(mocks.elMessageError).toHaveBeenCalledWith(
      'Upstream unavailable: getaddrinfo ENOTFOUND oneapi'
    )
  })
})
