import { lazy } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PageFrame } from './PageFrame'
import type { PageEntry, PageGroup } from './registry'
import { MODE_HINT, SettingsProvider, type LearningMode } from './settings'

const page = lazy(() => Promise.resolve({ default: () => <p>頁面內容</p> }))
const entry = (id: string, group: PageGroup): PageEntry => ({ id, path: `/${id}`, nav: id, title: `${id} 的標題`, group, component: page })

function renderFrame(e: PageEntry, mode?: LearningMode) {
  if (mode) localStorage.setItem('lmspll.mode', mode)
  return render(
    <SettingsProvider>
      <MemoryRouter>
        <PageFrame entry={e} />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

const hint = () => document.querySelector('.c-mode-hint')

beforeEach(() => {
  window.scrollTo = vi.fn()
})
afterEach(() => localStorage.clear())

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
