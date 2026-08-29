import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from '../locales/en/common.json'
import zhCN from '../locales/zh-CN/common.json'
import zhTW from '../locales/zh-TW/common.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      'zh-CN': { common: zhCN },
      zh: { common: zhCN },
      'zh-TW': { common: zhTW },
    },
    fallbackLng: 'en',
    // 资源只挂 common 这一个 namespace；工具模块里的命令式 i18n.t()（如 util/deviceFormat.ts）
    // 不带 ns 调用，必须显式指定默认 ns，否则查不到键会原样返回键名
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['navigator'],
    },
  })

export default i18n
