import { render } from '@testing-library/react'
import { GLUE_MAX_GLYPHS, Glue, Rich, gluePunctuation, texGlyphs } from './ui'
import { Tex } from '@/components'

/** KaTeX 以外的文字（拿掉 .katex 子樹） */
function plain(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.katex').forEach((k) => k.remove())
  return copy.textContent ?? ''
}
const texOf = (el: Element) => Array.from(el.querySelectorAll('annotation[encoding="application/x-tex"]'), (a) => a.textContent ?? '')

describe('Rich：行內公式和緊跟的標點綁在同一行（.dash-glue）', () => {
  it('句尾的「公式 + 句號」包在同一個 nowrap 的 span 裡：句號不會單獨掉到下一行（本頁必記第 1 點）', () => {
    const { container } = render(<Rich text="穩定條件 $0<g=\mu K_qC<g^*(d)$ 已經包含極性的 $C>0$。" />)
    const glue = container.querySelectorAll('.dash-glue')
    expect(glue).toHaveLength(1)
    expect(texOf(glue[0])).toEqual(['C>0'])
    expect(plain(glue[0])).toBe('。')
    // 句號只出現一次，而且在 glue 裡面；其餘文字原樣
    expect(plain(container)).toBe('穩定條件  已經包含極性的 。')
    expect(texOf(container)).toEqual([String.raw`0<g=\mu K_qC<g^*(d)`, 'C>0'])
  })

  it('一句裡有好幾個「公式 + 標點」：各自綁住，標點後面的文字留在外面；連續的標點一起綁（「）；」）', () => {
    const { container } = render(<Rich text="$\mu>0$、$K_q>0$ 時，停在 $w^*$）；而 $N$，最後 $g$ 乘上 $N$。" />)
    const glue = Array.from(container.querySelectorAll('.dash-glue'))
    expect(glue.map((g) => [texOf(g)[0], plain(g)])).toEqual([
      [String.raw`\mu>0`, '、'],
      ['w^*', '）；'],
      ['N', '，'],
      ['N', '。'],
    ])
    expect(plain(container)).toBe('、 時，停在 ）；而 ，最後  乘上 。')
  })

  it('不綁的情況：公式後面不是標點（空白、文字、左括號）；太長的公式（綁住之後不能在中間斷行）；沒有公式的純文字', () => {
    const { container: a } = render(<Rich text="其中 $g$ 是 loop gain，$C$（相關）與 $p$ 的關係" />)
    expect(a.querySelectorAll('.dash-glue')).toHaveLength(0)
    const long = String.raw`K_q=0.0079788\,\mathrm{fs^{-1}},\ g=0.079788,\ p=0.92021`
    expect(texGlyphs(long)).toBeGreaterThan(GLUE_MAX_GLYPHS)
    const { container: b } = render(<Rich text={`合計 $${long}$。`} />)
    expect(b.querySelectorAll('.dash-glue')).toHaveLength(0)
    expect(plain(b)).toBe('合計 。')
    const { container: c } = render(<Rich text="只有文字，沒有公式。" />)
    expect(c.innerHTML).toBe('只有文字，沒有公式。')
    // 非 Fragment 的輸入原樣回傳
    expect(gluePunctuation('abc')).toBe('abc')
    expect(gluePunctuation(null)).toBeNull()
  })

  it('字數的估計：指令各算一個字，大括號、上下標、間距不算——TeX 原始碼長但排出來短的公式照樣綁', () => {
    expect(texGlyphs('C>0')).toBe(3)
    expect(texGlyphs(String.raw`G_k=\sum_n q\,x`)).toBe(7) // G k = Σ n q x
    expect(texGlyphs(String.raw`\tfrac1N\sum_n q[n]\,x[n-D]`)).toBe(15) // ¹⁄N（3）Σ n q[n]（4）x[n−D]（6）
    // 符號表「更新律」那一列：原始碼 48 個字元，排出來只有十幾個字
    const update = String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\,\mathbf G_k`
    expect(update.length).toBeGreaterThan(40)
    expect(texGlyphs(update)).toBe(15)
    const { container } = render(<Rich text={`更新律 $${update}$；一般 LMS`} />)
    expect(container.querySelectorAll('.dash-glue')).toHaveLength(1)
    expect(plain(container.querySelector('.dash-glue') as Element)).toBe('；')
  })

  it('Glue：直接寫在 JSX 裡的「公式 + 標點」用同一個 class', () => {
    const { container } = render(
      <p>
        所以{' '}
        <Glue>
          <Tex>{String.raw`w_n\to a`}</Tex>。
        </Glue>
        接下來
      </p>,
    )
    const glue = container.querySelector('.dash-glue') as HTMLElement
    expect(texOf(glue)).toEqual([String.raw`w_n\to a`])
    expect(plain(glue)).toBe('。')
    expect(plain(container)).toBe('所以 。接下來')
  })
})
