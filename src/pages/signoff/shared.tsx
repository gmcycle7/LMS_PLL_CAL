import { Fragment, useMemo, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { HandCalc, Mermaid, StepDerivation, Tex, mathText, type ExperimentPreset } from '@/components'
import { presetsForExperiment } from '@/app/presets'
import { useSettings, type LearningMode } from '@/app/settings'
import { fmt } from '@/simulation/core'
import type { LinkRef } from './data'
import { handcalc } from './handcalcs'

/**
 * Sign-off 頁共用的小元件（只在本頁使用；可考慮上移到共用層，見回報）。
 */

/**
 * 把含 `$…$` 的字串轉成 ReactNode（文字 + KaTeX）；給只收 ReactNode、不會自動轉換的屬性用
 * （ParamControl 的 label／hint、Quiz 選項…）。這類屬性若不是純字串，記得另給 ariaLabel。
 */
export function rich(text: string): ReactNode {
  return mathText(text)
}

/** 使用者輸入的文字（例如 corner 名稱）放進會被 mathText 解析的字串前，先把 `$` 跳脫成字面符號。 */
export function plainText(s: string): string {
  return s.replace(/\$/g, '\\$')
}

/** 把含 `$…$` 的字串渲染成「文字 + KaTeX」。`$` 的數量必須為偶數（data.test.ts 檢查）。 */
export function RichText({ text }: { text: string }) {
  const parts = text.split('$')
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Tex key={i}>{p}</Tex> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}

/** 驗證頁的勘誤深連結：#/verification?e=Exx（驗證頁依 id 展開並捲動到該勘誤）。 */
export function erratumHref(id: string): string {
  return `#/verification?e=${encodeURIComponent(id)}`
}

/** 「勘誤 Exx」小標：連到驗證頁（#/verification，依 id 列出勘誤）。用純 <a>，HashRouter 下即可。 */
export function ErratumTag({ id }: { id: string }) {
  return (
    <a className="so-erratum" href={erratumHref(id)} data-erratum={id} title={`本頁採用 docs/validation.md ${id} 的修正版本；見驗證頁的勘誤列表`}>
      勘誤 {id}
    </a>
  )
}

/** 帶說明文字的勘誤註記（一行）。 */
export function ErratumNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="so-erratum-note" role="note">
      <ErratumTag id={id} />
      <span>{children}</span>
    </div>
  )
}

/** 平滑捲動到本頁錨點（HashRouter 下不能用 href="#id" 直接跳，會被當成路由）。 */
export function scrollToAnchor(id: string) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

/** 站內連結：'/…' 走 router；'#…' 捲動到本頁錨點。label 可含 `$…$` 行內數學。 */
export function SiteLink({ link }: { link: LinkRef }) {
  if (link.to.startsWith('#')) {
    const id = link.to.slice(1)
    return (
      <a
        href={`#/signoff`}
        data-anchor={id}
        onClick={(e) => {
          e.preventDefault()
          scrollToAnchor(id)
        }}
      >
        <RichText text={link.label} />
      </a>
    )
  }
  return (
    <Link to={link.to}>
      <RichText text={link.label} />
    </Link>
  )
}

/** 目前學習模式；在 <SettingsProvider> 之外（單獨預覽）退回 'engineer'。 */
export function useMode(): LearningMode {
  try {
    return useSettings().mode
  } catch {
    return 'engineer'
  }
}

/**
 * 逐步推導：Engineer／Research 直接展開；Beginner 預設收合、一鍵展開（同一份內容）。
 * `title` 與每一步的 `why` 若是字串，其中的 `$…$` 以 KaTeX 顯示（StepDerivation 本身不會轉換 ReactNode 欄位）。
 */
export function Steps(props: ComponentProps<typeof StepDerivation>) {
  const mode = useMode()
  const steps = useMemo(() => props.steps.map((s) => ({ ...s, why: mathText(s.why) })), [props.steps])
  const title = mathText(props.title)
  if (mode !== 'beginner') return <StepDerivation {...props} steps={steps} title={title} />
  return (
    <details className="so-details">
      <summary>
        {title ?? '推導'}（{props.steps.length} 步；Beginner 模式預設收合，點此展開）
      </summary>
      <StepDerivation {...props} steps={steps} title={undefined} />
    </details>
  )
}

