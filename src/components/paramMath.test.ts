import {
  checkValue,
  clampValue,
  formatInput,
  fromLogPosition,
  niceStep,
  parseNumberInput,
  roundSig,
  toLogPosition,
} from './paramMath'

describe('parseNumberInput', () => {
  it.each([
    ['0.00001', 0.00001],
    ['1e-5', 1e-5],
    ['  -3 ', -3],
    ['.5', 0.5],
    ['5.', 5],
    ['+2', 2],
    ['4096', 4096],
    ['−0.25', -0.25], // U+2212 minus
    ['０．００１', 0.001], // 全形
    ['1E3', 1000],
  ])('接受 %s', (s, v) => {
    expect(parseNumberInput(s)).toBe(v)
  })

  it.each(['', '-', '.', '1e', 'abc', '0x10', 'Infinity', 'NaN', '4,096', '1..2', '1e400'])('拒絕 %s', (s) => {
    expect(parseNumberInput(s)).toBeNull()
  })
})

describe('roundSig / formatInput / niceStep', () => {
  it('roundSig', () => {
    expect(roundSig(0.0050118723362727, 3)).toBe(0.00501)
    expect(roundSig(0.1 + 0.2, 6)).toBe(0.3)
    expect(roundSig(0, 3)).toBe(0)
  })
  it('formatInput 保留精確值且去尾零', () => {
    expect(formatInput(0.00001)).toBe('0.00001')
    expect(formatInput(1e-7)).toBe('1e-7')
    expect(parseNumberInput(formatInput(1e-7))).toBe(1e-7)
    expect(formatInput(0.1 + 0.2)).toBe('0.3')
  })
  it('niceStep 取 1/2/5×10^k', () => {
    expect(niceStep(0.002)).toBe(0.002)
    expect(niceStep(0.0037)).toBe(0.002)
    expect(niceStep(7)).toBe(5)
    expect(niceStep(0)).toBe(1)
  })
})

describe('log 刻度對應', () => {
  it('數值 ↔ log10 位置', () => {
    expect(toLogPosition(1e-3, 1e-6, 1e-1)).toBeCloseTo(-3, 12)
    expect(toLogPosition(0, 1e-6, 1e-1)).toBe(-6)
    expect(toLogPosition(1, 1e-6, 1e-1)).toBe(-1)
    // python: float('%.3g' % 10**-3.5) = 0.000316；float('%.3g' % 10**-2.3) = 0.00501
    expect(fromLogPosition(-3.5, 1e-6, 1e-1)).toBe(0.000316)
    expect(fromLogPosition(-2.3, 1e-6, 1e-1)).toBe(0.00501)
    expect(fromLogPosition(-1, 1e-6, 1e-1)).toBe(0.1)
  })
})

describe('checkValue / clampValue', () => {
  it('範圍與整數檢查', () => {
    expect(checkValue(0.5, 0, 1)).toEqual({ ok: true })
    expect(checkValue(1.5, 0, 1)).toEqual({ ok: false, problem: 'range' })
    expect(checkValue(2.5, 0, 10, true)).toEqual({ ok: false, problem: 'integer' })
    expect(checkValue(null, 0, 1)).toEqual({ ok: false, problem: 'parse' })
  })
  it('夾回範圍', () => {
    expect(clampValue(1.5, 0, 1)).toBe(1)
    expect(clampValue(-2, 0, 1)).toBe(0)
    expect(clampValue(7.6, 0.5, 7.5, true)).toBe(7)
    expect(clampValue(0.2, 0.5, 7.5, true)).toBe(1)
  })
})
