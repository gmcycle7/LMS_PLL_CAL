import { render, screen } from '@testing-library/react'
import { renderTex, Tex, TexBlock } from './Tex'
import { Section } from './Section'
import { Callout } from './Callout'

describe('Tex / TexBlock', () => {
  it('行內公式輸出 KaTeX HTML（含 MathML）', () => {
    const { container } = render(
      <p>
        更新式 <Tex>{'w_{n+1}=w_n+\\mu e_n x_n'}</Tex>
      </p>,
    )
    expect(container.querySelector('.katex')).toBeTruthy()
    expect(container.querySelector('.katex-display')).toBeNull()
    expect(container.querySelector('math')).toBeTruthy()
  })

  it('TexBlock：display mode、公式 ID 錨點與標籤', () => {
    const { container } = render(
      <TexBlock id="F-1.1" label="LMS 更新式">
        {'\\boxed{w_{n+1}=w_n+\\mu e_nx_n}'}
      </TexBlock>,
    )
    expect(container.querySelector('.katex-display')).toBeTruthy()
    expect(container.querySelector('#formula-F-1\\.1')).toBeTruthy()
    expect(screen.getByText('(F-1.1)')).toBeTruthy()
    expect(screen.getByText('LMS 更新式')).toBeTruthy()
  })

  it('語法錯誤不丟例外（throwOnError: false）', () => {
    expect(() => renderTex('\\frac{1}{', true)).not.toThrow()
    // ParseError → katex-error（紅字顯示原始碼）
    expect(renderTex('\\frac{1}{', true)).toContain('katex-error')
    // 未定義巨集 → 以紅字顯示該巨集名稱
    const html = renderTex('\\undefinedmacro{x}', false)
    expect(html).toContain('#cc0000')
    expect(html).toContain('undefinedmacro')
  })

  it('trust: false 不允許 \\href 注入連結', () => {
    const html = renderTex('\\href{javascript:alert(1)}{x}', false)
    expect(html).not.toContain('href="javascript')
  })
})

describe('Section / Callout', () => {
  it.each([
    ['intuition', '直覺'],
    ['diagram', '圖'],
    ['formula', '公式'],
    ['example', '範例'],
    ['explore', '探索'],
    ['assumptions', '注意假設'],
  ] as const)('Section %s 顯示「%s」', (kind, label) => {
    const { container } = render(
      <Section kind={kind} title="標題">
        內容
      </Section>,
    )
    expect(container.querySelector('.c-section-kicker')?.textContent).toBe(label)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: '標題' })).toBeTruthy()
  })

  it('Callout danger 使用 role=alert 與 callout-danger 樣式', () => {
    render(<Callout kind="danger">λ_min = 0：不可辨識</Callout>)
    const el = screen.getByRole('alert')
    expect(el.className).toContain('callout-danger')
    expect(el.textContent).toContain('警告')
  })
})
