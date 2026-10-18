import { Children, createContext, Fragment, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '@/app/useMediaQuery'
import { APP_VERSION, GIT_COMMIT } from './buildInfo'
import { Callout } from './Callout'
import { downloadText, toCsv } from './download'
import {
  buildExperimentPayload,
  buildExperimentReportInput,
  CROSS_CHECK_NAMES,
  normalizeCrossCheck,
  type ExperimentExportInput,
} from './experimentExport'
import { fileTimestamp, prettyJson, safeFileName } from './format'
import { randomSeed } from './hooks'
import { CHECK_LABEL } from './labels'
import { MetricTable } from './MetricTable'
import { createPlotRegistry, PlotRegistryProvider, type PlotRegistry } from './plotRegistry'
import { ScrollRegion } from './ScrollRegion'
import { buildReportHtml } from './report'
import { ClaimTag, ModelLevel, SourceTag } from './Tags'
import { TestBadge } from './TestBadge'
import { accessibleText, mathText } from './Tex'
import type {
  ClaimKind,
  CrossCheck,
  CsvColumns,
  ExperimentActions,
  ExperimentPreset,
  MetricRow,
  ModelLevelId,
  RunKind,
  RunProgress,
  SourceKind,
} from './types'

export interface ExperimentShellProps {
  /** 實驗 ID，例如 'lms-playground'（匯出檔名與報告使用） */
  id: string
  title: string
  level: ModelLevelId
  claim?: ClaimKind
  /** 預設 'illustrative' */
  source?: SourceKind
  /** 對應的 T-id，例如 ['T01', 'T02'] */
  tests?: string[]
  /** 標題下方的簡短說明 */
  description?: ReactNode
  /** 假設清單：顯示在頁面並寫入 JSON / 報告 */
  assumptions: string[]
  /** 參數面板（ParamControl 等） */
  controls: ReactNode
  /** 圖表與結果 */
  children: ReactNode
  /** 目前參數（匯出 JSON / 報告用） */
  params: Record<string, unknown>
  seed?: number
  onSeedChange?: (s: number) => void
  /** 參數或指標的單位，例如 { mu: 'fs', sigma_v: 'fs' } */
  units?: Record<string, string>
  metrics?: MetricRow[]
  /** 失穩 / 無解等警告；以 danger callout 顯示（必須解釋原因） */
  warnings?: string[]
  /** 未提供時三項都顯示 Not implemented */
  crossCheck?: CrossCheck
  /** 工具列動作；另可給 runKind / progress / onSkipToEnd（見 ExperimentShellActions） */
  actions?: ExperimentShellActions
  /** CSV 欄位（長度可不同，短欄以空白補齊） */
  exportData?: () => CsvColumns
  presets?: ExperimentPreset[]
  onLoadPreset?: (p: ExperimentPreset) => void
  /** 標題層級（預設 h3） */
  headingLevel?: 2 | 3 | 4
}

const SEED_MAX = 0xffff_ffff

export type { RunKind, RunProgress }

/**
 * 工具列動作。runKind / progress / onSkipToEnd 已併進 types.ts 的 ExperimentActions；這個別名保留給舊的 import。
 * - runKind：'animate' 時 Run 鈕旁多一顆「跳到結尾」（需 onSkipToEnd）；手機上按執行就捲到結果區（結果從第一步就在變），
 *   compute（預設）則等結果到了才捲
 * - progress：有給就畫確定式進度條（role=progressbar、aria-valuenow）；沒給而 running 時畫不確定式
 */
export type ExperimentShellActions = ExperimentActions

/* ===== 版面規則（純函式，測試用） ===== */

/** 控制欄 sticky 的最小視窗寬度（兩欄且桌面） */
export const STICKY_MIN_VIEWPORT_WIDTH = 1100
/** 控制項超過這個數量就把參數分組收合（<details>，第一組展開） */
export const CONTROL_COLLAPSE_THRESHOLD = 12
/** 沒有明確分組時：前面至少這麼多個控制項保持展開，其餘收進「其餘參數」 */
export const CONTROL_AUTO_OPEN = 8
/** 手機（< 760 px）：按執行後把結果捲進畫面、底部顯示狀態列 */
export const PHONE_MEDIA_QUERY = '(max-width: 759.98px)'
const STICKY_MEDIA_QUERY = `(min-width: ${STICKY_MIN_VIEWPORT_WIDTH}px)`
/** 結果區「完成」狀態列停留的時間（ms） */
export const DONE_STATUS_MS = 1600

/**
 * 控制欄是否黏住（position: sticky）：視窗 ≥ 1100 px、真的是兩欄（控制欄在結果欄左邊），
 * 而且整欄在頂列下方放得下（否則會需要內部捲軸，站規不允許 → 不黏，改用分組收合）。
 */
export function shouldStickControls(m: {
  viewportWidth: number
  viewportHeight: number
  columnHeight: number
  twoColumns: boolean
  topbarHeight?: number
  margin?: number
}): boolean {
  const { viewportWidth, viewportHeight, columnHeight, twoColumns, topbarHeight = 52, margin = 24 } = m
  if (!twoColumns || viewportWidth < STICKY_MIN_VIEWPORT_WIDTH) return false
  return columnHeight > 0 && columnHeight + topbarHeight + margin <= viewportHeight
}

/** 控制項數量超過門檻才分組收合 */
export function shouldCollapseControls(controlCount: number): boolean {
  return controlCount > CONTROL_COLLAPSE_THRESHOLD
}

/**
 * 沒有明確 ControlGroup 時的自動切分：counts 是控制欄每個頂層子節點裡的控制項數（依 DOM 順序）。
 * 回傳切點 k（前 k 個子節點保持展開，其餘收進「其餘參數」）：
 * - 優先在累積 ≥ openMin 個控制項的第一個節點後面切（後面還要有控制項）；
 * - 切到那裡後面已經沒有控制項（例如 [0, 1, 4, 9]：兩個章節自訂的分組 div），就退回最後一個
 *   「前面至少有 1 個控制項、後面還有控制項」的切點（→ 3：前 5 個展開、最後一組 9 個收合）；
 * - 控制項總數不到 openMin，或整欄只有一個子節點（[24]），回傳 null。
 */
export function autoGroupCut(counts: number[], openMin = CONTROL_AUTO_OPEN): number | null {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total < openMin) return null
  let acc = 0
  let fallback: number | null = null
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i]
    if (acc >= openMin) return total - acc > 0 ? i + 1 : fallback
    if (acc > 0) fallback = i + 1
  }
  return null
}

