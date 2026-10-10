/**
 * sspll.ts（TS port）對照 golden 的數字：
 *   - src/data/sspll/*.json（analysis/sspll/golden/tools/export_web_data.py 產生）
 *   - analysis/sspll/golden/results/{doc_numbers,worked_examples}.json
 * JSON 多半只存 4–6 位有效數字，容許誤差依欄位而定。
 */
import { readFileSync } from 'node:fs'
import paramsJson from '@/data/sspll/params.json'
import hpdL1 from '@/data/sspll/hpd_L1.json'
import hpdL2 from '@/data/sspll/hpd_L2.json'
import hpdL3 from '@/data/sspll/hpd_L3.json'
import mapL1 from '@/data/sspll/signmap_L1.json'
import mapL2 from '@/data/sspll/signmap_L2.json'
import mapL3 from '@/data/sspll/signmap_L3.json'
import predJson from '@/data/sspll/pred_vs_sim.json'
import { cAbs } from '@/simulation/core/complex'
import {
  F_REF,
  W1,
  W_SQUARE,
  accSide,
  analyseAlpha,
  blockMeanStable,
  cPeriodic,
  cppllFinv,
  cppllMinusReL,
  discConstant,
  eqOffset,
  gammaEff,
  gosConjectureScan,
  gosHarmonic,
  gosOffsetBias,
  gosRationalBeta,
  gosSmallBeta,
  hpdSweep,
  hurwitzZeta2,
  indicatorLineWeight,
  inversionBands,
  kappaInfWorst,
  kappaRational,
  kernelMin,
  kqGain,
  kqOffset,
  largeSignalPeriodic,
  limitDenominator,
  loopF3dB,
  loopH,
  loopImpulse,
  loopL,
  loopMargins,
  loopStable,
  loopSummary,
  loopT,
  lowFreqReHCoeff,
  makeL1,
  makeL2,
  makeL3,
  makePOnlyL2,
  makePOnlyL3,
  mode1SureBand,
  nominalLoops,
  oneDiffMargin,
  phaseSequence,
  phosLambdaHarmonic,
  phosM1Bounds,
  regressorRows,
  runSspllLms,
  runSspllLmsCompare,
  singleLinePhos,
  typeIIFinv,
  typeIIReL,
  typeIKClosedForm,
  typeILatencyCriterion,
  typeIPoleCriterion,
  typeIReH,
  variantG,
  type SspllLoop,
  type SspllSimCfg,
} from './sspll'

type Num = number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const PARAMS = paramsJson as Json
const HPD: Record<string, Json> = { L1: hpdL1, L2: hpdL2, L3: hpdL3 }
const MAP: Record<string, Json> = { L1: mapL1, L2: mapL2, L3: mapL3 }
const PRED = predJson as Json
const readGolden = (name: string): Json => JSON.parse(readFileSync(new URL(`../../../analysis/sspll/golden/results/${name}`, import.meta.url), 'utf8'))
const DOC = readGolden('doc_numbers.json')
const WORKED = readGolden('worked_examples.json')

const MHZ = F_REF / 1e6
const LOOPS = nominalLoops()
const KEYS = ['L1', 'L2', 'L3'] as const

/** |a − e| ≤ abs + rel·|e| */
function close(a: Num, e: Num, rel: Num, abs = 0): void {
  const tol = abs + rel * Math.abs(e)
  if (!(Math.abs(a - e) <= tol)) throw new Error(`expected ${a} ≈ ${e}（|Δ| = ${Math.abs(a - e)} > ${tol}）`)
}

const CFG: SspllSimCfg = {
  sigmaPs: 0.2,
  deltaPs: PARAMS.assumptions.Delta_ps_illustrative,
  a: PARAMS.assumptions.sim_physics.a_gos,
  epsPs: PARAMS.assumptions.sim_physics.eps_ps,
}

describe('SSPLL 迴路設計（loops.py port）', () => {
  it('SSPLL: 設計參數 K = 0.388836、(Kp, Ki) = (0.287717, 0.0382535)、b = 13.928、ω_cT = 0.303955', () => {
    close(Number(LOOPS.L1.params.K), PARAMS.loops.L1.params.K, 1e-13)
    close(typeIKClosedForm(), 0.388836, 2e-6)
    close(Number(LOOPS.L2.params.Kp), PARAMS.loops.L2.params.Kp, 1e-8)
    close(Number(LOOPS.L2.params.Ki), PARAMS.loops.L2.params.Ki, 1e-8)
    close(Number(LOOPS.L2.params.zeta), PARAMS.loops.L2.params.zeta_ct, 1e-8)
    close(Number(LOOPS.L2.params.Kp), 0.287717, 2e-6)
    close(Number(LOOPS.L2.params.Ki), 0.0382535, 2e-6)
    close(Number(LOOPS.L3.params.b), PARAMS.loops.L3.params.b, 1e-12)
    close(Number(LOOPS.L3.params.wc), PARAMS.loops.L3.params.wc, 1e-8)
    close(Number(LOOPS.L3.params.b), 13.928, 2e-5)
    close(Number(LOOPS.L3.params.wc), 0.303955, 2e-6)
    close(Number(LOOPS.L3.params.B), PARAMS.closed_forms.L3_B, 1e-8)
    close(Number(LOOPS.L3.params.p), PARAMS.closed_forms.L3_p, 1e-8)
    close(Number(LOOPS.L3.params.K), PARAMS.closed_forms.L3_K, 1e-8)
    close(Number(LOOPS.L3.params.fzMHz), PARAMS.loops.L3.params.fz_MHz, 1e-8)
    close(Number(LOOPS.L3.params.fpMHz), PARAMS.loops.L3.params.fp_MHz, 1e-8)
    for (const k of KEYS) {
      const g = PARAMS.loops[k]
      expect(LOOPS[k].bL.length).toBe(g.bL.length)
      LOOPS[k].bL.forEach((v, i) => close(v, g.bL[i], 1e-8, 1e-12))
      LOOPS[k].aL.forEach((v, i) => close(v, g.aL[i], 1e-8, 1e-12))
    }
  })

  it('SSPLL: 三個迴路的 f3dB = 320.000 MHz、PM 78.79 / 60.00 / 58.58°、|T| peaking 0 / 2.127 / 1.736 dB', () => {
    for (const k of KEYS) {
      const s = loopSummary(LOOPS[k])
      const g = PARAMS.loops[k]
      close(s.f3dBMHz, 320, 0, 1e-6)
      close(s.pmDeg, g.PM_deg, 0, 1e-6)
      close(s.fcMHz, g.fc_MHz, 0, 1e-6)
      close(s.tPeakDb, g.T_peak_dB, 0, 2e-5)
      close(s.maxReH, g.max_ReH, 1e-6)
      expect(s.stable).toBe(true)
      expect(loopStable(LOOPS[k])).toBe(true)
    }
    close(loopMargins(LOOPS.L1).pmDeg, 78.79, 0, 5e-3)
    close(loopMargins(LOOPS.L2).pmDeg, 60.0, 0, 1e-6)
    close(loopMargins(LOOPS.L3).pmDeg, 58.58, 0, 5e-3)
  })

  it('SSPLL: h_PD[0] = 1，脈衝響應前 6 個值與 golden 的手算表一致', () => {
    for (const k of KEYS) {
      const h = loopImpulse(LOOPS[k], 6)
      expect(h[0]).toBe(1)
      const ref: number[] = WORKED[`j_hPD_${k}`]
      ref.forEach((v, i) => close(h[i], v, 0, 6e-6))
    }
    // Type-I：Σh = H(1) = 0（負尾巴總和 −1）
    const h1 = loopImpulse(LOOPS.L1, 400)
    close(
      h1.reduce((a, b) => a + b, 0),
      0,
      0,
      1e-12,
    )
  })

  it('SSPLL: H_PD 格點與 hpd_L*.json 一致（Re H、Im H、|H|、|T|、Re L 與各對策的 Re Γ）', () => {
    // JSON 的 f_MHz 只存 6 位有效數字，數值則是在未捨入的格點上算的；這裡依 grid_note 重建精確格點：
    // 500 個 log 點 0.1–100 MHz（不含終點）+ 1000 個線性點 100–2000 MHz。
    const fExact = (i: number): number => (i < 500 ? 0.1 * 1000 ** (i / 500) : 100 + (1900 * (i - 500)) / 999)
    for (const k of KEYS) {
      const g = HPD[k]
      expect(g.f_MHz.length).toBe(1500)
      const idx: number[] = []
      for (let i = 0; i < g.f_MHz.length; i += 7) idx.push(i)
      idx.push(g.f_MHz.length - 1)
      for (const i of idx) close(g.f_MHz[i], fExact(i), 6e-6)
      const fx = { exact: LOOPS[k] }
      const sw = hpdSweep(LOOPS[k], idx.map(fExact), F_REF, ['1diff', '2diff', 'D:1', 'fx:exact'], fx)
      const ponly = k === 'L2' ? makePOnlyL2(LOOPS.L2) : k === 'L3' ? makePOnlyL3(LOOPS.L3) : null
      idx.forEach((i, n) => {
        const rel = 6e-6 // 6 位有效數字
        close(sw.reH[n], g.ReH[i], rel, 1e-15)
        close(sw.imH[n], g.ImH[i], rel, 1e-15)
        close(sw.absH[n], g.absH[i], rel, 1e-15)
        close(sw.absT[n], g.absT[i], rel)
        close(sw.reL[n], g.ReL[i], rel)
        close(sw.reGamma['1diff'][n], g.ReGamma_1diff[i], rel, 1e-18)
        close(sw.reGamma['2diff'][n], g.ReGamma_2diff[i], rel, 1e-18)
        close(sw.reGamma['D:1'][n], g.ReGamma_D1[i], rel, 1e-15)
        close(sw.reGamma['fx:exact'][n], g.ReGamma_fx_exact[i], rel, 1e-18)
        if (ponly) close(loopH(ponly, (fExact(i) * 1e6) / F_REF).re, g.ReH_Ponly[i], rel, 1e-15)
      })
    }
  })
})

