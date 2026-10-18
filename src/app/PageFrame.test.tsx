import { Suspense, lazy, type ComponentType } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PageFrame } from './PageFrame'
import type { PageEntry, PageGroup } from './registry'
import { MODE_HINT, SettingsProvider, type LearningMode } from './settings'

const page = lazy(() => Promise.resolve({ default: () => <p>頁面內容</p> }))
const entry = (id: string, group: PageGroup, component: PageEntry['component'] = page): PageEntry => ({ id, path: `/${id}`, nav: id, title: `${id} 的標題`, group, component })

/** 三節的章節（本頁目錄要出現）；每次 render 計數，用來驗證外框的 state 變了不會把章節重畫 */
let longPageRenders = 0
const LongPage: ComponentType = () => {
  longPageRenders++
  return (
    <div>
      <p>頁面內容</p>
      <h2 id="s1">第一節</h2>
      <section id="s2">
        <h2>第二節</h2>
      </section>
      <h2>第三節</h2>
      <section className="c-exp" id="exp-x" />
    </div>
  )
}
const longPage = lazy(() => Promise.resolve({ default: LongPage }))

function renderFrame(e: PageEntry, mode?: LearningMode) {
  if (mode) localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter>
        <Suspense fallback={<div className="page-loading">載入中…</div>}>
          <PageFrame entry={e} />
        </Suspense>
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const hint = () => document.querySelector('.c-mode-hint')

beforeEach(() => {
  window.scrollTo = vi.fn()
  longPageRenders = 0
})
afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', window.location.pathname)
})

describe('PageFrame：本頁目錄（PageOutline）', () => {
  it('三節以上的頁面：article 標成 data-outline="dock"（jsdom 沒有 matchMedia → 窄螢幕版）、右下角有「目錄」鈕，抽屜列出三節與「實驗（1）」；章節本體只 render 一次', async () => {
    // data-outline 的變化全部記下來：只能有一次（掛上去就是 dock），不能掃完之後才改（寬螢幕那就是內容欄先置中再往左跳）
    const changes: (string | null)[] = []
    const mo = new MutationObserver((recs) => {
      for (const r of recs) changes.push((r.target as Element).getAttribute('data-outline'))
    })
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-outline'] })
    renderFrame(entry('ch05', 'B', longPage), 'engineer')
    await screen.findByText('頁面內容')
    const btn = await screen.findByRole('button', { name: '目錄' })
    const article = document.querySelector('article.page')!
    await waitFor(() => expect(article.getAttribute('data-outline')).toBe('dock'))
    await new Promise((r) => setTimeout(r, 20))
    mo.disconnect()
    // 只設定過一次（目錄掛上去時的 layout effect，和章節同一次同步處理），之後沒有拿掉或改過：不能是「先沒有、掃完才加上」的兩段式
    expect(changes).toEqual(['dock'])
    // 目錄排在標題之後、模式提示之前
    const h1 = document.querySelector('h1')!
    expect(h1.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(btn.compareDocumentPosition(hint()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(btn)
    const sheet = screen.getByRole('dialog', { name: /^本頁目錄/ })
    expect(Array.from(sheet.querySelectorAll('.c-outline-list a')).map((a) => decodeURIComponent(a.getAttribute('href')!))).toEqual(['#/?a=s1', '#/?a=s2', '#/?a=h-第三節'])
    expect(screen.getByRole('button', { name: '實驗（1）' })).toBeTruthy()
    // 目錄的版面寫進外框的 state 時章節沒有重畫（memo）
    expect(longPageRenders).toBe(1)
  })

  it('只有一段內容（沒有三個 h2）的頁面：沒有目錄鈕、article 沒有 data-outline', async () => {
    renderFrame(entry('papers', 'tools'), 'engineer')
    await screen.findByText('頁面內容')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: '目錄' })).toBeNull()
    expect(document.querySelector('article.page')!.hasAttribute('data-outline')).toBe(false)
  })
})

describe('PageFrame：章節頁的模式提示', () => {
  it.each(['beginner', 'engineer', 'research'] as const)('%s 模式：章節頁 h1 下方一行提示（依模式換字），h1 可被程式聚焦', async (mode) => {
    renderFrame(entry('ch05', 'B'), mode)
    await screen.findByText('頁面內容')
    expect(hint()?.textContent).toBe(MODE_HINT[mode])
    expect(hint()?.getAttribute('data-mode')).toBe(mode)
    const h1 = document.querySelector('h1') as HTMLElement
    expect(h1.textContent).toBe('ch05 的標題')
    expect(h1.getAttribute('tabindex')).toBe('-1')
    // 提示在標題之後、內容之前
    expect(h1.compareDocumentPosition(hint()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hint()!.compareDocumentPosition(screen.getByText('頁面內容')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('mode-picker')).toBeNull()
  })

  it('Part A / B / C（含 07b 案例）顯示提示；Part D、工具頁、Dashboard 不顯示', async () => {
    for (const [id, group, expected] of [
      ['ch00', 'A', true],
      ['case-sspll', 'B', true],
      ['ch13', 'C', true],
      ['models', 'D', false],
      ['workbook', 'tools', false],
      ['dashboard', 'start', false],
    ] as const) {
      const r = renderFrame(entry(id, group), 'beginner')
      await screen.findByText('頁面內容')
      expect(hint() !== null, `${id} (${group})`).toBe(expected)
      r.unmount()
    }
  })

  it('沒有存過模式：頁首先出現模式選擇器、提示先不顯示；選了 Engineer 後選擇器消失、提示換成 Engineer 的字', async () => {
    renderFrame(entry('ch05', 'B'))
    await screen.findByText('頁面內容')
    const picker = screen.getByTestId('mode-picker')
    const article = document.querySelector('article.page') as HTMLElement
    expect(article.firstElementChild).toBe(picker)
    expect(hint()).toBeNull()
    fireEvent.click(picker.querySelector('button[data-mode="engineer"]')!)
    expect(screen.queryByTestId('mode-picker')).toBeNull()
    expect(hint()?.textContent).toBe(MODE_HINT.engineer)
    expect(localStorage.getItem('lmspll.mode')).toBe('engineer')
  })
})
