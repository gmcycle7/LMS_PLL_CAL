/**
 * jsdom 測試用的假 Mermaid（`mermaid`）。
 *
 * 真正的 mermaid.render 在 jsdom 每張圖要 1–3 秒；多數測試只需要「圖有被送進 Mermaid、原始碼是什麼」。
 * 在測試檔最上面寫一行：
 *
 *   vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())
 *
 * 要檢查送進 Mermaid 的原始碼時：
 *
 *   import { mermaidMock, renderedCharts } from '@/test/mocks/mermaid'
 *   expect(renderedCharts()).toContain(…)
 *
 * 需要「真的畫出來」（量 SVG 裡的字、節點）的測試不要用這個，改用各章 `mermaidTestUtils` 的 `renderMermaidForTest`
 * （它在乾淨的 DOM 上用真的 mermaid）。
 */
import { vi } from 'vitest'

export const mermaidMock = {
  initialize: vi.fn(),
  render: vi.fn(async (id: string, _chart: string) => ({ svg: `<svg id="${id}"></svg>`, diagramType: 'flowchart-v2' })),
  parse: vi.fn(async () => true),
}

/** `vi.mock('mermaid', …)` 的 factory 回傳值：ES module 形狀（只有 default）。 */
export function mermaidModule() {
  return { default: mermaidMock }
}

/** 到目前為止送進 `mermaid.render` 的圖原始碼（依呼叫順序）。 */
export function renderedCharts(): string[] {
  return mermaidMock.render.mock.calls.map((c) => c[1])
}

/** 清掉呼叫紀錄（保留實作）。setup.jsdom.ts 每個測試後呼叫。 */
export function resetMermaidMock(): void {
  mermaidMock.initialize.mockClear()
  mermaidMock.render.mockClear()
  mermaidMock.parse.mockClear()
}
