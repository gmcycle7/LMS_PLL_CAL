// @vitest-environment jsdom
import { DUAL_LOOP_CHART, FIRST_ORDER_CHART, ROADMAP_CHART } from './diagrams'

describe('Ch08 Mermaid 圖（真正的 mermaid parser）', () => {
  it.each([
    ['ROADMAP_CHART', ROADMAP_CHART],
    ['FIRST_ORDER_CHART', FIRST_ORDER_CHART],
    ['DUAL_LOOP_CHART', DUAL_LOOP_CHART],
  ])('%s 語法正確（flowchart）', async (_name, chart) => {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    const res = await mermaid.parse(chart)
    expect(res && typeof res === 'object' ? res.diagramType : res).toBe('flowchart-v2')
    expect(chart).not.toMatch(/[^-]<[^b/]/) // 標籤內沒有裸的 '<'（只允許 <br/> 與箭頭）
  }, 60_000)
})
