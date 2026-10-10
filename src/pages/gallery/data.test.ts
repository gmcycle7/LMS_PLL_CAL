import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import katex from 'katex'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import { PAGES } from '@/app/registry'
import type { PresetEntry } from '@/data/types'
import { gaussianAlmostSureMuMax, meanPole, meanSquareFactor, meanSquareMuMax } from '@/simulation/models/lms'
import {
  auditSlots,
  countBy,
  EMPTY_FILTERS,
  errataIn,
  erratumInfo,
  EXPERIMENT_META,
  experimentName,
  filterPresets,
  GALLERY_EXPECTED_KEYS,
  GALLERY_SLOTS,
  hasActiveFilter,
  invalidGalleryIndices,
  levelsOf,
  pageFolder,
  pageOrder,
  PREVIEWABLE_EXPERIMENTS,
  QUESTION_LABEL,
  T_IDS,
  T_SPEC,
  testCoverage,
  type GallerySlot,
} from './data'

const ROOT = process.cwd()
const PATHS = PAGES.map((p) => p.path)
const PREVIEWABLE = new Set(PREVIEWABLE_EXPERIMENTS)

/** `$…$` 片段與整段 TeX 都要能被 KaTeX 解析（throwOnError） */
function expectTexOk(tex: string, where: string) {
  expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }), `${where}: ${tex}`).not.toThrow()
}
function expectRichOk(text: string, where: string) {
  for (const m of text.matchAll(/\$([^$]+)\$/g)) expectTexOk(m[1], where)
  expect((text.match(/\$/g) ?? []).length % 2, `${where}: $ 不成對`).toBe(0)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}
