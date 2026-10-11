import type { ReactNode } from 'react'
import { ClaimTag, CodeBlock, CodeCompare, HandCalc, Mermaid, Tex, TexBlock, mathText, type ClaimKind, type CodeCompareItem } from '@/components'
import { diagramById } from './diagrams'
import { formulaById } from './formulas'
import { HANDCALCS } from './handcalcs'
import modelSrc from '@/simulation/models/sspll.ts?raw'
import pyRegressors from '../../../analysis/sspll/golden/sspll_golden/regressors.py?raw'
import pyPredictions from '../../../analysis/sspll/golden/sspll_golden/predictions.py?raw'
import pySimulator from '../../../analysis/sspll/golden/sspll_golden/simulator.py?raw'

export const r = String.raw

/** 迴路名稱 `L1`／`L2`／`L3` 的 LaTeX 版（`$L_2$`），給圖表標題與圖例用 */
export const loopTex = (key: string): string => `$L_${key.slice(1)}$`

export const MODEL_PATH = 'src/simulation/models/sspll.ts'
/** sspll.ts 的原始碼（?raw）：頁面顯示的就是網站實際執行的程式 */
export const MODEL_SRC: string = modelSrc
const PY_DIR = 'analysis/sspll/golden/sspll_golden'

export const PY_SOURCES = {
  regressors: { source: pyRegressors, path: `${PY_DIR}/regressors.py` },
  predictions: { source: pyPredictions, path: `${PY_DIR}/predictions.py` },
  simulator: { source: pySimulator, path: `${PY_DIR}/simulator.py` },
} as const

/** 固定小數位數（顯示用；負號用 U+2212）；非有限數顯示「—」 */
export function fx(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace('-', '−')
}

/** 有效位數（顯示用）；極小或極大值改用科學記號 */
export function fp(v: number | null | undefined, sig = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(sig - 1).replace(/-/g, '−')
  return Number(v.toPrecision(sig)).toString().replace('-', '−')
}

/** 帶正號的固定小數（κ 這類有符號的量） */
export function fs(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = fx(v, digits)
  return v > 0 && !/^0\.?0*$/.test(s) ? `+${s}` : s
}

/** TeX 內使用的固定小數（負號用 ASCII '-'） */
export function tx(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return r`\text{—}`
  const s = v.toFixed(digits)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}

/** TeX 內使用的有效位數；|v| < 1e-3 或 ≥ 1e5 時寫成 a\times10^{b} */
export function txs(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return r`\text{—}`
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    const [m, e] = v.toExponential(sig - 1).split('e')
    return `${m}\\times10^{${Number(e)}}`
  }
  return String(Number(v.toPrecision(sig)))
}

/**
 * 數值以 KaTeX 顯示；極小／極大值寫成 a×10^b 的 TeX（教學規範：數學一律 LaTeX，內文與表格不用「1e−5」這種寫法）。
 * 非有限數顯示「—」。
 */
export function Sci({ v, sig = 4 }: { v: number | null | undefined; sig?: number }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <>—</>
  return <Tex>{txs(v, sig)}</Tex>
}

/** 區間清單 → 「a–b、c–d」文字（MHz） */
export function intervalsText(iv: [number, number][] | undefined, digits = 1): string {
  if (!iv || iv.length === 0) return '無'
  return iv.map(([a, b]) => (a === b ? fx(a, digits) : `${fx(a, digits)}–${fx(b, digits)}`)).join('、')
}

/** 依正負號回傳 CSS class（|v| ≤ tol 視為 dead zone） */
export function signClass(v: number | null | undefined, tol = 1e-3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  return v > tol ? 'cs-pos' : v < -tol ? 'cs-neg' : 'cs-dead'
}

/** 行內的三層結論標籤（與分析文件的【精確｜指定模型】／【近似｜需驗證】／【研究假說】一一對應） */
export function Claim({ kind, children }: { kind: ClaimKind; children?: ReactNode }) {
  return (
    <span className="cs-claim">
      <ClaimTag kind={kind} />
      {children && <span className="cs-claim-note">{children}</span>}
    </span>
  )
}

