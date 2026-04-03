const TOKEN_KEY = 'ai-3d-gen-v3-token'
const REFRESH_TOKEN_KEY = 'ai-3d-gen-v3-refresh-token'

export function isInIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function removeAllTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function requestParentTokenRefresh(): Promise<{ accessToken: string } | null> {
  return new Promise((resolve) => {
    let finished = false
    const timeout = window.setTimeout(() => {
      if (finished) return
      finished = true
      window.removeEventListener('message', onMessage)
      resolve(null)
    }, 3000)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      const { type, payload } = (event.data || {}) as { type?: string; payload?: { token?: string } }
      if (type === 'TOKEN_UPDATE' && payload?.token) {
        if (finished) return
        finished = true
        window.clearTimeout(timeout)
        setToken(payload.token)
        window.removeEventListener('message', onMessage)
        resolve({ accessToken: payload.token })
      }
    }

    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'TOKEN_REFRESH_REQUEST' }, '*')
  })
}
