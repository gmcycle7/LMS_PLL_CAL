import { makeTexNum, texNumber } from './texNum'

describe('texNumber', () => {
  it('去尾零、指數改成 \\times10^{k}', () => {
    expect(texNumber(2.2800000000000002)).toBe('2.28')
    expect(texNumber(1234.5678, 6)).toBe('1234.57')
    expect(texNumber(7.979e-5, 4)).toBe(String.raw`7.979\times10^{-5}`)
    expect(texNumber(1.2e7, 4)).toBe(String.raw`1.2\times10^{7}`)
  })

  it('±∞、NaN、±0', () => {
    expect(texNumber(Infinity)).toBe(String.raw`\infty`)
    expect(texNumber(-Infinity)).toBe(String.raw`-\infty`)
    expect(texNumber(NaN)).toBe(String.raw`\text{—}`)
    expect(texNumber(NaN, 4, { nan: String.raw`\text{NaN}` })).toBe(String.raw`\text{NaN}`)
    expect(texNumber(0)).toBe('0')
    expect(texNumber(-0)).toBe('0')
  })

  it('paren：只有負數加括號（乘法的第二個因子）', () => {
    expect(texNumber(-3, 4, { paren: true })).toBe('(-3)')
    expect(texNumber(3, 4, { paren: true })).toBe('3')
    expect(texNumber(-2.5e-7, 4, { paren: true })).toBe(String.raw`(-2.5\times10^{-7})`)
    expect(texNumber(-3)).toBe('-3')
  })

  it('makeTexNum：預設位數綁在函式上，呼叫時可以覆寫', () => {
    const t6 = makeTexNum(6, { paren: true })
    expect(t6(1 / 3)).toBe('0.333333')
    expect(t6(1 / 3, 3)).toBe('0.333')
    expect(t6(-0.5)).toBe('(-0.5)')
    expect(makeTexNum()(1 / 3)).toBe('0.3333')
  })
})
