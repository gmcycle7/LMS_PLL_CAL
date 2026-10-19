import { render, screen } from '@testing-library/react'
import { accessibleText, nodeHasMath, nodeToAccessibleText, renderTex, Tex, TexBlock, MathText, texToSpeech } from './Tex'
import { Section } from './Section'
import { Callout } from './Callout'

describe('Tex / TexBlock', () => {
  it('行內公式只輸出 KaTeX HTML（不附 MathML），TeX 原始碼留在隱藏的 annotation', () => {
    const { container } = render(
      <p>
        更新式 <Tex>{'w_{n+1}=w_n+\\mu e_n x_n'}</Tex>
      </p>,
    )
    expect(container.querySelector('.katex')).toBeTruthy()
    expect(container.querySelector('.katex-display')).toBeNull()
    // 行內只出 html：沒有 <math>，省下每個公式十幾個 MathML 節點
    expect(container.querySelector('math')).toBeNull()
    // 原始碼仍在：章節測試用 `.katex annotation` 還原；hidden → 不被朗讀、不被複製、不佔版面
    const carrier = container.querySelector('.katex > .katex-mathml')
    expect(carrier?.hasAttribute('hidden')).toBe(true)
    expect(carrier?.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe('w_{n+1}=w_n+\\mu e_n x_n')
    expect(container.querySelectorAll('.katex-mathml *')).toHaveLength(1)
  })

  it('行內公式的無障礙名稱：role=math + aria-label（texToSpeech），不依賴 MathML', () => {
    const { container } = render(<Tex>{'\\sigma_v^2'}</Tex>)
    const host = container.querySelector('.c-tex')!
    expect(host.getAttribute('role')).toBe('math')
    expect(host.getAttribute('aria-label')).toBe(texToSpeech('\\sigma_v^2'))
    expect(host.getAttribute('aria-label')).not.toMatch(/[\\{}^_$]/)
    expect(container.querySelector('.katex-html')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renderTex 輸出模式：行內 html、獨立公式 htmlAndMathml；TeX 原始碼會跳脫', () => {
    const inline = renderTex('a<b', false)
    expect(inline).not.toContain('<math')
    expect(inline).toContain('<annotation encoding="application/x-tex">a&#60;b</annotation>')
    const block = renderTex('a<b', true)
    expect(block).toContain('<math')
    expect(block).toContain('<annotation encoding="application/x-tex">a&lt;b</annotation>')
    expect(block).not.toContain('class="katex-mathml" hidden')
    // 語法錯誤的行內公式：KaTeX 的紅字錯誤原樣回傳（沒有 .katex-html 可插入）
    expect(renderTex('\\frac{1}{', false)).toContain('katex-error')
  })

  it('TexBlock：display mode、公式 ID 錨點與標籤', () => {
    const { container } = render(
      <TexBlock id="F-1.1" label="LMS 更新式">
        {'\\boxed{w_{n+1}=w_n+\\mu e_nx_n}'}
      </TexBlock>,
    )
    expect(container.querySelector('.katex-display')).toBeTruthy()
    // 獨立公式保留 MathML（螢幕閱讀器與複製用）
    expect(container.querySelector('.katex-mathml math')).toBeTruthy()
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

  it('為什麼要另給名稱：KaTeX 的 HTML 部分是 aria-hidden，名稱只能靠外層 aria-label／獨立公式的 MathML（這裡記錄 DOM 結構，不測瀏覽器）', () => {
    const { container } = render(
      <label>
        <Tex>{'\\delta_0'}</Tex>
      </label>,
    )
    // HTML 部分 aria-hidden（螢幕閱讀器不念）；行內公式的可讀名稱在 <Tex> 外層的 aria-label
    expect(container.querySelector('.katex-html')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.c-tex')?.getAttribute('aria-label')).toBe(texToSpeech('\\delta_0'))
    // 獨立公式則仍帶 MathML
    const block = render(<TexBlock>{'\\delta_0'}</TexBlock>)
    expect(block.container.querySelector('.katex-mathml math')).toBeTruthy()
  })
})
