import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyToken = vi.fn()

vi.mock('../../api', () => ({
  verifyToken,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

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

  it('awaits the in-flight verify-token request for concurrent fetches', async () => {
    const sessionResult = deferred<{
      data: {
        data: {
          id: number
          roles: string[]
        }
      }
    }>()
    verifyToken.mockReturnValue(sessionResult.promise)

    const { useAuthSession } = await import('../useAuthSession')
    const first = useAuthSession()
    const second = useAuthSession()

    const firstFetch = first.fetchSession(true)
    const secondFetch = second.fetchSession()
    let secondSettled = false
    secondFetch.then(() => {
      secondSettled = true
    })

    await Promise.resolve()

    expect(verifyToken).toHaveBeenCalledTimes(1)
    expect(secondSettled).toBe(false)

    sessionResult.resolve({
      data: {
        data: {
          id: 7,
          roles: ['root'],
        },
      },
    })
    await Promise.all([firstFetch, secondFetch])

    expect(first.roles.value).toEqual(['root'])
    expect(second.roles.value).toEqual(['root'])
  })
})
