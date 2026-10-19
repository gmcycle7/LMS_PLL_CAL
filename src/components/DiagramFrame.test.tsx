import { fireEvent, render, screen } from '@testing-library/react'
import { DiagramFrame, DiagramTextBody } from './DiagramFrame'
import { parseDiagramText, type DiagramText } from './diagramText'
import { svgNaturalSize, withSvgIdSuffix } from './mermaidSource'

const SVG = '<svg id="c-mermaid-7" viewBox="0 0 800 300" style="max-width: 800px;"><style>#c-mermaid-7 .node{fill:red}</style><marker id="c-mermaid-7_arrow"></marker><g class="node"></g></svg>'

describe('DiagramFrame：方塊圖共用外框', () => {
  it('圖畫好後才有 .c-mermaid-svg 與「放大」鈕；還沒畫好只顯示 placeholder', () => {
    const pending = render(<DiagramFrame ready={false} placeholder={<span>載入中</span>} caption="圖 A" />)
    expect(pending.container.querySelector('.c-mermaid-svg')).toBeNull()
    expect(pending.container.querySelector('.c-mermaid-pending')?.textContent).toBe('載入中')
    expect(screen.queryByRole('button', { name: '放大檢視這張圖' })).toBeNull()
    pending.unmount()

    const { container } = render(<DiagramFrame html={SVG} caption="圖 B：$x[n]$" />)
    expect(container.querySelector('figure.c-mermaid > .c-mermaid-frame > .c-mermaid-svg > svg')).toBeTruthy()
    expect(container.querySelector('figure')?.getAttribute('aria-label')).toBe('圖 B：x[n]')
    expect(container.querySelector('figcaption .katex')).toBeTruthy()
    expect(screen.getByRole('button', { name: '放大檢視這張圖' })).toBeTruthy()
  })

  it('放大檢視：開在 <body> 下的對話框，用第二份 SVG（id 不同），可縮放，關閉後焦點回到按鈕', () => {
    const zoomSvg = withSvgIdSuffix(SVG, '-zoom')
    render(<DiagramFrame html={SVG} zoomHtml={zoomSvg} naturalSize={svgNaturalSize(SVG)} caption="圖 C" />)
    const open = screen.getByRole('button', { name: '放大檢視這張圖' })
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('放大檢視：圖 C')
    expect(dialog.querySelector('svg')?.id).toBe('c-mermaid-7-zoom')
    expect(document.querySelectorAll('#c-mermaid-7')).toHaveLength(1)
    expect(document.body.style.overflow).toBe('hidden')

    // 100% → 放大一級 → 再按百分比回到 100%
    const inner = dialog.querySelector<HTMLElement>('.c-zoom-inner')!
    expect(inner.style.getPropertyValue('--c-zoom-width')).toBe('800px')
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(inner.style.getPropertyValue('--c-zoom-width')).toBe('1000px')
    fireEvent.keyDown(dialog, { key: '-' })
    fireEvent.keyDown(dialog, { key: '-' })
    expect(inner.style.getPropertyValue('--c-zoom-width')).toBe('640px')
    fireEvent.click(screen.getByRole('button', { name: /回到 100%/ }))
    expect(inner.style.getPropertyValue('--c-zoom-width')).toBe('800px')

    fireEvent.click(screen.getByRole('button', { name: '關閉' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(open)
  })

  it('Esc 也能關閉；縮放有上下限', () => {
    render(<DiagramFrame html={SVG} naturalSize={{ width: 800, height: 300 }} />)
    fireEvent.click(screen.getByRole('button', { name: '放大檢視這張圖' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('放大檢視：方塊圖')
    for (let i = 0; i < 12; i++) fireEvent.keyDown(dialog, { key: '+' })
    expect(dialog.querySelector<HTMLElement>('.c-zoom-inner')!.style.getPropertyValue('--c-zoom-width')).toBe('3200px')
    expect((screen.getByRole('button', { name: '放大' }) as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 20; i++) fireEvent.keyDown(dialog, { key: '-' })
    expect(dialog.querySelector<HTMLElement>('.c-zoom-inner')!.style.getPropertyValue('--c-zoom-width')).toBe('320px')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('mermaidSource：SVG 尺寸與 id', () => {
  it('svgNaturalSize 讀 viewBox；讀不到回傳 null', () => {
    expect(svgNaturalSize(SVG)).toEqual({ width: 800, height: 300 })
    expect(svgNaturalSize('<svg viewBox="-8 -8 1252.5 257.25"></svg>')).toEqual({ width: 1252.5, height: 257.25 })
    expect(svgNaturalSize('<svg></svg>')).toBeNull()
    expect(svgNaturalSize('not svg')).toBeNull()
  })

  it('withSvgIdSuffix 把根 id 與所有引用一起換掉', () => {
    const out = withSvgIdSuffix(SVG, '-zoom')
    expect(out).toContain('id="c-mermaid-7-zoom"')
    expect(out).toContain('#c-mermaid-7-zoom .node')
    expect(out).toContain('id="c-mermaid-7-zoom_arrow"')
    expect(out.split('c-mermaid-7').length).toBe(out.split('c-mermaid-7-zoom').length)
    expect(withSvgIdSuffix('<svg><g/></svg>', '-zoom')).toBe('<svg><g/></svg>')
  })
})

const CHART = String.raw`flowchart LR
  subgraph FE["前端"]
    S["固定誤差 $s$"] -- "$+ s$" --> ADD(("＋"))
    VN(["雜訊 $v$"]) -- "$+ v$" --> ADD
  end
  ADD -.-> CMP{"Comparator"}
  CMP -->|"$q = \pm 1$"| ACC["累加器"]`

const open = (details: HTMLDetailsElement) => {
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('DiagramFrame：文字版（節點與連線清單）', () => {
  it('沒有 chart／textModel、或圖還沒畫好：沒有文字版，figure 也沒有 aria-describedby', () => {
    const a = render(<DiagramFrame html={SVG} caption="圖" />)
    expect(a.container.querySelector('details')).toBeNull()
    expect(a.container.querySelector('figure')?.hasAttribute('aria-describedby')).toBe(false)
    a.unmount()
    const b = render(<DiagramFrame ready={false} chart={CHART} placeholder={<span>載入中</span>} />)
    expect(b.container.querySelector('details')).toBeNull()
  })

  it('預設收合：figure 的 aria-describedby 指到 details，收合時只多 <details><summary> 兩個元素；位置在圖說之後', () => {
    const { container } = render(<DiagramFrame html={SVG} chart={CHART} caption="圖 $s$" />)
    const figure = container.querySelector('figure')!
    const details = container.querySelector('details.c-figalt') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(figure.getAttribute('aria-describedby')).toBe(details.id)
    expect(details.id).toMatch(/^figalt-[A-Za-z0-9_-]+$/)
    expect(details.querySelectorAll('*')).toHaveLength(1)
    expect(details.querySelector('summary')?.textContent).toBe('文字版（節點與連線清單）')
    expect(figure.lastElementChild).toBe(details)
    expect(figure.querySelector('figcaption')!.nextElementSibling).toBe(details)
  })

  it('惰性：展開前不解析 chart；textModel 函式展開才呼叫；收起再展開用同一份內容', () => {
    const model = vi.fn((): DiagramText => parseDiagramText(CHART))
    const { container } = render(<DiagramFrame html={SVG} textModel={model} />)
    expect(model).not.toHaveBeenCalled()
    const details = container.querySelector('details') as HTMLDetailsElement
    open(details)
    expect(model).toHaveBeenCalledTimes(1)
    expect(details.querySelector('.c-figalt-body')).toBeTruthy()
    details.open = false
    fireEvent(details, new Event('toggle'))
    expect(details.querySelector('.c-figalt-body')).toBeNull()
  })

  it('展開後：群組、每個節點一行、連線「A → B（標籤）」（虛線加註），數學用 KaTeX 排版', () => {
    const { container } = render(<DiagramFrame html={SVG} chart={CHART} />)
    open(container.querySelector('details') as HTMLDetailsElement)
    const body = container.querySelector('.c-figalt-body')!
    expect(body.textContent).toContain('排列方向：由左到右')
    expect([...body.querySelectorAll('.c-figalt-h')].map((h) => h.textContent)).toEqual(['群組（1）', '節點（5）', '連線（4）'])
    const [groups, nodes, edges] = [...body.querySelectorAll(':scope > ul')]
    expect(groups.textContent).toContain('前端')
    expect(groups.querySelectorAll('li')).toHaveLength(1)
    expect(nodes.querySelectorAll(':scope > li')).toHaveLength(5)
    expect(nodes.textContent).toContain('加法點（＋）')
    expect(nodes.textContent).toContain('〔前端〕')
    const rows = [...edges.querySelectorAll(':scope > li')]
    expect(rows).toHaveLength(4)
    // 摘掉 KaTeX 的 MathML 複本後，第 3 條是 ADD → CMP，虛線
    const text = (li: Element) => {
      const c = li.cloneNode(true) as Element
      c.querySelectorAll('.katex-mathml, annotation').forEach((e) => e.remove())
      return c.textContent ?? ''
    }
    expect(text(rows[2])).toMatch(/→/)
    expect(text(rows[2])).toContain('虛線')
    expect(text(rows[3])).toContain('Comparator')
    expect(body.querySelectorAll('.katex').length).toBeGreaterThan(3)
    // 輸出文字（無障礙名稱）不留 TeX 原始碼
    for (const el of body.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(/[$\\]/)
  })

  it('DiagramTextBody：解析不到結構（parsed: false）要標明；沒有節點時說沒有偵測到；時序圖列出註記', () => {
    const other = render(<DiagramTextBody model={parseDiagramText('pie\n  "甲" : 1\n  "乙" : 2')} />)
    expect(other.container.textContent).toContain('沒有完整解析，只列出偵測到的節點名稱')
    expect(other.container.querySelectorAll('li')).toHaveLength(2)
    expect(other.container.querySelector('.c-figalt-h')?.textContent).toBe('節點（2）')
    other.unmount()
    const none = render(<DiagramTextBody model={parseDiagramText('gantt')} />)
    expect(none.container.textContent).toContain('沒有偵測到可以列出的節點')
    none.unmount()
    const seq = render(<DiagramTextBody model={parseDiagramText('sequenceDiagram\n  participant A as 甲\n  participant B as 乙\n  Note over A,B: 開始\n  A->>B: 你好')} />)
    expect([...seq.container.querySelectorAll('.c-figalt-h')].map((h) => h.textContent)).toEqual(['節點（2）', '訊息（1）', '註記（1）'])
    expect(seq.container.textContent).toContain('在第 0 則訊息之後')
  })
})
