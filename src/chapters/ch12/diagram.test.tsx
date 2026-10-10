import { NOISE_CHAIN_CHART } from './sections/S1Intro'

describe('第 12 章 Mermaid 圖（真正的 mermaid parser；smoke test 以 mock 取代，所以另外驗證語法）', () => {
  it('雜訊傳遞鏈 flowchart 語法正確，且包含乘法節點與 PD / output 兩個出口', async () => {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    const res = await mermaid.parse(NOISE_CHAIN_CHART)
    expect(res && typeof res === 'object' ? res.diagramType : res).toBe('flowchart-v2')
    expect(NOISE_CHAIN_CHART).not.toMatch(/[^-]<[^b/]/) // 標籤內沒有裸的 '<'（只允許 <br/> 與箭頭）
    expect(NOISE_CHAIN_CHART).toContain('(("×"))')
    expect(NOISE_CHAIN_CHART).toMatch(/H_PD/)
    expect(NOISE_CHAIN_CHART).toMatch(/T = L\/\(1\+L\)/)
  }, 60_000)
})
