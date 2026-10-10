import { IMPL_CHART, SPEC_CHART } from './sections/S8StateMachine'

describe('Ch14 Mermaid 圖（真正的 mermaid parser）', () => {
  it('規格 §14.2 原圖與本站實作圖都能解析', async () => {
    const mermaid = (await import('mermaid')).default
    for (const chart of [SPEC_CHART, IMPL_CHART]) {
      const r = await mermaid.parse(chart)
      expect(r && typeof r === 'object' ? (r as { diagramType: string }).diagramType : '').toMatch(/flowchart/)
    }
  }, 60000)

  it('實作圖涵蓋所有狀態', () => {
    for (const s of ['RESET', 'LOCK', 'COARSE', 'VERIFY', 'FINE', 'TRACK', 'FREEZE', 'RESTART', 'FAULT']) expect(IMPL_CHART).toContain(s)
  })
})
