import { GROUP_LABEL, PAGES, pageById } from '@/app/registry'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import { ALL_HANDCALCS } from '@/app/handcalcs'
import { MODE_LABEL } from '@/app/settings'
import type { HandCalcDef, PresetEntry } from '@/data/types'
import errataFile from '@/data/errata.json'
import { ALL_FORMULAS } from '@/pages/formulas/registry'
import { GLOSSARY, GLOSSARY_CATEGORY_LABEL } from '@/pages/formulas/glossary'
import { CHAPTER_META, QUESTIONS } from '@/pages/dashboard/data'
import { makeEntry, pageOfPath, type SearchEntry } from './searchCore'

/**
 * 全站搜尋的靜態索引：沒有建置步驟，直接從站上已經存在的登錄彙整，由 SearchPalette 第一次開啟時 import() 這個模組。
 *   公式    ALL_FORMULAS（src/pages/formulas/registry.ts：各章 formulas.ts 的 glob 彙整；haystack 直接沿用）
 *   章節    PAGES（src/app/registry.ts）＋ Dashboard 的一句話摘要 CHAPTER_META 與附錄 E 的 15 個問題（QUESTIONS）；
 *           目前這一頁的 h2 另由 searchCore.collectPageSections 在開面板時從 DOM 讀取
 *   preset  ALL_PRESETS（src/data/presets/*.json）
 *   勘誤    src/data/errata.json
 *   術語    GLOSSARY（src/pages/formulas/glossary.ts）
 *   手算題  ALL_HANDCALCS（各章 handcalcs.ts 的 glob 彙整）
 * 目標路由：公式 → 該章 ?f=（AnchorDeepLink 會捲到公式；章不在 registry 時退回 /formulas?f=）、
 * preset → presetHref ＋ ?a=exp-<experiment>（捲到套用了 preset 的實驗）、勘誤 → /verification?e=、手算題 → 該頁 ?a=handcalc-ID、
 * 術語 → /formulas?q=中文名（到了之後由 revealSelector 捲到那一列：公式速查頁不處理 ?a=）、頁面 → 路徑。
 * 不可以 import plotly／mermaid 或任何章節的 index.tsx：這裡只能有資料。勘誤的 haystack 收 problem 不收 correction（兩段講同一件事，省一半）。
 */

/** src/data/errata.json 的一條；只有 eid 一定有（readErrata 只檢查它），其他欄位缺了就略過 */
interface Erratum {
  eid: string
  id?: string
  severity?: string
  area?: string
  chapters?: string[]
  location?: string
  problem?: string
  correction?: string
}

const navOf = (pageId: string) => pageById(pageId)?.nav ?? pageId

/** 勘誤卡片的第二行：位置太長就截斷 */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function readErrata(file: unknown = errataFile): Erratum[] {
  const list = (file as { errata?: unknown[] } | null)?.errata
  return Array.isArray(list) ? (list.filter((e) => !!e && typeof (e as Erratum).eid === 'string') as Erratum[]) : []
}

export function formulaEntries(): SearchEntry[] {
  return ALL_FORMULAS.map((f) => {
    const page = f.pageId ? pageById(f.pageId) : undefined
    return makeEntry(
      {
        kind: 'formula',
        id: f.id,
        title: f.title,
        tex: f.tex,
        detail: [page?.nav ?? f.page, f.conditions].filter(Boolean).join(' · '),
        to: page ? `${page.path}?f=${encodeURIComponent(f.id)}` : `/formulas?f=${encodeURIComponent(f.id)}`,
      },
      [],
      f.haystack,
    )
  })
}

export function pageEntries(): SearchEntry[] {
  const pages = PAGES.map((p) => {
    const meta = CHAPTER_META[p.id]
    const label = /^\d/.test(p.nav) ? p.nav.split(' ')[0] : GROUP_LABEL[p.group].split('｜')[0]
    return makeEntry(
      { kind: 'section', id: p.id, label, title: p.nav, detail: [p.title, meta?.summary].filter(Boolean).join(' · '), to: p.path },
      [p.specSections?.map((s) => `§${s}`).join(' '), p.tests?.join(' '), GROUP_LABEL[p.group]],
    )
  })
  const questions = QUESTIONS.flatMap((q) => {
    const page = pageById(q.pages[0])
    if (!page) return []
    const others = q.pages.slice(1).map(navOf)
    return [
      makeEntry(
        {
          kind: 'section',
          id: `q${q.n}`,
          label: `問題 ${q.n}`,
          title: q.text,
          detail: [page.nav, others.length ? `另見 ${others.join('、')}` : ''].filter(Boolean).join(' · '),
          to: page.path,
        },
        [`Q${q.n}`, `問題 ${q.n}`, q.tests.join(' '), q.errata?.join(' ')],
      ),
    ]
  })
  return [...pages, ...questions]
}

