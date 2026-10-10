/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { CONCEPT_SYSTEM, LATENCY_TIMELINE, NOISE_FEEDBACK, RTL_DATAFLOW } from './diagrams'

describe('Ch04 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it.each([
    ['概念系統', CONCEPT_SYSTEM, 'flowchart-v2'],
    ['RTL 資料流', RTL_DATAFLOW, 'flowchart-v2'],
    ['雜訊／回授等效模型', NOISE_FEEDBACK, 'flowchart-v2'],
    ['clock domain / latency', LATENCY_TIMELINE, 'sequence'],
  ])('%s 可以解析', async (_name, chart, type) => {
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe(type)
  })

  it('標籤依勘誤修正：S_k 與 G_k 分開、q = 2b − 1、code 延遲用 D', () => {
    expect(CONCEPT_SYSTEM).toMatch(/S_k = sum of q\[n\] x_ref\[n\]/)
    expect(CONCEPT_SYSTEM).toMatch(/G_k = S_k \/ N/)
    expect(CONCEPT_SYSTEM).toMatch(/q\[n\] = 2b\[n\] - 1/)
    expect(CONCEPT_SYSTEM).toMatch(/x\[n-D\]/)
    expect(CONCEPT_SYSTEM).toMatch(/noise v\[n\]/)
  })
})