/** 控制欄的頂層子節點：章節都寫 controls={<>…</>}，所以單一 Fragment 要拆開（巢狀的也拆），才能對應 DOM 的子節點 */
export function topLevelControls(controls: ReactNode): ReactNode[] {
  let arr = Children.toArray(controls)
  while (arr.length === 1 && isValidElement<{ children?: ReactNode }>(arr[0]) && arr[0].type === Fragment) arr = Children.toArray(arr[0].props.children)
  return arr
}

/** 進度文字：「112/408 步」「3/9」 */
export function progressText(p: RunProgress, runKind: RunKind = 'compute'): string {
  const unit = p.unit ?? (runKind === 'animate' ? '步' : '')
  return `${p.done}/${p.total}${unit ? ` ${unit}` : ''}`
}

const ControlGroupContext = createContext<{ collapsible: boolean }>({ collapsible: false })

export interface ControlGroupProps {
  title: ReactNode
  children: ReactNode
  /** 收合模式下的預設狀態（未指定：第一組展開、其餘收合） */
  defaultOpen?: boolean
  className?: string
}

/**
 * 參數分組。控制項不多（≤ 12）時只是一個帶小標題的區塊；超過時整欄改成每組一個 <details>，
 * 第一組展開、其餘收合（使用者展開後維持），讓長達兩三屏的控制欄縮短而不需要內部捲軸。
 */
