import { Section } from '@/components'
import { lazyPart, NearGate } from '../lazy'

// 這一節的內容（連同它用到的模型原始碼、presets、Plot 等）切成 lazy chunk，占位區接近可視範圍才下載。
// 標題（h2）留在 NearGate 外面：本頁目錄與頁內跳轉隨時找得到它。規則：首屏模組不能 import ErrataBrowserBody（lazyBoundary.test.ts 會檢查）。
// ?e=E05 指向這一節裡的勘誤卡片，所以只有這一節（不是整頁的延後區塊）會為它立刻掛載；?t=T05 指向首屏的驗收表，不強制任何區塊。
const Body = lazyPart(() => import('./ErrataBrowserBody').then((m) => ({ default: m.ErrataBrowserBody })))

export function ErrataBrowser({ focusEid }: { focusEid: string | null }) {
  return (
    <Section kind="assumptions" title="§V.6 勘誤瀏覽器：規格書哪裡錯了、網站怎麼改" level={2} id="ver-errata">
      <NearGate label="§V.6 勘誤瀏覽器" minHeight={3000} force={focusEid !== null}>
        <Body focusEid={focusEid} />
      </NearGate>
    </Section>
  )
}
