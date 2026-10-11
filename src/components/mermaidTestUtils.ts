/**
 * 測試工具（只給 *.test.tsx 用，不從 '@/components' 匯出，避免把 mermaid 打進主 bundle）：
 * 在 jsdom 裡用真正的 Mermaid 把圖「畫出來」，抓 parser 抓不到的問題（例如「Unsupported markdown: list」）。
 *
 *   import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
 *   beforeAll(installMermaidSvgShim)
 *   const { text } = await renderMermaidForTest(CHART_X)
 *   expect(text).not.toMatch(/Unsupported markdown/)
 */
import mermaid from 'mermaid'
import { sanitizeMermaidSource } from './mermaidSource'

/** jsdom 沒有 SVG 排版：給 Mermaid 一個「字數 × 固定寬度」的 getBBox，讓 layout 與標籤處理能跑完。 */
export function installMermaidSvgShim(): void {
  const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype
  proto.getBBox = function (this: Element) {
    return { x: 0, y: 0, width: Math.max(10, (this.textContent ?? '').length * 7), height: 18 }
  }
  proto.getComputedTextLength = function (this: Element) {
    return (this.textContent ?? '').length * 7
  }
}

let counter = 0

/** 以與網站相同的前處理（sanitizeMermaidSource）真的 render 一次；回傳 SVG 與圖上的文字。 */
export async function renderMermaidForTest(chart: string): Promise<{ svg: string; text: string; nodeCount: number }> {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
  const { svg } = await mermaid.render(`mt-${++counter}`, sanitizeMermaidSource(chart))
  const host = document.createElement('div')
  host.innerHTML = svg
  host.querySelector('style')?.remove()
  return { svg, text: host.textContent ?? '', nodeCount: host.querySelectorAll('g.node').length }
}
