import { Section } from '@/components'
import { lazyPart, NearGate } from '../lazy'

// 這一節的內容（連同它用到的模型原始碼、presets、Plot 等）切成 lazy chunk，占位區接近可視範圍才下載。
// 標題（h2）留在 NearGate 外面：本頁目錄與頁內跳轉隨時找得到它。規則：首屏模組不能 import HowItWorksBody（lazyBoundary.test.ts 會檢查）。
const Body = lazyPart(() => import('./HowItWorksBody').then((m) => ({ default: m.HowItWorksBody })))

export function HowItWorks() {
  return (
    <Section kind="diagram" title="§V.5 驗證管線：TypeScript、Python golden 與 verify 腳本" level={2} id="ver-pipeline">
      <NearGate label="§V.5 驗證管線" minHeight={4600}>
        <Body />
      </NearGate>
    </Section>
  )
}
