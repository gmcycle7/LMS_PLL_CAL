import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { HandCalc, checkAnswer, defaultValues, inputError, randomValues, renderTex } from '@/components'
import type { HandCalcDef, HandCalcSolution } from '@/data/types'
import { normCdf, normInv, normPdf } from '@/simulation/core'
import { calLoop } from '@/simulation/models/calNoise'
import {
  blockLoopLinear,
  directionClt,
  directionCltPlain,
  directionExact,
  directionOutcomeExact,
  kq,
  kqLocal,
  linearizationRelError,
  meanQ,
  minNForTarget,
  pPlus,
  samplesForConfidence,
  samplesSmallSignal,
  signLoopLinearRms,
  sumMoments,
  tieProbStirling,
  tieRuleEquilibrium,
  tieRuleEquilibriumApprox,
  varQ,
  kqHysteresis,
  kqMetaDrop,
  metaProb,
  nonidealSummary,
  nuHysteresis,
} from '@/simulation/models/comparator'
import { FORMULAS } from './formulas'
import { HANDCALCS, HC05_HAND_CONSTANTS, HC05_LIMITS, nextOdd, phiHand, rd, zHand } from './handcalcs'
import { expectNoTexErrors } from '@/test/katex'

// 多個 agent／開發者同時跑測試時 CPU 會嚴重超額（load average 曾達數百），jsdom 渲染與逐項 Binomial 的測試比平常慢一到兩個數量級：
// 放寬的是「等待時間」，不是任何數值判準。
vi.setConfig({ testTimeout: 300_000 })

interface GoldenVector {
  expected: Record<string, number | number[]>
}
const golden = (id: string): GoldenVector => JSON.parse(readFileSync(resolve(process.cwd(), `golden/vectors/${id}.json`), 'utf8'))
const num = (v: GoldenVector, key: string, i?: number): number => {
  const x = v.expected[key]
  return Array.isArray(x) ? x[i ?? 0] : x
}

const byId = (id: string): HandCalcDef => {
  const d = HANDCALCS.find((h) => h.id === id)
  if (!d) throw new Error(`找不到 ${id}`)
  return d
}
const solveDefault = (id: string): HandCalcSolution => byId(id).solve(defaultValues(byId(id)))

/* ───────────── 測試內獨立重算用的工具（不呼叫 comparator.ts） ───────────── */

const SQRT_2PI = Math.sqrt(2 * Math.PI)
const ROOT_2_OVER_PI = Math.sqrt(2 / Math.PI)

/** Φ(z)：用 Simpson 法直接積分 φ（與模擬核心的 erf／normCdf 無關）。 */
function phiSimpson(z: number): number {
  const a = Math.abs(z)
  if (a > 12) return z > 0 ? 1 : 0
  const n = 4000
  const h = a / n
  const f = (t: number) => Math.exp((-t * t) / 2) / SQRT_2PI
  let sum = f(0) + f(a)
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(i * h)
  const area = (sum * h) / 3
  return z >= 0 ? 0.5 + area : 0.5 - area
}

/** Φ⁻¹(P)：對 phiSimpson 做二分法。 */
function phiInvBisect(P: number): number {
  let lo = -10
  let hi = 10
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (phiSimpson(mid) < P) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** ln C(n, k)：逐項相加（不用 lgamma）。 */
function logChoose(n: number, k: number): number {
  let s = 0
  for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i)
  return s
}

/** P(K = k)，K ~ Binomial(n, p)（log 空間）。 */
function binomPmfDirect(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0
  if (p >= 1) return k === n ? 1 : 0
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

/** P(K ≥ k0)：直接把 pmf 相加（測試用的 N ≤ 4096）。 */
function binomTailDirect(k0: number, n: number, p: number): number {
  let s = 0
  for (let k = k0; k <= n; k++) s += binomPmfDirect(k, n, p)
  return s
}

const mExact = (r: number) => 2 * phiSimpson(r) - 1

/** 每一題「模型答案」的獨立重算：直接由公式（Simpson 的 Φ、逐項 Binomial）算，不呼叫模型函式。 */
const independent: Record<string, (v: Record<string, number>) => number[]> = {
  'HC-05.1': ({ s, sigma, theta }) => {
    const p = phiSimpson((s - theta) / sigma)
    const m = 2 * p - 1
    return [p, m, 1 - m * m]
  },
  'HC-05.2': ({ s, sigma, N }) => {
    const m = mExact(s / sigma)
    const sd = Math.sqrt(N * (1 - m * m))
    return [N * m, sd, (N * m) / sd]
  },
  'HC-05.3': ({ p }) => [p * p, 2 * p * (1 - p), p * p * (3 - 2 * p)],
  'HC-05.4': ({ s, sigma, N }) => {
    const m = mExact(s / sigma)
    const sd = Math.sqrt(N * (1 - m * m))
    const plain = phiSimpson((N * m) / sd)
    return N % 2 === 0 ? [plain, phiSimpson((N * m - 1) / sd)] : [plain]
  },
  'HC-05.5': ({ N, s, sigma }) => {
    const p = phiSimpson(s / sigma)
    return [binomPmfDirect(N / 2, N, p)] // |s*| 另外用「E[d] = 0」的根性質驗證
  },
  'HC-05.6': ({ s, sigma, P }) => {
    const z = phiInvBisect(P)
    const m = Math.abs(mExact(s / sigma))
    return [z, (z * z * (1 - m * m)) / (m * m)]
  },
  'HC-05.7': ({ sigma, s }) => {
    const r = s / sigma
    const K = ROOT_2_OVER_PI / sigma
    return [K, K * s, r === 0 ? 0 : (ROOT_2_OVER_PI * r) / mExact(r) - 1, Math.exp((-r * r) / 2)]
  },
  'HC-05.9': ({ h, sigma }) => {
    // 直接由定義：φ(η)/(σΦ(−η))、ν = 1 − 2Φ(−η)（Φ 用 Simpson）
    const eta = h / sigma
    const phiEta = Math.exp((-eta * eta) / 2) / SQRT_2PI
    const PhiNeg = phiSimpson(-eta)
    const Kh = phiEta / (sigma * PhiNeg)
    const ratio = Kh / (ROOT_2_OVER_PI / sigma)
    const nu = 1 - 2 * PhiNeg
    const keff = ratio * Math.sqrt((1 - nu) / (1 + nu))
    return [Kh, ratio, nu, keff, 1 / (keff * keff)]
  },
  'HC-05.10': ({ eps, sigma, N }) => {
    const pm = 2 * phiSimpson(eps / sigma) - 1
    return [pm, N * pm, Math.exp((-eps * eps) / (2 * sigma * sigma))]
  },
  'HC-05.8': ({ sigma, mu, N, fs }) => {
    const K = ROOT_2_OVER_PI / sigma
    const pole = 1 - mu * K
    const tau = -1 / Math.log(Math.abs(pole))
    return [2 / K, pole, tau, (tau * N) / (fs * 1e9) / 1e-6, mu / Math.sqrt(N * (1 - pole * pole))]
  },
}

/** 小數四捨五入（模擬查表或抄寫時的位數）。 */
const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
const sig5 = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(5)))

/**
 * 每一題「照著步驟手算」會得到的答案（可能有多種算法：例如查表或用近似）。
 * 步驟中的每個中間結果都四捨五入到 5 位有效數字，模擬紙筆抄寫。
 */
const handAnswers: Record<string, (v: Record<string, number>) => number[][]> = {
  'HC-05.1': ({ s, sigma, theta }) => {
    const r = sig5((s - theta) / sigma)
    const half = sig5(r * 0.39894)
    const m = sig5(2 * half)
    return [[0.5 + half, m, 1 - sig5(m * m)]]
  },
  'HC-05.2': ({ s, sigma, N }) => {
    const m = sig5(0.79788 * sig5(s / sigma))
    const mean = sig5(N * m)
    const sd = sig5(Math.sqrt(N * (1 - sig5(m * m))))
    return [[mean, sd, sig5(mean / sd)]]
  },
  'HC-05.3': ({ p }) => {
    const q = 1 - p
    const pp = roundTo(p * p, 6)
    const pq = roundTo(p * q, 6)
    // 兩種抄法：只抄 6 位小數，或照提示抄 8 位有效數字
    const sig8 = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(8)))
    return [
      [pp, 2 * pq, roundTo(pp * p, 6) + roundTo(3 * pp * q, 6)],
      [sig8(p * p), 2 * sig8(p * q), sig8(sig8(p * p) * p) + 3 * sig8(sig8(p * p) * q)],
    ]
  },
  'HC-05.4': ({ s, sigma, N }) => {
    const m = sig5(0.79788 * sig5(s / sigma))
    const Nm = sig5(N * m)
    const sd = sig5(Math.sqrt(N * (1 - sig5(m * m))))
    const z = sig5(Nm / sd)
    const zc = sig5((Nm - 1) / sd)
    /** 查表：z 取到小數第二位、Φ 取四位小數 */
    const table = (x: number) => roundTo(phiSimpson(roundTo(x, 2)), 4)
    const noTable = (x: number) => roundTo(phiHand(x).value, 4)
    return N % 2 === 0
      ? [
          [table(z), table(zc)],
          [noTable(z), noTable(zc)],
        ]
      : [[table(z)], [noTable(z)]]
  },
  'HC-05.5': ({ N, s, sigma }) => {
    const tie0 = sig5(Math.sqrt(sig5(2 / sig5(Math.PI * N))))
    const m = sig5(0.79788 * sig5(s / sigma))
    const fac = sig5(Math.exp(-sig5((N * sig5(m * m)) / 2)))
    const K = sig5(0.79788 / sigma)
    return [[sig5(tie0 * fac), sig5(1 / sig5(N * K))]]
  },
  'HC-05.6': ({ s, sigma, P }) => {
    const variants: number[][] = []
    for (const digits of [3, 2]) {
      const z = roundTo(phiInvBisect(P), digits)
      const zr = sig5(z * sig5(sigma / Math.abs(s)))
      const n = sig5(sig5(zr * zr) * 1.5708)
      variants.push([z, n], [z, nextOdd(n)])
    }
    // 沒有反查表：用手算提示的 Abramowitz–Stegun 近似（t、z 各抄到 5 位有效數字）
    const t = sig5(Math.sqrt(-2 * Math.log(1 - P)))
    const zNoTable = sig5(t - sig5(2.30753 + 0.27061 * t) / sig5(1 + 0.99229 * t + 0.04481 * sig5(t * t)))
    const zrNoTable = sig5(zNoTable * sig5(sigma / Math.abs(s)))
    const nNoTable = sig5(sig5(zrNoTable * zrNoTable) * 1.5708)
    variants.push([zNoTable, nNoTable], [zNoTable, nextOdd(nNoTable)])
    return variants
  },
  'HC-05.7': ({ sigma, s }) => {
    const K = sig5(0.79788 / sigma)
    const r = sig5(s / sigma)
    const r2 = sig5(r * r)
    return [[K, sig5(K * s), sig5(r2 / 6), sig5(Math.exp(-sig5(r2 / 2)))]]
  },
  'HC-05.9': ({ h, sigma }) => {
    const eta = sig5(h / sigma)
    const expo = sig5(Math.exp(-sig5(sig5(eta * eta) / 2)))
    const phiEta = sig5(0.39894 * expo)
    /** 查表：四位小數的 Φ(−η) */
    const PhiNeg = roundTo(phiSimpson(roundTo(-eta, 2)), 4)
    const Kh = sig5(phiEta / (sigma * PhiNeg))
    const ratio = sig5(phiEta / (0.79788 * PhiNeg))
    const nu = 1 - 2 * PhiNeg
    const F = sig5((1 + nu) / (1 - nu))
    const keff = sig5(ratio / sig5(Math.sqrt(F)))
    return [[Kh, ratio, nu, keff, sig5(1 / (keff * keff))]]
  },
  'HC-05.10': ({ eps, sigma, N }) => {
    const r = sig5(eps / sigma)
    const pLin = sig5(0.79788 * r)
    const pTab = 2 * roundTo(phiSimpson(roundTo(r, 2)), 4) - 1
    const p = r <= 0.3 ? pLin : pTab
    const ratio = sig5(Math.exp(-sig5(sig5(r * r) / 2)))
    return [[p, sig5(N * p), ratio]]
  },
  'HC-05.8': ({ sigma, mu, N, fs }) => {
    const K = sig5(0.79788 / sigma)
    const g = sig5(mu * K)
    const pole = sig5(1 - g)
    const tau = sig5(-1 / sig5(Math.log(Math.abs(pole))))
    const blkUs = N / fs / 1000
    const root = sig5(Math.sqrt(sig5(N * sig5(1 - sig5(pole * pole)))))
    return [[sig5(2 / K), pole, tau, sig5(tau * blkUs), sig5(mu / root)]]
  },
}

