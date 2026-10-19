/**
 * jsdom 測試用的假 Plotly（`plotly.js-cartesian-dist-min`）。
 *
 * jsdom 沒有 SVG 排版與 WebGL，真正的 Plotly 載不起來也不需要；<Plot> 只用到 react／purge／toImage／downloadImage／Plots.resize／Icons。
 * 在測試檔最上面寫一行（`vi.mock` 會被提升到 import 之前，所以用動態 import）：
 *
 *   vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
 *
 * 要檢查 Plotly 被呼叫的引數時，從這裡 import 同一個物件：
 *
 *   import { plotlyMock } from '@/test/mocks/plotly'
 *   expect(plotlyMock.react.mock.calls.length).toBeGreaterThan(0)
 *
 * 記憶體：`react` 的 mock.calls 會抓住每次傳進來的 DOM 節點與整組資料，整頁的 detached DOM 因此無法回收。
 * `src/test/setup.jsdom.ts` 在每個測試之後呼叫 `resetPlotlyMock()`，所以不需要（也不要）在各檔自己寫 `afterEach(() => P.react.mockClear())`。
 * 在同一個 `describe` 裡用 `beforeAll` 共用一次渲染、又要比對 `plotlyMock.react` 的呼叫時，把需要的引數在 `beforeAll` 裡先複製出來。
 */
import { vi } from 'vitest'

/** 每個 icon 只要有 width／height／path，<Plot> 的工具列按鈕就能建立。 */
const ICON = { width: 1, height: 1, path: 'M0 0' }

export const plotlyMock = {
  react: vi.fn(async (..._args: unknown[]) => undefined),
  newPlot: vi.fn(async (..._args: unknown[]) => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { ...ICON }, disk: { ...ICON } },
}

/** `vi.mock('plotly.js-cartesian-dist-min', …)` 的 factory 回傳值：ES module 形狀（只有 default）。 */
export function plotlyModule() {
  return { default: plotlyMock }
}

/** 清掉所有呼叫紀錄（保留實作）。setup.jsdom.ts 每個測試後呼叫。 */
export function resetPlotlyMock(): void {
  plotlyMock.react.mockClear()
  plotlyMock.newPlot.mockClear()
  plotlyMock.purge.mockClear()
  plotlyMock.toImage.mockClear()
  plotlyMock.downloadImage.mockClear()
  plotlyMock.Plots.resize.mockClear()
}
