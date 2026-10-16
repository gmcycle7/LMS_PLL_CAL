import { act, render } from '@testing-library/react'
import { ScrollRegion } from './ScrollRegion'

/** jsdom 不做版面計算：直接把 scrollWidth / clientWidth 定成想要的值 */
function fakeSize(el: HTMLElement, size: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number }) {
  for (const [k, v] of Object.entries({ scrollHeight: 0, clientHeight: 0, ...size })) Object.defineProperty(el, k, { configurable: true, get: () => v })
}

describe('ScrollRegion：可捲動區域只在溢位時可聚焦', () => {
  it('放得下：沒有 tabIndex / role；溢位：tabIndex=0、role=group、aria-label', () => {
    const { container, rerender } = render(
      <ScrollRegion as="pre" label="程式碼（可捲動）" className="c-code-pre">
        <code>a</code>
      </ScrollRegion>,
    )
    const pre = container.querySelector('pre')!
    expect(pre.className).toBe('c-scroll c-code-pre')
    expect(pre.getAttribute('tabindex')).toBeNull()
    expect(pre.getAttribute('role')).toBeNull()

    // 內容變寬（例如字型載入後）→ 重新 render 時重量
    fakeSize(pre, { scrollWidth: 900, clientWidth: 600 })
    rerender(
      <ScrollRegion as="pre" label="程式碼（可捲動）" className="c-code-pre">
        <code>a 很長的一行</code>
      </ScrollRegion>,
    )
    expect(pre.getAttribute('tabindex')).toBe('0')
    expect(pre.getAttribute('role')).toBe('group')
    expect(pre.getAttribute('aria-label')).toBe('程式碼（可捲動）')

    // 只超出一兩個像素不算（四捨五入）
    fakeSize(pre, { scrollWidth: 602, clientWidth: 600 })
    rerender(
      <ScrollRegion as="pre" label="程式碼（可捲動）" className="c-code-pre">
        <code>b</code>
      </ScrollRegion>,
    )
    expect(pre.getAttribute('tabindex')).toBeNull()
  })

  it('直向溢位（限高的 JSON）也算；ResizeObserver 回報時重量', () => {
    const callbacks: (() => void)[] = []
    const RO = vi.fn(function (this: unknown, cb: () => void) {
      callbacks.push(cb)
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() }
    })
    vi.stubGlobal('ResizeObserver', RO)
    try {
      const { container } = render(
        <ScrollRegion label="JSON（可捲動）" className="c-exp-json">
          <span>x</span>
        </ScrollRegion>,
      )
      const div = container.querySelector('div.c-scroll') as HTMLElement
      expect(div.getAttribute('tabindex')).toBeNull()
      fakeSize(div, { scrollWidth: 100, clientWidth: 100, scrollHeight: 800, clientHeight: 320 })
      act(() => callbacks.forEach((cb) => cb()))
      expect(div.getAttribute('tabindex')).toBe('0')
      expect(div.getAttribute('aria-label')).toBe('JSON（可捲動）')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
