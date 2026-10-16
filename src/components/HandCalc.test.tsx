import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, randomValues, texNum, texNumP } from '@/components'
import { checkSummary } from './HandCalc'
import { ALL_HANDCALCS, handcalcById } from '@/app/handcalcs'

describe('texNum', () => {
  it('一般數字去尾零、限制有效位數', () => {
    expect(texNum(1.8)).toBe('1.8')
    expect(texNum(2.2800000000000002)).toBe('2.28')
    expect(texNum(0)).toBe('0')
    expect(texNum(-0.4)).toBe('-0.4')
    expect(texNum(1 / 3, 4)).toBe('0.3333')
  })
  it('極大極小值用科學記號', () => {
    expect(texNum(4e9)).toBe('4\\times10^{9}')
    expect(texNum(4.08e-5, 3)).toBe('4.08\\times10^{-5}')
    expect(texNum(1e-6)).toBe('10^{-6}')
    expect(texNum(Number.NaN)).toBe('\\text{NaN}')
  })
  it('texNumP 幫負數加括號', () => {
    expect(texNumP(-3)).toBe('(-3)')
    expect(texNumP(3)).toBe('3')
  })
})

describe('checkAnswer', () => {
  it('預設容許相對 1%', () => {
    expect(checkAnswer(2.28, { value: 2.28 }).ok).toBe(true)
    expect(checkAnswer(2.3, { value: 2.28 }).ok).toBe(true)
    expect(checkAnswer(2.4, { value: 2.28 }).ok).toBe(false)
    expect(checkAnswer(0, { value: 0 }).ok).toBe(true)
    expect(checkAnswer(0.1, { value: 0 }).ok).toBe(false)
  })
})

describe('HandCalc', () => {
  const def = handcalcById('HC-00.1')!

  it('T01: 範例數字的帶入過程得到 w1 = 1.8、w2 = 2.28', () => {
    const sol = def.solve({ w0: 1, x: 2, y: 6, mu: 0.1 })
    expect(sol.results[0].value).toBeCloseTo(1.8, 12)
    expect(sol.results[1].value).toBeCloseTo(2.28, 12)
    const { container } = render(<HandCalc def={def} />)
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.textContent).toContain('2.28')
  })

  it('改數字會重新帶入；不合法輸入顯示原因', () => {
    const { container } = render(<HandCalc def={def} />)
    const mu = screen.getByLabelText(/學習率/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: '0.2' } })
    expect(container.textContent).toContain('2.6') // w1 = 1 + 0.2·4·2
    fireEvent.change(mu, { target: { value: 'abc' } })
    expect(container.textContent).toContain('請輸入數字')
    expect(container.querySelectorAll('.c-step').length).toBe(0)
  })

  it('自己算算看：對答案與看詳解', () => {
    const { container } = render(<HandCalc def={def} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const inputs = screen.getAllByPlaceholderText('你的答案')
    fireEvent.change(inputs[0], { target: { value: '1.8' } })
    fireEvent.change(inputs[1], { target: { value: '2.5' } })
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(1)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(1)
    // 結果播報（sr-only live 區）與輸入框 → 結果的 aria-describedby
    const live = container.querySelector('.c-handcalc-practice .c-sr-only[aria-live="polite"]')!
    expect(live.textContent).toBe('2 題中 1 題正確')
    const verdictId = inputs[1].getAttribute('aria-describedby')!
    expect(document.getElementById(verdictId)?.textContent).toMatch(/還差一點/)
    fireEvent.click(screen.getByText('看詳解'))
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
  })

  it('checkSummary：單題／多題／未填數字的播報文字', () => {
    const results = [{ symbol: 'a', value: 1 }, { symbol: 'b', value: 2 }]
    expect(checkSummary(results.slice(0, 1), { 0: '1' })).toBe('✓ 正確')
    expect(checkSummary(results.slice(0, 1), { 0: '5' })).toBe('✗ 還差一點')
    expect(checkSummary(results.slice(0, 1), {})).toBe('請輸入數字')
    expect(checkSummary(results, { 0: '1', 1: '2' })).toBe('2 題全部正確')
    expect(checkSummary(results, { 0: '1' })).toBe('2 題中 1 題正確，1 題未填數字')
  })

  it('輸入不合法時錯誤訊息以 aria-describedby 接到輸入框', () => {
    render(<HandCalc def={def} />)
    const mu = screen.getByLabelText(/學習率/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: 'abc' } })
    const errId = mu.getAttribute('aria-describedby')!
    expect(document.getElementById(errId)?.textContent).toBe('請輸入數字')
  })

  it('換一題：同 seed 可重現，且題目有有限解', () => {
    const a = randomValues(def, 7)
    expect(randomValues(def, 7)).toEqual(a)
    for (let s = 1; s <= 30; s++) {
      const v = randomValues(def, s)
      expect(def.solve(v).results.every((r) => Number.isFinite(r.value))).toBe(true)
    }
  })

  it('全站手算題：id 唯一、預設值可解、所有步驟的 TeX 可渲染', () => {
    const ids = ALL_HANDCALCS.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of ALL_HANDCALCS) {
      const { container, unmount } = render(<HandCalc def={h} />)
      expect(container.querySelector('.katex-error'), h.id).toBeNull()
      expect(container.querySelectorAll('.c-step').length, h.id).toBeGreaterThan(0)
      unmount()
    }
  }, 120_000)
})
