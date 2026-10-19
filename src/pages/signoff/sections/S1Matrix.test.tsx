import { fireEvent, render, screen, within } from '@testing-library/react'
import { wrapPage } from '@/test/renderPage'
import type { ReactNode } from 'react'
import { ALL_CASES } from '../data'
import { STORAGE_KEY } from '../review'
import { ReviewMatrix } from './S1Matrix'

/**
 * §1 Sign-off Matrix 的狀態卡與常駐進度摘要（design-system）。
 * 狀態本身的存取、匯出匯入、篩選在 ../index.test.tsx；這裡只測「狀態看得見、摘要跟著動、鍵盤走得到」。
 */
const wrap = (node: ReactNode) => wrapPage(node, { url: '/signoff' })

const TOTAL = ALL_CASES.reduce((n, c) => n + c.checks.length, 0)

afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('狀態卡（每個判準一張卡：左色條、圖示、<select> 三處同步）', () => {
  it('初始每張卡都是 not-started：class so-check--not-started、data-status、role=group 並以標題命名', () => {
    const { container } = render(wrap(<ReviewMatrix />))
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.so-check'))
    expect(cards.length).toBe(TOTAL)
    for (const c of cards) {
      expect(c.className).toContain('so-check--not-started')
      expect(c.getAttribute('data-status')).toBe('not-started')
      expect(c.getAttribute('role')).toBe('group')
      const labelledBy = c.getAttribute('aria-labelledby')!
      expect(document.getElementById(labelledBy)?.textContent?.length).toBeGreaterThan(0)
      expect(c.querySelector('.so-check-mark')?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('改狀態 → 卡片的 class／data-status／圖示跟著變（通過 ✓、未通過 ✗、豁免 W、進行中 ◐）', () => {
    const { container } = render(wrap(<ReviewMatrix />))
    const sel = screen.getByLabelText('狀態：basic-perturb') as HTMLSelectElement
    const card = sel.closest('.so-check') as HTMLElement
    for (const [status, icon] of [
      ['pass', '✓'],
      ['fail', '✗'],
      ['waived', 'W'],
      ['in-progress', '◐'],
      ['not-started', '○'],
    ] as const) {
      fireEvent.change(sel, { target: { value: status } })
      expect(card.className).toContain(`so-check--${status}`)
      expect(card.getAttribute('data-status')).toBe(status)
      expect(card.querySelector('.so-check-mark')?.textContent).toBe(icon)
      expect(sel.getAttribute('data-status')).toBe(status)
    }
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items['basic-perturb'].status).toBe('not-started')
    expect(container.querySelectorAll('.so-check--not-started').length).toBe(TOTAL)
  })

  it('鍵盤：狀態 <select> 與備註 <textarea> 都可聚焦、有名稱；卡片本身不搶焦點', () => {
    render(wrap(<ReviewMatrix />))
    const sel = screen.getByLabelText('狀態：basic-align') as HTMLSelectElement
    const card = sel.closest('.so-check') as HTMLElement
    expect(card.hasAttribute('tabindex')).toBe(false)
    sel.focus()
    expect(document.activeElement).toBe(sel)
    const note = within(card).getByLabelText('備註：basic-align') as HTMLTextAreaElement
    note.focus()
    expect(document.activeElement).toBe(note)
    // 狀態改成 fail 之後缺理由：卡片裡出現提示，備註框標成 missing
    fireEvent.change(sel, { target: { value: 'fail' } })
    expect(within(card).getByText(/必須寫理由/)).toBeTruthy()
    expect(note.getAttribute('data-missing')).toBe('true')
  })

  it('「出處」（規格段落＋勘誤標籤）放在 BadgeRow 裡：≥ 4 項的列只顯示 3 項 + 「+N」，點開全部顯示；< 4 項的列沒有按鈕', () => {
    const { container } = render(wrap(<ReviewMatrix />))
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.so-check .c-badge-row'))
    expect(rows.length).toBeGreaterThan(0)
    expect(container.querySelector('.so-check .c-badge--erratum')).toBeTruthy()
    const total = (id: string) => {
      const chk = ALL_CASES.flatMap((c) => c.checks).find((k) => k.id === id)!
      return (chk.spec ? 1 : 0) + (chk.errata?.length ?? 0)
    }
    for (const row of rows) {
      const n = total((row.closest('.so-check') as HTMLElement).getAttribute('data-check')!)
      const more = row.querySelector<HTMLButtonElement>('.c-badge-more')
      if (n >= 4) {
        expect(row.getAttribute('data-folded')).toBe('true')
        expect(row.children.length).toBe(4) // 3 項 + 按鈕
        expect(more?.textContent).toBe(`+${n - 3}`)
        fireEvent.click(more!)
        expect(row.children.length).toBe(n + 1) // 全部 + 「收起」
        fireEvent.click(more!)
        expect(row.children.length).toBe(4)
      } else {
        expect(more).toBeNull()
        expect(row.children.length).toBe(n)
      }
    }
    expect(rows.some((r) => r.getAttribute('data-folded') === 'true')).toBe(true)
  })
})

describe('常駐進度摘要（role=status，黏在頂列下方）', () => {
  it('初始：已判定 0／M、未通過 0、缺理由 0、已關閉 0；判定 verdict=open', () => {
    render(wrap(<ReviewMatrix />))
    const s = screen.getByTestId('so-sticky')
    expect(s.getAttribute('role')).toBe('status')
    expect(s.getAttribute('aria-live')).toBe('polite')
    expect(s.getAttribute('data-verdict')).toBe('open')
    expect(s.textContent).toContain(`已判定 0／${TOTAL}`)
    expect(s.textContent).toContain('未通過 0')
    expect(s.textContent).toContain('缺理由 0')
    expect(s.textContent).toContain('已關閉 0')
    expect(s.querySelector('.is-bad')).toBeNull()
  })

  it('改狀態後數字跟著動：通過與未通過都算「已判定」，fail 標紅、缺理由標琥珀；verdict 變 blocked', () => {
    render(wrap(<ReviewMatrix />))
    fireEvent.change(screen.getByLabelText('狀態：basic-perturb'), { target: { value: 'pass' } })
    fireEvent.change(screen.getByLabelText('狀態：basic-align'), { target: { value: 'fail' } })
    fireEvent.change(screen.getByLabelText('狀態：basic-bitmap'), { target: { value: 'in-progress' } })
    const s = screen.getByTestId('so-sticky')
    expect(s.textContent).toContain(`已判定 2／${TOTAL}`)
    expect(s.textContent).toContain('未通過 1')
    expect(s.textContent).toContain('缺理由 1')
    expect(s.textContent).toContain('已關閉 1')
    expect(s.querySelector('[data-count="fail"]')?.className).toContain('is-bad')
    expect(s.querySelector('[data-count="missing-note"]')?.className).toContain('is-warn')
    expect(s.getAttribute('data-verdict')).toBe('blocked')
    // 補上理由：缺理由歸零
    fireEvent.change(screen.getByLabelText('備註：basic-align'), { target: { value: 'JIRA-7' } })
    expect(s.textContent).toContain('缺理由 0')
    expect(s.querySelector('[data-count="missing-note"]')?.className).not.toContain('is-warn')
  })

  it('各 case 的狀態數表：.c-table、有 caption、數字欄靠右（.num）', () => {
    const { container } = render(wrap(<ReviewMatrix />))
    const table = container.querySelector('table.so-summary-table')!
    expect(table.className).toContain('c-table')
    expect(table.querySelector('caption')?.textContent).toBe('各 case 的狀態數')
    expect(table.querySelectorAll('thead th.num').length).toBe(5)
    expect(table.querySelectorAll('tbody tr').length).toBe(ALL_CASES.length)
  })
})
