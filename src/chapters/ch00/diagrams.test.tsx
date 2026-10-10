import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mermaid from 'mermaid'

// 用真正的 mermaid parser 檢查本章三張流程圖（index.test.tsx 為了速度把 mermaid mock 掉了）
describe('ch00：Mermaid 流程圖語法', () => {
  const dir = join(process.cwd(), 'src/chapters/ch00/sections')
  const src = ['BlackBox.tsx', 'WhyMatters.tsx'].map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  const charts = [...src.matchAll(/= `(flowchart[\s\S]*?)`/g)].map((m) => m[1])

  it('三張圖（預測→比較→修正、一般自適應迴圈、PLL 校正迴圈）都能被 mermaid 解析', async () => {
    expect(charts).toHaveLength(3)
    for (const c of charts) {
      const r = await mermaid.parse(c)
      expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
    }
  })
})
