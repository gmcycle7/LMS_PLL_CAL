import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CHAPTER_FRAME_META } from '@/app/chapterMeta'
import { ChapterHandoff, chapterCodeOf } from './ChapterHandoff'

describe('ChapterHandoff：章末「下一章要解決什麼」', () => {
  it('chapterCodeOf：ch05 → 05、ch11b → 11b、case-sspll → 07b、signoff → null', () => {
    expect(chapterCodeOf('ch05')).toBe('05')
    expect(chapterCodeOf('ch11b')).toBe('11b')
    expect(chapterCodeOf('case-sspll')).toBe('07b')
    expect(chapterCodeOf('signoff')).toBeNull()
    expect(chapterCodeOf('ch11bb')).toBeNull()
  })

  it('ch11 → ch11b（延伸章，ChRef 的章編號 11b）；ch11b → ch12', () => {
    const r1 = render(
      <MemoryRouter>
        <ChapterHandoff next={CHAPTER_FRAME_META.ch11.next} />
      </MemoryRouter>,
    )
    const box = screen.getByRole('complementary', { name: '下一章要解決什麼' })
    expect(box.getAttribute('data-next')).toBe('ch11b')
    const a = box.querySelector('a.c-chref') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/ch/11b')
    expect(a.getAttribute('data-chref')).toBe('11b')
    expect(a.textContent).toBe('11b DTC INL 校正：分段／LUT／多項式')
    r1.unmount()
    const r2 = render(
      <MemoryRouter>
        <ChapterHandoff next={CHAPTER_FRAME_META.ch11b.next} />
      </MemoryRouter>,
    )
    expect(r2.container.querySelector('a.c-chref')!.getAttribute('href')).toBe('/ch/12')
  })

  it('下一章是章節：ChRef 連到該章（側欄的名字當連結文字）＋一句 hook（$…$ 以 KaTeX 顯示）', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/ch/05']}>
        <ChapterHandoff next={CHAPTER_FRAME_META.ch05.next} />
      </MemoryRouter>,
    )
    const box = screen.getByRole('complementary', { name: '下一章要解決什麼' })
    expect(box.getAttribute('data-next')).toBe('ch06')
    const a = box.querySelector('a.c-chref') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/ch/06')
    expect(a.getAttribute('data-chref')).toBe('06')
    expect(a.textContent).toBe('06 PLL Error Transfer & Polarity')
    expect(box.querySelector('.katex')).not.toBeNull() // $90^\circ$
    expect(box.textContent).not.toContain('$')
    expect(container.querySelector('a[href^="#"]')).toBeNull()
  })

  it('ch07 → 07b 案例頁；ch14 → sign-off 頁（不是章節：一般頁面連結、標題換成「接下來要做什麼」）', () => {
    const r1 = render(
      <MemoryRouter>
        <ChapterHandoff next={CHAPTER_FRAME_META.ch07.next} />
      </MemoryRouter>,
    )
    expect(r1.container.querySelector('a.c-chref')!.getAttribute('href')).toBe('/case/sspll')
    r1.unmount()
    const r2 = render(
      <MemoryRouter>
        <ChapterHandoff next={CHAPTER_FRAME_META.ch14.next} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('complementary', { name: '接下來要做什麼' })).toBeTruthy()
    const a = r2.container.querySelector('a.c-chref') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/signoff')
    expect(a.textContent).toBe('Sign-off Checklist')
  })

  it('在 <Router> 之外退回 <a href="#/signoff">；不存在的頁面不畫', () => {
    const { container } = render(<ChapterHandoff next={{ page: 'signoff', hook: 'x' }} />)
    expect(container.querySelector('a')!.getAttribute('href')).toBe('#/signoff')
    const none = render(<ChapterHandoff next={{ page: 'nope', hook: 'x' }} />)
    expect(none.container.querySelector('.c-handoff')).toBeNull()
  })
})
