import { render, screen } from '@testing-library/react'
import { MetricTable } from './MetricTable'

// 參考值以 Python 獨立計算：scipy.stats.norm.cdf(0.01) = 0.5039893563146316
describe('MetricTable', () => {
  it('顯示 Δ 與 ✓ / ✗', () => {
    const { container } = render(
      <MetricTable
        rows={[
          { name: 'P(q=+1)', value: 0.503989, analytic: 0.5039893563146316, tolerance: 1e-6, formulaId: 'F-5.1', claim: 'exact' },
          { name: 'mean gain', value: 3.2, analytic: 3, tolerance: 0.05, toleranceMode: 'rel', unit: 'fs' },
          { name: 'κ', value: NaN },
          { name: 'Monte Carlo', value: 'Not implemented' },
        ]}
      />,
    )
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].getAttribute('data-pass')).toBe('true')
    expect(rows[1].getAttribute('data-pass')).toBe('false')
    expect(rows[0].textContent).toContain('✓')
    expect(rows[1].textContent).toContain('✗')
    // Δ = 3.2 − 3 = 0.2；相對差 python: (3.2-3)/3*100 = 6.666666666666672 → 3 位有效數字 6.67%
    expect(rows[1].textContent).toContain('0.2')
    expect(rows[1].textContent).toContain('(6.67%)')
    // python: 0.503989 − Φ(0.01) = −3.5631463157770327e-07 → 3 位有效數字
    expect(rows[0].textContent).toContain('-3.56e-7')
    expect(screen.getByText('NaN').className).toContain('c-bad')
    expect(screen.getByText('Not implemented')).toBeTruthy()
    expect(screen.getByText('F-5.1').getAttribute('href')).toBe('#formula-F-5.1')
    expect(screen.getByText('精確｜指定模型')).toBeTruthy()
  })

  it('窄容器的小卡排版靠 CSS：解析值／Δ 的儲存格帶 data-label（補欄名用），檢查欄帶 data-col', () => {
    const { container } = render(<MetricTable rows={[{ name: 'gain', value: 3.2, analytic: 3, tolerance: 0.05, toleranceMode: 'rel' }]} />)
    expect(container.querySelector('.table-wrap.c-metric-wrap > table.c-metric-table')).toBeTruthy()
    const cells = [...container.querySelectorAll('tbody tr td')]
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([null, null, null, '解析值', 'Δ', null])
    expect(cells[5].getAttribute('data-col')).toBe('check')
    // 表頭仍在 DOM 裡（寬容器照常顯示；窄容器只是視覺上隱藏）
    expect([...container.querySelectorAll('th')].map((h) => h.textContent)).toEqual(['指標', '數值', '單位', '解析值', 'Δ（模擬 − 解析）', '檢查'])
  })

  it('沒有 analytic 時不顯示比較欄', () => {
    const { container } = render(<MetricTable rows={[{ name: 'x', value: 1 }]} />)
    expect(container.querySelectorAll('th')).toHaveLength(3)
  })

  it('空陣列不渲染', () => {
    const { container } = render(<MetricTable rows={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
