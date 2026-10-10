import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, MathText, checkAnswer, defaultValues, randomValues, renderTex } from '@/components'
import { handcalcsForPage } from '@/app/handcalcs'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import {
  DEFAULT_RULE,
  analyzeRule,
  buildPlant,
  corrMatrix,
  fdTruncationFactor,
  gmacLinear,
  kqFromSigma,
  preconditionedModeVar,
  signGmacMean,
  stepsToDecay,
  type RuleConfig,
} from '@/simulation/models/mimo'
import { FORMULAS } from './formulas'
import { HANDCALCS, handcalc } from './handcalcs'
import { NUM, SIGMA_KQ1 } from './numbers'

// 多個 agent／開發者同時跑測試時（vite.config.ts 的說明：load average 曾達數百），KaTeX 渲染會慢上數十倍；
// 預設的 5 s 逾時在那種情況下會誤判失敗，所以整個檔案放寬到 60 s（不影響任何數值斷言）。
vi.setConfig({ testTimeout: 60_000 })

interface GoldenVector {
  inputs: Record<string, unknown>
  expected: Record<string, unknown>
}
const golden = (name: string): GoldenVector => JSON.parse(readFileSync(resolve(process.cwd(), 'golden/vectors', `${name}.json`), 'utf8')) as GoldenVector

