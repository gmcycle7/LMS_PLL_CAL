/**
 * 第 3 章「本章的符號在硬體裡是什麼」（§8，圖 3-21）的架構約定（docs/assumptions.md §2a）：
 * DTC 在 reference 輸入端、回授路徑只有 divider／PMUX、LMS 的輸入是 PD 的輸出。
 * 圖本身的節點與連線由 diagrams.test.tsx 檢查；這裡檢查旁邊的文字（「怎麼看圖」、圖說、替代文字）。
 *
 * 獨立成一個檔案：ch03.test.tsx 的每個測試都要渲染整章，十個測試已經接近 Node 預設 4 GB 的堆積上限，
 * 再多渲染一次整章就會在多個測試程序同時跑時 out of memory；分開的檔案有自己的程序與堆積。
 */
import { cleanup } from '@testing-library/react'
import Chapter03 from './index'
import { renderPage } from '@/test/renderPage'

vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

/** 把元素內的 KaTeX 還原成 `$原始 TeX$`（取 MathML 的 annotation），其餘文字保留。 */
function srcText(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.katex').forEach((k) => k.replaceWith(`$${k.querySelector('annotation')?.textContent ?? ''}$`))
  return clone.textContent ?? ''
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Ch03 §8 的架構約定（docs/assumptions.md §2a）', () => {
  it('「本章的符號在硬體裡是什麼」：DTC 在 reference 輸入端、PD 量 reference′ 減 feedback、補償量 w·x、LMS 的輸入是 PD 的輸出', () => {
    localStorage.setItem('lmspll.mode', 'beginner')
    const { container } = renderPage(<Chapter03 />, { url: '/ch/03' })
    const fig = container.querySelector('.ch03-fig[data-fig="21"]')
    expect(fig, '圖 3-21（畫回 PLL 硬體）').not.toBeNull()
    const section = fig!.closest('section.c-section') as HTMLElement
    expect(section.querySelector('h3')?.textContent).toContain('本章的符號在硬體裡是什麼')
    const text = srcText(section)
    // 接法：reference clock → DTC → PD，回授路徑只有 divider／PMUX；LMS 的輸入是 PD 的輸出
    expect(text).toContain('DTC 在 reference 的輸入端')
    expect(text).toContain('reference clock → DTC → PD')
    expect(text).toContain('回授路徑上只有 divider／PMUX')
    expect(text).toContain('LMS 校正迴路的輸入是 PD 的輸出')
    expect(text).toContain('comparator 取的是 PD 的輸出')
    expect(text).toContain('也就是送進 loop filter 的同一個訊號')
    // 主迴路是閉合的：PD → loop filter／VCO → divider → PD，回授路徑上沒有 DTC
    expect(text).toContain('VCO 的輸出再經 divider 回到 PD')
    expect(text).toContain('回授路徑上只有 divider，沒有 DTC')
    // 褐色那一格：error path 不是接在 PD 輸出後面的另一個方塊，而是閉迴路讓 PD 輸出本身變成濾過的 u = h*x
    expect(text).toContain('PD 輸出裡的不是 $\\delta\\,x$，而是 $\\delta\\,u$')
    expect(text).toContain('$u=h*x$ 是被 PLL 的 error path 濾過的 code')
    expect(text).toContain('Part B 中 PD 輸出看到的是被主迴路濾過的 $u=h*x$')
    expect(text).not.toContain('還要經過 PLL 的 error')
    expect(text).not.toContain('真正進 PD')
    // 時間與正負號：feedback edge 早到 a·x；reference 端的 DTC 只能延遲，從 T₀ 往回扣；補償量 w·x；PD 量 reference′ 減 feedback
    expect(text).toContain('feedback edge 比理想時刻早到 $a\\,x[i]$')
    expect(text).toContain('reference 端的 DTC')
    expect(text).toContain('DTC 只能延遲、不能提前')
    expect(text).toContain(String.raw`$\tau_{\text{DTC}}=T_0-w[k]\,x[i]$`)
    expect(text).toContain(String.raw`$C_0-w[k]\,x[i]$`)
    expect(text).toContain('DTC 的補償量')
    expect(text).toContain(String.raw`$e[i]=t'_{\text{ref}}[i]-t_{\text{fb}}[i]$`)
    expect(text).toContain(String.raw`$e[i]=(a-w[k])\,x[i]+v[i]=\delta[k]\,x[i]+v[i]$`)
    expect(text).toContain('靜態相位偏移')
    // 舊的說法已經拿掉：DTC 不是「補掉的量」那種被動的減數，也不在回授路徑上
    expect(text).not.toContain('DTC 實際補掉的量')
    expect(text).not.toMatch(/回授路徑上的 DTC|divider 之後的 DTC|DTC 插入/)
    // 圖的替代文字也用同一套接法
    const aria = fig!.querySelector('figure.c-mermaid')!.getAttribute('aria-label') ?? ''
    expect(aria).toContain('reference 端的 DTC')
    expect(aria).toContain('feedback edge')
    expect(aria).toContain('同時送進 loop filter，也是 LMS 的輸入')
    expect(aria).toContain('比基準延遲 T 0 少延遲 w 乘 x')
    expect(aria).toContain('量 reference edge 減 feedback edge 的時間差')
    expect(aria).toContain('loop filter 與 VCO 的輸出再經 divider 回到 phase detector')
  }, 60000 * 6)
})
