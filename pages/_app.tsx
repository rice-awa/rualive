import '@mantine/core/styles.css'
// 「似了喵？」动森色板 CSS 变量（:root），被 device.module.css 消费
import '@/styles/device-globals.css'
// animal-island-ui 全局样式预设（动森风）。全局影响仅 :root CSS 变量 + [class^=animal-] 作用域内样式，
// 不覆盖 body 底色 / 全局 font-family（实测见 docs/DEV_PLAN.md T10），与 Mantine 共存无冲突
import 'animal-island-ui/style'
import type { AppProps } from 'next/app'
import { MantineProvider } from '@mantine/core'
import NoSsr from '@/components/NoSsr'
import '@/util/i18n'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <NoSsr>
      <MantineProvider defaultColorScheme="auto">
        <Component {...pageProps} />
      </MantineProvider>
    </NoSsr>
  )
}