const rule = (r: Partial<RuleConfig>): RuleConfig => ({ ...DEFAULT_RULE, ...r })
const values = (sol: HandCalcSolution) => sol.results.map((r) => r.value)
const solveDefault = (id: string) => {
  const def = handcalc(id)
  return def.solve(defaultValues(def))
}
/** 相對 1e-9（加上 1e-12 的絕對容差，處理 0） */
function expectClose(actual: number, expected: number, msg = '', rel = 1e-9) {
  expect(Math.abs(actual - expected), `${msg} actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(rel * Math.max(Math.abs(actual), Math.abs(expected)) + 1e-12)
}

// ───────────── 測試內的獨立重算（只用 Math，不呼叫 mimo.ts） ─────────────

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI)
const LN005 = Math.log(0.05)
const k95 = (p: number) => (p === 0 ? 1 : Math.max(1, Math.ceil(LN005 / Math.log(Math.abs(p)))))
/** erf 的泰勒級數：(2/√π) Σ (−1)ⁿ x^{2n+1} / (n!(2n+1))（|x| ≤ 3 時 60 項綽綽有餘） */
function erfSeries(x: number): number {
  let term = x
  let sum = x
  for (let n = 1; n < 60; n++) {
    term *= (-x * x) / n
    sum += term / (2 * n + 1)
  }
  return (2 / Math.sqrt(Math.PI)) * sum
}

const INDEPENDENT: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-10.1': ({ rho, d1, d2, sigmaV, mu }) => {
    const Kq = SQRT_2_OVER_PI / sigmaV
    const G1 = Kq * (d1 + rho * d2)
    const G2 = Kq * (rho * d1 + d2)
    return [G1, G2, d1 - mu * G1, d2 - mu * G2]
  },
  'HC-10.2': ({ rho, muKq }) => {
    const pSlow = 1 - muKq * (1 - Math.abs(rho))
    const pFast = 1 - muKq * (1 + Math.abs(rho))
    return [pSlow, pFast, k95(Math.max(Math.abs(pSlow), Math.abs(pFast))), 2 * muKq]
  },
  'HC-10.3': ({ r11, r12, r22, gamma }) => {
    const det = r11 * r22 - r12 * r12
    return [det, (gamma * r22) / det, (-gamma * r12) / det, (gamma * r11) / det]
  },
  'HC-10.4': ({ rho, gamma, N, sigmaV }) => {
    const Kq = SQRT_2_OVER_PI / sigmaV
    const c = gamma / (Kq * Kq * N * (2 - gamma))
    const a = Math.abs(rho)
    return [c / (1 - a), c / (1 + a), Math.sqrt((1 + a) / (1 - a)), Math.sqrt(c / (1 - rho * rho))]
  },
  'HC-10.5': ({ lam, gamma, lamReg }) => [1 - (gamma * lam) / (lam + lamReg), gamma / (lam + lamReg), 1 - (gamma * lam * lam) / (lam * lam + lamReg)],
  'HC-10.6': ({ gp, gm, dfs, sigmaV, NJ }) => {
    const Kq = SQRT_2_OVER_PI / sigmaV
    const J = (gp - gm) / (2 * dfs)
    return [J, J / Kq, erfSeries(dfs / (Math.SQRT2 * sigmaV)) / (Kq * dfs), 1 / Math.sqrt(1 + (dfs / sigmaV) ** 2), Math.sqrt(2 / NJ) / (2 * Kq * dfs)]
  },
  'HC-10.7': ({ j11, j12, j21, j22, mu }) => {
    const a11 = 1 + mu * j11
    const a12 = mu * j12
    const a21 = mu * j21
    const a22 = 1 + mu * j22
    const T = a11 + a22
    const D = a11 * a22 - a12 * a21
    const raw = T * T - 4 * D
    const disc = Math.abs(raw) < 1e-12 * Math.max(1, T * T) ? 0 : raw
    if (disc >= 0) {
      const p1 = (T + Math.sqrt(disc)) / 2
      const p2 = (T - Math.sqrt(disc)) / 2
      return [p1, p2, Math.max(Math.abs(p1), Math.abs(p2))]
    }
    return [T / 2, Math.sqrt(-disc) / 2, Math.sqrt(D)]
  },
  'HC-10.8': ({ rho, muKq, gamma, lamReg, N, sigmaV }) => {
    const lmin = 1 - Math.abs(rho)
    const Kq = SQRT_2_OVER_PI / sigmaV
    const rows = [
      { m: muKq, p: 1 - muKq * lmin },
      { m: gamma / lmin, p: 1 - gamma },
      { m: gamma / (lmin + lamReg), p: 1 - (gamma * lmin) / (lmin + lamReg) },
    ]
    return [...rows.map((r) => k95(r.p)), ...rows.map((r) => (r.m * r.m * lmin) / (Kq * Kq * N * (1 - r.p * r.p)))]
  },
}

/** 步驟／說明／提示的所有 TeX 都要能渲染（renderTex 遇到語法錯誤會輸出 .katex-error） */
function expectRenderable(def: HandCalcDef, sol: HandCalcSolution, tag: string) {
  for (const s of sol.steps) {
    expect(s.tex, `${tag} 的步驟必須是「符號式 = 代入 = 結果」`).toContain('=')
    expect(renderTex(s.tex, true), `${tag} step tex: ${s.tex}`).not.toContain('katex-error')
    expect(s.why.length, `${tag} 每一步都要有說明`).toBeGreaterThan(3)
  }
  for (const r of sol.results) expect(renderTex(`${r.symbol}${r.unit ? `\\ ${r.unit}` : ''}`, true), `${tag} result ${r.symbol}`).not.toContain('katex-error')
  const texts = [...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...sol.results.map((r) => r.label ?? ''), ...(def.tips ?? [])]
  const { container, unmount } = render(
    <div>
      {texts.map((t, i) => (
        <p key={i}>
          <MathText>{t}</MathText>
        </p>
      ))}
    </div>,
  )
  expect(container.querySelectorAll('.katex-error').length, `${tag} 的說明文字`).toBe(0)
  expect(container.querySelector('.c-tex-error'), `${tag} 的說明文字`).toBeNull()
  // 說明文字裡的 $...$ 都要成對（落單的 $ 會原樣顯示在頁面上）
  expect(container.textContent, `${tag} 有落單的 $`).not.toContain('$')
  unmount()
}

describe('Ch10 帶入手算：登錄', () => {
  it('8 題、id 為 HC-10.1 … HC-10.8、頁面 /ch/10，且被全站彙整（/workbook）收到', () => {
    expect(HANDCALCS.length).toBeGreaterThanOrEqual(5)
    expect(HANDCALCS.length).toBeLessThanOrEqual(8)
    expect(HANDCALCS.map((h) => h.id)).toEqual(HANDCALCS.map((_, i) => `HC-10.${i + 1}`))
    HANDCALCS.forEach((h) => expect(h.page).toBe('/ch/10'))
    expect(handcalcsForPage('/ch/10').map((h) => h.id)).toEqual(HANDCALCS.map((h) => h.id))
    expect(Object.keys(INDEPENDENT).sort()).toEqual(HANDCALCS.map((h) => h.id).sort())
    expect(() => handcalc('HC-10.99')).toThrow(/沒有手算題/)
  })

  it('每題對應一個已登錄的公式（F-10.x），三種難度都有，重要的 boxed 公式都有題目', () => {
    const ids = new Set(FORMULAS.map((f) => f.id))
    HANDCALCS.forEach((h) => expect(ids.has(h.formulaId ?? ''), `${h.id} → ${h.formulaId}`).toBe(true))
    expect(new Set(HANDCALCS.map((h) => h.level))).toEqual(new Set(['beginner', 'engineer', 'research']))
    // 章內每個 \boxed 公式（F-10.1 … F-10.12）至少在一題的通式或步驟說明中出現
    const mentioned = HANDCALCS.map((h) => {
      const sol = h.solve(defaultValues(h))
      return [h.formulaId, h.formulaTex, ...sol.steps.map((s) => s.why), ...(sol.notes ?? []), ...(h.tips ?? [])].join(' ')
    }).join(' ')
    for (const f of ['F-10.1', 'F-10.2', 'F-10.3', 'F-10.4', 'F-10.5', 'F-10.6', 'F-10.7', 'F-10.8', 'F-10.9', 'F-10.10', 'F-10.11', 'F-10.12', 'F-10.13', 'F-10.14']) {
      expect(mentioned, f).toContain(f)
    }
  })

  it('預設值是合法輸入；practice 範圍裡的每個值都在 [min, max] 內', () => {
    for (const h of HANDCALCS) {
      expect(h.validate?.(defaultValues(h)) ?? null, h.id).toBeNull()
      for (const i of h.inputs) {
        expect(i.practice, `${h.id}.${i.key} 要有 practice 範圍`).toBeTruthy()
        for (const c of i.practice?.choices ?? []) {
          expect(c, `${h.id}.${i.key}`).toBeGreaterThanOrEqual(i.min ?? -Infinity)
          expect(c, `${h.id}.${i.key}`).toBeLessThanOrEqual(i.max ?? Infinity)
          if (i.integer) expect(Number.isInteger(c)).toBe(true)
        }
      }
    }
  })
})

describe('Ch10 帶入手算：(a) 預設值 = 模型函式 = 文中 worked example = golden vector', () => {
  it('HC-10.1：§10.1 的耦合例 G₁ = 0.8·K_q·10 = 0.06383、G₂ = 0.07979、w₁ 被推離 0.638 fs（gmacLinear 無雜訊 = K_q R δ）', () => {
    const [G1, G2, d1n, d2n] = values(solveDefault('HC-10.1'))
    expectClose(G1, NUM.coupling.G1lin, 'G1')
    expectClose(G2, NUM.coupling.G2lin, 'G2')
    expectClose(d1n, -NUM.coupling.w1Shift, 'δ1′')
    expectClose(d2n, 10 - NUM.coupling.muFs * NUM.coupling.G2lin, 'δ2′')
    expect(G1).toBeCloseTo(0.0638308, 6)
    expect(d1n).toBeCloseTo(-0.638308, 5)
    // 模型：線性 GMAC 的平均（雜訊 = 0）
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 0.8), sigmaV: 100, N: 1 })
    const G = gmacLinear(plant, [0, 10], () => 0)
    expectClose(G1, G[0])
    expectClose(G2, G[1])
    // 觀察中的精確值來自 signGmacMean（F-10.13）
    const sol = solveDefault('HC-10.1')
    const exact = signGmacMean(plant, [0, 10])
    expect(sol.notes?.join(' ')).toContain(String(Number(exact[0].toPrecision(5))))
  })

  it('HC-10.1：提示的做法（σ_v = 0.79788 fs ⇒ K_q = 1、μ = 0.5 fs）重現 §10.1 手算表 (−4, 5) → (−4, 4.1)', () => {
    const def = handcalc('HC-10.1')
    const base = { rho: 0.8, sigmaV: SIGMA_KQ1, mu: 0.5 }
    const r1 = values(def.solve({ ...base, d1: 0, d2: 10 }))
    expectClose(r1[2], NUM.coupling.handRows[1].d1, 'δ1,1')
    expectClose(r1[3], NUM.coupling.handRows[1].d2, 'δ2,1')
    const r2 = values(def.solve({ ...base, d1: r1[2], d2: r1[3] }))
    expectClose(r2[2], NUM.coupling.handRows[2].d1, 'δ1,2')
    expectClose(r2[3], NUM.coupling.handRows[2].d2, 'δ2,2')
    expect(r2[2]).toBeCloseTo(-4, 12)
    expect(r2[3]).toBeCloseTo(4.1, 12)
  })

  it('T11: HC-10.2 的範例數字（ρ = .99、μK_q = .5）⇒ 慢 pole 0.995、快 pole 0.005、k₉₅ = 598（golden T11；NLMS μ̃ = 1 相同）', () => {
    const v = golden('T11')
    const [pSlow, pFast, k, muTilde] = values(solveDefault('HC-10.2'))
    expectClose(pSlow, v.expected.slow_pole as number, 'slow')
    expectClose(pFast, v.expected.fast_pole as number, 'fast')
    expect(k).toBe(v.expected.blocks_95)
    expect(k).toBe(NUM.rho099.blocksScalar)
    expect(muTilde).toBe(1)
    expect(NUM.rho099.nlmsBlocks).toBe(k)
    // 步驟裡顯示的未取整值 597.65 與 golden 的 blocks_95_real 一致
    const tex = solveDefault('HC-10.2')
      .steps.map((s) => s.tex)
      .join(' ')
    expect(tex).toContain(String(Number((v.expected.blocks_95_real as number).toPrecision(5))))
  })

  it('T10: HC-10.2 第一步顯示 R(ρ = .99) 的 eigenvalues 1.99 / 0.01（golden T10）', () => {
    const v = golden('T10')
    const step = solveDefault('HC-10.2').steps[0].tex
    expect(step).toContain(`=${Number((v.expected.eig_max as number).toPrecision(5))}`)
    expect(step).toContain(`=${Number((v.expected.eig_min as number).toPrecision(5))}`)
    // 觀察中的 κ = 199
    expect(solveDefault('HC-10.2').notes?.[0]).toContain('=199')
  })

  it('T11: HC-10.3 的範例數字 ⇒ det R = 0.0199、M_n = 0.5R⁻¹ ≈ [[25.13, −24.87], [−24.87, 25.13]]（golden T11 preconditioner_M）', () => {
    const M = golden('T11').expected.preconditioner_M as number[][]
    const [det, m11, m12, m22] = values(solveDefault('HC-10.3'))
    expectClose(det, 0.0199, 'det')
    expectClose(m11, M[0][0], 'M11')
    expectClose(m12, M[0][1], 'M12')
    expectClose(m22, M[1][1], 'M22')
    expectClose(m11, NUM.rho099.Mn[0][0])
    expect(m11).toBeCloseTo(25.13, 2)
    expect(m12).toBeCloseTo(-24.87, 2)
    // 驗算步驟：(M_n R)₁₁ = γ、(M_n R)₁₂ = 0、pole = 1 − γ
    const steps = solveDefault('HC-10.3').steps.map((s) => s.tex)
    expect(steps[3].endsWith('=0.5')).toBe(true)
    expect(steps[4].endsWith('=0')).toBe(true)
    expect(steps[5].endsWith('=0.5')).toBe(true)
  })

  it('E37：HC-10.4 的範例數字 ⇒ 模式變異 127.83 / 0.642 fs²（golden preconditioner_variance）、√199、每參數 RMS = √64.24 fs（Lyapunov）', () => {
    const v = golden('preconditioner_variance')
    const [vSlow, vFast, ratio, rms] = values(solveDefault('HC-10.4'))
    expectClose(vSlow, (v.expected.var_lambda_min_list as number[])[0], 'slow')
    expectClose(vFast, (v.expected.var_lambda_max_list as number[])[0], 'fast')
    expectClose(vSlow, NUM.noise.modeVar[1], 'Lyapunov slow', 1e-7)
    expectClose(vFast, NUM.noise.modeVar[0], 'Lyapunov fast', 1e-7)
    expectClose(ratio, NUM.noise.sqrt199, 'ratio')
    expectClose(rms, Math.sqrt(NUM.noise.perParam[0]), 'rms')
    expect(rms * rms).toBeCloseTo(64.237, 2)
    // 模型閉式：c = preconditionedModeVar(λ = 1)
    expectClose(NUM.noise.c, preconditionedModeVar(0.5, kqFromSigma(100), 4096, 1))
    expect(solveDefault('HC-10.4').steps[2].tex).toContain(`=${Number(NUM.noise.c.toPrecision(5))}`)
  })

  it('E22：HC-10.5 的範例數字 ⇒ R 形式 0.954545（598 / 5 / 65 的 65）、J 形式 0.9995005；與 analyzeRule 的 closedPoles 相同', () => {
    const [pR, mR, pJ] = values(solveDefault('HC-10.5'))
    expectClose(pR, NUM.rho099.regSlowPole, 'pR')
    expectClose(pJ, NUM.rho099.regJSlowPole, 'pJ')
    expectClose(mR, 0.5 / 0.11, 'm')
    const plant = buildPlant({ mode: 'R', R: corrMatrix(2, 0.99), sigmaV: SIGMA_KQ1, N: 4096 })
    const anR = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'R', gamma: 0.5, lambdaReg: 0.1 }), plant.Jn)
    const anJ = analyzeRule(plant, rule({ rule: 'regularized', regForm: 'J', gamma: 0.5, lambdaReg: 0.1 }), plant.Jn)
    expectClose(pR, anR.closedPoles![1], 'closed R', 1e-12)
    expectClose(pJ, anJ.closedPoles![1], 'closed J', 1e-12)
    // 數值 eig(I + MJ) 的最慢 pole（這個 plant 的 λ_min 是 0.01 + 浮點殘餘，所以只比到 1e-9）
    expectClose(pR, anR.spectralRadius, 'eig R', 1e-9)
    expectClose(pJ, anJ.spectralRadius, 'eig J', 1e-9)
    const note = solveDefault('HC-10.5').notes?.[0] ?? ''
    expect(note).toContain(`k_{95}=${NUM.rho099.blocksReg}`)
    expect(note).toContain(`k_{95}=${NUM.rho099.regJBlocks}`)
  })

  it('T18: HC-10.5 的 J 形式代入 σ = 1、3（γ = .5、λ_reg = .1）⇒ 0.5455 / 0.5055（golden T18 reg_poles_desc）', () => {
    const v = golden('T18')
    const reg = v.expected.reg_poles_desc as number[]
    const def = handcalc('HC-10.5')
    const g = v.inputs.reg_gamma as number
    const l = v.inputs.reg_lambda as number
    expectClose(values(def.solve({ lam: 1, gamma: g, lamReg: l }))[2], reg[0], 'σ = 1')
    expectClose(values(def.solve({ lam: 3, gamma: g, lamReg: l }))[2], reg[1], 'σ = 3')
  })

  it('HC-10.6：§10.5 表格 Δ/σ_v = 0.3 那一列——截斷 0.9852（±1 碼）/ 0.9578（Gaussian）、N_J = 4096 的雜訊 0.0462；預設讀數就是 signGmacMean 的精確值', () => {
    const row = NUM.fd.rows.find((r) => r.r === 0.3)!
    const def = handcalc('HC-10.6')
    const d = defaultValues(def)
    const [J, Jn, tPm1, tGauss, std] = values(def.solve(d))
    expectClose(tPm1, row.pm1, 'pm1')
    expectClose(tGauss, row.gaussian, 'gaussian')
    expectClose(std, row.stdNj4096, 'std')
    expectClose(tPm1, fdTruncationFactor('pm1', 0.3))
    expect(tPm1).toBeCloseTo(0.9852, 4)
    // 預設讀數 = ±1 碼、R_jj = 1 的精確 GMAC 平均（4 位有效數字）
    const plant = buildPlant({ mode: 'R', R: [[1]], sigmaV: 100, N: 4096, dist: 'pm1' })
    expect(d.gm).toBe(Number(signGmacMean(plant, [30])[0].toPrecision(4)))
    expect(d.gp).toBe(-d.gm)
    expect(d.gm).toBeCloseTo(NUM.fd.erf03, 4)
    expectClose(J, (d.gp - d.gm) / 60, 'J')
    // 量到的正規化斜率 ≈ −截斷係數（差異只來自讀數取 4 位）
    expect(Jn).toBeCloseTo(-tPm1, 3)
    // 步驟顯示的 erf 值與級數近似
    const erfStep = def.solve(d).steps[5]
    expect(erfStep.tex).toContain(`=${Number(NUM.fd.erf03.toPrecision(5))}`)
    expect(erfStep.why).toMatch(/級數/)
  })

  it('T18: HC-10.7 的範例數字（J = [[−1, 2], [2, −1]]、M = 0.2I）⇒ A = [[0.8, 0.4], [0.4, 0.8]]、eig 1.2 / 0.4、ρ(A) = 1.2（golden T18）', () => {
    const v = golden('T18')
    const sol = solveDefault('HC-10.7')
    const [p1, p2, rho] = values(sol)
    const eig = v.expected.eig_A_desc as number[]
    expectClose(p1, eig[0], 'p1')
    expectClose(p2, eig[1], 'p2')
    expectClose(rho, v.expected.spectral_radius as number, 'rho')
    expectClose(p1, NUM.t18.poles[0])
    expect(p1).toBeCloseTo(1.2, 12)
    expect(p2).toBeCloseTo(0.4, 12)
    // 單一 loop 的 pole 0.8、A 的元素、T = 1.6、D = 0.48、判別式 0.64
    const single = v.expected.single_loop_poles as number[]
    expect(sol.steps[0].tex).toContain(`=${single[0]},`)
    expect(sol.steps[1].tex).toContain('\\begin{bmatrix}0.8&0.4\\\\0.4&0.8\\end{bmatrix}')
    expect(sol.steps[2].tex.endsWith('=1.6')).toBe(true)
    expect(sol.steps[3].tex.endsWith('=0.48')).toBe(true)
    expect(sol.steps[4].tex.endsWith('=0.64')).toBe(true)
    expect(sol.notes?.join(' ')).toMatch(/每個 loop 單獨穩定，不代表 MIMO 一起穩定/)
    // eig(J) = +1、−3
    expect(sol.notes?.[0]).toContain('=1,\\ -3')
  })

  it('HC-10.7：複數 pole（J = [[−1, 2], [−2, −1]]、μ = 0.2 ⇒ 0.8 ± j0.4）拆成實部／虛部，|p| = √D；與 analyzeRule 的 eig 一致', () => {
    const def = handcalc('HC-10.7')
    const v = { j11: -1, j12: 2, j21: -2, j22: -1, mu: 0.2 }
    const sol = def.solve(v)
    expect(sol.results.map((r) => r.symbol)).toEqual(['\\operatorname{Re}p', '|\\operatorname{Im}p|', '\\rho(\\mathbf A)=|p|'])
    const [re, im, mod] = values(sol)
    expectClose(re, 0.8)
    expectClose(im, 0.4)
    expectClose(mod, Math.sqrt(0.8))
    const plant = buildPlant({ mode: 'J', Jn: [[-1, 2], [-2, -1]], sigmaV: SIGMA_KQ1, N: 1 }) // prettier-ignore
    const an = analyzeRule(plant, rule({ rule: 'scalar', muKq: 0.2 }), plant.Jn)
    expectClose(mod, an.spectralRadius)
    expectClose(im, Math.abs(an.poles[0].im))
    expect(sol.notes?.join(' ')).toMatch(/穩定/)
    expectRenderable(def, sol, 'HC-10.7 complex')
  })

  it('T11: HC-10.8 的範例數字 ⇒ k₉₅ = 598 / 5 / 65（golden T11 與文中 598 / 5 / 65），慢模式變異 = §10.4 表格（Lyapunov 數值解）', () => {
    const v = golden('T11')
    const [ks, kf, kr, vs, vf, vr] = values(solveDefault('HC-10.8'))
    expect(ks).toBe(v.expected.blocks_95)
    expect(kf).toBe(v.expected.preconditioned_blocks_95)
    expect(kr).toBe(NUM.rho099.blocksReg)
    expect([ks, kf, kr]).toEqual([598, 5, 65])
    // 變異：F-10.7 閉式 vs 離散 Lyapunov 方程的數值解（numbers.ts 由 analyzeRule 取得）
    expectClose(vs, NUM.noise.scalarModeVar[1], 'scalar', 1e-7)
    expectClose(vf, NUM.noise.modeVar[1], 'full', 1e-7)
    expectClose(vr, NUM.noise.regModeVar[1], 'reg', 1e-7)
    expectClose(vf, (golden('preconditioner_variance').expected.var_lambda_min_list as number[])[0], 'golden full')
    expect(vs).toBeCloseTo(0.96114, 4)
    expect(vr).toBeCloseTo(8.9185, 3)
  })

  it('HC-10.8：快模式主導時（ρ = .5、μK_q = 1.2）在觀察中說明整個迴路的 k₉₅ 與慢模式不同', () => {
    const def = handcalc('HC-10.8')
    const v = { ...defaultValues(def), rho: 0.5, muKq: 1.2 }
    expect(def.validate?.(v)).toBeNull()
    const sol = def.solve(v)
    // 慢 pole 1 − 1.2·0.5 = 0.4；快 pole 1 − 1.2·1.5 = −0.8
    expect(sol.results[0].value).toBe(stepsToDecay(0.4))
    expect(sol.notes?.join(' ')).toMatch(/絕對值最大的 pole 是快模式/)
    expect(sol.notes?.join(' ')).toContain(`$${stepsToDecay(0.8)}$`)
  })

  it('HC-10.8：每種更新矩陣各 4 步（m 與 p → k₉₅ → 1 − p² → Var）；1 − p² 拆成 (1 − p)(1 + p) 單獨一步，數字與變異步驟的分母一致', () => {
    const sol = solveDefault('HC-10.8')
    expect(sol.steps.length).toBe(3 + 3 * 4)
    const tex = sol.steps.map((s) => s.tex)
    // 一般 LMS：p = 0.995 ⇒ (1 − p)(1 + p) = 0.005 × 1.995 = 0.009975
    expect(tex[5]).toBe('1-p_{\\mathrm s}^2=(1-p_{\\mathrm s})(1+p_{\\mathrm s})=0.005\\times1.995=0.009975')
    expect(tex[6]).toContain('\\times0.009975}')
    // 完整反矩陣：p = 1 − γ = 0.5 ⇒ 1 − p² = γ(2 − γ) = 0.75
    expect(tex[9].endsWith('=0.5\\times1.5=0.75')).toBe(true)
    expect(tex[10]).toContain('\\times0.75}')
    // Regularized：p = 0.9545455 ⇒ 0.04545455 × 1.954545 = 0.088843
    expect(tex[13].endsWith('=0.04545455\\times1.954545=0.088843')).toBe(true)
    // 每個 1 − p² 步驟的三個數字自洽（獨立重算）
    for (const [i, p] of [[5, 0.995], [9, 0.5], [13, 1 - 0.5 * 0.01 / 0.11]] as const) { // prettier-ignore
      const nums = tex[i].split('=').slice(2).join('=').split(/\\times|=/).map(Number)
      expectClose(nums[0], 1 - p, `1 − p（step ${i}）`, 1e-6)
      expectClose(nums[1], 1 + p, `1 + p（step ${i}）`, 1e-6)
      expectClose(nums[2], 1 - p * p, `1 − p²（step ${i}）`, 1e-4)
    }
  })

  it('整數的 sample 數完整顯示（不做 5 位有效數字的四捨五入）：N_J = 262144、N = 1048576', () => {
    const fd = handcalc('HC-10.6')
    const v6 = { ...defaultValues(fd), NJ: 262144 }
    expect(fd.validate?.(v6)).toBeNull()
    const s6 = fd.solve(v6)
    expect(s6.steps.map((s) => s.tex).join(' ')).toContain('\\sqrt{\\frac{2}{262144}}')
    expect(s6.steps.map((s) => s.tex).join(' ')).not.toContain('262140')
    // √(2/262144) = √2/512
    expectClose(values(s6)[4], Math.SQRT2 / 512 / (2 * SQRT_2_OVER_PI * 0.3), 'std(N_J = 262144)')
    const nv = handcalc('HC-10.4')
    const v4 = { ...defaultValues(nv), N: 1048576 }
    expect(nv.validate?.(v4)).toBeNull()
    expect(nv.solve(v4).steps[1].tex).toContain('\\times1.048576\\times10^{6}=')
    expectRenderable(nv, nv.solve(v4), 'HC-10.4 N = 2^20')
  })

  it('HC-10.3／HC-10.6 的驗算與拆解步驟把中間值寫出來（每個等號只做一種運算）', () => {
    const inv = solveDefault('HC-10.3').steps.map((s) => s.tex)
    // (M_n R)₁₁ = 25.12563×1 + (−24.87437)×0.99 = 25.12563 + (−24.62563) = 0.5
    expect(inv[3]).toContain('=25.12563+(-24.62563)=0.5')
    expect(inv[4]).toContain('=24.87437+(-24.87437)=0')
    const fd = solveDefault('HC-10.6').steps.map((s) => s.tex)
    expect(fd.length).toBe(12)
    // r = Δ/σ_v 與 x = r/√2 各一步（一次除法）
    expect(fd[3]).toBe('r=\\frac{\\Delta}{\\sigma_v}=\\frac{30}{100}=0.3')
    expect(fd[4]).toBe('x=\\frac{r}{\\sqrt2}=\\frac{0.3}{1.4142}=0.21213')
    // Gaussian 截斷：1 + r² 一步、開根號與倒數一步
    expect(fd[8]).toBe('1+r^2=1+\\left(0.3\\right)^2=1+0.09=1.09')
    expect(fd[9]).toContain('\\frac{1}{\\sqrt{1.09}}=\\frac{1}{1.04403}=0.95783')
    expect(fd[10].endsWith('=\\sqrt{0.00048828}=0.022097')).toBe(true)
    expect(fd[11]).toContain('=\\frac{0.022097}{2\\times0.23937}=\\frac{0.022097}{0.47873}=0.046158')
  })
})

describe('Ch10 帶入手算：(b) 換一題（20 個 seed）= 測試內的獨立重算', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：randomValues 的每組數字都合法、結果有限、與獨立公式一致，步驟與說明的 TeX 可渲染', (id, def) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      expect(randomValues(def, seed), `${id} seed ${seed} 可重現`).toEqual(v)
      seen.add(JSON.stringify(v))
      expect(def.validate?.(v) ?? null, `${id} seed ${seed}: ${JSON.stringify(v)}`).toBeNull()
      const sol = def.solve(v)
      const want = INDEPENDENT[id](v)
      expect(sol.results.length, `${id} seed ${seed}`).toBe(want.length)
      sol.results.forEach((r, i) => {
        expect(Number.isFinite(r.value), `${id} seed ${seed} ${r.symbol}`).toBe(true)
        expectClose(r.value, want[i], `${id} seed ${seed} ${JSON.stringify(v)} → ${r.symbol}`)
        // 正確答案一定要被判為正確；差 5% 的答案（pole 類則以離 0／1 的距離計）不可以過關
        expect(checkAnswer(r.value, r).ok).toBe(true)
        expect(checkAnswer(want[i], r).ok).toBe(true)
      })
      expect(sol.steps.length).toBeGreaterThanOrEqual(5)
      if (seed <= 6) expectRenderable(def, sol, `${id} seed ${seed}`)
    }
    // 隨機出題真的有在換數字（不是每次都退回預設值）
    expect(seen.size, `${id} 的隨機題目種類`).toBeGreaterThan(5)
  })

  it('預設值也與獨立公式一致', () => {
    for (const def of HANDCALCS) {
      const v = defaultValues(def)
      const want = INDEPENDENT[def.id](v)
      const got = values(def.solve(v))
      expect(got.length, def.id).toBe(want.length)
      got.forEach((g, i) => expectClose(g, want[i], `${def.id}[${i}]`))
    }
  })

  it('HC-10.3：近奇異時對角 25.126 與非對角 24.874 只差 1%——答案的容差（0.2%）不會把兩者混為一談', () => {
    const [, m11, m12] = solveDefault('HC-10.3').results
    expect(checkAnswer(25.13, m11).ok).toBe(true)
    expect(checkAnswer(24.87, m11).ok).toBe(false)
    expect(checkAnswer(-24.87, m12).ok).toBe(true)
    expect(checkAnswer(-25.13, m12).ok).toBe(false)
    expect(checkAnswer(24.87, m12).ok).toBe(false) // 正負號也要對
  })

  it('pole 類答案的容差夠嚴：0.9995005 不會被 0.99 或 0.999 矇混過關；k₉₅ 只接受正確的整數', () => {
    const reg = solveDefault('HC-10.5')
    const pJ = reg.results[2]
    expect(checkAnswer(0.9995, pJ).ok).toBe(true)
    expect(checkAnswer(0.999, pJ).ok).toBe(false)
    expect(checkAnswer(0.99, pJ).ok).toBe(false)
    const k = solveDefault('HC-10.2').results[2]
    expect(checkAnswer(598, k).ok).toBe(true)
    expect(checkAnswer(597, k).ok).toBe(true) // 0.2% 以內（ln 四捨五入）
    expect(checkAnswer(590, k).ok).toBe(false)
    const k5 = solveDefault('HC-10.8').results[1]
    expect(checkAnswer(5, k5).ok).toBe(true)
    expect(checkAnswer(4, k5).ok).toBe(false)
  })
})

// ───────────── 畫面上的算式：把每一步的 TeX 重新求值（每個等號都要「按計算機算得出來」） ─────────────

type TexVal = number | number[][]
class Symbolic extends Error {}

function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  throw new Error(`大括號不成對：${s}`)
}

const SKIP = ['\\,', '\\;', '\\!', '\\ ', '\\qquad', '\\quad', '\\left', '\\right', '\\big', '\\Big']
const mapVal = (a: TexVal, f: (x: number) => number): TexVal => (typeof a === 'number' ? f(a) : a.map((r) => r.map(f)))
function mulVal(a: TexVal, b: TexVal): TexVal {
  if (typeof a !== 'number' && typeof b !== 'number') throw new Symbolic('matrix × matrix')
  return typeof a === 'number' ? mapVal(b, (x) => a * x) : mapVal(a, (x) => x * (b as number))
}
const num = (a: TexVal): number => {
  if (typeof a !== 'number') throw new Symbolic('matrix where a number is expected')
  return a
}

/**
 * 把一段「只含數字」的 TeX 求值：+ − × \frac \sqrt \ln erf |·| max ⌈·⌉ 次方、a\times10^{b}、bmatrix（逐元素）。
 * 含符號（字母）的片段丟出 Symbolic（呼叫端視為「這一段不是數字」）。遞迴下降剖析，不用 eval。
 */
class TexParser {
  private i = 0
  ceil = false
  constructor(private readonly s: string) {}

  private peek(t: string): boolean {
    return this.s.startsWith(t, this.i)
  }
  private eat(t: string): boolean {
    if (!this.peek(t)) return false
    this.i += t.length
    return true
  }
  private ws(): void {
    for (;;) {
      if (this.s[this.i] === ' ') {
        this.i++
        continue
      }
      const t = SKIP.find((k) => this.peek(k))
      if (!t) return
      this.i += t.length
    }
  }
  private group(): TexVal {
    this.ws()
    if (this.s[this.i] !== '{') throw new Symbolic(`expected { at ${this.s.slice(this.i)}`)
    const j = matchBrace(this.s, this.i)
    const v = new TexParser(this.s.slice(this.i + 1, j)).all()
    this.i = j + 1
    return v
  }
  private expr(): TexVal {
    this.ws()
    let v = this.term()
    for (;;) {
      this.ws()
      if (this.eat('+')) v = num(v) + num(this.term())
      else if (this.eat('-')) v = num(v) - num(this.term())
      else return v
    }
  }
  private term(): TexVal {
    let v = this.unary()
    for (;;) {
      this.ws()
      if (this.eat('\\times') || this.eat('\\cdot')) v = mulVal(v, this.unary())
      else if (this.peek('\\begin{bmatrix}')) v = mulVal(v, this.unary())
      else return v
    }
  }
  private unary(): TexVal {
    this.ws()
    if (this.eat('-')) return mapVal(this.unary(), (x) => -x)
    if (this.eat('+') || this.eat('\\pm')) return this.unary()
    const base = this.atom()
    this.ws()
    if (!this.eat('^')) return base
    this.ws()
    const e = this.s[this.i] === '{' ? num(this.group()) : Number(this.s[this.i++])
    return num(base) ** e
  }
  private atom(): TexVal {
    this.ws()
    if (this.eat('(')) {
      const v = this.expr()
      this.ws()
      if (!this.eat(')')) throw new Error(`括號不成對：${this.s}`)
      return v
    }
    if (this.eat('|')) {
      const v = Math.abs(num(this.expr()))
      this.ws()
      if (!this.eat('|')) throw new Error(`絕對值不成對：${this.s}`)
      return v
    }
    if (this.eat('\\lceil')) {
      const v = this.expr()
      this.ws()
      if (!this.eat('\\rceil')) throw new Error(`⌈⌉ 不成對：${this.s}`)
      this.ceil = true
      return v
    }
    if (this.peek('{')) return this.group()
    if (this.eat('\\frac') || this.eat('\\dfrac')) {
      const a = this.group()
      const b = num(this.group())
      return mapVal(a, (x) => x / b)
    }
    if (this.eat('\\sqrt')) {
      this.ws()
      return Math.sqrt(num(this.peek('{') ? this.group() : this.atom()))
    }
    if (this.eat('\\ln')) return Math.log(num(this.unary()))
    if (this.eat('\\operatorname{erf}')) return erfSeries(num(this.atom()))
    if (this.eat('\\max')) {
      this.ws()
      if (!this.eat('(')) throw new Symbolic('max')
      const a = num(this.expr())
      this.ws()
      if (!this.eat(',')) throw new Symbolic('max')
      const b = num(this.expr())
      this.ws()
      if (!this.eat(')')) throw new Symbolic('max')
      return Math.max(a, b)
    }
    if (this.eat('\\begin{bmatrix}')) {
      const j = this.s.indexOf('\\end{bmatrix}', this.i)
      const body = this.s.slice(this.i, j)
      this.i = j + '\\end{bmatrix}'.length
      return body.split('\\\\').map((row) => row.split('&').map((c) => num(new TexParser(c).all())))
    }
    const m = /^\d+(?:\.\d+)?/.exec(this.s.slice(this.i))
    if (!m) throw new Symbolic(this.s.slice(this.i, this.i + 16))
    this.i += m[0].length
    return Number(m[0])
  }
  all(): TexVal {
    const v = this.expr()
    this.ws()
    if (this.i !== this.s.length) throw new Symbolic(`rest: ${this.s.slice(this.i)}`)
    return v
  }
}

const UNIT_TAIL = /\\ \\(?:mathrm|text)\{[^}]*\}(?:\^\{?-?\d+\}?)?\s*$/
const LEAD_LABEL = /^\\text\{[^}]*\}\\quad/

/** 一段 TeX 的數值（含「是不是 ⌈·⌉」）；不是純數字就回傳 null。 */
function evalSeg(seg: string): { v: TexVal; ceil: boolean } | null {
  const body = seg.trim().replace(UNIT_TAIL, '').replace(LEAD_LABEL, '').trim()
  const parser = new TexParser(body)
  try {
    return { v: parser.all(), ceil: parser.ceil }
  } catch (e) {
    if (e instanceof Symbolic) return null
    throw e
  }
}

/** 在最外層（不在大括號或 bmatrix 裡）依分隔字串切開。 */
function splitTop(tex: string, seps: string[]): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let env = 0
  for (let i = 0; i < tex.length; ) {
    if (tex.startsWith('\\begin{', i)) env++
    else if (tex.startsWith('\\end{', i)) env--
    const sep = depth === 0 && env === 0 ? seps.find((k) => tex.startsWith(k, i)) : undefined
    if (sep) {
      out.push(cur)
      cur = ''
      i += sep.length
      continue
    }
    if (tex[i] === '{') depth++
    else if (tex[i] === '}') depth--
    cur += tex[i++]
  }
  out.push(cur)
  return out
}

const flat = (v: TexVal): number[] => (typeof v === 'number' ? [v] : v.flat())

/**
 * 一步的 TeX「a = b = c」：相鄰兩段的數字必須相等（容許顯示時四捨五入到 5 位造成的 2.5e-4 相對誤差；
 * 兩個數相減剛好抵銷時，以運算元的大小為尺度）。⌈r⌉ = n 檢查 n 是 r 的上整。回傳每條鏈最後的數字。
 */
function checkStepTex(tex: string, label: string): number[] {
  const finals: number[] = []
  for (const part of splitTop(tex, [',\\qquad', '\\qquad', '\\quad\\Rightarrow\\quad', '\\ \\Rightarrow\\ ', '\\Rightarrow'])) {
    const segs = splitTop(part.replace(/\\approx/g, '='), ['='])
      .map((seg) => ({ seg, r: evalSeg(seg) }))
      .filter((x): x is { seg: string; r: { v: TexVal; ceil: boolean } } => x.r !== null)
    if (!segs.length) continue
    finals.push(...flat(segs[segs.length - 1].r.v))
    for (let k = 0; k + 1 < segs.length; k++) {
      const a = segs[k]
      const b = segs[k + 1]
      const where = `${label}：「${a.seg}」之後接「${b.seg}」（${tex}）`
      const xs = flat(a.r.v)
      const ys = flat(b.r.v)
      expect(xs.length, where).toBe(ys.length)
      if (a.r.ceil && !b.r.ceil) {
        expect(ys[0], where).toBe(Math.max(1, Math.ceil(xs[0] - 1e-9)))
        continue
      }
      const literals = (a.seg.match(/(?<![\^{\d.])\d+(?:\.\d+)?/g) ?? []).map(Number)
      const operandScale = /[+-]/.test(a.seg) ? Math.max(0, ...literals) : 0
      xs.forEach((x, n) => {
        const scale = Math.max(Math.abs(x), Math.abs(ys[n]), operandScale)
        expect(Math.abs(x - ys[n]), `${where}：${x} ≠ ${ys[n]}`).toBeLessThanOrEqual(1e-12 + 2.5e-4 * scale)
      })
    }
  }
  return finals
}

/** 使用者自己打的數字（不在「換一題」的範圍內）：剛好抵銷成 0、負的 ρ、長小數、極端大小。 */
const USER_CASES: Record<string, Record<string, number>[]> = {
  'HC-10.1': [
    { rho: 0.1, d1: -0.3, d2: 3, sigmaV: 100, mu: 10 }, // −0.3 + 0.1×3：double 是 5.6e-17，手算是 0
    { rho: 0.8, d1: -4, d2: 5, sigmaV: SIGMA_KQ1, mu: 0.5 }, // §10.1 手算表的第二步
    { rho: -0.65, d1: 12.5, d2: -7.25, sigmaV: 137, mu: 33 },
  ],
  'HC-10.2': [
    { rho: -0.9, muKq: 0.3 },
    { rho: 0.97, muKq: 0.73 },
    { rho: 0, muKq: 1 }, // 兩個 pole 都是 0（deadbeat）
    { rho: 0.5, muKq: 1.2 }, // 快模式主導
  ],
  'HC-10.3': [
    { r11: 1.3, r12: -0.7, r22: 0.9, gamma: 1.5 },
    { r11: 1, r12: 0.999, r22: 1, gamma: 0.5 },
    { r11: 4, r12: 0, r22: 0.25, gamma: 1 },
  ],
  'HC-10.4': [
    { rho: -0.8, gamma: 1.5, N: 100, sigmaV: 37 },
    { rho: 0, gamma: 1, N: 1, sigmaV: 1 },
  ],
  'HC-10.5': [
    { lam: 1.99, gamma: 0.5, lamReg: 0.1 },
    { lam: 0.01, gamma: 0.5, lamReg: 1 }, // J 形式的比例是 9.999×10⁻⁵（科學記號當因數）
    { lam: 3, gamma: 0.5, lamReg: 0.1 },
    { lam: 0.37, gamma: 1.3, lamReg: 0 },
  ],
  'HC-10.6': [
    { gp: -0.31, gm: 0.33, dfs: 45, sigmaV: 100, NJ: 2000 },
    { gp: 0.02, gm: 0.1, dfs: 60, sigmaV: 300, NJ: 262144 }, // 兩個讀數同號（w 還沒校正好）
    { gp: -0.6, gm: 0.6, dfs: 100, sigmaV: 100, NJ: 4096 }, // x > 0.5：erf 級數不適用
  ],
  'HC-10.7': [
    { j11: -1, j12: 2, j21: -2, j22: -1, mu: 0.2 }, // 複數 pole
    { j11: -1, j12: 0, j21: 0, j22: -1, mu: 1 }, // 兩個 pole 都是 0
    { j11: -1.25, j12: 0.75, j21: 0.3, j22: -0.6, mu: 0.35 },
    { j11: -1, j12: 2, j21: -2, j22: -1, mu: 2.5 }, // 實部是負的複數 pole
    { j11: 1, j12: 0, j21: 0, j22: -1, mu: 0.5 }, // 單一 loop 就極性錯誤
  ],
  'HC-10.8': [
    { rho: -0.9, muKq: 0.3, gamma: 1.5, lamReg: 0, N: 100, sigmaV: 37 },
    { rho: 0.97, muKq: 0.73, gamma: 0.8, lamReg: 0.03, N: 5000, sigmaV: 120 },
    { rho: 0.5, muKq: 1.2, gamma: 1, lamReg: 0.2, N: 4096, sigmaV: 100 },
  ],
}

describe('Ch10 帶入手算：畫面上的每一步都算得出來（把步驟的 TeX 重新求值）', () => {
  it('剖析器本身：分數、根號、ln、次方、科學記號、矩陣、⌈·⌉ 與含符號的片段', () => {
    expect(evalSeg('\\frac{0.5}{0.26076\\times(2-0.5)}')?.v).toBeCloseTo(0.5 / (0.26076 * 1.5), 12)
    expect(evalSeg('\\left(6.3662\\times10^{-5}\\right)\\times4096\\ \\mathrm{fs}^{-2}')?.v).toBeCloseTo(6.3662e-5 * 4096, 12)
    expect(evalSeg('\\sqrt{\\left(0.75\\right)^2+\\left(0.35355\\right)^2}')?.v).toBeCloseTo(Math.hypot(0.75, 0.35355), 12)
    expect(evalSeg('\\left\\lceil\\frac{\\ln 0.05}{\\ln 0.995}\\right\\rceil')).toEqual({ v: LN005 / Math.log(0.995), ceil: true })
    expect(evalSeg('0.5\\times\\begin{bmatrix}2&-0.8\\\\-0.8&1\\end{bmatrix}')?.v).toEqual([[1, -0.4], [-0.4, 0.5]]) // prettier-ignore
    expect(evalSeg('\\max\\big(|-0.8|,\\ |0.2|\\big)')?.v).toBe(0.8)
    expect(evalSeg('1-0.2')?.v).toBeCloseTo(0.8, 12)
    expect(evalSeg('\\pm\\frac{0.70711}{2}')?.v).toBeCloseTo(0.353555, 12)
    expect(evalSeg('K_q\\,s_1')).toBeNull()
    expect(evalSeg('\\frac{\\ln 0.05}{\\ln|p|_{\\max}}')).toBeNull()
    // 檢查器真的會抓到錯：0.8 × 10 不是 9
    expect(() => checkStepTex('s=0.8\\times10=9', 'self-test')).toThrow()
    expect(() => checkStepTex('k=\\lceil 597.65\\rceil=597', 'self-test')).toThrow()
    expect(checkStepTex('a=1\\times0+0.8\\times10=0+8=8\\ \\mathrm{fs},\\qquad b=\\lceil 4.3219\\rceil=5', 'self-test')).toEqual([8, 5])
  })

  it.each(HANDCALCS.map((h) => [h.id, h] as const))(
    '%s：每個等號前後的數字一致；每個答案都是某一步算出來的數（預設值、20 組隨機數字、使用者自己打的數字）',
    (id, def) => {
      const cases: [string, Record<string, number>][] = [['default', defaultValues(def)]]
      for (let seed = 1; seed <= 20; seed++) cases.push([`seed ${seed}`, randomValues(def, seed)])
      USER_CASES[id].forEach((v, k) => cases.push([`user ${k}`, v]))
      for (const [tag, v] of cases) {
        const label = `${id} ${tag} ${JSON.stringify(v)}`
        expect(def.validate?.(v) ?? null, label).toBeNull()
        const sol = def.solve(v)
        const finals: number[] = []
        sol.steps.forEach((s, k) => {
          const f = checkStepTex(s.tex, `${label} step ${k + 1}`)
          expect(f.length, `${label} step ${k + 1} 沒有任何數字：${s.tex}`).toBeGreaterThan(0)
          finals.push(...f)
        })
        for (const r of sol.results) {
          const hit = finals.some((f) => Math.abs(f - r.value) <= 1e-9 + 1e-4 * Math.max(Math.abs(f), Math.abs(r.value)))
          expect(hit, `${label}：答案 ${r.symbol} = ${r.value} 不是任何一步的結果`).toBe(true)
        }
        // 畫面上不可出現浮點殘渣（1e-13 以下的非零數）或 NaN
        const shown = [...sol.steps.map((s) => s.tex), ...(sol.notes ?? [])].join(' ')
        expect(shown, label).not.toMatch(/NaN|Infinity|10\^\{-1[3-9]\}/)
      }
    },
  )

  it('使用者自己打的數字：答案仍等於測試內的獨立重算，說明文字可渲染', () => {
    for (const def of HANDCALCS) {
      USER_CASES[def.id].forEach((v, k) => {
        const sol = def.solve(v)
        const want = INDEPENDENT[def.id](v)
        expect(sol.results.length, `${def.id} user ${k}`).toBe(want.length)
        sol.results.forEach((r, i) => expectClose(r.value, want[i], `${def.id} user ${k} ${r.symbol}`, 1e-7))
        if (k === 0) expectRenderable(def, sol, `${def.id} user ${k}`)
      })
    }
  })

  it('HC-10.1：兩項剛好抵銷時（−0.3 + 0.1×3）畫面與答案都是 0，不是 5.6×10⁻¹⁷', () => {
    const def = handcalc('HC-10.1')
    const sol = def.solve({ rho: 0.1, d1: -0.3, d2: 3, sigmaV: 100, mu: 10 })
    expect(sol.steps[1].tex.endsWith('=-0.3+0.3=0\\ \\mathrm{fs}')).toBe(true)
    expect(sol.results[0].value).toBe(0)
    expect(sol.results[2].value).toBe(-0.3)
    // |G| > 1 的線性值在硬體上不可能出現：觀察中要說明
    const big = def.solve({ rho: 0.8, d1: 0, d2: 10, sigmaV: SIGMA_KQ1, mu: 0.5 })
    expect(big.notes?.join(' ')).toMatch(/不可能出現/)
    expect(solveDefault('HC-10.1').notes?.join(' ')).not.toMatch(/不可能出現/)
  })

  it('HC-10.6：「換一題」抽到的讀數都是 unit-RMS regressor 量得到的數字（|Ĵ/K_q| ≤ 1 + 雜訊），不會出現 −4.5 這種不可能的斜率', () => {
    const def = handcalc('HC-10.6')
    for (let seed = 1; seed <= 40; seed++) {
      const v = randomValues(def, seed)
      const [, Jn, , , std] = values(def.solve(v))
      expect(Math.abs(Jn), `seed ${seed} ${JSON.stringify(v)}`).toBeLessThanOrEqual(1 + 3 * std)
      expect(v.dfs / (Math.SQRT2 * v.sigmaV), `seed ${seed}：erf 級數的適用範圍`).toBeLessThanOrEqual(0.5)
    }
  })

  it('HC-10.7：eig(J) = 0（J 奇異）說明「不可辨識」而不是「極性錯誤」；複數 pole 的旋轉角以度表示', () => {
    const def = handcalc('HC-10.7')
    const singular = def.solve({ j11: -2, j12: 2, j21: 0.5, j22: -0.5, mu: 0.2 })
    expect(values(singular)).toEqual([1, 0.5, 1])
    expect(singular.notes?.[0]).toMatch(/奇異/)
    expect(singular.notes?.[0]).not.toMatch(/極性是錯的/)
    expect(solveDefault('HC-10.7').notes?.[0]).toMatch(/極性是錯的/)
    const rot = def.solve({ j11: -1, j12: 2, j21: -2, j22: -1, mu: 0.2 }) // 0.8 ± j0.4
    expect(rot.notes?.[0]).toContain(`=${Number(((Math.atan2(0.4, 0.8) * 180) / Math.PI).toPrecision(4))}^\\circ`)
    const back = def.solve({ j11: -1, j12: 2, j21: -2, j22: -1, mu: 2.5 }) // −1.5 ± j5：實部為負
    expect(back.notes?.[0]).toMatch(/加上 \$180\^\\circ\$/)
  })

  it('HC-10.5：λ_i = 1 時兩種形式給出同一個 pole，觀察不可以說「完全不同的設計」', () => {
    const def = handcalc('HC-10.5')
    const same = def.solve({ lam: 1, gamma: 1, lamReg: 0.1 })
    expectClose(values(same)[0], values(same)[2])
    expect(same.notes?.[0]).toMatch(/同一個 pole/)
    expect(same.notes?.[0]).not.toMatch(/完全不同的設計/)
    expect(solveDefault('HC-10.5').notes?.[0]).toMatch(/完全不同的設計/)
  })
})

describe('Ch10 帶入手算：(c) validate 擋掉模型不適用的輸入並說明原因', () => {
  const reject = (id: string, patch: Record<string, number>, reason: RegExp) => {
    const def = handcalc(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch }) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)} 應被拒絕`).not.toBeNull()
    expect(msg as string, `${id} ${JSON.stringify(patch)}`).toMatch(reason)
    const { container, unmount } = render(<MathText>{msg as string}</MathText>)
    expect(container.querySelectorAll('.katex-error').length, `${id} 的錯誤訊息`).toBe(0)
    expect(container.querySelectorAll('.katex').length, `${id} 的錯誤訊息要有 LaTeX`).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('$')
    unmount()
  }

  it('HC-10.1：|ρ| > 1（R 不是半正定）、σ_v = 0（K_q 無定義）', () => {
    reject('HC-10.1', { rho: 1.2 }, /不是半正定/)
    reject('HC-10.1', { rho: -1.01 }, /不是半正定/)
    reject('HC-10.1', { sigmaV: 0 }, /沒有線性的小訊號增益/)
  })

  it('HC-10.2：ρ = ±1（λ_min = 0 不可辨識）、μK_q ≤ 0、μK_q ≥ 2/λ_max（發散；訊息含實際的 pole）、pole 與 1 無法分辨', () => {
    reject('HC-10.2', { rho: 1 }, /不可辨識/)
    reject('HC-10.2', { rho: -1 }, /不可辨識/)
    reject('HC-10.2', { rho: 1.5 }, /不是半正定/)
    reject('HC-10.2', { muKq: 0 }, /不更新/)
    reject('HC-10.2', { muKq: -0.5 }, /方向相反/)
    reject('HC-10.2', { muKq: 1.2 }, /發散/)
    expect(handcalc('HC-10.2').validate?.({ rho: 0.99, muKq: 1.2 })).toContain('-1.388') // 1 − 1.2·1.99
    reject('HC-10.2', { rho: 0.99999999999 }, /等同不可辨識/)
    // 2/λ_max 的邊界：ρ = .99 ⇒ 1.005025…
    expect(handcalc('HC-10.2').validate?.({ rho: 0.99, muKq: 1.005 })).toBeNull()
    expect(handcalc('HC-10.2').validate?.({ rho: 0.99, muKq: 1.0051 })).not.toBeNull()
  })

  it('HC-10.3：det R = 0（不可辨識）、det R < 0（非半正定）、R_ii ≤ 0、γ 不在 (0, 2)', () => {
    reject('HC-10.3', { r12: 1 }, /不可辨識/)
    reject('HC-10.3', { r12: 1.5 }, /不是半正定/)
    reject('HC-10.3', { r11: 0 }, /功率/)
    reject('HC-10.3', { r22: -1 }, /功率/)
    reject('HC-10.3', { gamma: 2 }, /修正過頭/)
    reject('HC-10.3', { gamma: 0 }, /0<\\gamma<2/)
  })

  it('HC-10.4：ρ = 1、γ 不在 (0, 2)、N 不是正整數、σ_v ≤ 0', () => {
    reject('HC-10.4', { rho: 1 }, /不可辨識/)
    reject('HC-10.4', { rho: 1.1 }, /不是半正定/)
    reject('HC-10.4', { gamma: 2 }, /0<\\gamma<2/)
    reject('HC-10.4', { N: 0 }, /整數/)
    reject('HC-10.4', { N: 10.5 }, /整數/)
    reject('HC-10.4', { sigmaV: 0 }, /小訊號增益/)
  })

  it('HC-10.5：λ_i < 0、λ_reg < 0、0/0（λ_i = λ_reg = 0）、γ 不在 (0, 2)；λ_i = 0 但 λ_reg > 0 可以算（pole = 1）', () => {
    reject('HC-10.5', { lam: -0.1 }, /不可能是負的/)
    reject('HC-10.5', { lamReg: -0.1 }, /奇異/)
    reject('HC-10.5', { lam: 0, lamReg: 0 }, /分母是 0/)
    reject('HC-10.5', { gamma: 2.5 }, /發散/)
    const def = handcalc('HC-10.5')
    const v = { lam: 0, gamma: 0.5, lamReg: 0.1 }
    expect(def.validate?.(v)).toBeNull()
    const sol = def.solve(v)
    expect(values(sol)).toEqual([1, 5, 1])
    expect(sol.notes?.join(' ')).toMatch(/永遠不收斂/)
    expectRenderable(def, sol, 'HC-10.5 λ = 0')
  })

  it('HC-10.6：|G| > 1（average 模式不可能）、Δ ≤ 0、σ_v ≤ 0、N_J 不是正整數、讀數與 Δ／σ_v 不相容', () => {
    reject('HC-10.6', { gp: -1.2 }, /不可能超過 1/)
    reject('HC-10.6', { gm: 1.01 }, /不可能超過 1/)
    reject('HC-10.6', { dfs: 0 }, /分母/)
    reject('HC-10.6', { sigmaV: 0 }, /小訊號增益/)
    reject('HC-10.6', { NJ: 0 }, /整數/)
    reject('HC-10.6', { NJ: 100.5 }, /整數/)
    // 讀數的差遠大於 2K_qΔ ＋ 5 倍雜訊：unit-RMS regressor 量不到這種斜率（|R_ij| ≤ 1）
    reject('HC-10.6', { dfs: 3 }, /Cauchy–Schwarz/)
    reject('HC-10.6', { gp: -0.24, gm: 0.12, dfs: 10, sigmaV: 200, NJ: 65536 }, /sum 模式/)
    // N_J 很小時雜訊帶很寬：同樣的讀數是可能的，不擋
    expect(handcalc('HC-10.6').validate?.({ gp: -0.24, gm: 0.12, dfs: 10, sigmaV: 200, NJ: 64 })).toBeNull()
  })

  it('HC-10.7：J = 0、μ ≤ 0', () => {
    reject('HC-10.7', { j11: 0, j12: 0, j21: 0, j22: 0 }, /沒有斜率/)
    reject('HC-10.7', { mu: 0 }, /不更新/)
    reject('HC-10.7', { mu: -0.2 }, /極性反過來/)
  })

  it('HC-10.8：ρ = 1、μK_q 超出穩定範圍、γ 不在 (0, 2)、λ_reg < 0、N 與 σ_v 不合法', () => {
    reject('HC-10.8', { rho: 1 }, /不可辨識/)
    reject('HC-10.8', { muKq: 1.5 }, /不在單位圓內/)
    reject('HC-10.8', { muKq: 0 }, /不收斂/)
    reject('HC-10.8', { gamma: 0 }, /0<\\gamma<2/)
    reject('HC-10.8', { gamma: 2 }, /0<\\gamma<2/)
    reject('HC-10.8', { lamReg: -0.1 }, /\\ge0/)
    reject('HC-10.8', { N: 0 }, /整數/)
    reject('HC-10.8', { sigmaV: -1 }, /小訊號增益/)
    reject('HC-10.8', { rho: 0.99999999999 }, /等同不可辨識/)
  })
})

