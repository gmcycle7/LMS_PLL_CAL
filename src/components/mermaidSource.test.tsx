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

describe('Mermaid 標籤裡的 LaTeX', () => {
  it('含公式的標籤合併成單一的 `$$...$$`：文字包成 \\text、多行用 gathered；沒有公式的標籤不動', async () => {
    const { mermaidMathDelimiters } = await import('./mermaidSource')
    expect(mermaidMathDelimiters(String.raw`A["誤差 $e[n]$"] --> B["$$w_k$$"] --> C["純文字 100%"]`)).toBe(
      String.raw`A["$$\text{誤差 }e[n]$$"] --> B["$$w_k$$"] --> C["純文字 100%"]`,
    )
    expect(mermaidMathDelimiters(String.raw`S["$\div N$、$\times\,\mu$"]`)).toBe(String.raw`S["$$\div N\text{、}\times\,\mu$$"]`)
    expect(mermaidMathDelimiters(String.raw`G["GMAC<br/>$\sum q\,x$"]`)).toBe(String.raw`G["$$\begin{gathered}\text{GMAC}\cr \sum q\,x\end{gathered}$$"]`)
    expect(mermaidMathDelimiters(String.raw`T["50% 的 $a_1$ & b_2"]`)).toBe(String.raw`T["$$\text{50\% 的 }a_1\text{ \& b\_2}$$"]`)
  })

  it('節點與連線標籤的公式用 KaTeX 排版（真的 render）；TeX 寫錯會讓 render 失敗', async () => {
    const ok = await renderMermaidForTest(String.raw`flowchart LR
  A["誤差 $e[n] = y[n] - \hat y[n]$"] -- "$\mu$" --> B["$w_{k+1} = w_k + \mu G_k$"]`)
    expect(ok.mathCount).toBe(3)
    const multi = await renderMermaidForTest(String.raw`flowchart LR
  S["先 $\div N$、再 $\times\,\mu$<br/>得到 $\Delta w$"] --> T["50% & $a_1$"]`)
    expect(multi.mathCount).toBe(2)
    expect(multi.text).toContain('先')
    expect(multi.text).not.toContain('$')
    expect(ok.text).toContain('誤差')
    expect(ok.text).not.toContain('$')
    expect(hasUnsupportedMarkdown(ok.text)).toBe(false)
    await expect(renderMermaidForTest(String.raw`flowchart LR
  A["$\frac{1}{$"] --> B`)).rejects.toThrow()
  })

  it('系統地圖的公式標籤都排版成功', async () => {
    const { systemMapChart } = await import('./SystemMap')
    const r = await renderMermaidForTest(systemMapChart(['cmp', 'gmac']))
    expect(r.mathCount).toBeGreaterThanOrEqual(8)
    expect(r.text).not.toContain('$')
  })
})

describe('withReadableMinWidth', () => {
  it('依自然寬度加上 min-width：寬圖 70%、窄圖不超過自然寬度、至少 480', async () => {
    const { withReadableMinWidth } = await import('./mermaidSource')
    const svg = (w: number) => `<svg id="x" width="100%" style="max-width: ${w}px;" viewBox="0 0 ${w} 300"><g/></svg>`
    expect(withReadableMinWidth(svg(1258.2))).toContain('style="max-width: 1258.2px; min-width: 881px;"')
    expect(withReadableMinWidth(svg(600))).toContain('min-width: 480px;')
    expect(withReadableMinWidth(svg(320))).toContain('min-width: 320px;')
    expect(withReadableMinWidth('<svg viewBox="0 0 900 100"><g/></svg>')).toContain('<svg style="min-width: 630px;" viewBox')
    expect(withReadableMinWidth('<div>not svg</div>')).toBe('<div>not svg</div>')
  })
})

describe('unicodeMathIn', () => {
  it('找出 KaTeX 以外的 Unicode 數學；一般文字與箭頭不算', async () => {
    const { unicodeMathIn } = await import('./mermaidTestUtils')
    expect(unicodeMathIn('Loop filter → VCO / DCO，有限位元')).toEqual([])
    expect(unicodeMathIn('w_k 加上 μ·e，σ² ≤ 1')).toEqual(expect.arrayContaining(['w_k', 'μ', '·', 'σ', '²', '≤']))
    const r = await renderMermaidForTest(String.raw`flowchart LR
  A["誤差 $e[n]$"] --> B["步長 μ"]`)
    expect(unicodeMathIn(r.plainText)).toEqual(['μ'])
  })
})
