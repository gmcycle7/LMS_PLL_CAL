import { render, screen } from '@testing-library/react'
import { accessibleText, nodeHasMath, nodeToAccessibleText, renderTex, Tex, TexBlock, MathText, texToSpeech } from './Tex'
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

describe('無障礙名稱的可念形式（speech.ts 經由 Tex.tsx 匯出）', () => {
  it('Tex.tsx 重新匯出 texToSpeech／accessibleText', () => {
    expect(texToSpeech('\\sigma_v')).toBe('sigma v')
    expect(accessibleText('$\\mu_k$ 與 $x$')).toBe('mu k 與 x')
  })

  it('nodeToAccessibleText：字串、<Tex>、<MathText>、元素與陣列都轉成純文字', () => {
    expect(nodeToAccessibleText('學習率 $\\mu$')).toBe('學習率 mu')
    expect(nodeToAccessibleText(<Tex>{'J_{11}'}</Tex>)).toBe('J 11')
    expect(nodeToAccessibleText(<MathText>{'$\\sigma_v$（雜訊）'}</MathText>)).toBe('sigma v（雜訊）')
    expect(
      nodeToAccessibleText(
        <>
          頻寬誤差 <Tex>{'\\hat\\omega_n=1.5\\,\\omega_n'}</Tex>
        </>,
      ),
    ).toBe('頻寬誤差 omega hat n 等於 1.5 omega n')
    expect(nodeToAccessibleText(['Case', <Tex key="a">{'\\alpha'}</Tex>, ' 的值'])).toBe('Case alpha 的值')
    expect(nodeToAccessibleText(42)).toBe('42')
    expect(nodeToAccessibleText(null)).toBe('')
    // aria-hidden 的內容不念
    expect(nodeToAccessibleText(<span aria-hidden="true">裝飾</span>)).toBe('')
  })

  it('nodeHasMath：只有含 `$...$` 或 <Tex> 的節點才需要另給 aria-label', () => {
    expect(nodeHasMath('純文字')).toBe(false)
    expect(nodeHasMath('價格 \\$5')).toBe(false) // 跳脫的 `\$` 是字面金額，不是公式
    expect(nodeHasMath('單一 $ 符號')).toBe(false)
    expect(nodeHasMath('$x$')).toBe(true)
    expect(nodeHasMath(<Tex>{'x'}</Tex>)).toBe(true)
    expect(nodeHasMath(<b>粗體</b>)).toBe(false)
    expect(nodeHasMath(['a', <i key="i"><Tex>{'x'}</Tex></i>])).toBe(true)
  })

  it('為什麼要另給名稱：KaTeX 在「由內容算名稱」裡只剩 MathML 的文字（這裡記錄 DOM 結構，不測瀏覽器）', () => {
    const { container } = render(
      <label>
        <Tex>{'\\delta_0'}</Tex>
      </label>,
    )
    // HTML 部分 aria-hidden（螢幕閱讀器不念），可讀的只有 .katex-mathml
    expect(container.querySelector('.katex-html')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.katex-mathml math')).toBeTruthy()
  })
})
