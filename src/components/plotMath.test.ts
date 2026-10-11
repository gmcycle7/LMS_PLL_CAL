import { applyPlotMath, plotMath, texToPlotly } from './plotMath'

describe('texToPlotly：LaTeX → Plotly pseudo-HTML', () => {
  const cases: [string, string][] = [
    ['\\sigma_w', '<i>σ</i><sub><i>w</i></sub>'],
    ['w_{k+1}', '<i>w</i><sub><i>k</i>+1</sub>'],
    ['10^{-3}', '10<sup>−3</sup>'],
    ['\\mu K_q C', '<i>μK</i><sub><i>q</i></sub><i>C</i>'],
    ['\\frac{f_s}{N}', '<i>f</i><sub><i>s</i></sub>/<i>N</i>'],
    ['\\frac{1}{1+L}', '1/(1+<i>L</i>)'],
    ['|H_{\\mathrm{PD}}|', '|<i>H</i><sub>PD</sub>|'],
    ['\\hat y', '<i>ŷ</i>'],
    ['\\mathrm{fs}', 'fs'],
    ['e < 0', '<i>e</i> &lt; 0'],
    ['p = 1 - \\mu x^2', '<i>p</i> = 1−<i>μx</i><sup>2</sup>'],
    ['\\sqrt{N}', '√<i>N</i>'],
    ['\\sqrt{1-p^2}', '√(1−<i>p</i><sup>2</sup>)'],
    ['90^\\circ', '90°'],
    ['\\delta = a - w', '<i>δ</i> = <i>a</i>−<i>w</i>'],
    ['\\text{block } k', 'block <i>k</i>'],
    ['E[\\delta_n^2]', '<i>E</i>[<i>δ</i><sub><i>n</i></sub><sup>2</sup>]'],
    ['\\Delta w', 'Δ<i>w</i>'],
    ['\\log_{10} f', 'log<sub>10</sub><i>f</i>'],
    ['\\mathcal{L}(f)', 'ℒ(<i>f</i>)'],
  ]
  it.each(cases)('%s', (tex, html) => {
    expect(texToPlotly(tex)).toBe(html)
  })

  it('輸出只含 Plotly 支援的標籤，沒有殘留的反斜線或大括號', () => {
    for (const [tex] of cases) {
      const html = texToPlotly(tex)
      expect(html.replace(/<\/?(i|b|sub|sup|br)>/g, '')).not.toMatch(/[<>\\{}]/)
    }
  })
})

describe('plotMath / applyPlotMath', () => {
  it('只轉換 $...$，中文與其他文字不動；\\$ 還原', () => {
    expect(plotMath('學習率 $\\mu$（fs）')).toBe('學習率 <i>μ</i>（fs）')
    expect(plotMath('沒有公式')).toBe('沒有公式')
    expect(plotMath('價格 \\$5')).toBe('價格 $5')
    expect(plotMath('$a$ 與 $b_k$')).toBe('<i>a</i> 與 <i>b</i><sub><i>k</i></sub>')
  })

  it('只處理會顯示的文字欄位；資料陣列與沒有 $ 的物件維持同一個參考', () => {
    const y = new Float64Array([1, 2, 3])
    const data = [{ x: [1, 2, 3], y, name: '$\\sigma_w$', hovertemplate: '$k$=%{x}', marker: { color: '$notmath$' } }]
    const layout = { xaxis: { title: { text: 'block $k$' }, ticktext: ['$\\pi$', '2'] }, yaxis: { title: '$w_k$ (fs)' }, annotations: [{ text: '$p=0.92$' }] }
    const out = applyPlotMath(data, layout)
    expect(out.data[0].name).toBe('<i>σ</i><sub><i>w</i></sub>')
    expect(out.data[0].hovertemplate).toBe('<i>k</i>=%{x}')
    expect(out.data[0].y).toBe(y)
    expect(out.data[0].marker.color).toBe('$notmath$')
    expect(out.layout.xaxis.title.text).toBe('block <i>k</i>')
    expect(out.layout.xaxis.ticktext).toEqual(['<i>π</i>', '2'])
    expect(out.layout.yaxis.title).toBe('<i>w</i><sub><i>k</i></sub> (fs)')
    expect(out.layout.annotations[0].text).toBe('<i>p</i> = 0.92')
    const plain = { data: [{ x: [1], name: 'a' }], layout: { title: 't' } }
    const same = applyPlotMath(plain.data, plain.layout)
    expect(same.data).toBe(plain.data)
    expect(same.layout).toBe(plain.layout)
  })
})
