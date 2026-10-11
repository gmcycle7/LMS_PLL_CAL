import mermaid from 'mermaid'
import { hasUnsupportedMarkdown, sanitizeMermaidSource } from './mermaidSource'
import { installMermaidSvgShim, renderMermaidForTest } from './mermaidTestUtils'

beforeAll(installMermaidSvgShim)

const RAW = `flowchart LR
  X["x[n]"] -- "+" --> S((+))
  Y["ŷ[n]"] -->|"-"| S
  S --> E["e[n] = y − ŷ"]
  E --> L["- μ·e·x 寫成清單會壞"]`

describe('sanitizeMermaidSource', () => {
  it('把單獨的 + / - 與清單開頭的標籤換成不觸發 Markdown 的字元', () => {
    const out = sanitizeMermaidSource(RAW)
    expect(out).toContain('-- "＋" -->')
    expect(out).toContain('S(("＋"))')
    expect(out).toContain('|"−"|')
    expect(out).toContain('"− μ·e·x')
    expect(out).toContain('"e[n] = y − ŷ"') // 其他標籤不動
  })

  it('不前處理時 Mermaid 11 會畫出「Unsupported markdown」；前處理後正常', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
    const raw = await mermaid.render('raw-plus', RAW)
    expect(hasUnsupportedMarkdown(raw.svg)).toBe(true)
    const fixed = await renderMermaidForTest(RAW)
    expect(hasUnsupportedMarkdown(fixed.text)).toBe(false)
    expect(fixed.text).toContain('＋')
    expect(fixed.nodeCount).toBe(5)
  })
})
