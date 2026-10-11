import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, Mermaid, Tex } from '@/components'
import { fmt } from '@/simulation/core'
import type { PoleBehaviour } from '@/simulation/models/lms'
import errata from '@/data/errata.json'
import { diagramOf } from './diagrams'
import { handcalcOf } from './handcalcs'

/**
 * Ch01 私有的小工具（不放進共用層；最終回報會建議上移）。
 */

interface ErratumRecord {
  eid: string
  correction?: string
  problem?: string
}

const ERRATA = (errata as { errata: ErratumRecord[] }).errata

/** 「勘誤 Exx」小標籤，連到驗證頁（勘誤以 ID 列表）；滑鼠停留顯示修正內容摘要。 */
export function Erratum({ id, children }: { id: string; children?: ReactNode }) {
  const rec = ERRATA.find((e) => e.eid === id)
  const tip = rec?.correction ? `${id}：${rec.correction.slice(0, 220)}${rec.correction.length > 220 ? '…' : ''}` : id
  return (
    <a className="ch01-erratum" href="#/verification" title={tip} data-erratum={id}>
      勘誤 {id}
      {children ? <span className="ch01-erratum-note">：{children}</span> : null}
    </a>
  )
}

/** 規格補充（不是編號勘誤：validation.md 中「未通過 correct 的個別聲明」，或本章審查時對勘誤適用範圍的補充）。 */
export function SpecNote({ children, title = 'validation.md：Part A 未通過 correct 的個別聲明' }: { children: ReactNode; title?: string }) {
  return (
    <a className="ch01-erratum ch01-specnote" href="#/verification" title={title}>
      規格補充{children ? <span className="ch01-erratum-note">：{children}</span> : null}
    </a>
  )
}

const MODE_ORDER: LearningMode[] = ['beginner', 'engineer', 'research']

/**
 * 目前學習模式。在 SettingsProvider 之外（例如單獨預覽或測試）不丟錯，退回 Engineer 模式。
 * useSettings 內部只呼叫一次 useContext，所以 try/catch 不會改變 hook 呼叫順序（同 components/optionalSettings.ts）。
 */
function useSettingsOrNull(): ReturnType<typeof useSettings> | null {
  try {
    return useSettings()
  } catch {
    return null
  }
}

export function useChapterMode(): { mode: LearningMode; atLeast: (m: LearningMode) => boolean } {
  const settings = useSettingsOrNull()
  if (settings) return { mode: settings.mode, atLeast: settings.atLeast }
  const mode: LearningMode = 'engineer'
  return { mode, atLeast: (m) => MODE_ORDER.indexOf(mode) >= MODE_ORDER.indexOf(m) }
}

/** 數字顯示（全站 fmt：去尾零、極小／極大改指數） */
export const f = (x: number, digits = 4): string => fmt(x, digits)

/** 數字轉成 TeX（負號用 −、指數記號轉成 ×10^k） */
export function texNum(x: number, digits = 4): string {
  const s = fmt(x, digits)
  if (s === '∞') return String.raw`\infty`
  if (s === '-∞') return String.raw`-\infty`
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${m[2]}}`
  return s
}

/** 小型「試試看」提示 */
export function TryIt({ children }: { children: ReactNode }) {
  return (
    <div className="ch01-try">
      <span className="ch01-try-badge">試試看</span> {children}
    </div>
  )
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：依 id 從本章的 HANDCALCS 取出，前面加一句邀請讀者先自己算的引言。
 * 放在對應推導／worked example 的正後方；children 可以換成更貼近該段落的引言。
 */
export function ChapterHandCalc({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <div className="ch01-handcalc" data-handcalc={id}>
      <p className="ch01-handcalc-invite">
        <span className="ch01-try-badge">換你算</span>
        {children ?? '把下面的數字換成你自己的，先用紙筆（和計算機）算一次，再對照網站一步一步代入的結果。'}
      </p>
      <HandCalc def={handcalcOf(id)} />
    </div>
  )
}

/**
 * 方塊圖（docs/teaching-style.md §8）：依 id 從 diagrams.ts 取出 Mermaid 原始碼與圖說，圖的正下方放「怎麼看這張圖」。
 * children 是一兩句導讀（先看…再看…）加上「圖上的 X 就是公式裡的 x」的對應；數學一律用 <Tex>（圖說是純文字，不放公式）。
 * 放在白話說明之後、推導之前。
 */
export function BlockDiagram({ id, children }: { id: string; children: ReactNode }) {
  const d = diagramOf(id)
  return (
    <div className="ch01-diagram" data-diagram={d.id} data-diagram-kind={d.kind}>
      <Mermaid chart={d.chart} caption={`${d.label}｜${d.caption}`} />
      <p className="ch01-diagram-read">
        <span className="ch01-diagram-badge">怎麼看這張圖</span>
        {children}
      </p>
    </div>
  )
}

/** 「連結到 PLL」提示框 */
export function PllLink({ title = '連結到 PLL', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="ch01-pll">
      <div className="ch01-pll-title">{title}</div>
      <div>{children}</div>
    </div>
  )
}

/** lms.ts 的 POLE_BEHAVIOUR_LABEL 是純文字（給 metric 表）；正文表格用這份 LaTeX 版本。 */
export const BEHAVIOUR_TEX: Record<PoleBehaviour, [string, string]> = {
  monotone: ['0<p<1', '不變號、單調收斂'],
  oscillating: ['-1<p<0', '正負交替、震盪收斂'],
  deadbeat: ['p=0', '理想模型一步到答案'],
  boundary: ['|p|=1', '邊界，不保證收斂到 0'],
  divergent: ['|p|>1', '發散'],
  frozen: ['p=1,\\ \\mu=0', '學習率為 0，參數不動'],
}

export function BehaviourLabel({ b }: { b: PoleBehaviour }) {
  const [tex, text] = BEHAVIOUR_TEX[b]
  return (
    <>
      <Tex>{tex}</Tex>：{text}
    </>
  )
}

/** ParamControl 的標籤：「符號（說明）」，符號用 KaTeX（ParamControl 的 label 可含 <Tex>；記得另給純文字的 ariaLabel） */
export function symLabel(tex: string, text: string): ReactNode {
  return (
    <>
      <Tex>{tex}</Tex>（{text}）
    </>
  )
}
