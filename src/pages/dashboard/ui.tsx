import { Children, Fragment, isValidElement, useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, ChapterFig, accessibleText, badgeClass, mathText, usePersistentState } from '@/components'
import { pageById } from '@/app/registry'
import type { CheckState, ConditionId } from './thesisModel'
import { conditionById, shortCode } from './data'
import { erratumById } from './summaries'

/**
 * 把「文字 $TeX$ 文字」顯示成行內 KaTeX（資料檔與計算核心回傳的說明文字用）。
 * 直接使用共用的 mathText（與 ExperimentShell 的 warnings、MetricTable 的名稱同一套切法），不另寫一份。
 */
export function Rich({ text }: { text: string }) {
  return <>{gluePunctuation(mathText(text))}</>
}

/** 緊跟在行內公式後面、不該出現在行首的標點（句號、逗號、頓號、分號、冒號、右括號、右引號…） */
const CLOSING_PUNCT = /^[。，、；：！？）」』〉》】]+/
/** 公式超過這個字數就不綁：綁住之後整條公式不能在中間斷行，太長的在手機上會撐出欄寬（22 個字約 200px） */
export const GLUE_MAX_GLYPHS = 22
/** 公式排出來大約有幾個字：指令（\sigma、\mathbf…）各算一個字，間距指令、大括號、上下標符號、空白不算 */
export function texGlyphs(tex: string): number {
  return tex
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/\\[^a-zA-Z]/g, '')
    .replace(/[{}^_\s]/g, '').length
}

/**
 * 把行內公式和緊跟在後面的標點綁在同一行（<span class="dash-glue">，white-space: nowrap）。
 * KaTeX 的行內公式是不可斷行的 inline-block，瀏覽器允許在它後面換行（不管下一個字是不是句號），
 * 所以公式剛好排到行尾時，「。」會單獨掉到下一行的開頭。輸入是 mathText() 的結果；純文字原樣回傳。
 */
export function gluePunctuation(node: ReactNode): ReactNode {
  if (!isValidElement(node) || node.type !== Fragment) return node
  const parts = Children.toArray((node.props as { children?: ReactNode }).children)
  const out: ReactNode[] = []
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i]
    const next = parts[i + 1]
    const tex = isValidElement(cur) ? (cur.props as { children?: unknown }).children : undefined
    const m = typeof tex === 'string' && texGlyphs(tex) <= GLUE_MAX_GLYPHS && typeof next === 'string' ? CLOSING_PUNCT.exec(next) : null
    if (!m) {
      out.push(cur)
      continue
    }
    out.push(
      <span key={`glue${i}`} className="dash-glue">
        {cur}
        {m[0]}
      </span>,
    )
    const rest = (next as string).slice(m[0].length)
    if (rest) out.push(rest)
    i++ // 下一段文字已經處理
  }
  return <>{out}</>
}

/** 直接寫在 JSX 裡的「公式 + 標點」：<Glue><Tex>{'w_k'}</Tex>）；</Glue>（和 Rich 自動做的事相同） */
export function Glue({ children }: { children: ReactNode }) {
  return <span className="dash-glue">{children}</span>
}

/**
 * 方塊圖 + 「怎麼讀這張圖」導讀（docs/teaching-style.md §8）：共用的 ChapterFig。
 * 圖上的數學在 diagrams.ts 以 `$...$` 寫 LaTeX、由 <Mermaid> 用 KaTeX 排版；導讀與圖說（caption 支援 `$…$`）用 KaTeX 把圖上的名字對回正文的公式。
 * `dash-diagram` 只是測試與審查腳本的 hook。
 */
export function DiagramWalk({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children?: ReactNode }) {
  return (
    <ChapterFig chart={chart} caption={caption} ariaLabel={ariaLabel ?? caption} className="dash-diagram">
      {children}
    </ChapterFig>
  )
}

/** tooltip（title 屬性）等純文字情境：`$…$` 轉成可念的文字（accessibleText，與共用元件的做法一致）。 */
export function plainTip(text: string): string {
  return accessibleText(text)
}

/** 驗證頁的深連結：`#/verification?e=E05`（勘誤卡片）或 `?t=T05`（驗收列）；驗證頁會自動捲到該項。 */
export function verificationPath(id?: string): string {
  if (id && /^E\d{2}$/.test(id)) return `/verification?e=${id}`
  if (id && /^T\d{2}$/.test(id)) return `/verification?t=${id}`
  return '/verification'
}

/** 規格與網站不同之處的小註記「勘誤 Exx」，連到驗證頁的勘誤總表（依 id 深連結到該條目）。 */
export function ErratumLink({ eid }: { eid: string }) {
  const e = erratumById(eid)
  // title 屬性是純文字：勘誤位置描述裡的 `$…$` 要先轉成可念的文字
  const title = e ? `${e.eid}（${e.severity}）${e.area}：${accessibleText(e.location)}` : `${eid}：請見驗證頁`
  return (
    <Link to={verificationPath(eid)} className={badgeClass('erratum', `dash-erratum dash-sev-${e?.severity ?? 'low'} c-erratum-link`)} data-severity={e?.severity} data-erratum={eid} title={title}>
      勘誤 {eid}
    </Link>
  )
}

/** 頁面連結 chip：顯示章節短代號（Ch06）或頁面導覽名稱 */
export function PageChip({ id, primary = false }: { id: string; primary?: boolean }) {
  const p = pageById(id)
  if (!p) return <Badge variant="mismatch" className="dash-chip dash-chip-missing">{id}（不存在）</Badge>
  const code = shortCode(id)
  return (
    <Link to={p.path} className={badgeClass('neutral', `dash-chip${primary ? ' dash-chip-primary' : ''}`)} title={p.title}>
      {code ?? p.nav}
    </Link>
  )
}

/** 六條件 chip（色點對應條件卡片的顏色） */
export function ConditionChip({ id }: { id: ConditionId }) {
  const c = conditionById(id)
  return (
    <Badge className="dash-cond-chip" title={`${c.n}. ${c.zh}（${c.en}）`}>
      <span className="dash-dot" style={{ background: `var(${c.color})` }} aria-hidden="true" />
      {c.zh}
    </Badge>
  )
}

/**
 * 把主題色（#rgb / #rrggbb）轉成帶透明度的 rgba()，給 Plotly 的 fillcolor 用。
 * （trace 的 opacity 對 'tonexty' 填色不可靠：填色畫在前一條 trace 的群組裡。）無法解析時原樣回傳。
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const STATE_ICON: Record<CheckState, string> = { ok: '✓', warn: '!', fail: '✗' }
const STATE_LABEL: Record<CheckState, string> = { ok: '通過', warn: '注意', fail: '未通過' }

export function StateIcon({ state, label }: { state: CheckState; label?: string }) {
  return (
    <span className={`dash-state dash-state-${state}`} role="img" aria-label={label ?? STATE_LABEL[state]} title={label ?? STATE_LABEL[state]}>
      {STATE_ICON[state]}
    </span>
  )
}

export { STATE_LABEL }

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** 每位讀者自己的「已讀」紀錄（只存在本機 localStorage；不可用時只是不保存）。 */
export function useProgress() {
  const [done, setDone] = usePersistentState<string[]>('lmspll.dashboard.done', [], isStringArray)
  const set = useMemo(() => new Set(done), [done])
  const toggle = useCallback(
    (id: string) => setDone((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [setDone],
  )
  const clear = useCallback(() => setDone([]), [setDone])
  return useMemo(() => ({ done: set, toggle, clear }), [set, toggle, clear])
}

export type Progress = ReturnType<typeof useProgress>
