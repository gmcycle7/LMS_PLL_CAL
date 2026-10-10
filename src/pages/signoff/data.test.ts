import { readFileSync, readdirSync } from 'node:fs'
import katex from 'katex'
import { join } from 'node:path'
import { PAGES } from '@/app/registry'
import { listRegions } from '@/components/codeRegion'
import { ALL_CASES, LIMITATIONS, NEGATIVE_TESTS, SIGNOFF_CASES, STATEMENTS, STABILITY_NOTIONS } from './data'
import { FORMULAS } from './formulas'
import { negativeSignatures } from './judges'
import { TOC } from './shared'

/** data.ts 與 TOC 中所有會以 RichText（`$…$` → KaTeX）顯示的字串。 */
function richTexts(): string[] {
  const out: string[] = []
  const link = (l: { label: string }) => out.push(l.label)
  for (const c of ALL_CASES) {
    out.push(c.title, c.verify, c.judge, c.why)
    for (const k of c.checks) {
      out.push(k.title, k.verify, k.judge)
      k.links.forEach(link)
    }
  }
  for (const t of NEGATIVE_TESTS) {
    out.push(t.title, t.inject, t.expect)
    t.links.forEach(link)
  }
  for (const l of LIMITATIONS) {
    out.push(l.title, l.body, l.action)
    l.links.forEach(link)
  }
  for (const s of STATEMENTS) out.push(s.text, s.means, s.caveat)
  for (const n of STABILITY_NOTIONS) out.push(n.proofObject, n.evidence)
  for (const t of TOC) out.push(t.label)
  return out
}

const ROOT = process.cwd()
const DIR = join(ROOT, 'src', 'pages', 'signoff')
const validation = readFileSync(join(ROOT, 'docs', 'validation.md'), 'utf8')

function tsxSources(): string {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(readFileSync(join(d, e.name), 'utf8'))
    }
  }
  walk(DIR)
  return out.join('\n')
}

