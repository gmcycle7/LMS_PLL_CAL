import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PAGES, pageById } from '@/app/registry'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import type { PresetEntry } from '@/data/types'
import { CHAPTER_META, CLAIM_EXAMPLES, OUTCOMES, QUESTIONS, ROUTES, SIX_CONDITIONS, conditionsForPage, questionsForPage, shortCode } from './data'
import { renderTex } from '@/components'
import { CONDITION_ORDER, DEFAULT_PARAMS, evaluateThesis } from './thesisModel'
import { ERRATA, T_IDS, readErrata, summarizeErrata, summarizeTests, erratumById } from './summaries'
import { THESIS_PRESETS, builtinPreset, presetParams } from './presets'
import { galleryPresets } from './sections/Gallery'
import { verificationPath } from './ui'
import { CONDITION_MAP_LEGEND } from './diagrams'
import { mathTextProblems } from './mathTextTestUtils'

const spec = readFileSync(join(process.cwd(), 'docs', 'LMS_PLL_Calibration_Website_Blueprint_ZH_TW.md'), 'utf8')

/** 某章原始碼（不含測試）中 ModelLevel / ExperimentShell 實際用到的模型層級 */
function levelsUsedIn(dir: string): Set<string> {
  const out = new Set<string>()
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(full, 'utf8')
        for (const m of src.matchAll(/level(?:=|:\s*)\{?["'](L[0-6])["']/g)) out.add(m[1])
      }
    }
  }
  walk(dir)
  return out
}

/** 所有 $…$ 必須成對（Rich 元件才不會把一般文字當 TeX） */
function balanced(s: string) {
  return (s.split('$').length - 1) % 2 === 0
}

describe('Dashboard 內容資料與 registry 一致', () => {
  it('六個條件依規格附錄 E 的順序：identifiability → polarity → stability → variance → bias → system', () => {
    expect(SIX_CONDITIONS.map((c) => c.id)).toEqual([...CONDITION_ORDER])
    expect(SIX_CONDITIONS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(spec).toMatch(/資訊足夠（identifiability）、更新方向正確（polarity）、動態穩定（stability）、統計精度足夠（variance）、收斂到正確物理參數（bias）/)
  })

  it('所有引用的頁面 id 都存在於 PAGES（路線、條件、問題、章節中繼資料）', () => {
    const ids = new Set(PAGES.map((p) => p.id))
    const refs = [
      ...ROUTES.flatMap((r) => r.steps.flatMap((s) => [s.page, ...(s.also ?? [])])),
      ...SIX_CONDITIONS.flatMap((c) => c.pages),
      ...QUESTIONS.flatMap((q) => q.pages),
      ...OUTCOMES.flatMap((o) => o.can.map((c) => c.page)),
      ...Object.keys(CHAPTER_META),
    ]
    for (const id of refs) expect(ids.has(id), id).toBe(true)
    // 每個非 dashboard 頁面都有卡片中繼資料
    for (const p of PAGES) if (p.id !== 'dashboard') expect(CHAPTER_META[p.id], p.id).toBeDefined()
  })

  it('三條學習路線與規格 §19.1 的步驟相同；數學路線在規格的六步之前多了 STEP 1 = Ch00 入門課', () => {
    // 規格 §19.1 原文
    const math = 'MSE → Gradient → Scalar Stability → Sign-LMS → PE → MIMO'
    const pll = 'DSM Code → DTC → PD → GMAC → H(z) → Polarity → Dual Loop'
    const chip = 'Noise → Bias → Quantization → Spur/Jitter → Fixed Point → Sign-off'
    for (const s of [math, pll, chip]) expect(spec).toContain(s)
    const chain = (r: (typeof ROUTES)[number]) => r.steps.map((s) => s.label).join(' → ')
    expect(ROUTES.map((r) => r.id)).toEqual(['math', 'pll', 'chip'])
    expect(chain(ROUTES[0])).toBe(`Black Box → ${math}`)
    expect(chain(ROUTES[1])).toBe(pll)
    expect(chain(ROUTES[2])).toBe(chip)
    // STEP 1 是 Ch00（第一次來建議先走前三步：Ch00 → Ch01 → Ch02）；Ch00 不再只出現在「也見」
    expect(ROUTES[0].steps.slice(0, 3).map((s) => s.page)).toEqual(['ch00', 'ch01', 'ch02'])
    expect(ROUTES[0].steps.some((s) => s.also?.includes('ch00'))).toBe(false)
    expect(ROUTES[0].steps[0].zh).not.toMatch(/\$/) // 步驟卡片的文字是純文字（不經 Rich），不放公式
  })

  it('學完你能做什麼：Part A / B / C 各兩句，每句連到存在的章節且屬於該 Part；關鍵能力都在', () => {
    expect(OUTCOMES.map((o) => o.part)).toEqual(['A', 'B', 'C'])
    for (const o of OUTCOMES) {
      expect(o.can).toHaveLength(2)
      for (const c of o.can) {
        const page = pageById(c.page)
        expect(page, `${o.part} → ${c.page}`).toBeDefined()
        expect(page?.group, `${c.page} 應屬於 Part ${o.part}`).toBe(o.part)
        expect(balanced(c.text), c.text).toBe(true)
        expect(mathTextProblems(c.text), c.text).toEqual([])
      }
      expect(o.color).toMatch(/^--series-[1-6]$/)
    }
    const all = OUTCOMES.flatMap((o) => o.can.map((c) => c.text)).join('\n')
    // A：手算兩步、μ 會不會發散；B：K_q、N、GMAC 極性；C：σ_w、spur、6-bit dither
    for (const need of ['手算 LMS 兩步', '$\\mu$', '發散', '$K_q$', '$N$', '極性', '$\\sigma_w$', 'spur', '6-bit', 'dither']) expect(all, need).toContain(need)
    expect(OUTCOMES.map((o) => o.can.map((c) => c.page))).toEqual([
      ['ch00', 'ch03'],
      ['ch05', 'ch06'],
      ['ch12', 'ch13'],
    ])
  })

  it('附錄 E 的 15 個問題逐字取自規格，編號 1–15，每題至少一個回答頁', () => {
    expect(QUESTIONS.map((q) => q.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    for (const q of QUESTIONS) {
      expect(spec, `Q${q.n}`).toContain(`${q.n}. ${q.text}`)
      expect(q.pages.length).toBeGreaterThan(0)
      expect(pageById(q.pages[0])).toBeDefined()
      for (const t of q.tests) expect(T_IDS).toContain(t)
    }
  })

  it('條件、問題引用的 T-id 與勘誤 id 都存在', () => {
    for (const c of SIX_CONDITIONS) {
      for (const t of c.tests) expect(T_IDS).toContain(t)
      for (const e of c.errata) expect(erratumById(e), e).toBeDefined()
      for (const q of c.questions) expect(QUESTIONS.some((x) => x.n === q && x.conditions.includes(c.id)), `${c.id} Q${q}`).toBe(true)
    }
    for (const q of QUESTIONS) for (const e of q.errata ?? []) expect(erratumById(e), e).toBeDefined()
  })

  it('所有說明文字的 $…$ 都成對', () => {
    const texts = [
      ...SIX_CONDITIONS.flatMap((c) => [c.ask, c.claimNote, c.failure, c.hardware]),
      ...QUESTIONS.map((q) => q.text),
      ...Object.values(CHAPTER_META).map((m) => m.summary),
      ...CLAIM_EXAMPLES.map((c) => c.text),
      ...ROUTES.map((r) => r.blurb),
      ...OUTCOMES.flatMap((o) => o.can.map((c) => c.text)),
    ]
    for (const t of texts) expect(balanced(t), t).toBe(true)
  })

  it('反查：章節涵蓋的條件與回答的問題', () => {
    expect(conditionsForPage('ch09')).toContain('identifiability')
    expect(conditionsForPage('ch11')).toEqual(['bias'])
    expect(questionsForPage('ch05')).toEqual([3, 4])
    expect(conditionsForPage('ch00')).toEqual([])
    expect(shortCode('ch07')).toBe('Ch07')
    expect(shortCode('case-sspll')).toBe('Ch07b')
    expect(shortCode('lab')).toBeUndefined()
  })

  it('章節卡片列出的模型層級確實出現在該章的實作中（Ch00–Ch14；尚未實作的章節略過）', () => {
    let checked = 0
    for (const [id, meta] of Object.entries(CHAPTER_META)) {
      if (!/^ch\d\d$/.test(id)) continue
      const dir = join(process.cwd(), 'src', 'chapters', id)
      if (!existsSync(dir)) continue
      const used = levelsUsedIn(dir)
      if (used.size === 0) continue
      checked++
      for (const l of meta.levels) expect(used.has(l), `${id} 卡片標示 ${l}，但該章原始碼沒有用到`).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('12 個必備實驗：由 preset 註冊表彙整，編號 1–12 不重複、依序排列，每個都連到存在的頁面', () => {
    const items = galleryPresets()
    const idx = items.map((p) => p.galleryIndex as number)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(new Set(idx).size).toBe(idx.length)
    for (const p of items) {
      expect(p.galleryIndex).toBeGreaterThanOrEqual(1)
      expect(p.galleryIndex).toBeLessThanOrEqual(12)
      expect(PAGES.some((x) => x.path === p.page), `${p.id} → ${p.page}`).toBe(true)
      expect(presetHref(p)).toBe(`${p.page}?preset=${p.id}`)
      expect(ALL_PRESETS).toContain(p)
    }
    // 反面：重複編號只取第一個、超出 1–12 或沒有編號的不列入
    const mk = (id: string, galleryIndex?: number): PresetEntry => ({ id, title: id, galleryIndex, page: '/ch/01', experiment: 'x', description: '', params: {}, expected: '', source: 'illustrative' })
    expect(galleryPresets([mk('b', 2), mk('a', 2), mk('c', 1), mk('d'), mk('e', 13), mk('f', 0)]).map((p) => p.id)).toEqual(['c', 'a'])
  })

  it('驗證頁深連結：勘誤 → ?e=Exx、驗收列 → ?t=Txx，其他一律回到驗證頁首', () => {
    expect(verificationPath('E05')).toBe('/verification?e=E05')
    expect(verificationPath('T13')).toBe('/verification?t=T13')
    expect(verificationPath()).toBe('/verification')
    expect(verificationPath('E5; drop')).toBe('/verification')
  })

  it('每個條件至少連到一章、一個 T-id，且各有至少一個 preset 會讓它失敗（反面例子）', () => {
    for (const c of SIX_CONDITIONS) {
      expect(c.pages.length).toBeGreaterThan(0)
      expect(c.tests.length).toBeGreaterThan(0)
      expect(THESIS_PRESETS.some((p) => p.expectFail?.includes(c.id)), c.id).toBe(true)
    }
  })

  it('卡片上的「載入反例」：每個條件的 example preset 存在，載入後該條件確實失敗（由同一個計算核心判定）', () => {
    for (const c of SIX_CONDITIONS) {
      const preset = builtinPreset(c.example)
      expect(preset, c.example).toBeDefined()
      const r = evaluateThesis(presetParams(preset!))
      expect(r.checks.find((k) => k.id === c.id)?.state, `${c.id} ← ${c.example}`).toBe('fail')
    }
    // 六個反例各不相同；variance 與 system 的反例只讓「少數條件」失敗，凸顯『前面的條件過關不保證後面的』（條件之間仍有關聯：極性反例會連帶讓後面四項失敗）
    expect(new Set(SIX_CONDITIONS.map((c) => c.example)).size).toBe(6)
    const failed = (id: string) => evaluateThesis(presetParams(builtinPreset(id)!)).checks.filter((k) => k.state === 'fail').map((k) => k.id)
    expect(failed('thesis-rho099-precond')).toEqual(['variance'])
    expect(failed('thesis-spur-t15')).toEqual(['system'])
    expect(failed('thesis-bias-only')).toEqual(['bias', 'system'])
    // 卡片上顯示的名稱是 TeX 版（$…$ 成對），不在內文用 Unicode 拼公式
    for (const c of SIX_CONDITIONS) {
      const rich = builtinPreset(c.example)?.rich
      expect(rich, c.example).toBeDefined()
      expect(balanced(rich!), rich).toBe(true)
      expect(rich).toMatch(/\$/)
    }
    expect(builtinPreset('nope')).toBeUndefined()
    expect(builtinPreset(null)).toBeUndefined()
  })
})

describe('驗證與勘誤彙整', () => {
  it('勘誤依嚴重度加總等於總數，且與 docs/validation.md 的總表一致', () => {
    const s = summarizeErrata()
    expect(s.total).toBe(ERRATA.length)
    expect(s.bySeverity.high + s.bySeverity.medium + s.bySeverity.low).toBe(s.total)
    expect(s.high.every((e) => e.severity === 'high')).toBe(true)
    const doc = readFileSync(join(process.cwd(), 'docs', 'validation.md'), 'utf8')
    const m = doc.match(/確認 \*\*(\d+)\*\* 項勘誤（high (\d+)、medium (\d+)、low (\d+)）/)
    expect(m).not.toBeNull()
    expect([s.total, s.bySeverity.high, s.bySeverity.medium, s.bySeverity.low]).toEqual(m!.slice(1).map(Number))
  })

  it('格式不符的勘誤條目被略過，不會讓頁面崩潰（反面測試）', () => {
    expect(readErrata(null)).toEqual([])
    expect(readErrata({ errata: [{ eid: 'E99' }, 42, null] })).toEqual([])
    const ok = readErrata({ errata: [{ eid: 'E99', id: 'x', severity: 'high', area: 'a', chapters: ['ch01', 'all'], location: '', problem: '', correction: '' }] })
    const s = summarizeErrata(ok)
    expect(s.byPage).toEqual({ ch01: 1 })
    expect(s.global).toBe(1)
  })

  it('測試狀態彙整：18 個 T-id；缺漏或未知狀態一律算 pending（missing），不會被當成通過', () => {
    const real = summarizeTests()
    expect(real.byId).toHaveLength(18)
    expect(Object.values(real.counts).reduce((a, b) => a + b, 0)).toBe(18)
    const fake = summarizeTests({ tests: { T01: { status: 'pass' }, T02: { status: 'weird' } } }, null)
    expect(fake.counts.pass).toBe(1)
    expect(fake.counts.missing).toBe(17)
    expect(fake.byId[0].description).toBeUndefined()
    // golden index 的描述
    expect(real.byId.find((t) => t.id === 'T13')?.description).toMatch(/σ_w/)
  })
})

describe('Dashboard 內容資料：數學一律 LaTeX（docs/teaching-style.md §3）', () => {
  it('條件卡片、宣稱範例、15 個問題、章節摘要、圖例的文字：$ 成對、KaTeX 可解析、$…$ 之外沒有 Unicode 拼的公式', () => {
    const texts = [
      ...SIX_CONDITIONS.flatMap((c) => [c.ask, c.claimNote, c.failure, c.hardware]),
      ...CLAIM_EXAMPLES.map((c) => c.text),
      ...QUESTIONS.map((q) => q.text),
      ...Object.values(CHAPTER_META).map((m) => m.summary),
      ...CONDITION_MAP_LEGEND.map((r) => r.knobs),
      ...OUTCOMES.flatMap((o) => o.can.map((c) => c.text)),
      ...ROUTES.flatMap((r) => [r.blurb, ...r.steps.flatMap((s) => [s.zh, s.sections])]),
    ]
    expect(texts.length).toBeGreaterThan(60)
    for (const t of texts) expect(mathTextProblems(t), t).toEqual([])
    // 卡片上的「載入反例」按鈕顯示的是 TeX 版名稱（rich）：每個條件的反例 preset 都要有
    for (const c of SIX_CONDITIONS) {
      const preset = builtinPreset(c.example)
      expect(preset?.rich, `${c.id} → ${c.example}`).toBeDefined()
      expect(mathTextProblems(preset?.rich ?? ''), preset?.rich).toEqual([])
    }
  })

  it('C06：穩定條件卡片把雙迴路的「一半」限定在 Ch08 的二狀態模型，不寫成通則', () => {
    const stab = SIX_CONDITIONS.find((c) => c.id === 'stability')!
    expect(stab.failure).toContain('Ch08')
    expect(stab.failure).toContain('二狀態模型')
    expect(stab.failure).toContain('quasi-static')
    expect(stab.failure).toContain('不是所有 PLL 雙迴路的通則')
    expect(stab.failure).not.toContain('雙迴路的完整界限只有簡化模型的一半')
    // 保留的句子
    expect(stab.failure).toContain('GMAC 用 sum 卻沒把 $\\mu$ 除以 $N$')
    expect(stab.failure).toContain('Mean 穩定不代表 mean-square 穩定')
    // 連結仍在：Ch08、勘誤 E19、Q10
    expect(stab.pages).toContain('ch08')
    expect(stab.errata).toContain('E19')
    expect(stab.questions).toContain(10)
    expect(mathTextProblems(stab.failure)).toEqual([])
  })

  it('R13：穩定條件卡片在判據旁註明「穩定 ⇒ 極性正確」（下限 0 < g 就是 C > 0），不反過來', () => {
    const stab = SIX_CONDITIONS.find((c) => c.id === 'stability')!
    expect(stab.claim).toBe('exact')
    expect(stab.claimNote).toContain('$0<g$ 就是條件 2 的 $C>0$')
    expect(stab.claimNote).toContain('反過來不成立')
    expect(mathTextProblems(stab.claimNote)).toEqual([])
    // 計算核心：極性通過、穩定失敗（反過來不成立的例子）
    const r = evaluateThesis({ ...DEFAULT_PARAMS, mu: 100, d: 2 })
    expect(r.polarity.C).toBeGreaterThan(0)
    expect(r.stable).toBe(false)
  })

  it('卡片 3 的判據排成兩行（一行有 457px，比 1280px 桌機上 407px 的卡片寬）：內容與原來的一行相同', () => {
    const stab = SIX_CONDITIONS.find((c) => c.id === 'stability')!
    expect(stab.tex).toBe(String.raw`\begin{gathered}p=1-\mu K_q C\\[2pt]0<g<2\sin\frac{\pi}{4d+2}\quad(g=\mu K_qC)\end{gathered}`)
    // 原來那一行 p = 1 − μK_qC,  0 < g < 2 sin(π/(4d+2))  (g = μK_qC) 的三個部分都在，沒有多也沒有少
    const oneLine = String.raw`p=1-\mu K_q C,\qquad 0<g<2\sin\frac{\pi}{4d+2}\quad(g=\mu K_qC)`
    const [first, second] = oneLine.split(String.raw`,\qquad `)
    expect(stab.tex).toBe(String.raw`\begin{gathered}${first}\\[2pt]${second}\end{gathered}`)
    expect(renderTex(stab.tex, true)).not.toMatch(/katex-error|c-tex-error/)
    // 卡片 6 也是 gathered 兩行（同一種排法）
    expect(SIX_CONDITIONS.find((c) => c.id === 'system')!.tex.startsWith(String.raw`\begin{gathered}`)).toBe(true)
  })

  it('R14：卡片 6 的名稱與範圍——殘餘誤差「在預算內」（DTC-referred），不是「真正改善輸出」', () => {
    const c = SIX_CONDITIONS.find((x) => x.id === 'system')!
    expect(c.zh).toBe('殘餘誤差在預算內')
    expect(c.zh).not.toContain('$') // 名稱原樣印在 Hero、體檢表、chip、HC-DB.6
    expect(c.zh + c.en + c.ask).not.toMatch(/改善|變好|performance/)
    expect(c.claim).toBe('approx')
    for (const need of ['單參數', 'DTC-referred', '不是輸出 jitter', '不和校正前比']) expect(c.claimNote, need).toContain(need)
    expect(c.failure).not.toContain('jitter')
    expect(renderTex(c.tex, true)).not.toMatch(/katex-error|c-tex-error/)
    expect(c.tex).toContain(String.raw`\le\sigma_{\delta t,\max}`)
    expect(c.tex).toContain(String.raw`\le\mathrm{Spur}_{\max}`)
    // 卡片上的式子就是單參數時燈號比的量
    const r = evaluateThesis(DEFAULT_PARAMS)
    expect(r.sigmaDt).toBeCloseTo(Math.sqrt(DEFAULT_PARAMS.Px * (r.deltaW ** 2 + r.sigmaW ** 2)), 14)
    expect(r.sigmaDt).toBeCloseTo(0.41152105263, 10)
  })

  it('極性條件的失敗說明分清楚 C < 0（發散）與 C = 0（random walk），與計算核心的判定一致', () => {
    const pol = SIX_CONDITIONS.find((c) => c.id === 'polarity')!
    expect(pol.failure).toContain('$C<0$：平均誤差每個 block 放大（發散）')
    expect(pol.failure).toContain('$C=0$：沒有恢復力，係數隨雜訊 random walk')
    const neg = evaluateThesis({ ...presetParams(THESIS_PRESETS[0]), phiDeg: 120 })
    expect(1 - neg.g).toBeGreaterThan(1)
    const zero = evaluateThesis({ ...presetParams(THESIS_PRESETS[0]), phiDeg: 90 })
    expect(1 - zero.g).toBe(1)
  })
})

