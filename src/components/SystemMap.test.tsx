import mermaid from 'mermaid'
import { SYSTEM_BLOCK_LABEL, systemMapChart, type SystemBlock } from './SystemMap'

describe('SystemMap', () => {
  const all = Object.keys(SYSTEM_BLOCK_LABEL) as SystemBlock[]

  it('不標示任何方塊時也能被 mermaid 解析', async () => {
    const r = await mermaid.parse(systemMapChart([]))
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('每個方塊都能單獨標示，且圖中有對應節點', async () => {
    for (const b of all) {
      const chart = systemMapChart([b])
      const cls = /class ([A-Z,]+) focus/.exec(chart)
      expect(cls, b).toBeTruthy()
      expect(chart, b).toMatch(new RegExp(`\\b${cls![1]}[\\[(]`))
      await mermaid.parse(chart)
    }
  })

  it('重複的 focus 只列一次；全部標示仍可解析', async () => {
    expect(systemMapChart(['cmp', 'cmp', 'gmac'])).toContain('class CMP,GMAC focus')
    await mermaid.parse(systemMapChart(all))
  })
})