export function ControlGroup({ title, children, defaultOpen, className }: ControlGroupProps) {
  const { collapsible } = useContext(ControlGroupContext)
  const ref = useRef<HTMLElement | null>(null)
  const [isFirst, setIsFirst] = useState(false)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const column = el.closest('.c-exp-controls')
    setIsFirst(!!column && column.querySelector('.c-exp-group') === el)
  }, [collapsible])
  const cls = `c-exp-group${className ? ` ${className}` : ''}`
  if (!collapsible) {
    return (
      <div ref={ref as never} className={cls}>
        <div className="c-exp-group-title">{mathText(title)}</div>
        {children}
      </div>
    )
  }
  const open = userOpen ?? defaultOpen ?? isFirst
  return (
    <details ref={ref as never} className={cls} open={open} onToggle={(e) => setUserOpen(e.currentTarget.open)}>
      <summary>{mathText(title)}</summary>
      {children}
    </details>
  )
}

function SeedControl({ seed, onSeedChange }: { seed: number; onSeedChange?: (s: number) => void }) {
  const id = useId()
  const [text, setText] = useState(String(seed))
  const [synced, setSynced] = useState(seed)
  if (synced !== seed) {
    setSynced(seed)
    setText(String(seed))
  }
  const trimmed = text.trim()
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) <= SEED_MAX
  return (
    <div className="c-seed">
      <label htmlFor={id} className="c-seed-label">
        seed
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="c-seed-input mono"
        value={text}
        readOnly={!onSeedChange}
        aria-invalid={valid ? undefined : true}
        onChange={(e) => {
          setText(e.target.value)
          const t = e.target.value.trim()
          if (/^\d+$/.test(t) && Number(t) <= SEED_MAX && onSeedChange) onSeedChange(Number(t))
        }}
        onBlur={() => {
          if (!valid) setText(String(seed))
        }}
      />
      {onSeedChange && (
        <button type="button" className="btn" onClick={() => onSeedChange(randomSeed())}>
          隨機新 seed
        </button>
      )}
      {!valid && <span className="c-param-warn small">seed 必須是 0–4294967295 的整數</span>}
    </div>
  )
}

/** ActionBar 回報給外框的使用者動作（給 live 區播報與手機狀態列用） */
type ActionKind = 'run' | 'step' | 'stop' | 'skip'

function ActionBar({ actions, onAction }: { actions: ExperimentShellActions; onAction: (kind: ActionKind) => void }) {
  const { onReset, onStep, onRun, onRunToConvergence, onStop, onFreeze, onSkipToEnd, running = false, frozen = false, runKind = 'compute', progress } = actions
  const wrap = (kind: ActionKind, fn: () => void) => () => {
    onAction(kind)
    fn()
  }
  // 進度文字放在執行／停止鈕裡（例如「停止 Stop（112/408 步）」）：不多一個元素、工具列不跳動。
  // 動畫型停在半路（112/408）或播完（408/408、「跳到結尾」停用）時也要看得到第幾步，所以 animate 不限 running。
  const counter = progress && (running || runKind === 'animate') ? <span className="c-exp-progress-text mono">（{progressText(progress, runKind)}）</span> : null
  const atEnd = !!progress && progress.done >= progress.total
  return (
    <div className="c-exp-actions" role="group" aria-label="模擬控制">
      {onReset && (
        <button type="button" className="btn" onClick={onReset}>
          重設 Reset
        </button>
      )}
      {onStep && (
        <button type="button" className="btn" onClick={wrap('step', onStep)} disabled={running}>
          單步 Step
        </button>
      )}
      {onRun &&
        (running && onStop ? (
          <button type="button" className="btn btn-primary" onClick={wrap('stop', onStop)}>
            <span className="c-spinner" aria-hidden="true" />
            停止 Stop
            {counter}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={wrap('run', onRun)} disabled={running}>
            {running && <span className="c-spinner" aria-hidden="true" />}
            {running ? '執行中…' : '執行 Run'}
            {counter}
          </button>
        ))}
      {runKind === 'animate' && onSkipToEnd && (
        <button type="button" className="btn" onClick={wrap('skip', onSkipToEnd)} disabled={atEnd}>
          跳到結尾
        </button>
      )}
      {onRunToConvergence && (
        <button type="button" className="btn" onClick={wrap('run', onRunToConvergence)} disabled={running}>
          執行至收斂 Run-to-Convergence
        </button>
      )}
      {onFreeze && (
        <button
          type="button"
          className={`btn c-freeze${frozen ? ' is-active' : ''}`}
          aria-pressed={frozen}
          onClick={onFreeze}
        >
          {frozen ? '已凍結 Frozen' : '凍結 Freeze'}
        </button>
      )}
    </div>
  )
}

