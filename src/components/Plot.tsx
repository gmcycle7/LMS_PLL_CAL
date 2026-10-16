import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Config, Data, Icon, Layout, ModeBarButtonAny, PlotlyHTMLElement } from 'plotly.js-dist-min'
import { downloadText, toCsv } from './download'
import { applyPlotMath, plotMath } from './plotMath'
import { safeFileName } from './format'
import { usePlotRegistry } from './plotRegistry'
import {
  applyDashCycle,
  buildExportLayout,
  buildThemedLayout,
  filterLogData,
  legendPlacement,
  logAxisDtick,
  logSpanDecades,
  pickLegendCorner,
  tracesToColumns,
} from './plotUtils'
import { useThemeTokens, type ThemeTokens } from './theme'
import { mathText } from './Tex'

type PlotlyApi = typeof import('plotly.js-dist-min')

let plotlyPromise: Promise<PlotlyApi> | null = null
/** 延遲載入 Plotly（約 3.5 MB），所有 Plot 共用同一個 promise */
export function loadPlotly(): Promise<PlotlyApi> {
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min')
      .then((m) => ((m as { default?: PlotlyApi }).default ?? (m as unknown as PlotlyApi)))
      .catch((err: unknown) => {
        plotlyPromise = null
        throw err
      })
  }
  return plotlyPromise
}

/** 圖離可視範圍多遠就開始載入／繪製（px）；捲動到圖之前通常已畫好 */
export const PLOT_NEAR_MARGIN = 700
/** 沒有 requestIdleCallback 的瀏覽器（Safari）改用這個延遲預取 */
const PREFETCH_FALLBACK_MS = 1500
/** 報告擷圖等待圖畫完的上限（Plotly 下載很慢或失敗時不要卡住整份報告） */
const CAPTURE_WAIT_MS = 15_000

let prefetchScheduled = false
/**
 * 頁面上有 Plot、但首屏還沒捲到任何一張時，在主執行緒閒置時先把 Plotly 抓下來：
 * 之後捲到第一張圖就不必再等 1 MB 多的下載。只排程一次；下載失敗時 loadPlotly 會清掉 promise，
 * 捲到圖時再重試。
 */
function schedulePlotlyPrefetch() {
  if (prefetchScheduled || plotlyPromise) return
  prefetchScheduled = true
  const run = () => void loadPlotly().catch(() => undefined)
  const g = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, PREFETCH_FALLBACK_MS)
}

/** 測試用：回到「Plotly 還沒載入、還沒預取」的狀態，讓同一個 jsdom 內的多個測試都能觀察到預取 */
export function resetPlotlyPrefetchForTests() {
  prefetchScheduled = false
  plotlyPromise = null
}

export interface PlotProps {
  /** Plotly traces（可用 Float64Array 等 typed array） */
  data: Data[]
  layout?: Partial<Layout>
  /** 額外 Plotly config（覆寫預設值；不建議改 modeBarButtons） */
  config?: Partial<Config>
  /** 繪圖區高度（px，預設 360）；載入前的佔位也使用此高度以避免版面跳動 */
  height?: number
  /** 圖表標題（顯示在圖上方；匯出 PNG/SVG 與報告時也會放進圖內） */
  title?: string
  /** 下載檔名（不含副檔名），預設由 title 推得 */
  csvName?: string
  /** log 軸：≤0 的點會被略去並在圖下方註明數量 */
  xLog?: boolean
  yLog?: boolean
  /** 圖下方說明（例如 PSD 的 window / ENBW / one-sided 標示） */
  caption?: ReactNode
  /** 圖的文字替代說明 */
  ariaLabel?: string
  className?: string
}

/** CSV 圖示（24×24，填色矩形組成；Plotly modebar 以 fill 著色） */
const CSV_ICON: Icon = {
  width: 24,
  height: 24,
  path: 'M2 3h20v2H2z M2 19h20v2H2z M2 3h2v18H2z M20 3h2v18h-2z M2 9.25h20v1.5H2z M2 14.25h20v1.5H2z M9.25 3h1.5v18h-1.5z',
}

type Status = 'loading' | 'ready' | 'error'

/** Plotly 畫完後掛在元素上的內部欄位（沒有型別定義的部分） */
type FullLayoutAxis = { type?: string; range?: unknown; tickmode?: string; dtick?: unknown }
type DrawnElement = PlotlyHTMLElement & {
  _fullLayout?: { _size?: { t?: number }; xaxis?: FullLayoutAxis; yaxis?: FullLayoutAxis }
}

