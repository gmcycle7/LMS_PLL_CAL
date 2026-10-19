import { AUTO_CAPTION_ATTR, enhanceTables, spokenText, watchA11y } from './a11yEnhance'

function host(html: string): HTMLElement {
  const el = document.createElement('main')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}
afterEach(() => {
  document.body.innerHTML = ''
})

const TABLE = '<table><thead><tr><th>名稱</th><th>值</th></tr></thead><tbody><tr><th>a</th><td>1</td></tr><tr><td>b</td><td>2</td></tr></tbody></table>'

describe('enhanceTables', () => {
  it('沒有 caption 的表格：依最近的上一個標題補視覺隱藏的 caption', () => {
    const el = host(`<h1>頁面</h1><h2>1-bit 比較器</h2>${TABLE}`)
    expect(enhanceTables(el)).toBeGreaterThan(0)
    const cap = el.querySelector('table > caption')!
    expect(cap.textContent).toBe('表格：1-bit 比較器')
    expect(cap.className).toBe('c-sr-only')
    expect(cap.hasAttribute(AUTO_CAPTION_ATTR)).toBe(true)
    expect(el.querySelector('table')!.firstElementChild).toBe(cap)
  })

  it('同一個標題底下有好幾張：加「（第 n 張）」；作者自己寫的 caption 不動、也不佔序號', () => {
    const el = host(`<h2>節</h2>${TABLE}<table><caption>我自己的標題</caption><tbody><tr><td>x</td></tr></tbody></table>${TABLE}`)
    enhanceTables(el)
    const caps = [...el.querySelectorAll('caption')].map((c) => c.textContent)
    expect(caps).toEqual(['表格：節（第 1 張）', '我自己的標題', '表格：節（第 2 張）'])
  })

  it('表格在 figure 裡：用 figcaption；公式標題用可念形式；沒有標題時給通用名稱', () => {
    const el = host(`<figure>${TABLE}<figcaption>步驟表</figcaption></figure>`)
    enhanceTables(el)
    expect(el.querySelector('caption')?.textContent).toBe('表格：步驟表')
    el.innerHTML = `<h3>步長 <span class="katex"><span class="katex-mathml"><math><semantics><mrow/><annotation encoding="application/x-tex">\\mu_0</annotation></semantics></math></span><span class="katex-html">μ0</span></span> 的選擇</h3>${TABLE}`
    enhanceTables(el)
    expect(el.querySelector('caption')?.textContent).toBe('表格：步長 mu 0 的選擇')
    el.innerHTML = TABLE
    enhanceTables(el)
    expect(el.querySelector('caption')?.textContent).toBe('資料表格')
  })

  it('th 補 scope：thead 內 col；tbody 內同列還有 td 的第一格 row；其他 col', () => {
    const el = host(TABLE + '<table><tbody><tr><th>x</th><th>y</th></tr></tbody></table>')
    enhanceTables(el)
    const [t1, t2] = [...el.querySelectorAll('table')]
    expect([...t1.querySelectorAll('th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'row'])
    expect([...t2.querySelectorAll('th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col'])
  })

  it('已經有 scope 的 th、role=presentation 的表格不動；重複執行不再有變動（idempotent）', () => {
    const el = host(`<h2>節</h2><table><tbody><tr><th scope="row">r</th><td>1</td></tr></tbody></table><table role="presentation"><tbody><tr><th>t</th></tr></tbody></table>`)
    enhanceTables(el)
    const [t1, t2] = [...el.querySelectorAll('table')]
    expect(t1.querySelector('th')!.getAttribute('scope')).toBe('row')
    expect(t2.querySelector('caption')).toBeNull()
    expect(t2.querySelector('th')!.hasAttribute('scope')).toBe(false)
    expect(enhanceTables(el)).toBe(0)
  })

  it('標題或表格數量改變後，自動 caption 會重新計算', () => {
    const el = host(`<h2>節</h2>${TABLE}`)
    enhanceTables(el)
    expect(el.querySelector('caption')?.textContent).toBe('表格：節')
    el.insertAdjacentHTML('beforeend', TABLE)
    enhanceTables(el)
    expect([...el.querySelectorAll('caption')].map((c) => c.textContent)).toEqual(['表格：節（第 1 張）', '表格：節（第 2 張）'])
  })
})

describe('spokenText', () => {
  it('略過 tooltip 與按鈕、收斂空白、過長截斷', () => {
    const h = document.createElement('h2')
    h.innerHTML = '標題 <span class="c-tip">不要念</span> <button>x</button>   尾巴'
    expect(spokenText(h)).toBe('標題 尾巴')
    h.textContent = 'a'.repeat(200)
    expect(spokenText(h).length).toBeLessThanOrEqual(60)
  })
})

describe('watchA11y', () => {
  it('之後才出現的表格（頁面延後載入）也會被補強；停止後不再處理', async () => {
    vi.useFakeTimers()
    try {
      const el = host('<h2>節</h2>')
      const stop = watchA11y(el, 10)
      el.insertAdjacentHTML('beforeend', TABLE)
      await vi.advanceTimersByTimeAsync(50)
      expect(el.querySelector('caption')?.textContent).toBe('表格：節')
      stop()
      el.insertAdjacentHTML('beforeend', TABLE)
      await vi.advanceTimersByTimeAsync(50)
      expect(el.querySelectorAll('table')[1].querySelector('caption')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