describe('SSPLL 恆等式與反號帶', () => {
  it('SSPLL: 恆等式 Re H_PD = (1 + Re L)/|1 + L|²；Re H < 0 ⟺ Re T > 1 ⟹ |T| > 1', () => {
    for (const k of KEYS) {
      for (let i = 1; i <= 4000; i++) {
        const f = (0.5 * i) / 4000
        const L = loopL(LOOPS[k], f)
        const H = loopH(LOOPS[k], f)
        const T = loopT(LOOPS[k], f)
        const id = (1 + L.re) / ((1 + L.re) ** 2 + L.im ** 2)
        close(H.re, id, 1e-9, 1e-12)
        close(T.re, 1 - H.re, 1e-12, 1e-12)
        if (H.re < -1e-12) {
          expect(L.re).toBeLessThan(-1)
          expect(T.re).toBeGreaterThan(1)
          expect(cAbs(T)).toBeGreaterThan(1)
        }
      }
    }
  })

  it('SSPLL: L2 反號帶 0–134.82 MHz（closed form 與掃描一致），最低 −0.2053 @ 83.8 MHz', () => {
    const bands = inversionBands(LOOPS.L2)
    expect(bands.length).toBe(1)
    const g = PARAMS.loops.L2.ReH_neg_bands_MHz[0]
    expect(bands[0].fLo).toBe(0)
    close(bands[0].fHi * MHZ, g[1], 0, 1e-6)
    close(bands[0].fHi * MHZ, 134.82, 0, 1e-3)
    close(bands[0].minReH, g[2], 0, 1e-8)
    close(bands[0].fMin * MHZ, g[3], 0, 0.02)
    const fInv = typeIIFinv(Number(LOOPS.L2.params.Kp), Number(LOOPS.L2.params.Ki)) * MHZ
    close(fInv, PARAMS.closed_forms.L2_f_inv_MHz, 0, 1e-6)
    close(fInv, bands[0].fHi * MHZ, 0, 1e-7)
    // 文件 §6.2 的手算
    close(WORKED.b_f_inv_MHz, fInv, 0, 1e-6)
    const f838 = 83.8e6 / F_REF
    close(typeIIReL(Number(LOOPS.L2.params.Kp), Number(LOOPS.L2.params.Ki), f838), WORKED.a_ReL_closed, 1e-7)
    close(loopH(LOOPS.L2, f838).re, WORKED.a_ReH_direct, 1e-7)
    for (const f of [0.003, 0.02, 0.1, 0.3, 0.5]) close(typeIIReL(Number(LOOPS.L2.params.Kp), Number(LOOPS.L2.params.Ki), f), loopL(LOOPS.L2, f).re, 1e-9)
  })

  it('SSPLL: L3 反號帶 0–117.28 MHz（closed form −Re L = 1），最低 −0.1616 @ 67.3 MHz', () => {
    const bands = inversionBands(LOOPS.L3)
    expect(bands.length).toBe(1)
    const g = PARAMS.loops.L3.ReH_neg_bands_MHz[0]
    close(bands[0].fHi * MHZ, g[1], 0, 1e-6)
    close(bands[0].fHi * MHZ, 117.28, 0, 3e-3)
    close(bands[0].minReH, g[2], 0, 1e-8)
    close(bands[0].fMin * MHZ, g[3], 0, 0.02)
    close(cppllFinv(LOOPS.L3.params) * MHZ, bands[0].fHi * MHZ, 0, 1e-6)
    for (const f of [0.003, 0.02, 0.1, 0.3, 0.5]) close(cppllMinusReL(LOOPS.L3.params, f), -loopL(LOOPS.L3, f).re, 1e-8)
  })

  it('SSPLL: L1（標稱）沒有反號帶，Re H 的 closed form (2−K)(1−cos Ω)/|1−(1−K)e^{−jΩ}|² ≥ 0', () => {
    expect(inversionBands(LOOPS.L1)).toEqual([])
    const K = Number(LOOPS.L1.params.K)
    for (let i = 1; i <= 2000; i++) {
      const f = (0.5 * i) / 2000
      close(typeIReH(K, f), loopH(LOOPS.L1, f).re, 1e-10, 1e-14)
      expect(typeIReH(K, f)).toBeGreaterThanOrEqual(0)
    }
  })

  it('SSPLL: 低頻 Type-II Re H ≈ −Ω²/K_i（L3：−Ω²/K_d），Type-I ≈ (Ω²/K²)(1 − K/2)', () => {
    const f = 1e-4
    const W = 2 * Math.PI * f
    close(loopH(LOOPS.L2, f).re / (-W * W * lowFreqReHCoeff(LOOPS.L2)), PARAMS.closed_forms.L2_lowf_ratio, 1e-6)
    close(loopH(LOOPS.L3, f).re / (-W * W * lowFreqReHCoeff(LOOPS.L3)), PARAMS.closed_forms.L3_lowf_ratio, 1e-6)
    const K = Number(LOOPS.L1.params.K)
    close(loopH(LOOPS.L1, f).re / (((W * W) / (K * K)) * (1 - K / 2)), PARAMS.closed_forms.L1_lowf_ratio, 1e-6)
    // 文件 §5.2 的 20 MHz 例
    const f20 = 20e6 / F_REF
    close(loopH(LOOPS.L2, f20).re, WORKED.f_ReH_L2_20MHz, 1e-8)
    close(loopH(LOOPS.L1, f20).re, WORKED.f_ReH_L1_20MHz, 1e-8)
    close(-((2 * Math.PI * f20) ** 2) / Number(LOOPS.L2.params.Ki), WORKED.f_minusW2_over_Ki, 1e-7)
  })

  it('SSPLL: Type-I 不是天生免疫——延遲判據 K(d − ½) 與寄生極點判據 K(½ + p/(1−p))', () => {
    const T = PARAMS.typeI_criteria
    for (const d of [1, 2, 3, 4, 5]) {
      const g = T[`lat${d}`]
      const lp = makeL1({ lat: d })
      close(Number(lp.params.K), g.K, 1e-7)
      close(typeILatencyCriterion(Number(lp.params.K), d), g.criterion, 1e-7)
      close(loopMargins(lp).pmDeg, g.PM_deg, 0, 1e-5)
      close(loopF3dB(lp) * MHZ, 320, 0, 1e-5)
      const bands = inversionBands(lp)
      expect(bands.length).toBe(g.bands.length)
      expect(bands.length > 0).toBe(g.criterion > 1)
      if (bands.length) {
        close(bands[0].fHi * MHZ, g.bands[0][1], 0, 1e-5)
        close(bands[0].minReH, g.bands[0][2], 0, 1e-7)
      }
    }
    for (const fp of [1000, 500, 250, 200]) {
      const g = T[`pole${fp}M`]
      const lp = makeL1({ fPoleHz: fp * 1e6 })
      close(Number(lp.params.K), g.K, 1e-7)
      close(Number(lp.params.p), g.p, 1e-10)
      close(typeIPoleCriterion(Number(lp.params.K), Number(lp.params.p)), g.criterion, 1e-7)
      close(loopMargins(lp).pmDeg, g.PM_deg, 0, 1e-5)
      const bands = inversionBands(lp)
      expect(bands.length).toBe(g.bands.length)
      expect(bands.length > 0).toBe(g.criterion > 1)
      if (bands.length) {
        close(bands[0].fHi * MHZ, g.bands[0][1], 0, 1e-5)
        close(bands[0].minReH, g.bands[0][2], 0, 1e-7)
      }
    }
  })

  it('SSPLL: PM、延遲、取樣映射與 loop-gain（PVT）都會移動帶緣；Type-II 的帶一定從 DC 開始', () => {
    const S = PARAMS.sensitivity
    const L2 = LOOPS.L2
    const L3 = LOOPS.L3
    const cases: [string, SspllLoop][] = [
      ['L2_pm45', makeL2({ pm: 45 })],
      ['L2_pm75', makeL2({ pm: 75 })],
      ['L2_lat2_redesign', makeL2({ pm: 60, lat: 2 })],
      ['L2_lat2_fixedKpKi', makeL2({ Kp: Number(L2.params.Kp), Ki: Number(L2.params.Ki), lat: 2 })],
      ['L3_pm45', makeL3({ pmCt: 45 })],
      ['L3_pm55', makeL3({ pmCt: 55 })],
      ['L3_halfT', makeL3({ mapping: 'halfT' })],
      ['L3_zoh', makeL3({ mapping: 'zoh' })],
    ]
    for (const gs of [0.6, 0.8, 1.25, 1.5]) {
      cases.push([`L2_gain${gs}`, makeL2({ Kp: Number(L2.params.Kp), Ki: Number(L2.params.Ki), gainScale: gs })])
      cases.push([`L3_gain${gs}`, makeL3({ b: Number(L3.params.b), wc: Number(L3.params.wc), gainScale: gs })])
    }
    for (const [key, lp] of cases) {
      const g = S[key]
      expect(g, key).toBeTruthy()
      close(loopF3dB(lp) * MHZ, g.f3dB_MHz, 0, 2e-5)
      close(loopMargins(lp).pmDeg, g.PM_deg, 0, 2e-5)
      const bands = inversionBands(lp)
      expect(bands.length).toBe(1)
      expect(bands[0].fLo).toBe(0)
      close(bands[0].fHi * MHZ, g.bands[0][1], 0, 2e-5)
      close(bands[0].minReH, g.bands[0][2], 0, 1e-7)
    }
  })

  it('SSPLL: P-only 對策迴路：218.09 MHz／267.84 MHz／297.95 MHz，判據 0.144／0.296／0.339 < 1，沒有反號帶', () => {
    const P = PARAMS.P_only
    const p2 = makePOnlyL2(LOOPS.L2)
    const p3 = makePOnlyL3(LOOPS.L3)
    const p3x = makePOnlyL3(LOOPS.L3, true)
    close(loopF3dB(p2) * MHZ, P.L2_Ponly.f3dB_MHz, 0, 1e-5)
    close(loopMargins(p2).pmDeg, P.L2_Ponly.PM_deg, 0, 1e-5)
    close(typeILatencyCriterion(Number(p2.params.K), 1), P.L2_Ponly.criterion, 1e-8)
    close(loopF3dB(p3) * MHZ, P['L3_Ponly_C1>>C2'].f3dB_MHz, 0, 1e-5)
    close(loopMargins(p3).pmDeg, P['L3_Ponly_C1>>C2'].PM_deg, 0, 1e-5)
    close(Number(p3.params.A), P['L3_Ponly_C1>>C2'].params.A, 1e-8)
    close(typeIPoleCriterion(Number(p3.params.A), Number(p3.params.p)), P['L3_Ponly_C1>>C2'].criterion, 1e-8)
    close(loopF3dB(p3x) * MHZ, P.L3_Ponly_exactRC2.f3dB_MHz, 0, 1e-5)
    close(loopMargins(p3x).pmDeg, P.L3_Ponly_exactRC2.PM_deg, 0, 1e-5)
    close(typeIPoleCriterion(Number(p3x.params.A), Number(p3x.params.p)), P.L3_Ponly_exactRC2.criterion, 1e-8)
    for (const lp of [p2, p3, p3x]) {
      expect(inversionBands(lp)).toEqual([])
      expect(kernelMin(lp).min).toBeGreaterThan(-1e-12)
    }
  })
})

