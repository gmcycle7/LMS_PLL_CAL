// @vitest-environment jsdom
import { isChapterSectionId, sectionIdReport } from './sectionIds'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('sectionIdReport', () => {
  it('有標題的 section 都有 id 且唯一 → 乾淨', () => {
    const r = sectionIdReport(mount('<section id="ch99-a"><h2>A</h2></section><section id="ch99-b"><div><h3>B</h3></div></section>'))
    expect(r).toEqual({ missing: [], duplicates: [], count: 2 })
  })

  it('抓到沒有 id 的 section（回報標題）與重複的 id', () => {
    const r = sectionIdReport(mount('<section><h2>沒有 id 的段落</h2></section><section id="x"><h3>X</h3></section><p id="x">撞名</p>'))
    expect(r.missing).toEqual(['沒有 id 的段落'])
    expect(r.duplicates).toEqual(['x'])
  })

  it('沒有標題的 section、手算題卡片與放大檢視不算', () => {
    const r = sectionIdReport(mount('<section><p>沒有標題</p></section><section class="c-handcalc"><header><h3>手算</h3></header></section><div class="c-zoom"><section><h2>z</h2></section></div>'))
    expect(r).toEqual({ missing: [], duplicates: [], count: 0 })
  })
})

describe('isChapterSectionId', () => {
  it('<chNN>-<slug>：小寫英數與連字號', () => {
    expect(isChapterSectionId('ch12-spurs', '12')).toBe(true)
    expect(isChapterSectionId('ch11b-basis-lab', '11b')).toBe(true)
    expect(isChapterSectionId('ch12-', '12')).toBe(false)
    expect(isChapterSectionId('ch12-Spurs', '12')).toBe(false)
    expect(isChapterSectionId('ch11-x', '12')).toBe(false)
    expect(isChapterSectionId('symbols', '12')).toBe(false)
  })
})