const folderCache = new Map<string, { file: string; text: string }[]>()
function folderSources(page: string): { file: string; text: string }[] {
  const entry = PAGES.find((p) => p.path === page)
  const rel = pageFolder(page, entry?.id)
  if (!rel) return []
  if (!folderCache.has(rel)) {
    const dir = resolve(ROOT, rel)
    folderCache.set(rel, existsSync(dir) ? walk(dir).map((file) => ({ file, text: readFileSync(file, 'utf8') })) : [])
  }
  return folderCache.get(rel) ?? []
}
const quoted = (id: string) => new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`)

/**
 * 把常數名稱解析成字串字面值：同一個檔案的字面值 → 同一個檔案的別名（const ID = SIGN_LMS_COMPARE_ID）→
 * 同一資料夾其他檔案的字面值（import 進來的常數）。找不到回傳 undefined。
 */
function resolveConst(name: string, self: { text: string }, files: { text: string }[], depth = 2): string | undefined {
  const lit = new RegExp(`\\b${name}\\b\\s*(?::[^=]+)?=\\s*['"\`]([^'"\`]+)['"\`]`)
  const own = lit.exec(self.text)?.[1]
  if (own) return own
  if (depth > 0) {
    // 同檔案內的別名優先於其他檔案的同名常數（各實驗檔常各自宣告 const ID = …）
    const alias = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([A-Za-z_][A-Za-z0-9_]*)\\b`).exec(self.text)?.[1]
    if (alias) return resolveConst(alias, self, files, depth - 1)
  }
  return files.map((g) => lit.exec(g.text)?.[1]).find((x) => x)
}

/** 測試用的最小 preset */
function mk(over: Partial<PresetEntry>): PresetEntry {
  return { id: 'x', title: 't', page: '/ch/01', experiment: 'lms-playground', description: 'd', params: {}, expected: 'e', source: 'illustrative', ...over }
}

describe('GALLERY_SLOTS：規格 §19.2 的 12 個槽位', () => {
  it('編號 1–12 各一個；頁面在 registry、實驗有登錄、T-id 與勘誤編號都存在', () => {
    expect(GALLERY_SLOTS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    for (const s of GALLERY_SLOTS) {
      expect(s.pages.length, `#${s.index}`).toBeGreaterThan(0)
      for (const p of s.pages) expect(PATHS, `#${s.index} 頁面 ${p}`).toContain(p)
      for (const e of s.experiments) expect(EXPERIMENT_META[e], `#${s.index} 實驗 ${e}`).toBeDefined()
      for (const t of s.tests) expect(T_IDS).toContain(t)
      for (const e of s.errata) expect(erratumInfo(e), `#${s.index} 勘誤 ${e}`).toBeDefined()
      expect(s.questions.length, `#${s.index}`).toBeGreaterThan(0)
      for (const q of s.questions) expect(QUESTION_LABEL[q]).toBeTruthy()
    }
  })

  it('規格 §17 的 T-id 對應：#1→T01/T02、#2→T04/T05、…、#12→T18；#11 規格沒有 T-id', () => {
    const tests = Object.fromEntries(GALLERY_SLOTS.map((s) => [s.index, s.tests]))
    expect(tests).toEqual({ 1: ['T01', 'T02'], 2: ['T04', 'T05'], 3: ['T06'], 4: ['T07'], 5: ['T09'], 6: ['T10', 'T11'], 7: ['T12'], 8: ['T13', 'T14'], 9: ['T15'], 10: ['T16', 'T17'], 11: [], 12: ['T18'] })
  })

  it('所有 TeX（條件、現象、修正說法、核心公式、動態、硬體、失效條件）都能被 KaTeX 解析', () => {
    for (const s of GALLERY_SLOTS) {
      const w = `slot #${s.index}`
      expectRichOk(s.condition, w)
      expectRichOk(s.lesson, w)
      if (s.corrected) expectRichOk(s.corrected, w)
      expectRichOk(s.hardware, w)
      expectRichOk(s.failure, w)
      expectTexOk(s.keyFormula, w)
      expectTexOk(s.dynamics, w)
    }
    for (const id of T_IDS) {
      expectRichOk(T_SPEC[id].input, id)
      expectRichOk(T_SPEC[id].expect, id)
      for (const e of T_SPEC[id].errata ?? []) expect(erratumInfo(e), `${id} 勘誤 ${e}`).toBeDefined()
    }
  })

  it('修正說法中提到的勘誤編號都列在該槽位的 errata（卡片上才會出現連結）', () => {
    for (const s of GALLERY_SLOTS) {
      for (const e of errataIn(s.corrected ?? '', s.failure, s.hardware)) expect(s.errata, `#${s.index} 文字提到 ${e}`).toContain(e)
    }
  })
})

