import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 工具頁（verification／workbook／papers／roadmap／gallery／models／formulas／dashboard／signoff）的共用層約定
 * （docs/dev-conventions.md §2.2）。原始碼掃描，不渲染：
 *   - 每個 <ModeGate> 都有 summary（Beginner 看到的佔位說明收起來的是什麼）
 *   - 頁面不再自己寫 scrollToId／Diagram 外框（用 revealAnchor、ChapterFig）
 *   - 頁面專屬的 pill class 只剩版面（顏色與尺寸來自 Badge）
 */
const PAGES = ['verification', 'workbook', 'papers', 'roadmap', 'gallery', 'models', 'formulas', 'dashboard', 'signoff'] as const
const ROOT = resolve(process.cwd(), 'src/pages')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = PAGES.flatMap((p) => walk(join(ROOT, p)))
const isTest = (f: string) => /\.test\.tsx?$/.test(f)
const sources = files.filter((f) => /\.tsx?$/.test(f) && !isTest(f)).map((f) => ({ f: f.slice(ROOT.length + 1), s: readFileSync(f, 'utf8') }))
const styles = files.filter((f) => f.endsWith('.css')).map((f) => ({ f: f.slice(ROOT.length + 1), s: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') })) // 註解拿掉再掃

describe('工具頁的共用層約定', () => {
  it('每個 <ModeGate> 都有 summary（一句話說明收起來的是什麼）', () => {
    const bad: string[] = []
    let total = 0
    for (const { f, s } of sources) {
      for (const m of s.matchAll(/<ModeGate\b([^>]*)>/g)) {
        total++
        if (!/\bsummary=/.test(m[1])) bad.push(`${f}：${m[0].slice(0, 60)}`)
      }
    }
    expect(total).toBeGreaterThan(60)
    expect(bad).toEqual([])
  })

  it('頁面不再自己寫 scrollToId 的捲動（一律 revealAnchor；formulas 的 scrollToId 只補 sticky 搜尋列的邊距）', () => {
    const own = sources.filter(({ s }) => /\b(function|const) scrollToId\b/.test(s)).map(({ f }) => f)
    expect(own).toEqual(['formulas/common.tsx'])
    const smooth = sources.filter(({ f, s }) => f !== 'formulas/sections/RegistrySection.tsx' && /scrollIntoView\??\.?\(\{[^}]*smooth/.test(s)).map(({ f }) => f)
    expect(smooth).toEqual([])
  })

  it('方塊圖外框是共用的 ChapterFig：頁面的 Diagram 不再自己包 <Mermaid>＋導讀 div', () => {
    const offenders = sources
      .filter(({ s }) => /export function (Diagram|DiagramWalk)\b/.test(s))
      .filter(({ s }) => !/<ChapterFig\b/.test(s) || /-diagram-walk"/.test(s))
      .map(({ f }) => f)
    expect(offenders).toEqual([])
    // 導讀的 class 統一是 c-chapter-fig-walk；各頁的 xx-diagram-walk 規則不應殘留
    for (const { f, s } of styles) expect(s, f).not.toMatch(/-diagram-walk\b/)
  })

  it('頁面專屬的 pill class 只剩版面：不再定義圓角與底色（來自 Badge）', () => {
    const PILLS = ['ver-chip', 'wb-chip', 'papers-chip', 'rm-cond-chip', 'rm-status', 'rm-sub', 'rm-phase-state', 'fr-chip', 'fr-badge', 'fr-count', 'dash-chip', 'dash-cond-chip', 'dash-erratum', 'gal-status', 'gal-match', 'gal-q', 'gal-erratum', 'models-status', 'models-erratum', 'papers-badge', 'wb-level', 'fr-reg-cond-label', 'fr-reg-model-label']
    const bad: string[] = []
    for (const { f, s } of styles) {
      for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim()
        if (!PILLS.some((p) => new RegExp(`\\.${p}(?![\\w-])`).test(sel))) continue
        if (/border-radius\s*:|^\s*background\s*:|\bpadding\s*:/m.test(m[2])) bad.push(`${f}：${sel}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('頁面的 texNum 都委託給共用的 texNum（components/handcalcMath），不再各自拆指數', () => {
    const own = sources.filter(({ s }) => /export function texNum\b/.test(s))
    expect(own.map(({ f }) => f).sort()).toEqual(['formulas/format.ts', 'gallery/format.ts', 'models/common.tsx', 'papers/common.tsx', 'signoff/judges.ts', 'verification/format.ts'])
    for (const { f, s } of own) expect(s, f).toMatch(/texNum as sharedTexNum/)
  })
})
