/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { PRESET_FLOW, THREE_QUESTIONS } from './diagrams'
import { GALLERY_SLOTS } from './data'

describe('Gallery 的 Mermaid 圖（真正的 mermaid parser）', () => {
  beforeAll(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }))

  it.each([
    ['preset 的兩條路', PRESET_FLOW],
    ['三個問題', THREE_QUESTIONS],
  ])('%s 可以解析成 flowchart', async (_name, chart) => {
    const r = await mermaid.parse(chart, { suppressErrors: false })
    expect(r && typeof r === 'object' ? r.diagramType : r).toBe('flowchart-v2')
  })

  it('流程圖的關鍵節點：useUrlPreset、previewPreset、checkExpected、同一組模型函式', () => {
    for (const s of ['useUrlPreset(experiment)', 'previewPreset(preset)', 'checkExpected', 'src/simulation/models 的同一組函式', '?preset=id']) expect(PRESET_FLOW).toContain(s)
  })

  it('三個問題的分組與 GALLERY_SLOTS.questions 一致（每個 preset 至少出現在它的第一個問題下）', () => {
    const line = (q: string) => new RegExp(`${q}[^\\n]*--> S\\d\\["preset ([\\d, ]+)"\\]`).exec(THREE_QUESTIONS)?.[1].split(',').map((x) => Number(x.trim())) ?? []
    const groups = { converge: line('Q1\\["問題一'), where: line('Q2\\["問題二'), noise: line('Q3\\["問題三') }
    expect(groups.converge.length + groups.where.length + groups.noise.length).toBe(12)
    for (const s of GALLERY_SLOTS) {
      const listed = (Object.keys(groups) as (keyof typeof groups)[]).filter((q) => groups[q].includes(s.index))
      expect(listed, `#${s.index}`).toHaveLength(1)
      expect(s.questions, `#${s.index}`).toContain(listed[0])
    }
  })
})
