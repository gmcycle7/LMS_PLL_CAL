import { render } from '@testing-library/react'
import { DocumentTitle, NOT_FOUND_TITLE, TITLE_SUFFIX, documentTitleFor, pageNeighbours } from './navigation'
import { PAGES, pageById } from './registry'

describe('pageNeighbours：上一頁／下一頁', () => {
  const chain = PAGES.filter((p) => p.group !== 'tools')
  const tools = PAGES.filter((p) => p.group === 'tools')

  it('章節鏈（Dashboard → A → B → C → D）照 registry 順序前後相接', () => {
    expect(chain[0].id).toBe('dashboard')
    for (let i = 0; i < chain.length; i++) {
      const n = pageNeighbours(chain[i].id)
      expect(n.prev?.id).toBe(chain[i - 1]?.id)
      expect(n.next?.id).toBe(chain[i + 1]?.id)
    }
    expect(pageNeighbours('ch07').next?.id).toBe('case-sspll')
    expect(pageNeighbours('case-sspll').next?.id).toBe('ch08')
  })

  it('工具頁只在工具頁之間前後移動，不跨到章節鏈', () => {
    expect(tools.length).toBeGreaterThan(3)
    for (let i = 0; i < tools.length; i++) {
      const n = pageNeighbours(tools[i].id)
      expect(n.prev?.id).toBe(tools[i - 1]?.id)
      expect(n.next?.id).toBe(tools[i + 1]?.id)
      for (const p of [n.prev, n.next]) if (p) expect(p.group).toBe('tools')
    }
  })

  it('兩條鏈的交界：Part D 最後一頁沒有下一頁、第一個工具頁沒有上一頁', () => {
    expect(pageNeighbours(chain[chain.length - 1].id).next).toBeUndefined()
    expect(pageNeighbours(tools[0].id).prev).toBeUndefined()
    expect(pageNeighbours('verification').next).toBeUndefined()
    expect(pageNeighbours('lab').prev).toBeUndefined()
    expect(pageNeighbours('workbook').prev?.id).toBe('lab')
  })

  it('未知的頁面 id：沒有鄰居', () => {
    expect(pageNeighbours('nope')).toEqual({})
  })
})

describe('documentTitleFor／DocumentTitle', () => {
  it('<registry 的 title> · LMS × PLL Calibration Lab；Dashboard 與找不到頁面各有名稱', () => {
    expect(TITLE_SUFFIX).toBe('LMS × PLL Calibration Lab')
    const ch05 = pageById('ch05')!
    expect(documentTitleFor(ch05)).toBe(`${ch05.title} · LMS × PLL Calibration Lab`)
    expect(documentTitleFor(pageById('dashboard'))).toBe('Dashboard / 學習路線 · LMS × PLL Calibration Lab')
    expect(documentTitleFor(undefined)).toBe(`${NOT_FOUND_TITLE} · LMS × PLL Calibration Lab`)
    // 每一頁的標題都不同，分頁列才分得出來
    expect(new Set(PAGES.map((p) => documentTitleFor(p))).size).toBe(PAGES.length)
  })

  it('掛載時寫入 document.title，換頁時更新', () => {
    const a = pageById('ch05')!
    const b = pageById('formulas')!
    const { rerender } = render(<DocumentTitle entry={a} />)
    expect(document.title).toBe(documentTitleFor(a))
    rerender(<DocumentTitle entry={b} />)
    expect(document.title).toBe(documentTitleFor(b))
    rerender(<DocumentTitle />)
    expect(document.title).toContain('找不到頁面')
  })
})
