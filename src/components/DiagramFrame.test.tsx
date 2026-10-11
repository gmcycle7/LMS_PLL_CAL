import { fireEvent, render, screen } from '@testing-library/react'
import { DiagramFrame } from './DiagramFrame'
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
