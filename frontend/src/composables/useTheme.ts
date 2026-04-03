import { ref, watchEffect } from 'vue'

const DARK_THEMES = ['deep-space', 'cyber-tech']

const isDark = ref(false)
const themeName = ref('modern-blue')

/** 从 URL 参数读取初始主题 */
function initFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme')
  if (theme) {
    themeName.value = theme
    isDark.value = DARK_THEMES.includes(theme)
  }
}

/** 从 INIT config 中读取主题（URL 参数优先） */
export function setThemeFromConfig(config: Record<string, unknown>) {
  const params = new URLSearchParams(window.location.search)
  if (params.get('theme')) return // URL 参数优先

  const theme = config.theme as string | undefined
  if (theme) {
    themeName.value = theme
    isDark.value = DARK_THEMES.includes(theme)
  }
}

/** 监听主框架的主题切换消息 */
function listenForThemeChange() {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const { type, payload } = event.data || {}
    if (type === 'THEME_CHANGE' && payload?.theme) {
      themeName.value = payload.theme
      isDark.value = DARK_THEMES.includes(payload.theme)
    }
  })
}

/** 同步 data-theme 到 html 元素 */
watchEffect(() => {
  const el = document.documentElement
  el.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  // Element Plus 内置暗黑模式需要 html.dark
  if (isDark.value) {
    el.classList.add('dark')
  } else {
    el.classList.remove('dark')
  }
})

export function useTheme() {
  return { isDark, themeName }
}

// 自执行初始化
initFromUrl()
listenForThemeChange()