/** 所有 practice choices 的組合（笛卡兒積）。 */
function practiceGrid(def: HandCalcDef): Record<string, number>[] {
  let out: Record<string, number>[] = [{}]
  for (const i of def.inputs) {
    const choices = [...new Set(i.practice?.choices ?? [i.default])]
    out = out.flatMap((v) => choices.map((c) => ({ ...v, [i.key]: c })))
  }
  return out
}

/** 字串裡的 `$...$` 片段。 */
function mathSegments(text: string): string[] {
  return [...text.matchAll(/(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g)].map((m) => m[1])
}

/** 一份詳解的所有 TeX（步驟、理由、結果、補充）都能被 KaTeX 解析，而且不含 e 記號或裸逗號千分位。 */
function expectTexOk(def: HandCalcDef, sol: HandCalcSolution, tag: string) {
  const display = [...sol.steps.map((s) => s.tex), ...sol.results.map((r) => `\\boxed{${r.symbol} = 1${r.unit ? `\\ ${r.unit}` : ''}}`)]
  const inline = [...sol.steps.flatMap((s) => mathSegments(s.why)), ...sol.results.flatMap((r) => mathSegments(r.label ?? '')), ...(sol.notes ?? []).flatMap(mathSegments)]
  for (const t of display) expect(renderTex(t, true), `${def.id} ${tag}: ${t}`).not.toContain('katex-error')
  for (const t of inline) expect(renderTex(t, false), `${def.id} ${tag}: ${t}`).not.toContain('katex-error')
  for (const t of [...display, ...inline]) {
    expect(/\d(\.\d+)?e[-+]?\d/.test(t), `${def.id} ${tag} 不可出現 e 記號：${t}`).toBe(false)
    expect(/\d,\d{3}(?!\d)/.test(t), `${def.id} ${tag} 千分位要寫成 {,}：${t}`).toBe(false)
    expect(t, `${def.id} ${tag}`).not.toContain('NaN')
  }
}

/* ───────────── 結構 ───────────── */

describe('Ch05 帶入手算：題目結構', () => {
  it('10 題、id 為 HC-05.1 … HC-05.10（綜合題維持 HC-05.8，id 對外是網址；wave 5 的 §5b 遲滯題 HC-05.9、決策窗題 HC-05.10 接在後面編號）、頁面 /ch/05，難度分三層，公式 ID 都存在於本章公式登錄表', () => {
    expect(HANDCALCS.map((h) => h.id)).toEqual(['HC-05.1', 'HC-05.2', 'HC-05.3', 'HC-05.4', 'HC-05.5', 'HC-05.6', 'HC-05.7', 'HC-05.8', 'HC-05.9', 'HC-05.10'])
    const formulaIds = new Set(FORMULAS.map((f) => f.id))
    for (const h of HANDCALCS) {
      expect(h.page, h.id).toBe('/ch/05')
      expect(formulaIds.has(h.formulaId ?? ''), `${h.id} → ${h.formulaId}`).toBe(true)
      expect(renderTex(h.formulaTex, true), h.id).not.toContain('katex-error')
      expect(h.tips?.length ?? 0, h.id).toBeGreaterThanOrEqual(3)
      expect(h.inputs.some((i) => i.practice), h.id).toBe(true)
    }
    const levels = HANDCALCS.map((h) => h.level)
    expect(levels.filter((l) => l === 'beginner').length).toBeGreaterThanOrEqual(2)
    expect(levels.filter((l) => l === 'engineer').length).toBeGreaterThanOrEqual(2)
    expect(levels.filter((l) => l === 'research').length).toBeGreaterThanOrEqual(2)
  })

  it('預設值就是本章的 worked example（s = 1 fs、σ_v = 100 fs、μ = 10 fs、N = 4096 / 10⁴ / 100、95%），而且全部合法', () => {
    for (const h of HANDCALCS) {
      const v = defaultValues(h)
      for (const i of h.inputs) expect(inputError(i, v[i.key]), `${h.id}.${i.key}`).toBeNull()
      expect(h.validate?.(v) ?? null, h.id).toBeNull()
      if ('s' in v) expect(v.s, h.id).toBe(1)
      if ('sigma' in v) expect(v.sigma, h.id).toBe(100)
    }
    expect(defaultValues(byId('HC-05.2')).N).toBe(10000)
    expect(defaultValues(byId('HC-05.3')).p).toBe(Number(pPlus(1, 100).toFixed(7))) // 0.5039894 = HC-05.1 答案顯示的 7 位
    expect(defaultValues(byId('HC-05.4')).N).toBe(100)
    expect(defaultValues(byId('HC-05.5')).N).toBe(100)
    expect(defaultValues(byId('HC-05.6')).P).toBe(0.95)
    // HC-05.9 用到 F-05.26（CLT + 小訊號）的 K_eff 與 N(h)/N(0)，所以整題標 approx（F-05.22 本身是 exact）；決策窗題只用 F-05.24／25 的精確式
    expect(byId('HC-05.9').claim).toBe('approx')
    expect(byId('HC-05.10').claim).toBe('exact')
    expect(defaultValues(byId('HC-05.9'))).toEqual({ h: 30, sigma: 100 })
    expect(defaultValues(byId('HC-05.10'))).toEqual({ eps: 5, sigma: 100, N: 4096 })
    expect(defaultValues(byId('HC-05.8'))).toEqual({ sigma: 100, mu: 10, N: 4096, fs: 4 })
  })

  it('HC-05.3 / .4 / .8 / .9 的通式在桌機寬度（878 px 欄）放不下一行：拆成兩行對齊（aligned），原本的每一項都還在', () => {
    // 內容和拆行前完全相同；只在最上層的逗號／關係式之間換行，所以只確認各段 TeX 都還在、換行恰好一次
    const parts: Record<string, string[][]> = {
      'HC-05.3': [
        [String.raw`P(K=k)=\binom Nk p^k(1-p)^{N-k}`, String.raw`S_N=2K-N`],
        [String.raw`P(S_2>0)=p^2`, String.raw`P(S_2=0)=2p(1-p)`, String.raw`P(S_3>0)=p^3+3p^2(1-p)`],
      ],
      'HC-05.4': [
        [String.raw`z=\frac{Nm}{\sigma_S}`, String.raw`\sigma_S=\sqrt{N(1-m^2)}`, String.raw`\Phi(z)\approx\begin{cases}P(S_N>0) & N\text{ 奇數}\\ P(S_N>0)+\tfrac12P(S_N=0) & N\text{ 偶數}\end{cases}`],
        [String.raw`P(S_N>0)\approx\Phi\!\Big(\frac{Nm-1}{\sigma_S}\Big)\ (N\text{ 偶數})`],
      ],
      'HC-05.9': [
        [String.raw`\eta=\frac{h}{\sigma_v}`, String.raw`K_q(h)=\frac{\varphi(\eta)}{\sigma_v\,\Phi(-\eta)}`, String.raw`\nu=1-2\Phi(-\eta)`, String.raw`F=\frac{1+\nu}{1-\nu}`],
        [String.raw`K_{\mathrm{eff}}=\frac{K_q(h)}{\sqrt F}`, String.raw`\frac{N(h)}{N(0)}=\Big(\frac{K_q}{K_{\mathrm{eff}}}\Big)^2`],
      ],
      'HC-05.8': [
        [String.raw`K_q=\sqrt{\tfrac2\pi}\,\frac1{\sigma_v}`, String.raw`0<\mu<\mu_{\max}=\frac{2}{K_q}`, String.raw`g=\mu K_q`, String.raw`p_{\mathrm{cal}}=1-g`],
        [String.raw`\tau=\frac{-1}{\ln|p_{\mathrm{cal}}|}`, String.raw`\sigma_w=\frac{\mu}{\sqrt{N\,(1-p_{\mathrm{cal}}^2)}}`],
      ],
    }
    for (const [id, lines] of Object.entries(parts)) {
      const tex = byId(id).formulaTex
      expect(tex.startsWith(String.raw`\begin{aligned}`) && tex.endsWith(String.raw`\end{aligned}`), id).toBe(true)
      expect(tex.split(String.raw`\\[1ex]`).length, `${id} 恰好兩行`).toBe(2)
      lines.forEach((segs, li) => {
        const line = tex.split(String.raw`\\[1ex]`)[li]
        for (const seg of segs) expect(line, `${id} 第 ${li + 1} 行`).toContain(seg)
      })
      expect(renderTex(tex, true), id).not.toContain('katex-error')
    }
  })
})

/* ───────────── (a) 預設值 = 模型函式／文中數字／golden vector ───────────── */

describe('Ch05 帶入手算：預設值對上模型、文中表格與 golden vector', () => {
  it('T04: HC-05.1 的 p、m 等於 golden 的 p_plus、mean_q，Var(q) = 1 − m²（s = 1 fs、σ_v = 100 fs）', () => {
    const g = golden('T04')
    const [p, m, v] = solveDefault('HC-05.1').results.map((r) => r.value)
    expect(p).toBeCloseTo(num(g, 'p_plus'), 12)
    expect(m).toBeCloseTo(num(g, 'mean_q'), 12)
    expect(v).toBeCloseTo(varQ(meanQ(1, 100)), 14)
    expect(p).toBe(pPlus(1, 100, 0))
    expect(m).toBe(meanQ(1, 100, 0))
    // 文中的參考值（§2）：0.503989
    expect(p.toFixed(6)).toBe('0.503989')
  })

  it('HC-05.2 的三個答案等於 sumMoments；與 §3 的文中數字 E = 79.787、SD = 99.997 相同', () => {
    const mom = sumMoments(10000, meanQ(1, 100))
    const [mean, sd, snr] = solveDefault('HC-05.2').results.map((r) => r.value)
    expect(mean).toBe(mom.meanSum)
    expect(sd).toBe(mom.sdSum)
    expect(snr).toBe(mom.snr)
    expect(mean.toFixed(3)).toBe('79.787')
    expect(sd.toFixed(3)).toBe('99.997')
  })

  it('HC-05.3 的答案等於 directionExact；p = 0.5039894 時 P(S₂ > 0) = 0.254005（25.4%）、P(S₃ > 0) = 0.505984（validation.md 的數值）', () => {
    const p = defaultValues(byId('HC-05.3')).p
    const [pos2, tie2, pos3] = solveDefault('HC-05.3').results.map((r) => r.value)
    expect(pos2).toBe(directionExact(p, 2).pos)
    expect(tie2).toBe(directionExact(p, 2).tie)
    expect(pos3).toBe(directionExact(p, 3).pos)
    // 手算提示寫的六位小數（p 取 7 位的 0.5039894），與 docs/validation.md 的 N = 2、N = 3 相同
    expect(p).toBe(0.5039894)
    expect(pos2.toFixed(6)).toBe('0.254005')
    expect(tie2.toFixed(6)).toBe('0.499968')
    expect(pos3.toFixed(6)).toBe('0.505984')
    // 步驟最後一個數字（8 位有效數字的手算）四捨五入到 6 位小數也是同一個答案
    const stepsTex = solveDefault('HC-05.3').steps.map((s) => s.tex)
    expect(stepsTex[1]).toContain('= 0.25400532')
    expect(stepsTex[stepsTex.length - 1]).toContain('= 0.50598398')
    // docs/validation.md：p = Φ(0.01) 不捨入時 N = 2 為 0.254005、N = 3 為 0.505984
    expect(directionExact(pPlus(1, 100), 2).pos).toBeCloseTo(0.254005, 6)
    expect(directionExact(pPlus(1, 100), 3).pos).toBeCloseTo(0.505984, 6)
    // F-05.13：N = 2 平分 tie 剛好等於 p
    expect(directionOutcomeExact(p, 2, 'half').correct).toBeCloseTo(p, 14)
  })

  it('T05: HC-05.4（N = 100）的 CLT 規格式等於 golden p_clt_list[0]，連續性修正與精確 strict（49.205%）相差 < 2e-4', () => {
    const g = golden('T05')
    const sol = solveDefault('HC-05.4')
    expect(sol.results).toHaveLength(2)
    const [half, strict] = sol.results.map((r) => r.value)
    expect(half).toBeCloseTo(num(g, 'p_clt_list', 0), 9)
    expect(half).toBe(directionCltPlain(meanQ(1, 100), 100))
    expect(strict).toBe(directionClt(meanQ(1, 100), 100).pos)
    expect(Math.abs(strict - num(g, 'p_exact_strict_list', 0))).toBeLessThan(2e-4)
    // 手算提示中寫的三個百分比
    expect((100 * half).toFixed(2)).toBe('53.18')
    expect((100 * strict).toFixed(2)).toBe('49.19')
    expect((100 * num(g, 'p_exact_strict_list', 0)).toFixed(3)).toBe('49.205')
    // 奇數 N = 101：只有一個答案，沒有連續性修正的步驟
    const odd = byId('HC-05.4').solve({ s: 1, sigma: 100, N: 101 })
    expect(odd.results).toHaveLength(1)
    expect(odd.results[0].value).toBe(directionCltPlain(meanQ(1, 100), 101))
    expect(odd.steps.length).toBe(sol.steps.length - 3)
  })

  it('HC-05.5（N = 100）的 tie 機率等於 directionExact（7.934%），|s*| 等於 tieRuleEquilibrium 的精確根', () => {
    const [tie, shift] = solveDefault('HC-05.5').results.map((r) => r.value)
    expect(tie).toBe(directionExact(pPlus(1, 100), 100).tie)
    expect(tie).toBeCloseTo(0.079336, 6) // docs/validation.md E02 的數值證據
    expect(shift).toBe(Math.abs(tieRuleEquilibrium(100, 100, 'plus')))
    expect(shift).toBeCloseTo(Math.abs(tieRuleEquilibrium(100, 100, 'strict')), 8)
    // 手算提示寫的 Stirling 7.953% 與 |s*| ≈ 1.25 fs
    expect((100 * tieProbStirling(meanQ(1, 100), 100)).toFixed(3)).toBe('7.953')
    expect(shift.toFixed(2)).toBe('1.25')
  })

  it('T05: HC-05.6（95%）的 z = 1.6449、N 等於 golden N_clt_95；補充說明列出精確最小奇數 N = 42,499', () => {
    const g = golden('T05')
    const sol = solveDefault('HC-05.6')
    const [z, n] = sol.results.map((r) => r.value)
    expect(z).toBe(normInv(0.95))
    expect(z.toFixed(4)).toBe('1.6449')
    expect(n / num(g, 'N_clt_95') - 1).toBeLessThan(1e-9)
    expect(n).toBe(samplesForConfidence(meanQ(1, 100), 0.95))
    expect(num(g, 'N_exact_odd_95')).toBe(42499)
    expect(minNForTarget(pPlus(1, 100), 0.95, 'odd')).toBe(42499)
    expect(sol.notes?.join('\n')).toContain('42{,}499')
    // 步驟最後的「取奇數」也剛好是 42,499
    expect(nextOdd(samplesSmallSignal(0.01, 0.95))).toBe(42499)
    expect(sol.steps[sol.steps.length - 1].tex).toContain('42{,}499')
  })

  it('T04: HC-05.7 的 K_q 與 K_q·s 等於 golden kq_per_fs、kq_times_s；高估量與局部斜率來自模型', () => {
    const g = golden('T04')
    const [K, lin, over, slope] = solveDefault('HC-05.7').results.map((r) => r.value)
    expect(K).toBeCloseTo(num(g, 'kq_per_fs'), 14)
    expect(lin).toBeCloseTo(num(g, 'kq_times_s'), 14)
    expect(over).toBe(linearizationRelError(0.01))
    expect(slope).toBe(kqLocal(1, 100) / kq(100))
    expect(K.toFixed(8)).toBe('0.00797885') // §5 的 T04 參考值
  })

  it('HC-05.9（h = 30 fs = 0.3σ_v）：K_q(h)、斜率比、ν、K_eff 與 N 的倍數等於模型與 golden comparator_hysteresis 的 h/σ = 0.3 那一列（1.2510、0.2358、0.9837、1.033）', () => {
    const g = golden('comparator_hysteresis')
    const [Kh, ratio, nu, keff, nRatio] = solveDefault('HC-05.9').results.map((r) => r.value)
    const s = nonidealSummary(100, 30, 0)
    expect(Kh).toBe(kqHysteresis(100, 30))
    expect(ratio).toBe(s.slopeRatio)
    expect(nu).toBe(nuHysteresis(100, 30))
    expect(keff).toBe(s.kqEffRatio)
    expect(nRatio).toBe(s.nRatio)
    // golden：h_over_sigma_list = [0, 0.1, 0.3, 0.5, 1, 2] 的第 3 個
    expect(ratio).toBeCloseTo(num(g, 'hyst_slope_closed_ratio_list', 2), 9) // 數值微分 vs 封閉式
    expect(nu).toBeCloseTo(num(g, 'hyst_nu_list', 2), 12)
    expect(keff).toBeCloseTo(num(g, 'hyst_kq_eff_ratio_list', 2), 9)
    expect(nRatio).toBeCloseTo(num(g, 'hyst_n_ratio_list', 2), 9)
    expect(ratio.toFixed(4)).toBe('1.2510')
    expect(nu.toFixed(4)).toBe('0.2358')
    expect(keff.toFixed(4)).toBe('0.9837')
    expect(nRatio.toFixed(3)).toBe('1.033')
    // h = 0：全部回到 1
    const zero = byId('HC-05.9').solve({ h: 0, sigma: 100 })
    expect(zero.results[1].value).toBeCloseTo(1, 12)
    expect(zero.results[2].value).toBeCloseTo(0, 15)
    expect(zero.results[0].value).toBeCloseTo(kq(100), 15)
  })

  it('HC-05.10（ε = 5 fs = 0.05σ_v、N = 4096）：P_meta = 0.03988、每 block 漏掉 163.3 個、斜率比 e^{−0.00125}，等於模型與 golden', () => {
    const g = golden('comparator_hysteresis')
    const [pm, dropped, ratio] = solveDefault('HC-05.10').results.map((r) => r.value)
    expect(pm).toBe(metaProb(0, 100, 5))
    expect(dropped).toBe(4096 * metaProb(0, 100, 5))
    expect(ratio).toBe(kqMetaDrop(100, 5) / kq(100))
    expect(pm).toBeCloseTo(num(g, 'meta_p_meta_at_zero_list', 2), 12) // eps_over_sigma_list 的第 3 個 = 0.05
    expect(dropped).toBeCloseTo(num(g, 'meta_dropped_per_block_N4096_eps5'), 9)
    expect(ratio).toBeCloseTo(num(g, 'meta_slope_closed_ratio_list', 2), 12)
    expect(pm.toFixed(5)).toBe('0.03988')
    expect(dropped.toFixed(1)).toBe('163.3')
    expect(ratio).toBeCloseTo(Math.exp(-0.00125), 12)
    // ε/σ_v > 0.3 走查表的步驟（多一步）
    const big = byId('HC-05.10').solve({ eps: 50, sigma: 100, N: 1024 })
    expect(big.steps.length).toBe(solveDefault('HC-05.10').steps.length + 1)
    expect(big.steps.some((st) => st.tex.startsWith('\\Phi(\\varepsilon/\\sigma_v)'))).toBe(true)
    expect(big.results[0].value).toBeCloseTo(2 * normCdf(0.5) - 1, 14)
  })

  it('T13: HC-05.8（σ_v = 100 fs、μ = 10 fs、N = 4096）的 pole 與 σ_w 等於 golden；與 Ch12 的 calLoop 一致', () => {
    const g = golden('T13')
    const [muMax, pole, tau, tauUs, sw] = solveDefault('HC-05.8').results.map((r) => r.value)
    expect(pole).toBeCloseTo(num(g, 'p'), 12)
    expect(sw).toBeCloseTo(num(g, 'sigma_w_fs'), 12)
    expect(muMax).toBeCloseTo(2 / num(g, 'K_per_fs'), 9)
    const ref = calLoop({ N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 })
    expect(pole).toBeCloseTo(ref.p, 14)
    expect(sw).toBeCloseTo(ref.sigmaW, 14)
    expect(tau).toBeCloseTo(ref.tauBlocks, 12)
    expect(tauUs).toBeCloseTo(ref.tauSeconds * 1e6, 10)
    // §9 表格的數字：穩定上限 250.66 fs、τ = 12.03 blocks；一個 block = 1.024 μs
    expect(muMax.toFixed(2)).toBe('250.66')
    expect(tau.toFixed(2)).toBe('12.03')
    expect(blockLoopLinear(10, 100, 4096, 4e9).blockSeconds).toBeCloseTo(1.024e-6, 18)
    // 補充說明裡的 sum-mode 反面例子：g × N = 326.8（golden g_sum_mode）
    expect(4096 * blockLoopLinear(10, 100, 4096).g).toBeCloseTo(num(g, 'g_sum_mode'), 9)
  })
})

/* ───────────── (b) 隨機題目：有限、等於獨立重算、照步驟手算會被判正確 ───────────── */

describe('Ch05 帶入手算：換一題（randomValues）', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：20 個 seed 的答案都有限，且等於測試內的獨立重算；TeX 可解析`, () => {
      const seen = new Set<string>()
      for (let seed = 1; seed <= 20; seed++) {
        const v = randomValues(def, seed)
        expect(randomValues(def, seed)).toEqual(v) // 同 seed 可重現
        seen.add(JSON.stringify(v))
        expect(def.validate?.(v) ?? null, `${def.id} seed ${seed}`).toBeNull()
        const sol = def.solve(v)
        expect(sol.steps.length).toBeGreaterThan(0)
        const want = independent[def.id](v)
        want.forEach((w, i) => {
          const got = sol.results[i].value
          expect(Number.isFinite(got), `${def.id} seed ${seed} #${i}`).toBe(true)
          expect(Math.abs(got - w), `${def.id} seed ${seed} #${i}: ${got} vs ${w} @ ${JSON.stringify(v)}`).toBeLessThanOrEqual(1e-9 + 1e-7 * Math.abs(w))
        })
        for (const r of sol.results) expect(Number.isFinite(r.value)).toBe(true)
        expectTexOk(def, sol, `seed ${seed}`)
      }
      // 「換一題」真的會換數字（單一輸入的題目至少出現 3 組）
      expect(seen.size).toBeGreaterThanOrEqual(3)
    })
  }

  it('HC-05.5 的 |s*|：代回去確實是「E[d] = 0」的根（逐項 Binomial 獨立驗證），sign(0) = +1 時在負的一側', () => {
    const def = byId('HC-05.5')
    for (let seed = 1; seed <= 20; seed++) {
      const v = randomValues(def, seed)
      const shift = def.solve(v).results[1].value
      // sign(0) = +1：d = +1 ⇔ K ≥ N/2；E[d] = 2P(K ≥ N/2) − 1 = 0 ⇔ P(K ≥ N/2) = ½，發生在 s = −|s*|
      const tail = binomTailDirect(v.N / 2, v.N, phiSimpson(-shift / v.sigma))
      expect(Math.abs(tail - 0.5), `seed ${seed} ${JSON.stringify(v)}`).toBeLessThan(1e-7)
      expect(tieRuleEquilibrium(v.N, v.sigma, 'plus')).toBeLessThan(0)
    }
  })

  for (const def of HANDCALCS) {
    it(`${def.id}：在預設值與所有手算友善的組合上，照步驟（5 位有效數字）算出的答案都會被判為正確`, () => {
      const cases = [defaultValues(def), ...practiceGrid(def)].filter((v) => (def.validate?.(v) ?? null) === null)
      expect(cases.length).toBeGreaterThanOrEqual(def.id === 'HC-05.3' ? 8 : 20)
      for (const v of cases) {
        const sol = def.solve(v)
        for (const hand of handAnswers[def.id](v)) {
          expect(hand).toHaveLength(sol.results.length)
          hand.forEach((h, i) => {
            const verdict = checkAnswer(h, sol.results[i])
            expect(verdict.ok, `${def.id} #${i} @ ${JSON.stringify(v)}：手算 ${h}、答案 ${sol.results[i].value}`).toBe(true)
          })
        }
      }
    })
  }

  it('容許誤差不會寬到把「沒算」當成對：p 填 0.5、Var(q) 填 1、判對率填 50% 都算錯', () => {
    const s1 = solveDefault('HC-05.1')
    expect(checkAnswer(0.5, s1.results[0]).ok).toBe(false)
    expect(checkAnswer(0.504, s1.results[0]).ok).toBe(true) // 四位小數的常態表
    expect(checkAnswer(1, s1.results[2]).ok).toBe(false)
    const s4 = solveDefault('HC-05.4')
    expect(checkAnswer(0.5, s4.results[0]).ok).toBe(false)
    expect(checkAnswer(0.5318, s4.results[1]).ok).toBe(false) // 把規格式的 53.18% 當成嚴格的 P(S_N > 0)（E02 的錯誤）
    const s3 = solveDefault('HC-05.3')
    expect(checkAnswer(0.504, s3.results[2]).ok).toBe(false) // N = 3 不等於 p
    const s8 = solveDefault('HC-05.8')
    expect(checkAnswer(0.93, s8.results[1]).ok).toBe(false)
    expect(checkAnswer(12.53, s8.results[2]).ok).toBe(false) // τ ≈ 1/g 的心算版差 4%，要用 ln
    // §5b：遲滯的斜率比填 1（忘了遲滯）、N 倍數填 1 都算錯；P_meta 填 0 算錯
    const sh = solveDefault('HC-05.9')
    expect(checkAnswer(1, sh.results[1]).ok).toBe(false)
    expect(checkAnswer(1, sh.results[4]).ok).toBe(false)
    expect(checkAnswer(0, solveDefault('HC-05.10').results[0]).ok).toBe(false)
  })
})

