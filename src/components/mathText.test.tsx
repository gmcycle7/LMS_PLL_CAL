import { render } from '@testing-library/react'
import { Callout, MathText, mathText, stripMathDelimiters } from '@/components'

describe('mathText：字串屬性內的 $...$ 行內公式', () => {
  it('非字串與不含 $ 的字串原樣回傳', () => {
    expect(mathText('純文字')).toBe('純文字')
    const node = <b>x</b>
    expect(mathText(node)).toBe(node)
  })
  it('把 $...$ 轉成 KaTeX，其餘文字保留', () => {
    const { container } = render(<MathText>{'C ≤ 0：$p = 1 - \\mu K_q C$，極性錯誤'}</MathText>)
    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(container.textContent).toContain('C ≤ 0：')
    expect(container.textContent).toContain('，極性錯誤')
  })
  it('未配對的 $ 與跳脫的 \\$ 不會被當成公式', () => {
    const { container } = render(<MathText>{'價格 \\$5 與單一 $ 符號'}</MathText>)
    expect(container.querySelectorAll('.katex')).toHaveLength(0)
    expect(container.textContent).toBe('價格 $5 與單一 $ 符號')
  })
  it('多段公式', () => {
    const { container } = render(<MathText>{'$a$ 與 $b_k$'}</MathText>)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
  })
  it('Callout 標題支援 $...$', () => {
    const { container } = render(<Callout title={'穩定條件 $0<g<2$'}>內容</Callout>)
    expect(container.querySelector('.c-callout-title .katex')).toBeTruthy()
  })
  it('stripMathDelimiters 拿掉分隔符', () => {
    expect(stripMathDelimiters('σ：$\\sigma_w$ fs')).toBe('σ：\\sigma_w fs')
  })
})
