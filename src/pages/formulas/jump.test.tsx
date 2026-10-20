import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import { anchorIdOf, jumpToFormula, openAncestors, removeToast, showToast, waitForAnchor } from './jump'
import { Collapsible, ErrataList, erratumHref, ErratumTag, FormulaLink, FormulaLinks, Gate, MatchCount, NoMatch, PageLink, PageLinks, Rich, scrollToId, shortPageLabel, useMode } from './common'
import { ALL_FORMULAS } from './registry'

/**
 * jump.ts（跨頁跳到 #formula-<id>）與 common.tsx 小元件的 jsdom 測試。
 * jsdom 沒有版面：getBoundingClientRect 都是 0；這裡驗證的是流程（找到錨點、展開 <details>、逾時提示、取消）。
 */

const toast = () => document.getElementById('fr-jump-toast')

const realScrollTo = window.scrollTo

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  // jsdom 的 window.scrollTo 只會印出「Not implemented」；換成空函式讓輸出乾淨（個別測試會再換成記錄用的版本）
  window.scrollTo = (() => undefined) as typeof window.scrollTo
})
afterEach(() => {
  removeToast()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  window.scrollTo = realScrollTo
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('jump：等待錨點出現後捲過去', () => {
  it('anchorIdOf：F-12.9 → formula-F-12.9（與 TexBlock 的 id 相同）', () => {
    expect(anchorIdOf('F-12.9')).toBe('formula-F-12.9')
  })

  it('錨點稍後才出現（lazy chunk）：輪詢到之後展開祖先 <details>、短暫標示，約 2.6 s 後還原', () => {
    const scrolls: number[] = []
    const orig = window.scrollTo
    window.scrollTo = ((arg: ScrollToOptions) => {
      scrolls.push(arg.top ?? -1)
    }) as typeof window.scrollTo
    try {
      jumpToFormula('F-12.9')
      vi.advanceTimersByTime(250) // 還沒出現
      expect(toast()).toBeNull()
      document.body.innerHTML = '<details id="outer"><summary>推導</summary><details id="inner"><figure id="formula-F-12.9">x</figure></details></details>'
      vi.advanceTimersByTime(150)
      const el = document.getElementById('formula-F-12.9') as HTMLElement
      expect((document.getElementById('outer') as HTMLDetailsElement).open).toBe(true)
      expect((document.getElementById('inner') as HTMLDetailsElement).open).toBe(true)
      expect(el.getAttribute('data-jump-target')).toBe('true')
      expect(el.style.outline).toContain('3px')
      expect(scrolls.length).toBeGreaterThanOrEqual(1)
      vi.advanceTimersByTime(3000)
      expect(el.hasAttribute('data-jump-target')).toBe(false)
      expect(el.style.outline).toBe('')
      expect(toast()).toBeNull()
    } finally {
      window.scrollTo = orig
    }
  })

  it('反面：逾時仍找不到 → 顯示說明原因的提示；非 Research 模式可一鍵切換並重試', () => {
    const switched = vi.fn()
    waitForAnchor('formula-F-99.9', 'F-99.9', { timeoutMs: 1000, intervalMs: 100, onSwitchMode: switched, isResearch: false })
    vi.advanceTimersByTime(1300)
    const t = toast()
    expect(t).toBeTruthy()
    expect(t!.textContent).toMatch(/找不到公式 F-99\.9 的錨點/)
    expect(t!.textContent).toMatch(/只在 Research 模式顯示|尚未展開|尚未完成/)
    const buttons = Array.from(t!.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toEqual(['切換到 Research 模式並重試', '關閉'])
    // 按下切換：呼叫 onSwitchMode 並重新等待；這次錨點出現了
    fireEvent.click(t!.querySelector('button') as HTMLButtonElement)
    expect(switched).toHaveBeenCalledTimes(1)
    expect(toast()).toBeNull()
    document.body.insertAdjacentHTML('beforeend', '<figure id="formula-F-99.9">y</figure>')
    vi.advanceTimersByTime(200)
    expect(document.getElementById('formula-F-99.9')?.getAttribute('data-jump-target')).toBe('true')
  })

  it('已經是 Research 模式時只給「關閉」；提示會自動消失', () => {
    waitForAnchor('formula-F-98.1', 'F-98.1', { timeoutMs: 500, intervalMs: 100, isResearch: true, onSwitchMode: () => undefined })
    vi.advanceTimersByTime(800)
    expect(Array.from(toast()!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['關閉'])
    vi.advanceTimersByTime(10_000)
    expect(toast()).toBeNull()
  })

  it('新的跳轉會取消舊的；回傳的函式可手動取消（不再顯示提示）', () => {
    waitForAnchor('formula-A', 'A', { timeoutMs: 500, intervalMs: 100 })
    const cancel = waitForAnchor('formula-B', 'B', { timeoutMs: 500, intervalMs: 100 })
    cancel()
    vi.advanceTimersByTime(2000)
    expect(toast()).toBeNull()
  })

  it('openAncestors：只展開尚未展開的祖先並回傳數量；showToast 的按鈕會先關閉提示再執行動作', () => {
    document.body.innerHTML = '<details open><details><div><span id="t">x</span></div></details></details>'
    expect(openAncestors(document.getElementById('t')!)).toBe(1)
    expect(openAncestors(document.getElementById('t')!)).toBe(0)
    const act = vi.fn()
    showToast('訊息', [{ label: '動作', onClick: act }])
    expect(toast()!.getAttribute('role')).toBe('status')
    fireEvent.click(toast()!.querySelector('button') as HTMLButtonElement)
    expect(act).toHaveBeenCalledTimes(1)
    expect(toast()).toBeNull()
  })
})

describe('common：小元件', () => {
  function ModeProbe() {
    const { mode, atLeast } = useMode()
    return <span data-testid="mode">{`${mode}:${atLeast('engineer')}:${atLeast('research')}`}</span>
  }

  it('Rich：$TeX$ 變成 KaTeX、其餘原樣；ErratumTag／ErrataList 連到驗證頁深連結並依嚴重度上色', () => {
    const { container } = render(
      <div>
        <p id="rich">
          <Rich text={String.raw`單位是 $\mathrm{fs}^{-1}$，$g=\mu K$ 無因次`} />
        </p>
        <ErratumTag eid="E01" />
        <ErrataList ids={['E13', 'E18']} />
        <span id="empty">
          <ErrataList ids={[]} />
        </span>
        <ErratumTag eid="E99" />
      </div>,
    )
    const rich = container.querySelector('#rich')!
    expect(rich.querySelectorAll('.katex').length).toBe(2)
    expect(rich.textContent).toContain('單位是')
    expect(rich.textContent).not.toContain('$')
    expect(erratumHref('E13')).toBe('#/verification?e=E13')
    const tags = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.fr-erratum'))
    expect(tags.map((a) => a.getAttribute('href'))).toEqual(['#/verification?e=E01', '#/verification?e=E13', '#/verification?e=E18', '#/verification?e=E99'])
    expect(tags[0].className).toContain('fr-sev-high')
    expect(tags[0].title).toMatch(/^E01｜/)
    expect(tags[3].className).toContain('fr-sev-unknown')
    expect(tags[3].title).toMatch(/找不到此勘誤/)
    expect(container.querySelector('#empty')!.textContent).toBe('—')
  })

  it('PageLink／FormulaLink：存在的 id 產生連結，不存在的明確標示；shortPageLabel 把 ch12 變 Ch12', () => {
    const f = ALL_FORMULAS[0]
    const { container } = render(
      <MemoryRouter>
        <PageLink id="ch12" />
        <PageLinks ids={['ch05', 'signoff', 'nope']} />
        <FormulaLink id={f.id} />
        <FormulaLinks ids={['F-99.9']} />
        <span id="none">
          <FormulaLinks ids={[]} />
        </span>
      </MemoryRouter>,
    )
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.fr-page-link'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/ch/12', '/ch/05', '/signoff'])
    expect(links[0].textContent).toMatch(/^12 /)
    expect(links[1].textContent).toBe('Ch05')
    expect(links[2].textContent).toBe('Sign-off')
    expect(container.querySelectorAll('.fr-missing').length).toBe(2)
    expect(container.textContent).toContain('F-99.9（不存在）')
    const fl = container.querySelector('a.fr-formula-link') as HTMLAnchorElement
    expect(fl.getAttribute('href')).toBe(`#${f.page}`)
    expect(fl.title).toContain(f.title)
    expect(container.querySelector('#none')!.textContent).toBe('—')
    expect(shortPageLabel('ch03', 'x')).toBe('Ch03')
    expect(shortPageLabel('models', 'Behavioral Models & RTL')).toBe('Models')
    expect(shortPageLabel('unknown', 'Fallback')).toBe('Fallback')
  })

  it('useMode／Gate／Collapsible：沒有 SettingsProvider 時當作 Engineer；Beginner 預設收合、其他模式預設展開', () => {
    const bare = render(
      <div>
        <ModeProbe />
        <Gate min="engineer">
          <i id="eng" />
        </Gate>
        <Gate min="research">
          <i id="res" />
        </Gate>
        <Collapsible title="推導">內容</Collapsible>
      </div>,
    )
    expect(bare.getByTestId('mode').textContent).toBe('engineer:true:false')
    expect(bare.container.querySelector('#eng')).toBeTruthy()
    expect(bare.container.querySelector('#res')).toBeNull()
    expect((bare.container.querySelector('details') as HTMLDetailsElement).open).toBe(true)
    bare.unmount()

    localStorage.setItem('lmspll.mode', 'beginner')
    const beg = render(
      <SettingsProvider>
        <ModeProbe />
        <Collapsible title="推導">內容</Collapsible>
        <Collapsible title="例子" beginnerOpen>
          內容
        </Collapsible>
      </SettingsProvider>,
    )
    expect(beg.getByTestId('mode').textContent).toBe('beginner:false:false')
    const ds = beg.container.querySelectorAll('details')
    expect(ds[0].open).toBe(false)
    expect(ds[1].open).toBe(true)
  })

  it('MatchCount／NoMatch／scrollToId', () => {
    const { container } = render(
      <div>
        <span id="a">
          <MatchCount shown={3} total={10} active={false} />
        </span>
        <span id="b">
          <MatchCount shown={3} total={10} active />
        </span>
        <span id="c">
          <MatchCount shown={0} total={10} active />
        </span>
        <NoMatch what="符號" />
        <div id="target">x</div>
      </div>,
    )
    expect(container.querySelector('#a')!.textContent).toBe('10 項')
    expect(container.querySelector('#b')!.textContent).toBe('符合 3 / 10')
    expect(container.querySelector('#c .fr-count-zero')).toBeTruthy()
    expect(container.querySelector('.fr-nomatch')!.textContent).toMatch(/沒有符合的符號/)
    // 共用的 scrollToElement：瞬間捲動（scrollIntoView）、把搜尋列高度寫進 scroll-margin-top、聚焦目標
    const target = container.querySelector<HTMLElement>('#target')!
    const calls: ScrollIntoViewOptions[] = []
    target.scrollIntoView = ((arg: ScrollIntoViewOptions) => {
      calls.push(arg)
    }) as typeof target.scrollIntoView
    expect(scrollToId('target')).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0].behavior).toBe('auto')
    expect(target.style.scrollMarginTop).toMatch(/^\d+(\.\d+)?px$/)
    expect(scrollToId('missing')).toBe(false)
  })
})