/* ───────────── (c) validate 擋掉模型不適用的輸入 ───────────── */

describe('Ch05 帶入手算：validate 說明為什麼不適用', () => {
  const invalid: [string, Record<string, number>, RegExp][] = [
    ['HC-05.1', { sigma: 0 }, /hard limiter/],
    ['HC-05.1', { s: 50 }, /一階泰勒/],
    ['HC-05.1', { s: 1, theta: 40 }, /一階泰勒/],
    ['HC-05.2', { sigma: 0 }, /hard limiter/],
    ['HC-05.2', { s: 40 }, /小訊號/],
    ['HC-05.3', { p: 1.2 }, /機率/],
    ['HC-05.3', { p: -0.1 }, /機率/],
    ['HC-05.4', { sigma: 0 }, /hard limiter/],
    ['HC-05.4', { s: 0 }, /沒有「正確方向」/],
    ['HC-05.4', { s: 30 }, /小訊號/],
    ['HC-05.4', { N: 9 }, /Berry–Esseen/],
    ['HC-05.5', { sigma: 0 }, /hard limiter/],
    ['HC-05.5', { N: 101 }, /奇數/],
    ['HC-05.5', { N: 4 }, /Stirling/],
    ['HC-05.5', { s: 20 }, /敏感/],
    ['HC-05.5', { N: 4096, s: 5, sigma: 50 }, /可以忽略/],
    ['HC-05.6', { sigma: 0 }, /hard limiter/],
    ['HC-05.6', { s: 0 }, /沒有方向/],
    ['HC-05.6', { P: 0.5 }, /擲硬幣/],
    ['HC-05.6', { P: 1 }, /無限多個樣本/],
    ['HC-05.6', { P: 0.9999999 }, /超出一般常態表/],
    ['HC-05.6', { s: 30 }, /高估/],
    ['HC-05.6', { s: 25, P: 0.6 }, /CLT/],
    ['HC-05.7', { sigma: 0 }, /hard limiter/],
    ['HC-05.7', { s: 250 }, /飽和/],
    ['HC-05.9', { sigma: 0 }, /hard limiter/],
    ['HC-05.9', { h: 300 }, /四位小數的常態表/],
    ['HC-05.9', { h: -1 }, /不能是負的/],
    ['HC-05.10', { sigma: 0 }, /hard limiter/],
    ['HC-05.10', { eps: 300 }, /壞掉的 latch/],
    ['HC-05.8', { sigma: 0 }, /hard limiter/],
    ['HC-05.8', { mu: 0 }, /不更新/],
    ['HC-05.8', { mu: 300 }, /發散/],
    ['HC-05.8', { mu: 250.67 }, /發散/],
    ['HC-05.8', { mu: 250.66 }, /離穩定邊界/],
    ['HC-05.8', { mu: 249 }, /離穩定邊界/],
    ['HC-05.8', { mu: 125.33 }, /deadbeat/],
    ['HC-05.8', { mu: 1e-7 }, /分不出來/],
    ['HC-05.8', { fs: 0 }, /f_s/],
  ]
  it.each(invalid)('%s 拒絕 %j', (id, patch, re) => {
    const def = byId(id)
    const msg = def.validate?.({ ...defaultValues(def), ...patch }) ?? null
    expect(msg, `${id} ${JSON.stringify(patch)}`).not.toBeNull()
    expect(msg).toMatch(re)
    // 訊息裡的公式都能渲染
    for (const t of mathSegments(msg!)) expect(renderTex(t, false), `${id}: ${t}`).not.toContain('katex-error')
  })

  it('界限的另一側是合法的：g 剛好低於 1.98、g 離 1 超過 0.2%、|r| 剛好等於上限、偶數 N = 10', () => {
    const muEdge = 248.15 // validate 訊息建議的上限：g = 248.15 × K_q = 1.97995
    expect(muEdge * kq(100)).toBeLessThan(HC05_LIMITS.gMax)
    expect(byId('HC-05.8').validate?.({ sigma: 100, mu: muEdge, N: 4096, fs: 4 })).toBeNull()
    expect(byId('HC-05.8').validate?.({ sigma: 100, mu: 250.66, N: 4096, fs: 4 })).toContain('248.15')
    expect(byId('HC-05.8').validate?.({ sigma: 100, mu: 125.0, N: 4096, fs: 4 })).toBeNull() // g = 0.9974
    expect(byId('HC-05.8').validate?.({ sigma: 100, mu: 125.6, N: 4096, fs: 4 })).toBeNull() // g = 1.0021（pole 為負）
    expect(byId('HC-05.8').validate?.({ sigma: 100, mu: 2e-6, N: 4096, fs: 4 })).toBeNull() // g = 1.6e-8
    expect(byId('HC-05.6').validate?.({ s: 1, sigma: 100, P: HC05_LIMITS.pTargetMax })).toBeNull()
    expect(byId('HC-05.1').validate?.({ s: 100 * HC05_LIMITS.rSmall, sigma: 100, theta: 0 })).toBeNull()
    expect(byId('HC-05.4').validate?.({ s: 100 * HC05_LIMITS.rClt, sigma: 100, N: HC05_LIMITS.nCltMin })).toBeNull()
    expect(byId('HC-05.5').validate?.({ N: HC05_LIMITS.nTieMin, s: 0, sigma: 100 })).toBeNull()
    expect(byId('HC-05.6').validate?.({ s: -25, sigma: 100, P: 0.95 })).toBeNull() // s < 0 以 |s| 計算
    expect(byId('HC-05.7').validate?.({ sigma: 100, s: -200 })).toBeNull()
  })

  it('負的 s：HC-05.6 的 N 與 +s 相同；HC-05.1 的 m 變號', () => {
    const d6 = byId('HC-05.6')
    expect(d6.solve({ s: -2, sigma: 100, P: 0.99 }).results[1].value).toBe(d6.solve({ s: 2, sigma: 100, P: 0.99 }).results[1].value)
    const d1 = byId('HC-05.1')
    expect(d1.solve({ s: -5, sigma: 100, theta: 0 }).results[1].value).toBeCloseTo(-d1.solve({ s: 5, sigma: 100, theta: 0 }).results[1].value, 14)
    // offset 蓋過誤差時，補充說明會指出 m 與 s 反號
    expect(d1.solve({ s: 1, sigma: 100, theta: 2 }).notes?.join('\n')).toContain('反號')
  })
})

