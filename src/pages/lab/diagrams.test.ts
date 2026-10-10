/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { PIPELINE_CHART } from './diagrams'

describe('Lab 頁的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('九級訊號鏈可以解析（flowchart）', async () => {
    const r = await mermaid.parse(PIPELINE_CHART, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('圖上有九級與兩條路徑（H_PD 到 comparator、T 到輸出），回授由 gain register 回到 DTC', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(PIPELINE_CHART).toMatch(new RegExp(`"${n} `))
    expect(PIPELINE_CHART).toMatch(/DTC -->\|"e_DTC\[n\]"\| HPD/)
    expect(PIPELINE_CHART).toMatch(/DTC -->\|"e_DTC\[n\]"\| TOUT/)
    expect(PIPELINE_CHART).toMatch(/REG -->\|"w_app"\| DTC/)
    expect(PIPELINE_CHART).toContain('H_PD = 1/(1+L)')
    expect(PIPELINE_CHART).toContain('T = L/(1+L)')
  })
})
