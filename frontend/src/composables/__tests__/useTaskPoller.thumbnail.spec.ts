import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskPoller } from '../useTaskPoller'

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
}))

vi.mock('../../api', () => ({
  getTask: mocks.getTask,
}))

const Harness = defineComponent({
  setup(_, { expose }) {
    const poller = useTaskPoller()
    expose(poller)
    return () => h('div')
  },
})

describe('useTaskPoller thumbnail fields', () => {
  beforeEach(() => {
    mocks.getTask.mockReset()
  })

  it('passes thumbnailUrl and thumbnailExpired through to onUpdate', async () => {
    mocks.getTask.mockResolvedValue({
      data: {
        taskId: 'task-001',
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
      },
    })

    const wrapper = mount(Harness)
    const onUpdate = vi.fn()

    ;(wrapper.vm as unknown as { startPolling: (taskId: string, onUpdate: (task: unknown) => void) => void })
      .startPolling('task-001', onUpdate)
    await flushPromises()

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailUrl: 'https://cdn.example.com/preview.webp',
        thumbnailExpired: false,
      })
    )
  })
})