/* ───────────── 手算近似本身的誤差界（提示中寫的數字） ───────────── */

describe('Ch05 帶入手算：提示中的近似與其適用範圍', () => {
  it('Φ(z) 的兩個手算近似：|z| ≤ 0.3 的一階泰勒誤差 < 0.002；Pólya 近似對所有 z 誤差 < 0.0032', () => {
    let worstLinear = 0
    let worstPolya = 0
    for (let i = -6000; i <= 6000; i++) {
      const z = i / 1000
      const h = phiHand(z)
      const err = Math.abs(h.value - normCdf(z))
      if (h.method === 'linear') worstLinear = Math.max(worstLinear, err)
      else worstPolya = Math.max(worstPolya, err)
      expect(h.method).toBe(Math.abs(z) <= 0.3 ? 'linear' : 'polya')
    }
    expect(worstLinear).toBeLessThan(0.002)
    expect(worstPolya).toBeLessThan(0.0032)
    expect(worstPolya).toBeGreaterThan(0.002) // 界限不是隨便寫的：最壞情況約 0.0031
    // |z| ≤ 0.1 時泰勒誤差 < 7e-5（HC-05.1 的提示）
    expect(Math.abs(phiHand(0.1).value - normCdf(0.1))).toBeLessThan(7e-5)
    // 測試自己的 Simpson Φ 與模擬核心一致（確認「獨立重算」可信）
    for (const z of [-3, -0.5, 0, 0.01, 0.3, 1, 1.645, 2.5, 6]) expect(phiSimpson(z)).toBeCloseTo(normCdf(z), 12)
  })

  it('Φ⁻¹(P) 的手算近似（Abramowitz–Stegun 26.2.22）：0.5 ≤ P ≤ 0.999999 的誤差 < 0.003；P ≥ 0.9 時換算成 N 的誤差 < 0.5%', () => {
    let worst = 0
    let worstN = 0
    for (let i = 0; i <= 49999; i++) {
      const P = 0.5 + i / 100000
      const h = zHand(P)
      expect(h.t).toBeCloseTo(Math.sqrt(-2 * Math.log(1 - P)), 12)
      const z = normInv(P)
      worst = Math.max(worst, Math.abs(h.value - z))
      if (P >= 0.9) worstN = Math.max(worstN, Math.abs((h.value / z) ** 2 - 1))
    }
    for (const P of [0.99999, 0.999999]) worst = Math.max(worst, Math.abs(zHand(P).value - normInv(P)))
    expect(worst).toBeLessThan(0.003)
    expect(worst).toBeGreaterThan(0.002) // 界限不是隨便寫的：最壞情況約 0.0028
    expect(worstN).toBeLessThan(0.005)
    // 與測試自己的 Simpson／二分法 Φ⁻¹ 也一致（不依賴模擬核心的 normInv）
    for (const P of [0.9, 0.95, 0.975, 0.99, 0.999]) expect(Math.abs(zHand(P).value - phiInvBisect(P))).toBeLessThan(0.003)
    // 預設題（95%）的說明文字示範的就是這個值：t = 2.4477、z ≈ 1.6445
    expect(zHand(0.95).t.toFixed(4)).toBe('2.4477')
    expect(zHand(0.95).value.toFixed(4)).toBe('1.6445')
    expect(solveDefault('HC-05.6').steps[0].why).toContain('1.6445')
  })

  it('HC-05.4：z > 3.5 時說明「超出常態表，直接寫 1」，不叫讀者去查查不到的表；TeX 可解析', () => {
    const def = byId('HC-05.4')
    const v = { s: 5, sigma: 50, N: 10000 }
    expect(def.validate?.(v) ?? null).toBeNull()
    const sol = def.solve(v)
    const lookups = sol.steps.filter((s) => s.tex.includes('\\Phi('))
    expect(lookups).toHaveLength(2) // Φ(z) 與 Φ(z_c)
    for (const s of lookups) expect(s.why).toContain('超出一般常態表')
    // 說明裡的界限 1 − Φ(3.5) ≈ 2.33e-4；這一題的答案確實在那個範圍內
    expect(1 - normCdf(3.5)).toBeLessThan(2.4e-4)
    for (const r of sol.results) expect(1 - r.value).toBeLessThan(1 - normCdf(3.5))
    expectTexOk(def, sol, 'z > 3.5')
    // 一般大小的 z（預設題）仍然教怎麼查表／怎麼近似
    for (const s of solveDefault('HC-05.4').steps.filter((s) => s.tex.includes('\\Phi('))) expect(s.why).toContain('查標準常態表')
  })

  it('tieProbStirling：相對誤差約 1/(4N)，N ≥ 10 時 < 3%；奇數 N 回傳 0', () => {
    for (const N of [10, 16, 50, 100, 400, 1000, 4096]) {
      const exact = directionExact(0.5, N).tie
      const rel = tieProbStirling(0, N) / exact - 1
      expect(rel, `N = ${N}`).toBeGreaterThan(0)
      expect(rel, `N = ${N}`).toBeLessThan(0.03)
      expect(rel / (1 / (4 * N)), `N = ${N}`).toBeCloseTo(1, 1)
    }
    expect(tieProbStirling(0.01, 101)).toBe(0)
    expect(tieProbStirling(0, 100)).toBeCloseTo(ROOT_2_OVER_PI / 10, 14) // 捷徑：0.79788/√N
  })

  it('tieRuleEquilibriumApprox：sign(0) = +1 為負、strict 為正、half / skip / 奇數 N 為 0；N ≥ 10 時與精確根相差 < 5%', () => {
    expect(tieRuleEquilibriumApprox(100, 100, 'plus')).toBeCloseTo(-1 / (100 * kq(100)), 14)
    expect(tieRuleEquilibriumApprox(100, 100, 'strict')).toBeCloseTo(1 / (100 * kq(100)), 14)
    expect(tieRuleEquilibriumApprox(100, 100, 'half')).toBe(0)
    expect(tieRuleEquilibriumApprox(100, 100, 'skip')).toBe(0)
    expect(tieRuleEquilibriumApprox(101, 100, 'plus')).toBe(0)
    expect(tieRuleEquilibriumApprox(100, 100, 'plus')).toBeCloseTo(-1.2533 , 4) // (σ_v/N)√(π/2)
    for (const N of [10, 16, 50, 100, 4096]) {
      const exact = tieRuleEquilibrium(N, 100, 'plus')
      expect(Math.abs(tieRuleEquilibriumApprox(N, 100, 'plus') / exact - 1), `N = ${N}`).toBeLessThan(0.05)
    }
  })

  it('blockLoopLinear：N = 1 等於逐 sample 的 signLoopLinearRms（F-05.15）；不穩定時 τ、σ_w 為 NaN', () => {
    for (const [mu, sigma] of [[0.5, 30], [0.5, 1], [10, 100], [150, 100]]) {
      expect(blockLoopLinear(mu, sigma, 1).sigmaW).toBeCloseTo(signLoopLinearRms(mu, sigma), 12)
    }
    const bad = blockLoopLinear(300, 100, 4096)
    expect(bad.g).toBeGreaterThan(2)
    expect(bad.tau).toBeNaN()
    expect(bad.sigmaW).toBeNaN()
    expect(blockLoopLinear(10, 100, 4096).tauSeconds).toBeNaN() // 沒給 f_s 就不換算時間
    // g > 1：pole 為負但仍穩定
    const alt = blockLoopLinear(200, 100, 10000)
    expect(alt.pole).toBeLessThan(0)
    expect(alt.tau).toBeGreaterThan(0)
    // 手算提示：0.92 與 0.93 的 τ 差約 15%
    expect((-1 / Math.log(0.93)) / (-1 / Math.log(0.92)) - 1).toBeCloseTo(0.15, 2)
  })

  it('各題的適用範圍內，小訊號手算與模型的差距不超過提示中寫的量', () => {
    // m ≈ √(2/π) r 的高估量 = linearizationRelError(r) ≤ 1.6%（|r| ≤ 0.3）、≤ 0.7%（|r| ≤ 0.2）
    expect(linearizationRelError(HC05_LIMITS.rSmall)).toBeLessThan(0.016)
    expect(linearizationRelError(HC05_LIMITS.rClt)).toBeLessThan(0.007)
    // r²/6 與精確高估量在 |r| ≤ 2 內相差 < 2%
    for (let r = 0.01; r <= HC05_LIMITS.rLinear + 1e-9; r += 0.01) expect(Math.abs((r * r) / 6 / linearizationRelError(r) - 1)).toBeLessThan(0.02)
    // 所需樣本數：|r| ≤ 0.25 時小訊號式高估 < 2%
    for (const r of [0.01, 0.1, 0.2, HC05_LIMITS.rSamples]) {
      const ratio = samplesSmallSignal(r, 0.95) / samplesForConfidence(meanQ(r, 1), 0.95)
      expect(ratio).toBeGreaterThan(0.999)
      expect(ratio).toBeLessThan(1.02)
    }
  })
})

