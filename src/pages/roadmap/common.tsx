import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { mathText, type ExperimentPreset } from '@/components'
import { pageById } from '@/app/registry'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import errataData from '@/data/errata.json'
import { fmt } from '@/simulation/core'
import { ITEM_STATUS_DESC, ITEM_STATUS_LABEL, SUB_STATUS_LABEL, type ItemStatus, type SubStatus } from './data'

/* ───────────── 文字中的 $…$ → KaTeX（所有數學一律 LaTeX） ───────────── */

/** 把含 `$…$` 的字串拆成文字與 KaTeX 片段。 */
export function splitMath(text: string): { math: boolean; s: string }[] {
  const out: { math: boolean; s: string }[] = []
  const re = /\$([^$]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ math: false, s: text.slice(last, m.index) })
    out.push({ math: true, s: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ math: false, s: text.slice(last) })
  return out
}

/**
 * 字串中的 `$…$` → 行內 KaTeX（共用的 mathText；docs/teaching-style.md §3：數學一律 LaTeX）。
 * JSX 內文用 `{mt('把 $\\mu$ 拉到 …')}`，資料檔的字串用 `<Rich text={…} />`。
 */
export const mt = mathText

export function Rich({ text }: { text: string }) {
  return <>{mathText(text)}</>
}

/**
 * ParamControl / SelectControl 的 label：畫面顯示 KaTeX（`$…$`），aria-label 用純文字（螢幕閱讀器與測試查詢）。
 * 用法：`<ParamControl {...pl('$\\mu$（步長）', 'mu（步長）')} … />`
 */
export function pl(tex: string, aria: string): { label: ReactNode; ariaLabel: string } {
  return { label: mathText(tex), ariaLabel: aria }
}

/* ───────────── 狀態徽章（沒有 verified） ───────────── */

export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={`rm-status rm-status-${status}`} title={ITEM_STATUS_DESC[status]} data-status={status}>
      {ITEM_STATUS_LABEL[status]}
    </span>
  )
}

export function SubBadge({ status }: { status: SubStatus }) {
  return (
    <span className={`rm-sub rm-sub-${status}`} data-status={status}>
      {SUB_STATUS_LABEL[status]}
    </span>
  )
}

/* ───────────── 勘誤標記：連到 #/verification ───────────── */

interface ErratumRecord {
  eid: string
  severity: string
  location: string
  correction: string
}

const ERRATA: ErratumRecord[] = (errataData as { errata: ErratumRecord[] }).errata

export function erratumExists(eid: string): boolean {
  return ERRATA.some((e) => e.eid === eid)
}

/** 「勘誤 Exx」：本站與規格書原文不同之處，連到驗證頁（依 id 列出勘誤）。 */
export function ErratumTag({ eid }: { eid: string }) {
  const rec = ERRATA.find((e) => e.eid === eid)
  return (
    <a className={`rm-erratum rm-erratum-${rec?.severity ?? 'unknown'}`} href="#/verification" title={rec ? `規格位置：${rec.location}` : undefined}>
      勘誤 {eid}
    </a>
  )
}

/** 句中的勘誤註記：小標記 + 一句說明（字串中的 `$…$` 以 KaTeX 顯示）。 */
export function ErratumNote({ eid, children }: { eid: string; children: ReactNode }) {
  return (
    <span className="rm-erratum-note">
      <ErratumTag eid={eid} /> <span className="small">{mathText(children)}</span>
    </span>
  )
}

/* ───────────── 連到其他頁面（標題取自 registry） ───────────── */

export function PageRef({ id, children }: { id: string; children?: ReactNode }) {
  const p = pageById(id)
  if (!p) return <span className="muted">{children ?? id}</span>
  return <Link to={p.path}>{children ?? p.nav}</Link>
}

/* ───────────── 小提示框（字串項目中的 `$…$` 以 KaTeX 顯示） ───────────── */

export function TryIt({ items }: { items: ReactNode[] }) {
  return (
    <div className="rm-tryit">
      <div className="rm-tryit-title">試試看</div>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{mathText(it)}</li>
        ))}
      </ul>
    </div>
  )
}

export function Observe({ children }: { children: ReactNode }) {
  return (
    <div className="rm-observe">
      <span className="rm-observe-title">你會發現</span> {mathText(children)}
    </div>
  )
}

/* ───────────── 數字格式 ───────────── */

/** 顯示用數字（4 位有效數字；極大極小改科學記號）。 */
export const n4 = (x: number): string => (Number.isFinite(x) ? fmt(x, 4) : x > 0 ? '∞' : x < 0 ? '−∞' : 'NaN')
export const n6 = (x: number): string => (Number.isFinite(x) ? fmt(x, 6) : x > 0 ? '∞' : 'NaN')

/** 把 preset 參數合併進目前參數：只接受同型別的欄位（避免壞 preset 弄壞狀態）。 */
export function mergeParams<T extends object>(prev: T, patch: Record<string, unknown>): T {
  const next = { ...prev } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in next)) continue
    const cur = next[k]
    if (typeof cur === 'number' && typeof v === 'number' && Number.isFinite(v)) next[k] = v
    else if (typeof cur === 'string' && typeof v === 'string') next[k] = v
    else if (typeof cur === 'boolean' && typeof v === 'boolean') next[k] = v
  }
  return next as T
}

/**
 * Presets：本頁內建的 + `src/data/presets/` 中屬於此實驗的（presetsForExperiment），
 * 並套用網址 `?preset=<id>`（useUrlPreset）。
 */
export function useRoadmapPresets(id: string, inline: ExperimentPreset[], apply: (p: Record<string, unknown>) => void): ExperimentPreset[] {
  const url = useUrlPreset(id)
  const applyRef = useRef(apply)
  applyRef.current = apply
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (url && applied.current !== url.id) {
      applied.current = url.id
      applyRef.current(url.params)
    }
  }, [url])
  return useMemo(
    () => [...inline, ...presetsForExperiment(id).map((p) => ({ name: p.title, params: p.params, description: p.description }))],
    [id, inline],
  )
}

/** 小表格：key / value 兩欄（手機友善，包在 .table-wrap 裡；字串中的 `$…$` 以 KaTeX 顯示）。 */
export function KvTable({ rows, caption }: { rows: [ReactNode, ReactNode][]; caption?: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="rm-kv">
        {caption && <caption>{mathText(caption)}</caption>}
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i}>
              <th scope="row">{mathText(k)}</th>
              <td>{mathText(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
