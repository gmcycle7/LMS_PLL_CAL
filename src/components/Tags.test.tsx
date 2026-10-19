import { fireEvent, render, screen } from '@testing-library/react'
import { BADGE_VARIANTS, Badge, BadgeRow, ClaimTag, ModelLevel, SourceTag, badgeClass } from './Tags'
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
  it('不可聚焦（沒有 tabindex）；aria-describedby 指向 tooltip', () => {
    const { container } = render(<ClaimTag kind="exact" />)
    const badge = container.querySelector<HTMLElement>('.c-badge')!
    expect(badge.hasAttribute('tabindex')).toBe(false)
    badge.focus()
    expect(document.activeElement).not.toBe(badge)
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(badge.getAttribute('aria-describedby')).toBe(tip.id)
  })
  it('點一下開／關 tooltip（觸控）；點徽章以外的地方收起', () => {
    const { container } = render(
      <>
        <SourceTag kind="measured" />
        <button type="button">其他</button>
      </>,
    )
    const badge = container.querySelector<HTMLElement>('.c-badge')!
    expect(badge.className).not.toContain('is-open')
    fireEvent.click(badge)
    expect(badge.className).toContain('is-open')
    fireEvent.click(badge)
    expect(badge.className).not.toContain('is-open')
    fireEvent.click(badge)
    fireEvent.pointerDown(screen.getByText('其他'))
    expect(badge.className).not.toContain('is-open')
  })
  it('Esc 關閉 tooltip：滑鼠停留或已點開時加上 is-dismissed，移開後重設', () => {
    const { container } = render(<SourceTag kind="measured" />)
    const badge = container.querySelector<HTMLElement>('.c-badge')!
    fireEvent.click(badge)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(badge.className).toContain('is-dismissed')
    expect(badge.className).not.toContain('is-open')
    fireEvent.mouseEnter(badge)
    expect(badge.className).not.toContain('is-dismissed')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(badge.className).toContain('is-dismissed')
    fireEvent.mouseLeave(badge)
    expect(badge.className).not.toContain('is-dismissed')
    // 沒有滑鼠停留、也沒點開時 document 的 Esc 不會動到它
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
    expect(badge.hasAttribute('tabindex')).toBe(false)
    expect(badge.className).toContain('c-badge--verified') // 青綠帶 ✓，不是「精確」的綠
    expect(badge.textContent).toContain('✓')
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
    expect(badge.className).toContain(`c-badge--${label}`)
    expect(badge.className).not.toContain('c-badge--verified')
    expect(badge.textContent).toContain(`${id} ${label}`)
    expect(badge.textContent).not.toContain('verified')
  })

  it('預設讀取 src/data/verification-status.json', () => {
    const info = getTestStatus('T01')
    expect(['pass', 'partial', 'fail', 'missing']).toContain(info.status)
    expect(getTestStatus('T01', null).status).toBe('missing')
  })
})

describe('Badge 基底與 variant（語意固定：一種顏色只代表一件事）', () => {
  it('badgeClass：neutral 只有基底，其他是 c-badge c-badge--<variant>，可附 hook 類別', () => {
    expect(badgeClass()).toBe('c-badge')
    expect(badgeClass('neutral', 'x-hook')).toBe('c-badge x-hook')
    expect(badgeClass('erratum', 'so-erratum')).toBe('c-badge c-badge--erratum so-erratum')
  })
  it('每個 variant 都渲染成 c-badge--<variant>；徽章不可聚焦', () => {
    for (const v of BADGE_VARIANTS) {
      const { container, unmount } = render(<Badge variant={v}>x</Badge>)
      const el = container.querySelector<HTMLElement>('.c-badge')!
      if (v !== 'neutral') expect(el.className).toContain(`c-badge--${v}`)
      else expect(el.className).toBe('c-badge')
      expect(el.hasAttribute('tabindex')).toBe(false)
      unmount()
    }
  })
  it('ClaimTag → exact／approx／research 實心 variant；ModelLevel → level；SourceTag → source（illustrative 虛線）', () => {
    const { container } = render(
      <>
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <ClaimTag kind="research" />
        <ModelLevel level="L5" />
        <SourceTag kind="illustrative" />
        <SourceTag kind="measured" />
      </>,
    )
    const cls = Array.from(container.querySelectorAll('.c-badge')).map((b) => b.className)
    expect(cls[0]).toContain('c-badge--exact')
    expect(cls[1]).toContain('c-badge--approx')
    expect(cls[2]).toContain('c-badge--research')
    expect(cls[3]).toContain('c-badge--level')
    // 舊的 hook 類別留著給章節測試與資料用
    expect(cls[3]).toContain('c-level-L5')
    expect(cls[4]).toContain('c-badge--source')
    expect(cls[4]).toContain('is-dashed')
    expect(cls[5]).toContain('c-badge--source')
    expect(cls[5]).not.toContain('is-dashed')
    // 不同語意不共用同一個 variant（精確的綠 ≠ 量測來源）
    expect(cls[5]).not.toContain('c-badge--exact')
  })
})