/**
 * 共用進度條：貼在工具列底邊的細條（不佔版面）。有 progress 就是確定式（aria-valuenow），
 * 否則不確定式（來回移動；prefers-reduced-motion 時靜止）。
 */
function ProgressBar({ progress, runKind }: { progress?: RunProgress; runKind: RunKind }) {
  const det = progress && progress.total > 0 ? progress : undefined
  const pct = det ? Math.max(0, Math.min(100, (100 * det.done) / det.total)) : undefined
  return (
    <div
      className={`c-exp-progress${det ? '' : ' is-indeterminate'}`}
      role="progressbar"
      aria-label="模擬進度"
      aria-valuemin={det ? 0 : undefined}
      aria-valuemax={det ? det.total : undefined}
      aria-valuenow={det ? det.done : undefined}
      aria-valuetext={det ? progressText(det, runKind) : '執行中'}
      data-testid="exp-progress"
    >
      <div className="c-exp-progress-fill" style={pct !== undefined ? { width: `${pct}%` } : undefined} />
    </div>
  )
}

/**
 * 模擬結束時給螢幕閱讀器的一句摘要：更新了幾個指標、有幾則警告。
 * 指標名稱是 LaTeX（例如 $\\sigma_w$），念不出來也不能用 Unicode 拼，所以不放名稱與數值；數值在下面的指標表裡。
 * 例如「模擬完成：7 個指標已更新；1 則警告」。
 */
export function finishSummary(metrics: MetricRow[] | undefined, warnings: string[]): string {
  const n = metrics?.filter((m) => typeof m.value === 'number' && Number.isFinite(m.value)).length ?? 0
  let text = n > 0 ? `模擬完成：${n} 個指標已更新` : '模擬完成'
  if (warnings.length > 0) text += `；${warnings.length} 則警告`
  return text
}

function CrossCheckRow({ crossCheck }: { crossCheck?: CrossCheck }) {
  const cc = normalizeCrossCheck(crossCheck)
  return (
    <div className="c-exp-crosscheck" aria-label="交叉比對">
      <span className="c-exp-crosscheck-title">交叉比對</span>
      {(Object.keys(cc) as (keyof CrossCheck)[]).map((k) => (
        <span key={k} className={`c-check c-check-${cc[k].status}`} title={cc[k].note ? accessibleText(cc[k].note) : undefined}>
          <span className="c-check-name">{CROSS_CHECK_NAMES[k]}</span>
          <span className="c-check-status">{CHECK_LABEL[cc[k].status]}</span>
          {cc[k].note && <span className="c-check-note small muted">{mathText(cc[k].note)}</span>}
        </span>
      ))}
    </div>
  )
}

/**
 * 互動實驗外框（conventions §3 / 規格 §19）：標題 + 標籤、控制列、雙欄（參數｜結果）、
 * 警告、交叉比對、假設、模擬條件摘要與 JSON / CSV / HTML 報告匯出。
 */