/** 簡單資料表（外層可水平捲動）；caption、表頭與儲存格為字串時支援 `$...$` 行內公式（ReactNode 原樣輸出） */
export function DataTable({ head, rows, caption, className }: { head: ReactNode[]; rows: ReactNode[][]; caption?: ReactNode; className?: string }) {
  return (
    <div className={`table-wrap cs-table${className ? ` ${className}` : ''}`}>
      <table>
        {caption && <caption>{mathText(caption)}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{mathText(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{mathText(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 數字來源註記 */
export function Src({ children }: { children: ReactNode }) {
  return <p className="cs-src small muted">數字來源：{children}</p>
}

export function TryIt({ items }: { items: ReactNode[] }) {
  return (
    <div className="cs-tryit">
      <div className="cs-tryit-title">試試看</div>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

/** 顯示 sspll.ts（網站實際執行的 TS port）的核心段落 */
export function ModelCode({ region, title, caption }: { region: string; title?: string; caption?: string }) {
  return <CodeBlock source={modelSrc} region={region} path={MODEL_PATH} title={title} caption={caption} />
}

/** 顯示 Python golden 的核心段落 */
export function GoldenCode({ file, region, title, caption }: { file: keyof typeof PY_SOURCES; region: string; title?: string; caption?: string }) {
  const s = PY_SOURCES[file]
  return <CodeBlock source={s.source} region={region} lang="python" path={s.path} title={title} caption={caption} />
}

/** 並排比較 sspll.ts 的多個 region（差異行以 `// ← 差異：…` 標出） */
export function ModelCompare({ items, caption, layout }: { items: { label: string; region: string; note?: string }[]; caption?: string; layout?: 'columns' | 'tabs' }) {
  const list: CodeCompareItem[] = items.map((it) => ({ ...it, source: modelSrc, path: MODEL_PATH }))
  return <CodeCompare items={list} caption={caption} layout={layout} />
}

/** κ 值的儲存格：正＝restoring、負＝反號、近 0＝dead zone */
export function Kappa({ v, digits = 4, tol = 1e-3 }: { v: number | null | undefined; digits?: number; tol?: number }) {
  return <span className={`mono ${signClass(v, tol)}`}>{fs(v, digits)}</span>
}

export function T({ children }: { children: string }) {
  return <Tex>{children}</Tex>
}

/** 顯示登錄在 formulas.ts 的公式（TexBlock 的 id 與登錄 ID 相同，Formula & Unit Reference 頁可連回來）；title 內的 `$...$` 以 KaTeX 顯示 */
export function Formula({ id }: { id: string }) {
  const f = formulaById(id)
  return (
    <TexBlock id={f.id} label={mathText(f.title)}>
      {f.tex}
    </TexBlock>
  )
}

/** fs 值的顯示：≥ 1000 fs 改用 ps 並標成紅色粗體（線性模型下的「發散值」） */
export function fmtFs(v: number | undefined | null): ReactNode {
  if (v === undefined || v === null || !Number.isFinite(v)) return '–'
  if (v >= 1000) return <strong className="cs-neg">{fx(v / 1000, 1)} ps</strong>
  return `${fx(v, 1)} fs`
}

/**
 * 捲到本頁的某個錨點。HashRouter 下不能用 `href="#id"`（會被當成路由），所以一律用按鈕 + scrollIntoView；
 * 舊瀏覽器與 jsdom 沒有 scrollIntoView 時什麼都不做。
 */
export function scrollToId(id: string): void {
  const el = document.getElementById(id)
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 方塊圖：由 ./diagrams 的 DIAGRAMS 以 id 查表（Mermaid 原始碼、圖說都在那裡，diagrams.test.tsx 以真正的 parser 檢查）。
 * 圖說前面自動加上圖號「圖 CS-n」（n 為頁面順序），內文用 <FigRef id="…" /> 引用同一個編號。
 */
export function Diagram({ id }: { id: string }) {
  const d = diagramById(id)
  return (
    <div className="cs-diagram" id={`fig-${d.def.id}`} data-diagram={d.def.id} data-kind={d.def.kind}>
      <Mermaid chart={d.def.chart} caption={`${d.label}｜${d.def.caption}`} ariaLabel={`${d.label}：${d.def.alt ?? d.def.caption}`} />
    </div>
  )
}

/** 行內的圖號（「圖 CS-n」）；按下去捲到那張圖 */
export function FigRef({ id }: { id: string }) {
  const d = diagramById(id)
  return (
    <button type="button" className="cs-linkbtn cs-figref" onClick={() => scrollToId(`fig-${d.def.id}`)}>
      {d.label}
    </button>
  )
}

const HANDCALC_BY_ID = new Map(HANDCALCS.map((h) => [h.id, h]))

/**
 * 「帶入手算」題：由 ./handcalcs 的 HANDCALCS 以 id 查表，前面加一句邀請讀者先自己算。
 * children 可以換成更貼近該段落的邀請句（字串支援 `$...$`）。
 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALC_BY_ID.get(id)
  if (!def) throw new Error(`未登錄的手算題 ${id}`)
  return (
    <div className="cs-hand">
      <p className="cs-hand-invite">
        <strong>換你算：</strong>
        {children ? mathText(children) : '把下面的數字換成你自己的設計值，先用紙筆和計算機算一次，再按「自己算算看」對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/**
 * 捲到本頁某一題「帶入手算」（HandCalc 的 section id 是 handcalc-<題號>）。
 * 和 <FigRef>、符號表連結一樣用按鈕：HashRouter 下 `href="#handcalc-…"` 會被當成路由（在新分頁開啟時會跳到不存在的頁面）。
 */
export function HandLink({ id }: { id: string }) {
  return (
    <button type="button" className="cs-linkbtn" onClick={() => scrollToId(`handcalc-${id}`)}>
      {id}
    </button>
  )
}