/** 呼叫端自己設了刻度（dtick / tickvals / tickmode / nticks）的軸，Plot 不再管它的 log 刻度 */
function userSetsTicks(axis: unknown): boolean {
  if (!axis || typeof axis !== 'object') return false
  const a = axis as Record<string, unknown>
  return a.dtick !== undefined || a.tickvals !== undefined || a.tickmode !== undefined || a.nticks !== undefined
}

/**
 * 工具列（.modebar-container）的位置：圖例在上方時把它移到繪圖區頂端（_size.t = 上邊界含圖例高度），
 * hover 時只暫時蓋到資料區右上角，不會蓋住圖例（圖例可以點擊切換曲線）；
 * 圖例在內側時留在紙面右上角的上邊界裡（30px 放得下 27px 的工具列）。CSS：--c-plot-top。
 */
function syncModebarTop(gd: DrawnElement, legendAbove: boolean) {
  const top = legendAbove ? gd._fullLayout?._size?.t : 0
  if (typeof top === 'number') gd.style.setProperty('--c-plot-top', `${Math.round(top)}px`)
}

/** 正在由 syncLogTicks 呼叫 Plotly.relayout 的元素：它觸發的 plotly_relayout 不再處理（一次互動最多一次 relayout） */
const syncingTicks = new WeakSet<HTMLElement>()

/**
 * log 軸刻度跟著目前的軸範圍走：放大到不到 1.7 個十進位時改標 2、5（或線性刻度），縮回去再只標 10 的整數次方。
 * 交回 Plotly 自動時要連 tickmode 一起清掉：relayout 給了 dtick 後 Plotly 會把 tickmode:'linear' 寫進 gd.layout，
 * 只刪 dtick 的話 tickmode 仍是 linear，_fullLayout 的 dtick 永遠不等於「自動」而一直重排。
 */