describe('Sign-off 內容資料的完整性', () => {
  it('§16.2 的七個 case 加上 SSPLL 與反面測試都在 matrix 中，check id 全站唯一', () => {
    expect(SIGNOFF_CASES.map((c) => c.title)).toEqual(['基本正確性', 'Corner', 'FCW', 'Noise', '非線性', '多參數', '校正策略', 'SSPLL GOS / PHOS 極性檢查'])
    const ids = ALL_CASES.flatMap((c) => c.checks.map((k) => k.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of ALL_CASES) expect(c.checks.length).toBeGreaterThanOrEqual(5)
  })

  it('所有含行內數學的文字，$ 的數量都是偶數（RichText 才不會把文字當 TeX）', () => {
    const texts: string[] = []
    for (const c of ALL_CASES) {
      texts.push(c.verify, c.judge, c.why)
      for (const k of c.checks) texts.push(k.title, k.verify, k.judge)
    }
    for (const t of NEGATIVE_TESTS) texts.push(t.inject, t.expect)
    for (const l of LIMITATIONS) texts.push(l.body)
    for (const s of STATEMENTS) texts.push(s.text, s.means, s.caveat)
    for (const n of STABILITY_NOTIONS) texts.push(n.proofObject)
    for (const t of texts) expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
    for (const t of richTexts()) expect((t.match(/\$/g) ?? []).length % 2, t).toBe(0)
  })

  it('資料中的每一段 TeX（行內 $…$ 與獨立公式）都能被 KaTeX 解析（throwOnError）', () => {
    const tex: string[] = []
    for (const t of richTexts()) {
      const parts = t.split('$')
      for (let i = 1; i < parts.length; i += 2) tex.push(parts[i])
    }
    for (const c of ALL_CASES) for (const k of c.checks) if (k.criterion) tex.push(k.criterion)
    for (const t of NEGATIVE_TESTS) for (const s of t.signature) tex.push(s.label)
    for (const l of LIMITATIONS) tex.push(l.math)
    for (const s of STATEMENTS) tex.push(s.math)
    for (const n of STABILITY_NOTIONS) tex.push(n.definition)
    for (const f of FORMULAS) tex.push(f.tex)
    expect(tex.length).toBeGreaterThan(250)
    for (const t of tex) expect(() => katex.renderToString(t, { throwOnError: true, strict: 'ignore' }), t).not.toThrow()
  })

  it('顯示用文字不以 Unicode 拼公式：$…$ 之外沒有希臘字母、上下標字元或帶 hat 的字母（teaching-style §3）', () => {
    const bad = /[α-ωΑ-Ω√∑∂₀-₉⁰-⁹²³]|\u0302|\u0304/u // 希臘字母、根號／求和／偏微分、上下標數字、combining hat／macron
    for (const t of richTexts()) {
      const outside = t
        .split('$')
        .filter((_, i) => i % 2 === 0)
        .join(' ')
      expect(bad.test(outside), t).toBe(false)
    }
  })

  it('站內連結都指向已註冊的路由；本頁錨點都存在', () => {
    const paths = new Set(PAGES.map((p) => p.path))
    const anchors = new Set([...TOC.map((t) => t.id), ...ALL_CASES.map((c) => `so-case-${c.id}`)])
    const links = [...ALL_CASES.flatMap((c) => c.checks.flatMap((k) => k.links)), ...NEGATIVE_TESTS.flatMap((t) => t.links), ...LIMITATIONS.flatMap((l) => l.links)]
    for (const l of links) {
      if (l.to.startsWith('#')) expect(anchors.has(l.to.slice(1)), l.to).toBe(true)
      else expect(paths.has(l.to), l.to).toBe(true)
    }
    for (const c of ALL_CASES) if (c.anchor) expect(anchors.has(c.anchor), c.anchor).toBe(true)
  })

  it('引用的勘誤編號都存在於 docs/validation.md', () => {
    const ids = new Set<string>()
    for (const c of ALL_CASES) for (const k of c.checks) k.errata?.forEach((e) => ids.add(e))
    for (const t of NEGATIVE_TESTS) t.errata?.forEach((e) => ids.add(e))
    for (const l of LIMITATIONS) l.errata?.forEach((e) => ids.add(e))
    for (const f of FORMULAS) if (f.erratumId) ids.add(f.erratumId)
    // 頁面原始碼中的 <ErratumTag id="Exx" /> 與 <ErratumNote id="Exx">
    for (const m of tsxSources().matchAll(/Erratum(?:Tag|Note) id="(E\d\d)"/g)) ids.add(m[1])
    expect(ids.size).toBeGreaterThan(20)
    for (const id of ids) expect(validation.includes(`### ${id}｜`), id).toBe(true)
  })

  it('§17 的九個反面測試全部列出（另有本站補充），每個數學特徵都由 negativeSignatures() 算得', () => {
    const fromSpec = NEGATIVE_TESTS.filter((t) => t.fromSpec).map((t) => t.title)
    expect(fromSpec).toEqual([
      '極性反轉',
      '完全缺乏 PE',
      'Code misalignment',
      '$N$ 改變卻忘記 scaling',
      '定點 Overflow',
      String.raw`錯誤位元符號（0/1 沒有映射成 $\pm1$）`,
      'PLL 誤差路徑與輸出路徑混淆',
      '低取樣率的 aliasing',
      '模型公式有錯，UI 卻顯示成功',
    ])
    const sig = negativeSignatures()
    for (const t of NEGATIVE_TESTS) for (const s of t.signature) expect(Number.isFinite(sig[s.key]), `${t.id}:${String(s.key)}`).toBe(true)
  })

  it('附錄 B 十項限制、§16.3 的五句原句（三 ✅ 兩 ❌）都在', () => {
    expect(LIMITATIONS.map((l) => l.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const spec = STATEMENTS.filter((s) => s.source === 'spec')
    expect(spec.length).toBe(5)
    expect(spec.filter((s) => s.ok).length).toBe(3)
    expect(STATEMENTS.some((s) => s.text === 'LMS 一定穩定。' && !s.ok)).toBe(true)
  })

  it('formulas.ts 的每個 ID 唯一，且頁面上恰好有一個同 ID 的 TexBlock 錨點', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    const src = tsxSources()
    for (const id of ids) {
      const n = (src.match(new RegExp(`id="${id.replace('.', '\\.')}"`, 'g')) ?? []).length
      expect(n, id).toBe(1)
    }
    for (const f of FORMULAS) expect(f.page).toBe('/signoff')
  })

  it('formulas.ts 的 title／conditions（彙整頁以 mathText 顯示）：$ 成對、每段 TeX 可解析、$…$ 之外不以 Unicode 拼公式', () => {
    const bad = /[α-ωΑ-Ω√∑∂₀-₉⁰-⁹²³≤≥≈±−×]|\u0302|\u0304/u
    expect(FORMULAS.map((f) => f.id)).toEqual(FORMULAS.map((_, i) => `F-SO.${i + 1}`))
    let inline = 0
    for (const f of FORMULAS) {
      for (const t of [f.title, f.conditions]) {
        const parts = t.split('$')
        expect(parts.length % 2, `${f.id}: ${t}`).toBe(1)
        for (let i = 1; i < parts.length; i += 2) {
          inline++
          expect(() => katex.renderToString(parts[i], { throwOnError: true, strict: 'ignore' }), `${f.id}: ${parts[i]}`).not.toThrow()
        }
        expect(bad.test(parts.filter((_, i) => i % 2 === 0).join(' ')), `${f.id}: ${t}`).toBe(false)
      }
      expect(f.conditions.length, f.id).toBeGreaterThan(8)
      // units 在彙整頁是純文字：不放 TeX
      for (const u of Object.values(f.units ?? {})) expect(u, f.id).not.toMatch(/[$\\^]/)
    }
    expect(inline).toBeGreaterThan(20)
  })

  it('TeX 字串的跳脫寫法沒有不會報錯、卻會顯示錯誤的陷阱', () => {
    const src = [tsxSources(), readFileSync(join(DIR, 'data.ts'), 'utf8'), readFileSync(join(DIR, 'judges.ts'), 'utf8'), readFileSync(join(DIR, 'formulas.ts'), 'utf8')].join('\n')
    // (1) JSX 屬性字串（title="…"）裡反斜線不是跳脫字元：寫成 "\\sigma" 會被 KaTeX 當成換行 + 文字
    expect(src.match(/\s[a-zA-Z]+="[^"\n]*\\\\[^"\n]*"/g) ?? []).toEqual([])
    // (2) String.raw 內「恰好兩個反斜線 + 字母」同樣是換行 + 文字（矩陣換列後接指令應該是三個反斜線）
    const raws = Array.from(src.matchAll(/String\.raw`((?:[^`\\]|\\.|\$\{[^}]*\})*)`/gs)).map((m) => m[1])
    expect(raws.length).toBeGreaterThan(300)
    const doubled = raws.flatMap((r) => Array.from(r.matchAll(/(?<!\\)\\\\(?!\\)[A-Za-z]/g)).map((m) => r.slice(Math.max(0, m.index - 20), m.index + 12)))
    expect(doubled).toEqual([])
    // (3) 一般字串中 \t、\n、\b、\f、\r、\v 後面接字母，多半是忘了雙反斜線的 \theta、\nu、\beta、\frac、\rho、\varepsilon
    const plain = src.replace(/String\.raw`(?:[^`\\]|\\.|\$\{[^}]*\})*`/gs, 'RAW')
    const ctrl = Array.from(plain.matchAll(/(?<!\\)\\[tbfrv][A-Za-z]/g)).map((m) => plain.slice(Math.max(0, m.index - 20), m.index + 12))
    expect(ctrl.filter((c) => !c.includes('\\times10^{}'))).toEqual([])
  })

  it('頁面引用的 #region core:* 都存在於 judges.ts', () => {
    const regions = new Set(listRegions(readFileSync(join(DIR, 'judges.ts'), 'utf8')))
    for (const m of tsxSources().matchAll(/region(?:=|: )["']([\w.-]+)["']/g)) expect(regions.has(m[1]), m[1]).toBe(true)
  })
})