describe('§19.2 稽核（auditSlots）：真實的 ALL_PRESETS', () => {
  const audit = auditSlots(ALL_PRESETS, PATHS)

  it('12 個必備 preset 都存在、唯一、頁面與實驗與規格一致、T-id 齊全', () => {
    const bad = audit.filter((a) => a.status !== 'ok').map((a) => `#${a.slot.index} ${a.status}: ${a.issues.join(' ')}`)
    expect(bad).toEqual([])
    expect(audit.map((a) => a.preset?.galleryIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('沒有 galleryIndex 超出 1–12 的 preset；preset id 全站唯一，只含英數與連字號（可直接放進網址）', () => {
    expect(invalidGalleryIndices(ALL_PRESETS)).toEqual([])
    expect(new Set(ALL_PRESETS.map((p) => p.id)).size).toBe(ALL_PRESETS.length)
    for (const p of ALL_PRESETS) expect(p.id, p.id).toMatch(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
  })

  it('每個 preset 的頁面都在網站目錄中，「載入並執行」的連結是 page?preset=id', () => {
    for (const p of ALL_PRESETS) {
      expect(PATHS, `${p.id} 的頁面 ${p.page}`).toContain(p.page)
      expect(presetHref(p)).toBe(`${p.page}?preset=${encodeURIComponent(p.id)}`)
    }
  })

  it('GALLERY_EXPECTED_KEYS 的 preset id 正好是 12 個必備 preset', () => {
    const ids = audit.map((a) => a.preset?.id).filter((x): x is string => !!x)
    expect(Object.keys(GALLERY_EXPECTED_KEYS).sort()).toEqual([...ids].sort())
  })

  it('12 個必備 preset 的實驗都有 Gallery 即時預覽', () => {
    for (const a of audit) expect(PREVIEWABLE.has(a.preset?.experiment ?? ''), `#${a.slot.index} ${a.preset?.experiment}`).toBe(true)
  })
})

describe('§19.2 稽核：反面測試（缺少／重複／連錯頁都要被抓到，而且不補資料）', () => {
  const slot1: GallerySlot[] = GALLERY_SLOTS.filter((s) => s.index === 1)
  const good = mk({ id: 'hand', galleryIndex: 1, page: '/ch/01', experiment: 'lms-playground', tests: ['T01', 'T02'] })

  it('缺少：沒有任何 galleryIndex = 1 的 preset ⇒ missing，preset 欄位是 undefined', () => {
    const [a] = auditSlots([mk({ id: 'other' })], PATHS, slot1)
    expect(a.status).toBe('missing')
    expect(a.preset).toBeUndefined()
    expect(a.found).toEqual([])
    expect(a.issues[0]).toContain('#1')
  })

  it('重複：兩個 preset 搶同一個編號 ⇒ duplicate，兩個 id 都列出', () => {
    const [a] = auditSlots([good, mk({ ...good, id: 'hand-2' })], PATHS, slot1)
    expect(a.status).toBe('duplicate')
    expect(a.preset).toBeUndefined()
    expect(a.issues[0]).toContain('hand')
    expect(a.issues[0]).toContain('hand-2')
  })

  it('頁面不在 registry ⇒ page-unregistered；頁面存在但不是規格對應的頁 ⇒ page-mismatch', () => {
    expect(auditSlots([mk({ ...good, page: '/ch/99' })], PATHS, slot1)[0].status).toBe('page-unregistered')
    expect(auditSlots([mk({ ...good, page: '/ch/12' })], PATHS, slot1)[0].status).toBe('page-mismatch')
  })

  it('實驗 id 不對 ⇒ experiment-mismatch；少了規格要求的 T-id ⇒ tests-missing', () => {
    expect(auditSlots([mk({ ...good, experiment: 'mse-vs-mae' })], PATHS, slot1)[0].status).toBe('experiment-mismatch')
    const [a] = auditSlots([mk({ ...good, tests: ['T01'] })], PATHS, slot1)
    expect(a.status).toBe('tests-missing')
    expect(a.issues[0]).toContain('T02')
  })

  it('完全正確 ⇒ ok，沒有 issues；invalidGalleryIndices 抓出 0、13、1.5', () => {
    const [a] = auditSlots([good], PATHS, slot1)
    expect(a.status).toBe('ok')
    expect(a.issues).toEqual([])
    const bad = [mk({ id: 'a', galleryIndex: 0 }), mk({ id: 'b', galleryIndex: 13 }), mk({ id: 'c', galleryIndex: 1.5 }), mk({ id: 'd', galleryIndex: 12 }), mk({ id: 'e' })]
    expect(invalidGalleryIndices(bad).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

/**
 * 把 `OBJ.key` 解析成字串字面值：在同一資料夾找 `const OBJ = { …, key: 'literal', … }`（物件字面值內不含巢狀大括號）。
 * 找不到回傳 undefined。
 */
function resolveMember(obj: string, key: string, files: { text: string }[]): string | undefined {
  const decl = new RegExp(`\\bconst\\s+${obj}\\s*(?::[^=]+)?=\\s*\\{([^{}]*)\\}`)
  const prop = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`)
  for (const g of files) {
    const body = decl.exec(g.text)?.[1]
    const lit = body ? prop.exec(body)?.[1] : undefined
    if (lit) return lit
  }
  return undefined
}

describe('原始碼掃描：「載入並執行」真的會套用參數', () => {
  const combos = [...new Map(ALL_PRESETS.map((p) => [`${p.page}|${p.experiment}`, p])).values()]

  it('每個 (頁面, 實驗)：頁面資料夾存在、原始碼含有這個 experiment id、並呼叫 useUrlPreset', () => {
    const problems: string[] = []
    for (const p of combos) {
      const files = folderSources(p.page)
      if (files.length === 0) problems.push(`${p.page}: 找不到頁面資料夾`)
      else if (!files.some((f) => quoted(p.experiment).test(f.text))) problems.push(`${p.page}: 原始碼沒有實驗 id '${p.experiment}'`)
      else if (!files.some((f) => /useUrlPreset\s*\(/.test(f.text))) problems.push(`${p.page}: 沒有任何檔案呼叫 useUrlPreset`)
    }
    expect(problems).toEqual([])
  })

  it('12 個必備 preset：useUrlPreset 的引數就是該實驗的 id（字面值，或同一資料夾內定義為該字面值的常數）', () => {
    const problems: string[] = []
    for (const p of ALL_PRESETS.filter((x) => x.galleryIndex !== undefined)) {
      const files = folderSources(p.page)
      let ok = false
      for (const f of files) {
        for (const m of f.text.matchAll(/useUrlPreset\s*\(\s*([^)]+?)\s*\)/g)) {
          const arg = m[1]
          if (quoted(p.experiment).test(arg)) ok = true
          else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
            const def = new RegExp(`\\b${arg}\\b\\s*(?::[^=]+)?=\\s*['"\`]${p.experiment}['"\`]`)
            if (files.some((g) => def.test(g.text))) ok = true
          }
        }
      }
      if (!ok) problems.push(`#${p.galleryIndex} ${p.id}: ${p.page} 沒有 useUrlPreset('${p.experiment}')`)
    }
    expect(problems).toEqual([])
  })

  it('每個有 preset 的實驗都登錄在 EXPERIMENT_META；靜態的 ExperimentShell level 與登錄值一致', () => {
    const problems: string[] = []
    for (const p of combos) {
      const meta = EXPERIMENT_META[p.experiment]
      if (!meta) {
        problems.push(`${p.experiment}: 未登錄在 EXPERIMENT_META`)
        continue
      }
      const files = folderSources(p.page)
      let found = false
      for (const f of files) {
        // 逐一找每個 '<ExperimentShell'（用 indexOf：註解中的提及與真正的 JSX 可能相距不到 700 字，不能用會吃掉重疊的 matchAll）
        for (let at = f.text.indexOf('<ExperimentShell'); at >= 0; at = f.text.indexOf('<ExperimentShell', at + 1)) {
          const head = f.text.slice(at + '<ExperimentShell'.length, at + 900)
          if (!/^\s/.test(head)) continue // '<ExperimentShell>' 或 '<ExperimentShellProps' 之類的不是帶屬性的 JSX
          // 第一個出現的 id 屬性才是 ExperimentShell 自己的（後面 900 字內可能還有子元素的 id="…"）
          // 三種寫法：id="literal"、id={CONST}、id={OBJ.key}（例如 /lab 的 EXP.pipeline）
          const idAttr = /\bid=(?:["']([^"']+)["']|\{([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\})/.exec(head)
          const idConst = idAttr?.[2]
          const idKey = idAttr?.[3]
          let id = idAttr?.[1]
          if (!id && idConst) id = idKey ? resolveMember(idConst, idKey, files) : resolveConst(idConst, f, files)
          if (id !== p.experiment) continue
          found = true
          const levelAttr = /\blevel=(?:["'](L[0-6])["']|(\{))/.exec(head)
          const lit = levelAttr?.[1]
          if (lit) {
            if (meta.levels.length !== 1 || meta.levels[0] !== lit) problems.push(`${p.experiment}: 原始碼 level="${lit}"，登錄為 [${meta.levels.join(', ')}]`)
          } else if (levelAttr?.[2]) {
            if (meta.levels.length < 2) problems.push(`${p.experiment}: 原始碼的 level 是動態的，登錄卻只有 [${meta.levels.join(', ')}]`)
          } else problems.push(`${p.experiment}: 找不到 level 屬性`)
        }
      }
      if (!found) problems.push(`${p.experiment}: 在 ${p.page} 找不到對應的 <ExperimentShell>`)
    }
    expect(problems).toEqual([])
  })

  it('PREVIEWABLE_EXPERIMENTS 都登錄在 EXPERIMENT_META；experimentName 對未登錄的 id 原樣回傳', () => {
    for (const e of PREVIEWABLE_EXPERIMENTS) expect(EXPERIMENT_META[e], e).toBeDefined()
    expect(experimentName('lms-playground')).toBe('LMS Playground')
    expect(experimentName('no-such-experiment')).toBe('no-such-experiment')
  })
})

describe('levelsOf：依 preset 參數判斷模型層級（與各實驗原始碼的同一條規則）', () => {
  it('固定層級的實驗直接回傳登錄值；未登錄的實驗 known = false（不猜）', () => {
    expect(levelsOf(mk({ experiment: 'comparator-lab' }))).toEqual({ levels: ['L1'], dynamic: false, known: true })
    expect(levelsOf(mk({ experiment: 'no-such-experiment' }))).toEqual({ levels: [], dynamic: false, known: false })
  })

  it('bias-inl-lab：dcMode none ⇒ L1，其餘 ⇒ L2；cal-state-machine：registerLsb > 0 ⇒ L5', () => {
    expect(levelsOf(mk({ experiment: 'bias-inl-lab', params: { dcMode: 'none' } })).levels).toEqual(['L1'])
    expect(levelsOf(mk({ experiment: 'bias-inl-lab', params: {} })).levels).toEqual(['L1'])
    expect(levelsOf(mk({ experiment: 'bias-inl-lab', params: { dcMode: 'shared_bbpd' } })).levels).toEqual(['L2'])
    expect(levelsOf(mk({ experiment: 'cal-state-machine', params: { registerLsb: 0 } })).levels).toEqual(['L1'])
    expect(levelsOf(mk({ experiment: 'cal-state-machine', params: { registerLsb: 0.125 } })).levels).toEqual(['L5'])
  })

  it('gmac-signal-flow：DSM code 或非 identity path ⇒ L2；block-lms-json：quantize_physical ⇒ L5，否則列出全部可能值', () => {
    expect(levelsOf(mk({ experiment: 'gmac-signal-flow', params: { pattern: 'iid_pm_one', path: 'identity' } })).levels).toEqual(['L1'])
    expect(levelsOf(mk({ experiment: 'gmac-signal-flow', params: { pattern: 'dsm_first_order', path: 'identity' } })).levels).toEqual(['L2'])
    expect(levelsOf(mk({ experiment: 'gmac-signal-flow', params: { pattern: 'iid_pm_one', path: 'first_order_hp' } })).levels).toEqual(['L2'])
    expect(levelsOf(mk({ experiment: 'block-lms-json', params: { config: { gain_register: { quantize_physical: true } } } }))).toEqual({ levels: ['L5'], dynamic: false, known: true })
    const dyn = levelsOf(mk({ experiment: 'block-lms-json', params: { config: {} } }))
    expect(dyn.dynamic).toBe(true)
    expect(dyn.levels).toEqual(['L1', 'L2', 'L5'])
  })

  it('真實 preset：每一個都判斷得出層級（沒有未登錄的實驗）', () => {
    for (const p of ALL_PRESETS) {
      const lv = levelsOf(p)
      expect(lv.known, p.id).toBe(true)
      expect(lv.levels.length, p.id).toBeGreaterThan(0)
    }
  })
})

describe('filterPresets：頁面／層級／T-id／來源／關鍵字', () => {
  const none = EMPTY_FILTERS

  it('沒有條件時回傳全部；hasActiveFilter 對空白關鍵字回傳 false', () => {
    expect(filterPresets(ALL_PRESETS, none, PREVIEWABLE)).toHaveLength(ALL_PRESETS.length)
    expect(hasActiveFilter(none)).toBe(false)
    expect(hasActiveFilter({ ...none, q: '   ' })).toBe(false)
    expect(hasActiveFilter({ ...none, level: 'L3' })).toBe(true)
  })

  it('依頁面：只留該頁的 preset，數量與直接計數相同', () => {
    const out = filterPresets(ALL_PRESETS, { ...none, page: '/ch/05' }, PREVIEWABLE)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((p) => p.page === '/ch/05')).toBe(true)
    expect(out.length).toBe(ALL_PRESETS.filter((p) => p.page === '/ch/05').length)
  })

  it('依模型層級：L3 的結果都含 L3（例如 #6、#11、#12），不含 L0 的手算例', () => {
    const out = filterPresets(ALL_PRESETS, { ...none, level: 'L3' }, PREVIEWABLE)
    expect(out.every((p) => levelsOf(p).levels.includes('L3'))).toBe(true)
    const idx = out.map((p) => p.galleryIndex)
    expect(idx).toEqual(expect.arrayContaining([6, 11, 12]))
    expect(idx).not.toContain(1)
  })

  it('依 T-id：T13 的結果都帶 T13；none 只留沒有 T-id 的', () => {
    const t13 = filterPresets(ALL_PRESETS, { ...none, test: 'T13' }, PREVIEWABLE)
    expect(t13.length).toBeGreaterThan(0)
    expect(t13.every((p) => (p.tests ?? []).includes('T13'))).toBe(true)
    const noT = filterPresets(ALL_PRESETS, { ...none, test: 'none' }, PREVIEWABLE)
    expect(noT.every((p) => (p.tests ?? []).length === 0)).toBe(true)
    expect(t13.length + noT.length).toBeLessThanOrEqual(ALL_PRESETS.length)
  })

  it('依來源、只看 §19.2、只看可預覽：各自正確，組合時取交集', () => {
    const sim = filterPresets(ALL_PRESETS, { ...none, source: 'simulation' }, PREVIEWABLE)
    expect(sim.every((p) => p.source === 'simulation')).toBe(true)
    const g = filterPresets(ALL_PRESETS, { ...none, galleryOnly: true }, PREVIEWABLE)
    expect(g).toHaveLength(12)
    const pv = filterPresets(ALL_PRESETS, { ...none, previewOnly: true }, PREVIEWABLE)
    expect(pv.every((p) => PREVIEWABLE.has(p.experiment))).toBe(true)
    const both = filterPresets(ALL_PRESETS, { ...none, galleryOnly: true, source: 'simulation', level: 'L2' }, PREVIEWABLE)
    expect(both.every((p) => p.galleryIndex !== undefined && p.source === 'simulation' && levelsOf(p).levels.includes('L2'))).toBe(true)
  })

  it('關鍵字：不分大小寫，搜尋 id、標題、說明、預期文字與實驗 id；找不到回傳空陣列', () => {
    expect(filterPresets(ALL_PRESETS, { ...none, q: 'LMS-PLAYGROUND-HAND' }, PREVIEWABLE).map((p) => p.id)).toEqual(['lms-playground-hand'])
    expect(filterPresets(ALL_PRESETS, { ...none, q: 'quantized-gain-lab' }, PREVIEWABLE).every((p) => p.experiment === 'quantized-gain-lab')).toBe(true)
    expect(filterPresets(ALL_PRESETS, { ...none, q: '這段文字不存在於任何 preset zzz' }, PREVIEWABLE)).toEqual([])
  })
})

describe('testCoverage / countBy / errataIn / pageOrder', () => {
  it('testCoverage：18 列；每列的數量等於直接計數；§19.2 指定的 T-id 至少各有一個必備 preset', () => {
    const rows = testCoverage(ALL_PRESETS)
    expect(rows.map((r) => r.id)).toEqual([...T_IDS])
    for (const r of rows) {
      expect(r.presets).toBe(ALL_PRESETS.filter((p) => (p.tests ?? []).includes(r.id)).length)
      expect(r.gallery).toBeLessThanOrEqual(r.presets)
      expect(r.pages.length).toBeLessThanOrEqual(r.presets)
    }
    const required = new Set(GALLERY_SLOTS.flatMap((s) => s.tests))
    for (const r of rows) if (required.has(r.id)) expect(r.gallery, r.id).toBeGreaterThanOrEqual(1)
  })

  it('countBy：key 回傳陣列時每個都計一次；保持第一次出現的順序', () => {
    const m = countBy(['a', 'bb', 'cc', 'a'], (s) => (s.length === 1 ? 'one' : ['two', 'even']))
    expect([...m.entries()]).toEqual([
      ['one', 2],
      ['two', 2],
      ['even', 2],
    ])
  })

  it('errataIn：只認 errata.json 裡存在的 Exx；去重並保持順序；不把 E300、1E05、ME05 當勘誤', () => {
    expect(errataIn('勘誤 E05、E23；再提一次 E05', '另見 E01')).toEqual(['E05', 'E23', 'E01'])
    expect(errataIn('E99 不存在、E300 太長、1E05 是數字、ME05 是字')).toEqual([])
  })

  it('pageOrder：依 registry 順序；不在 registry 的排最後', () => {
    expect(pageOrder('/ch/01', PATHS)).toBeLessThan(pageOrder('/ch/05', PATHS))
    expect(pageOrder('/nope', PATHS)).toBe(999)
    expect(pageFolder('/ch/07')).toBe('src/chapters/ch07')
    expect(pageFolder('/', 'dashboard')).toBe('src/pages/dashboard')
    expect(pageFolder('/models', 'models')).toBe('src/pages/models')
    expect(pageFolder('/unknown')).toBeNull()
  })
})

describe('Calibration Lab（/lab）的五個實驗：層級與各分頁的 ExperimentShell 同一條規則', () => {
  it('unified-lab：quantize ⇒ L5，否則 L4；unified-lab-mc：base.quantize ⇒ L5，否則 L2', () => {
    expect(levelsOf(mk({ experiment: 'unified-lab', params: { quantize: true } }))).toEqual({ levels: ['L5'], dynamic: false, known: true })
    expect(levelsOf(mk({ experiment: 'unified-lab', params: { quantize: false } })).levels).toEqual(['L4'])
    expect(levelsOf(mk({ experiment: 'unified-lab', params: {} })).levels).toEqual(['L4'])
    expect(levelsOf(mk({ experiment: 'unified-lab-mc', params: { base: { quantize: true }, runs: 8 } })).levels).toEqual(['L5'])
    expect(levelsOf(mk({ experiment: 'unified-lab-mc', params: { base: { quantize: false } } })).levels).toEqual(['L2'])
  })

  it('unified-lab-compare：任何一個 case 開定點 ⇒ L5；case 沒寫時沿用 base；固定層級的兩個分頁直接回傳登錄值', () => {
    const base = { quantize: false }
    expect(levelsOf(mk({ experiment: 'unified-lab-compare', params: { base, cases: [{ regressor: 'raw' }, { regressor: 'filtered' }] } })).levels).toEqual(['L4'])
    expect(levelsOf(mk({ experiment: 'unified-lab-compare', params: { base, cases: [{ regressor: 'raw' }, { quantize: true }] } })).levels).toEqual(['L5'])
    expect(levelsOf(mk({ experiment: 'unified-lab-compare', params: { base: { quantize: true }, cases: [{}, { quantize: false }] } })).levels).toEqual(['L5'])
    expect(levelsOf(mk({ experiment: 'unified-lab-compare', params: { base: { quantize: true }, cases: [{ quantize: false }] } })).levels).toEqual(['L4'])
    expect(levelsOf(mk({ experiment: 'unified-lab-fcw' }))).toEqual({ levels: ['L2'], dynamic: false, known: true })
    expect(levelsOf(mk({ experiment: 'training-sequence-lab' }))).toEqual({ levels: ['L3'], dynamic: false, known: true })
  })

  it('真實的 /lab preset：定點 preset 判為 L5、T13 anchor 判為 L4；Gallery 不替它們提供主執行緒預覽', () => {
    const lab = ALL_PRESETS.filter((p) => p.page === '/lab')
    expect(lab.length).toBeGreaterThan(0)
    for (const p of lab) {
      expect(EXPERIMENT_META[p.experiment], p.experiment).toBeDefined()
      expect(levelsOf(p).levels.length, p.id).toBe(1)
      expect(PREVIEWABLE.has(p.experiment), p.experiment).toBe(false) // 長時間閉迴路模擬：留在原頁面的 worker
    }
    const fp = lab.find((p) => p.id === 'lab-fixed-point-6bit')
    if (fp) expect(levelsOf(fp).levels).toEqual(['L5'])
    const t13 = lab.find((p) => p.id === 'lab-t13-anchor')
    if (t13) expect(levelsOf(t13).levels).toEqual(['L4'])
  })
})

describe('T_SPEC（§9 覆蓋率表的文字）中的數字與模型／golden 一致', () => {
  const golden = (id: string) => JSON.parse(readFileSync(resolve(ROOT, 'golden/vectors', `${id}.json`), 'utf8')) as { inputs: Record<string, unknown>; expected: Record<string, unknown>; tolerance: { abs?: number; rel?: number } }

  it('T03: Gaussian E[x²] = 1、E[x⁴] = 3 ⇒ mean 上限 2、mean-square 上限 2/3；almost-sure 上限約 2.42（勘誤 E14）', () => {
    const g = golden('T03')
    const Px = g.inputs.Ex2 as number
    const M4 = g.inputs.Ex4 as number
    const tol = g.tolerance.abs ?? 1e-12
    expect(Math.abs(meanSquareMuMax(Px, M4) - (g.expected.mu_ms_max as number))).toBeLessThanOrEqual(tol)
    expect(meanSquareMuMax(Px, M4)).toBeCloseTo(2 / 3, 12)
    // mean 上限：pole 1 − μP_x = −1 ⇒ μ = 2/P_x
    expect(meanPole(g.expected.mu_mean_max as number, Px)).toBeCloseTo(-1, 12)
    const mus = g.inputs.mu_list as number[]
    mus.forEach((mu, i) => {
      expect(meanSquareFactor(mu, Px, M4)).toBeCloseTo((g.expected.ms_factor_list as number[])[i], 12)
      expect(meanPole(mu, Px)).toBeCloseTo((g.expected.mean_factor_list as number[])[i], 12)
    })
    expect(meanSquareFactor(2 / 3, Px, M4)).toBeCloseTo(1, 12) // 恰在邊界
    // 覆蓋率表寫的三個數字：2、2/3、約 2.42
    expect(T_SPEC.T03.expect).toContain('$2$')
    expect(T_SPEC.T03.expect).toContain('$2/3$')
    expect(T_SPEC.T03.expect).toContain('2.42')
    expect(gaussianAlmostSureMuMax(1).toFixed(2)).toBe('2.42')
    expect(T_SPEC.T03.errata).toEqual(expect.arrayContaining(['E14']))
  })

  it('T14 的文字同時寫出 −3 dB 與 ENBW（勘誤 E06）；T13 寫出成立前提（勘誤 E30）；T16 提到主 tone 在 2f_u/5（勘誤 E47）', () => {
    expect(T_SPEC.T14.expect).toContain('12.93')
    expect(T_SPEC.T14.expect).toContain('20.29')
    expect(T_SPEC.T14.expect).toContain('不是 noise BW')
    expect(T_SPEC.T13.input).toContain('average GMAC')
    expect(T_SPEC.T16.expect).toContain('2f_u/5')
    expect(T_SPEC.T06.errata).toContain('E46')
    const g = golden('T14')
    expect(((g.expected.bw_exact_3db_hz as number) / 1e3).toFixed(2)).toBe('12.93')
    expect(((g.expected.enbw_one_sided_hz as number) / 1e3).toFixed(2)).toBe('20.29')
  })
})