/* ───────────── (d) 渲染 ───────────── */

describe('Ch05 帶入手算：<HandCalc> 渲染', () => {
  for (const def of HANDCALCS) {
    it(`${def.id}：預設值的每一步都渲染，沒有 KaTeX 錯誤；「自己算算看」的答案欄數與結果相同`, () => {
      const sol = def.solve(defaultValues(def))
      const { container, unmount } = render(<HandCalc def={def} />)
      expectNoTexErrors(container)
      expect(container.querySelectorAll('.c-step').length).toBe(sol.steps.length)
      expect(sol.steps.length).toBeGreaterThanOrEqual(1)
      expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(sol.results.length)
      expect(container.querySelectorAll('.c-handcalc-tips li').length).toBe(def.tips?.length)
      expect(container.querySelector(`#handcalc-${def.id.replace('.', '\\.')}`)).toBeTruthy()
      // 切到練習模式：步驟先藏起來，答案欄數 = 結果數
      fireEvent.click(screen.getByText('自己算算看'))
      expect(container.querySelectorAll('.c-step').length).toBe(0)
      const boxes = screen.getAllByPlaceholderText('你的答案')
      expect(boxes.length).toBe(sol.results.length)
      // 把模型答案填進去 → 全對
      boxes.forEach((b, i) => fireEvent.change(b, { target: { value: String(sol.results[i].value) } }))
      fireEvent.click(screen.getByText('對答案'))
      expect(container.querySelectorAll('.c-handcalc-verdict.ok').length).toBe(sol.results.length)
      // 換三題隨機數字並展開詳解：仍然沒有 KaTeX 錯誤
      for (let k = 0; k < 3; k++) {
        fireEvent.click(screen.getByText('換一題（隨機數字）'))
        fireEvent.click(screen.getByText('看詳解'))
        expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
        expectNoTexErrors(container)
      }
      unmount()
    })
  }

  it('輸入模型不適用的數字時顯示原因（含公式），不顯示步驟', () => {
    const { container } = render(<HandCalc def={byId('HC-05.8')} />)
    const mu = screen.getByLabelText(/學習率/) as HTMLInputElement
    fireEvent.change(mu, { target: { value: '300' } })
    expect(container.querySelectorAll('.c-step').length).toBe(0)
    expect(container.querySelector('.callout-warn')?.textContent).toContain('發散')
    expect(container.querySelector('.callout-warn .katex')).toBeTruthy()
    expectNoTexErrors(container)
    fireEvent.change(mu, { target: { value: '20' } })
    expect(container.querySelectorAll('.c-step').length).toBeGreaterThan(0)
  })

  it('HC-05.4：把 N 從 100 改成 101，連續性修正的三個步驟消失、答案剩一個', () => {
    const { container } = render(<HandCalc def={byId('HC-05.4')} />)
    const before = container.querySelectorAll('.c-step').length
    expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(2)
    fireEvent.change(screen.getByLabelText(/累加的樣本數/), { target: { value: '101' } })
    expect(container.querySelectorAll('.c-step').length).toBe(before - 3)
    expect(container.querySelectorAll('.c-handcalc-results .c-texblock').length).toBe(1)
    expectNoTexErrors(container)
  })
})

