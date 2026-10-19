import { render } from '@testing-library/react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { filterLogData } from './plotUtils'
import { Num, seriesStats, summarizeTraces } from './plotTable'

describe('seriesStats：略過 null／NaN／非數字', () => {
  it('min／max／首值／末值是有效值的；全空回傳 null；typed array 與數字字串都行', () => {
    expect(seriesStats([null, 3, NaN, -1, '2', undefined, 5, Infinity])).toEqual({ min: -1, max: 5, first: 3, last: 5, count: 4 })
    expect(seriesStats(new Float64Array([4, 2, 9]))).toEqual({ min: 2, max: 9, first: 4, last: 9, count: 3 })
    expect(seriesStats([])).toBeNull()
    expect(seriesStats([null, 'abc'])).toBeNull()
  })
})

describe('summarizeTraces', () => {
  it('一般 trace：點數、x 範圍、y 的四個統計；沒有名稱的叫「曲線 N」；Float64Array 的資料也行', () => {
    const rows = summarizeTraces([
      { x: new Float64Array([3, 1, 2]), y: new Float64Array([10, -5, 7]), name: ' w ' },
      { y: [1, 2, 3, 4] },
    ])
    expect(rows[0]).toMatchObject({ index: 0, name: 'w', points: 3, dropped: 0, x: { min: 1, max: 3 }, y: { min: -5, max: 10, first: 10, last: 7 } })
    expect(rows[1]).toMatchObject({ name: '曲線 2', points: 4, x: { min: 0, max: 3 }, y: { min: 1, max: 4, first: 1, last: 4 } })
  })

  it('x0／dx：沒有 x 時用 x0 + i·dx；dx 為負時範圍仍是 [min, max]', () => {
    const [r] = summarizeTraces([{ y: [1, 2, 3], x0: 10, dx: -2 }])
    expect(r.x).toEqual({ min: 6, max: 10 })
  })

  it('類別軸：列出第一個與最後一個類別；數字字串不算類別', () => {
    const [cat, num] = summarizeTraces([
      { x: ['a', 'b', 'c'], y: [1, 2, 3], type: 'bar' },
      { x: ['1', '2', '10'], y: [1, 2, 3] },
    ])
    expect(cat.x).toEqual({ categories: ['a', 'c'] })
    expect(num.x).toEqual({ min: 1, max: 10 })
  })

  it('log 軸：用實際畫出的資料（filterLogData 之後），略去的點數 = 原始長度 − 畫出的長度', () => {
    const original: Data[] = [{ x: [0, 1, 10, 100], y: [1, 2, -3, 4], name: 'a' }, { x: [1, 2, 3], y: [1, 2, 3], name: 'b' }]
    const filtered = filterLogData(original, true, true)
    expect(filtered.dropped).toBe(2)
    const rows = summarizeTraces(filtered.data, original)
    expect(rows[0]).toMatchObject({ points: 2, dropped: 2, x: { min: 1, max: 100 }, y: { min: 2, max: 4, first: 2, last: 4 } })
    expect(rows[1]).toMatchObject({ points: 3, dropped: 0 })
  })

  it('heatmap：點數 = 格數，y 欄位放 z 的統計；histogram：點數 = 樣本數、沒有 y', () => {
    const [h, g, e] = summarizeTraces([
      { type: 'heatmap', x: [1, 2], y: [1, 2, 3], z: [[1, 2], [3, 4], [5, null]] } as Data,
      { type: 'histogram', x: [5, 1, 3] } as Data,
      { type: 'scatter' } as Data,
    ])
    expect(h).toMatchObject({ type: 'heatmap', points: 6, x: { min: 1, max: 2 }, y: { min: 1, max: 5, first: 1, last: 5 } })
    expect(h.notes[0]).toContain('3 列 × 2 欄')
    expect(g).toMatchObject({ type: 'histogram', points: 3, x: { min: 1, max: 5 } })
    expect(g.y).toBeUndefined()
    expect(e.points).toBe(0)
    expect(e.notes).toContain('沒有 y 陣列')
  })
})

describe('Num：數字照 texNum（4 位有效數字）', () => {
  const html = (v: number) => render(<Num value={v} />).container
  it('普通的數用文字（負號用 −）；|x| ≥ 1e6 或 < 1e-4 用 KaTeX 的 a×10^b', () => {
    expect(html(-2.5).textContent).toBe('−2.5')
    expect(html(0).textContent).toBe('0')
    expect(html(1234.5678).textContent).toBe('1235')
    expect(html(0.001).querySelector('.katex')).toBeNull()
    expect(html(2.5e-6).querySelector('annotation')?.textContent).toBe('2.5\\times10^{-6}')
    expect(html(1e7).querySelector('annotation')?.textContent).toBe('10^{7}')
    expect(html(-3e8).querySelector('annotation')?.textContent).toBe('-3\\times10^{8}')
  })
})
