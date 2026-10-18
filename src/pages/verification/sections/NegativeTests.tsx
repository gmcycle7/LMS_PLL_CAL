import { Section } from '@/components'
import { lazyPart, NearGate } from '../lazy'

// 這一節的內容（連同它用到的模型原始碼、presets、Plot 等）切成 lazy chunk，占位區接近可視範圍才下載。
// 標題（h2）留在 NearGate 外面：本頁目錄與頁內跳轉隨時找得到它。規則：首屏模組不能 import NegativeTestsBody（lazyBoundary.test.ts 會檢查）。
const Body = lazyPart(() => import('./NegativeTestsBody').then((m) => ({ default: m.NegativeTestsBody })))

export function NegativeTests() {
  return (
    <Section kind="assumptions" title="§V.4 反面測試：故意做錯，驗收機制抓不抓得到？" level={2} id="ver-negative">
      <NearGate label="§V.4 反面測試" minHeight={3400}>
        <Body />
      </NearGate>
    </Section>
  )
}
