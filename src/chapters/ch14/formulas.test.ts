import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import katex from 'katex'
import { extractRegion, listRegions } from '@/components'
import { FORMULAS } from './formulas'

const DIR = resolve(process.cwd(), 'src/chapters/ch14')

function chapterSources(): string {
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name))
      else if (f.name.endsWith('.tsx') && !f.name.endsWith('.test.tsx')) files.push(join(d, f.name))
    }
  }
  walk(DIR)
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

describe('Ch14 公式登錄（formulas.ts）', () => {
  it('ID 唯一、格式 F-14.n、連續編號', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id, i) => expect(id).toBe(`F-14.${i + 1}`))
  })

  it('每一條都在頁面上以 TexBlock id 出現（頁面與登錄一致）', () => {
    const src = chapterSources()
    for (const f of FORMULAS) expect(src).toContain(`id="${f.id}"`)
  })

  it('每一條 TeX 都能被 KaTeX 解析（throwOnError）', () => {
    for (const f of FORMULAS) expect(() => katex.renderToString(f.tex, { throwOnError: true, strict: 'ignore' })).not.toThrow()
  })

  it('title／conditions 裡的數學都寫成 $…$（KaTeX 可解析），沒有 Unicode 拼湊、沒有落單的 $；units 是純文字', () => {
    const MATH = /(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g
    for (const f of FORMULAS) {
      for (const text of [f.title, f.conditions]) {
        for (const m of text.matchAll(MATH)) expect(() => katex.renderToString(m[1], { throwOnError: true, strict: 'ignore' }), `${f.id}: ${m[1]}`).not.toThrow()
        const prose = text.replace(MATH, ' ')
        expect(prose, `${f.id}: 落單的 $`).not.toContain('$')
        expect(prose, `${f.id}: 數學寫在 $ 外面`).not.toMatch(/\\[a-zA-Z]+|\^\{|_\{/)
        expect(prose, `${f.id}: Unicode 拼湊的數學：${text}`).not.toMatch(/[Ͱ-Ͽ²³¹⁰-₟≤≥≈≠≪≫⇒⇔√∑∝∞∂∠±∓∫]/)
      }
      // Formula Reference 頁把 units 當純文字顯示（不經 mathText）：不能放 $ 或 TeX 指令
      for (const u of Object.values(f.units ?? {})) expect(u, f.id).not.toMatch(/\$|\\[a-zA-Z]+|[Ͱ-Ͽ²³∫≈]/)
    }
    // 有數學的條目確實用了 $…$
    expect(FORMULAS.filter((f) => f.conditions.includes('$')).length).toBeGreaterThanOrEqual(18)
  })

  it('勘誤 E16、E48 都有對應公式；欄位完整', () => {
    expect(FORMULAS.filter((f) => f.erratumId === 'E16').map((f) => f.id)).toEqual(['F-14.15', 'F-14.16'])
    expect(FORMULAS.filter((f) => f.erratumId === 'E48').length).toBeGreaterThanOrEqual(3)
    for (const f of FORMULAS) {
      expect(f.page).toBe('/ch/14')
      expect(f.title.length).toBeGreaterThan(0)
      expect(f.conditions.length).toBeGreaterThan(0)
      expect(['exact', 'approx', 'research']).toContain(f.claim)
    }
  })
})

describe('Ch14 TeX 字串的反斜線', () => {
  it("一般字串（非 String.raw）裡的 TeX 指令都寫成 '\\\\name'：單一反斜線會被 JS 吃掉（'\\t' 變 tab、'\\d' 變 d）", () => {
    const src = chapterSources()
    const bad: string[] = []
    // 單引號字串
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      for (const mm of m[1].matchAll(/(?<!\\)\\[A-Za-z,;! ]/g)) bad.push(m[1].slice(Math.max(0, (mm.index ?? 0) - 8), (mm.index ?? 0) + 10))
    }
    // 非 String.raw 的模板字串
    for (const m of src.matchAll(/(String\.raw)?`((?:[^`\\]|\\.)*)`/g)) {
      if (m[1]) continue
      for (const mm of m[2].matchAll(/(?<!\\)\\[A-Za-z,;! ]/g)) bad.push(m[2].slice(Math.max(0, (mm.index ?? 0) - 8), (mm.index ?? 0) + 10))
    }
    expect(bad).toEqual([])
  })
})

describe('Ch14 原始碼沒有被吃掉的跳脫字元', () => {
  it("章節 TSX 與模型原始碼不含 tab／控制字元（'\\theta' 的 '\\t' 被轉成 tab 時，KaTeX 會靜靜地顯示成 heta，不會報錯）", () => {
    const model = ['optimizer', 'acquisition'].map((m) => readFileSync(resolve(process.cwd(), `src/simulation/models/${m}.ts`), 'utf8')).join('\n')
    // eslint-disable-next-line no-control-regex
    const ctrl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\t]/
    const hits = (chapterSources() + '\n' + model)
      .split('\n')
      .filter((l) => ctrl.test(l))
      .map((l) => l.trim().slice(0, 80))
    expect(hits).toEqual([])
  })

  it('String.raw 模板裡沒有多寫一層的反斜線（\\\\mu 在 String.raw 內會變成換行指令加 mu）', () => {
    const src = chapterSources()
    const bad: string[] = []
    for (const m of src.matchAll(/String\.raw`((?:[^`\\]|\\.)*)`/g)) {
      // 合法的 \\\\ 只會出現在 aligned 等環境的換行（後面接換行或空白或 &），不會直接接英文字母
      for (const mm of m[1].matchAll(/\\\\[A-Za-z]/g)) bad.push(m[1].slice(Math.max(0, (mm.index ?? 0) - 10), (mm.index ?? 0) + 12))
    }
    expect(bad).toEqual([])
  })
})

