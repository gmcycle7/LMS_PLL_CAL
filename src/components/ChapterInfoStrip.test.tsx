import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider, type LearningMode } from '@/app/settings'
import { CHAPTER_FRAME_META } from '@/app/chapterMeta'
import { pageById } from '@/app/registry'
import { ChapterInfoStrip, formatMinutes, modelsTooltip } from './ChapterInfoStrip'
import { CHAPTER_MODEL_CATALOG } from '@/app/chapterMeta'

function renderStrip(mode: LearningMode, extra: Partial<Parameters<typeof ChapterInfoStrip>[0]> = {}) {
  localStorage.setItem('lmspll.mode', mode)
  const entry = pageById('ch05')!
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={['/ch/05']}>
        <ChapterInfoStrip entry={entry} meta={CHAPTER_FRAME_META.ch05} handcalcIds={['handcalc-HC-05.1', 'handcalc-HC-05.2']} hasSymbols {...extra} />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

afterEach(() => localStorage.clear())

describe('ChapterInfoStrip：章首的本章資訊', () => {
  it('依序列出 規格書 §、驗證 T-id、三種模式的閱讀時間（目前模式加粗）、勘誤、手算、符號表；連結都是真的路由（沒有 href="#id"）', () => {
    const { container } = renderStrip('engineer')
    const nav = screen.getByRole('navigation', { name: '本章資訊' })
    const items = Array.from(nav.querySelectorAll('.c-chinfo-item')).map((li) => li.getAttribute('data-item'))
    expect(items).toEqual(['spec', 'tests', 'models', 'reading', 'errata', 'handcalcs', 'symbols'])
    // 本章的「精確」是在：chapterMeta 的 models（ch05 = L1），tooltip 列每個模型的假設（純文字，沒有 $…$）
    const models = nav.querySelector('[data-item="models"]')!
    expect(models.querySelector('.c-chinfo-label')!.textContent).toBe('本章的「精確」是在')
    expect(Array.from(models.querySelectorAll('.c-chinfo-model')).map((m) => m.getAttribute('data-model'))).toEqual(CHAPTER_FRAME_META.ch05.models.map((m) => m.id))
    expect(models.querySelector('.c-chinfo-models')!.textContent).toBe(CHAPTER_FRAME_META.ch05.models.map((m) => m.label).join('、'))
    const tip = models.querySelector('.c-chinfo-models')!.getAttribute('title') ?? ''
    expect(tip).toContain('精確｜指定模型')
    for (const m of CHAPTER_FRAME_META.ch05.models) expect(tip).toContain(m.label)
    expect(tip).not.toContain('$')
    expect(nav.querySelector('[data-item="spec"]')!.textContent).toBe('規格書§5、§5.1')
    expect(Array.from(nav.querySelectorAll('[data-item="tests"] .c-test')).map((b) => b.textContent)).toEqual([expect.stringContaining('T04'), expect.stringContaining('T05')])
    // 閱讀時間：三個數字，目前模式（engineer）加粗並標 aria-current
    const modes = Array.from(nav.querySelectorAll('.c-chinfo-mode'))
    expect(modes.map((m) => m.getAttribute('data-mode'))).toEqual(['beginner', 'engineer', 'research'])
    const rm = CHAPTER_FRAME_META.ch05.readingMinutes
    expect(modes.map((m) => m.textContent)).toEqual([`Beginner ${formatMinutes(rm.beginner)}`, `Engineer ${formatMinutes(rm.engineer)}`, `Research ${formatMinutes(rm.research)}`])
    expect(modes.filter((m) => m.classList.contains('is-current')).map((m) => m.getAttribute('data-mode'))).toEqual(['engineer'])
    expect(modes[1].getAttribute('aria-current')).toBe('true')
    // 勘誤：連到驗證頁的勘誤瀏覽器（深連結到本章第一條）
    const errata = nav.querySelector('[data-item="errata"] a') as HTMLAnchorElement
    expect(errata.textContent).toBe('勘誤 2 項')
    expect(errata.getAttribute('href')).toBe('/verification?e=E02')
    expect(errata.getAttribute('title')).toContain('E02、E18')
    // 手算：連到本頁第一題（?a=handcalc-…）
    const hc = nav.querySelector('[data-item="handcalcs"] a') as HTMLAnchorElement
    expect(hc.textContent).toBe('手算 2 題')
    expect(hc.getAttribute('href')).toBe('#/ch/05?a=handcalc-HC-05.1')
    // 符號表：連到 #symbols（?a=symbols）
    const sym = nav.querySelector('[data-item="symbols"] a') as HTMLAnchorElement
    expect(sym.textContent).toBe('符號表 ↓')
    expect(sym.getAttribute('href')).toBe('#/ch/05?a=symbols')
    expect(container.querySelector('a[href^="#symbols"], a[href^="#handcalc"]')).toBeNull()
    // 純文字的無障礙名稱裡沒有 $…$
    for (const el of Array.from(container.querySelectorAll('[aria-label], [title]'))) {
      expect(el.getAttribute('aria-label') ?? '').not.toContain('$')
      expect(el.getAttribute('title') ?? '').not.toContain('$')
    }
  })

  it('formatMinutes：60 分以上換成小時', () => {
    expect(formatMinutes(5)).toBe('5 分')
    expect(formatMinutes(55)).toBe('55 分')
    expect(formatMinutes(60)).toBe('1 小時')
    expect(formatMinutes(305)).toBe('5 小時 5 分')
  })

  it.each(['beginner', 'research'] as const)('%s 模式：加粗的是目前的模式', (mode) => {
    const { container } = renderStrip(mode)
    expect(Array.from(container.querySelectorAll('.c-chinfo-mode.is-current')).map((m) => m.getAttribute('data-mode'))).toEqual([mode])
  })

  it('沒有手算題、沒有 #symbols、沒有勘誤時不列那幾項（不會出現「手算 0 題」）', () => {
    const { container } = renderStrip('beginner', { handcalcIds: [], hasSymbols: false, meta: { ...CHAPTER_FRAME_META.ch05, errata: [] } })
    const items = Array.from(container.querySelectorAll('.c-chinfo-item')).map((li) => li.getAttribute('data-item'))
    expect(items).toEqual(['spec', 'tests', 'models', 'reading'])
    // models 也可以是空的（工具頁沒有章節骨架時）：不列那一項
    const none = renderStrip('beginner', { handcalcIds: [], hasSymbols: false, meta: { ...CHAPTER_FRAME_META.ch05, errata: [], models: [] } })
    expect(Array.from(none.container.querySelectorAll('.c-chinfo-item')).map((li) => li.getAttribute('data-item'))).toEqual(['spec', 'tests', 'reading'])
    expect(container.textContent).not.toContain('手算 0')
  })

  it('modelsTooltip：每個模型「label：assumes」以「；」相連，$…$ 轉成可念的文字（accessibleText）', () => {
    const tip = modelsTooltip([CHAPTER_MODEL_CATALOG.L2, CHAPTER_MODEL_CATALOG['frozen-weight']])
    expect(tip.startsWith('ClaimTag「精確｜指定模型」指的模型與假設——')).toBe(true)
    expect(tip).toContain('線性小訊號 PLL（L2）：')
    expect(tip).toContain('；凍結權重（frozen weight）：')
    expect(tip).not.toMatch(/[$\\{}^_]/)
  })
})
