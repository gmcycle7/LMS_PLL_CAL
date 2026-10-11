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
export async function renderMermaidForTest(chart: string): Promise<{ svg: string; text: string; nodeCount: number; mathCount: number; plainText: string }> {
  // 與網站相同：forceLegacyMathML 讓標籤裡的 `$...$`／`$$...$$` 以 KaTeX 排版；TeX 語法錯誤會讓 render 直接丟出例外
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, forceLegacyMathML: true })
  const { svg } = await mermaid.render(`mt-${++counter}`, sanitizeMermaidSource(chart))
  const host = document.createElement('div')
  host.innerHTML = svg
  host.querySelector('style')?.remove()
  const mathCount = host.querySelectorAll('.katex').length
  // 圖上的文字：拿掉 KaTeX 的 MathML 複本，避免每個公式的文字出現兩次
  host.querySelectorAll('.katex-mathml').forEach((e) => e.remove())
  const text = host.textContent ?? ''
  const nodeCount = host.querySelectorAll('g.node').length
  // KaTeX 以外的文字：用來檢查有沒有還沒改成 `$...$` 的 Unicode 數學
  host.querySelectorAll('.katex').forEach((e) => e.remove())
  return { svg, text, nodeCount, mathCount, plainText: host.textContent ?? '' }
}

/**
 * 圖上「KaTeX 以外」的文字若還有 Unicode 拼的數學（希臘字母、上下標數字、w_k 這類底線下標、運算符號），回傳找到的片段。
 * 用法：expect(unicodeMathIn((await renderMermaidForTest(chart)).plainText)).toEqual([])
 * 純文字的箭頭「→」與中文標點不算；單位與英文單字不算。
 */
export function unicodeMathIn(plainText: string): string[] {
  const hits = plainText.match(/[\u0370-\u03ff\u2070-\u209f\u00b2\u00b3\u00b9∑∏√∞≤≥≠≈±∓·×÷∂∇∈∝⌊⌋⌈⌉ℒ𝒩]|\b[A-Za-z]{1,3}_[A-Za-z0-9{]|\^[-0-9{]|z⁻¹/g)
  return hits ? [...new Set(hits)] : []
}
