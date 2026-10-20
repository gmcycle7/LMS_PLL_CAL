import { texNum as sharedTexNum } from '@/components/handcalcMath'
import { texNum } from './format'

/**
 * 驗證頁的 texNum（format.ts）= 共用的 texNum（components/handcalcMath.ts）＋ 一條例外：|x| < 1e6 的整數原樣顯示。
 * docs/dev-conventions.md §2.2「數字進 TeX」寫的就是這個行為；改動它請同步改那段文字。
 */
describe('驗證頁 texNum：共用規則 + 整數原樣顯示的例外', () => {
  it('|x| < 1e6 的整數原樣顯示，不捨入到 digits 位（共用規則會捨入）', () => {
    expect(texNum(123456)).toBe('123456')
    expect(sharedTexNum(123456, 4)).toBe('123500')
    expect(texNum(230400, 3)).toBe('230400')
    expect(sharedTexNum(230400, 3)).toBe('230000')
    expect(texNum(-123456, 2)).toBe('-123456')
    expect(texNum(999999)).toBe('999999')
    expect(texNum(3, 1)).toBe('3')
    expect(texNum(0)).toBe('0')
    expect(texNum(-0)).toBe('0')
  })

  it('整數 ≥ 1e6 與所有非整數都照共用規則（a\\times10^{b}；a = 1 只寫 10^{b}；位數有效）', () => {
    for (const [x, d] of [[1e6, 4], [6e10, 4], [-2.5e7, 4], [1234567, 3], [12345.678, 3], [0.5, 3], [1e-5, 3], [2.2800000000000002, 4], [-0.00012345, 4]] as const) {
      expect(texNum(x, d), `${x}, ${d}`).toBe(sharedTexNum(x, d))
    }
    expect(texNum(6e10)).toBe(String.raw`6\times10^{10}`)
    expect(texNum(1e6)).toBe(String.raw`10^{6}`)
    expect(texNum(12345.678, 3)).toBe('12300')
  })

  it('NaN、±∞ 也交給共用規則（\\text{NaN}、\\infty）', () => {
    expect(texNum(NaN)).toBe(String.raw`\text{NaN}`)
    expect(texNum(Infinity)).toBe(String.raw`\infty`)
    expect(texNum(-Infinity)).toBe(String.raw`-\infty`)
  })
})
