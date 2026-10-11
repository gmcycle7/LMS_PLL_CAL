import { render, screen, waitFor } from '@testing-library/react'
import { SettingsProvider } from '@/app/settings'
import { Mermaid } from './Mermaid'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, text: string) => {
    if (text.includes('INVALID')) throw new Error('Parse error on line 1: INVALID')
    return { svg: `<svg id="${id}" data-text="${text.length}"><g></g></svg>`, diagramType: 'flowchart-v2' }
  }),
}))

vi.mock('mermaid', () => ({ default: mermaidMock }))

afterEach(() => {
  localStorage.clear()
  mermaidMock.initialize.mockClear()
  mermaidMock.render.mockClear()
})

describe('Mermaid', () => {
  it('以 strict securityLevel 渲染，並帶唯一 id 與 caption', async () => {
    const { container } = render(
      <>
        <Mermaid chart={'flowchart LR\n  DSM --> DTC'} caption="訊號流" />
        <Mermaid chart={'flowchart LR\n  PD --> GMAC'} />
      </>,
    )
    await waitFor(() => expect(container.querySelectorAll('.c-mermaid-svg svg')).toHaveLength(2))
    const ids = mermaidMock.render.mock.calls.map((c) => c[0])
    expect(new Set(ids).size).toBe(2)
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }))
    expect(screen.getByText('訊號流')).toBeTruthy()
  })

  it('深色主題使用 mermaid 的 dark theme', async () => {
    localStorage.setItem('lmspll.theme', 'dark')
    const { container } = render(
      <SettingsProvider>
        <Mermaid chart="flowchart LR; A-->B" />
      </SettingsProvider>,
    )
    await waitFor(() => expect(container.querySelector('.c-mermaid-svg svg')).toBeTruthy())
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
  })

  it('語法錯誤時以 callout 顯示錯誤訊息', async () => {
    render(<Mermaid chart="INVALID diagram" />)
    await waitFor(() => expect(screen.getByText('Mermaid 圖解析失敗')).toBeTruthy())
    expect(screen.getByText(/Parse error on line 1/)).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('Mermaid：延後渲染（IntersectionObserver）', () => {
  it('圖不在可視範圍時先不畫；進入範圍或列印前才畫', async () => {
    const { act, render } = await import('@testing-library/react')
    const { Mermaid } = await import('./Mermaid')
    let trigger: (() => void) | null = null
    class FakeIO {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = () => cb([{ isIntersecting: true }])
      }
      observe() {}
      disconnect() {}
    }
    const g = globalThis as unknown as { IntersectionObserver?: unknown }
    const original = g.IntersectionObserver
    g.IntersectionObserver = FakeIO
    try {
      const a = render(<Mermaid chart={'flowchart LR\n  A --> B'} caption="lazy A" />)
      expect(a.container.querySelector('.c-mermaid-loading')).toBeTruthy()
      expect(a.container.querySelector('.c-mermaid-svg')).toBeNull()
      await act(async () => {
        trigger?.()
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(a.container.querySelector('.c-mermaid-loading')).toBeNull()
      a.unmount()

      const b = render(<Mermaid chart={'flowchart LR\n  C --> D'} caption="lazy B" />)
      expect(b.container.querySelector('.c-mermaid-loading')).toBeTruthy()
      await act(async () => {
        window.dispatchEvent(new Event('beforeprint'))
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(b.container.querySelector('.c-mermaid-loading')).toBeNull()
      b.unmount()
    } finally {
      g.IntersectionObserver = original
    }
  })
})
