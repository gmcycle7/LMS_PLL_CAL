import { csvCell, csvPreview, toCsv } from './download'

describe('toCsv', () => {
  it('以空白補齊長度不同的欄位', () => {
    const csv = toCsv({ n: [0, 1, 2, 3], w: [1.5, 2.25], e: [] })
    expect(csv.split('\n')).toEqual(['n,w,e', '0,1.5,', '1,2.25,', '2,,', '3,,'])
  })

  it('接受 typed array 並保留完整精度（最短可回推表示）', () => {
    const x = new Float64Array([0.1 + 0.2, 1e-17, -3.5])
    const csv = toCsv({ x })
    expect(csv.split('\n')).toEqual(['x', '0.30000000000000004', '1e-17', '-3.5'])
    // 可完整回推原值
    expect(Number(csv.split('\n')[1])).toBe(0.1 + 0.2)
  })

  it('非有限值輸出為 NaN / Infinity / -Infinity，null 與 undefined 為空白', () => {
    expect(toCsv({ a: [NaN, Infinity, -Infinity, null, undefined] }).split('\n')).toEqual([
      'a',
      'NaN',
      'Infinity',
      '-Infinity',
      '',
      '',
    ])
  })

  it('含逗號、引號、換行的欄名與字串依 RFC 4180 加引號', () => {
    const csv = toCsv({ 'w, fs': ['a"b', 'x\ny'] })
    expect(csv).toBe('"w, fs"\n"a""b"\n"x\ny"')
  })

  it('防止 formula injection：= + @ 開頭的字串加上單引號，但負數不受影響', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('-3.2')).toBe('-3.2')
    expect(csvCell(-3.2)).toBe('-3.2')
  })

  it('沒有欄位時回傳空字串', () => {
    expect(toCsv({})).toBe('')
  })
})

describe('csvPreview', () => {
  it('只取前 maxRows 列並回報總列數', () => {
    const n = Array.from({ length: 250 }, (_, i) => i)
    const p = csvPreview({ n, half: n.slice(0, 100) }, 200)
    expect(p.headers).toEqual(['n', 'half'])
    expect(p.rows).toHaveLength(200)
    expect(p.totalRows).toBe(250)
    expect(p.rows[150]).toEqual(['150', ''])
  })
})
