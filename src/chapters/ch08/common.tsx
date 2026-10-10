import { Fragment, type ReactNode } from 'react'
import { HandCalc, Tex } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import errataFile from '@/data/errata.json'
import { handcalc } from './handcalcs'

/**
 * Ch08 私有的小工具（不放進共用層；最終回報中列為「建議上移」候選）。
 */

interface ErratumRecord {
  eid: string
  problem?: string
  correction?: string
}

const ERRATA: ErratumRecord[] = (errataFile as { errata: ErratumRecord[] }).errata

/** 「勘誤 Exx」小標記：連到驗證頁（勘誤清單），滑鼠停留顯示勘誤摘要。 */
export function ErratumNote({ id, children }: { id: string; children?: ReactNode }) {
  const rec = ERRATA.find((e) => e.eid === id)
  const title = rec?.correction ? `${id}：${rec.correction.slice(0, 220)}${rec.correction.length > 220 ? '…' : ''}` : id
  const link = (
    <a className="ch08-erratum" href="#/verification" title={title} data-erratum={id}>
      勘誤 {id}
    </a>
  )
  if (!children) return link
  return (
    <span className="ch08-erratum-wrap">
      {link}
      <span className="ch08-erratum-text">：{children}</span>
    </span>
  )
}

const RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

/**
 * 依學習模式決定預設展開的推導框（teaching-style §6）：
 * Beginner 預設收合（一鍵展開）；Engineer 以上預設展開；Research 專屬內容請用 ModeGate。
 */
export function Expand({
  title,
  children,
  openFrom = 'engineer',
  badge = '推導',
}: {
  title: ReactNode
  children: ReactNode
  openFrom?: LearningMode
  badge?: string
}) {
  const { mode } = useSettings()
  const open = RANK[mode] >= RANK[openFrom]
  return (
    <details className="ch08-expand" open={open} key={`${mode}-${openFrom}`}>
      <summary>
        <span className="ch08-expand-badge">{badge}</span> {title}
      </summary>
      <div className="ch08-expand-body">{children}</div>
    </details>
  )
}

/** 數字 → 顯示字串（固定小數位；NaN → —；±∞ → ∞） */
export function fx(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '—'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  const s = x.toFixed(digits)
  return Object.is(Number(s), -0) ? (0).toFixed(digits) : s
}

/** 數字 → TeX 片段（負號用 TeX 的 -；NaN 顯示為 \text{—}） */
export function tx(x: number, digits = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{—}`
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : String.raw`-\infty`
  return fx(x, digits)
}

/** 有效位數格式（去掉尾端 0） */
export function sig(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '—'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  if (x === 0) return '0'
  return String(Number(x.toPrecision(digits)))
}

/**
 * 有效位數格式 → TeX 片段（放進 `$…$` 用）：指數寫成 a\times10^{b}，NaN → \text{—}，±∞ → \infty。
 * 警告、指標名稱等「字串屬性」會由共用元件的 mathText 轉成 KaTeX，所以數字也要是合法的 TeX。
 */
export function tsig(x: number, digits = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{—}`
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : String.raw`-\infty`
  if (x === 0) return '0'
  const s = String(Number(x.toPrecision(digits)))
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${Number(m[2])}}` : s
}

/** 複數 → TeX（a \pm jb） */
export function ctx(z: { re: number; im: number }, digits = 4): string {
  const re = fx(z.re, digits)
  if (Math.abs(z.im) < 10 ** -(digits + 2)) return re
  return `${re} ${z.im < 0 ? '-' : '+'} j${fx(Math.abs(z.im), digits)}`
}

/**
 * 把含 `$…$` 的說明文字轉成 ReactNode：`$` 之間的片段以 KaTeX（Tex）呈現，其餘為一般文字。
 * 用在 StepDerivation 的 why、表格標題等「一句話理由」，確保公式一律是 LaTeX（teaching-style §3）。
 * 例：rich('令 $m=k+1$，再補回第 0 項') 。
 */
export function rich(text: string): ReactNode {
  const parts = text.split('$')
  if (parts.length === 1) return text
  return parts.map((p, i) => (i % 2 === 1 ? <Tex key={i}>{p}</Tex> : p ? <Fragment key={i}>{p}</Fragment> : null))
}

/**
 * 「換你算」：一句引導（請讀者先換成自己的數字、用紙筆算一次）＋ 帶入手算題。
 * 題目定義在 ./handcalcs.ts（solve() 呼叫 stability.ts 的實際函式），這裡只負責依 id 取出並排版。
 */
export function HandCalcSlot({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <div className="ch08-handcalc" data-handcalc={id}>
      <p className="ch08-handcalc-lead">
        <strong>換你算</strong>：{children ?? '把下面的數字換成你自己的。'}
        先自己用紙筆算一次，再看詳解對答案。
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}
