// @vitest-environment jsdom
import { SIX_CONDITIONS } from './data'
import { CONDITION_MAP_CHART, CONDITION_MAP_LEGEND, CONDITION_MAP_NAMES } from './diagrams'

describe('Dashboard Mermaid 圖（真正的 mermaid parser；index.test.tsx 為了速度把 mermaid mock 掉了）', () => {
  it('CONDITION_MAP_CHART 語法正確（flowchart）', async () => {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    const res = await mermaid.parse(CONDITION_MAP_CHART, { suppressErrors: false })
    expect(res && typeof res === 'object' ? res.diagramType : res).toBe('flowchart-v2')
  }, 60_000)

  it('圖中沒有裸的 ASCII 「<」（只允許 <br/>）與分號', () => {
    expect(CONDITION_MAP_CHART.replace(/<br\/>/g, '')).not.toMatch(/[<;]/)
  })

  it('六個條件都標在圖上，圖例與 SIX_CONDITIONS 一一對應', () => {
    const marks = ['①', '②', '③', '④', '⑤', '⑥']
    SIX_CONDITIONS.forEach((c, i) => {
      expect(c.zh, c.id).toContain(CONDITION_MAP_NAMES[i]) // 圖上的短名稱取自條件名稱
      expect(CONDITION_MAP_CHART, c.id).toContain(`${marks[i]} ${CONDITION_MAP_NAMES[i]}`)
      expect(CONDITION_MAP_LEGEND[i].n).toBe(c.n)
    })
    expect(CONDITION_MAP_LEGEND).toHaveLength(6)
    // 圖例文字的 $…$ 成對
    for (const row of CONDITION_MAP_LEGEND) expect((row.knobs.split('$').length - 1) % 2).toBe(0)
    // 訊號流：一圈回到 DTC；GMAC 用延遲後的 code
    expect(CONDITION_MAP_CHART).toMatch(/DSM --> DTC --> PLL --> CMP --> GMAC --> UPD/)
    expect(CONDITION_MAP_CHART).toMatch(/UPD -- ".*" --> DTC/)
    expect(CONDITION_MAP_CHART).toMatch(/x\[n − D\]/)
  })
})
