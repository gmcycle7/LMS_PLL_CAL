import { Section } from '@/components'
import { lazyPart, NearGate } from '../lazy'

// 這一節的內容（連同它用到的模型原始碼、presets、Plot 等）切成 lazy chunk，占位區接近可視範圍才下載。
// 標題（h2）留在 NearGate 外面：本頁目錄與頁內跳轉隨時找得到它。規則：首屏模組不能 import MonteCarloLabBody（lazyBoundary.test.ts 會檢查）。
const Body = lazyPart(() => import('./MonteCarloLabBody').then((m) => ({ default: m.MonteCarloLabBody })))

export function MonteCarloLab() {
  return (
    <Section kind="explore" title="§V.3 Monte Carlo 驗收：隨機的東西怎麼判定「對」？" level={2} id="ver-mc">
      <NearGate label="§V.3 Monte Carlo 驗收" minHeight={3200} kind="exp">
        <Body />
      </NearGate>
    </Section>
  )
}