function syncLogTicks(gd: DrawnElement, P: PlotlyApi, manageLog: { x: boolean; y: boolean }) {
  const fl = gd._fullLayout
  if (!fl || syncingTicks.has(gd)) return
  const update: Record<string, unknown> = {}
  for (const axis of ['x', 'y'] as const) {
    if (!manageLog[axis]) continue
    const ax = fl[`${axis}axis`]
    const range = ax?.range
    if (!ax || ax.type !== 'log' || !Array.isArray(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') continue
    const want = logAxisDtick(Math.abs(range[1] - range[0]))
    const have = ax.tickmode === 'auto' ? undefined : ax.dtick
    if (want === have) continue
    update[`${axis}axis.dtick`] = want ?? null
    if (want === undefined) update[`${axis}axis.tickmode`] = null
  }
  if (Object.keys(update).length === 0) return
  syncingTicks.add(gd)
  void Promise.resolve(P.relayout(gd, update)).finally(() => syncingTicks.delete(gd))
}

/** 會出現在圖例裡的 trace 數（決定圖例放圖內還是圖上方） */
function countLegendEntries(data: readonly Data[]): number {
  return data.filter((t) => {
    const o = t as { showlegend?: boolean; visible?: boolean | 'legendonly' }
    return o.showlegend !== false && o.visible !== false
  }).length
}

/**
 * Plotly 圖表封裝：接近可視範圍才 lazy-load 與繪製（固定高度的佔位，版面不跳動）、跟隨主題、
 * ResizeObserver 自適應、hover / zoom / pan / reset、下載 PNG / SVG / CSV；
 * 位於 ExperimentShell 內時會自動註冊給 HTML 報告擷取 PNG（擷取時會強制把還沒捲到的圖畫出來）。
 * 沒有 IntersectionObserver 的環境（jsdom、舊瀏覽器）直接載入與繪製。
 */
export function Plot({
  data,
  layout,
  config,
  height = 360,
  title,
  csvName,
  xLog = false,
  yLog = false,
  caption,
  ariaLabel,
  className,
}: PlotProps) {
  const tokens = useThemeTokens()
  const registry = usePlotRegistry()
  const gdRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLElement>(null)
  const plotlyRef = useRef<PlotlyApi | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  // 繪圖區寬度（決定內側圖例放不放得下）；0 = 還不知道
  const [plotWidth, setPlotWidth] = useState(0)

  const fileBase = safeFileName(csvName ?? title ?? 'plot')

  // 呼叫端沒自己設刻度的 log 軸：縮放時由 Plot 依目前範圍換刻度（只標 10 的整數次方／也標 2、5）
  const manageLog = { x: xLog && !userSetsTicks(layout?.xaxis), y: yLog && !userSetsTicks(layout?.yaxis) }

  const eventsBound = useRef(false)
  // 第一次畫完（或載入失敗）時 resolve：報告擷圖靠它等待還沒畫的圖
  const settled = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  if (!settled.current) {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    settled.current = { promise, resolve }
  }

  const filtered = useMemo(() => filterLogData(data, xLog, yLog), [data, xLog, yLog])
  const styled = useMemo(() => applyDashCycle(filtered.data), [filtered.data])
  const legendEntries = useMemo(() => countLegendEntries(data), [data])
  // 圖例放哪個角落才不蓋到資料（右上 → 左上 → 都有資料就放上方）
  const legendCorner = useMemo(
    () => pickLegendCorner(filtered.data, { xLog, yLog, layout, plotWidth }),
    [filtered.data, xLog, yLog, layout, plotWidth],
  )
  const xLogDecades = useMemo(() => (xLog ? logSpanDecades(filtered.data, 'x', layout?.xaxis?.range) : undefined), [filtered.data, xLog, layout])
  const yLogDecades = useMemo(() => (yLog ? logSpanDecades(filtered.data, 'y', layout?.yaxis?.range) : undefined), [filtered.data, yLog, layout])
  const themedLayout = useMemo(
    () => buildThemedLayout(tokens, { height, xLog, yLog, layout, legendEntries, legendCorner, xLogDecades, yLogDecades }),
    [tokens, height, xLog, yLog, layout, legendEntries, legendCorner, xLogDecades, yLogDecades],
  )
  const legendAbove = legendPlacement({ layout, legendEntries, legendCorner }) === 'above'

  // 匯出時需要最新的資料 / 標題 / token；以 ref 保存，避免 modebar 按鈕閉包過期
  const latest = useRef({ data, title, fileBase, tokens, height, manageLog, legendAbove })
  latest.current = { data, title, fileBase, tokens, height, manageLog, legendAbove }

  // 掛載時量一次寬度（佔位已有版面），之後由 ResizeObserver 更新
  useLayoutEffect(() => {
    const w = gdRef.current?.clientWidth ?? 0
    if (w > 0) setPlotWidth(w)
  }, [])
  // 圖內文字（軸標題、圖例、註記、hover）裡的 `$...$` LaTeX → 斜體符號與上下標（見 plotMath.ts）
  const typeset = useMemo(() => applyPlotMath(styled, themedLayout), [styled, themedLayout])

  // 接近可視範圍才載入／繪製；列印時全部畫出來
  useEffect(() => {
    if (near || !wrapRef.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: `${PLOT_NEAR_MARGIN}px 0px` },
    )
    io.observe(wrapRef.current)
    const onPrint = () => setNear(true)
    window.addEventListener('beforeprint', onPrint)
    // 首屏畫完後、主執行緒閒置時預取 Plotly（只在真的延後載入的環境才需要）
    schedulePlotlyPrefetch()
    return () => {
      io.disconnect()
      window.removeEventListener('beforeprint', onPrint)
    }
  }, [near])

  // 載入 Plotly
  useEffect(() => {
    if (!near) return
    let cancelled = false
    loadPlotly().then(
      (P) => {
        if (cancelled) return
        plotlyRef.current = P
        setStatus('ready')
      },
      (err: unknown) => {
        if (cancelled) return
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setStatus('error')
        settled.current?.resolve()
      },
    )
    return () => {
      cancelled = true
    }
  }, [near])

  // 卸載時釋放 Plotly 資源
  useEffect(() => {
    const gd = gdRef.current
    return () => {
      if (gd && plotlyRef.current) plotlyRef.current.purge(gd)
    }
  }, [])

  // 繪圖 / 更新
  useEffect(() => {
    const P = plotlyRef.current
    const gd = gdRef.current
    if (status !== 'ready' || !P || !gd) return

    const exportFigure = (gdEl: PlotlyHTMLElement, t: ThemeTokens, ttl?: string) => ({
      data: gdEl.data,
      layout: buildExportLayout(gdEl.layout, t, ttl ? plotMath(ttl) : ttl),
    })
    const size = (gdEl: HTMLElement) => ({
      width: Math.max(320, Math.round(gdEl.clientWidth || 640)),
      height: latest.current.height,
    })
    const download = (format: 'png' | 'svg') => (gdEl: PlotlyHTMLElement) => {
      const cur = latest.current
      void P.downloadImage(exportFigure(gdEl, cur.tokens, cur.title), {
        format,
        filename: cur.fileBase,
        ...size(gdEl),
        scale: format === 'png' ? 2 : 1,
      })
    }

    // 工具列浮在圖內右上角（CSS 控制 hover 顯示）：只留放大／平移／重設與三個下載鈕
    const buttons: ModeBarButtonAny[][] = [
      ['zoom2d', 'pan2d', 'resetScale2d'],
      [
        { name: 'download-png', title: '下載 PNG', icon: P.Icons['camera-retro'], click: download('png') },
        { name: 'download-svg', title: '下載 SVG', icon: P.Icons.disk, click: download('svg') },
        {
          name: 'download-csv',
          title: '下載 CSV',
          icon: CSV_ICON,
          click: () => {
            const cur = latest.current
            downloadText(`${cur.fileBase}.csv`, 'text/csv', toCsv(tracesToColumns(cur.data)), { bom: true })
          },
        },
      ],
    ]
    const fullConfig: Partial<Config> = {
      displaylogo: false,
      displayModeBar: true,
      responsive: false,
      scrollZoom: false,
      ...config,
      modeBarButtons: buttons,
    }
    const done = settled.current
    const drawn = gd as unknown as DrawnElement
    void Promise.resolve(P.react(gd, typeset.data, typeset.layout, fullConfig)).then(
      () => {
        // 第一次畫完才有事件介面：縮放時換 log 軸刻度；每次重畫（react / relayout / resize / 點圖例）後重算工具列位置
        if (!eventsBound.current && typeof drawn.on === 'function') {
          eventsBound.current = true
          drawn.on('plotly_relayout', () => syncLogTicks(drawn, P, latest.current.manageLog))
          drawn.on('plotly_afterplot', () => syncModebarTop(drawn, latest.current.legendAbove))
        }
        syncModebarTop(drawn, latest.current.legendAbove)
        done?.resolve()
      },
      () => done?.resolve(),
    )
  }, [status, typeset, config])

  // 容器大小改變 → Plots.resize（以 rAF 節流）
  useEffect(() => {
    const gd = gdRef.current
    if (status !== 'ready' || !gd || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (plotlyRef.current && gd.isConnected) plotlyRef.current.Plots.resize(gd)
        if (gd.clientWidth > 0) setPlotWidth(gd.clientWidth)
      })
    })
    ro.observe(gd)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [status])

  // 向 ExperimentShell 註冊（報告擷取 PNG）
  useEffect(() => {
    if (!registry) return
    return registry.register({
      title: () => latest.current.title ?? latest.current.fileBase,
      element: () => wrapRef.current,
      capture: async () => {
        // 還沒捲到的圖：強制載入並等第一次畫完（有上限），報告才不會缺圖
        setNear(true)
        await Promise.race([settled.current?.promise, new Promise<void>((r) => setTimeout(r, CAPTURE_WAIT_MS))])
        const P = plotlyRef.current
        const gd = gdRef.current as PlotlyHTMLElement | null
        if (!P || !gd || !gd.data) return null
        const cur = latest.current
        return P.toImage(
          { data: gd.data, layout: buildExportLayout(gd.layout, cur.tokens, cur.title ? plotMath(cur.title) : cur.title) },
          { format: 'png', width: Math.max(320, Math.round(gd.clientWidth || 640)), height: cur.height, scale: 1 },
        )
      },
    })
  }, [registry])

  return (
    <figure className={`c-plot${className ? ` ${className}` : ''}`} ref={wrapRef} aria-label={ariaLabel ?? title}>
      {title && <div className="c-plot-title">{mathText(title)}</div>}
      <div className="c-plot-frame" style={{ height }}>
        <div ref={gdRef} className="c-plot-gd" style={{ height }} />
        {status === 'loading' && (
          <div className="c-plot-placeholder" aria-busy="true">
            圖表載入中…
          </div>
        )}
        {status === 'error' && (
          <div className="c-plot-placeholder c-plot-error" role="alert">
            圖表模組載入失敗：{errorMsg}
          </div>
        )}
      </div>
      {filtered.dropped > 0 && (
        <div className="c-plot-note small" role="note">
          已略去 {filtered.dropped} 個 ≤0 的點（log 軸）
        </div>
      )}
      {caption && <figcaption className="c-figcaption">{mathText(caption)}</figcaption>}
    </figure>
  )
}
