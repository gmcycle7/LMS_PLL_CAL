import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'

/**
 * Plot 註冊表：讓 ExperimentShell 在產生 HTML 報告時收集其內所有 <Plot> 的 PNG 圖片。
 * Plot 掛載時自動向最近的 PlotRegistryProvider 註冊；沒有 Provider 時不做任何事。
 */
export interface PlotImageSource {
  /** 圖表標題（報告圖說） */
  title: () => string
  /** 擷取 PNG data URL；圖表尚未載入時回傳 null */
  capture: () => Promise<string | null>
  /** 圖表 DOM 節點，用於依頁面順序排序 */
  element: () => HTMLElement | null
}

export interface CapturedPlot {
  title: string
  dataUrl: string
}

export interface PlotRegistry {
  register: (src: PlotImageSource) => () => void
  /** 依 DOM 順序擷取所有已註冊圖表；失敗的圖表列在 failed */
  captureAll: () => Promise<{ plots: CapturedPlot[]; failed: string[] }>
  size: () => number
}

export function createPlotRegistry(): PlotRegistry {
  const sources = new Set<PlotImageSource>()
  return {
    register(src) {
      sources.add(src)
      return () => {
        sources.delete(src)
      }
    },
    size: () => sources.size,
    async captureAll() {
      const list = [...sources].sort((a, b) => {
        const ea = a.element()
        const eb = b.element()
        if (!ea || !eb) return 0
        return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      })
      const plots: CapturedPlot[] = []
      const failed: string[] = []
      for (const [i, s] of list.entries()) {
        const title = s.title() || `圖 ${i + 1}`
        try {
          const url = await s.capture()
          if (url) plots.push({ title, dataUrl: url })
          else failed.push(title)
        } catch {
          failed.push(title)
        }
      }
      return { plots, failed }
    },
  }
}

const PlotRegistryContext = createContext<PlotRegistry | null>(null)

/** 提供 Plot 註冊表；可傳入外部建立的 registry（例如 ExperimentShell 需要自己呼叫 captureAll） */
export function PlotRegistryProvider({ registry, children }: { registry?: PlotRegistry; children: ReactNode }) {
  const own = useRef<PlotRegistry | null>(null)
  if (!own.current) own.current = createPlotRegistry()
  const value = useMemo(() => registry ?? own.current!, [registry])
  return <PlotRegistryContext.Provider value={value}>{children}</PlotRegistryContext.Provider>
}

export function usePlotRegistry(): PlotRegistry | null {
  return useContext(PlotRegistryContext)
}