/* ───────────── (e) 「照畫面上的數字往下算」：把每一步的 TeX 重新求值 ───────────── */

/** 步驟 TeX 的小型求值器（只認本章步驟用到的寫法）；遇到符號（s、\sigma_v、\pi…）就丟出 SYM，表示這一段是符號式。 */
const SYM = new Error('symbolic')

/** 結尾單位 → 換算成 ns／fs 等基準單位的倍數（μs = 1000 ns；其餘 1）。沒有單位回傳 null。 */
function trailingUnit(seg: string): { body: string; scale: number | null } {
  const units: [RegExp, number][] = [
    [/\\ \\mathrm\{fs\}\^\{-1\}\s*$/, 1],
    [/\\ \\mathrm\{fs\}\s*$/, 1],
    [/\\ \\mathrm\{ns\}\s*$/, 1],
    [/\\ \\mu\\mathrm\{s\}\s*$/, 1000],
    [/\\ \\text\{blocks\}\s*$/, 1],
  ]
  for (const [re, scale] of units) if (re.test(seg)) return { body: seg.replace(re, ''), scale }
  return { body: seg, scale: null }
}

/** 以頂層（大括號深度 0）的 = 與 \approx 切開。 */
function splitTop(tex: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 0 && c === '=') {
      out.push(cur)
      cur = ''
    } else if (depth === 0 && tex.startsWith('\\approx', i)) {
      out.push(cur)
      cur = ''
      i += '\\approx'.length - 1
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function evalTex(src: string): number {
  const s = src.replace(/\\ \\mathrm\{GHz\}/g, '') // N ÷ f_s[GHz] = ns
  let i = 0
  const peek = (t: string) => s.startsWith(t, i)
  const eat = (t: string) => (peek(t) ? ((i += t.length), true) : false)
  const ws = () => {
    for (;;) {
      if (s[i] === ' ') i++
      else if (peek('\\,') || peek('\\;') || peek('\\!')) i += 2
      else if (peek('\\big')) i += 4
      else if (peek('\\left')) i += 5
      else if (peek('\\right')) i += 6
      else return
    }
  }
  const need = (t: string) => {
    ws()
    if (!eat(t)) throw SYM
  }
  const group = (): number => {
    ws()
    if (eat('{')) {
      const v = expr()
      need('}')
      return v
    }
    if (/\d/.test(s[i] ?? '')) return Number(s[i++]) // \tfrac12 的單一數字
    throw SYM
  }
  const atom = (): number => {
    ws()
    const m = /^\d+(?:\{,\}\d{3})*(?:\.\d+)?/.exec(s.slice(i))
    if (m) {
      i += m[0].length
      return Number(m[0].replace(/\{,\}/g, ''))
    }
    if (eat('(')) {
      const v = expr()
      need(')')
      return v
    }
    if (eat('{')) {
      const v = expr()
      need('}')
      return v
    }
    if (eat('\\frac') || eat('\\dfrac') || eat('\\tfrac')) {
      const a = group()
      return a / group()
    }
    if (eat('\\sqrt')) return Math.sqrt(group())
    if (eat('\\ln')) return Math.log(unary())
    if (eat('\\lceil')) {
      const v = expr()
      need('\\rceil')
      return Math.ceil(v)
    }
    if (eat('\\Phi^{-1}')) {
      need('(')
      const v = expr()
      need(')')
      return phiInvBisect(v)
    }
    if (eat('\\Phi')) {
      need('(')
      const v = expr()
      need(')')
      return phiSimpson(v)
    }
    if (peek('e^')) {
      i += 2
      return Math.exp(group())
    }
    throw SYM
  }
  const power = (): number => {
    const b = atom()
    ws()
    return eat('^') ? b ** group() : b
  }
  const unary = (): number => {
    ws()
    return eat('-') ? -unary() : power()
  }
  const term = (): number => {
    let v = unary()
    for (;;) {
      ws()
      if (eat('\\times')) v *= unary()
      else return v
    }
  }
  function expr(): number {
    let v = term()
    for (;;) {
      ws()
      if (eat('+')) v += term()
      else if (eat('-')) v -= term()
      else return v
    }
  }
  const v = expr()
  ws()
  if (i !== s.length) throw SYM
  return v
}

/** 片段若只是一個顯示出來的數字，回傳它的值與「最後一位的單位」（ulp）。 */
function shownNumber(body: string): { value: number; ulp: number } | null {
  const m = /^(-?)(\d+(?:\{,\}\d{3})*)(\.\d+)?(?:\\times10\^\{(-?\d+)\})?$/.exec(body.trim())
  if (m) {
    const e = m[4] ? Number(m[4]) : 0
    const dec = m[3] ? m[3].length - 1 : 0
    const mag = Number(`${m[2].replace(/\{,\}/g, '')}${m[3] ?? ''}e${e}`)
    return { value: m[1] ? -mag : mag, ulp: Number(`1e${e - dec}`) }
  }
  const pow = /^(-?)10\^\{(-?\d+)\}$/.exec(body.trim())
  if (pow) return { value: (pow[1] ? -1 : 1) * Number(`1e${pow[2]}`), ulp: Number(`1e${pow[2]}`) }
  return null
}

interface Equality {
  left: string
  right: string
  /** 左邊照畫面上的數字算出來的值（已換成右邊的單位） */
  computed: number
  /** 右邊（顯示的數字，或另一個數值算式的值） */
  shown: number
  /** 右邊是一個數字時：它最後一位的大小；右邊是算式時為 null */
  ulp: number | null
}

/** 一步 TeX 裡所有「數值 = 數值」的等號。 */
function equalities(tex: string): Equality[] {
  const out: Equality[] = []
  for (const part of tex.split('\\quad\\Rightarrow\\quad')) {
    const segs = splitTop(part).map((seg) => {
      const u = trailingUnit(seg)
      let value: number | null = null
      try {
        value = evalTex(u.body)
      } catch (e) {
        if (e !== SYM) throw e
      }
      return { seg, ...u, value }
    })
    for (let k = 0; k + 1 < segs.length; k++) {
      const a = segs[k]
      const b = segs[k + 1]
      if (a.value === null || b.value === null) continue
      const scaleB = b.scale ?? 1
      const computed = (a.value * (a.scale ?? scaleB)) / scaleB // 左邊沒寫單位時，單位與右邊相同
      const num = shownNumber(b.body)
      out.push({ left: a.seg, right: b.seg, computed, shown: num ? num.value : b.value, ulp: num ? num.ulp : null })
    }
  }
  return out
}

/** 一步最後顯示的數字（已含單位換算：μs 的值以 μs 表示）。 */
function lastShown(tex: string): number {
  const part = tex.split('\\quad\\Rightarrow\\quad').pop()!
  const segs = splitTop(part)
  const num = shownNumber(trailingUnit(segs[segs.length - 1]).body)
  if (!num) throw new Error(`最後一段不是數字：${tex}`)
  return num.value
}

/** 每一題：各個答案是哪一步算出來的（以該步 TeX 的開頭辨認）。 */
const ANSWER_STEPS: Record<string, string[]> = {
  'HC-05.1': ['p \\approx', 'm = 2p-1', '\\operatorname{Var}(q)'],
  'HC-05.2': ['E[S_N]', '\\mathrm{SD}(S_N)', '\\mathrm{SNR}_{\\mathrm{stat}}'],
  'HC-05.3': ['P(S_2>0)', 'P(S_2=0)', 'P(S_3>0)'],
  'HC-05.4': ['\\Phi(z)', 'P(S_N>0) \\approx'],
  'HC-05.5': ['P(S_N=0) \\approx', '|s^*|'],
  'HC-05.6': ['z =', 'N \\approx'],
  'HC-05.7': ['K_q =', 'K_q\\,s', '\\frac{r^2}{6}', '\\frac{dE[q]/ds}{K_q}'],
  'HC-05.9': ['K_q(h) =', '\\frac{K_q(h)}{K_q}', '\\nu =', '\\frac{K_{\\mathrm{eff}}}{K_q}', '\\frac{N(h)}{N(0)}'],
  'HC-05.10': ['P_{\\mathrm{meta}} =', 'N_{\\mathrm{meta}}', '\\frac{K_{q,\\mathrm{drop}}}{K_q}'],
  'HC-05.8': ['\\mu_{\\max}', 'p_{\\mathrm{cal}} =', '\\tau =', 't_\\tau', '\\sigma_w'],
}

/** 使用者會打的「不漂亮」數字：很多位小數、負號、很小的 r（中間值變成科學記號）、很大的 N、各題適用範圍的邊界。 */
const USER_INPUTS: Record<string, Record<string, number>[]> = {
  'HC-05.1': [
    { s: 1, sigma: 10000, theta: 0 },
    { s: 0.731, sigma: 123.4567, theta: -0.25 },
    { s: -3, sigma: 250, theta: 2 },
    { s: 30, sigma: 100, theta: 0 },
    { s: -30, sigma: 100, theta: 0 },
    { s: 0.001, sigma: 100, theta: 0 },
    { s: 2, sigma: 100, theta: 2 },
  ],
  'HC-05.2': [
    { s: 1, sigma: 10000, N: 4096 },
    { s: -2.5, sigma: 87.3, N: 12345 },
    { s: 0, sigma: 100, N: 100 },
    { s: 1, sigma: 100, N: 1e9 },
    { s: 30, sigma: 100, N: 1 },
    { s: -30, sigma: 100, N: 7 },
  ],
  'HC-05.3': [{ p: 0.503989 }, { p: 0 }, { p: 1 }, { p: 0.123456789 }, { p: 1 / 3 }, { p: 0.999 }, { p: 0.00001 }],
  'HC-05.4': [
    { s: 1, sigma: 100, N: 101 },
    { s: 0.37, sigma: 91.7, N: 4097 },
    { s: 5, sigma: 50, N: 10000 },
    { s: 1, sigma: 100, N: 1e6 },
    { s: 0.01, sigma: 100, N: 20 },
    { s: 20, sigma: 100, N: 20 },
    { s: 0.001, sigma: 100, N: 1000 },
  ],
  'HC-05.5': [
    { N: 10, s: 0, sigma: 100 },
    { N: 100000, s: 0.5, sigma: 100 },
    { N: 4096, s: 1.7, sigma: 133.3 },
    { N: 12, s: 10, sigma: 100 },
    { N: 100, s: 0.001, sigma: 100 },
  ],
  'HC-05.6': [
    { s: 0.5, sigma: 200, P: 0.999 },
    { s: -2, sigma: 100, P: 0.99 },
    { s: 0.731, sigma: 123.4567, P: 0.9 },
    { s: 25, sigma: 100, P: 0.999999 },
    { s: 10, sigma: 50, P: 0.9 },
    { s: 0.01, sigma: 1000, P: 0.95 },
    { s: 1, sigma: 100, P: 0.6 },
  ],
  'HC-05.7': [
    { sigma: 100, s: 0 },
    { sigma: 100, s: -200 },
    { sigma: 100, s: 200 },
    { sigma: 100000, s: 1 },
    { sigma: 123.4567, s: 0.731 },
    { sigma: 100, s: 0.005 },
  ],
  'HC-05.9': [
    { h: 0, sigma: 100 },
    { h: 0.001, sigma: 5000 },
    { h: 250, sigma: 100 },
    { h: 12.3456, sigma: 77.7 },
    { h: 100, sigma: 100 },
    { h: 1, sigma: 1 },
  ],
  'HC-05.10': [
    { eps: 0, sigma: 100, N: 4096 },
    { eps: 0.001, sigma: 5000, N: 1 },
    { eps: 200, sigma: 100, N: 16384 },
    { eps: 12.3456, sigma: 77.7, N: 12345 },
    { eps: 30, sigma: 100, N: 1e8 },
    { eps: 31, sigma: 100, N: 100 },
  ],
  'HC-05.8': [
    { sigma: 100, mu: 248.15, N: 16384, fs: 4 },
    { sigma: 100, mu: 0.0125, N: 1, fs: 3 },
    { sigma: 100, mu: 125.6, N: 4096, fs: 4 },
    { sigma: 100, mu: 125.0, N: 4096, fs: 4 },
    { sigma: 123.4567, mu: 7.31, N: 12345, fs: 2.5 },
    { sigma: 100, mu: 200, N: 10000, fs: 4 },
    { sigma: 100, mu: 0.5, N: 1e8, fs: 1000 },
    { sigma: 100, mu: 2e-6, N: 4096, fs: 4 },
  ],
}

/** 可重現的亂數（mulberry32）：壓力測試用，不依賴模擬核心。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 在整個「合法輸入」範圍內亂數取樣（log-uniform，數字抄成 4 位有效數字，像使用者自己打的）。 */
function randomUserInputs(def: HandCalcDef, count: number, seed: number): Record<string, number>[] {
  const u = mulberry32(seed)
  const sig4 = (x: number) => Number(x.toPrecision(4))
  const logU = (lo: number, hi: number) => sig4(Math.exp(Math.log(lo) + u() * (Math.log(hi) - Math.log(lo))))
  const draw: Record<string, () => number> = {
    s: () => (def.id === 'HC-05.5' && u() < 0.15 ? 0 : (def.inputs.find((i) => i.key === 's')!.min! < 0 && u() < 0.3 ? -1 : 1) * logU(0.01, 500)),
    sigma: () => logU(1, 5000),
    theta: () => (u() < 0.5 ? 0 : (u() < 0.5 ? -1 : 1) * logU(0.01, 50)),
    N: () => {
      const i = def.inputs.find((x) => x.key === 'N')!
      const n = Math.round(Math.exp(Math.log(i.min!) + u() * (Math.log(Math.min(i.max!, 1e7)) - Math.log(i.min!))))
      return def.id === 'HC-05.5' ? 2 * Math.max(1, Math.round(n / 2)) : n
    },
    p: () => Number(u().toFixed(Math.floor(1 + u() * 6))),
    P: () => Number((1 - Math.exp(Math.log(1e-6) + u() * (Math.log(0.45) - Math.log(1e-6)))).toPrecision(6)),
    mu: () => logU(1e-4, 5000),
    fs: () => logU(0.1, 100),
    h: () => (u() < 0.1 ? 0 : logU(0.01, 1000)),
    eps: () => (u() < 0.1 ? 0 : logU(0.01, 300)),
  }
  const out: Record<string, number>[] = []
  for (let guard = 0; out.length < count && guard < 200 * count; guard++) {
    const v = Object.fromEntries(def.inputs.map((i) => [i.key, draw[i.key]()]))
    if (def.inputs.every((i) => inputError(i, v[i.key]) === null) && (def.validate?.(v) ?? null) === null) out.push(v)
  }
  return out
}

/** 一份詳解的每個等號：照畫面上的數字算，四捨五入後就是下一個顯示的數字。回傳檢查了幾個等號。 */
function expectLiteral(def: HandCalcDef, v: Record<string, number>, sol: HandCalcSolution): number {
  let n = 0
  sol.steps.forEach((s, k) => {
    for (const q of equalities(s.tex)) {
      n++
      const where = `${def.id} 第 ${k + 1} 步 @ ${JSON.stringify(v)}：${q.left} = ${q.right}（照左邊算得 ${q.computed}）`
      if (q.ulp === null) {
        // 右邊還是算式（例如先把分子乘出來）：兩邊的值只差一次 5 位有效數字的四捨五入
        expect(Math.abs(q.computed - q.shown), where).toBeLessThanOrEqual(5e-5 * Math.abs(q.shown) + 1e-300)
      } else {
        expect(Math.abs(q.computed - q.shown) / q.ulp, where).toBeLessThanOrEqual(0.5 + 1e-6)
      }
    }
  })
  return n
}

/** 步驟算出來的手算答案（各題最後要填的量），依 results 的順序。 */
function stepAnswers(def: HandCalcDef, sol: HandCalcSolution): number[] {
  return ANSWER_STEPS[def.id].slice(0, sol.results.length).map((prefix) => {
    const step = sol.steps.find((s) => s.tex.startsWith(prefix))
    if (!step) throw new Error(`${def.id}：找不到以 ${prefix} 開頭的步驟`)
    return lastShown(step.tex)
  })
}

describe('Ch05 帶入手算：照畫面上的數字往下算（每一步的 TeX 重新求值）', () => {
  it('求值器本身：能算出本章步驟的各種寫法，也抓得到對不起來的算式', () => {
    expect(evalTex('\\frac{1}{100}')).toBe(0.01)
    expect(evalTex('10{,}000\\times0.999936339')).toBeCloseTo(9999.36339, 9)
    expect(evalTex('1-6.3661\\times10^{-5}')).toBeCloseTo(0.999936339, 12)
    expect(evalTex('(-0.031915)^2')).toBeCloseTo(0.001018567225, 15)
    expect(evalTex('(7.9788\\times10^{-5})^2')).toBeCloseTo(6.3661e-9, 13)
    expect(evalTex('\\tfrac12+(-0.015958)')).toBeCloseTo(0.484042, 12)
    expect(evalTex('e^{-0.125}')).toBeCloseTo(Math.exp(-0.125), 14)
    expect(evalTex('\\ln 0.920212')).toBeCloseTo(Math.log(0.920212), 14)
    expect(evalTex('\\lceil 42498.5\\rceil')).toBe(42499)
    expect(evalTex('\\Phi(0.07979)')).toBeCloseTo(normCdf(0.07979), 10)
    expect(() => evalTex('\\frac{s-\\theta}{\\sigma_v}')).toThrow()
    expect(() => evalTex('\\frac{2}{\\pi}')).toThrow() // π 是符號，不是「畫面上的數字」
    expect(shownNumber('6.3661\\times10^{-5}')).toEqual({ value: 6.3661e-5, ulp: 1e-9 })
    expect(shownNumber('42{,}499')).toEqual({ value: 42499, ulp: 1 })
    expect(shownNumber('-0.020213')).toEqual({ value: -0.020213, ulp: 1e-6 })
    // 單位：N ÷ f_s[GHz] = ns；μs 與 ns 差 1000 倍
    const blk = equalities('T_{\\mathrm{blk}} = \\frac{N}{f_s} = \\frac{4{,}096}{4\\ \\mathrm{GHz}} = 1024\\ \\mathrm{ns} = 1.024\\ \\mu\\mathrm{s}')
    expect(blk).toHaveLength(2)
    expect(blk[1].computed).toBeCloseTo(1.024, 12)
    // 反面：舊版出現過的三種對不起來的算式都會被抓到（差距 > 0.5 個最後一位）
    const off = (tex: string) => {
      const q = equalities(tex)[0]
      return Math.abs(q.computed - q.shown) / q.ulp!
    }
    expect(off('\\frac{z\\,\\sigma_v}{|s|} = 1.6449\\times100 = 164.485')).toBeGreaterThan(4)
    expect(off('N\\,m-1 = 1.0213-1 = 0.021292')).toBeGreaterThan(7)
    expect(off('1-p_{\\mathrm{cal}}^2 = 1-0.9605 = 0.039496')).toBeGreaterThan(3)
    expect(off('P(S_3>0) = p^3+3p^2(1-p) = 0.128016+0.377968 = 0.505983')).toBeCloseTo(1, 6)
  })

  it('手算常數就是模型常數抄到 5–6 位：φ(0) = 0.39894、√(2/π) = 0.79788、π = 3.14159、√(2π) = 2.50663、π/2 = 1.5708', () => {
    const sig = (x: number, n: number) => Number(x.toPrecision(n))
    expect(HC05_HAND_CONSTANTS.phi0).toBe(sig(normPdf(0), 5))
    expect(HC05_HAND_CONSTANTS.root2OverPi).toBe(sig(kq(1), 5))
    expect(HC05_HAND_CONSTANTS).toEqual({ pi: 3.14159, sqrt2Pi: 2.50663, phi0: 0.39894, twoOverPi: 0.63662, root2OverPi: 0.79788, halfPi: 1.5708 })
    // 畫面上推導常數的那幾步，照顯示的數字算也得到同一個常數（√(2π) 只抄 5 位的話會得到 0.39895）
    expect(sig(1 / HC05_HAND_CONSTANTS.sqrt2Pi, 5)).toBe(HC05_HAND_CONSTANTS.phi0)
    expect(sig(1 / 2.5066, 5)).toBe(0.39895)
    expect(sig(2 / HC05_HAND_CONSTANTS.pi, 5)).toBe(HC05_HAND_CONSTANTS.twoOverPi)
    expect(sig(Math.sqrt(HC05_HAND_CONSTANTS.twoOverPi), 5)).toBe(HC05_HAND_CONSTANTS.root2OverPi)
  })

  it('rd()：四捨五入到指定的有效位數，但整數部分不捨去；0 與非有限值原樣回傳', () => {
    expect(rd(0.007978845608)).toBe(0.0079788)
    expect(rd(164.48536, 6)).toBe(164.485)
    expect(rd(796288.4)).toBe(796288) // 不會變成 796290
    expect(rd(42498.4966, 7)).toBe(42498.5)
    expect(rd(-0.0202126)).toBe(-0.020213)
    expect(rd(0)).toBe(0)
    expect(rd(Infinity)).toBe(Infinity)
    expect(Number.isNaN(rd(NaN))).toBe(true)
  })

  for (const def of HANDCALCS) {
    it(`${def.id}：預設值、所有手算友善的組合、20 個 seed、使用者自己打的數字與 300 組亂數——每個等號都對得起來，沒有 KaTeX 錯誤，步驟算出的答案都被判為正確`, () => {
      const cases = [
        defaultValues(def),
        ...practiceGrid(def).filter((v) => (def.validate?.(v) ?? null) === null),
        ...Array.from({ length: 20 }, (_, k) => randomValues(def, k + 1)),
        ...USER_INPUTS[def.id],
        ...randomUserInputs(def, 300, 20261010),
      ]
      expect(cases.length).toBeGreaterThan(300)
      let checked = 0
      let stepCount = 0
      for (const v of cases) {
        for (const i of def.inputs) expect(inputError(i, v[i.key]), `${def.id}.${i.key} @ ${JSON.stringify(v)}`).toBeNull()
        expect(def.validate?.(v) ?? null, `${def.id} @ ${JSON.stringify(v)}`).toBeNull()
        const sol = def.solve(v)
        checked += expectLiteral(def, v, sol)
        stepCount += sol.steps.length
        // 步驟最後的數字（讀者照著算會得到的答案）在容許誤差內
        const hand = stepAnswers(def, sol)
        hand.forEach((h, k) => {
          const verdict = checkAnswer(h, sol.results[k])
          expect(verdict.ok, `${def.id} #${k} @ ${JSON.stringify(v)}：步驟算出 ${h}、答案 ${sol.results[k].value}`).toBe(true)
        })
        for (const s of sol.steps) expect(s.tex, `${def.id} @ ${JSON.stringify(v)}`).not.toMatch(/NaN|\\infty|\d(\.\d+)?e[-+]?\d/)
      }
      // 每一步至少有一個可以重算的等號（符號式 = 代入數字 = 結果）
      const sol0 = def.solve(defaultValues(def))
      for (const s of sol0.steps) expect(equalities(s.tex).length, `${def.id}: ${s.tex}`).toBeGreaterThanOrEqual(1)
      expect(checked).toBeGreaterThanOrEqual(stepCount)
      // 使用者打的數字（含科學記號的中間值、負數）全部能渲染
      for (const v of USER_INPUTS[def.id]) expectTexOk(def, def.solve(v), JSON.stringify(v))
    })
  }

  it('科學記號或負數當底數時加括號：s/σ_v = 10⁻⁴ 的 m² 不再是 KaTeX 的 double superscript', () => {
    const sol = byId('HC-05.1').solve({ s: 1, sigma: 10000, theta: 0 })
    const sq = sol.steps.find((s) => s.tex.startsWith('m^2'))!
    expect(sq.tex).toContain('(7.9788\\times10^{-5})^2')
    expect(renderTex(sq.tex, true)).not.toContain('katex-error')
    expect(renderTex('m^2 = 7.9788\\times10^{-5}^2', true)).toContain('katex-error') // 舊寫法
    const neg = byId('HC-05.1').solve({ s: -2, sigma: 50, theta: 0 })
    expect(neg.steps.find((s) => s.tex.startsWith('m^2'))!.tex).toContain('(-0.031916)^2')
    expect(neg.steps.find((s) => s.tex.startsWith('p \\approx'))!.tex).toContain('\\tfrac12+(-0.015958) = 0.484042')
  })

  it('使用者輸入的數字完整顯示（不四捨五入成 5 位）', () => {
    const sol = byId('HC-05.1').solve({ s: 0.731, sigma: 123.4567, theta: -0.25 })
    expect(sol.steps[0].tex).toContain('0.731-(-0.25) = 0.981')
    expect(sol.steps[1].tex).toContain('\\frac{0.981}{123.4567}')
    const s8 = byId('HC-05.8').solve({ sigma: 123.4567, mu: 7.31, N: 12345, fs: 2.5 })
    expect(s8.steps[0].tex).toContain('\\frac{0.79788}{123.4567}')
    expect(s8.steps.find((s) => s.tex.startsWith('T_{\\mathrm{blk}}'))!.tex).toContain('\\frac{12{,}345}{2.5\\ \\mathrm{GHz}} = 4938\\ \\mathrm{ns} = 4.938\\ \\mu\\mathrm{s}')
  })

  it('HC-05.8：p_cal 接近 ±1 時 p_cal² 多抄幾位，1 − p_cal² 仍有 5 位有效數字（1 − 0.9605 = 0.0395 的問題）', () => {
    const sol = byId('HC-05.8').solve({ sigma: 200, mu: 5, N: 4096, fs: 2 })
    const sq = sol.steps.find((s) => s.tex.startsWith('p_{\\mathrm{cal}}^2'))!
    const om = sol.steps.find((s) => s.tex.startsWith('1-p_{\\mathrm{cal}}^2'))!
    expect(sq.tex).toContain('0.980053^2 = 0.9605039')
    expect(sq.why).toContain('多抄幾位')
    expect(om.tex).toContain('1-0.9605039 = 0.0394961')
    // 這一步在手機（正文欄約 270px）放不下一行：左邊的式子與等號後面的數字之間先換行，捲軸才不會為了幾個 px 出現
    expect(om.tex).toContain('1-p_{\\mathrm{cal}}^2 \\\\ = 1-0.9605039')
    // 預設題不需要多抄：說明文字也不出現那句話
    expect(solveDefault('HC-05.8').steps.find((s) => s.tex.startsWith('p_{\\mathrm{cal}}^2'))!.why).not.toContain('多抄幾位')
  })

  it('HC-05.6：z 多抄一位再平方，預設題的步驟是 1.64485 × 100 = 164.485 → 27055.32 → 42498.5 → 42,499；偶數時寫出 +1', () => {
    const tex = solveDefault('HC-05.6').steps.map((s) => s.tex)
    expect(tex[0]).toContain('= 1.64485')
    expect(tex[2]).toContain('1.64485\\times100 = 164.485')
    expect(tex[3]).toContain('164.485^2 = 27055.32')
    expect(tex[4]).toContain('27055.32\\times1.5708 = 42498.5')
    expect(tex[5]).toContain('\\lceil 42498.5\\rceil = 42{,}499\\quad\\Rightarrow\\quad N_{\\text{odd}} = 42{,}499')
    // 手算友善的組合裡，⌈N⌉ 是偶數的題目都把「+1」寫出來；奇數的不寫
    let evens = 0
    for (const v of practiceGrid(byId('HC-05.6')).filter((x) => byId('HC-05.6').validate?.(x) === null)) {
      const steps = byId('HC-05.6').solve(v).steps
      const last = steps[steps.length - 1].tex
      const ceil = Number(/\\rceil = ([\d{},]+)\\quad/.exec(last)![1].replace(/\{,\}/g, ''))
      if (ceil % 2 === 0) {
        evens++
        expect(last, JSON.stringify(v)).toContain(`+1 = ${(ceil + 1).toLocaleString('en-US').replace(/,/g, '{,}')}`)
      } else expect(last, JSON.stringify(v)).not.toContain('+1')
    }
    expect(evens).toBeGreaterThan(3)
    // s = 0.5 fs、σ_v = 50 fs、99%：步驟得到 85,011，與精確的最小奇數 N（規格修正表的 85,011）相同
    const n99 = byId('HC-05.6').solve({ s: 0.5, sigma: 50, P: 0.99 }).steps
    expect(n99[n99.length - 1].tex).toContain('N_{\\text{odd}} = 85{,}011')
    expect(minNForTarget(pPlus(0.5, 50), 0.99, 'odd')).toBe(85011)
  })

  it('換一題不會抽到「整題都是 0」的退化題：HC-05.1 的 θ 練習值不與 s 相同', () => {
    const def = byId('HC-05.1')
    const valid = practiceGrid(def).filter((v) => def.validate?.(v) === null)
    expect(valid.length).toBeGreaterThan(30)
    for (const v of valid) {
      expect(v.s, JSON.stringify(v)).not.toBe(v.theta)
      expect(def.solve(v).results[1].value, JSON.stringify(v)).not.toBe(0)
    }
    // 但使用者自己輸入 s = θ 仍然可以算，並解釋為什麼只能擲硬幣
    const flat = def.solve({ s: 2, sigma: 100, theta: 2 })
    expect(flat.results.map((r) => r.value)).toEqual([0.5, 0, 1])
    expect(flat.notes?.join('\n')).toContain('擲硬幣')
  })

  it('答案的白話名稱不含 $：共用 HandCalc 會把它原樣放進 aria-label', () => {
    for (const def of HANDCALCS) {
      for (const i of def.inputs) expect(i.label, `${def.id}.${i.key}`).not.toContain('$')
      for (const v of [defaultValues(def), ...USER_INPUTS[def.id]]) for (const r of def.solve(v).results) expect(r.label ?? '', def.id).not.toContain('$')
    }
  })
})
