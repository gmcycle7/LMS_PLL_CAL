import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { fireEvent, render, within } from '@testing-library/react'
import { HandCalc, defaultValues, inputError, randomValues } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { svd, variance } from '@/simulation/core'
import { CORNER_JUDGE_DEFAULT } from './experiments/CornerJudge'
import { SSPLL_DEFAULT } from './experiments/SspllJacobian'
import { FORMULAS } from './formulas'
import { HANDCALCS, handcalc } from './handcalcs'
import * as J from './judges'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src', 'pages', 'signoff')

const values = (def: HandCalcDef, v: Record<string, number>): number[] => def.solve(v).results.map((r) => r.value)

/** |actual − expected| ≤ abs + rel·|expected| */
function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, label = '') {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}`).toBeLessThanOrEqual(abs + rel * Math.abs(expected))
}

/** 把 defaults 換成指定數字的同一題（HandCalc 以 defaults 當初始輸入，用來渲染任意數字） */
const withValues = (def: HandCalcDef, v: Record<string, number>): HandCalcDef => ({ ...def, inputs: def.inputs.map((i) => ({ ...i, default: v[i.key] })) })

/** 元素的文字，去掉 KaTeX：字串裡的 `$…$` 若沒有成對（或沒被 mathText 處理），這裡會看到殘留的 `$` */
function proseText(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll('.katex').forEach((k) => k.remove())
  return c.textContent ?? ''
}

const unpaired = (s: string): boolean => (s.match(/(?<!\\)\$/g) ?? []).length % 2 !== 0
/** 公式裡不可以印出 NaN／∞／undefined */
const badNumber = (tex: string): boolean => /NaN|undefined|\\infty/.test(tex)
/** `$…$` 之外的文字（檢查有沒有用 Unicode 拼公式） */
const outsideMath = (s: string): string =>
  s
    .split(/(?<!\\)\$/)
    .filter((_, i) => i % 2 === 0)
    .join(' ')
/** 希臘字母、根號／求和／偏微分、上下標數字、combining hat／macron（teaching-style §3） */
const UNICODE_MATH = /[α-ωΑ-Ω√∑∂₀-₉⁰-⁹²³]|̂|̄/u
/** 字串中每一段 `$…$` 都能被 KaTeX 解析 */
function expectInlineTexOk(s: string) {
  const parts = s.split(/(?<!\\)\$/)
  for (let i = 1; i < parts.length; i += 2) expect(() => katex.renderToString(parts[i], { throwOnError: true, strict: 'ignore' }), parts[i]).not.toThrow()
}

const SQ = Math.sqrt(2 / Math.PI)
const RAD = Math.PI / 180

/**
 * 獨立重算：直接在測試裡把公式再寫一次（刻意不呼叫 judges.ts，而且盡量用「另一種寫法」：
 * 用搜尋取代 ⌈·⌉、用連乘取代 ln、用 eigenvalue 取代 det/σ_max），和 solve()（呼叫實際函式）逐一比對。順序與各題 results 相同。
 */
const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-SO.1': ({ sigmaV, theta, delta, N, M, zt }) => {
    const K = (SQ * Math.cos(theta * RAD)) / sigmaV
    const zOf = (m: number) => Math.abs(K) * delta * Math.sqrt(2 * m * N)
    // 不用 ⌈z_t²/(2NΔ²K²)⌉：直接找「|z(M')| ≥ z_t 的最小整數 M'」
    let mMin = Math.max(1, Math.floor((zt / zOf(1)) ** 2) - 2)
    while (zOf(mMin) < zt * (1 - 1e-12)) mMin++
    return [K, 1 / (delta * Math.sqrt(2 * M * N)), K * delta * Math.sqrt(2 * M * N), mMin]
  },
  'HC-SO.2': ({ rho, cG, cP, sigmaV, delta, N, M, z }) => {
    const det = cG * cP * (1 - rho * rho)
    // σ_min² 是 BᵀB 較小的 eigenvalue：t² − F·t + det² = 0 取「−」號（solve() 用的是 |det|/σ_max）
    const F = (1 + rho * rho) * (cG * cG + cP * cP)
    const lamMin = (F - Math.sqrt(Math.max(0, F * F - 4 * det * det))) / 2
    const sMin = (SQ / sigmaV) * Math.sqrt(Math.max(0, lamMin))
    const thr = (2 * z) / (delta * Math.sqrt(2 * M * N))
    return [det, sMin, thr, sMin / thr]
  },
  'HC-SO.3': ({ n, alpha, pMax }) => {
    // 不用 ⌈ln α/ln(1 − p)⌉：直接找「(1 − p)ⁿ ≤ α 的最小整數 n」
    let nNeed = Math.max(1, Math.floor(Math.log(alpha) / Math.log1p(-pMax)) - 2)
    while (Math.pow(1 - pMax, nNeed) > alpha * (1 + 1e-12)) nNeed++
    return [-Math.expm1(Math.log(alpha) / n), nNeed]
  },
  'HC-SO.4': ({ sigmaF, thetaF, sigmaS, thetaS, mu, d }) => {
    const gF = (mu * SQ * Math.cos(thetaF * RAD)) / sigmaF
    const gS = (mu * SQ * Math.cos(thetaS * RAD)) / sigmaS
    // PM：crossover 2 sin(ω_c/2) = g，直接算 L(e^{jω_c}) 的相位（不用封閉式 90° − (2d+1)·asin）
    const wc = 2 * Math.asin(gF / 2)
    const pm = 180 - ((d * wc + Math.PI / 2 + wc / 2) * 180) / Math.PI
    // ρ：d = 0 是 |1 − g|；d = 1 是二次式的根（複根時 |z|² = 實部² + 虛部²）
    let rhoS: number
    if (d === 0) rhoS = Math.abs(1 - gS)
    else {
      const disc = 1 - 4 * gS
      rhoS = disc >= 0 ? Math.max(Math.abs((1 + Math.sqrt(disc)) / 2), Math.abs((1 - Math.sqrt(disc)) / 2)) : Math.hypot(0.5, Math.sqrt(-disc) / 2)
    }
    // k95：不用 ln、不用 ρᵏ——直接跑平均遞迴 y_{k+1} = y_k − g_S·y_{k−d}（初始歷史 y_j = 1），取「最後一次 |y| > 0.05」的下一個 block
    const y = new Array<number>(d + 1).fill(1)
    let last = 0
    for (let n = 1; n < 20000; n++) {
      y.push(y[y.length - 1] - gS * y[y.length - 1 - d])
      if (Math.abs(y[y.length - 1]) > 0.05) last = n
    }
    const k = last + 1
    return [gF, pm, rhoS, k]
  },
}

/** validate 必須擋下的輸入（docs/teaching-style.md §7），以及訊息中應該出現的解釋。 */
const INVALID: { hc: string; name: string; patch: Record<string, number>; expect: RegExp }[] = [
  { hc: 'HC-SO.1', name: 'θ = 90°（C = 0）', patch: { theta: 90 }, expect: /不可辨識/ },
  { hc: 'HC-SO.1', name: 'θ = −90°（C = 0）', patch: { theta: -90 }, expect: /沒有恢復力/ },
  { hc: 'HC-SO.1', name: 'Δ > σ_v（erf 飽和）', patch: { delta: 150 }, expect: /飽和區/ },
  { hc: 'HC-SO.2', name: 'c_G = c_P = 0（J = 0）', patch: { cG: 0, cP: 0 }, expect: /完全沒有資訊/ },
  { hc: 'HC-SO.2', name: 'Δ|c| > σ_v（erf 飽和）', patch: { delta: 80, cG: 2 }, expect: /飽和區/ },
  { hc: 'HC-SO.3', name: 'α = 0（信心 100%）', patch: { alpha: 0 }, expect: /排除不了/ },
  { hc: 'HC-SO.3', name: 'α = 1（信心 0%）', patch: { alpha: 1 }, expect: /什麼都沒宣稱/ },
  { hc: 'HC-SO.3', name: 'p_max = 0', patch: { pMax: 0 }, expect: /無限多次試驗/ },
  { hc: 'HC-SO.3', name: 'p_max = 1', patch: { pMax: 1 }, expect: /不用做試驗/ },
  { hc: 'HC-SO.4', name: 'd = 2（沒有紙筆可用的求根公式）', patch: { d: 2 }, expect: /三次以上/ },
  { hc: 'HC-SO.4', name: '最慢的 corner θ = 100°（C < 0）', patch: { thetaS: 100 }, expect: /^C ≤ 0：最慢/ },
  { hc: 'HC-SO.4', name: '最快的 corner θ = 90°（C = 0）', patch: { thetaF: 90 }, expect: /^C ≤ 0：最快/ },
  { hc: 'HC-SO.4', name: '快慢填反', patch: { sigmaF: 200, sigmaS: 50, thetaS: 0 }, expect: /對調/ },
  { hc: 'HC-SO.4', name: 'g_F > 2（沒有 crossover）', patch: { mu: 200 }, expect: /沒有 gain crossover/ },
  { hc: 'HC-SO.4', name: 'g_S ≥ g_crit(1)（最慢的 corner 也不穩定）', patch: { mu: 150, sigmaS: 70, thetaS: 10 }, expect: /連最慢的 corner 都不穩定/ },
]

describe('Sign-off 手算題：結構', () => {
  it('四題、ID 連號 HC-SO.n、page 與公式 ID 正確；每個輸入都有手算友善的 practice 範圍；文字欄位不以 Unicode 拼公式', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-SO.1', 'HC-SO.2', 'HC-SO.3', 'HC-SO.4'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page).toBe('/signoff')
      expect(h.level).toBe('engineer') // 四題都要用到 √、ln、cos 或 arcsin，沒有查表或複數運算
      expect(formulaIds.has(h.formulaId as string), h.id).toBe(true)
      expect(() => katex.renderToString(h.formulaTex, { throwOnError: true, strict: 'ignore', displayMode: true }), h.id).not.toThrow()
      for (const i of h.inputs) {
        expect(i.practice?.choices?.length ?? 0, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(2)
        expect(inputError(i, i.default), `${h.id}.${i.key} default`).toBeNull()
        for (const c of i.practice?.choices ?? []) expect(inputError(i, c), `${h.id}.${i.key} = ${c}`).toBeNull()
        // 輸入的白話說明也會當成 aria-label：不放 `$`，也不用 Unicode 拼公式
        expect(i.label, `${h.id}.${i.key}`).not.toContain('$')
        expect(UNICODE_MATH.test(i.label), `${h.id}.${i.key}: ${i.label}`).toBe(false)
        expect(/[=<>≤≥−×]/.test(i.label), `${h.id}.${i.key}: ${i.label}`).toBe(false)
        expect(() => katex.renderToString(i.symbol, { throwOnError: true, strict: 'ignore' })).not.toThrow()
        if (i.unit) expect(() => katex.renderToString(i.unit as string, { throwOnError: true, strict: 'ignore' })).not.toThrow()
      }
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(3)
      for (const t of [h.title, ...(h.tips ?? [])]) {
        expect(unpaired(t), `${h.id}: ${t}`).toBe(false)
        expect(UNICODE_MATH.test(outsideMath(t)), `${h.id}: ${t}`).toBe(false)
        expectInlineTexOk(t)
      }
      const sol = h.solve(defaultValues(h))
      for (const r of sol.results) {
        expect(r.label, `${h.id} ${r.symbol}`).toBeTruthy()
        expect(r.label as string).not.toContain('$')
        expect(UNICODE_MATH.test(r.label as string), r.label).toBe(false)
      }
      // 難度誠實標示：engineer 題的步驟裡真的用到計算機函數
      expect(sol.steps.some((s) => /\\sqrt|\\ln|\\cos|\\arcsin|e\^\{/.test(s.tex)), h.id).toBe(true)
    }
    expect(handcalc('HC-SO.3').id).toBe('HC-SO.3')
    expect(() => handcalc('HC-SO.99')).toThrow(/找不到/)
  })

  it('ID 全站唯一：整個 src 的 handcalcs.ts 裡，HC-SO.n 只在本頁各出現一次，而且沒有別頁使用 HC-SO 前綴', () => {
    const found: { file: string; id: string }[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'handcalcs.ts') for (const m of readFileSync(p, 'utf8').matchAll(/id: '(HC-[^']+)'/g)) found.push({ file: p, id: m[1] })
      }
    }
    walk(join(ROOT, 'src'))
    expect(found.length).toBeGreaterThan(HANDCALCS.length) // 確實掃到別章的題目
    const mine = found.filter((f) => f.id.startsWith('HC-SO.'))
    expect(mine.map((f) => f.id).sort()).toEqual(HANDCALCS.map((h) => h.id).sort())
    for (const f of mine) expect(f.file).toBe(join(DIR, 'handcalcs.ts'))
    for (const h of HANDCALCS) expect(found.filter((f) => f.id === h.id).length, h.id).toBe(1)
  })

  it('TeX 字串的跳脫寫法：String.raw 內沒有「恰好兩個反斜線 + 字母」（KaTeX 不會報錯，卻會顯示成換行 + 文字）', () => {
    const src = readFileSync(join(DIR, 'handcalcs.ts'), 'utf8')
    const raws = Array.from(src.matchAll(/String\.raw`((?:[^`\\]|\\.|\$\{[^}]*\})*)`/gs)).map((m) => m[1])
    expect(raws.length).toBeGreaterThan(120)
    const doubled = raws.flatMap((r) => Array.from(r.matchAll(/(?<!\\)\\\\(?!\\)[A-Za-z]/g)).map((m) => r.slice(Math.max(0, m.index - 20), m.index + 12)))
    expect(doubled).toEqual([])
  })

  it('每一題都放在頁面上對應推導的正後方（先看推導 → 馬上代數字）；被章節重複的題目改成連結', () => {
    const read = (f: string) => readFileSync(join(DIR, 'sections', f), 'utf8')
    const s2 = read('S2Polarity.tsx')
    const s3 = read('S3Claims.tsx')
    const s4 = read('S4Cases.tsx')
    const all = s2 + s3 + s4
    for (const h of HANDCALCS) expect((all.match(new RegExp(`<HandCalcSlot id="${h.id.replace('.', '\\.')}">`, 'g')) ?? []).length, h.id).toBe(1)
    expect((all.match(/<HandCalcSlot id="/g) ?? []).length).toBe(HANDCALCS.length)
    const after = (src: string, a: string, b: string) => {
      expect(src.indexOf(a), a).toBeGreaterThanOrEqual(0)
      expect(src.indexOf(b), b).toBeGreaterThan(src.indexOf(a))
    }
    after(s2, 'id="F-SO.3"', '<HandCalcSlot id="HC-SO.1">') // §2.2 的 se 與所需 block 數
    after(s2, '<HandCalcSlot id="HC-SO.1">', '<PolarityPerturbExperiment />')
    after(s2, 'id="F-SO.12"', '<HandCalcSlot id="HC-SO.2">') // §2.5 的可辨識性門檻
    after(s2, '<HandCalcSlot id="HC-SO.2">', '<SspllJacobianExperiment />')
    after(s3, 'id="F-SO.8"', '<HandCalcSlot id="HC-SO.3">') // §3.5 rule of three
    after(s3, '<HandCalcSlot id="HC-SO.3">', '<EvidenceLabExperiment />')
    after(s4, 'id="F-SO.5"', '<HandCalcSlot id="HC-SO.4">') // §4 PM_d 與 g_crit
    after(s4, '<HandCalcSlot id="HC-SO.4">', '<CornerJudgeExperiment />')
    // 累加器位元（Ch04）、EFB 週期（Ch13）、各自／聯合 pole（Ch10）在原章節已有手算題：本頁放連結，不重複出題
    for (const [src, href] of [
      [s4, '#/ch/04'],
      [s4, '#/ch/13'],
      [s4, '#/ch/08'],
      [s2, '#/ch/10'],
      [s2, '#/workbook'],
    ] as const)
      expect(src.includes(`href="${href}"`), href).toBe(true)
  })
})

describe('Sign-off 手算題：預設值 = 本頁 worked example，答案 = judges.ts 的實際函式', () => {
  it('HC-SO.1 的預設值是 §2.1 的例子（σ_v = 100 fs、θ = 85°、Δ = 20 fs、N = 4096、M = 8、z_t = 3）：z = 3.5605、M_min = 6', () => {
    const def = handcalc('HC-SO.1')
    const d = defaultValues(def)
    expect(d).toEqual({ sigmaV: 100, theta: 85, delta: 20, N: 4096, M: 8, zt: 3 })
    const [K, se, z, mMin] = values(def, d)
    expect(K).toBe(J.kq(100) * Math.cos(85 * RAD))
    expect(se).toBe(J.slopeStdErr(20, 4096, 8))
    expect(se).toBe(1 / 64 / 80) // σ_η = 1/64、Δ√(2M) = 80（全部是 2 的冪，手算沒有捨入）
    expect(z).toBe(K / se)
    expect(mMin).toBe(J.requiredBlocks(K, 20, 4096, 3))
    // 文中（§2.1 表格、思考題 2-1、tips）的數字
    close(K, 6.954e-4, 1e-4)
    close(z, 3.5605, 1e-4)
    expect(mMin).toBe(6)
    // M_min 的意義：M = 6 時 z ≥ z_t，M = 5 時還不夠
    expect(K / J.slopeStdErr(20, 4096, 6)).toBeGreaterThanOrEqual(3)
    expect(K / J.slopeStdErr(20, 4096, 5)).toBeLessThan(3)
    const tips = def.tips!.join('')
    for (const t of ['0.0079788', '0.087156', '0.0006954', '0.00019531', '3.5605']) expect(tips, t).toContain(t)
    // 畫面上的步驟就是這些數字
    const tex = def.solve(d).steps.map((s) => s.tex).join('\n')
    for (const t of ['0.087156', '0.0006954', String.raw`\frac1{64}`, '0.00019531', '3.5605', String.raw`\left\lceil5.6796\right\rceil=6`]) expect(tex, t).toContain(t)
  })

  it('HC-SO.1：預期的 se 就是 centralDifference 在「每個 block 的變異數剛好是 1/N」時算出的 se；模擬量到的 se 與 K_qC 也對得上', () => {
    const [K, se] = values(handcalc('HC-SO.1'), { sigmaV: 100, theta: 85, delta: 20, N: 4096, M: 8, zt: 3 })
    // 合成資料：±a 交替，樣本變異數 = 1/N（用 core 的 variance 定標，不假設它除以 n 還是 n − 1）
    const unit = [1, -1, 1, -1, 1, -1, 1, -1]
    const a = Math.sqrt(1 / 4096 / variance(unit))
    const est = J.centralDifference(
      unit.map((u) => -0.01 + a * u),
      unit.map((u) => 0.01 + a * u),
      20,
    )
    close(est.se, se, 1e-12)
    // 實際的 sample-level 量測（單頻 code、有效相位 85°）：解析 K 相同；樣本標準誤在預期值附近（24 個 block／側，相對誤差約 10%）
    const sim = J.runPolarityPerturbation({ code: 'tone', magH: 1, phiDeg: 85, omega: Math.PI / 6, D: 0, mapping: 'bipolar', sigmaV: 100, a: 3, w0: 3, delta: 20, N: 4096, M: 24, sweepPoints: 0, sweepSpan: 300, sweepBlocks: 1, z: 3, seed: 20261010 })
    close(sim.Klin, K, 1e-12)
    expect(sim.Meff).toBe(24)
    const predicted = J.slopeStdErr(20, 4096, 24)
    expect(Math.abs(sim.est.se / predicted - 1)).toBeLessThan(0.3)
    expect(Math.abs(sim.est.K - K)).toBeLessThanOrEqual(4 * sim.est.se)
  })

  it('HC-SO.1：θ = 95° ⇒ K、z 變負，M_min 不變（只看 |K|）；Δ 介於 0.3σ_v 與 σ_v 時附上截斷比的提醒', () => {
    const def = handcalc('HC-SO.1')
    const d = defaultValues(def)
    const pos = values(def, d)
    const neg = values(def, { ...d, theta: 95 })
    close(neg[0], -pos[0], 1e-12)
    close(neg[2], -pos[2], 1e-12)
    expect(neg[3]).toBe(pos[3])
    expect(def.solve({ ...d, theta: 120, M: 32 }).notes!.join('')).toContain('極性錯誤')
    expect(def.solve({ ...d, theta: 88 }).notes!.join('')).toContain('無法判定')
    const big = def.solve({ ...d, delta: 60 }).notes!.join('')
    expect(big).toContain(String(Number(J.secantRatio(60, 100).toPrecision(4))))
    expect(def.solve(d).notes!.join('')).not.toContain('截斷比')
  })

  it('HC-SO.2 的預設值是 SSPLL 實驗的預設：σ_min(J) = svd(J_lin) 的最小奇異值、門檻 = identifiabilityThreshold，判定與實驗一致', () => {
    const def = handcalc('HC-SO.2')
    const d = defaultValues(def)
    const S = SSPLL_DEFAULT
    expect(S.deltaG).toBe(S.deltaP)
    expect(d).toEqual({ rho: S.rho, cG: S.cG, cP: S.cP, sigmaV: S.sigmaV, delta: S.deltaG, N: S.N, M: S.M, z: S.z })
    const [det, sMin, thr, ratio] = values(def, d)
    const res = J.runTwoParamCheck(S)
    expect(res.Jlin).toEqual(J.twoParamJlin(S))
    expect(sMin).toBe(svd(res.Jlin).S[1])
    const se = J.slopeStdErr(S.deltaG, S.N, S.M)
    expect(thr).toBe(J.identifiabilityThreshold([[se, se], [se, se]], S.z))
    close(thr, 2 * S.z * se, 1e-12)
    expect(ratio).toBe(sMin / thr)
    close(det, 0.728, 1e-12)
    // 行列式與奇異值的關係：|det J| = σ_max·σ_min = K_q²|det B|
    const [s1, s2] = svd(res.Jlin).S
    close(s1 * s2, J.kq(S.sigmaV) ** 2 * Math.abs(det), 1e-10)
    // 和實驗（sample-level 量測、樣本標準誤）比：門檻相差不到 15%，判定相同
    expect(Math.abs(res.sigmaMinThreshold / thr - 1)).toBeLessThan(0.15)
    expect(res.identifiable).toBe(true)
    expect(ratio).toBeGreaterThan(1)
    expect(Math.abs(res.singularValues[1] - sMin)).toBeLessThanOrEqual(4 * Math.hypot(...res.Jse.flat()))
    // tips 與步驟上的數字
    const tips = def.tips!.join('')
    for (const t of ['0.728', '1.7876', '1.1884', '0.61258', '0.0048877', '0.0013532', '3.612']) expect(tips, t).toContain(t)
    const tex = def.solve(d).steps.map((s) => s.tex).join('\n')
    for (const t of [String.raw`\begin{bmatrix}1&0.24\\0.3&0.8\end{bmatrix}`, '=0.728', '=1.7876', '=1.1884', '=0.61258', String.raw`\sqrt{49152}`, '=3.612']) expect(tex, t).toContain(t)
  })

  it('HC-SO.2：c_P 變號 ⇒ det 變號、σ_min 不變；ρ = 0.995 ⇒ 過不了門檻，提示的 M 正好是讓 σ_min 超過門檻的最小值；|ρ| = 1 ⇒ σ_min = 0', () => {
    const def = handcalc('HC-SO.2')
    const d = defaultValues(def)
    const base = values(def, d)
    const flip = def.solve({ ...d, cP: -d.cP })
    close(flip.results[0].value, -base[0], 1e-12)
    close(flip.results[1].value, base[1], 1e-9)
    expect(flip.notes!.join('')).toContain('其中一個 loop 的極性相反')
    expect(def.solve({ ...d, cG: -1, cP: -0.8 }).notes!.join('')).toContain('兩個 loop 的極性「都」相反')
    // 實驗的「不可辨識」preset
    const bad = { ...d, rho: 0.995, cP: 1 }
    const sol = def.solve(bad)
    const [, sMin, , ratio] = sol.results.map((r) => r.value)
    close(sMin, 0.005 * J.kq(d.sigmaV), 1e-6)
    expect(ratio).toBeLessThan(1)
    expect(J.runTwoParamCheck({ ...SSPLL_DEFAULT, rho: 0.995, cP: 1 }).identifiable).toBe(false)
    const mNeed = J.requiredBlocks(sMin, d.delta, d.N, 2 * d.z)
    expect(sol.notes!.join('')).toContain(`M\\ge${mNeed}`)
    const thrAt = (M: number) => J.identifiabilityThreshold([[1, 1], [1, 1]].map((r) => r.map(() => J.slopeStdErr(d.delta, d.N, M))), d.z)
    expect(sMin).toBeGreaterThanOrEqual(thrAt(mNeed))
    expect(sMin).toBeLessThan(thrAt(mNeed - 1))
    expect(mNeed).toBeGreaterThan(10000) // tips：「要一萬多個 block」
    // 完全相關：J 奇異
    const sing = def.solve({ ...d, rho: 1, cP: 1 })
    expect(sing.results.map((r) => r.value).slice(0, 2)).toEqual([0, 0])
    expect(sing.results[3].value).toBe(0)
    expect(sing.notes!.join('')).toContain('奇異')
    expect(sing.steps.some((s) => badNumber(s.tex))).toBe(false)
    // 對稱（c_G = c_P = c）時的心算式：σ = |c|(1 ± |ρ|)
    close(values(def, { ...d, rho: 0.7, cG: 0.5, cP: 0.5 })[1], 0.5 * 0.3 * J.kq(d.sigmaV), 1e-9)
  })

  it('T03: HC-SO.3 的預設值是 §3.5 的 n = 100、α = 0.05、p_max = 1%：p_U = failureUpperBound(0, 100) = 0.029513、n_need = 299', () => {
    const def = handcalc('HC-SO.3')
    const d = defaultValues(def)
    expect(d).toEqual({ n: 100, alpha: 0.05, pMax: 0.01 })
    const [pU, nNeed] = values(def, d)
    expect(pU).toBe(J.failureUpperBound(0, 100, 0.95))
    expect(nNeed).toBe(J.trialsForZeroFailure(0.01, 0.95))
    close(pU, 0.029513, 1e-4)
    expect(nNeed).toBe(299)
    // 意義：n_need 次全過的機率 ≤ α，少一次就 > α；p_U 讓「n 次全過」的機率剛好是 α
    expect(0.99 ** 299).toBeLessThanOrEqual(0.05)
    expect(0.99 ** 298).toBeGreaterThan(0.05)
    close((1 - pU) ** 100, 0.05, 1e-12)
    // rule of three 的高估量約 −ln α/(2n)
    const sol = def.solve(d)
    expect(sol.steps[4].why).toContain(String(Number((100 * (-Math.log(0.05) / 100 / pU - 1)).toPrecision(2))))
    expect(sol.notes![0]).toContain('還不夠')
    expect(def.solve({ ...d, n: 299 }).notes![0]).toContain('已足以')
    const tips = def.tips!.join('')
    for (const t of ['-2.9957', '0.970487', '0.029513', '299']) expect(tips, t).toContain(t)
    const tex = sol.steps.map((s) => s.tex).join('\n')
    for (const t of ['=0.970487', '=0.029513', '=0.029957', String.raw`\left\lceil298.07\right\rceil=299`]) expect(tex, t).toContain(t)
  })

  it('HC-SO.3：n 很大時 α^{1/n} 會多顯示幾位，畫面上的「1 − …」仍然算得出 p_U（不會變成 1 − 1 = 0）', () => {
    const def = handcalc('HC-SO.3')
    for (const n of [1000, 50000, 1_000_000]) {
      const sol = def.solve({ n, alpha: 0.05, pMax: 0.01 })
      const m = /=1-([0-9.]+)=/.exec(sol.steps[3].tex)
      expect(m, sol.steps[3].tex).toBeTruthy()
      close(1 - Number(m![1]), sol.results[0].value, 1e-3, 0, `n=${n}`)
    }
  })

  it('T08: HC-SO.4 的預設值是 Corner 判斷器預設的最快（FF 125°C）與最慢（near-grid FCW）兩列：g、PM、ρ、k95 與判斷器逐位元相同', () => {
    const def = handcalc('HC-SO.4')
    const d = defaultValues(def)
    const C = CORNER_JUDGE_DEFAULT
    const rows = J.cornerJudge(C.corners, { mu: C.mu, d: C.d, pmTargetDeg: C.pmTargetDeg, B: C.B, N: C.N, sigmaWMax: C.sigmaWMax })
    const fast = rows.reduce((a, b) => (b.K > a.K ? b : a))
    const slow = rows.reduce((a, b) => (b.K < a.K ? b : a))
    expect(fast.name).toBe('FF 125°C')
    expect(slow.name).toBe('near-grid FCW')
    const cf = C.corners.find((c) => c.name === fast.name)!
    const cs = C.corners.find((c) => c.name === slow.name)!
    expect(d).toEqual({ sigmaF: cf.sigmaV, thetaF: cf.thetaDeg, sigmaS: cs.sigmaV, thetaS: cs.thetaDeg, mu: C.mu, d: C.d, pmT: C.pmTargetDeg, B: C.B })
    const [gF, pm, rhoS, k95] = values(def, d)
    expect(gF).toBe(fast.g)
    expect(pm).toBe(fast.pm)
    expect(rhoS).toBe(slow.rho)
    expect(k95).toBe(slow.settle95)
    // PM 與封閉式獨立的數值 crossover 相符（judges.pmNumeric）
    close(pm, J.pmNumeric(gF, C.d), 1e-9)
    // 預設題的 g_S = 0.0399 離重根很遠：逐 block 的 k95 = ρ 漸近估計 = 71（ρ^k95 ≤ 0.05 < ρ^(k95 − 1)）；兩者不同的反例見下面的 R02／A6 測試
    expect(slow.settleAsym).toBe(k95)
    expect(rhoS ** k95).toBeLessThanOrEqual(0.05)
    expect(rhoS ** (k95 - 1)).toBeGreaterThan(0.05)
    expect(k95).toBe(71)
    close(pm, 80.348, 1e-5)
    close(rhoS, 0.958373, 1e-6)
    // ρ 真的是 δ_{k+1} = δ_k − g·δ_{k−1} 的衰減率：直接跑遞迴，相鄰兩步的比值收斂到 ρ
    let prev = 1
    let cur = 1
    for (let k = 0; k < 400; k++) [prev, cur] = [cur, cur - slow.g * prev]
    close(cur / prev, rhoS, 1e-9)
    // 兩列都通過 ⇒ 註記說「都通過」，並給出 μ 上限（把它代回去 PM 剛好等於 PM_t）
    const notes = def.solve(d).notes!.join('')
    expect(notes).toContain('兩個 corner 都通過')
    const muMax = (2 * Math.sin(((90 - C.pmTargetDeg) / (2 * C.d + 1)) * RAD)) / fast.K
    expect(notes).toContain(String(Number(muMax.toPrecision(4))))
    close(J.pmDeg(muMax * fast.K, C.d), C.pmTargetDeg, 1e-9)
    const tips = def.tips!.join('')
    for (const t of ['0.11225', '3.2174', '80.35', '0.039894', '0.95837', '71']) expect(tips, t).toContain(t)
    const tex = def.solve(d).steps.map((s) => s.tex).join('\n')
    for (const t of ['=0.11225', '{80.348}^\\circ', '=0.039894', '=0.958373', String.raw`\left\lceil70.458\right\rceil=71`]) expect(tex, t).toContain(t)
  })

  it('HC-SO.4：頁面文字建議的兩個改法（B = 50、μ = 40）各讓一個 corner 不合格；d = 0、複根、deadbeat 三種 ρ 的分支', () => {
    const def = handcalc('HC-SO.4')
    const d = defaultValues(def)
    // B = 50：最慢的 corner 來不及（k95 = 71 > 50）
    const shortB = def.solve({ ...d, B: 50 })
    expect(shortB.notes!.join('')).toContain('來不及收斂')
    expect(shortB.notes!.join('')).not.toContain('兩個 corner 都通過')
    // μ = 40：最快的 corner PM 不足（μ = 30 還過得了）
    expect(def.validate!({ ...d, mu: 40 })).toBeNull()
    const bigMu = def.solve({ ...d, mu: 40 })
    expect(bigMu.results[1].value).toBeLessThan(60)
    expect(bigMu.notes!.join('')).toContain('裕度不足')
    expect(def.solve({ ...d, mu: 30 }).results[1].value).toBeGreaterThanOrEqual(60)
    // d = 0：ρ = |1 − g_S|，PM 多了 2φ
    const d0 = def.solve({ ...d, d: 0 })
    close(d0.results[2].value, 1 - J.kq(100) * 0.5 * 10, 1e-9)
    close(d0.results[1].value - def.solve(d).results[1].value, 2 * Math.asin(d0.results[0].value / 2) * (180 / Math.PI), 1e-9)
    expect(def.tips!.join('')).toContain(String(Number(d0.results[2].value.toPrecision(5))))
    // d = 1、g_S > 1/4：共軛複根，ρ = √g_S
    const cplx = { ...d, mu: 80, sigmaF: 100, thetaF: 60, B: 1000 }
    expect(def.validate!(cplx)).toBeNull()
    const sc = def.solve(cplx)
    const gS = 80 * J.kq(100) * 0.5
    expect(gS).toBeGreaterThan(0.25)
    close(sc.results[2].value, Math.sqrt(gS), 1e-9)
    expect(sc.steps.some((s) => s.tex.includes(String.raw`\sqrt{g_S}`))).toBe(true)
    // d = 0、g_S = 1：deadbeat，ρ = 0 ⇒ k95 = 1（不取 ln 0）
    const mu1 = 1 / (J.kq(100) * Math.cos(60 * RAD))
    const dead = { ...d, d: 0, mu: mu1, sigmaF: 100, thetaF: 60 }
    expect(def.validate!(dead)).toBeNull()
    const sd = def.solve(dead)
    expect(sd.results[2].value).toBeLessThan(1e-12)
    expect(sd.results[3].value).toBe(1)
    expect(sd.steps.some((s) => /\\ln\\rho/.test(s.tex) || badNumber(s.tex))).toBe(false)
  })
})

describe('Sign-off 手算題：隨機 20 題與獨立重算一致', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues(seed 1…20) 都通過 validate、答案有限，且等於測試裡直接重寫的公式', (_id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, JSON.stringify(v)).toBeNull()
      def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${i.key}=${v[i.key]}`).toBeNull())
      const sol = def.solve(v)
      const expected = INDEPENDENT[def.id](v)
      expect(sol.results).toHaveLength(expected.length)
      sol.results.forEach((r, k) => {
        expect(Number.isFinite(r.value), `${r.symbol} @ ${JSON.stringify(v)}`).toBe(true)
        close(r.value, expected[k], 1e-9, 1e-12, `${def.id} ${r.symbol} @ ${JSON.stringify(v)}`)
      })
      // 每一步都是「符號式 = 代入數字 = 結果」，而且有一句說明；TeX 可解析；不會把 NaN／∞ 印進公式
      expect(sol.steps.length).toBeGreaterThan(0)
      for (const s of sol.steps) {
        expect((s.tex.match(/=/g) ?? []).length, s.tex).toBeGreaterThanOrEqual(2)
        expect(badNumber(s.tex), s.tex).toBe(false)
        expect(() => katex.renderToString(s.tex, { throwOnError: true, strict: 'ignore', displayMode: true }), s.tex).not.toThrow()
        expect(s.why.length).toBeGreaterThan(0)
        expect(unpaired(s.why), s.why).toBe(false)
        expect(UNICODE_MATH.test(outsideMath(s.why)), s.why).toBe(false)
        expectInlineTexOk(s.why)
        // 無條件進位的那一步：畫面上 ⌈ ⌉ 裡的數字取上整（至少 1），就是畫面上的答案
        const ceil = /\\left\\lceil([0-9.]+)\\right\\rceil=(\d+)$/.exec(s.tex)
        if (ceil) expect(Math.max(1, Math.ceil(Number(ceil[1]))), s.tex).toBe(Number(ceil[2]))
      }
      for (const note of sol.notes ?? []) {
        expect(unpaired(note), note).toBe(false)
        expect(note).not.toMatch(/NaN|undefined|\\infty/)
        expect(UNICODE_MATH.test(outsideMath(note)), note).toBe(false)
        expectInlineTexOk(note)
      }
    }
    // 「換一題」真的會換數字（不是每次都因 validate 不過而退回預設值）
    expect(seen.size, def.id).toBeGreaterThanOrEqual(10)
  })

  it('practice 範圍的「每一種」組合都通過 validate、答案有限（換一題不可能抽到模型不適用的數字）', () => {
    for (const def of HANDCALCS) {
      const keys = def.inputs.map((i) => i.key)
      const lists = def.inputs.map((i) => i.practice!.choices!)
      const total = lists.reduce((n, l) => n * l.length, 1)
      expect(total).toBeLessThan(200_000)
      const idx = new Array<number>(lists.length).fill(0)
      for (let c = 0; c < total; c++) {
        const v = Object.fromEntries(keys.map((k, i) => [k, lists[i][idx[i]]]))
        expect(def.validate?.(v) ?? null, `${def.id} ${JSON.stringify(v)}`).toBeNull()
        const res = def.solve(v).results
        expect(res.every((r) => Number.isFinite(r.value)), `${def.id} ${JSON.stringify(v)}`).toBe(true)
        for (let i = 0; i < idx.length; i++) {
          if (++idx[i] < lists[i].length) break
          idx[i] = 0
        }
      }
    }
  })
})

describe('Sign-off 手算題：validate 擋下模型不適用的輸入並解釋原因', () => {
  it.each(INVALID.map((c) => [`${c.hc} ${c.name}`, c] as const))('%s', (_name, c) => {
    const def = handcalc(c.hc)
    const v = { ...defaultValues(def), ...c.patch }
    // 這些值都在輸入欄允許的範圍內：使用者看到的是「原因」，不是「不可大於…」
    def.inputs.forEach((i) => expect(inputError(i, v[i.key]), `${i.key}=${v[i.key]}`).toBeNull())
    const msg = def.validate?.(v)
    expect(msg, c.name).toBeTruthy()
    expect(msg!).toMatch(c.expect)
    expect(msg!.length).toBeGreaterThan(40) // 是解釋，不是只有「不合法」
    expect(unpaired(msg!), msg!).toBe(false)
    expectInlineTexOk(msg!)
    // $…$ 之外不以 Unicode 拼公式（「C ≤ 0：」這個全站指定的警告前綴除外）
    expect(UNICODE_MATH.test(outsideMath(msg!)), msg!).toBe(false)
  })

  it('不合法的輸入在畫面上顯示原因（KaTeX 排版、沒有殘留的 $），不顯示任何步驟或答案', () => {
    for (const c of INVALID) {
      const def = handcalc(c.hc)
      const { container, unmount } = render(<HandCalc def={withValues(def, { ...defaultValues(def), ...c.patch })} />)
      const warn = container.querySelector('.callout-warn')
      expect(warn, `${c.hc} ${c.name}`).toBeTruthy()
      expect(warn!.querySelector('.katex'), `${c.hc} ${c.name}`).toBeTruthy()
      expect(proseText(warn!)).not.toContain('$')
      expect(container.querySelector('.katex-error, .c-tex-error'), `${c.hc} ${c.name}`).toBeNull()
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      expect(container.querySelector('.c-handcalc-results')).toBeNull()
      unmount()
    }
  })

  it('輸入欄的合法範圍：非整數的 block 數、每側少於 2 個 block、超過 100% 的機率會被擋下', () => {
    const byKey = (id: string, key: string) => handcalc(id).inputs.find((i) => i.key === key)!
    expect(inputError(byKey('HC-SO.1', 'M'), 2.5)).toBeTruthy()
    expect(inputError(byKey('HC-SO.1', 'N'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-SO.1', 'sigmaV'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-SO.2', 'M'), 1)).toBeTruthy() // 每側至少 2 個 block 才估得出樣本標準誤
    expect(inputError(byKey('HC-SO.2', 'rho'), 1.2)).toBeTruthy()
    expect(inputError(byKey('HC-SO.3', 'alpha'), 1.5)).toBeTruthy()
    expect(inputError(byKey('HC-SO.3', 'n'), 0)).toBeTruthy()
    expect(inputError(byKey('HC-SO.4', 'd'), 0.5)).toBeTruthy()
    // C < 0 在 HC-SO.1 是值得算的情況（量測會判為極性錯誤），不擋
    expect(handcalc('HC-SO.1').validate!({ ...defaultValues(handcalc('HC-SO.1')), theta: 120 })).toBeNull()
  })
})

describe('Sign-off 手算題：渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值與 6 組隨機數字都能渲染，沒有 .katex-error、沒有殘留的 $，步驟數與 solve() 相同', (_id, def) => {
    const cases = [defaultValues(def), ...[1, 2, 3, 4, 5, 6].map((seed) => randomValues(def, seed))]
    for (const v of cases) {
      const sol = def.solve(v)
      const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
      expect(container.querySelector('.katex-error'), JSON.stringify(v)).toBeNull()
      expect(container.querySelector('.c-tex-error')).toBeNull()
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(container.querySelectorAll('.c-handcalc-results .katex-display').length).toBe(sol.results.length)
      expect(proseText(container), JSON.stringify(v)).not.toContain('$')
      expect(container.querySelector('section.c-handcalc')?.id).toBe(`handcalc-${def.id}`)
      // 每個輸入欄都有 aria-label（白話說明 + key），不含 TeX
      for (const el of Array.from(container.querySelectorAll('.c-handcalc-inputs input'))) {
        expect(el.getAttribute('aria-label')).toBeTruthy()
        expect(el.getAttribute('aria-label')).not.toMatch(/[$\\]/)
      }
      unmount()
    }
  })

  it('自己算算看：把 solve() 的答案四捨五入到 4 位有效數字填回去，每一格都判定正確；差 5% 則判定錯誤', () => {
    for (const def of HANDCALCS) {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      expect(container.querySelectorAll('.c-step')).toHaveLength(0)
      const view = within(container)
      const inputs = view.getAllByPlaceholderText('你的答案') as HTMLInputElement[]
      expect(inputs).toHaveLength(sol.results.length)
      inputs.forEach((el, k) => {
        const v = sol.results[k].value
        fireEvent.change(el, { target: { value: Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))) } })
        expect(el.getAttribute('aria-label')).not.toMatch(/[$\\]/)
      })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length, def.id).toBe(sol.results.length)
      // 第一格故意差 5%
      fireEvent.change(inputs[0], { target: { value: String(sol.results[0].value * 1.05) } })
      fireEvent.click(view.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.bad').length, def.id).toBe(1)
      // 看詳解：步驟出現
      fireEvent.click(view.getByText('看詳解'))
      expect(container.querySelectorAll('.c-step').length, def.id).toBe(sol.steps.length)
      unmount()
    }
  })

  it('無條件進位的答案不接受「少一」：M_min = 6 填 5、n_need = 299 填 298、k95 = 71 填 70 都判錯', () => {
    const cases: [string, number, number][] = [
      ['HC-SO.1', 3, 5],
      ['HC-SO.3', 1, 298],
      ['HC-SO.4', 3, 70],
    ]
    for (const [id, idx, wrong] of cases) {
      const def = handcalc(id)
      const sol = def.solve(defaultValues(def))
      expect(sol.results[idx].value, id).toBe(wrong + 1)
      const { container, unmount } = render(<HandCalc def={def} initialMode="practice" />)
      const inputs = within(container).getAllByPlaceholderText('你的答案') as HTMLInputElement[]
      // 其他格填正確答案，只有無條件進位的那一格填「少一」
      inputs.forEach((el, k) => fireEvent.change(el, { target: { value: String(k === idx ? wrong : sol.results[k].value) } }))
      fireEvent.click(within(container).getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.bad').length, id).toBe(1)
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length, id).toBe(sol.results.length - 1)
      unmount()
    }
  })

  it('改輸入會即時重新帶入：HC-SO.1 把 θ 改成 60° ⇒ z = 20.42；改成 90° ⇒ 顯示原因、不顯示步驟', () => {
    const def = handcalc('HC-SO.1')
    const { container } = render(<HandCalc def={def} />)
    const theta = within(container).getByLabelText(/誤差路徑的有效相位/) as HTMLInputElement
    fireEvent.change(theta, { target: { value: '60' } })
    const z60 = def.solve({ ...defaultValues(def), theta: 60 }).results[2].value
    close(z60, 20.4258, 1e-4) // = 40.85 × cos 60°
    expect(container.textContent).toContain(String(Number(z60.toPrecision(5))))
    fireEvent.change(theta, { target: { value: '90' } })
    expect(container.querySelectorAll('.c-step')).toHaveLength(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('不可辨識')
  })

  // 逐 block 的平均遞迴 y_{k+1} = y_k − g·y_{k−d}（初始歷史都是 1）：回傳 y_{−1}…y_n（索引 k + 1）
  const trajectory = (g: number, d: number, n = 4000): number[] => {
    const y = new Array<number>(d + 1).fill(1)
    for (let k = 1; k <= n; k++) y.push(y[y.length - 1] - g * y[y.length - 1 - d])
    return y.slice(d) // y[0] = y_0
  }
  /** 1 + 最後一次 |y_k| > 5% 的 k */
  const settle = (g: number, d: number) => {
    const y = trajectory(g, d)
    let last = 0
    y.forEach((v, k) => {
      if (k > 0 && Math.abs(v) > 0.05) last = k
    })
    return last + 1
  }
  // 讓最慢的 corner 的 g_S 恰好等於指定值：θ_S = 0、σ_S = 100 ⇒ g_S = μ·K_q(100)
  const hcAt = (def: HandCalcDef, gS: number, d: number, B = 10000) => ({ ...defaultValues(def), sigmaF: 100, thetaF: 0, sigmaS: 100, thetaS: 0, mu: gS / J.kq(100), d, B, pmT: 0 })
  const stepStarting = (def: HandCalcDef, v: Record<string, number>, prefix: string) => def.solve(v).steps.find((s) => s.tex.startsWith(prefix))

  it('技術審查 R02／A6：HC-SO.4 的 k95 是逐 block 數出來的（和判斷器同一個函式）；⌈ln0.05/ln ρ_S⌉ 另列成「ρ 漸近估計」步驟——d = 1、g_S = 1/4 時 5 vs 7', () => {
    const def = handcalc('HC-SO.4')
    // 反例：d = 1、g_S = 1/4 是重根 z = 1/2——ρ 漸近估計給 5，逐 block 數要 7（相對差 40%，是 d = 1 時最大的）
    const v = hcAt(def, 0.25, 1)
    const dbl = def.solve(v)
    close(dbl.results[2].value, 0.5, 1e-6)
    expect(dbl.results[3].value).toBe(7) // 答案是逐 block 的（舊版這裡是 5）
    expect(settle(0.25, 1)).toBe(7)
    const asym = stepStarting(def, v, 'k_{95}^{(\\rho)}=')!
    expect(asym.tex).toContain(String.raw`\left\lceil4.3219\right\rceil=5`)
    expect(asym.why).toContain('漸近衰減率')
    expect(asym.why).toContain(String.raw`$\rho_S^{\,k}$ 不是它的包絡`)
    expect(asym.why).toContain(String.raw`估計給 $5$，從定值的初始歷史逐 block 數要 $7$`)
    expect(asym.why).not.toContain('誤差包絡')
    expect(asym.why).not.toContain('越接近')
    // 之後是逐 block 的驗證：重根 y_k = (k + 2)/2^{k+1}，y_6 = 0.0625 > 0.05 ≥ y_7 = 0.035156
    const tex = dbl.steps.map((s) => s.tex)
    expect(tex).toContain(String.raw`y_{6}=\frac{6+2}{2^{6+1}}=\frac{8}{128}=0.0625>0.05`)
    expect(tex).toContain(String.raw`y_{7}=\frac{7+2}{2^{7+1}}=\frac{9}{256}=0.035156\le0.05`)
    expect(tex[tex.length - 1]).toBe(String.raw`k_{95}=k_\text{last}+1=6+1=7`)
    // B = 6：舊判法（漸近估計 5 ≤ 6）給綠燈，逐 block 的 7 > 6 來不及；B = 7 才來得及
    expect(def.solve({ ...v, B: 6 }).notes!.join('')).toContain('來不及收斂')
    expect(def.solve({ ...v, B: 7 }).notes!.join('')).toContain('兩個 corner 都通過')
    // 「相對差距在 1/4 附近最大」：掃 d = 1 的 g ∈ (0, 1)，答案都等於暴力遞推，相對差的最大值就是 2/5
    let worst = { rel: 0, g: 0 }
    for (let i = 1; i < 199; i++) {
      const g = i / 200
      const r = def.solve(hcAt(def, g, 1)).results[3].value
      expect(r, `g=${g}`).toBe(settle(g, 1))
      const asymG = Math.ceil(Math.log(0.05) / Math.log(J.delayPoles(g, 1).rho))
      const rel = Math.abs(r - asymG) / asymG
      if (rel > worst.rel) worst = { rel, g }
    }
    expect(worst.rel).toBeCloseTo(0.4, 12)
    expect(Math.abs(worst.g - 0.25)).toBeLessThan(0.02)
    // 另一個方向：g_S = 0.8 時估計 27、逐 block 26
    const v8 = hcAt(def, 0.8, 1)
    expect(def.solve(v8).results[3].value).toBe(26)
    expect(stepStarting(def, v8, 'k_{95}^{(\\rho)}=')!.tex).toContain(String.raw`=27`)
    expect(settle(0.8, 1)).toBe(26)
    // 正常對照：d = 0 時估計就是逐 block 的結果，只有一個 k_{95} 步驟，說明文字不叫「估計」
    for (const g of [0.005, 0.039894, 0.25, 0.5, 0.9]) expect(def.solve(hcAt(def, g, 0)).results[3].value, `g=${g}`).toBe(settle(g, 0))
    const v0 = hcAt(def, 0.25, 0)
    const k0 = stepStarting(def, v0, 'k_{95}=')!
    expect(k0.why).toContain('剛好乘上')
    expect(k0.why).not.toContain('估計')
    expect(stepStarting(def, v0, 'k_{95}^{(\\rho)}=')).toBeUndefined()
    // 預設題（g_S = 0.039894、d = 1）：估計 71、逐 block 也是 71，步驟兩個都列
    const dflt = def.solve(defaultValues(def))
    expect(dflt.results[3].value).toBe(71)
    expect(settle(10 * J.kq(100) * Math.cos(Math.PI / 3), 1)).toBe(71)
    expect(dflt.steps.at(-1)!.why).toContain('和 $\\rho$ 漸近估計相同')
  })

  it('A6：HC-SO.4 d = 1 的逐 block 驗證步驟——實根、重根、複根三種，畫面上 y_{k95−1} > 0.05 ≥ y_{k95} 的數字都等於暴力遞推', () => {
    const def = handcalc('HC-SO.4')
    // g_S：0.039894（預設）、0.15、0.2（實根）；0.25（重根）；0.3、0.5、0.8（複根）
    for (const g of [0.039894, 0.15, 0.2, 0.249, 0.25, 0.3, 0.5, 0.8]) {
      const v = hcAt(def, g, 1)
      expect(def.validate!(v), `g=${g}`).toBeNull()
      const sol = def.solve(v)
      const k2 = sol.results[3].value
      const k1 = k2 - 1
      expect(k2, `g=${g}`).toBe(settle(g, 1))
      const y = trajectory(g, 1)
      const shown = sol.steps.filter((s) => /^\|?y_\{\d+\}\|?=/.test(s.tex))
      expect(shown, `g=${g}`).toHaveLength(2)
      shown.forEach((s, i) => {
        const k = i === 0 ? k1 : k2
        expect(s.tex.startsWith(`${s.tex.includes('|y_') ? '|' : ''}y_{${k}}`), s.tex).toBe(true)
        const m = /=([0-9.]+)(>|\\le)0\.05$/.exec(s.tex)
        expect(m, s.tex).toBeTruthy()
        // 畫面上的數字就是 |y_k|（複根時是絕對值）：與暴力遞推相符到顯示的位數
        close(Number(m![1]), Math.abs(y[k]), 1e-4, 1e-9, `g=${g} k=${k}`)
        // 方向：k95 − 1 在 0.05 之上、k95 在 0.05 之下（或剛好）
        expect(m![2] === '>', `g=${g} k=${k}`).toBe(i === 0)
        expect(Math.abs(y[k]) > 0.05, `g=${g} k=${k}`).toBe(i === 0)
      })
      // 每個等號只做一次基本運算的精神：冪、除法的中間量都在式子裡；根與相角的步驟與題目其他地方一致
      const text = sol.steps.map((s) => s.tex).join('\n')
      if (g < 0.25) expect(text).toContain('z_2=1-z_1')
      if (g > 0.25) expect(text).toContain(String.raw`\varphi=\arccos`)
      if (g === 0.25) expect(text).toContain('2^{')
      expect(sol.steps.at(-1)!.tex).toBe(String.raw`k_{95}=k_\text{last}+1=${k1}+1=${k2}`)
    }
    // 複根的說明誠實：紙筆只能驗證夾住 5% 的兩項
    const cplx = def.solve(hcAt(def, 0.5, 1)).steps.map((s) => s.why).join('')
    expect(cplx).toContain('正負交替')
    expect(cplx).toContain('逐 block 數到暫態消失為止')
    // 實根的說明：單調遞減，所以之後不會再超過
    expect(def.solve(hcAt(def, 0.15, 1)).steps.map((s) => s.why).join('')).toContain('單調遞減')
  })

  it('A6：HC-SO.4 極慢的 mode（逐 block 在 2×10⁶ 步內數不完）改列漸近估計當下界，標 ≥ 並說明；題目照樣可以渲染', () => {
    const def = handcalc('HC-SO.4')
    const v = { ...hcAt(def, 1e-6, 1), B: 1000 }
    expect(def.validate!(v)).toBeNull()
    const sol = def.solve(v)
    expect(sol.results[3].value).toBe(J.cornerJudge([{ name: 's', sigmaV: 100, thetaDeg: 0 }], { mu: v.mu, d: 1, pmTargetDeg: 0, B: 1000, N: 4096, sigmaWMax: Infinity })[0].settleAsym)
    expect(sol.steps.at(-1)!.tex).toMatch(/^k_\{95\}\\ge k_\{95\}\^\{\(\\rho\)\}=\d+$/)
    expect(sol.steps.at(-1)!.why).toContain('下界')
    expect(sol.notes!.join('')).toContain(String.raw`$k_{95}\ge`)
    expect(sol.notes!.join('')).toContain('來不及收斂')
    const { container, unmount } = render(<HandCalc def={withValues(def, v)} />)
    expect(container.querySelector('.katex-error')).toBeNull()
    unmount()
  })

  it('A6：HC-SO.4 的 practice 範圍（13824 種組合）逐 block 的 k95 都等於暴力遞推，而且判定與 ρ 漸近估計一致（沒有任何「換一題」會因這次修正而翻盤）', () => {
    const def = handcalc('HC-SO.4')
    const lists = def.inputs.map((i) => i.practice!.choices!)
    const keys = def.inputs.map((i) => i.key)
    const total = lists.reduce((n, l) => n * l.length, 1)
    expect(total).toBe(13824)
    const cache = new Map<string, number>()
    const idx = new Array<number>(lists.length).fill(0)
    let differ = 0
    for (let c = 0; c < total; c++) {
      const v = Object.fromEntries(keys.map((k, i) => [k, lists[i][idx[i]]]))
      const sol = def.solve(v)
      const gS = v.mu * J.kq(v.sigmaS) * Math.cos(v.thetaS * RAD)
      const key = `${gS}|${v.d}`
      if (!cache.has(key)) cache.set(key, settle(gS, v.d))
      expect(sol.results[3].value, key).toBe(cache.get(key))
      const asym = Math.max(1, Math.ceil(Math.log(0.05) / Math.log(sol.results[2].value)))
      if (asym !== sol.results[3].value) differ++
      expect(asym <= v.B, `${JSON.stringify(v)}：估計 ${asym}、逐 block ${sol.results[3].value}`).toBe(sol.results[3].value <= v.B)
      for (let i = 0; i < idx.length; i++) {
        if (++idx[i] < lists[i].length) break
        idx[i] = 0
      }
    }
    expect(differ).toBe(0) // practice 的 g_S 都在 0.17 以下（實根、遠離重根）：估計與逐 block 的數字本來就相同
  })
})
