import { diffLines, extractRegion, listRegions } from './codeRegion'

const TS = `export function a() {
  // #region core:lmsStep
  const e = y - w * x
  w = w + mu * e * x // ← 差異：使用 e 的大小
  // #endregion
}
// #region core:outer
function b() {
  // #region core:inner
  return 1
  // #endregion
}
// #endregion`

const PY = `def f():
    # region core:sign_step
    w = w + mu * np.sign(e) * x  # ← 差異
    # endregion
`

describe('codeRegion', () => {
  it('lists regions in order', () => {
    expect(listRegions(TS)).toEqual(['lmsStep', 'outer', 'inner'])
  })
  it('extracts and dedents a TypeScript region', () => {
    expect(extractRegion(TS, 'lmsStep')).toBe('const e = y - w * x\nw = w + mu * e * x // ← 差異：使用 e 的大小')
  })
  it('keeps nested region content but drops nested markers', () => {
    expect(extractRegion(TS, 'outer')).toBe('function b() {\n  return 1\n}')
  })
  it('extracts Python regions', () => {
    expect(extractRegion(PY, 'sign_step')).toBe('w = w + mu * np.sign(e) * x  # ← 差異')
  })
  it('throws on unknown region', () => {
    expect(() => extractRegion(TS, 'nope')).toThrow(/找不到/)
  })
  it('finds diff marker lines', () => {
    expect(diffLines('a\nb // ← 差異\nc')).toEqual([2])
  })
})
