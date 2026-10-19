import { fireEvent, within } from '@testing-library/react'
import { BACKBONE, LAST_VISIT_KEY, backboneHref, backboneStepId, backboneTotalMinutes, formatMinutes } from '@/app/backbone'
import { chapterFrameMeta } from '@/app/chapterMeta'
import { MODES } from '@/app/settings'
import { renderPage } from './indexTestUtils'
import { BACKBONE_WINDOW, backboneWindow } from './sections/Backbone'

/**
 * 首頁 Beginner 模式的「骨幹路線」卡（sections/Backbone.tsx）：取代 Hero 右側的「從這裡開始」，
 * 列出 src/app/backbone.ts 的每一步（分鐘數、完成勾選、本章思考題進度）與「從上次離開的地方繼續」；
 * 章節卡片／章節表顯示三種模式的閱讀時間。Beginner 的首頁很輕（收起來的內容不進 DOM），所以可以多渲染幾次。
 */
vi.mock('plotly.js-cartesian-dist-min', async () => (await import('@/test/mocks/plotly')).plotlyModule())
vi.mock('mermaid', async () => (await import('@/test/mocks/mermaid')).mermaidModule())

vi.setConfig({ testTimeout: 60_000 })

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

const stepRows = (root: Element) => Array.from(root.querySelectorAll('ol.dash-bb-steps > li.dash-bb-step')) as HTMLElement[]
const visibleSteps = (root: Element) => stepRows(root).filter((li) => !li.hidden).map((li) => li.getAttribute('data-step'))
const doneStored = (): string[] => JSON.parse(localStorage.getItem('lmspll.dashboard.done') ?? '[]') as string[]

