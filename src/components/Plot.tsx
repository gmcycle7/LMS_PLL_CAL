import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Config, Data, Icon, Layout, ModeBarButtonAny, PlotlyHTMLElement } from 'plotly.js-dist-min'
import { downloadText, toCsv } from './download'
import { safeFileName } from './format'
import { usePlotRegistry } from './plotRegistry'
import { buildExportLayout, buildThemedLayout, filterLogData, tracesToColumns } from './plotUtils'
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

export interface PlotProps {
  /** Plotly traces（可用 Float64Array 等 typed array） */
  data: Data[]
  layout?: Partial<Layout>
  /** 額外 Plotly config（覆寫預設值；不建議改 modeBarButtons） */
  config?: Partial<Config>
  /** 繪圖區高度（px，預設 320）；載入前的佔位也使用此高度以避免版面跳動 */
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

/**
 * Plotly 圖表封裝：lazy-load、跟隨主題、ResizeObserver 自適應、hover / zoom / pan / reset、
 * 下載 PNG / SVG / CSV；位於 ExperimentShell 內時會自動註冊給 HTML 報告擷取 PNG。
 */
export function Plot({
  data,
  layout,
  config,
  height = 320,
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

  const fileBase = safeFileName(csvName ?? title ?? 'plot')

  // 匯出時需要最新的資料 / 標題 / token；以 ref 保存，避免 modebar 按鈕閉包過期
  const latest = useRef({ data, title, fileBase, tokens, height })
  latest.current = { data, title, fileBase, tokens, height }

  const filtered = useMemo(() => filterLogData(data, xLog, yLog), [data, xLog, yLog])
  const themedLayout = useMemo(
    () => buildThemedLayout(tokens, { height, xLog, yLog, layout }),
    [tokens, height, xLog, yLog, layout],
  )

  // 載入 Plotly
  useEffect(() => {
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
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

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
      layout: buildExportLayout(gdEl.layout, t, ttl),
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

    const buttons: ModeBarButtonAny[][] = [
      ['zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
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
    void P.react(gd, filtered.data, themedLayout, fullConfig)
  }, [status, filtered, themedLayout, config])

  // 容器大小改變 → Plots.resize（以 rAF 節流）
  useEffect(() => {
    const gd = gdRef.current
    if (status !== 'ready' || !gd || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (plotlyRef.current && gd.isConnected) plotlyRef.current.Plots.resize(gd)
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
        const P = plotlyRef.current
        const gd = gdRef.current as PlotlyHTMLElement | null
        if (!P || !gd || !gd.data) return null
        const cur = latest.current
        return P.toImage(
          { data: gd.data, layout: buildExportLayout(gd.layout, cur.tokens, cur.title) },
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
