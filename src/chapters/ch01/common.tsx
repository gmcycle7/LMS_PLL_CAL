import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, Tex } from '@/components'
import { fmt } from '@/simulation/core'
import type { PoleBehaviour } from '@/simulation/models/lms'
import errata from '@/data/errata.json'
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

/** 「連結到 PLL」提示框 */
export function PllLink({ title = '連結到 PLL', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="ch01-pll">
      <div className="ch01-pll-title">{title}</div>
      <div>{children}</div>
    </div>
  )
}

/** 整數轉 Unicode 下標（給 Plotly 圖例、metric 名稱這類只能放純文字的地方）：12 → ₁₂ */
export function sub(n: number): string {
  return String(n).replace(/[0-9-]/g, (d) => (d === '-' ? '₋' : '₀₁₂₃₄₅₆₇₈₉'[Number(d)]))
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