describe('Ch14 顯示的程式碼 region 都存在於實際執行的模型', () => {
  it('每個 region="…" 都能從對應的模型檔擷取（optimizer.ts；§14.6b 用 acquisition.ts），含 Research 模式才顯示的', () => {
    const src = chapterSources()
    const models: Record<string, string> = {
      optimizerSrc: readFileSync(resolve(process.cwd(), 'src/simulation/models/optimizer.ts'), 'utf8'),
      acquisitionSrc: readFileSync(resolve(process.cwd(), 'src/simulation/models/acquisition.ts'), 'utf8'),
    }
    const regions = new Map(Object.entries(models).map(([k, m]) => [k, new Set(listRegions(m))] as const))
    // 每個 region 往前找最近的 source={xxxSrc}／source: xxxSrc，決定它屬於哪個模型檔（沒找到就是 optimizer）
    const used: [string, string][] = []
    for (const m of src.matchAll(/region[=:]\s*["']([\w.-]+)["']/g)) {
      const back = src.slice(Math.max(0, (m.index ?? 0) - 400), m.index)
      const srcVar = Array.from(back.matchAll(/source[=:]\s*\{?(\w+Src)/g)).at(-1)?.[1] ?? 'optimizerSrc'
      used.push([srcVar, m[1]])
    }
    expect(used.length).toBeGreaterThan(14)
    expect(used.filter(([v]) => v === 'acquisitionSrc').map(([, r]) => r).sort()).toEqual(['acqStep', 'fllClosedForm', 'harmonicCapture', 'lockDetectStats', 'phaseLockClosedForm'])
    for (const [v, r] of used) {
      expect(models[v], `${v} 不是已知的模型檔`).toBeTruthy()
      expect(regions.get(v)!.has(r), `${v} 沒有 region ${r}`).toBe(true)
      expect(extractRegion(models[v], r).length).toBeGreaterThan(0)
    }
  })

  it('CodeCompare 的三個排程 region 各有一行「← 差異」標記', () => {
    const model = readFileSync(resolve(process.cwd(), 'src/simulation/models/optimizer.ts'), 'utf8')
    for (const r of ['runFixedMu', 'runTwoPhase', 'runInverseK']) expect(extractRegion(model, r).split('\n').filter((l) => l.includes('← 差異')).length).toBe(1)
  })
})
