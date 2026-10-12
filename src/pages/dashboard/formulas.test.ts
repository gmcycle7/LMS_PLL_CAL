import { renderTex } from '@/components'
import { PAGES } from '@/app/registry'
import { erratumById } from './summaries'
import { FORMULAS } from './formulas'
import { mathTextProblems } from './mathTextTestUtils'
import {
  DEFAULT_PARAMS,
  comparatorGain,
  evaluateThesis,
  fixedToneRadius,
  impulseEnergyClosed,
  impulseEnergyClosedD1,
  impulseEnergyLyapunov,
  modePrecond,
} from './thesisModel'

describe('Dashboard 公式登錄（F-DB.n）', () => {
  it('ID 唯一、格式為 F-DB.n、頁面為 /，勘誤 id 存在，TeX 可由 KaTeX 解析', () => {
    const ids = FORMULAS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(PAGES.some((p) => p.path === '/')).toBe(true)
    for (const f of FORMULAS) {
      expect(f.id).toMatch(/^F-DB\.\d+$/)
      expect(f.page).toBe('/')
      expect(f.conditions.length).toBeGreaterThan(10)
      if (f.erratumId) expect(erratumById(f.erratumId), f.erratumId).toBeDefined()
      const html = renderTex(f.tex, true)
      expect(html, f.id).not.toMatch(/katex-error|c-tex-error/)
      expect(html).toContain('katex')
      // title / conditions 由 Formula & Unit Reference 頁以 mathText 顯示：數學一律在 $…$ 內
      expect(mathTextProblems(f.title), `${f.id} title`).toEqual([])
      expect(mathTextProblems(f.conditions), `${f.id} conditions`).toEqual([])
      expect(f.conditions, f.id).toContain('$')
      // units 是純文字欄位：不放 TeX 分隔符，也不用 Unicode 上標（寫成 fs^-1）
      for (const u of Object.values(f.units ?? {})) expect(u, f.id).not.toMatch(/[$⁰-₟²³¹]/)
    }
  })

  it('登錄的式子與計算核心一致（代數字驗算，不是只有排版）', () => {
    const p = { ...DEFAULT_PARAMS, B: 0.25, Px: 0.5 }
    const r = evaluateThesis(p)
    // F-DB.1：p = 1 − μ K_q C
    expect(r.maxRadius).toBeCloseTo(Math.abs(1 - p.mu * r.Kq * r.polarity.C), 14)
    // F-DB.2：d = 0、1 的封閉式 = Lyapunov
    expect(impulseEnergyLyapunov(0.37, 0)).toBeCloseTo(1 / (0.37 * (2 - 0.37)), 13)
    expect(impulseEnergyClosed(0.37)).toBeCloseTo(1 / (0.37 * 1.63), 13)
    expect(impulseEnergyLyapunov(0.37, 1)).toBeCloseTo(impulseEnergyClosedD1(0.37), 11)
    // F-DB.2：σ_w² = μ² σ_η² Σy²
    expect(r.sigmaW ** 2).toBeCloseTo(p.mu ** 2 * r.sigmaEta2 * impulseEnergyClosed(r.g), 12)
    // F-DB.4：同樣 loop gain 下 Var ∝ 1/λ̃ ⇒ RMS 比 = √κ
    const weak = modePrecond(0.3, 0.01, 1)
    const strong = modePrecond(0.3, 1.99, 1)
    expect(weak.gain).toBe(strong.gain)
    expect(Math.sqrt(weak.noise / strong.noise)).toBeCloseTo(Math.sqrt(199), 10)
    // F-DB.5：σ_δt = √(P_x(Δw² + σ_w²))、A_t = √(2P_x)|Δw|、Spur = 20 log10(β/2) = 20 log10(π f_out |T| A_t)
    expect(r.sigmaDt).toBeCloseTo(Math.sqrt(p.Px * (r.deltaW ** 2 + r.sigmaW ** 2)), 13)
    expect(r.AtPeak).toBeCloseTo(Math.sqrt(2 * p.Px) * Math.abs(r.deltaW), 14)
    expect(r.betaRad).toBeCloseTo(2 * Math.PI * p.foutGHz * 1e9 * p.Tmag * r.AtPeak * 1e-15, 18)
    expect(r.spurDbc).toBeCloseTo(20 * Math.log10(Math.PI * p.foutGHz * 1e9 * p.Tmag * r.AtPeak * 1e-15), 10)
    expect(r.spurDbc).toBeCloseTo(-93.8, 1) // T15
  })

  it('F-DB.6（R12 的對照）：兩個固定同頻單頻 code 的特徵值 λ± = cos θ ± √(ρ² − sin²θ)，與計算核心的 fixedToneRadius 一致', () => {
    const f6 = FORMULAS.find((f) => f.id === 'F-DB.6')!
    expect(f6.claim).toBe('exact')
    expect(f6.conditions).toContain('固定單頻 code')
    expect(f6.conditions).toContain(String.raw`$\rho=\cos(\psi_2-\psi_1)$`)
    const Kq = comparatorGain(DEFAULT_PARAMS.sigmaV)
    const base = { ...DEFAULT_PARAMS, twoParam: true, update: 'scalar' as const, d: 0 }
    // ρ = 0.9、θ = 30°、g′ = 1：兩個實特徵值
    const th = (30 * Math.PI) / 180
    const lam = [Math.cos(th) + Math.sqrt(0.81 - 0.25), Math.cos(th) - Math.sqrt(0.81 - 0.25)]
    expect(lam[0]).toBeCloseTo(1.614356881139227, 12)
    expect(lam[1]).toBeCloseTo(0.11769392642965038, 12)
    expect(lam[0] + lam[1]).toBeCloseTo(2 * Math.cos(th), 12) // λ₊ + λ₋ = 2 cos θ
    expect(lam[0] * lam[1]).toBeCloseTo(1 - 0.81, 12) // λ₊ λ₋ = 1 − ρ²
    const radius = Math.max(...lam.map((l) => Math.abs(1 - l)))
    expect(radius).toBeCloseTo(0.8823060735703496, 12)
    expect(fixedToneRadius({ ...base, mu: 1 / Kq, rho: 0.9, phiDeg: 30 })).toBeCloseTo(radius, 12)
    // ρ = 0、θ = 60°、g′ = 1.5：共軛複數特徵值 e^{±j60°}，|1 − 1.5 e^{j60°}| = √1.75
    expect(Math.hypot(1 - 1.5 * Math.cos(Math.PI / 3), 1.5 * Math.sin(Math.PI / 3))).toBeCloseTo(Math.sqrt(1.75), 14)
    expect(fixedToneRadius({ ...base, mu: 1.5 / Kq, rho: 0, phiDeg: 60 })).toBeCloseTo(Math.sqrt(1.75), 12)
    // θ = 0° 時回到本模型的 C(1 ± ρ)
    const p0 = { ...base, mu: 0.75 / Kq, rho: 0.5, phiDeg: 0 }
    expect(fixedToneRadius(p0)).toBeCloseTo(evaluateThesis(p0).maxRadius, 12)
    // F-DB.4 的條件寫明交叉相關假設，並指到 F-DB.6
    const f4 = FORMULAS.find((f) => f.id === 'F-DB.4')!
    expect(f4.claim).toBe('approx')
    expect(f4.conditions).toContain(String.raw`$E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$`)
    expect(f4.conditions).toContain('F-DB.6')
  })

  it('F-DB.5（R14）：條件寫明單參數、DTC-referred、和預算比；雙參數時 random 部分不是這個封閉式', () => {
    const f5 = FORMULAS.find((f) => f.id === 'F-DB.5')!
    expect(f5.claim).toBe('approx')
    for (const need of ['單參數', 'DTC-referred', 'F-12.17', '不是校正前後的比較']) expect(f5.conditions, need).toContain(need)
    const two = evaluateThesis({ ...DEFAULT_PARAMS, twoParam: true, rho: 0 })
    expect(two.sigmaDtRand).toBeCloseTo(Math.SQRT2 * 0.39918614299092875, 10)
    expect(two.sigmaDt).toBeGreaterThan(Math.sqrt(DEFAULT_PARAMS.Px * (two.deltaW ** 2 + two.sigmaW ** 2)) + 0.1)
  })
})
