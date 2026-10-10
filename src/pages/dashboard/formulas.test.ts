import { renderTex } from '@/components'
import { PAGES } from '@/app/registry'
import { erratumById } from './summaries'
import { FORMULAS } from './formulas'
import { mathTextProblems } from './mathTextTestUtils'
import {
  DEFAULT_PARAMS,
  evaluateThesis,
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
})
