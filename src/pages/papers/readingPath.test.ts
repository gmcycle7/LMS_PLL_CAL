/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { PAPERS, READING_PATH_CHART } from './references'

describe('閱讀路線圖（真正的 mermaid parser）', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it('可以解析成 flowchart', async () => {
    const r = await mermaid.parse(READING_PATH_CHART, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('七份文獻都出現在圖上，且 D7 → 教科書 → 其他論文的順序與建議順位一致', () => {
    for (const p of PAPERS) expect(READING_PATH_CHART).toMatch(new RegExp(`\\b${p.id}\\["${p.id} `))
    expect(READING_PATH_CHART).toMatch(/S0\[[^\]]+\] --> D7/)
    expect(READING_PATH_CHART).toMatch(/D7 --> TB/)
    expect(READING_PATH_CHART).toMatch(/D6 --> D4/)
  })
})