describe('DashboardPage Beginner：骨幹路線卡', () => {
  it('首屏：Hero 右側是骨幹路線卡（取代「從這裡開始」）——每一步的章節範圍、一句話、分鐘數、連結與勾選；總時間與進度', () => {
    const { container } = renderPage('beginner')
    const hero = container.querySelector('.dash-hero') as HTMLElement
    const card = hero.querySelector('#dash-backbone') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.classList.contains('dash-start')).toBe(true)
    expect(hero.querySelector('#dash-start-title')).toBeNull()
    expect(card.querySelector('h2')?.textContent).toBe(`最短路徑：${BACKBONE.length} 步，${formatMinutes(backboneTotalMinutes())}`)
    expect(backboneTotalMinutes()).toBeLessThanOrEqual(360)
    const rows = stepRows(card)
    expect(rows).toHaveLength(BACKBONE.length)
    rows.forEach((li, i) => {
      const s = BACKBONE[i]
      expect(li.getAttribute('data-step')).toBe(backboneStepId(s))
      const box = li.querySelector('input.dash-bb-check') as HTMLInputElement
      expect(box.checked).toBe(false)
      expect(box.getAttribute('aria-label')).toContain(`第 ${i + 1} 步`)
      expect(box.getAttribute('aria-label')).not.toContain('$')
      const link = li.querySelector('a.dash-bb-link') as HTMLAnchorElement
      expect(link.getAttribute('href')).toBe(backboneHref(s))
      expect(link.textContent).toContain(`第 ${i + 1} 步`)
      expect(link.textContent).toContain(s.sections)
      expect(li.querySelector('.dash-bb-min')?.textContent).toBe(`${s.minutes} 分`)
      if (s.experiments.length > 0) expect(li.textContent).toContain(`互動實驗 ${s.experiments.length} 個`)
      // 一句話裡的數學用 KaTeX
      if (s.title.includes('$')) expect(li.querySelector('.dash-bb-title .katex')).not.toBeNull()
    })
    // 進度與「開始第 1 步」
    expect(card.querySelector('.dash-bb-progress')?.textContent).toContain(`已完成 0/${BACKBONE.length} 步`)
    const cta = card.querySelector('a.dash-bb-resume') as HTMLAnchorElement
    expect(cta.getAttribute('data-resume')).toBe('start')
    expect(cta.getAttribute('href')).toBe('/ch/00')
    expect(cta.textContent).toContain('開始第 1 步')
  })

  it('預設只露出 4 步（上一步完成的、下一步與之後兩步），其餘 li 帶 hidden；「顯示全部 12 步」才全列；勾選後視窗跟著下一步移動', () => {
    expect(BACKBONE_WINDOW).toBe(4)
    expect(backboneWindow(0, 12)).toEqual([0, 4])
    expect(backboneWindow(1, 12)).toEqual([0, 4])
    expect(backboneWindow(5, 12)).toEqual([4, 8])
    expect(backboneWindow(11, 12)).toEqual([8, 12])
    expect(backboneWindow(-1, 12)).toEqual([0, 12])
    const { container } = renderPage('beginner')
    const card = container.querySelector('#dash-backbone') as HTMLElement
    expect(stepRows(card)).toHaveLength(BACKBONE.length)
    expect(visibleSteps(card)).toEqual(BACKBONE.slice(0, 4).map(backboneStepId))
    const btn = within(card).getByRole('button', { name: `顯示全部 ${BACKBONE.length} 步` })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(visibleSteps(card)).toHaveLength(BACKBONE.length)
    expect(within(card).getByRole('button', { name: '只看接下來的 4 步' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(card).getByRole('button', { name: '只看接下來的 4 步' }))
    expect(visibleSteps(card)).toHaveLength(4)
    // 完成第 1、2 步：下一步是第 3 步，視窗 = 第 2–5 步
    fireEvent.click(stepRows(card)[0].querySelector('input') as HTMLInputElement)
    fireEvent.click(stepRows(card)[1].querySelector('input') as HTMLInputElement)
    expect(visibleSteps(card)).toEqual(BACKBONE.slice(1, 5).map(backboneStepId))
  })

  it('勾選：整章的步驟和章節表的「已讀」同一格，段落級的步驟存成 page#anchor；進度條、「繼續」與路線進度跟著更新', () => {
    const { container } = renderPage('beginner')
    const card = container.querySelector('#dash-backbone') as HTMLElement
    const rows = stepRows(card)
    // 第 1 步（Ch00 整章）
    fireEvent.click(rows[0].querySelector('input') as HTMLInputElement)
    expect(doneStored()).toEqual(['ch00'])
    expect(rows[0].classList.contains('is-done')).toBe(true)
    expect((container.querySelector('#dash-chapters input[aria-label="標記「00 入門：LMS 是什麼、為什麼重要」為已讀"]') as HTMLInputElement).checked).toBe(true)
    expect(card.querySelector('.dash-bb-progress')?.textContent).toContain(`已完成 1/${BACKBONE.length} 步`)
    expect(card.querySelector('.dash-bb-progress')?.textContent).toContain(`還需 ${formatMinutes(backboneTotalMinutes() - BACKBONE[0].minutes)}`)
    const cta = card.querySelector('a.dash-bb-resume') as HTMLAnchorElement
    expect(cta.getAttribute('data-resume')).toBe('next')
    expect(cta.getAttribute('href')).toBe(backboneHref(BACKBONE[1]))
    expect(cta.textContent).toContain('繼續第 2 步')
    // 數學路線的進度（Ch00 是第一步）也更新
    expect((container.querySelector('.dash-route') as HTMLElement).textContent).toMatch(/已讀 1\//)
    // 第 3 步（Ch01 §1.4–§1.5，有 anchor）：存成 page#anchor，不等於章節表的 ch01
    const seg = BACKBONE.findIndex((s) => !!s.anchor)
    fireEvent.click(rows[seg].querySelector('input') as HTMLInputElement)
    expect(doneStored()).toEqual(['ch00', backboneStepId(BACKBONE[seg])])
    expect(backboneStepId(BACKBONE[seg])).toContain('#')
    expect((container.querySelector('#dash-chapters input[aria-label="標記「01 LMS 起源與 MSE / MAE」為已讀"]') as HTMLInputElement).checked).toBe(false)
    // 再按一次取消
    fireEvent.click(rows[seg].querySelector('input') as HTMLInputElement)
    expect(doneStored()).toEqual(['ch00'])
    // 章節表的「清除已讀紀錄」也清掉路線的勾選
    fireEvent.click(within(container.querySelector('#dash-chapters') as HTMLElement).getByRole('button', { name: '清除已讀紀錄' }))
    expect(doneStored()).toEqual([])
    expect(stepRows(card).every((li) => !li.classList.contains('is-done'))).toBe(true)
  })

  it('從上次離開的地方繼續：lmspll.lastVisited 指到路線上還沒完成的那一步（帶錨點）；按任何一步的連結會記下最後造訪', () => {
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ page: 'ch02', anchor: 'ch02-s3', at: 1 }))
    const a = renderPage('beginner')
    const cta = a.container.querySelector('#dash-backbone a.dash-bb-resume') as HTMLAnchorElement
    expect(cta.getAttribute('data-resume')).toBe('last-visit')
    expect(cta.getAttribute('href')).toBe('/ch/02?a=ch02-s3')
    const k = BACKBONE.findIndex((s) => s.page === 'ch02' && s.anchor === 'ch02-s3')
    expect(cta.textContent).toContain(`第 ${k + 1} 步`)
    expect(cta.textContent).toContain('從上次離開的地方繼續')
    // 那一步完成了：退回下一個沒完成的（第 1 步）
    fireEvent.click(stepRows(a.container)[k].querySelector('input') as HTMLInputElement)
    expect((a.container.querySelector('#dash-backbone a.dash-bb-resume') as HTMLAnchorElement).getAttribute('data-resume')).toBe('next')
    a.unmount()
    localStorage.clear()
    // 按第 2 步的連結 → 記下 lmspll.lastVisited
    const b = renderPage('beginner')
    fireEvent.click(stepRows(b.container)[1].querySelector('a.dash-bb-link') as HTMLAnchorElement)
    const rec = JSON.parse(localStorage.getItem(LAST_VISIT_KEY) ?? 'null') as { page: string; anchor?: string } | null
    expect(rec?.page).toBe(BACKBONE[1].page)
    expect(rec?.anchor).toBe(BACKBONE[1].anchor)
    b.unmount()
  })

  it('本章思考題進度（quizProgress）：只在該頁的最後一步顯示「本章思考題 已答/題數（答對 n）」', () => {
    localStorage.setItem('lmspll.quizset.ch00', JSON.stringify(['q1', 'q2']))
    localStorage.setItem('lmspll.quiz.ch00.q1', JSON.stringify({ picked: 0, correct: true, at: 1 }))
    localStorage.setItem('lmspll.quizset.ch01', JSON.stringify(['a']))
    localStorage.setItem('lmspll.quiz.ch01.a', JSON.stringify({ picked: null, correct: null, at: 1 }))
    const { container } = renderPage('beginner')
    const rows = stepRows(container.querySelector('#dash-backbone') as HTMLElement)
    const ch00 = rows.filter((li) => li.getAttribute('data-step')?.startsWith('ch00'))
    expect(ch00).toHaveLength(1)
    expect(ch00[0].querySelector('.dash-bb-quiz')?.textContent).toBe('本章思考題 1/2（答對 1）')
    const ch01 = rows.filter((li) => (li.getAttribute('data-step') ?? '').split('#')[0] === 'ch01')
    expect(ch01.length).toBeGreaterThanOrEqual(2)
    expect(ch01[0].querySelector('.dash-bb-quiz')).toBeNull()
    expect(ch01[ch01.length - 1].querySelector('.dash-bb-quiz')?.textContent).toBe('本章思考題 1/1')
    // 沒有紀錄的頁面不顯示
    const ch14 = rows.filter((li) => (li.getAttribute('data-step') ?? '').split('#')[0] === 'ch14')
    expect(ch14.every((li) => li.querySelector('.dash-bb-quiz') === null)).toBe(true)
  })

  it('章節表（Beginner）與章節卡片（Engineer）都列三種模式的閱讀時間，目前模式加粗；Engineer／Research 沒有骨幹卡', () => {
    const a = renderPage('beginner')
    const table = a.container.querySelector('#dash-chapters table') as HTMLElement
    expect(Array.from(table.querySelectorAll('thead th'), (th) => th.textContent)).toContain('閱讀（B／E／R）')
    const meta05 = chapterFrameMeta('ch05')!
    const row05 = (table.querySelector('a[href="/ch/05"]') as HTMLElement).closest('tr') as HTMLElement
    const rts = Array.from(row05.querySelectorAll('.dash-ch-rt-cell .dash-ch-rt'))
    expect(rts.map((x) => x.getAttribute('data-mode'))).toEqual([...MODES])
    expect(rts.map((x) => x.textContent)).toEqual(MODES.map((m) => `${m.slice(0, 1).toUpperCase()} ${meta05.readingMinutes[m]}`))
    expect(rts.find((x) => x.classList.contains('is-current'))?.getAttribute('data-mode')).toBe('beginner')
    // 工具頁沒有 chapterMeta：那一列沒有閱讀時間
    const rowLab = (table.querySelector('a[href="/lab"]') as HTMLElement).closest('tr') as HTMLElement
    expect(rowLab.querySelector('.dash-ch-reading')).toBeNull()
    a.unmount()
    const b = renderPage('engineer')
    expect(b.container.querySelector('#dash-backbone')).toBeNull()
    expect(b.container.querySelector('#dash-start-title')).not.toBeNull()
    const card05 = b.container.querySelector('.dash-ch-card[aria-labelledby="dash-ch-ch05"]') as HTMLElement
    const crt = Array.from(card05.querySelectorAll('.dash-ch-reading .dash-ch-rt'))
    expect(crt.map((x) => x.textContent)).toEqual(['Beginner ' + meta05.readingMinutes.beginner + ' 分', 'Engineer ' + meta05.readingMinutes.engineer + ' 分', 'Research ' + meta05.readingMinutes.research + ' 分'])
    expect(crt.find((x) => x.classList.contains('is-current'))?.getAttribute('data-mode')).toBe('engineer')
    expect(card05.querySelector('.dash-ch-reading')?.getAttribute('aria-label')).toMatch(/^預估閱讀時間：Beginner \d+ 分、Engineer \d+ 分、Research \d+ 分$/)
    expect(b.container.querySelector('.dash-ch-card[aria-labelledby="dash-ch-models"] .dash-ch-reading')).toBeNull()
    b.unmount()
    const c = renderPage('research')
    expect(c.container.querySelector('#dash-backbone')).toBeNull()
    c.unmount()
  })
})
