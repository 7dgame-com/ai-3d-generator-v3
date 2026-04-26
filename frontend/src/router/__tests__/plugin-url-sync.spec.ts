import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/token', () => ({
  isInIframe: () => true,
}))

vi.mock('../../composables/useAuthSession', () => ({
  useAuthSession: () => ({
    fetchSession: vi.fn(),
    isRootUser: { value: true },
  }),
}))

vi.mock('../../views/NotInIframeView.vue', () => ({ default: { template: '<div>NotInIframe</div>' } }))
vi.mock('../../views/NoPermissionView.vue', () => ({ default: { template: '<div>NoPermission</div>' } }))
vi.mock('../../views/ApiDiagnosticsView.vue', () => ({ default: { template: '<div>ApiDiagnostics</div>' } }))
vi.mock('../../layout/AppLayout.vue', () => ({ default: { template: '<div><router-view /></div>' } }))
vi.mock('../../views/GeneratorView.vue', () => ({ default: { template: '<div>Generator</div>' } }))
vi.mock('../../views/HistoryView.vue', () => ({ default: { template: '<div>History</div>' } }))
vi.mock('../../views/AdminView.vue', () => ({ default: { template: '<div>Admin</div>' } }))

import router from '../index'

describe('plugin URL sync', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await router.push('/')
    await router.isReady()
  })

  it('sends plugin-url-changed events after route changes', async () => {
    const postMessageSpy = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => undefined)

    await router.push('/history?status=done#tasks')

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT',
        payload: {
          event: 'plugin-url-changed',
          pluginUrl: '/history?status=done#tasks',
        },
      }),
      '*',
    )
  })
})
