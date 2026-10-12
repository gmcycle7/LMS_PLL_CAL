import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import katex from 'katex'
import { pageById } from '@/app/registry'
import { cAbs, cArg, createRng, erf, polyRoots } from '@/simulation/core'
import { LIN_RATIO_LIMIT, nearIntegerSweep } from '@/simulation/models/bias'
import { conventionalStep } from '@/simulation/models/lms'
import {
  blockSignGmacStep,
  calNoise,
  comparatorKq,
  criticalGain,
  criticalOmega,
  delayCharPoly,
  delayedTrajectory,
  efCycle,
  efQuantize,
  eigenExample,
  fxToneCorrelation,
  nlmsStep,
  pmWithDelayDeg,
  poleFromEnbw,
  poleFromF3db,
  stepsToDecay,
  toneCorrelation,
  weakExcitation,
  widrowStep,
} from './bridge'
import { FORMULAS, formulaById } from './formulas'

const validation = readFileSync(join(process.cwd(), 'docs', 'validation.md'), 'utf8')

/** golden/vectors/<name>.json 的 expected（Python 獨立實作的參考值） */
function golden(name: string): Record<string, number> {
  return (JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', `${name}.json`), 'utf8')) as { expected: Record<string, number> }).expected
}

describe('公式登錄 F-PR.n（Papers / Reading 頁）', () => {
  it('ID 唯一、格式 F-PR.n 連號、頁面為 /papers、勘誤編號存在、TeX 可被 KaTeX 解析', () => {
    expect(FORMULAS.map((f) => f.id)).toEqual(FORMULAS.map((_, i) => `F-PR.${i + 1}`))
    expect(new Set(FORMULAS.map((f) => f.id)).size).toBe(FORMULAS.length)
    expect(pageById('papers')?.path).toBe('/papers')
    for (const f of FORMULAS) {
      expect(f.page).toBe('/papers')
      expect(f.specSection.startsWith('D')).toBe(true)
      expect(f.title.length).toBeGreaterThan(4)
      expect(f.conditions.length).toBeGreaterThan(8)
      expect(['exact', 'approx', 'research']).toContain(f.claim)
      if (f.erratumId) expect(validation, f.id).toContain(`| ${f.erratumId} |`)
      expect(() => katex.renderToString(f.tex, { throwOnError: true, displayMode: true }), f.id).not.toThrow()
    }
    expect(formulaById('F-PR.4').title).toContain('臨界增益')
    expect(() => formulaById('F-PR.99')).toThrow()
  })

  it('名稱與使用條件裡的數學一律寫成 $…$（Formula & Unit Reference 頁以 mathText 顯示）：$ 成對、可被 KaTeX 解析、$…$ 之外沒有 Unicode 拼出的公式', () => {
    let withMath = 0
    for (const f of FORMULAS) {
      for (const t of [f.title, f.conditions]) {
        expect((t.match(/\$/g) ?? []).length % 2, `${f.id}: ${t}`).toBe(0)
        const outside = t.replace(/\$[^$]+\$/g, '')
        expect(outside, `${f.id}: ${t}`).not.toMatch(/\\/)
        expect(outside, `${f.id}: ${t}`).not.toMatch(/[α-ωΑ-Ω²³⁻¹₀-₉√≈≤≥≪∞‖∫⇒⇔∝½−·]/)
        // 不以 ASCII 拼公式：$…$ 之外不出現等號、底線下標或 ^ 上標
        expect(outside, `${f.id}: ${t}`).not.toMatch(/[=_^]/)
        for (const m of t.matchAll(/\$([^$]+)\$/g)) {
          withMath++
          expect(() => katex.renderToString(m[1], { throwOnError: true }), `${f.id}: ${m[1]}`).not.toThrow()
        }
      }
      // 單位說明是純文字（Formula Reference 頁不經 mathText）：不放 $ 與反斜線
      for (const [k, u] of Object.entries(f.units ?? {})) {
        expect(u, `${f.id}.${k}`).not.toMatch(/[$\\]/)
        expect(u, `${f.id}.${k}`).not.toMatch(/[α-ωΑ-Ω²³√≈≤≥≪∞‖∫]/)
      }
    }
    expect(withMath).toBeGreaterThan(30)
    // 關鍵條件仍在（改寫成 LaTeX 後內容不變）
    expect(formulaById('F-PR.3').conditions).toContain(String.raw`$|\delta|\ll\sigma_v$`)
    // 技術審查 R06c：小訊號條件看的是 comparator 前的整個確定性殘差 δ·u[n]；|δ| ≪ σ_v 只是 identity path、±1 code（|u| = 1）的特例
    expect(formulaById('F-PR.3').conditions).toContain(String.raw`comparator 前的確定性殘差 $\delta\,u[n]$`)
    expect(formulaById('F-PR.3').conditions).toContain(String.raw`$|u|=1$、$C=1$`)
    expect(formulaById('F-PR.3').conditions).toContain(String.raw`$\delta=a-w$`)
    expect(formulaById('F-PR.4').conditions).toContain(String.raw`$0<g\le2$`)
    expect(formulaById('F-PR.9').conditions).toContain(String.raw`$p>3-2\sqrt2$`)
    expect(formulaById('F-PR.5').conditions).toContain(String.raw`$0<\Omega<\pi$`)
    expect(formulaById('F-PR.13').conditions).toContain('RPDF')
  })
})

/**
 * 每一條登錄的公式都用「不同於公式本身」的方法驗算一次：
 * 直接執行更新式、列舉、時域平均、數值積分、矩陣迭代或固定 seed 的 Monte Carlo。
 */
describe('F-PR.n 的獨立數值驗算', () => {
  it('F-PR.1：Widrow 型用 μ/2 與本站用 μ 逐步完全相同；Widrow 的界限是本站的一半', () => {
    let wh = 0.2
    let ww = 0.2
    const rng = createRng(11)
    for (let n = 0; n < 50; n++) {
      const x = rng.normal()
      const y = 1.7 * x + 0.1 * rng.normal()
      wh = conventionalStep({ w: wh, x, y, mu: 0.3 }).w
      ww = widrowStep({ w: ww, x, y, mu: 0.15 }).w
      expect(ww).toBe(wh)
    }
    // 固定 x = 2（λ = 4）：本站界限 2/λ = 0.5、Widrow 界限 1/λ = 0.25；界限上 pole = −1（等幅震盪）
    const atBound = widrowStep({ w: 0, x: 2, y: 6, mu: 0.25 })
    expect(3 - atBound.w).toBeCloseTo(-3, 12) // δ_1 = −δ_0
  })

  it('F-PR.2：±1 的兩個 tap（‖x‖² ≡ tr R = 2）時 NLMS 的 mean recursion 恰為 I − μ̃/(ε_reg + tr R)·R（列舉 4 種 x）', () => {
    const muT = 0.8
    const eps = 0.5
    // E[x xᵀ/(ε + ‖x‖²)]：四種等機率的 (±1, ±1)
    const M = [
      [0, 0],
      [0, 0],
    ]
    for (const x of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const n2 = x[0] * x[0] + x[1] * x[1]
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) M[i][j] += (x[i] * x[j]) / (eps + n2) / 4
    }
    const s = muT / (eps + 2) // F-PR.2，R = I ⇒ λ = 1
    expect(muT * M[0][0]).toBeCloseTo(s, 15)
    expect(muT * M[1][1]).toBeCloseTo(s, 15)
    expect(M[0][1]).toBeCloseTo(0, 15)
    // a posteriori：e_post = (1 − μ̃x²/(ε + x²))·e（純量，精確）
    const st = nlmsStep({ w: 0.4, x: 1.5, y: 3, mu: muT, epsReg: eps })
    expect(3 - st.w * 1.5).toBeCloseTo((1 - (muT * 2.25) / (eps + 2.25)) * st.e, 14)
  })

  it('F-PR.3：block sign-GMAC 的 E[G] = erf(δ/(√2σ_v)) ≈ K_q·δ（固定 seed 的 Monte Carlo，±4 SE）', () => {
    const sigmaV = 100
    const delta = 20 // fs；|δ|/σ_v = 0.2，線性化誤差約 (δ/σ_v)²/6 = 0.7%
    const N = 200_000
    const rng = createRng(20261010)
    const xs = new Float64Array(N)
    const vs = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      xs[n] = rng.sign()
      vs[n] = sigmaV * rng.normal()
    }
    const { G } = blockSignGmacStep({ w: 0, a: delta, xs, vs, mu: 10 })
    const exact = erf(delta / (Math.SQRT2 * sigmaV))
    const se = Math.sqrt((1 - exact * exact) / N)
    expect(Math.abs(G - exact)).toBeLessThan(4 * se)
    const lin = comparatorKq(sigmaV) * delta
    expect(Math.abs(lin / exact - 1)).toBeLessThan(0.01)
    expect(lin / exact - 1).toBeCloseTo(delta ** 2 / sigmaV ** 2 / 6, 3)
  })

  it('F-PR.4：g = g*(d) 時特徵多項式有一對根恰在單位圓上、角度 ±π/(2d+1)；PM = 0', () => {
    for (let d = 0; d <= 6; d++) {
      const roots = polyRoots(delayCharPoly(criticalGain(d), d))
      const onCircle = roots.filter((z) => Math.abs(cAbs(z) - 1) < 1e-7)
      expect(onCircle.length).toBe(d === 0 ? 1 : 2)
      expect(Math.abs(Math.abs(cArg(onCircle[0])) - criticalOmega(d))).toBeLessThan(1e-7)
      expect(roots.every((z) => cAbs(z) < 1 + 1e-7)).toBe(true)
      expect(pmWithDelayDeg(criticalGain(d), d)).toBeCloseTo(0, 9)
    }
    // 時域：g 略小於 g*(3) 收斂、略大於發散
    const g3 = criticalGain(3)
    expect(Math.abs(delayedTrajectory(0.97 * g3, 3, 3000)[3000])).toBeLessThan(1e-3)
    const div = delayedTrajectory(1.03 * g3, 3, 3000)
    let peak = 0
    for (let k = 2900; k <= 3000; k++) peak = Math.max(peak, Math.abs(div[k]))
    expect(peak).toBeGreaterThan(1e3)
  })

  it('F-PR.5 / F-PR.6：FIR 路徑 + 有色 code：Σh[k]R_x[k]、PSD 積分、時域 Monte Carlo 三者一致', () => {
    const h = [0.5, 0.3, -0.2, 0.1]
    // x[n] = (ω[n] + ω[n−1])/√2，ω 為 ±1 白色：R_x[0] = 1、R_x[±1] = 1/2、S_xx = 1 + cos Ω
    const viaAutocorr = h[0] * 1 + h[1] * 0.5
    const K = 4096
    let viaPsd = 0
    for (let i = 0; i < K; i++) {
      const Om = -Math.PI + (2 * Math.PI * (i + 0.5)) / K
      let reH = 0
      for (let k = 0; k < h.length; k++) reH += h[k] * Math.cos(k * Om) // Re{Σ h[k] e^{−jkΩ}}
      viaPsd += ((1 + Math.cos(Om)) * reH) / K // (1/2π)∫ … dΩ 的中點法
    }
    expect(viaPsd).toBeCloseTo(viaAutocorr, 12)
    const rng = createRng(606)
    const N = 400_000
    const om = new Float64Array(N + 1)
    for (let n = 0; n <= N; n++) om[n] = rng.sign()
    const x = new Float64Array(N)
    for (let n = 0; n < N; n++) x[n] = (om[n + 1] + om[n]) / Math.SQRT2
    let acc = 0
    for (let n = h.length; n < N; n++) {
      let u = 0
      for (let k = 0; k < h.length; k++) u += h[k] * x[n - k]
      acc += x[n] * u
    }
    expect(Math.abs(acc / (N - h.length) - viaAutocorr)).toBeLessThan(0.01)
    // 單頻特例（F-PR.5）：同一個 FIR 在 Ω = π/6 的 |H|cos φ = Re{H}
    const Om = Math.PI / 6
    let re = 0
    let im = 0
    for (let k = 0; k < h.length; k++) {
      re += h[k] * Math.cos(k * Om)
      im -= h[k] * Math.sin(k * Om)
    }
    let t = 0
    const P = 12 * 40
    const xt = (n: number) => Math.cos(Om * n)
    for (let n = h.length; n < h.length + P; n++) {
      let u = 0
      for (let k = 0; k < h.length; k++) u += h[k] * xt(n - k)
      t += xt(n) * u
    }
    expect(t / P).toBeCloseTo(toneCorrelation(1, Math.hypot(re, im), Math.atan2(im, re)), 12)
    expect(t / P).toBeCloseTo(re / 2, 12)
  })

  it('F-PR.7：兩個同頻餘弦的時域平均 = (A²/2)|H||Ĥ|cos(φ − φ̂)', () => {
    const A = 1.3
    const Om = (2 * Math.PI * 3) / 32
    const cases: [number, number, number, number][] = [
      [0.8, 0.4, 1.1, -0.3],
      [0.5, 2.0, 0.7, 0.2],
      [1.0, 0.1, 1.0, 0.1 - Math.PI / 2],
    ]
    for (const [mH, pH, mHat, pHat] of cases) {
      let acc = 0
      const P = 32 * 10
      for (let n = 0; n < P; n++) acc += A * mH * Math.cos(Om * n + pH) * A * mHat * Math.cos(Om * n + pHat)
      expect(acc / P).toBeCloseTo(fxToneCorrelation(A, mH, pH, mHat, pHat), 12)
    }
    expect(fxToneCorrelation(A, 1, 0.1, 1, 0.1 - Math.PI / 2)).toBeCloseTo(0, 12) // 剛好 90°：沒有恢復力
  })

  it('T13: F-PR.8：AR(1) 遞迴 δw_{k+1} = p·δw_k + μη_k 的樣本變異數落在 σ_w² 的 ±4 SE 內', () => {
    const n = calNoise({ sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9 })
    const rng = createRng(1313)
    const K = 400_000
    const sEta = Math.sqrt(n.sigmaEta2)
    let dw = 0
    let s2 = 0
    for (let k = 0; k < 2000; k++) dw = n.p * dw + 10 * sEta * rng.normal() // burn-in
    for (let k = 0; k < K; k++) {
      dw = n.p * dw + 10 * sEta * rng.normal()
      s2 += dw * dw
    }
    // AR(1) 的平方序列相關係數 p²：有效樣本數 ≈ K(1 − p²)/(1 + p²)；Gaussian 時 Var(x²) = 2σ⁴
    const nEff = (K * (1 - n.p ** 2)) / (1 + n.p ** 2)
    const se = n.sigmaW2 * Math.sqrt(2 / nEff)
    expect(Math.abs(s2 / K - n.sigmaW2)).toBeLessThan(4 * se)
    // Monte Carlo 也落在 golden（Python）參考值的 ±4 SE 內
    expect(Math.abs(s2 / K - golden('T13').sigma_w2_fs2)).toBeLessThan(4 * se)
    expect(n.sigmaW).toBeCloseTo(golden('T13').sigma_w_fs, 10)
  })

  it('T14: F-PR.9：直接對 |μ/(e^{jΩ} − p)|² 數值積分得到 ENBW；二分法找 −3 dB 點', () => {
    const n = calNoise({ sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9 })
    const mag2 = (Om: number) => 100 / (1 + n.p * n.p - 2 * n.p * Math.cos(Om))
    // one-sided ENBW = ∫_0^{f_u/2} |H(f)|² df / |H(0)|²
    const K = 200_000
    let integ = 0
    for (let i = 0; i < K; i++) integ += mag2((Math.PI * (i + 0.5)) / K) / K
    const enbw = ((n.fu / 2) * integ) / mag2(0)
    expect(enbw / n.enbw).toBeCloseTo(1, 8)
    expect(enbw / golden('T14').enbw_one_sided_hz).toBeCloseTo(1, 8)
    let lo = 0
    let hi = Math.PI
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (lo + hi)
      if (mag2(mid) > mag2(0) / 2) lo = mid
      else hi = mid
    }
    expect(((lo / (2 * Math.PI)) * n.fu) / n.f3dbExact).toBeCloseTo(1, 10)
    expect(((lo / (2 * Math.PI)) * n.fu) / golden('T14').bw_exact_3db_hz).toBeCloseTo(1, 9)
    expect(n.enbw / n.f3dbExact).toBeGreaterThan(1.5) // 兩者差約 π/2 倍：不可混用（勘誤 E06/E10）
    expect(n.enbw / n.f3dbExact).toBeLessThan(1.6)
  })

  it('F-PR.10：bias·C = B；σ_w²·C 在 g ≪ 1 時趨於常數 μσ_η²/(2K_q)；τ·C 趨於 1/(μK_q)', () => {
    const base = { B: 0.05, mu: 10, sigmaV: 100, N: 4096 }
    const Kq = comparatorKq(100)
    for (const C of [0.3, 0.1, 0.03, 0.01]) {
      const w = weakExcitation({ ...base, C })
      expect(w.bias * C).toBeCloseTo(0.05, 14)
      expect((w.sigmaW ** 2 * C) / ((10 * (1 / 4096)) / (2 * Kq))).toBeCloseTo(1, 1)
      expect(w.tau * C * 10 * Kq).toBeCloseTo(1, 1)
    }
    const tight = weakExcitation({ ...base, C: 0.001 })
    expect((tight.sigmaW ** 2 * 0.001) / ((10 * (1 / 4096)) / (2 * Kq))).toBeCloseTo(1, 3)
  })

  it('T11: F-PR.11：直接迭代 2×2 的 (I − gR)，沿慢特徵向量恰在第 598 步降到 5% 以下', () => {
    const rho = 0.99
    const g = 0.5
    const ex = eigenExample(rho, g, 0.5)
    let d0 = 1 / Math.SQRT2
    let d1 = -1 / Math.SQRT2 // 慢方向 [1, −1]/√2（λ_min = 1 − ρ）
    let steps = 0
    while (Math.hypot(d0, d1) > 0.05) {
      const n0 = d0 - g * (d0 + rho * d1)
      const n1 = d1 - g * (rho * d0 + d1)
      d0 = n0
      d1 = n1
      steps++
    }
    expect(steps).toBe(ex.stepsSlow)
    expect(steps).toBe(golden('T11').blocks_95)
    // 快方向 [1, 1]/√2：pole = 1 − g(1 + ρ)
    const f0 = 1 - g * (1 + rho)
    expect(f0).toBeCloseTo(ex.pFast, 15)
    expect(stepsToDecay(Math.abs(ex.pFast))).toBe(1)
  })

  it('技術審查 R01：F-PR.10 的 w* = a + B/C 是線性化的結果——B/C 大到讓 comparator 飽和時只是線性外推', () => {
    const f = formulaById('F-PR.10')!
    expect(f.claim).toBe('approx')
    expect(f.conditions).toContain('小訊號線性化')
    expect(f.conditions).toContain('線性外推')
    expect(f.conditions).toContain(String.raw`$0.3\,\sigma_v$`)
    // 線性模型內的數字不變（正常對照）：C 減半，bias、τ、σ_w² 都加倍
    const base = { B: 0.05, mu: 10, sigmaV: 100, N: 4096 }
    const a = weakExcitation({ ...base, C: 1 })
    const b = weakExcitation({ ...base, C: 0.5 })
    expect(a.bias).toBeCloseTo(0.05, 14)
    expect(b.bias / a.bias).toBeCloseTo(2, 12)
    expect(f.conditions).toContain(String.raw`$${LIN_RATIO_LIMIT}\,\sigma_v$`) // 條件裡的門檻就是 Ch11 的 LIN_RATIO_LIMIT
    // 反例（Ch11 §11.4 實驗的預設值，本站的 nearIntegerSweep；另以獨立的 NumPy/SciPy 重算）：frac = 20/65536、σ_v = 1、κ_d = 0.01
    // C = 0.00279 > 0，線性公式給 B/C = 3.58；把它代回去，comparator 前的確定性殘差是 12.4σ_v（門檻的 41 倍），
    // 完整 erf 平均的 GMAC 是 +0.0488（不是 0，是 K_q·B 的 6.1 倍）：a + B/C 不是 Sign-LMS 的固定點
    const ni = nearIntegerSweep({ fracs: [3e-4, 0.05], wnTs: 0.02, zeta: 0.707, loopDelay: 1, kappaDirect: 0.01, sigmaV: 1 })
    expect(ni.Cfreq[0]).toBeCloseTo(0.002793967734, 9)
    expect(ni.bias[0]).toBeCloseTo(weakExcitation({ ...base, B: 0.01, C: ni.Cfreq[0] }).bias, 9) // 同一條 B/C
    expect(ni.bias[0]).toBeCloseTo(3.5791394, 6)
    expect(ni.uMax[0]).toBeCloseTo(2 * Math.sqrt(3), 6) // sawtooth 經 type-II 迴路：max|h*x| = 2√3（標準化 code）
    expect(ni.linRatio[0]).toBeCloseTo(12.381202, 5)
    expect(ni.linRatio[0] / LIN_RATIO_LIMIT).toBeCloseTo(41.27, 2)
    expect(ni.gAtLinear[0]).toBeCloseTo(0.04881877, 7)
    expect(ni.linValid[0]).toBe(false)
    // 正常對照：frac ≈ 0.05 時 B/C = 0.0097，代回去的殘差只有 0.002σ_v，erf 平均的 GMAC ≈ 0：線性公式可用
    expect(ni.bias[1]).toBeCloseTo(0.00969568947, 10)
    expect(ni.linRatio[1]).toBeLessThan(LIN_RATIO_LIMIT / 100)
    expect(Math.abs(ni.gAtLinear[1])).toBeLessThan(1e-10)
    expect(ni.linValid[1]).toBe(true)
  })

  it('技術審查 C01：F-PR.11 的 p_slow 是 |p| 最大的 pole——步長超過 2/(λ_max+λ_min) 時最慢的是 λ_max 的 mode', () => {
    const f = formulaById('F-PR.11')!
    expect(f.claim).toBe('exact')
    expect(f.conditions).toContain(String.raw`\max_i|p_i|`)
    expect(f.conditions).toContain(String.raw`\mu\le2/(\lambda_{\max}+\lambda_{\min})`)
    // 直接迭代 2×2 的 δ ← (I − gR)δ，數到誤差長度最後一次超過 5% 的下一步
    const settle = (rho: number, g: number, d0: [number, number]) => {
      let [a, b] = d0
      const n0 = Math.hypot(a, b)
      let last = 0
      for (let k = 1; k <= 5000; k++) {
        ;[a, b] = [a - g * (a + rho * b), b - g * (rho * a + b)]
        if (Math.hypot(a, b) > 0.05 * n0) last = k
      }
      return last + 1
    }
    // 反例：ρ = 0.5（λ = 1.5、0.5）、g = 1.2（穩定上限 2/1.5 = 1.333）⇒ p = −0.8、0.4
    const ex = eigenExample(0.5, 1.2, 0.5)
    expect(ex.pFast).toBeCloseTo(-0.8, 12)
    expect(ex.pSlow).toBeCloseTo(0.4, 12)
    expect(Math.abs(ex.pFast)).toBeGreaterThan(Math.abs(ex.pSlow))
    expect(ex.stepsSlow).toBe(4) // 只看 λ_min 的 mode：4 步
    expect(stepsToDecay(Math.abs(ex.pFast))).toBe(14) // λ_max 的 mode：14 步
    expect(settle(0.5, 1.2, [1, 1])).toBe(14) // 沿 λ_max 的方向 [1, 1]
    expect(settle(0.5, 1.2, [1, -1])).toBe(4) // 沿 λ_min 的方向 [1, −1]
    expect(settle(0.5, 1.2, [1, 0])).toBe(12) // 一般的初值 [1, 0]：‖δ_k‖ = (1/√2)·√(0.64^k + 0.16^k)，k = 11 是 0.0607、k = 12 是 0.0486，由 |p| 最大的 mode 主導
    // 分界 g = 2/(λ_max+λ_min) = 1：|p| 相等
    const tie = eigenExample(0.5, 1, 0.5)
    expect(Math.abs(tie.pFast)).toBeCloseTo(Math.abs(tie.pSlow), 12)
    // 正常對照：步長不太大（g = 0.5 ≤ 1）時最慢的是 λ_min 的 mode
    const ok = eigenExample(0.5, 0.5, 0.5)
    expect(ok.pFast).toBeCloseTo(0.25, 12)
    expect(ok.pSlow).toBeCloseTo(0.75, 12)
    expect(ok.stepsSlow).toBe(11)
    expect(settle(0.5, 0.5, [1, -1])).toBe(11)
    expect(settle(0.5, 0.5, [1, 1])).toBe(3)
    // 掃一遍：max(|1 − gλ_max|, |1 − gλ_min|) 由誰決定，只看 g 與 2/(λ_max+λ_min) 的大小
    for (const rho of [0.1, 0.5, 0.9, 0.99]) {
      const lmax = 1 + rho
      const lmin = 1 - rho
      for (let i = 1; i < 200; i++) {
        const g = ((2 / lmax) * i) / 200
        if (Math.abs(g - 2 / (lmax + lmin)) < 1e-9) continue
        expect(Math.abs(1 - g * lmax) > Math.abs(1 - g * lmin), `rho=${rho}, g=${g}`).toBe(g > 2 / (lmax + lmin))
      }
    }
  })

  it('T16: F-PR.12：多組有理數目標 × 隨機週期 dither：週期 P ≤ M·L，且輸出從 transient 之後確實每 P 個重複', () => {
    const rng = createRng(1616)
    for (let trial = 0; trial < 40; trial++) {
      const den = 2 * rng.int(1, 12) // 偶數分母：±½ LSB 的 dither 分子才是整數
      const cNum = 32 * den + rng.int(0, den - 1)
      const L = rng.int(1, 9)
      const dither = Int32Array.from({ length: L }, () => (rng.bernoulli(0.5) ? den / 2 : -den / 2))
      const cyc = efCycle(cNum, den, { ditherNum: dither })
      // r ∈ [−½, ½) ⇒ R = r·den 只有 den 個可能值（M = den）
      expect(cyc.period).toBeLessThanOrEqual(den * L)
      expect(cyc.period % 1).toBe(0)
      const total = cyc.transient + 3 * cyc.period
      const { y } = efQuantize(cNum, den, total, { ditherNum: dither })
      for (let n = cyc.transient; n + cyc.period < total; n++) expect(y[n + cyc.period]).toBe(y[n])
    }
    // 沒有 dither：c = P/q（最簡）⇒ 週期恰為 q
    expect(efCycle(162, 5).period).toBe(golden('T16').ef_period)
    expect(efCycle(97, 3).period).toBe(3)
  })

  it('T17: F-PR.13：對 ξ 做確定性的中點積分（不靠亂數）：non-subtractive f(1 − f)、subtractive 1/12、皆無偏', () => {
    const Q = (v: number) => Math.floor(v + 0.5)
    const K = 100_000
    for (const c of [32.4, 32.5, 17.05, 40.999, 12]) {
      const f = c - Math.floor(c)
      let mN = 0
      let pN = 0
      let mS = 0
      let pS = 0
      for (let i = 0; i < K; i++) {
        const xi = -0.5 + (i + 0.5) / K
        const y = Q(c + xi)
        mN += (y - c) / K
        pN += (y - c) ** 2 / K
        mS += (y - xi - c) / K
        pS += (y - xi - c) ** 2 / K
      }
      expect(mN).toBeCloseTo(0, 4)
      expect(pN).toBeCloseTo(f * (1 - f), 4)
      expect(mS).toBeCloseTo(0, 4)
      expect(pS).toBeCloseTo(1 / 12, 4)
    }
    // 不加 dither：c = 32.4 的誤差恆為 −0.4 LSB（功率 0.16，全部在 DC）
    expect((Q(32.4) - 32.4) ** 2).toBeCloseTo(0.16, 12)
    // 與 golden T17（stochastic rounding）一致：RPDF dither + rounding 就是 P(33) = f 的隨機進位
    const T17 = golden('T17')
    let pHigh = 0
    for (let i = 0; i < K; i++) if (Q(32.4 - 0.5 + (i + 0.5) / K) === 33) pHigh += 1 / K
    expect(pHigh).toBeCloseTo(0.4, 4)
    expect(32 + pHigh).toBeCloseTo(T17.mean, 4)
    expect(pHigh * (1 - pHigh)).toBeCloseTo(T17.variance, 4)
  })

  it('T14: F-PR.15：由頻寬反解的 p，代回 |μ/(e^{jΩ} − p)|² 後——(a) 在 f_BW 恰為半功率點；(b) 對頻率積分得到的 ENBW 恰為 f_BW', () => {
    const fu = golden('T14').f_u_hz
    for (const fbw of [golden('T14').bw_exact_3db_hz, 5e3, 1e5, 3e5]) {
      const mag2 = (p: number, Om: number) => 1 / (1 + p * p - 2 * p * Math.cos(Om))
      const pa = poleFromF3db(fbw, fu)
      expect(mag2(pa, (2 * Math.PI * fbw) / fu) / mag2(pa, 0)).toBeCloseTo(0.5, 10)
      const pb = poleFromEnbw(fbw, fu)
      const K = 200_000
      let integ = 0
      for (let i = 0; i < K; i++) integ += mag2(pb, (Math.PI * (i + 0.5)) / K) / K
      expect(((fu / 2) * integ) / mag2(pb, 0) / fbw).toBeCloseTo(1, 8)
    }
    // golden T14 的兩個頻寬各自換回 golden 的 p（Python 的參考值）
    const T14in = (JSON.parse(readFileSync(join(process.cwd(), 'golden', 'vectors', 'T14.json'), 'utf8')) as { inputs: { p: number } }).inputs
    expect(poleFromF3db(golden('T14').bw_exact_3db_hz, fu)).toBeCloseTo(T14in.p, 12)
    expect(poleFromEnbw(golden('T14').enbw_one_sided_hz, fu)).toBeCloseTo(T14in.p, 12)
    // 條件欄寫的範圍：(a) 的解 > 3 − 2√2，(b) 的解 > 0
    expect(poleFromF3db(0.4999 * fu, fu)).toBeGreaterThan(3 - 2 * Math.SQRT2)
    expect(poleFromEnbw(0.4999 * fu, fu)).toBeGreaterThan(0)
    expect(poleFromEnbw(0.4999 * fu, fu)).toBeLessThan(3 - 2 * Math.SQRT2)
  })
})
