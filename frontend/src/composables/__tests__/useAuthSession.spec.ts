import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyToken = vi.fn()

vi.mock('../../api', () => ({
  verifyToken,
}))

describe('useAuthSession', () => {
  beforeEach(() => {
    vi.resetModules()
    verifyToken.mockReset()
  })

  it('marks the session as root when verify-token returns the root role', async () => {
    verifyToken.mockResolvedValue({
      data: {
        data: {
          id: 3,
          roles: ['root', 'admin'],
        },
      },
    })

    const { useAuthSession } = await import('../useAuthSession')
    const session = useAuthSession()

    await session.fetchSession(true)

    expect(session.roles.value).toEqual(['root', 'admin'])
    expect(session.isRootUser.value).toBe(true)
  })
})
