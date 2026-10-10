import { render } from '@testing-library/react'
import { Tex } from '@/components'
import { buttonByText, chooseOption, count, q, renderProblems, visibleTextMatches } from './domTestUtils'

/** 測試工具自己的測試：確定「健檢」真的抓得到問題（否則 smoke test 通過沒有意義） */
describe('domTestUtils', () => {
  it('renderProblems：乾淨的內容沒有問題；程式碼區塊與 MathML 註解裡的 NaN、$ 不算', () => {
    const { container } = render(
      <div>
        <p>
          σ_w 是 <Tex>{String.raw`0.3992\,\mathrm{fs}`}</Tex>
        </p>
        <pre>
          <code>{'return NaN // $ok$ undefined'}</code>
        </pre>
        <select>
          <option>$x$</option>
        </select>
      </div>,
    )
    expect(renderProblems(container)).toEqual([])
  })

  it('反面：沒被渲染的 $…$、算出 NaN／undefined 的數字、KaTeX 語法錯誤、找不到的 code region 都會被抓到', () => {
    const { container } = render(
      <div>
        <p id="a">學習率 $\mu$ 沒有渲染</p>
        <p id="b">σ_w = NaN fs</p>
        <li id="c">數值 undefined</li>
        <p id="d">
          <Tex>{String.raw`\frac{1}{`}</Tex>
        </p>
        <div id="e">程式碼載入錯誤：找不到 region</div>
      </div>,
    )
    const problems = renderProblems(container)
    expect(problems.some((p) => p.startsWith('沒有被渲染的 $…$'))).toBe(true)
    expect(problems.filter((p) => p.startsWith('未定義的數字')).length).toBe(2)
    expect(problems.some((p) => p.startsWith('KaTeX 錯誤'))).toBe(true)
    expect(problems).toContain('CodeBlock：找不到 #region')
    expect(visibleTextMatches(container, /渲染/).length).toBe(1)
    expect(visibleTextMatches(container, /不存在的字/)).toEqual([])
  })

  it('q／count／buttonByText／chooseOption：找不到時丟出說明清楚的錯誤', () => {
    let picked = ''
    const { container } = render(
      <div>
        <button type="button">清除</button>
        <button type="button">再顯示 60 條</button>
        <select onChange={(e) => (picked = e.target.value)} defaultValue="0">
          <option value="0">全部</option>
          <option value="1">12 Coefficient Noise</option>
        </select>
      </div>,
    )
    expect(count(container, 'button')).toBe(2)
    expect(q(container, 'select').tagName).toBe('SELECT')
    expect(() => q(container, '.nope')).toThrow(/找不到元素：\.nope/)
    expect(buttonByText(container, '清除').textContent).toBe('清除')
    expect(buttonByText(container, /再顯示 \d+ 條/).textContent).toBe('再顯示 60 條')
    expect(() => buttonByText(container, '不存在')).toThrow(/找不到按鈕/)
    chooseOption(q<HTMLSelectElement>(container, 'select'), /^12 /)
    expect(picked).toBe('1')
    expect(() => chooseOption(q<HTMLSelectElement>(container, 'select'), 'nope')).toThrow(/找不到選項 nope：全部 \| 12 Coefficient Noise/)
  })
})