describe('SSPLL regressor 的 Fourier 權重與 ergodic 諧波和', () => {
  it('SSPLL: W₁ = 0.94964、方波權重 8/π² = 0.81057；模態權重和為 1；鋸齒功率和為 1/12', () => {
    close(W1, PARAMS.closed_forms.W1, 1e-14)
    close(W1, 0.94964, 2e-6)
    close(W_SQUARE, 8 / Math.PI ** 2, 1e-15)
    for (let m = 1; m < 8; m++) {
      let s = 0
      for (let k = -4000; k < 4000; k++) s += 64 * indicatorLineWeight(m + 8 * k)
      s += ((64 * Math.sin((Math.PI * m) / 8) ** 2) / Math.PI ** 2) * ((hurwitzZeta2(4000 + m / 8) + hurwitzZeta2(4001 - m / 8)) / 64)
      close(s, 1, 1e-12)
    }
    // trigamma(1) = π²/6
    close(hurwitzZeta2(1), Math.PI ** 2 / 6, 1e-13)
    close(hurwitzZeta2(8193), 1 / 8193 + 1 / (2 * 8193 ** 2) + 1 / (6 * 8193 ** 3), 1e-13)
    // H ≡ 1：κ_GOS = 12·Σ 1/(2π²m²) = 1、κ_m = 1
    const open = gammaEff(null, 'raw', undefined, true)
    close(12 * gosHarmonic(0.137, open), 1, 1e-12)
    for (const l of phosLambdaHarmonic(0.137, open).slice(1)) close(8 * l.re, 1, 1e-12)
  })

  it('SSPLL: 手算例 L2、α = 0.021（84 MHz）：κ₁ = −0.13953，其餘模態 0.401 / 0.830 / 0.944；單線 W₁·Re H = −0.19495', () => {
    const G = gammaEff(LOOPS.L2)
    const lam = phosLambdaHarmonic(0.021, G)
    const ref: number[] = WORKED.c_8lam_all
    ref.forEach((v, i) => close(8 * lam[i + 1].re, v, 0, 2e-9))
    close(8 * lam[1].re, WORKED.c_8Relam1, 0, 2e-9)
    close(singleLinePhos(0.021, G), WORKED.c_W1_ReH, 1e-9)
    close(G(0.021).re, WORKED.c_ReH_84MHz, 1e-9)
    // λ_0 = 0（共模）、λ_{8−m} = conj(λ_m)
    expect(lam[0]).toEqual({ re: 0, im: 0 })
    for (let m = 1; m <= 3; m++) {
      close(lam[8 - m].re, lam[m].re, 0, 1e-12)
      close(lam[8 - m].im, -lam[m].im, 0, 1e-12)
    }
    for (const line of WORKED.c_lines as { l: number; w: number; ReH: number }[]) {
      close(64 * indicatorLineWeight(line.l), line.w, 1e-12)
      close(G(((line.l * 0.021) % 1) + (line.l < 0 ? 1 : 0)).re, line.ReH, 1e-8)
    }
  })

  it('SSPLL: 手算例 L2、α = 0.137：GOS 的 12C = 1.0259（β = 0.096，基波 384 MHz 在帶外）', () => {
    const G = gammaEff(LOOPS.L2)
    close(12 * gosHarmonic(0.137, G), WORKED.d_12C, 0, 2e-9)
    let partial = 0
    for (const t of WORKED.d_terms as { m: number; w: number; ReH: number; contrib: number }[]) {
      close(1 / (2 * Math.PI ** 2 * t.m * t.m), t.w, 1e-12)
      close(G((t.m * WORKED.d_beta) % 1).re, t.ReH, 1e-8)
      partial += t.contrib
    }
    close(12 * partial, WORKED.d_partial5_12C, 1e-9)
    // 精確週期（α = 137/1000）與 ergodic 一致
    close(12 * cPeriodic(137, 1000, G).C[0][0], PARAMS.offset.points['L2|137/1000|u=25'].twelveC, 1e-9)
  })

  it('SSPLL: ergodic κ（PHOS 最小模態、mode-1、單線近似、GOS 12C）與 pred_vs_sim.json 的選定 α 一致', () => {
    for (const k of KEYS) {
      for (const row of PRED.selected[k] as Json[]) {
        const a = analyseAlpha(LOOPS[k], row.alpha)
        // JSON 存 6 位有效數字（首位為 1 時相對捨入誤差可達 5e-6）
        close(a.kappaPhos, row.kP_8lam_ergodic, 6e-6, 2e-9)
        close(a.kappaM[0].re, row.kP_m1_ergodic, 6e-6, 2e-9)
        close(a.singleLine, row.kP_single_line, 6e-6, 2e-9)
        close(a.kappaGos, row.kG_12C_ergodic, 6e-6, 2e-9)
        expect(a.m1Lower).toBeLessThanOrEqual(a.kappaM[0].re + 1e-9)
        expect(a.m1Upper).toBeGreaterThanOrEqual(a.kappaM[0].re - 1e-9)
      }
    }
  })

  it('SSPLL: sign map（signmap_L*.json，α = (2j−1)/8000）：ergodic 與精確週期的 κ_m、κ_PHOS、κ_GOS 都一致', () => {
    for (const k of KEYS) {
      const g = MAP[k]
      // ergodic（無理數極限）公式假設各譜線不重疊；只取 Q = 8000（2j − 1 與 8000 互質）的格點比對，
      // 小 Q（例如 j = 988 ⇒ α = 79/320）的譜線會相干疊加，要用下面的精確週期算法。
      for (const j of [1, 9, 16, 30, 40, 67, 84, 100, 124, 136, 300, 549, 987, 1000, 1500, 1984, 2000]) {
        expect((2 * j - 1) % 5).not.toBe(0)
        const i = j - 1
        const alpha = (2 * j - 1) / 8000
        close(g.f_MHz[i], alpha * MHZ, 1e-12)
        const a = analyseAlpha(LOOPS[k], alpha)
        const tol = [6e-4, 3e-6] as const
        close(a.kappaM[0].re, g.km1_re[i], ...tol)
        close(a.kappaM[1].re, g.km2_re[i], ...tol)
        close(a.kappaM[2].re, g.km3_re[i], ...tol)
        close(a.kappaM[3].re, g.km4_re[i], ...tol)
        close(a.kappaM[0].im, g.km1_im[i], ...tol)
        close(a.kappaM[1].im, g.km2_im[i], ...tol)
        close(a.kappaM[2].im, g.km3_im[i], ...tol)
        close(a.kappaPhos, g.kP[i], ...tol)
        close(a.kappaGos, g.kG[i], ...tol)
      }
      for (const j of [1, 30, 84, 136, 548, 988, 1984]) {
        const i = j - 1
        const [P, Q] = limitDenominator((2 * j - 1) / 8000, 8000)
        expect(Q % 8).toBe(0)
        const r = kappaRational(LOOPS[k], P, Q)
        const tol = [6e-4, 1e-9] as const
        close(r.kP, g.kP[i], ...tol)
        close(r.kG, g.kG[i], ...tol)
        close(r.km[0].re, g.km1_re[i], ...tol)
        close(r.km[3].re, g.km4_re[i], ...tol)
        close(r.refP, 1 / 8, 1e-12)
        expect(r.coupling).toBeLessThan(1e-12) // 8 | Q：GOS–PHOS 精確解耦
      }
    }
  })

  it('SSPLL: 對策欄位（1diff、fx、D = 1、2diff、P-only）的 κ 與 signmap 一致；1diff／fx 不反號', () => {
    for (const k of KEYS) {
      const g = MAP[k]
      const fx = { exact: LOOPS[k] }
      const ponly = k === 'L2' ? makePOnlyL2(LOOPS.L2) : k === 'L3' ? makePOnlyL3(LOOPS.L3) : null
      for (const j of [2, 20, 84, 250, 987]) {
        const i = j - 1
        const alpha = (2 * j - 1) / 8000
        const tol = [6e-4, 3e-6] as const
        const d1 = analyseAlpha(LOOPS[k], alpha, '1diff')
        close(d1.kappaPhos, g.kP_1diff[i], ...tol)
        close(d1.kappaGos, g.kG_1diff[i], ...tol)
        expect(d1.kappaPhos).toBeGreaterThan(0)
        const f = analyseAlpha(LOOPS[k], alpha, 'fx:exact', fx)
        close(f.kappaPhos, g.kP_fx[i], ...tol)
        close(f.kappaGos, g.kG_fx[i], ...tol)
        expect(f.kappaPhos).toBeGreaterThan(0)
        const D = analyseAlpha(LOOPS[k], alpha, 'D:1')
        close(D.kappaPhos, g.kP_D1[i], ...tol)
        close(D.kappaGos, g.kG_D1[i], ...tol)
        close(analyseAlpha(LOOPS[k], alpha, '2diff').kappaPhos, g.kP_2diff[i], ...tol)
        if (ponly) {
          const p = analyseAlpha(ponly, alpha)
          close(p.kappaPhos, g.kP_Ponly[i], ...tol)
          close(p.kappaGos, g.kG_Ponly[i], ...tol)
        }
      }
    }
  })

  it('SSPLL: mode-1 嚴格界限——一定反號 L2 32.68–125.33 MHz、L3 27.72–105.09 MHz；超過 136.38／118.78 MHz 不可能', () => {
    for (const k of ['L2', 'L3'] as const) {
      const g = PARAMS.mode1_sure[k]
      const m = mode1SureBand(LOOPS[k])
      close(m.thresholdReH, g.threshold_ReH, 1e-6)
      close(m.maxReH, g.max_ReH, 1e-7)
      close(m.minReH, g.min_ReH, 1e-7)
      expect(m.sure).not.toBeNull()
      close(m.sure![0] * MHZ, g.sure_MHz[0], 0, 0.01)
      close(m.sure![1] * MHZ, g.sure_MHz[1], 0, 0.01)
      close(m.impossibleAbove * MHZ, g.impossible_above_MHz, 0, 0.01)
    }
    close(mode1SureBand(LOOPS.L2).sure![0] * MHZ, 32.68, 0, 6e-3)
    close(mode1SureBand(LOOPS.L2).sure![1] * MHZ, 125.33, 0, 6e-3)
    close(mode1SureBand(LOOPS.L3).sure![0] * MHZ, 27.72, 0, 6e-3)
    close(mode1SureBand(LOOPS.L3).sure![1] * MHZ, 105.09, 0, 6e-3)
    const m1 = mode1SureBand(LOOPS.L1)
    expect(m1.sure).toBeNull()
    expect(m1.impossibleAbove).toBe(0)
    // 帶內的 α 上界 < 0；帶外（> 136.38 MHz）下界 ≥ 0
    expect(phosM1Bounds(LOOPS.L2, 84e6 / F_REF).upper).toBeLessThan(0)
    expect(phosM1Bounds(LOOPS.L2, 140e6 / F_REF).lower).toBeGreaterThan(0)
  })
})