export function ExperimentShell(props: ExperimentShellProps) {
  const {
    id,
    title,
    level,
    claim,
    source = 'illustrative',
    tests,
    description,
    assumptions,
    controls,
    children,
    params,
    seed,
    onSeedChange,
    units,
    metrics,
    warnings = [],
    crossCheck,
    actions,
    exportData,
    presets,
    onLoadPreset,
    headingLevel = 3,
  } = props

  const registryRef = useRef<PlotRegistry | null>(null)
  if (!registryRef.current) registryRef.current = createPlotRegistry()
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  // ── 版面：控制欄 sticky（放得下且 ≥ 1100 px 兩欄）、控制項 > 12 時分組收合 ──
  const controlsRef = useRef<HTMLDivElement | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const wideViewport = useMediaQuery(STICKY_MEDIA_QUERY)
  const isPhone = useMediaQuery(PHONE_MEDIA_QUERY)
  const [sticky, setSticky] = useState(false)
  const [controlCount, setControlCount] = useState(0)
  // 自動切分（沒有 ControlGroup 時）：{ cut: 前幾個頂層子節點保持展開, rest: 收起的控制項數 }
  const [auto, setAuto] = useState<{ cut: number; rest: number } | null>(null)
  const collapsible = shouldCollapseControls(controlCount)
  const controlChildren = topLevelControls(controls)

  const measureLayout = () => {
    const ctl = controlsRef.current
    const res = resultsRef.current
    if (!ctl || !res) return
    const c = ctl.getBoundingClientRect()
    const r = res.getBoundingClientRect()
    const next = shouldStickControls({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      columnHeight: c.height,
      twoColumns: c.right <= r.left + 1,
    })
    setSticky((prev) => (prev === next ? prev : next))
  }

  // 每次 render 後數一次 DOM 裡的控制項（條件式控制項會增減）；每個 setState 都先比對、值不變就不更新，不會無限循環
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const ctl = controlsRef.current
    if (!ctl) return
    const count = ctl.querySelectorAll('.c-param').length
    setControlCount((prev) => (prev === count ? prev : count))
    const collapse = shouldCollapseControls(count)
    const explicit = !!ctl.querySelector('.c-exp-group:not(.is-auto)')
    if (!collapse || explicit) {
      if (auto) setAuto(null)
      return
    }
    if (auto) {
      // 已切分：只更新「其餘參數」的數量
      const rest = ctl.querySelector('.c-exp-group.is-auto')?.querySelectorAll('.c-param').length ?? 0
      if (rest !== auto.rest) setAuto({ ...auto, rest })
      return
    }
    // 章節自己已經用 <details> 收合（例如 /lab 的參數面板）就不再包一層
    if (ctl.querySelector('details')) return
    // 還是平鋪：每個 React 頂層子節點剛好對應一個 DOM 子節點時才切得準；對不上（fragment）就不自動切
    const nodes = Array.from(ctl.children)
    if (nodes.length !== controlChildren.length) return
    const counts = nodes.map((n) => (n.matches('.c-param') ? 1 : 0) + n.querySelectorAll('.c-param').length)
    const cut = autoGroupCut(counts)
    if (cut !== null) setAuto({ cut, rest: counts.slice(cut).reduce((a, b) => a + b, 0) })
  })

  useEffect(() => {
    measureLayout()
    const ctl = controlsRef.current
    const res = resultsRef.current
    window.addEventListener('resize', measureLayout)
    let ro: ResizeObserver | undefined
    if (ctl && res && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measureLayout)
      ro.observe(ctl)
      ro.observe(res)
    }
    return () => {
      window.removeEventListener('resize', measureLayout)
      ro?.disconnect()
    }
  }, [wideViewport, collapsible, auto])

  // 手機：按執行後的狀態列（執行中… ／ 完成）；完成後把結果捲進畫面（prefers-reduced-motion 時不平滑）
  const [phoneStatus, setPhoneStatus] = useState<'running' | 'done' | null>(null)
  useEffect(() => {
    if (phoneStatus !== 'done') return
    const t = setTimeout(() => setPhoneStatus(null), DONE_STATUS_MS)
    return () => clearTimeout(t)
  }, [phoneStatus])
  const revealResults = () => {
    const el = resultsRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  // 螢幕閱讀器播報：使用者按下執行／單步後的「執行中」與結束摘要（含主要指標或警告數）、停止、匯出錯誤。
  // 同一段文字要能再唸一次，所以每則訊息換一個 key（live 區內的節點被換掉才算「新增」）。
  const [notice, setNotice] = useState<{ seq: number; text: string }>({ seq: 0, text: '' })
  const announce = (text: string) => setNotice((n) => ({ seq: n.seq + 1, text }))
  const running = actions?.running ?? false
  // 按下執行／單步後等結果：有 running 的實驗等它變回 false；同步算完的實驗（沒給 running）在下一次 render 就播報
  const pendingRun = useRef(false)
  // 手機：只有「執行」與「跳到結尾」結束後才捲到結果區、顯示「完成」；「單步」會連按，捲走的話單步鈕就不見了
  const pendingKind = useRef<ActionKind>('run')
  // 手機：這一次執行已經捲過結果區（動畫型在按下執行時就捲）就不在結束時再捲一次，免得使用者中途捲回去按停止又被拉走
  const revealed = useRef(false)
  const latest = useRef({ metrics, warnings })
  latest.current = { metrics, warnings }
  const onAction = (kind: ActionKind) => {
    if (kind === 'stop') {
      pendingRun.current = false
      revealed.current = false
      announce('模擬已停止')
      if (isPhone) setPhoneStatus(null)
      return
    }
    pendingRun.current = true
    pendingKind.current = kind
    revealed.current = false
    if (kind === 'run') {
      announce('模擬執行中')
      if (isPhone) {
        setPhoneStatus('running')
        // 結果一變就要看得到：動畫型從第一步就在變，按下去就捲到結果區看它走；
        // 計算型（worker／同步）要等算完結果才會變，所以在下面的結束效果裡才捲
        if (actions?.runKind === 'animate') {
          revealResults()
          revealed.current = true
        }
      }
    }
  }
  useEffect(() => {
    if (!pendingRun.current || running) return
    // 結果（metrics / warnings）常在 running 變 false 的下一次 render 才到，延後一個 tick 再讀
    const t = setTimeout(() => {
      pendingRun.current = false
      announce(finishSummary(latest.current.metrics, latest.current.warnings))
      if (isPhone && pendingKind.current !== 'step') {
        setPhoneStatus('done')
        if (!revealed.current) revealResults()
      }
      revealed.current = false
    }, 0)
    return () => clearTimeout(t)
  })
  useEffect(() => {
    if (exportError) announce(exportError)
  }, [exportError])
  const presetId = useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  const exportInput = (): ExperimentExportInput => ({
    id,
    title,
    level,
    claim,
    source,
    tests,
    assumptions,
    params,
    seed,
    units,
    metrics,
    warnings,
    crossCheck,
  })
  const baseName = () => `${safeFileName(id)}-${fileTimestamp()}`

  const safeExportData = (): { data?: CsvColumns; error?: string } => {
    if (!exportData) return {}
    try {
      return { data: exportData() }
    } catch (err) {
      return { error: `資料匯出失敗：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  const onJson = () => {
    setExportError(null)
    const payload = buildExperimentPayload(exportInput())
    downloadText(`${baseName()}.json`, 'application/json', JSON.stringify(payload, null, 2))
  }

  const onCsv = () => {
    setExportError(null)
    const { data, error } = safeExportData()
    if (error || !data) {
      setExportError(error ?? '沒有可匯出的資料')
      return
    }
    downloadText(`${baseName()}.csv`, 'text/csv', toCsv(data), { bom: true })
  }

  const onReport = async () => {
    setExportError(null)
    setBusy(true)
    try {
      const { plots, failed } = await registryRef.current!.captureAll()
      const { data, error } = safeExportData()
      const notes = [...(failed.length > 0 ? [`以下圖表無法擷取（可能尚未載入）：${failed.join('、')}`] : []), ...(error ? [error] : [])]
      const html = buildReportHtml(buildExperimentReportInput(exportInput(), { plots, data, notes }))
      downloadText(`${baseName()}-report.html`, 'text/html', html)
    } catch (err) {
      setExportError(`報告產生失敗：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const summary = {
    experiment_id: id,
    model_level: level,
    seed: seed ?? null,
    params,
    units: units ?? {},
    app_version: APP_VERSION,
    git_commit: GIT_COMMIT,
  }

  const hasToolbar = Boolean(actions || seed !== undefined || (presets && presets.length > 0 && onLoadPreset))
  // 自動切分只在收合模式下生效（數量掉回 ≤ 12 時 layout effect 會把 auto 清掉，這裡先擋一次免得多畫一個 render）
  const split = auto && collapsible ? auto : null

  return (
    <PlotRegistryProvider registry={registryRef.current}>
      <section className="c-exp" id={`exp-${id}`} data-experiment={id} aria-labelledby={`exp-${id}-title`}>
        <header className="c-exp-head">
          <Heading className="c-exp-title" id={`exp-${id}-title`}>
            {mathText(title)}
          </Heading>
          <div className="c-tag-row">
            <ModelLevel level={level} />
            {claim && <ClaimTag kind={claim} />}
            <SourceTag kind={source} />
            {tests?.map((t) => <TestBadge key={t} id={t} />)}
          </div>
          {description && <div className="c-exp-desc">{mathText(description)}</div>}
        </header>
        <div className="c-sr-only" aria-live="polite" data-testid="exp-live">
          {notice.text && <span key={notice.seq}>{notice.text}</span>}
        </div>

        {warnings.length > 0 && (
          <div className="c-exp-warnings">
            {warnings.map((w, i) => (
              <Callout key={`${i}-${w}`} kind="danger" title="警告">
                <p>{mathText(w)}</p>
              </Callout>
            ))}
          </div>
        )}

        {hasToolbar && (
          <div className="c-exp-toolbar">
            {actions && <ActionBar actions={actions} onAction={onAction} />}
            {actions && (running || (actions.runKind === 'animate' && !!actions.progress && actions.progress.done > 0)) && (
              // 執行中一定畫；動畫型停在半路／播完也畫（看得出停在哪）；還沒開始（0/N）不畫空的軌道
              <ProgressBar progress={actions.progress} runKind={actions.runKind ?? 'compute'} />
            )}
            {seed !== undefined && <SeedControl seed={seed} onSeedChange={onSeedChange} />}
            {presets && presets.length > 0 && onLoadPreset && (
              <div className="c-exp-presets">
                <label htmlFor={presetId} className="small muted">
                  Preset
                </label>
                <select
                  id={presetId}
                  value=""
                  onChange={(e) => {
                    const p = presets[Number(e.target.value)]
                    if (p) onLoadPreset(p)
                  }}
                >
                  <option value="">載入 preset…</option>
                  {presets.map((p, i) => (
                    <option key={`${p.name}-${i}`} value={String(i)} title={p.description ? accessibleText(p.description) : undefined}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="c-exp-body">
          <div ref={controlsRef} className="c-exp-controls" aria-label="參數" data-sticky={sticky ? 'true' : undefined} data-collapsed={collapsible ? 'true' : undefined}>
            <ControlGroupContext.Provider value={{ collapsible }}>
              {/* 兩種狀態都是「陣列 + 可有可無的 AutoGroup」：切點前的控制項在同一個位置、同一組 key，跨越 12 個門檻時不會被重新掛載 */}
              {split ? controlChildren.slice(0, split.cut) : controlChildren}
              {split && <AutoGroup count={split.rest}>{controlChildren.slice(split.cut)}</AutoGroup>}
            </ControlGroupContext.Provider>
          </div>
          <div ref={resultsRef} className="c-exp-results">
            {children}
            {metrics && metrics.length > 0 && <MetricTable rows={metrics} />}
          </div>
        </div>
        {isPhone &&
          phoneStatus &&
          // 掛在 body 而不是實驗框裡：.c-exp 有 container-type，仍套 layout containment 的引擎會把 position: fixed
          // 的包含區塊變成實驗框，狀態列就釘在幾千 px 長的實驗框底部而不是螢幕底部
          createPortal(
            <div className="c-exp-status" aria-hidden="true" data-testid="exp-status">
              {phoneStatus === 'running' ? (
                <>
                  <span className="c-spinner" />
                  執行中…{actions?.progress && actions.progress.total > 0 ? ` ${Math.round((100 * actions.progress.done) / actions.progress.total)}%` : ''}
                </>
              ) : (
                '完成'
              )}
            </div>,
            document.body,
          )}

        <CrossCheckRow crossCheck={crossCheck} />

        <div className="c-exp-assumptions">
          <div className="c-exp-subtitle">假設（Assumptions）</div>
          {assumptions.length > 0 ? (
            <ul className="c-assumption-list">
              {assumptions.map((a, i) => (
                <li key={`${i}-${a}`}>{mathText(a)}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">未列出假設。</p>
          )}
        </div>

        <details className="c-exp-summary" onToggle={(e) => setSummaryOpen(e.currentTarget.open)}>
          <summary>模擬條件摘要</summary>
          <dl className="c-exp-summary-list small">
            <dt>seed</dt>
            <dd className="mono">{seed ?? '（無隨機性）'}</dd>
            <dt>模型層級</dt>
            <dd>{level}</dd>
            <dt>版本</dt>
            <dd className="mono">
              v{APP_VERSION} · {GIT_COMMIT}
            </dd>
            {units && Object.keys(units).length > 0 && (
              <>
                <dt>單位</dt>
                <dd>
                  {Object.entries(units)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('；')}
                </dd>
              </>
            )}
          </dl>
          {summaryOpen && <SummaryJson text={prettyJson(summary)} />}
        </details>

        <div className="c-exp-export" role="group" aria-label="匯出">
          <button type="button" className="btn" onClick={onJson}>
            下載 JSON
          </button>
          {exportData && (
            <button type="button" className="btn" onClick={onCsv}>
              下載 CSV
            </button>
          )}
          <button type="button" className="btn" onClick={() => void onReport()} disabled={busy}>
            {busy ? '產生報告中…' : '下載 HTML 報告'}
          </button>
          {exportError && <span className="c-param-warn small">{exportError}</span>}
        </div>
      </section>
    </PlotRegistryProvider>
  )
}

/** 沒有明確 ControlGroup 的實驗超過 12 個控制項時，前面的保持展開、其餘收進這個 <details>（預設收合，使用者展開後維持） */
function AutoGroup({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="c-exp-group is-auto" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>其餘參數（{count} 個）</summary>
      {children}
    </details>
  )
}

/** 不超過這麼多行的摘要 JSON 整段顯示（超過才收進 320px 的可捲動框）：為了兩三行放一條捲軸沒有用途 */
export const SUMMARY_JSON_FULL_LINES = 24

function SummaryJson({ text }: { text: string }) {
  const short = text.split('\n').length <= SUMMARY_JSON_FULL_LINES
  return (
    <ScrollRegion as="pre" label="模擬條件 JSON（可捲動）" className={`c-exp-json${short ? ' is-full' : ''}`}>
      {text}
    </ScrollRegion>
  )
}
