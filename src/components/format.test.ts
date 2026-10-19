import { fileTimestamp, fmtNum, prettyJson, safeFileName, toFixedClean, toJsonSafe } from './format'

describe('fmtNum', () => {
  it('以有效位數顯示並去除尾零', () => {
    expect(fmtNum(0.00001)).toBe('0.00001')
    expect(fmtNum(3)).toBe('3')
    expect(fmtNum(0.5039893563146316, 6)).toBe('0.503989')
    expect(fmtNum(-93.8123, 3)).toBe('-93.8')
  })
  it('極大或極小值使用科學記號', () => {
    expect(fmtNum(1.5e-7, 3)).toBe('1.5e-7')
    expect(fmtNum(4e9, 3)).toBe('4e9')
    expect(fmtNum(1.23456e12, 3)).toBe('1.23e12')
  })
  it('非有限值', () => {
    expect(fmtNum(NaN)).toBe('NaN')
    expect(fmtNum(Infinity)).toBe('∞')
    expect(fmtNum(-Infinity)).toBe('−∞')
    expect(fmtNum(0)).toBe('0')
  })
})

describe('toJsonSafe', () => {
  it('保留 NaN / Infinity 資訊、轉換 typed array、略過函式、處理循環參照', () => {
    const o: Record<string, unknown> = {
      a: NaN,
      b: Infinity,
      c: new Float64Array([1, 2]),
      d: () => 1,
      e: undefined,
      n: 10n,
      m: new Map([['k', 1]]),
    }
    o.self = o
    expect(toJsonSafe(o)).toEqual({ a: 'NaN', b: 'Infinity', c: [1, 2], n: '10', m: { k: 1 }, self: '[Circular]' })
  })
  it('同一物件被引用兩次（非循環）時兩處都保留', () => {
    const shared = { x: 1 }
    expect(toJsonSafe({ p: shared, q: shared })).toEqual({ p: { x: 1 }, q: { x: 1 } })
  })
  it('prettyJson 輸出可解析的 JSON', () => {
    expect(JSON.parse(prettyJson({ mu: 0.1, bad: -Infinity }))).toEqual({ mu: 0.1, bad: '-Infinity' })
  })
})

describe('檔名工具', () => {
  it('fileTimestamp 格式為 YYYYMMDD-HHMMSS', () => {
    expect(fileTimestamp(new Date(2026, 9, 10, 5, 7, 9))).toBe('20261010-050709')
  })
  it('safeFileName 移除路徑與特殊字元', () => {
    expect(safeFileName(' a/b: c ')).toBe('a-b-c')
    expect(safeFileName('///')).toBe('export')
  })
})

describe('toFixedClean', () => {
  it('四捨五入成 0 的負數不印負號；其餘與 toFixed 相同', () => {
    expect(toFixedClean(-0.00001, 4)).toBe('0.0000')
    expect(toFixedClean(-0, 3)).toBe('0.000')
    expect(toFixedClean(-0.0004, 3)).toBe('0.000')
    expect(toFixedClean(-0.0005, 3)).toBe('-0.001')
    expect(toFixedClean(-1.25, 1)).toBe('-1.3')
    expect(toFixedClean(0.5, 0)).toBe('1')
    expect(toFixedClean(-0.2, 0)).toBe('0')
    expect(toFixedClean(NaN, 2)).toBe('NaN')
    expect(toFixedClean(-Infinity, 2)).toBe('-Infinity')
  })
})