/**
 * preset 的目標：presetHref（該頁 ?preset=id，實驗用 useUrlPreset 套用）再加 ?a=exp-<experiment>（<ExperimentShell id> 的 DOM id），
 * AnchorDeepLink 會等實驗畫好再捲過去——否則讀者停在頁首，看不到套用了 preset 的實驗。不處理 ?a= 的頁（公式速查頁）不理會多出來的參數。
 */
export function presetRoute(p: PresetEntry): string {
  return `${presetHref(p)}&a=${encodeURIComponent(`exp-${p.experiment}`)}`
}

export function presetEntries(): SearchEntry[] {
  return ALL_PRESETS.map((p) => {
    const page = pageOfPath(p.page)
    return makeEntry(
      { kind: 'preset', id: p.id, title: p.title, detail: [page?.nav ?? p.page, p.description].filter(Boolean).join(' · '), to: presetRoute(p) },
      [p.expected, p.experiment, p.tests?.join(' '), p.source, p.galleryIndex !== undefined && `§19.2 preset ${p.galleryIndex}`],
    )
  })
}

export function erratumEntries(file: unknown = errataFile): SearchEntry[] {
  // 欄位缺了也不要讓整份索引建不起來（readErrata 只檢查 eid）
  return readErrata(file).map((e) =>
    makeEntry(
      {
        kind: 'erratum',
        id: e.eid,
        title: [e.area, e.id].filter(Boolean).join('：') || e.eid,
        detail: [(e.chapters ?? []).map(navOf).join('、'), clip(e.location ?? '', 90)].filter(Boolean).join(' · '),
        to: `/verification?e=${encodeURIComponent(e.eid)}`,
      },
      [e.severity, e.location, e.problem, `勘誤 ${e.eid}`],
    ),
  )
}

export function termEntries(): SearchEntry[] {
  return GLOSSARY.map((g) =>
    makeEntry(
      {
        kind: 'term',
        id: g.key,
        label: g.abbr ?? '術語',
        title: `${g.zh}（${g.en}）`,
        detail: g.def,
        to: `/formulas?q=${encodeURIComponent(g.zh)}`,
        // 公式速查頁用 ?q= 過濾（每個術語的中文名都找得到自己那一列，buildIndex.test 會檢查），到了再捲到那一列
        revealSelector: `.fr-gloss-item[data-term=${JSON.stringify(g.key)}]`,
      },
      [g.abbr, g.en, GLOSSARY_CATEGORY_LABEL[g.category], g.pages.map(navOf).join(' '), g.formulas?.join(' '), g.errata?.join(' ')],
    ),
  )
}

/**
 * 手算題的目標：該頁的 ?a=handcalc-ID（<HandCalc> 的 id）。
 * Roadmap 的題目（HC-RM.n）放在第 n 個題目卡（R{n}）裡，卡片收著時題目根本沒掛上來，所以再帶 ?item=R{n} 請那一頁先把卡片打開
 * （src/pages/roadmap/index.tsx 讀 ?item=），AnchorDeepLink 等錨點出現再捲過去。
 */
export function handcalcRoute(h: Pick<HandCalcDef, 'id' | 'page'>): string {
  const anchor = `a=${encodeURIComponent(`handcalc-${h.id}`)}`
  const rm = h.page === '/roadmap' ? /^HC-RM\.(\d+)$/.exec(h.id) : null
  return rm ? `${h.page}?item=R${rm[1]}&${anchor}` : `${h.page}?${anchor}`
}

export function handcalcEntries(): SearchEntry[] {
  return ALL_HANDCALCS.map((h) => {
    const page = pageOfPath(h.page)
    return makeEntry(
      {
        kind: 'handcalc',
        id: h.id,
        title: h.title,
        detail: [page?.nav ?? h.page, MODE_LABEL[h.level], h.formulaId && `公式 ${h.formulaId}`].filter(Boolean).join(' · '),
        to: handcalcRoute(h),
      },
      [h.formulaId, h.formulaTex, h.level, h.claim, h.inputs.map((i) => `${i.symbol} ${i.label} ${i.unit ?? ''}`).join(' ')],
    )
  })
}

/** 整份靜態索引（公式、頁面與問題、preset、勘誤、術語、手算題；不含目前這一頁的 h2） */
export function buildIndex(): SearchEntry[] {
  return [...formulaEntries(), ...pageEntries(), ...presetEntries(), ...erratumEntries(), ...termEntries(), ...handcalcEntries()]
}

let cached: SearchEntry[] | null = null

/** 同一次瀏覽只建一次 */
export function getStaticIndex(): SearchEntry[] {
  if (!cached) cached = buildIndex()
  return cached
}
