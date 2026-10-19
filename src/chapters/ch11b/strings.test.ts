import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderTex } from '@/components'
import { BASIS_LABEL, CODE_KIND_LABEL, STRUCTURE_LABEL, analyzeInlStructure, foldingAnalysis, hardwareCost, DEFAULT_STRUCTURE, simulateInlLms } from '@/simulation/models/dtcInl'
import { CH11B_DIAGRAMS } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { SYMBOLS } from './index'

/**
 * Ch11b 的「字串屬性」LaTeX 檢查（docs/teaching-style.md §3）：
 * 會被 mathText 渲染的字串（公式登錄的 title／conditions、圖名與圖說、模型的警告與硬體說明、符號表的符號）裡的數學一律寫成 `$…$`，
 * `$` 成對、每一段都能被 KaTeX 解析、公式外沒有 Unicode 拼的數學、沒有 NaN。
 */

vi.setConfig({ testTimeout: 120000 })

const UNICODE_MATH = /[σμκεφρλθωΩΣΔπ√²³⁴⁻¹₀₁₂₃ₖ≤≥≈≠≡∂∈∞]/

function mathProblems(text: string, where: string): string[] {
  const bad: string[] = []
  const parts = text.split('$')
  if (parts.length % 2 === 0) bad.push(`${where}：$ 不成對 —— ${text}`)
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      if (p.trim() === '') bad.push(`${where}：空的 $$ —— ${text}`)
      if (/katex-error|c-tex-error/.test(renderTex(p, false))) bad.push(`${where}：KaTeX 無法解析 ${p}`)
    } else if (UNICODE_MATH.test(p)) bad.push(`${where}：公式外有 Unicode 數學字元 —— ${p}`)
  })
  if (/NaN|undefined/.test(text)) bad.push(`${where}：出現 NaN／undefined —— ${text}`)
  return bad
}

describe('Ch11b 字串屬性的 LaTeX', () => {
  it('公式登錄：14 條、ID 依序 F-11B.1…14、page /ch/11b、tex 可解析、title／conditions 的數學都在 $…$ 內', () => {
    expect(FORMULAS.map((f) => f.id)).toEqual(Array.from({ length: 14 }, (_, i) => `F-11B.${i + 1}`))
    const bad: string[] = []
    for (const f of FORMULAS) {
      expect(f.page).toBe('/ch/11b')
      expect(f.specSection).toBe('11')
      if (/katex-error|c-tex-error/.test(renderTex(f.tex, true))) bad.push(`${f.id} tex`)
      bad.push(...mathProblems(f.title, `${f.id} title`), ...mathProblems(f.conditions, `${f.id} conditions`))
    }
    expect(bad).toEqual([])
    expect(FORMULAS.filter((f) => f.claim === 'exact').length).toBeGreaterThanOrEqual(6)
    expect(FORMULAS.filter((f) => f.claim === 'approx').length).toBeGreaterThanOrEqual(5)
  })

  it('方塊圖的 title／caption、手算題的 title／label／why／notes／tips', () => {
    const bad: string[] = []
    for (const d of CH11B_DIAGRAMS) bad.push(...mathProblems(d.title, `${d.id} title`), ...mathProblems(d.caption, `${d.id} caption`))
    for (const h of HANDCALCS) {
      bad.push(...mathProblems(h.title, `${h.id} title`))
      for (const i of h.inputs) bad.push(...mathProblems(i.label, `${h.id} ${i.key}`))
      for (const t of h.tips ?? []) bad.push(...mathProblems(t, `${h.id} tip`))
    }
    expect(bad).toEqual([])
  })

  it('符號表：每個符號的 TeX 可解析、單位可解析、意義欄沒有殘留的 $', () => {
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(20)
    const bad: string[] = []
    for (const s of SYMBOLS) {
      if (/katex-error|c-tex-error/.test(renderTex(s.symbol, false))) bad.push(`symbol ${s.symbol}`)
      if (s.unit && /katex-error|c-tex-error/.test(renderTex(s.unit, false))) bad.push(`unit ${s.unit}`)
      if (typeof s.meaning === 'string') bad.push(...mathProblems(s.meaning, `meaning ${s.symbol}`))
    }
    expect(bad).toEqual([])
  })

  it('模型的標籤（<option> 用：純文字，可含 Unicode 下標）與硬體說明（$…$）', () => {
    for (const label of [...Object.values(STRUCTURE_LABEL), ...Object.values(CODE_KIND_LABEL), ...Object.values(BASIS_LABEL)]) expect(label).not.toContain('$')
    for (const c of [{ ...DEFAULT_STRUCTURE }, { ...DEFAULT_STRUCTURE, structure: 'lut' as const }, { ...DEFAULT_STRUCTURE, structure: 'poly' as const }, { ...DEFAULT_STRUCTURE, structure: 'poly' as const, basis: 'legendre' as const }])
      expect(mathProblems(hardwareCost(c).note, `cost ${c.structure}`)).toEqual([])
  })

  it('模型的警告字串（折返、分析、模擬）都經得起 mathText', () => {
    const w: string[] = []
    w.push(...foldingAnalysis({ code: { kind: 'mash111', frac: 0.3, length: 1 << 12 }, shape: { d2: 0, d3: 20, sawAmp: 5, sawSegments: 8 }, sigmaV: 1, fs: 100e6, fB: 20e3, nperseg: 1024, seed: 1 }).warnings)
    w.push(...foldingAnalysis({ code: { kind: 'first_order', frac: 0.3, length: 1 << 12 }, shape: { d2: 20, d3: 0, sawAmp: 0, sawSegments: 8 }, sigmaV: 1, fs: 100e6, fB: 1e6, seed: 1 }).warnings)
    w.push(...analyzeInlStructure({ config: { ...DEFAULT_STRUCTURE, gainMode: 'adapt' }, shape: { d2: 20, d3: 0, sawAmp: 0, sawSegments: 8 }, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 400, N: 64 }).warnings)
    w.push(...simulateInlLms({ config: { ...DEFAULT_STRUCTURE, structure: 'lut', J: 64 }, shape: { d2: 20, d3: 0, sawAmp: 0, sawSegments: 8 }, code: { kind: 'mash111', frac: 0.3 }, a: 1, w0: 1, b: 0, sigmaV: 1, mu: 2, N: 64, blocks: 100, algorithm: 'sign', seed: 1 }).warnings)
    expect(w.length).toBeGreaterThanOrEqual(6)
    const bad = w.flatMap((t, i) => mathProblems(t, `warning ${i}`))
    expect(bad).toEqual([])
  })

  it('presets 的 title／description／expected 沒有未成對的 $（它們是純文字，允許 Unicode 符號）', () => {
    const dir = join(process.cwd(), 'src/data/presets')
    for (const f of readdirSync(dir).filter((n) => /^dtc-inl-/.test(n))) {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { title: string; description: string; expected: string }
      for (const t of [p.title, p.description, p.expected]) {
        expect((t.match(/\$/g) ?? []).length % 2, f).toBe(0)
        expect(t).not.toMatch(/NaN|undefined/)
      }
    }
  })
})