describe('SSPLL 精確週期（有理數 α）、9×9 耦合與 PSD 定理', () => {
  it('SSPLL: α = 1/50（8 ∤ Q）：8λ_min = −0.1385（理想正規化）與 −0.1443（開迴路參考 0.12）；GOS–PHOS 有耦合', () => {
    const row = (PRED.selected.L2 as Json[]).find((r) => r.alpha === 0.02)
    const r = kappaRational(LOOPS.L2, 1, 50)
    close(8 * r.phosMinRe, row.kP_8lam_rational, 3e-6)
    close(r.refP, 0.12, 1e-12)
    close(r.kP, -0.1443, 0, 6e-5)
    // 文件的「12C = 1.1086」是 12·C_GOS；κ_GOS = C_GOS/var(ρ)，Q = 50 時 var(ρ) = (1 − 1/25²)/12
    close(r.varRho, (1 - 1 / 625) / 12, 1e-12)
    close(12 * r.kG * r.varRho, 1.1086, 0, 6e-5)
    close(r.coupling, DOC.joint.decoupling_L2['1/50'].max_abs_C0k ?? r.coupling, 1e-6)
    close(r.coupling, 7.8e-3, 0, 6e-5)
    expect(kappaRational(LOOPS.L1, 1, 50).kP).toBeGreaterThan(0)
    expect(kappaRational(LOOPS.L3, 1, 50).kP).toBeLessThan(0)
  })

  it('SSPLL: PE failure——α = 1/4 只走訪 4 相、α = 1/2 只走訪 2 相；α = k/8 時 GOS 不可觀測', () => {
    expect(kappaRational(LOOPS.L2, 1, 4).phosNObs).toBe(3)
    expect(kappaRational(LOOPS.L2, 1, 2).phosNObs).toBe(1)
    const r8 = kappaRational(LOOPS.L2, 1, 8)
    expect(r8.varRho).toBe(0)
    expect(Number.isNaN(r8.kG)).toBe(true)
    expect(gosHarmonic(3 / 8, gammaEff(LOOPS.L2))).toBe(0)
  })

  it('SSPLL: PSD 定理——Re Γ_eff ≥ 0（1diff、fx exact）⇒ joint 9×9 的 Re eig ≥ 0，對任何有理 α（含 8 ∤ Q）', () => {
    for (const k of ['L2', 'L3'] as const) {
      const fx = { exact: LOOPS[k] }
      for (const [P, Q] of [
        [1, 50],
        [12, 383],
        [5, 163],
        [21, 1000],
        [15, 59],
        [13, 53],
        [2, 7],
      ]) {
        expect(kappaRational(LOOPS[k], P, Q, '1diff').kJ).toBeGreaterThan(-1e-10)
        expect(kappaRational(LOOPS[k], P, Q, 'fx:exact', fx).kJ).toBeGreaterThan(-1e-10)
      }
    }
    // raw 在 alias 區的 8 ∤ Q 有理數可以反號（L2，α = 15/59：−0.0085）
    close(kappaRational(LOOPS.L2, 15, 59).kP, -0.0085, 0, 6e-5)
  })

  it('SSPLL: GOS near-grid 漸近式：Type-II D = 0 ⇒ β²/K_i（dead zone，仍為正）；D = 1 ⇒ ≈ −β（反號）', () => {
    for (const k of KEYS) {
      for (const g of PARAMS.gos_small_beta[k] as Json[]) {
        const P = g.P
        const G0 = gammaEff(LOOPS[k])
        const G1 = gammaEff(LOOPS[k], 'D:1')
        // α = (1 + β)/8 = (P + 1)/(8P)
        close(cPeriodic(P + 1, 8 * P, G0).C[0][0], g.C_D0, 1e-8, 1e-13)
        close(cPeriodic(P + 1, 8 * P, G1).C[0][0], g.C_D1, 1e-8, 1e-13)
        close(gosRationalBeta(G0, 1, P), g.C_D0, 1e-8, 1e-13)
        close(gosSmallBeta(LOOPS[k], g.beta, 0), g.asym_D0, 1e-6)
        close(gosSmallBeta(LOOPS[k], g.beta, 1), g.asym_D1, 1e-6)
      }
    }
    const rows = PARAMS.gos_small_beta.L2 as Json[]
    expect(rows.every((g) => g.C_D0 > 0 && g.C_D1 < 0)).toBe(true)
  })

  it('SSPLL: GOS 猜想（D = 0 不反號）在小範圍掃描沒有反例；β = 1/400 時 12C 與 golden 一致', () => {
    for (const k of KEYS) {
      const G = gammaEff(LOOPS[k])
      const g = PARAMS.gos_rational_scan[k]
      close(12 * gosRationalBeta(G, 1, 400), g.min_12C, 1e-8)
      const s = gosConjectureScan(G, 80)
      expect(s.nNegative).toBe(0)
      expect(s.min12C).toBeGreaterThan(0)
      expect(s.at).toEqual([1, 80])
    }
    // D = 1 立刻出現反例
    expect(gosConjectureScan(gammaEff(LOOPS.L2, 'D:1'), 40).nNegative).toBeGreaterThan(0)
  })
})