describe('BadgeRow（同一行 ≥ 4 個徽章就摺疊：前 3 個 + 「+N」）', () => {
  const badges = (n: number) => Array.from({ length: n }, (_, i) => <Badge key={i}>b{i}</Badge>)
  it('3 個以下不摺疊、沒有按鈕', () => {
    const { container } = render(<BadgeRow label="測試">{badges(3)}</BadgeRow>)
    expect(container.querySelectorAll('.c-badge').length).toBe(3)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.c-badge-row')!.getAttribute('data-folded')).toBeNull()
    expect(container.querySelector('.c-badge-row')!.getAttribute('role')).toBe('group')
    expect(container.querySelector('.c-badge-row')!.getAttribute('aria-label')).toBe('測試')
  })
  it('4 個：顯示前 3 個 + 「+1」；點開全部顯示並變成「收起」；再點收回', () => {
    const { container } = render(<BadgeRow>{badges(4)}</BadgeRow>)
    const row = container.querySelector('.c-badge-row')!
    expect(row.getAttribute('data-folded')).toBe('true')
    expect(Array.from(container.querySelectorAll('.c-badge:not(.c-badge-more)')).map((b) => b.textContent)).toEqual(['b0', 'b1', 'b2'])
    const more = screen.getByRole('button', { name: '再顯示 1 個標籤' })
    expect(more.textContent).toBe('+1')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.className).toContain('c-badge-more')
    fireEvent.click(more)
    expect(row.getAttribute('data-folded')).toBe('false')
    expect(container.querySelectorAll('.c-badge:not(.c-badge-more)').length).toBe(4)
    const less = screen.getByRole('button', { name: '收起標籤' })
    expect(less.textContent).toBe('收起')
    expect(less.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(less)
    expect(container.querySelectorAll('.c-badge:not(.c-badge-more)').length).toBe(3)
  })
  it('摺疊門檻與顯示數可調（fold=6、show=2）；摺起來的項目不在 DOM 裡', () => {
    const a = render(<BadgeRow fold={6}>{badges(5)}</BadgeRow>)
    expect(a.container.querySelector('button')).toBeNull()
    expect(a.container.querySelectorAll('.c-badge').length).toBe(5)
    a.unmount()
    const b = render(<BadgeRow show={2}>{badges(7)}</BadgeRow>)
    expect(b.container.querySelectorAll('.c-badge:not(.c-badge-more)').length).toBe(2)
    expect(screen.getByRole('button', { name: '再顯示 5 個標籤' }).textContent).toBe('+5')
    expect(b.container.textContent).not.toContain('b6')
  })
  it('「+N」是 <button>：鍵盤可操作（Enter／Space 觸發 click），外層沿用 .c-tag-row 的版面', () => {
    const { container } = render(<BadgeRow>{badges(4)}</BadgeRow>)
    expect(container.querySelector('.c-badge-row')!.className).toContain('c-tag-row')
    const more = screen.getByRole('button')
    expect(more.tagName).toBe('BUTTON')
    expect(more.getAttribute('type')).toBe('button')
    more.focus()
    expect(document.activeElement).toBe(more)
  })
})
