import { act, render } from '@testing-library/react'
import { TableWrap } from './TableWrap'

/** jsdom 不做版面：把 scroll 容器的尺寸與捲動位置定成想要的值 */
function fakeScroller(el: HTMLElement, v: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  for (const [k, val] of Object.entries({ scrollLeft: 0, ...v })) Object.defineProperty(el, k, { configurable: true, writable: true, value: val })
}

const sizes: (() => void)[] = []
beforeEach(() => {
  sizes.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        sizes.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const fade = (c: HTMLElement) => c.querySelector<HTMLElement>('.fr-fade')!
const scroller = (c: HTMLElement) => c.querySelector<HTMLElement>('.c-scroll')!

describe('TableWrap：寬表格的「還有內容」提示（漸層）與可聚焦的捲動區', () => {
  it('結構：.fr-fade > ScrollRegion（.c-scroll.table-wrap），className 傳給表格外框；放得下時沒有漸層、沒有 tabindex', () => {
    const { container } = render(
      <TableWrap className="fr-sym-wrap" label="符號表（可左右捲動）">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>,
    )
    const host = fade(container)
    expect(scroller(container).parentElement).toBe(host)
    expect(scroller(container).className).toBe('c-scroll table-wrap fr-sym-wrap')
    expect(scroller(container).getAttribute('tabindex')).toBeNull()
    expect(host.dataset.fadeStart).toBe('0')
    expect(host.dataset.fadeEnd).toBe('0')
    expect(host.dataset.fit).toBe('1')
    expect(host.dataset.tiny).toBe('0')
  })

  it('sticky：外框多一個 fr-sticky-wrap（放得下時 CSS 把它改成 overflow: visible，表頭才黏得住）；溢位時 data-fit 變 0', () => {
    const { container } = render(
      <TableWrap sticky>
        <table />
      </TableWrap>,
    )
    expect(scroller(container).className).toBe('c-scroll table-wrap fr-sticky-wrap')
    expect(fade(container).dataset.fit).toBe('1')
    fakeScroller(scroller(container), { scrollWidth: 1100, clientWidth: 900 })
    act(() => sizes.forEach((cb) => cb()))
    expect(fade(container).dataset.fit).toBe('0')
    fakeScroller(scroller(container), { scrollWidth: 900, clientWidth: 900 })
    act(() => sizes.forEach((cb) => cb()))
    expect(fade(container).dataset.fit).toBe('1')
  })

  it('只超出 1–6px（padding、四捨五入）標記 data-tiny（CSS 隱藏沒有用途的捲軸）；超過 6px 不標', () => {
    const { container } = render(
      <TableWrap>
        <table />
      </TableWrap>,
    )
    const host = fade(container)
    for (const [over, tiny] of [[1, '1'], [2, '1'], [6, '1'], [7, '0'], [0, '0'], [300, '0']] as const) {
      fakeScroller(scroller(container), { scrollWidth: 900 + over, clientWidth: 900 })
      act(() => sizes.forEach((cb) => cb()))
      expect(host.dataset.tiny, `溢位 ${over}px`).toBe(tiny)
      expect(host.dataset.fadeEnd, `溢位 ${over}px：只有真的有內容被切掉才畫漸層`).toBe(over > 6 ? '1' : '0')
    }
  })

  it('溢位：右側先出現漸層；捲到中間兩側都有；捲到盡頭只剩左側；只超出 2px 以內不算', () => {
    const { container } = render(
      <TableWrap>
        <table />
      </TableWrap>,
    )
    const host = fade(container)
    const sc = scroller(container)
    // 內容比框寬 400px（ResizeObserver 回報大小改變）
    fakeScroller(sc, { scrollWidth: 1300, clientWidth: 900 })
    act(() => sizes.forEach((cb) => cb()))
    expect(host.dataset.fadeStart).toBe('0')
    expect(host.dataset.fadeEnd).toBe('1')
    expect(sc.getAttribute('tabindex')).toBe('0') // ScrollRegion：可用鍵盤聚焦
    expect(sc.getAttribute('aria-label')).toBe('表格（可左右捲動）')

    sc.scrollLeft = 200
    act(() => {
      sc.dispatchEvent(new Event('scroll'))
    })
    expect(host.dataset.fadeStart).toBe('1')
    expect(host.dataset.fadeEnd).toBe('1')

    sc.scrollLeft = 400 // scrollWidth − clientWidth：已經到盡頭
    act(() => {
      sc.dispatchEvent(new Event('scroll'))
    })
    expect(host.dataset.fadeStart).toBe('1')
    expect(host.dataset.fadeEnd).toBe('0')

    // 四捨五入造成的 1–2px：不算溢位，兩側都沒有漸層
    sc.scrollLeft = 0
    fakeScroller(sc, { scrollWidth: 902, clientWidth: 900, scrollLeft: 0 })
    act(() => sizes.forEach((cb) => cb()))
    expect(host.dataset.fadeStart).toBe('0')
    expect(host.dataset.fadeEnd).toBe('0')
  })

  it('內容換了（重新 render）會重量：搜尋過濾後表格變窄，漸層消失', () => {
    const { container, rerender } = render(
      <TableWrap>
        <table>
          <tbody>
            <tr>
              <td>寬</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>,
    )
    const host = fade(container)
    fakeScroller(scroller(container), { scrollWidth: 1200, clientWidth: 900 })
    rerender(
      <TableWrap>
        <table>
          <tbody>
            <tr>
              <td>寬</td>
              <td>更寬</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>,
    )
    expect(host.dataset.fadeEnd).toBe('1')
    fakeScroller(scroller(container), { scrollWidth: 800, clientWidth: 900 })
    rerender(
      <TableWrap>
        <table>
          <tbody>
            <tr>
              <td>窄</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>,
    )
    expect(host.dataset.fadeEnd).toBe('0')
  })
})

describe('TableWrap：caption', () => {
  it('給 caption：在單一 <table> 的最前面插入視覺隱藏的 <caption>，原有內容不變', () => {
    const { container } = render(
      <TableWrap caption="符號表">
        <table>
          <thead>
            <tr>
              <th scope="col">符號</th>
            </tr>
          </thead>
        </table>
      </TableWrap>,
    )
    const table = container.querySelector('table')!
    expect(table.firstElementChild?.tagName).toBe('CAPTION')
    expect(table.firstElementChild?.textContent).toBe('符號表')
    expect(table.firstElementChild?.className).toBe('c-sr-only')
    expect(table.querySelector('thead th')).toBeTruthy()
  })
  it('表格已有自己的 <caption>：不再插第二個', () => {
    const { container } = render(
      <TableWrap caption="自動標題">
        <table>
          <caption>作者標題</caption>
          <tbody />
        </table>
      </TableWrap>,
    )
    const caps = container.querySelectorAll('caption')
    expect(caps).toHaveLength(1)
    expect(caps[0].textContent).toBe('作者標題')
  })
  it('沒給 caption 或 children 不是 <table>：原樣輸出', () => {
    const { container } = render(
      <>
        <TableWrap>
          <table>
            <tbody />
          </table>
        </TableWrap>
        <TableWrap caption="不會用到">
          <div>其他</div>
        </TableWrap>
      </>,
    )
    expect(container.querySelector('caption')).toBeNull()
  })
})