describe('SSPLL 對策的 kernel', () => {
  it('SSPLL: 一階差分 Re Γ ≥ 0（margin 0.3888／0.2686／0.2698，disc constant 0.403／0.423／0.459）', () => {
    for (const k of KEYS) {
      const g = PARAMS.remedy_kernels[k]
      expect(kernelMin(LOOPS[k], '1diff').min).toBeGreaterThan(-1e-12)
      close(oneDiffMargin(LOOPS[k]).min, g.one_diff_margin, 2e-6)
      close(discConstant(LOOPS[k], '1diff'), g.disc_const_1diff, 1e-5)
      close(kernelMin(LOOPS[k], 'raw').min, Math.min(g.raw, 0), 1e-6, 1e-9)
    }
    const Kp = Number(LOOPS.L2.params.Kp)
    const Ki = Number(LOOPS.L2.params.Ki)
    close(Kp - Ki / 2, PARAMS.remedy_kernels.typeII_closed.Kp_minus_Ki_over_2, 1e-8)
    close(oneDiffMargin(LOOPS.L2).min, Kp - Ki / 2, 1e-6)
    expect(Ki <= 2 * Kp && Kp + Ki / 2 <= 2).toBe(true)
    // 1diff 低頻是 Ω⁴（raw 是 Ω²）
    const G = gammaEff(LOOPS.L2, '1diff')
    close(Math.log(G(2e-4).re / G(1e-4).re) / Math.log(2), 4, 1e-3)
  })

  it('SSPLL: 1diff 的保證依賴迴路——L1 延遲 2–4 拍仍安全，延遲 5 拍（PM 27°）margin 為負、帶內的 α 反號（TS port 的補充計算）', () => {
    const margins = [2, 3, 4, 5].map((d) => oneDiffMargin(makeL1({ lat: d })).min)
    expect(margins[0]).toBeGreaterThan(0.2)
    expect(margins[1]).toBeGreaterThan(0.1)
    expect(margins[2]).toBeGreaterThan(0)
    expect(margins[3]).toBeLessThan(-0.05)
    const lat5 = makeL1({ lat: 5 })
    const k = kernelMin(lat5, '1diff')
    expect(k.min).toBeLessThan(-0.1)
    expect(k.negFMax! * MHZ).toBeGreaterThan(400)
    // margin 的符號與 kernel 的符號一致：Re Γ_1d = g(Ω)/|1 + L|²
    for (const d of [2, 3, 4]) expect(kernelMin(makeL1({ lat: d }), '1diff').min).toBeGreaterThan(-1e-12)
    // closed form（Type-I、延遲 d 拍）：(1 − z⁻¹)L = K z^-d ⇒ g(Ω) = 1 − cos Ω + K cos(dΩ)；d = 1 時 g ≥ K
    for (const d of [1, 2, 3, 4, 5]) {
      const lp = makeL1({ lat: d })
      const K = Number(lp.params.K)
      let gMin = Infinity
      for (let i = 0; i <= 400000; i++) {
        const W = (Math.PI * i) / 400000
        gMin = Math.min(gMin, 1 - Math.cos(W) + K * Math.cos(d * W))
      }
      close(oneDiffMargin(lp).min, gMin, 0, 2e-7)
      if (d === 1) close(gMin, K, 1e-12)
      // 充分條件：K > 1 − cos(π/d) ⇒ g(π/d) < 0
      if (K > 1 - Math.cos(Math.PI / d)) expect(gMin).toBeLessThan(0)
    }
    // 審查時以 golden 的 loops.py（make_L1(lat=5)）獨立重算：margin −0.0789、min Re Γ_1d = −0.1717 @ 286.6 MHz
    close(margins[3], -0.0789, 0, 1e-4)
    close(k.min, -0.1717, 0, 1e-4)
    close(k.fAtMin * MHZ, 286.6, 0, 0.1)
    // PMUX 旋轉頻率落在 Re Γ_1d < 0 的頻率時，1diff 的 PHOS mode-1 反號
    const a = analyseAlpha(lat5, k.fAtMin, '1diff')
    expect(a.kappaM[0].re).toBeLessThan(-0.05)
    expect(a.m1Upper).toBeLessThan(0)
    // 其他變形（寄生極點、L2 延遲 2 拍、L3 的 halfT／zoh 映射、PM 30°）都安全
    for (const lp of [makeL1({ fPoleHz: 200e6 }), makeL2({ lat: 2 }), makeL2({ pm: 30 }), makeL3({ mapping: 'halfT' }), makeL3({ mapping: 'zoh' }), makeL3({ pmCt: 45 })]) {
      expect(oneDiffMargin(lp).min, lp.name).toBeGreaterThan(0.1)
      expect(kernelMin(lp, '1diff').min, lp.name).toBeGreaterThan(-1e-12)
    }
  })

  it('SSPLL: filtered-x：exact 模型 Re Γ = |H|² ≥ 0；Type-I 模型需 K̂ > 1/(Kp/Ki + ½) = 0.1247', () => {
    const F = PARAMS.remedy_kernels.fx_typeI_model
    const Kp = Number(LOOPS.L2.params.Kp)
    const Ki = Number(LOOPS.L2.params.Ki)
    close(1 / (Kp / Ki + 0.5), F.K_hat_critical, 1e-8)
    for (const k of KEYS) expect(kernelMin(LOOPS[k], 'fx:exact', { exact: LOOPS[k] }).min).toBeGreaterThan(-1e-12)
    for (const kh of [0.389, 0.2, 0.13]) expect(kernelMin(LOOPS.L2, 'fx:m', { m: makeL1({ K: kh }) }).min).toBeGreaterThan(-1e-12)
    for (const kh of [0.12, 0.1, 0.05]) {
      const g = F[`K_hat=${kh}`]
      const r = kernelMin(LOOPS.L2, 'fx:m', { m: makeL1({ K: kh }) })
      close(r.min, g.min, 2e-3)
      expect(r.negFMax).not.toBeNull()
      close(r.negFMax! * MHZ, g.neg_up_to_MHz, 0, 0.03)
    }
    // 臨界值是「保證」的界線：K̂ = 0.1 時 kernel 有負值，但 PHOS 的 κ（ergodic）在 10.5–199.5 MHz 仍全為正；K̂ = 0.05 才在 54.5–87.5 MHz 反號
    const scan = (kh: number): { min: number; fMin: number; neg: number[] } => {
      const G = gammaEff(LOOPS.L2, 'fx:m', { m: makeL1({ K: kh }) })
      let min = Infinity
      let fMin = 0
      const neg: number[] = []
      for (let f = 10.5; f < 200; f += 1) {
        const lam = phosLambdaHarmonic(f / MHZ, G, 1024)
        const kP = 8 * Math.min(lam[1].re, lam[2].re, lam[3].re, lam[4].re)
        if (kP < min) {
          min = kP
          fMin = f
        }
        if (kP < 0) neg.push(f)
      }
      return { min, fMin, neg }
    }
    expect(scan(0.12).neg).toEqual([])
    expect(scan(0.1).neg).toEqual([])
    expect(scan(0.1).min).toBeGreaterThan(1e-3)
    const s05 = scan(0.05)
    expect(s05.neg[0]).toBe(54.5)
    expect(s05.neg[s05.neg.length - 1]).toBe(87.5)
    expect(s05.neg.length).toBe(34) // 連續區間
    close(s05.min, -0.0153, 0, 2e-4)
    close(s05.fMin, 71.5, 0, 1e-9)
    // M = 1024 的掃描與完整的 analyseAlpha（M = 8192）一致
    close(analyseAlpha(LOOPS.L2, 71.5 / MHZ, 'fx:m', { m: makeL1({ K: 0.05 }) }).kappaPhos, s05.min, 0, 2e-5)
  })

  it('SSPLL: 有害的變形——D = ±1（min Re Γ = −H(½) = −1.1812／−1.0853）與二階差分（−0.2776／−0.4143）', () => {
    for (const k of KEYS) {
      const g = PARAMS.remedy_kernels[k]
      close(kernelMin(LOOPS[k], 'D:1').min, g['D:1'], 1e-6)
      close(kernelMin(LOOPS[k], 'D:-1').min, g['D:-1'], 1e-6)
      close(kernelMin(LOOPS[k], '2diff').min, g['2diff'], 1e-6)
      close(loopH(LOOPS[k], 0.5).re, g.H_half, 1e-9)
    }
    const Kp = Number(LOOPS.L2.params.Kp)
    const Ki = Number(LOOPS.L2.params.Ki)
    close(-1 / (1 - (Kp + Ki / 2) / 2), PARAMS.remedy_kernels.typeII_closed.D1_min_closed, 1e-8)
    // variantG：D:1 = z⁻¹、1diff = 1 − z⁻¹
    const g = variantG('D:1', 0.25)
    close(g.re, 0, 0, 1e-15)
    close(g.im, -1, 1e-15)
    expect(() => variantG('nope', 0.1)).toThrow(/未知的 regressor 變體/)
    expect(() => variantG('fx:missing', 0.1)).toThrow(/找不到模型/)
  })

  it('SSPLL: 有限步長——帶緣附近 Re κ → 0⁺ 而 Im κ ≈ 0.65，N_τ = 25 時不穩定（Re κ ≤ |κ|²/(2N_τ)）', () => {
    const ex = PARAMS.remedy_kernels.finite_mu['L2|tau25'].examples[0] as [number, [number, number]]
    // 127.0 MHz ≈ 130/4096·f_ref
    const r = kappaRational(LOOPS.L2, 65, 2048)
    close(r.km[0].re, ex[1][0], 0, 6e-5)
    close(r.km[0].im, ex[1][1], 0, 6e-5)
    expect(r.km[0].re).toBeGreaterThan(0)
    expect(blockMeanStable([r.km[0]], 25)).toBe(false)
    expect(blockMeanStable([r.km[0]], 50)).toBe(true)
    expect(blockMeanStable([{ re: 1, im: 0 }], 25)).toBe(true)
    expect(blockMeanStable([{ re: -0.1, im: 0 }], 25)).toBe(false)
  })
})

