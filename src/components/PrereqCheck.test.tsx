import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CHAPTER_FRAME_META } from '@/app/chapterMeta'
import { PrereqCheck } from './PrereqCheck'

describe('PrereqCheck：章首的「進來之前你應該會」', () => {
  it('每條一個連結：有 anchor 的連到該章的 ?a=錨點、沒有的用 ChRef；標籤裡的 $…$ 以 KaTeX 顯示；不是 <details>（三種模式都展開）', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/ch/06']}>
        <PrereqCheck items={CHAPTER_FRAME_META.ch06.prereqs} />
      </MemoryRouter>,
    )
    const box = screen.getByRole('complementary', { name: '進來之前你應該會' })
    expect(box.querySelector('details')).toBeNull()
    const items = Array.from(box.querySelectorAll('li'))
    expect(items).toHaveLength(CHAPTER_FRAME_META.ch06.prereqs.length)
    // 第 1 條：ch05 沒有 anchor → ChRef（/ch/05）
    const a1 = items[0].querySelector('a.c-chref') as HTMLAnchorElement
    expect(a1.getAttribute('href')).toBe('/ch/05')
    expect(a1.textContent).toBe('第 05 章 §5、§7')
    expect(a1.getAttribute('data-chref')).toBe('05')
    // 第 2 條：ch03 的 fixed-x 錨點 → /ch/03?a=fixed-x
    const a2 = items[1].querySelector('a.c-chref') as HTMLAnchorElement
    expect(a2.getAttribute('href')).toBe('/ch/03?a=fixed-x')
    expect(a2.textContent).toBe('第 03 章 §1')
    expect(a2.getAttribute('data-anchor')).toBe('fixed-x')
    // 標籤的數學是 KaTeX，不是殘留的 $
    expect(items[0].querySelector('.katex')).not.toBeNull()
    expect(box.textContent).not.toContain('$')
    expect(container.querySelector('a[href^="#"]')).toBeNull()
  })

  it('沒有 ch 的條目（ch00 的微積分先備）只有文字、沒有連結；空清單不畫', () => {
    const { container } = render(
      <MemoryRouter>
        <PrereqCheck items={CHAPTER_FRAME_META.ch00.prereqs} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('li')).toHaveLength(CHAPTER_FRAME_META.ch00.prereqs.length)
    expect(container.querySelector('a')).toBeNull()
    const empty = render(<PrereqCheck items={[]} />)
    expect(empty.container.querySelector('.c-prereq-check')).toBeNull()
  })

  it('在 <Router> 之外（單元測試）退回 <a href="#/ch/03?a=fixed-x">', () => {
    const { container } = render(<PrereqCheck items={[{ label: '等比數列', ch: '03', anchor: 'fixed-x' }]} />)
    expect(container.querySelector('a.c-chref')!.getAttribute('href')).toBe('#/ch/03?a=fixed-x')
  })
})
