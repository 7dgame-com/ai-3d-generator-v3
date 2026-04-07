import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import enUS from './locales/en-US'
import jaJP from './locales/ja-JP'
import thTH from './locales/th-TH'

const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// 从 URL 参数获取语言设置
function getLanguageFromURL(): SupportedLocale {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
    return lang as SupportedLocale
  }
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: getLanguageFromURL(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'en-US': enUS,
    'ja-JP': jaJP,
    'th-TH': thTH,
  },
})

// 监听主框架的 LANG_CHANGE 消息，运行时切换语言无需刷新
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const { type, payload } = (event.data || {}) as { type?: string; payload?: { lang?: string } }
  if (type === 'LANG_CHANGE' && payload?.lang) {
    const lang = payload.lang
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      i18n.global.locale.value = lang as SupportedLocale
    }
  }
})

export default i18n