describe('SSPLL 比較器 offset、序列與大訊號', () => {
  it('SSPLL: offset 是 forcing 項：u_os = 25 fs ⇒ E[q] = 0.0995，L2 α = 0.137 的 raw GOS 偏差 −145.8 fs', () => {
    const g = PARAMS.offset.points['L2|137/1000|u=25']
    close(eqOffset(25, 200), g.Eq, 1e-10)
    close(kqOffset(25, 200) / kqGain(200), g.Kq_ratio, 1e-10)
    close(kqGain(200), WORKED.g_Kq_per_fs, 1e-10)
    const c = cPeriodic(137, 1000, gammaEff(LOOPS.L2))
    close(c.mean[0], g.rho_mean, 1e-12)
    // 偏差的單位：以 Δ 為單位的 GOS 誤差 × Δ（7812.5 fs）＝ code 1 時的 fs
    close(gosOffsetBias(c.C[0][0], c.mean[0], 25, 200), g.gos_bias_raw_fs, 1e-6)
    const g2 = PARAMS.offset.points['L2|123/1000|u=25']
    const c2 = cPeriodic(123, 1000, gammaEff(LOOPS.L2))
    close(12 * c2.C[0][0], g2.twelveC, 1e-8)
    close(gosOffsetBias(c2.C[0][0], c2.mean[0], 25, 200), g2.gos_bias_raw_fs, 1e-6)
  })

  it('SSPLL: 分數相位序列：α = 0.137 的 p[n]、ρ[n] 手算表；32-bit 累加器與精確有理序列一致', () => {
    const s = phaseSequence(0.137, 10, 'right')
    expect(s.p).toEqual(WORKED.i_p_0137)
    s.rho.forEach((v, i) => close(v, WORKED.i_rho_0137[i], 0, 1e-12))
    const acc = phaseSequence(0.137, 2000, 'acc32')
    const rat = phaseSequence(0.137, 2000, 'right')
    expect(acc.p).toEqual(rat.p)
    acc.rho.forEach((v, i) => close(v, rat.rho[i], 0, 2e-5))
    expect(limitDenominator(0.02, 65536)).toEqual([1, 50])
    expect(limitDenominator(0.137, 65536)).toEqual([137, 1000])
    expect(limitDenominator(167 / 8000, 8000)).toEqual([167, 8000])
    expect(limitDenominator(Math.PI, 1000)).toEqual([355, 113])
    expect(accSide(0.125)).toBe('right')
    // 變體的時域定義：1diff[n] = x[n] − x[n−1]；D:1[n] = x[n−1]
    const raw = regressorRows(0.137, 'raw', 50)
    const d1 = regressorRows(0.137, '1diff', 50)
    const dl = regressorRows(0.137, 'D:1', 50)
    const d2 = regressorRows(0.137, '2diff', 50)
    const zm = regressorRows(0.137, 'zm', 50)
    for (let n = 2; n < 50; n++) {
      for (let i = 0; i < 9; i++) {
        close(d1[n * 9 + i], raw[n * 9 + i] - raw[(n - 1) * 9 + i], 0, 1e-15)
        close(dl[n * 9 + i], raw[(n - 1) * 9 + i], 0, 1e-15)
        close(d2[n * 9 + i], raw[n * 9 + i] - 2 * raw[(n - 1) * 9 + i] + raw[(n - 2) * 9 + i], 0, 1e-15)
        close(zm[n * 9 + i], raw[n * 9 + i] - (i === 0 ? 0.5 : 0.125), 0, 1e-15)
      }
    }
    // filtered-x（exact 模型）：r = h_PD * x
    const fx = regressorRows(0.137, 'fx:m', 40, 'acc32', { m: LOOPS.L2 })
    const h = loopImpulse(LOOPS.L2, 40)
    for (const n of [0, 5, 39]) {
      let acc0 = 0
      for (let m = 0; m <= n; m++) acc0 += h[m] * raw[(n - m) * 9]
      close(fx[n * 9], acc0, 1e-10, 1e-12)
    }
  })

  it('SSPLL: 大訊號 κ_∞（1-bit 相關看「持續時間」）與 signmap 的 LSinf／LSinf_ac 一致', () => {
    for (const k of KEYS) {
      const g = MAP[k]
      for (const j of [16, 84, 492, 548, 988]) {
        const i = j - 1
        const [P, Q] = limitDenominator((2 * j - 1) / 8000, 8000)
        close(kappaInfWorst(largeSignalPeriodic(LOOPS[k], P, Q, CFG, 'raw')), g.LSinf[i], 2e-4, 2e-4)
        close(kappaInfWorst(largeSignalPeriodic(LOOPS[k], P, Q, CFG, 'ac')), g.LSinf_ac[i], 2e-4, 2e-4)
      }
    }
    // 1diff：大訊號也不反向（L2，84 MHz）
    const [P, Q] = limitDenominator(167 / 8000, 8000)
    expect(kappaInfWorst(largeSignalPeriodic(LOOPS.L2, P, Q, CFG, '1diff'))).toBeGreaterThan(0)
    expect(kappaInfWorst(largeSignalPeriodic(LOOPS.L2, P, Q, CFG, 'raw'))).toBeLessThan(-0.3)
  })
})