/**
 * 「換你算」：一句引導（先換成自己的數字、用紙筆算一次）＋ 帶入手算題（docs/teaching-style.md §7）。
 * 題目定義在 ./handcalcs.ts（solve() 呼叫 judges.ts 的實際函式），這裡只負責依 id 取出並排版。
 */
export function HandCalcSlot({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <div className="so-handcalc" data-handcalc={id}>
      <p className="so-handcalc-lead">
        <strong>換你算</strong>：{children ?? '把下面的數字換成你自己的。'}
        先自己用紙筆算一次，再看詳解對答案。
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}

/**
 * 方塊圖 + 「怎麼讀這張圖」導讀（docs/teaching-style.md §8）。
 * 圖上的數學在 diagrams.ts 以 `$...$` 寫 LaTeX、由 <Mermaid> 用 KaTeX 排版；導讀與圖說（caption 支援 `$…$`）用 KaTeX 把圖上的名字對回正文的公式。
 * 圖放在文字說明之後、逐步推導之前。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel: string; children?: ReactNode }) {
  return (
    <div className="so-diagram">
      <Mermaid chart={chart} caption={caption} ariaLabel={ariaLabel} />
      {children && <div className="so-diagram-walk">{children}</div>}
    </div>
  )
}

/** 一般文字用的數字格式。 */
export function nf(x: number, digits = 4): string {
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  return Number.isFinite(x) ? fmt(x, digits) : '—'
}

/** KaTeX 字串用的數字格式（指數改成 \times10^{}）。 */
export function tx(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{NaN}'
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${Number(m[2])}}`
  return s
}

/** #rrggbb → rgba()；Plotly 讀不到 CSS 變數，需要實際顏色。 */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim())
  if (!m) return color
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
}

/** 本頁實驗的 presets：本地 presets + src/data/presets 中屬於該實驗的 preset（若有）。local 請傳模組常數。 */
export function usePresetList(experimentId: string, local: ExperimentPreset[]): ExperimentPreset[] {
  return useMemo(
    () => [...local, ...presetsForExperiment(experimentId).map((p) => ({ name: p.title, params: p.params, description: p.description }))],
    [experimentId, local],
  )
}

/** 判決徽章 */
export function Verdict({ kind, children }: { kind: 'ok' | 'bad' | 'warn' | 'muted'; children: ReactNode }) {
  return <span className={`so-verdict so-verdict-${kind}`}>{children}</span>
}

/** 本頁的段落錨點標題（h2 + id），供 TOC 與站內連結使用。label 可含 `$…$` 行內數學（以 RichText 顯示）。 */
export const TOC: { id: string; label: string }[] = [
  { id: 'so-intro', label: '0. 簽核要回答什麼' },
  { id: 'so-matrix', label: '1. Sign-off Matrix（互動）' },
  { id: 'so-polarity', label: String.raw`2. 基本正確性：freeze $\pm\Delta w$` },
  { id: 'so-sspll', label: '2.5 SSPLL GOS／PHOS' },
  { id: 'so-claims', label: '3. 何時可以宣稱穩定' },
  { id: 'so-evidence', label: '3.5 證據強度' },
  { id: 'so-corner', label: '4. Corner' },
  { id: 'so-fcw-noise', label: '5. FCW 與 Noise' },
  { id: 'so-fixed', label: '6. 非線性與定點' },
  { id: 'so-mimo', label: '7. 多參數' },
  { id: 'so-strategy', label: '8. 校正策略與輸出' },
  { id: 'so-negative', label: '9. 反面測試（§17）' },
  { id: 'so-limits', label: '10. 附錄 B 十項限制' },
  { id: 'so-wrap', label: '11. 思考題與必記' },
  { id: 'symbols', label: '本頁符號表' },
]