describe('Ch10 帶入手算：(d) <HandCalc> 渲染', () => {
  it.each(HANDCALCS.map((h) => [h.id, h] as const))('%s：預設值渲染出所有步驟與答案框，沒有 KaTeX 錯誤', (_id, def) => {
    const sol = def.solve(defaultValues(def))
    const { container, unmount } = render(<HandCalc def={def} />)
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.querySelector('.c-tex-error')).toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThanOrEqual(1)
    expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(sol.results.length)
    expect(container.querySelectorAll('.c-handcalc-input').length).toBe(def.inputs.length)
    // 標題、輸入說明、提示裡的 $...$ 都已轉成 KaTeX（沒有落單的 $）
    expect(container.querySelector('.c-handcalc-head')?.textContent).not.toContain('$')
    expect(container.querySelector('.c-handcalc-inputs')?.textContent).not.toContain('$')
    expect(container.querySelector('.c-handcalc-tips')?.textContent).not.toContain('$')
    expect(container.querySelector('.callout-warn')).toBeNull()
    unmount()
    expectRenderable(def, sol, `${def.id} default`)
  })

  it('HC-10.3：把 R₁₂ 改成 1 ⇒ 不顯示步驟，改顯示「不可辨識」的原因；改成 0.6 ⇒ det = 0.64、M_n = [[0.78125, −0.46875], …]', () => {
    const def = handcalc('HC-10.3')
    const { container } = render(<HandCalc def={def} />)
    const r12 = screen.getByLabelText(/（r12）/) as HTMLInputElement
    fireEvent.change(r12, { target: { value: '1' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toMatch(/不可辨識，反矩陣不存在/)
    expect(container.querySelector('.callout-warn .katex')).toBeTruthy()
    fireEvent.change(r12, { target: { value: '0.6' } })
    expect(container.querySelector('.callout-warn')).toBeNull()
    expect(container.querySelectorAll('.c-step').length).toBe(6)
    expect(container.textContent).toContain('0.78125')
    expect(container.textContent).toContain('0.46875')
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('HC-10.7：自己算算看——輸入 1.2 / 0.4 / 1.2 判為正確；輸入錯的 pole 判為錯誤', () => {
    const def = handcalc('HC-10.7')
    const { container } = render(<HandCalc def={def} initialMode="practice" />)
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    const boxes = screen.getAllByPlaceholderText('你的答案')
    expect(boxes.length).toBe(3)
    fireEvent.change(boxes[0], { target: { value: '1.2' } })
    fireEvent.change(boxes[1], { target: { value: '0.8' } }) // 把單一 loop 的 pole 當成答案
    fireEvent.change(boxes[2], { target: { value: '1.2' } })
    fireEvent.click(screen.getByText('對答案'))
    expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(2)
    expect(container.querySelectorAll('.c-handcalc-verdict.bad').length).toBe(1)
    fireEvent.click(screen.getByText('看詳解'))
    expect(container.querySelectorAll('.c-step').length).toBe(def.solve(defaultValues(def)).steps.length)
  })
})