describe('SSPLL 閉迴路 sign-error LMS（真 1-bit 比較器）', () => {
  const common = { alpha: 0.02, cfg: CFG, nBlocks: 600, nBlk: 512, tauBlocks: 25, seed: 3, recEvery: 20, lanes: 1 }

  it('SSPLL: L2、α = 0.02（80 MHz，帶內）：raw 發散、一階差分收斂；初始誤差 173.3 fs／234.4 fs', () => {
    const raw = runSspllLms({ ...common, loop: LOOPS.L2, variant: 'raw' })
    const d1 = runSspllLms({ ...common, loop: LOOPS.L2, variant: '1diff' })
    const g = PRED.lms['L2|0.02|raw']
    close(raw.initPhosRmsFs, g.init_phos_rms_fs, 0, 0.05)
    close(raw.gosAbsFs[0], g.gos_med_fs[0], 0, 0.05)
    expect(raw.block[0]).toBe(0)
    expect(raw.block[raw.block.length - 1]).toBe(600)
    // golden（6000 blocks、2 lanes）在第 600 block 的中位數：raw 1832 fs、1diff 5.4 fs
    expect(raw.finalPhosRmsFs).toBeGreaterThan(800)
    expect(raw.finalPhosRmsFs).toBeLessThan(4000)
    expect(raw.finalPhosRmsFs).toBeGreaterThan(raw.phosRmsFs[10])
    expect(d1.finalPhosRmsFs).toBeLessThan(25)
    expect(d1.finalGosFs).toBeLessThan(30)
    expect(d1.maxPhosRmsFs).toBeLessThan(180)
    expect(raw.aborted || d1.aborted).toBe(false)
    expect(raw.samples).toBe(4096 + 600 * 512)
    // zero-mean 的 1diff：PHOS 共模不漂移
    expect(d1.finalPhosCmFs).toBeLessThan(1e-6)
  })

  it('SSPLL: 同一 seed 可重現；L1（Type-I）在同一個 α 用 raw 也收斂；filtered-x（exact）收斂', () => {
    const a = runSspllLms({ ...common, nBlocks: 200, loop: LOOPS.L2, variant: '1diff' })
    const b = runSspllLms({ ...common, nBlocks: 200, loop: LOOPS.L2, variant: '1diff' })
    expect(Array.from(a.phosRmsFs)).toEqual(Array.from(b.phosRmsFs))
    const c = runSspllLms({ ...common, nBlocks: 200, seed: 4, loop: LOOPS.L2, variant: '1diff' })
    expect(Array.from(c.phosRmsFs)).not.toEqual(Array.from(a.phosRmsFs))
    const cmp = runSspllLmsCompare({
      common,
      cases: [
        { id: 'L1 raw', loop: LOOPS.L1, variant: 'raw' },
        { id: 'L2 fx', loop: LOOPS.L2, variant: 'fx:exact', models: { exact: LOOPS.L2 } },
        { id: 'L2 P-only', loop: makePOnlyL2(LOOPS.L2), variant: 'raw' },
      ],
    })
    expect(cmp.cases.map((x) => x.id)).toEqual(['L1 raw', 'L2 fx', 'L2 P-only'])
    for (const x of cmp.cases) expect(x.result.finalPhosRmsFs).toBeLessThan(40)
  })

  it('SSPLL: 比較器 offset u_os = 25 fs：raw 的 PHOS 共模一直漂移，zm／1diff 不漂移', () => {
    const base = { ...common, alpha: 0.137, nBlocks: 400, uOsPs: 0.025, loop: LOOPS.L2 }
    const raw = runSspllLms({ ...base, variant: 'raw' })
    const zm = runSspllLms({ ...base, variant: 'zm' })
    const d1 = runSspllLms({ ...base, variant: '1diff' })
    expect(raw.finalPhosCmFs).toBeGreaterThan(100)
    expect(raw.finalGosFs).toBeGreaterThan(60)
    expect(zm.finalPhosCmFs).toBeLessThan(1e-6)
    expect(d1.finalPhosCmFs).toBeLessThan(1e-6)
    expect(zm.finalGosFs).toBeLessThan(40)
    expect(zm.finalPhosRmsFs).toBeLessThan(20)
  })
})
