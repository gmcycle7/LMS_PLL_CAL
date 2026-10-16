import { fireEvent, render, screen } from '@testing-library/react'
import { ClaimTag, ModelLevel, SourceTag } from './Tags'
import { TestBadge } from './TestBadge'
import { getTestStatus } from './testStatus'

describe('ClaimTag', () => {
  it.each([
    ['exact', '精確｜指定模型'],
    ['approx', '近似｜需驗證'],
    ['research', '研究假說／延伸'],
  ] as const)('%s → %s', (kind, label) => {
    const { container } = render(<ClaimTag kind={kind} />)
    const badge = container.querySelector('.c-claim')!
    expect(badge.firstChild?.textContent).toBe(label)
    expect(badge.className).toContain(`c-claim-${kind}`)
  })
})

describe('TipBadge（徽章 tooltip）', () => {
  it('不進 Tab 順序（tabIndex=-1）但仍可點擊聚焦；aria-describedby 指向 tooltip', () => {
    const { container } = render(<ClaimTag kind="exact" />)
    const badge = container.querySelector('.c-badge')!
    expect(badge.getAttribute('tabindex')).toBe('-1')
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(badge.getAttribute('aria-describedby')).toBe(tip.id)
  })
  it('Esc 關閉 tooltip：聚焦時失焦；滑鼠停留時加上 is-dismissed，移開後重設', () => {
    const { container } = render(<SourceTag kind="measured" />)
    const badge = container.querySelector<HTMLElement>('.c-badge')!
    badge.focus()
    expect(document.activeElement).toBe(badge)
    fireEvent.keyDown(badge, { key: 'Escape' })
    expect(document.activeElement).not.toBe(badge)
    fireEvent.mouseEnter(badge)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(badge.className).toContain('is-dismissed')
    fireEvent.mouseLeave(badge)
    expect(badge.className).not.toContain('is-dismissed')
    // 沒有滑鼠停留時 document 的 Esc 不會動到它
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(badge.className).not.toContain('is-dismissed')
  })
})

describe('ModelLevel', () => {
  it('tooltip 內容取自規格 §15.1 表格', () => {
    render(<ModelLevel level="L1" />)
    expect(screen.getByText('模型 L1')).toBeTruthy()
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip.textContent).toContain('Block GMAC + Gaussian Comparator')
    expect(tip.textContent).toContain('每 Sample + Block')
  })
  it('L4–L6 標示為可做架構 sign-off 的層級', () => {
    render(<ModelLevel level="L5" />)
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain('Quantized / RTL-like Control')
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain('sign-off')
  })
})

describe('SourceTag', () => {
  it('預設為 illustrative', () => {
    render(<SourceTag />)
    expect(screen.getByText('Illustrative 示例')).toBeTruthy()
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain('非量測數據')
  })
  it('measured', () => {
    render(<SourceTag kind="measured" />)
    expect(screen.getByText('Measured 量測')).toBeTruthy()
  })
})

const fakeFile = {
  tests: {
    T01: { status: 'pass', ts: { passed: 3, failed: 0, names: ['T01: one-step update'] }, py: { passed: 2, failed: 0, names: ['test_t01'] } },
    T02: { status: 'partial', ts: { passed: 1, failed: 0, names: ['T02: mean'] }, py: { passed: 0, failed: 0, names: [] } },
    T03: { status: 'fail', ts: { passed: 0, failed: 1, names: ['T03: ms'] }, py: { passed: 0, failed: 0, names: [] } },
    T04: { status: 'verified' },
  },
}

describe('TestBadge', () => {
  it("只有 status === 'pass' 才顯示 verified，tooltip 列出測試名稱", () => {
    const { container } = render(<TestBadge id="T01" file={fakeFile} />)
    const badge = container.querySelector('.c-test')!
    expect(badge.getAttribute('data-status')).toBe('pass')
    expect(badge.getAttribute('tabindex')).toBe('-1')
    expect(badge.textContent).toContain('T01 verified')
    expect(badge.textContent).toContain('[TS] T01: one-step update')
    expect(badge.textContent).toContain('[PY] test_t01')
  })

  it.each([
    ['T02', 'partial', 'partial'],
    ['T03', 'fail', 'fail'],
    ['T04', 'missing', 'pending'], // 未知狀態字串不得當成通過
    ['T99', 'missing', 'pending'], // 檔案沒有此 id
  ])('%s → %s', (id, status, label) => {
    const { container } = render(<TestBadge id={id} file={fakeFile} />)
    const badge = container.querySelector('.c-test')!
    expect(badge.getAttribute('data-status')).toBe(status)
    expect(badge.textContent).toContain(`${id} ${label}`)
    expect(badge.textContent).not.toContain('verified')
  })

  it('預設讀取 src/data/verification-status.json', () => {
    const info = getTestStatus('T01')
    expect(['pass', 'partial', 'fail', 'missing']).toContain(info.status)
    expect(getTestStatus('T01', null).status).toBe('missing')
  })
})
