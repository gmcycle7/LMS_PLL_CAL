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
  analyseC,
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
  loopPoles,
  loopStable,
  loopSummary,
  loopT,
  lowFreqReHCoeff,
  makeL1,
  makeL2,
  makeL3,
  makeLoop,
  makePOnlyL2,
  makePOnlyL3,
  mode1SureBand,
  nominalLoops,
  oneDiffMargin,
  phaseSequence,
  phosLambdaHarmonic,
  phosM1Bounds,
  physicalMix,
  regressorRows,
  phosDft,
  phosModeNoise,
  phosSteadyState,
  residualLineSpectrum,
  runSspllLms,
  runSspllLmsCompareSpectrum,
  runSspllLmsWithSpectrum,
  spurBetaFromToneFs,
  spurDbcFromToneFs,
  staircaseLineAmplitude,
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
import { timeConstantBlocks } from './optimizer'
import { spurBeta, spurDbcSmallAngle } from './calNoise'
import { toneFit } from '@/simulation/signal/psd'

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
      // 只取 Q = 8000（2j − 1 不是 5 的倍數）的格點比對 ergodic 值：signmap 的 kG 是 C_GOS/var(ρ)，var(ρ) = (b² − 1)/(12b²)（b = Q/8），
      // 而 ergodic 的 kappaGos 是 12·C_GOS——C_GOS 相同，兩者差 b²/(b² − 1) 倍（b = 1000 時 1e-6；j = 988 ⇒ Q = 320、b = 40 時 6e-4）。
      // ergodic 的級數截在 8192 項，小 Q 時另有尾項近似的誤差。小 Q 的格點用下面的精確週期算法。
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

  it('SSPLL: mode-1 的界限夾的是 Re κ₁，不是 |κ₁|——審查反例 Type-I K = 0.5、α = 1/8：κ₁ = 0.80926 + 0.65124j', () => {
    // 合法的 Type-I 迴路（單一極點 0.5）；Q = 8，occupancy 均勻。用精確週期解（ergodic 的尾項近似在 Q = 8 會差 2e-5）
    const T = makeL1({ K: 0.5 })
    const r = kappaRational(T, 1, 8)
    const H = loopH(T, 1 / 8)
    close(r.km[0].re, 0.8092564302, 0, 1e-9)
    close(r.km[0].im, 0.6512392831, 0, 1e-9)
    close(r.km[0].re, H.re, 0, 1e-12) // Q = 8：mode-1 的所有譜線都折到 α 上，κ₁ = H_PD(α)
    close(r.km[0].im, H.im, 0, 1e-12)
    // λ_{8−m} = conj(λ_m)；m = 4 是實數
    close(r.km[6].re, r.km[0].re, 0, 1e-12)
    close(r.km[6].im, -r.km[0].im, 0, 1e-12)
    close(r.km[3].re, 4 / 3, 0, 1e-9)
    close(r.km[3].im, 0, 0, 1e-12)
    const b = phosM1Bounds(T, 1 / 8)
    close(b.lower, 0.7685032503, 0, 1e-8)
    close(b.upper, 0.8356483123, 0, 1e-8)
    // 實部在界限內；模（1.0388）在界限外——所以 F-CS.14 寫的是 Re κ₁
    expect(b.lower).toBeLessThanOrEqual(r.km[0].re)
    expect(r.km[0].re).toBeLessThanOrEqual(b.upper)
    const mod = Math.hypot(r.km[0].re, r.km[0].im)
    close(mod, 1.0387533748, 0, 1e-9)
    expect(mod).toBeGreaterThan(b.upper)
    // 有限步長判據要代整個複數：門檻 |κ|²/(2 Re κ) = 1/(2 − K) = 2/3；只代實部會誤判
    close((r.km[0].re ** 2 + r.km[0].im ** 2) / (2 * r.km[0].re), 2 / 3, 0, 1e-12)
    expect(blockMeanStable([r.km[0]], 0.6)).toBe(false)
    expect(blockMeanStable([r.km[0]], 0.7)).toBe(true)
    expect(blockMeanStable([{ re: r.km[0].re, im: 0 }], 0.6)).toBe(true)
  })

  it('SSPLL: 正常對照 L2、α = 0.021：κ₁ = −0.13953 + 0.31158j，κ_PHOS 是它的實部，界限 [−0.2053, −0.1355] 夾住實部', () => {
    const a = analyseAlpha(LOOPS.L2, 0.021)
    close(a.kappaM[0].re, -0.139527, 0, 1e-5)
    close(a.kappaM[0].im, 0.311576, 0, 1e-5)
    close(a.kappaM[6].re, a.kappaM[0].re, 0, 1e-12)
    close(a.kappaM[6].im, -a.kappaM[0].im, 0, 1e-12)
    expect(a.kappaPhos).toBe(a.kappaM[0].re)
    close(a.m1Lower, -0.205292, 0, 1e-5)
    close(a.m1Upper, -0.135469, 0, 1e-5)
    expect(a.m1Lower).toBeLessThanOrEqual(a.kappaM[0].re)
    expect(a.kappaM[0].re).toBeLessThanOrEqual(a.m1Upper)
    expect(a.m1Upper).toBeLessThan(0)
    close(Math.hypot(a.kappaM[0].re, a.kappaM[0].im), 0.34139, 0, 1e-5)
  })

  it('SSPLL: κ_GOS = C_GOS/var(ρ) 與 12·C_GOS 不同——審查反例 Type-I K = 0.5、α = 1/16：C = 1/12、var(ρ) = 1/16 ⇒ 4/3 對 1', () => {
    const L = makeL1({ K: 0.5 })
    const G = gammaEff(L)
    close(loopH(L, 0).re, 0, 0, 1e-12)
    close(loopH(L, 0.5).re, 4 / 3, 0, 1e-12)
    // β = 1/2：ρ 在 0 與 1/2 之間交替
    const c = cPeriodic(1, 16, G)
    close(c.C[0][0], 1 / 12, 0, 1e-12)
    close(c.cov[0][0], 1 / 16, 0, 1e-15)
    close(c.mean[0], 1 / 4, 0, 1e-15)
    const r = kappaRational(L, 1, 16)
    close(r.kG, 4 / 3, 0, 1e-12)
    close(r.varRho, 1 / 16, 0, 1e-15)
    close(12 * r.kG * r.varRho, 1, 0, 1e-12)
    close(12 * gosRationalBeta(G, 1, 2), 1, 0, 1e-12)
    // ergodic 的 12C（級數截在 8192 項，β = 1/2 時尾項近似差 2.5e-5）
    const erg = analyseAlpha(L, 1 / 16).kappaGos
    close(erg, 1, 0, 5e-5)
    expect(r.kG - erg).toBeGreaterThan(0.3)
  })

  it('SSPLL: 有理數 β = a/b 的 var(ρ) = (b² − 1)/(12b²)；C_GOS 相同，κ_GOS = [b²/(b² − 1)]·12C（b = 2 是 4/3 倍，b = 1000 只差 1e-6）', () => {
    const G = gammaEff(LOOPS.L2)
    for (const [P, Q] of [
      [1, 16],
      [1, 24],
      [5, 64],
      [9, 80],
      [137, 1000],
      [1097, 8000],
    ]) {
      const b = Q / 8
      const r = kappaRational(LOOPS.L2, P, Q)
      const erg = analyseAlpha(LOOPS.L2, P / Q).kappaGos
      close(r.varRho, (b * b - 1) / (12 * b * b), 0, 1e-12)
      close(12 * r.kG * r.varRho, 12 * gosRationalBeta(G, P % b, b), 0, 1e-10) // 同一個 C_GOS（精確週期解 vs 有理 β 的線公式）
      close(12 * r.kG * r.varRho, erg, 0, 5e-5) // 與 ergodic 諧波和也是同一個 C（差在尾項近似：b = 2 時 3.0e-5）
      close(r.kG / erg, (b * b) / (b * b - 1), 1e-4)
    }
    // 釘住兩個小 b 的數值（L2）
    const r16 = kappaRational(LOOPS.L2, 1, 16)
    close(r16.kG, 1.1812259, 0, 1e-6)
    close(12 * r16.kG * r16.varRho, 0.8859194, 0, 1e-6)
    const r64 = kappaRational(LOOPS.L2, 5, 64)
    close(r64.kG, 1.1614281, 0, 1e-6)
    close(12 * r64.kG * r64.varRho, 1.1432807, 0, 1e-6)
    // 正常對照（長週期）：b = 1000 時兩個 κ 只差 1e-6；b = 125 時差 6.4e-5
    const long = kappaRational(LOOPS.L2, 1097, 8000)
    const ergLong = analyseAlpha(LOOPS.L2, 1097 / 8000).kappaGos
    close(long.varRho, 0.08333325, 0, 1e-12)
    close(long.kG, 1.0281187, 0, 1e-6)
    close(ergLong, 1.0281177, 0, 1e-6)
    expect(Math.abs(long.kG - ergLong)).toBeLessThan(2e-6)
    const r125 = kappaRational(LOOPS.L2, 137, 1000)
    close(r125.kG, 1.025977, 0, 1e-6)
    close(12 * r125.kG * r125.varRho, 1.0259113, 0, 1e-6)
    close(r125.kG / (12 * r125.kG * r125.varRho), 1.000064, 0, 1e-6)
  })

  it('SSPLL: 「H ≡ 1 時 κ_GOS = 1」的基準是去掉平均值的 ρ——保留 DC 時開迴路的 C = E[ρ²] ≈ 1/3（12C ≈ 4）', () => {
    const open = gammaEff(null, 'raw', undefined, true)
    // 只含 m ≥ 1 的諧波和：形式上代入 Γ ≡ 1 得到 1（沒有 DC 那一條）
    close(12 * gosHarmonic(0.137, open), 1, 1e-12)
    // 精確週期解包含 DC 線（Γ(0) = 1）：α = 1097/8000（b = 1000）⇒ C = E[ρ²] = (b − 1)(2b − 1)/(6b²)
    const c = cPeriodic(1097, 8000, open)
    close(c.C[0][0], (999 * 1999) / 6e6, 0, 1e-10)
    close(c.C[0][0], 0.3328335, 0, 1e-10)
    close(12 * c.C[0][0], 3.994002, 0, 1e-6)
    close(c.C[0][0] - c.mean[0] ** 2, c.cov[0][0], 0, 1e-12) // 去掉平均值之後才是 var(ρ)
    close(c.cov[0][0], 0.08333325, 0, 1e-12)
    // β = 1/2：C = E[ρ²] = 1/8、平均 1/4、var = 1/16
    const c2 = cPeriodic(1, 16, open)
    close(c2.C[0][0], 1 / 8, 0, 1e-15)
    close(c2.mean[0], 1 / 4, 0, 1e-15)
    close(c2.cov[0][0], 1 / 16, 0, 1e-15)
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
    // 只代實部（把 §8 的 Re κ 當成 κ）會誤判成穩定：(Re κ)²/(2N_τ) ≈ 7e-7 < Re κ
    expect(blockMeanStable([{ re: r.km[0].re, im: 0 }], 25)).toBe(true)
    // 同一件事在 α = 127/4000（實驗 B 的 127 MHz）
    const r127 = kappaRational(LOOPS.L2, 127, 4000)
    close(r127.km[0].re, 0.0062147907, 0, 1e-8)
    close(r127.km[0].im, 0.6548956727, 0, 1e-8)
    expect(blockMeanStable([r127.km[0]], 25)).toBe(false)
    expect(blockMeanStable([r127.km[0]], 50)).toBe(true)
    expect(blockMeanStable([{ re: r127.km[0].re, im: 0 }], 25)).toBe(true)
    expect(blockMeanStable([{ re: 1, im: 0 }], 25)).toBe(true)
    expect(blockMeanStable([{ re: -0.1, im: 0 }], 25)).toBe(false)
  })

  it('SSPLL: N_τ 是名義時間常數——pole = 1 − 1/N_τ 的精確 e-folding 是 −1/ln|1 − 1/N_τ|：N_τ = 5 ⇒ 4.4814（不是 5），N_τ = 25 ⇒ 24.497', () => {
    // 反例：N_τ = 5
    expect(timeConstantBlocks(1 - 1 / 5)).toBeCloseTo(4.481420117724551, 9)
    expect(5 - timeConstantBlocks(0.8)).toBeGreaterThan(0.5)
    expect(0.8 ** 4).toBeGreaterThan(Math.exp(-1)) // 4 個 block 還沒降到 1/e
    expect(0.8 ** 5).toBeLessThan(Math.exp(-1)) // 第 5 個 block 已經低於 1/e：e-folding 在 4 與 5 之間
    // 正常對照：N_τ = 25 只差 2%；N_τ 越大越接近
    const t25 = timeConstantBlocks(1 - 1 / 25)
    expect(t25).toBeCloseTo(24.49659826160178, 6)
    expect((25 - t25) / 25).toBeLessThan(0.021)
    expect(timeConstantBlocks(1 - 1 / 1000)).toBeCloseTo(999.4999166, 4)
    expect(timeConstantBlocks(0)).toBe(0) // N_τ = 1：一個 block 修完
    // 頁面 §12 用的本地算式與它相同
    for (const n of [2, 5, 25, 1000]) close(-1 / Math.log(Math.abs(1 - 1 / n)), timeConstantBlocks(1 - 1 / n), 1e-12)
    // 判據本身不依賴「時間常數」的說法：κ = 1 時穩定 ⟺ N_τ > 1/2（對任何 N_τ > 0 都精確）
    expect(blockMeanStable([{ re: 1, im: 0 }], 5)).toBe(true)
    expect(blockMeanStable([{ re: 1, im: 0 }], 0.6)).toBe(true)
    expect(blockMeanStable([{ re: 1, im: 0 }], 0.5)).toBe(false) // |1 − 2| = 1：邊界
    expect(blockMeanStable([{ re: 1, im: 0 }], 0.4)).toBe(false)
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

  it('SSPLL: 步長恆等式 μ_p·K_q/8 = 1/N_τ（raw）；開迴路 N_τ = 5 時 PHOS 誤差每個 block 乘上 0.8，e-folding 約 4.48 blocks（不是 5）', () => {
    const open = makeLoop('open', [0], [1], 1) // L ≡ 0 ⇒ H_PD ≡ 1
    const cfg: SspllSimCfg = { sigmaPs: 0.2, deltaPs: 7.8125, a: 0, epsPs: [0.02, -0.02, 0.02, -0.02, 0.02, -0.02, 0.02, -0.02] }
    const Kq = Math.sqrt(2 / Math.PI) / cfg.sigmaPs
    // 確定性的恆等式（正常對照）：raw 的 NLMS 正規化因子恰為 1
    for (const tau of [2, 5, 25]) {
      const r = runSspllLms({ loop: open, alpha: 0.137, variant: 'raw', cfg, nBlocks: 1, nBlk: 512, tauBlocks: tau, seed: 3, recEvery: 1, lanes: 1 })
      expect((r.muP * Kq) / 8).toBeCloseTo(1 / tau, 12)
    }
    // 真 1-bit 的開迴路模擬（N 很大，block 平均的雜訊很小）：20.000 → 15.998 → 12.790 → 10.181 → 8.130 → 6.519 → 5.254 fs
    const r = runSspllLms({ loop: open, alpha: 0.137, variant: 'raw', cfg, nBlocks: 6, nBlk: 1 << 20, tauBlocks: 5, seed: 3, recEvery: 1, lanes: 1 })
    const rms = Array.from(r.phosRmsFs)
    expect(rms).toHaveLength(7)
    close(rms[0], 20, 0, 1e-9)
    expect(rms[1] / rms[0]).toBeGreaterThan(0.795)
    expect(rms[1] / rms[0]).toBeLessThan(0.805)
    // 5 個 block 之後剩 0.8⁵ = 0.328；N_τ 若真的是 e-folding 時間，會是 1/e = 0.368
    expect(rms[5] / rms[0]).toBeGreaterThan(0.31)
    expect(rms[5] / rms[0]).toBeLessThan(0.345)
    // 對 ln(rms) 做最小平方擬合的 e-folding（−1/斜率）≈ 4.47，不含 5
    const n = rms.length
    const mx = (n - 1) / 2
    const my = rms.reduce((acc, v) => acc + Math.log(v), 0) / n
    let sxy = 0
    let sxx = 0
    rms.forEach((v, i) => {
      sxy += (i - mx) * (Math.log(v) - my)
      sxx += (i - mx) ** 2
    })
    const eFold = -sxx / sxy
    expect(eFold).toBeGreaterThan(4.3)
    expect(eFold).toBeLessThan(4.65)
  })

  it('SSPLL: 「開迴路每個 block 乘上 1 − 1/N_τ」還要 κ = 1（8 個相位被選到的次數相同）——α = 1/2 只選到 2 個相位：那兩個各乘 1 − 4/N_τ，其餘 6 個不動', () => {
    // 平均模型：H ≡ 1、raw 時 C 的 PHOS 區塊是對角的，C_kk = 相位 k 被選到的比例；κ = 8λ（去掉共模之後的可觀測方向）
    const openG = gammaEff(null, 'raw', undefined, true)
    const kappa = (P: number, Q: number): { occ: number[]; k: number[] } => {
      const { C, cov } = cPeriodic(P, Q, openG)
      return { occ: C.slice(1).map((row, i) => row[i + 1]), k: analyseC(C, cov).phosEigs.map((z) => 8 * z.re).sort((x, y) => x - y) }
    }
    // 正常對照：α = 137/1000（8 | Q）——每個相位 1/8，7 個方向的 κ 都是 1 ⇒ 每個 block 乘上 1 − 1/N_τ
    const uni = kappa(137, 1000)
    for (const o of uni.occ) close(o, 1 / 8, 0, 1e-12)
    expect(uni.k).toHaveLength(7)
    for (const k of uni.k) close(k, 1, 0, 1e-9)
    // 反例：α = 1/2 只選到相位 0 與 4（各 1/2）——唯一可觀測的方向 κ = 4；α = 1/4 選到 4 個相位，κ = 2
    const half = kappa(1, 2)
    half.occ.forEach((o, i) => close(o, i % 4 === 0 ? 0.5 : 0, 0, 1e-12))
    expect(half.k).toHaveLength(1)
    close(half.k[0], 4, 0, 1e-9)
    const quarter = kappa(1, 4)
    expect(quarter.k).toHaveLength(3)
    for (const k of quarter.k) close(k, 2, 0, 1e-9)
    // 真 1-bit 的開迴路模擬（N_τ = 5）：ε = ±20 fs 交替。α = 1/2 時被選到的兩個相位各乘 1 − 4/5 = 0.2，其餘 6 個停在 ±20 fs，
    // 所以 PHOS rms（去掉共模）是 20 → 16.97 → 16.65 → … → 16.58 fs，不是 20·0.8^k
    const open = makeLoop('open', [0], [1], 1)
    const cfg: SspllSimCfg = { sigmaPs: 0.2, deltaPs: 7.8125, a: 0, epsPs: [0.02, -0.02, 0.02, -0.02, 0.02, -0.02, 0.02, -0.02] }
    const want = (k: number): number => {
      const m = (1 - 4 / 5) ** k
      const e = cfg.epsPs.map((v, i) => (i % 4 === 0 ? v * m : v))
      const mean = e.reduce((acc, v) => acc + v, 0) / e.length
      return Math.sqrt(e.reduce((acc, v) => acc + (v - mean) ** 2, 0) / e.length) * 1000
    }
    close(want(1), 16.9706, 0, 1e-4)
    close(want(6), 16.5831, 0, 1e-3)
    const r = runSspllLms({ loop: open, alpha: 0.5, variant: 'raw', cfg, nBlocks: 6, nBlk: 1 << 19, tauBlocks: 5, seed: 3, recEvery: 1, lanes: 1 })
    const rms = Array.from(r.phosRmsFs)
    expect(rms).toHaveLength(7)
    close(rms[0], 20, 0, 1e-9)
    for (let k = 1; k <= 6; k++) close(rms[k], want(k), 5e-3) // seed 3–7 都在 0.2% 以內
    expect(rms[1] / rms[0]).toBeGreaterThan(0.84) // 實測 0.8503；κ = 1 的話會是 0.8
    expect(rms[6] / rms[0]).toBeGreaterThan(0.82) // 實測 0.830；κ = 1 的話會是 0.8⁶ = 0.262
    // 同一個 N_τ、8 相均勻的 α = 0.137（前一個測試）：第一個 block 就乘上 0.8
    const u = runSspllLms({ loop: open, alpha: 0.137, variant: 'raw', cfg, nBlocks: 1, nBlk: 1 << 19, tauBlocks: 5, seed: 3, recEvery: 1, lanes: 1 })
    expect(u.phosRmsFs[1] / u.phosRmsFs[0]).toBeGreaterThan(0.79)
    expect(u.phosRmsFs[1] / u.phosRmsFs[0]).toBeLessThan(0.812)
  })

  it('SSPLL: 物理注入模型的 GOS 零點在 w_g = a/(1 − a)，不是 w_g = a——a = 0.2 時收斂到總增益 1（殘餘 ≪ a²Δ = 312.5 fs）', () => {
    // 指標是 |(1 − a)(1 + w_g) − 1|·Δ：若固定點在 w_g = a，會停在 a²Δ
    const big = runSspllLms({ ...common, cfg: { ...CFG, a: 0.2 }, loop: LOOPS.L2, variant: '1diff' })
    close(big.gosAbsFs[0], 0.2 * CFG.deltaPs * 1000, 0, 1e-6) // 起始誤差 aΔ = 1562.5 fs
    close(0.2 * CFG.deltaPs * 1000, 1562.5, 0, 1e-9)
    expect(big.finalGosFs).toBeLessThan(0.1 * 0.2 * 0.2 * CFG.deltaPs * 1000) // < 31.25 fs（實測 2.2 fs；seed 3–7 都在 1.1–5.0 fs）
    expect(big.aborted).toBe(false)
    // 正常對照（網站的插圖值 a = 0.03）：起始 234.375 fs；略去的 a²Δ = 7.03 fs 和適應雜訊同一個量級，所以單靠它分不出零點在哪裡
    const d1 = runSspllLms({ ...common, loop: LOOPS.L2, variant: '1diff' })
    close(d1.gosAbsFs[0], 234.375, 0, 1e-6)
    expect(d1.finalGosFs).toBeLessThan(30)
    close(CFG.a * CFG.a * CFG.deltaPs * 1000, 7.03125, 0, 1e-9)
    close(CFG.a / (1 - CFG.a), 0.0309278351, 0, 1e-9)
    // 校準點的欄混合：GOS 的斜率多乘 (1 − a)，另有 ε/Δ 的 GOS–PHOS 耦合；PHOS 那幾欄不變
    const Mx = physicalMix(CFG)
    close(Mx[0][0], 0.97, 0, 1e-15)
    close(physicalMix({ ...CFG, a: 0.2 })[0][0], 0.8, 0, 1e-15)
    close(Mx[1][0], ((1 - CFG.a) * CFG.epsPs[0]) / CFG.deltaPs, 1e-12)
    close(Mx[1][0], 0.0035717484418629, 1e-12)
    expect(Mx[1][1]).toBe(1)
    expect(Mx[0][1]).toBe(0)
    const id = physicalMix(null)
    expect(id).toHaveLength(9)
    id.forEach((row, i) => row.forEach((v, j) => expect(v).toBe(i === j ? 1 : 0)))
  })

  it('SSPLL: frozen-weight 前提——三個標稱迴路的 h_PD 在 14／40／49 拍內衰減完，預設的 LMS（512 × 25 拍）慢 200 倍以上（raw、相位均勻）；最極端的 α = 1/2 配 filtered-x 也慢 30 倍以上', () => {
    const want = { L1: { mem: 2.572, n999: 14 }, L2: { mem: 6.409, n999: 40 }, L3: { mem: 8.34, n999: 49 } } as const
    for (const k of KEYS) {
      const pMax = Math.max(...loopPoles(LOOPS[k]).map((z) => cAbs(z)))
      close(1 / (1 - pMax), want[k].mem, 0, 2e-3) // 最慢極點的記憶長度 1/(1 − |p|)
      const h = loopImpulse(LOOPS[k], 4096)
      let total = 0
      for (const v of h) total += Math.abs(v)
      let acc = 0
      let n999 = 0
      while (acc < 0.999 * total) acc += Math.abs(h[n999++])
      expect(n999).toBe(want[k].n999) // Σ|h_PD| 的 99.9% 落在前 n999 拍
      expect(n999).toBeLessThanOrEqual(k === 'L1' ? 15 : 50)
      // LMS 的名義時間常數 512 × 25 拍；有迴路時除以 Re κ ≤ max Re H_PD（≤ 1.25）
      const maxReH = mode1SureBand(LOOPS[k]).maxReH
      expect(maxReH).toBeLessThan(1.25)
      expect((512 * 25) / maxReH / n999).toBeGreaterThan(200)
      // 「Re κ ≤ max Re H_PD」的適用範圍：raw regressor、8 個相位出現次數相同（ergodic 諧波和）——κ_m 與 κ_GOS 都是 Re H_PD 的加權平均
      for (const fM of [0.5, 42.5, 83.5, 548, 1500, 1998.5]) {
        const an = analyseAlpha(LOOPS[k], fM / MHZ)
        for (const z of an.kappaM) expect(z.re).toBeLessThanOrEqual(maxReH + 1e-9)
        expect(an.kappaGos).toBeLessThanOrEqual(maxReH + 1e-4)
      }
      // 其他情況每個 block 修掉的比例會再大幾倍：比例 × N_τ = max Re eig(C)·μ_p·K_q·N_τ（μ_p 含 NLMS 式的功率正規化）
      const rate = (variant: string, P: number, Q: number): number => {
        const models = variant === 'fx:exact' ? { exact: LOOPS[k] } : undefined
        const { C, cov } = cPeriodic(P, Q, gammaEff(LOOPS[k], variant, models))
        const muP = runSspllLms({ loop: LOOPS[k], alpha: P / Q, variant, models, cfg: CFG, nBlocks: 0, nBlk: 64, tauBlocks: 25, nSettle: 0, lanes: 1 }).muP
        return Math.max(...analyseC(C, cov).phosEigs.map((e) => e.re)) * muP * (Math.sqrt(2 / Math.PI) / CFG.sigmaPs) * 25
      }
      // α = 1/2：只有 2 個相位輪流被選到（occupancy 1/2）。raw：4·Re H_PD(1/2)（4.97／4.72／4.34）；filtered-x：恰為 8
      close(rate('raw', 1, 2), 4 * loopH(LOOPS[k], 0.5).re, 1e-9)
      expect(rate('raw', 1, 2)).toBeGreaterThan(4.3)
      close(rate('fx:exact', 1, 2), 8, 1e-9) // 頁面 §4.2 的 LMS_WORST_RATE：這時 LMS 仍比迴路慢 30 倍以上
      expect((512 * 25) / 8 / n999).toBeGreaterThan(30)
      // 8 個相位出現次數相同時，一階差分（功率正規化後）最多約 2.4（L2 的最大值 2.34 在 42.5 MHz）；raw 在同一點不超過 max Re H_PD
      expect(rate('1diff', 17, 1600)).toBeLessThan(2.4)
      expect(rate('1diff', 17, 1600)).toBeGreaterThan(maxReH)
      expect(rate('raw', 17, 1600)).toBeLessThanOrEqual(maxReH)
    }
  })

  it('SSPLL: §4.2 第 5 步把 δ_j 提到卷積外面只在權重不動時是等式——h_PD = [1, −1]：δ₁ 由 1 跳到 0 時 [1.5, −2] ≠ [1.5, −1]', () => {
    // Type-I、K = 1 的 H_PD = 1 − z⁻¹（deadbeat）：脈衝響應就是 [1, −1]
    const T = makeL1({ K: 1 })
    const h = Array.from(loopImpulse(T, 4))
    expect(h).toEqual([1, -1, 0, 0])
    const conv = (x: number[]): number[] => x.map((_, n) => x.slice(0, n + 1).reduce((acc, _v, m) => acc + h[m] * x[n - m], 0))
    const x1 = [1, 1]
    const x2 = [1, -1]
    const d2 = [0.5, 0.5]
    const both = (d1: number[]) => ({
      exact: conv(x1.map((_, n) => d1[n] * x1[n] + d2[n] * x2[n])), // 實際順序：先乘權重誤差，再通過迴路
      pulled: conv(x1).map((v, n) => d1[n] * v + d2[n] * conv(x2)[n]), // 第 5 步的寫法：權重誤差提到卷積外面
    })
    // 反例：δ₁ 在第二拍由 1 變成 0（舊的 δ₁ 還留在迴路的記憶裡）
    const moving = both([1, 0])
    expect(moving.exact).toEqual([1.5, -2])
    expect(moving.pulled).toEqual([1.5, -1])
    // 對照：δ₁ 不動時兩種寫法完全相同
    const frozen = both([1, 1])
    expect(frozen.exact).toEqual([1.5, -1])
    expect(frozen.pulled).toEqual([1.5, -1])
  })
})

describe('SSPLL 殘餘誤差 → 輸出 spur／jitter（§15.4：residualLineSpectrum、phosSteadyState、runSspllLmsWithSpectrum）', () => {
  const DELTA = [-2.8, -1.4, -2.6, 7.6, -4.1, 4.4, 1.0, -2.2]
  const G = 1.5
  /** close() 加上說明文字 */
  const closeM = (a: number, e: number, rel: number, abs: number, msg: string): void => {
    try {
      close(a, e, rel, abs)
    } catch (err) {
      throw new Error(`${msg}：${(err as Error).message}`)
    }
  }

  it('SSPLL: spur 公式就是 Ch12 的 spurBeta／spurDbcSmallAngle（T15：13 GHz、0.5 fs、|T| = 1 ⇒ −93.80 dBc）；|T| 與振幅都是線性', () => {
    expect(spurDbcFromToneFs(13e9, 0.5).toFixed(2)).toBe('-93.80')
    close(spurDbcFromToneFs(13e9, 0.5), spurDbcSmallAngle(spurBeta(13e9, 0.5)), 1e-12, 1e-12)
    close(spurBetaFromToneFs(16e9, 10, 1.24), 2 * Math.PI * 16e9 * 12.4e-15, 1e-12)
    close(spurDbcFromToneFs(16e9, 10, 0.5) - spurDbcFromToneFs(16e9, 10), 20 * Math.log10(0.5), 1e-12)
    close(spurDbcFromToneFs(16e9, 20) - spurDbcFromToneFs(16e9, 10), 20 * Math.log10(2), 1e-12)
  })

  it('SSPLL: 8 點 DFT（1/8 正規化）滿足 Parseval、共軛對稱；階梯弦波的線係數 |b_ℓ|² = w_ℓ = 64 sin²(πℓ/8)/(π²ℓ²)、Σ_{ℓ≡m} w_ℓ = 1', () => {
    const d = phosDft(DELTA)
    const mean = DELTA.reduce((a, b) => a + b, 0) / 8
    close(d[0].re, mean, 1e-12)
    expect(Math.abs(d[0].im)).toBeLessThan(1e-12)
    let sum = 0
    for (let m = 0; m < 8; m++) sum += d[m].re ** 2 + d[m].im ** 2
    close(sum, DELTA.reduce((a, b) => a + b * b, 0) / 8, 1e-12)
    for (let m = 1; m < 8; m++) {
      close(d[8 - m].re, d[m].re, 1e-12, 1e-12) // 共軛對稱（re 可能是 ~1e-16 的捨入殘渣，所以加絕對容許）
      close(d[8 - m].im, -d[m].im, 1e-12, 1e-12)
    }
    for (const ell of [1, -7, 9, 2, 3, 4, 52]) close(staircaseLineAmplitude(ell) ** 2, 64 * indicatorLineWeight(ell), 1e-12)
    close(staircaseLineAmplitude(1) ** 2, W1, 1e-12)
    expect(staircaseLineAmplitude(0)).toBe(1)
    expect(Math.abs(staircaseLineAmplitude(8))).toBeLessThan(1e-15) // sin(π) 的捨入殘渣
    for (const m of [1, 2, 3, 4]) {
      let w = 0
      for (let k = -4000; k <= 4000; k++) w += staircaseLineAmplitude(m + 8 * k) ** 2
      close(w, 1, 2e-3) // 尾項 ~ 1/ℓ
    }
  })

  it('SSPLL: 單線公式——全部殘差在 mode 1 時基波 A_1 = √(2W₁)·rms（1.3781×）、ℓ = −7 是 8|sin(7π/8)|/(7π) 倍；GOS 第 m 次諧波 |G|/(πm)；純 Python：8.515555／1.216508／0.336135', () => {
    const rms = 6.179
    const pure = Array.from({ length: 8 }, (_, k) => Math.SQRT2 * rms * Math.cos((2 * Math.PI * k) / 8))
    const rs = residualLineSpectrum({ deltaFs: pure, gosErrFs: 1.056, alpha: 0.02, loop: LOOPS.L2, fVcoHz: 16e9, singleLines: true, lMax: 64, mMax: 64 })
    close(rs.rmsPdPhosFs, rms, 1e-9)
    close(rs.rmsPdGosFs, 1.056 / Math.sqrt(12), 1e-12)
    const at = (src: 'phos' | 'gos', ell: number) => rs.lines.find((l) => l.source === src && l.ell === ell)!
    close(at('phos', 1).ampPdFs, 8.515555, 1e-6)
    close(at('phos', 1).ampPdFs, Math.sqrt(2 * W1) * rms, 1e-12)
    close(at('phos', -7).ampPdFs, 1.216508, 1e-6)
    close(at('gos', 1).ampPdFs, 0.336135, 1e-6)
    // 頻率：預設 acc32 序列，α 量化成 2⁻³² 的倍數（0.02 ⇒ 相差 1.9×10⁻¹¹），所以 MHz 只比到 10⁻⁵
    expect(at('phos', 1).fMHz).toBeCloseTo(80, 5)
    expect(at('phos', -7).fMHz).toBeCloseTo(560, 5)
    expect(at('gos', 1).fMHz).toBeCloseTo(640, 5) // β = 0.16
    close(at('phos', 1).tMag, cAbs(loopT(LOOPS.L2, 0.02)), 1e-9)
    close(at('phos', 1).spurDbc, spurDbcFromToneFs(16e9, at('phos', 1).ampOutFs), 1e-12)
    expect(at('phos', 1).spurDbc).toBeCloseTo(-65.5, 1)
    // 只有 mode 1：mode 2–4 的線全是 0；單線模式不合併
    expect(rs.lines.filter((l) => l.source === 'phos' && l.mode !== 1 && l.ampPdFs > 1e-9)).toHaveLength(0)
    expect(rs.lines.every((l) => l.others.length === 0)).toBe(true)
  })

  it('SSPLL: 有理 α = 1/50（右側與 acc32）：合併後的譜線 = 一個週期的精確 DFT（純 Python：k = 1..6 為 2.157677、1.525954、2.849827、2.686968、1.519334、0.291329）；ℓ 級數單獨算差到 10%', () => {
    const PY = [2.157677, 1.525954, 2.849827, 2.686968, 1.519334, 0.291329]
    for (const [alpha, seq] of [
      [1 / 50, 'right'],
      [0.02, 'acc32'],
    ] as const) {
      const rs = residualLineSpectrum({ deltaFs: DELTA, gosErrFs: G, alpha, loop: LOOPS.L2, fVcoHz: 16e9, seq })
      expect(rs.periodic).toBe(true)
      expect(rs.periodQ).toBe(50)
      for (let k = 1; k <= 6; k++) {
        const l = rs.lines.find((x) => Math.abs(x.f - k / 50) < 1e-9)!
        expect(l, `${seq} k=${k}`).toBeTruthy()
        closeM(l.ampPdFs, PY[k - 1], 2e-6, 1e-6, `${seq} k=${k}`)
        expect(l.exact).toBe(true)
        expect(l.others.length).toBeGreaterThan(0) // ℓ 與 ℓ ± 50 重合
      }
      // ℓ 級數的值（邊緣樣本給中點）與精確值不同：k = 1 差約 9%
      const l1 = rs.lines.find((x) => Math.abs(x.f - 1 / 50) < 1e-9)!
      expect(Math.abs(l1.seriesAmpPdFs / l1.ampPdFs - 1)).toBeGreaterThan(0.05)
      expect(Math.abs(l1.seriesAmpPdFs / l1.ampPdFs - 1)).toBeLessThan(0.15)
    }
    // 獨立的精確 DFT（這裡用 phaseSequence 的 'right' 序列重算一次）
    const { rho, p } = phaseSequence(1 / 50, 50, 'right')
    const e = rho.map((c, n) => DELTA[p[n]] + G * c)
    for (let k = 1; k <= 6; k++) {
      let re = 0
      let im = 0
      for (let n = 0; n < 50; n++) {
        re += e[n] * Math.cos((2 * Math.PI * k * n) / 50)
        im -= e[n] * Math.sin((2 * Math.PI * k * n) / 50)
      }
      close((2 * Math.hypot(re, im)) / 50, PY[k - 1], 1e-6, 1e-6)
    }
  })

  it('SSPLL: Nyquist 與 DC——α = 1/16（β = ½）的鋸齒諧波：偶數次落在 DC（略過）、奇數次在 f_ref/2 只剩實部；α = 1/4 只有 2 條線；兩者都與精確 DFT 一致', () => {
    for (const [alpha, Q] of [
      [1 / 16, 16],
      [1 / 4, 4],
    ] as const) {
      const rs = residualLineSpectrum({ deltaFs: DELTA, gosErrFs: G, alpha, loop: LOOPS.L2, fVcoHz: 16e9, seq: 'right' })
      const { rho, p } = phaseSequence(alpha, Q, 'right')
      const e = rho.map((c, n) => DELTA[p[n]] + G * c)
      expect(rs.lines.every((l) => l.f > 0 && l.f <= 0.5)).toBe(true)
      for (let k = 1; k <= Q / 2; k++) {
        let re = 0
        let im = 0
        for (let n = 0; n < Q; n++) {
          re += e[n] * Math.cos((2 * Math.PI * k * n) / Q)
          im -= e[n] * Math.sin((2 * Math.PI * k * n) / Q)
        }
        const exact = ((2 * k === Q ? 1 : 2) * Math.hypot(re, im)) / Q
        const l = rs.lines.find((x) => Math.abs(x.f - k / Q) < 1e-9)
        closeM(l?.ampPdFs ?? 0, exact, 1e-6, 1e-9, `α=${alpha} k=${k}`)
      }
    }
  })

  it('SSPLL: regressor 的模態雜訊 S_m——raw one-hot 是 1/8；一階差分（α < 1/8）是 4α sin²(πm/8)（純 Python：0、0.011716、0.04、0.068284、0.08…）；共模 S_0 = 0', () => {
    const raw = phosModeNoise([1 / 8, 0, 0, 0, 0, 0, 0, 0])
    for (let m = 0; m < 8; m++) close(raw[m], 1 / 8, 1e-12)
    const a = 0.02
    const d1 = phosModeNoise([2 * a, -a, 0, 0, 0, 0, 0, -a])
    const PY = [0, 0.011716, 0.04, 0.068284, 0.08, 0.068284, 0.04, 0.011716]
    for (let m = 0; m < 8; m++) close(d1[m], PY[m], 1e-4, 1e-6)
    for (let m = 0; m < 8; m++) close(d1[m], 4 * a * Math.sin((Math.PI * m) / 8) ** 2, 1e-12)
    // 模擬量到的 c[d]（前 2¹⁵ 拍）與閉合式一致
    const r = runSspllLmsWithSpectrum({ loop: LOOPS.L2, alpha: a, variant: '1diff', cfg: CFG, nBlocks: 2, nBlk: 64, nSettle: 0, nTail: 256, nperseg: 128 })
    const c = Array.from(r.spectrum.regCov)
    close(c[0], 2 * a, 2e-3, 1e-4)
    close(c[1], -a, 2e-3, 1e-4)
    close(c[7], -a, 2e-3, 1e-4)
    for (const d of [2, 3, 4, 5, 6]) expect(Math.abs(c[d])).toBeLessThan(1e-4)
    close(r.spectrum.regPowerPhos, 2 * a, 2e-3, 1e-4)
  })

  it('SSPLL: F-CS.23——raw、κ = 1、σ_v = 200 fs、N = 512、N_τ = 25：每個模態 σ_θ = 1.58255 fs（小步長閉合式 1.56664）、7 個合計 4.18703 fs（純 Python）；|p| ≥ 1 時沒有穩態', () => {
    const sig = 0.2
    const kq = Math.sqrt(2 / Math.PI) / sig
    const mu = 8 / (25 * kq)
    const one = Array.from({ length: 7 }, () => ({ re: 1, im: 0 }))
    const ss = phosSteadyState(one, mu, sig, 512, [1 / 8, 0, 0, 0, 0, 0, 0, 0])
    expect(ss.stable).toBe(true)
    close(ss.tauEff, 25, 1e-12)
    close(1000 * Math.sqrt(ss.varModePs2[0]), 1.58255, 1e-5, 1e-5)
    close(ss.rmsFs, 4.18703, 1e-5, 1e-5)
    close(1000 * Math.sqrt((Math.PI * sig * sig) / (4 * 512 * 25)), 1.56664, 1e-5, 1e-5)
    close(ss.tauMaxBlocks, -1 / Math.log(1 - 1 / 25), 1e-12) // 24.50
    for (const v of ss.poleAbs) close(v, 0.96, 1e-12)
    // Ch12 的寫法：σ_w² = μ²σ_η²/(1 − p²)，σ_η² = S_m/(8N)（每個模態）
    close(ss.varModePs2[0], (mu * mu * (1 / 8 / (8 * 512))) / (1 - 0.96 * 0.96), 1e-12)
    // 複數極點：|p|² 要用整個複數；反號（Re κ < 0）或步長太大都沒有穩態
    const bad = phosSteadyState([{ re: -0.14, im: 0.31 }, ...one.slice(1)], mu, sig, 512, [1 / 8, 0, 0, 0, 0, 0, 0, 0])
    expect(bad.stable).toBe(false)
    expect(bad.rmsFs).toBe(Infinity)
    const big = phosSteadyState(one, 8 / (0.4 * kq), sig, 512, [1 / 8, 0, 0, 0, 0, 0, 0, 0]) // N_τ = 0.4 ⇒ p = −1.5
    expect(big.stable).toBe(false)
  })

  it('SSPLL: runSspllLmsWithSpectrum 的前半段與 runSspllLms 逐拍相同（同 seed：block、PHOS rms、共模、GOS、μ 都一樣）；raw／1diff／filtered-x 三種', () => {
    const base = { alpha: 0.02, cfg: CFG, nBlocks: 120, nBlk: 256, tauBlocks: 25, seed: 3, recEvery: 10, lanes: 2, uOsPs: 0, seq: 'acc32' as const }
    for (const [variant, models] of [
      ['raw', undefined],
      ['1diff', undefined],
      ['fx:exact', { exact: LOOPS.L2 }],
    ] as const) {
      const a = runSspllLms({ ...base, loop: LOOPS.L2, variant, models })
      const b = runSspllLmsWithSpectrum({ ...base, loop: LOOPS.L2, variant, models, nTail: 4096, nperseg: 1024 })
      for (const k of ['block', 'phosRmsFs', 'phosCmAbsFs', 'gosAbsFs'] as const) expect(Array.from(b[k]), `${variant} ${k}`).toEqual(Array.from(a[k]))
      for (const k of ['muP', 'muG', 'initPhosRmsFs', 'finalPhosRmsFs', 'maxPhosRmsFs', 'finalGosFs', 'finalPhosCmFs', 'aborted', 'samples'] as const) expect(b[k], `${variant} ${k}`).toBe(a[k])
      expect(b.spectrum.nTail).toBe(4096)
      expect(b.spectrum.fVcoHz).toBeCloseTo(16e9, 0) // Δ = T_vco/8 ⇒ f_vco = 1/(8Δ)
    }
    const cmp = runSspllLmsCompareSpectrum({ common: { ...base, nTail: 4096, nperseg: 1024 }, cases: [{ id: 'A', loop: LOOPS.L2, variant: 'raw' }] })
    expect(cmp.cases[0].id).toBe('A')
    expect(cmp.cases[0].result.finalPhosRmsFs).toBe(runSspllLms({ ...base, loop: LOOPS.L2, variant: 'raw' }).finalPhosRmsFs)
  })

  it('SSPLL: 凍結後的輸出是確定性的多音訊號——閉合式（精確週期係數）vs toneFit 在前 8 條線差 < 1e-4；積分 jitter 閉合式 = 時域 rms = Welch 積分（< 0.1%）；findTones 找到的線都對得上', () => {
    const base = { alpha: 0.02, cfg: CFG, nBlocks: 300, nBlk: 512, tauBlocks: 25, seed: 3, recEvery: 10, lanes: 1, seq: 'acc32' as const }
    for (const [variant, models] of [
      ['1diff', undefined],
      ['fx:exact', { exact: LOOPS.L2 }],
    ] as const) {
      const r = runSspllLmsWithSpectrum({ ...base, loop: LOOPS.L2, variant, models })
      const sp = r.spectrum
      expect(sp.nSegments).toBe(15)
      expect(sp.lines.length).toBe(8)
      expect(sp.lines[0].exact).toBe(true)
      sp.lines.forEach((l, i) => {
        expect(Number.isFinite(sp.toneFitFs[i]), `${variant} line ${i}`).toBe(true)
        closeM(sp.toneFitFs[i], l.ampOutFs, 1e-4, 1e-6, `${variant} line ${i} @ ${l.fMHz} MHz`)
        close(sp.toneFitDbc[i], l.spurDbc, 1e-6, 1e-3)
        close(l.ampOutFs, l.tMag * l.ampPdFs, 1e-12)
        close(l.tMag, cAbs(loopT(LOOPS.L2, l.f)), 1e-9)
      })
      // 輸出振幅由大到小；最強的線在帶內
      for (let i = 1; i < sp.lines.length; i++) expect(sp.lines[i].ampOutFs).toBeLessThanOrEqual(sp.lines[i - 1].ampOutFs)
      close(sp.jitterClosedFs, sp.jitterTimeFs, 1e-3)
      close(sp.jitterWelchFs, sp.jitterTimeFs, 1e-3)
      // findTones（Blackman–Harris Welch）找到的線：頻率對到閉合式的線（1 個 bin 內）、振幅差 < 1%
      expect(sp.detected.length).toBeGreaterThanOrEqual(4)
      for (const d of sp.detected.slice(0, 4)) {
        expect(d.matchedLine).toBeGreaterThanOrEqual(0)
        const l = sp.lines[d.matchedLine]
        expect(Math.abs(d.fMHz - l.fMHz)).toBeLessThan(sp.dfMHz)
        close(d.ampFs, l.ampOutFs, 1e-2)
      }
      // 殘差向量與 rms 一致（§10.5 的定義：去共模）
      const res = Array.from(sp.phosResidualFs)
      const mean = res.reduce((a, b) => a + b, 0) / 8
      close(Math.sqrt(res.reduce((a, v) => a + (v - mean) ** 2, 0) / 8), r.finalPhosRmsFs, 1e-9)
      // L(f) 的格點：f = Δf..f_ref/2，dBc/Hz 是 10log10((2π f_vco·1e−15)²·S_t/2)
      expect(sp.psdFMHz.length).toBe(4096)
      close(sp.psdFMHz[0], sp.dfMHz, 1e-9)
      close(sp.psdFMHz[sp.psdFMHz.length - 1], 2000, 1e-9)
      // toneFit 自己再算一次（頻率取閉合式的精確值）：和 spectrum.toneFitFs 一致的前提是同一段 y——這裡用 jitter 的 Parseval 間接驗證就夠；直接重算 toneFit 的 API 存在
      expect(typeof toneFit).toBe('function')
    }
  })

  it('SSPLL: 穩態 PHOS rms——F-CS.23 的預測 vs 模擬後半段的 rms² 平均：raw α = 0.137、1diff α = 0.137、filtered-x α = 0.02 都在 10% 內（4 lanes）', () => {
    const base = { cfg: CFG, nBlk: 512, tauBlocks: 25, seed: 3, recEvery: 10, lanes: 4, seq: 'acc32' as const, nTail: 1024, nperseg: 512 }
    for (const [alpha, variant, nBlocks, models] of [
      [0.137, 'raw', 2000, undefined],
      [0.137, '1diff', 2000, undefined],
      [0.02, 'fx:exact', 2000, { exact: LOOPS.L2 }],
    ] as const) {
      const r = runSspllLmsWithSpectrum({ ...base, loop: LOOPS.L2, alpha, variant, models, nBlocks })
      const pred = analyseAlpha(LOOPS.L2, alpha, variant, models, 2048)
      const ss = phosSteadyState(pred.kappaM, r.muP, CFG.sigmaPs, 512, r.spectrum.regCov)
      expect(ss.stable).toBe(true)
      expect(nBlocks).toBeGreaterThan(12 * ss.tauMaxBlocks)
      const ratio = r.spectrum.steadyPhosRmsFs / ss.rmsFs
      expect(ratio, `${variant} α=${alpha}: meas ${r.spectrum.steadyPhosRmsFs} pred ${ss.rmsFs}`).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
      expect(r.spectrum.steadyBlocks[0]).toBe(1000)
      expect(r.spectrum.steadyBlocks[1]).toBe(nBlocks)
    }
  }, 60000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Code source（DSM dither、MASH、PMUX 隨機旋轉）× LMS（§10b）：TS port vs results/dither_interaction.json（tools/dither_sweep.py）
// 容差（JSON 的 _meta.tolerances）：closed form 與 factors 是同一套式子 → 相對 1e-9；closed vs numeric 絕對 0.03（MASH 在近有理數 α 有 tone）；
// acc1／mash 的序列是決定性的（與 Python 同一個整數遞迴），numeric 與大訊號逐位相同到 1e-7；dq／rot 的隨機數不同，只比統計（絕對 0.05）。
// ─────────────────────────────────────────────────────────────────────────────
import {
  CODE_RANGE,
  CODE_SOURCES,
  acc1LineWeight,
  accWord,
  codeSequenceRows,
  codeSpectralModel,
  codeVerdict,
  crosscheckCode,
  divergenceMcCode,
  dqLineWeight,
  dqWhite,
  gosCode,
  kappaModeCode,
  kappaNumericCode,
  kappaPhosCode,
  largeSignalCode,
  mashFactors,
  modeFold,
  rotFactor,
  runSspllLmsCode,
  thetaMode,
  type CodeSource,
} from './sspll'

describe('SSPLL code source × LMS（§10b）：closed form、numeric、大訊號、閉迴路 vs golden dither_interaction.json', () => {
  const DI = readGolden('dither_interaction.json')
  const LOOPS_DI: Record<string, SspllLoop> = { L2: LOOPS.L2, L2_pm45: makeL2({ pm: 45 }), L3: LOOPS.L3 }
  const SEL: number[] = DI._meta.selected_alphas

  it('SSPLL: 頻譜因子——MASH 的 |φ|² = 0.73099、R̃；dq 的白雜訊 (1 − cos θ)/3 與線權重；rot4／rot8 的 |D_M|²（rot8 全部模態為 0）；每個模態的功率守恆', () => {
    for (let m = 1; m <= 7; m++) {
      const f = mashFactors(m)
      const g = DI.factors.mash[`m${m}`]
      close(f.phi2, g.phi2, 1e-12)
      for (let k = 0; k < 3; k++) close(f.rtilde[k], g.rtilde[k], 1e-12, 1e-15)
      close(dqWhite(m), DI.factors.dq[`m${m}`].white, 1e-12)
      close(rotFactor(4, m), DI.factors.rot4[`m${m}`].D2, 1e-12, 1e-30)
      expect(rotFactor(8, m)).toBeLessThan(1e-28) // Σ_{r<8} e^{jπmr/4} = 0：隨機旋轉 8 相把每條線都殺掉
      for (const [ell, w] of Object.entries(DI.factors.dq[`m${m}`].lines)) close(dqLineWeight(m, (Number(ell) - modeFold(m)) / 8), w as number, 1e-10, 1e-18) // 線 ℓ = fold(m) + 8k
      // Parseval：線 + 白色 = 1（dq），線 = |D|²（rot），線 = |φ|²（mash），線 = 1（acc1，尾項補足）
      for (const src of CODE_SOURCES) {
        const sm = codeSpectralModel(src, m)
        const sum = sm.lines.reduce((a, l) => a + l.w, 0)
        expect(sum).toBeLessThanOrEqual(sm.total + 1e-12)
        if (src !== 'acc1') expect(sum).toBeGreaterThan(sm.total - 1e-4) // dq／rot：|k| ≤ 1024 之外的尾項 < 1e-4
        close(sm.total + (src === 'mash' ? 0 : sm.rtilde[0]), src === 'mash' ? mashFactors(m).phi2 : 1, 1e-12)
      }
    }
    close(mashFactors(1).phi2, 0.730986, 1e-5)
    close(thetaMode(1), Math.PI / 4, 1e-15)
    close(acc1LineWeight(1), W1, 1e-14)
    expect(CODE_RANGE).toEqual({ acc1: 1, dq: 2, mash: 4, rot4: 4, rot8: 8 })
  })

  it('SSPLL: closed form 的 κ_m、κ_min、最差模態、GOS 的 C／var／mean 與 golden 逐項相同（3 個迴路 × 5 種 source × 7 個 α）', () => {
    for (const [lk, loop] of Object.entries(LOOPS_DI)) {
      for (const src of CODE_SOURCES) {
        const g = DI.closed[`${lk}|${src}`]
        for (const a of SEL) {
          const row = g[String(a)]
          const kp = kappaPhosCode(loop, a, src)
          for (let m = 0; m < 7; m++) close(kp.kappaM[m], row.kappa_m[m], 1e-9, 1e-12)
          close(kp.kappaMin, row.kappa_min, 1e-9, 1e-12)
          // 最差模態：Re κ_m = Re κ_{8−m}（共軛對），rot8 更是 7 個模態全為 1——並列時兩邊的 argmin 可以落在不同的 m，只要求 TS 的最差模態達到 golden 的最小值
          close(row.kappa_m[kp.worstMode - 1], row.kappa_min, 1e-9, 1e-12)
          const gos = gosCode(loop, a, src)
          close(gos.C, row.gos.C, 1e-9, 1e-12)
          close(gos.varC, row.gos.var, 1e-12)
          close(gos.meanC, row.gos.mean, 1e-12)
          close(gos.kappaE2, row.gos.kappa_e2, 1e-9, 1e-12)
          expect(codeVerdict(loop, a, src).verdict).toBe(row.verdict)
        }
      }
    }
    // acc1 的 closed form 與 §8 的 phosLambdaHarmonic 是同一個和（截斷與尾項不同）：1e-4 內
    for (const a of SEL) {
      const kp = kappaPhosCode(LOOPS.L2, a, 'acc1')
      const an = analyseAlpha(LOOPS.L2, a)
      for (let m = 0; m < 7; m++) close(kp.kappaM[m], an.kappaM[m].re, 0, 1e-4)
    }
  })

  it('SSPLL: 序列——每種 source 都滿足 P + c = Φ + 常數（總補償量不變）、c 在構造的 range 內；acc1／mash 決定性', () => {
    for (const src of CODE_SOURCES) {
      const { c, p } = codeSequenceRows(0.137, src, 2000)
      const off = { acc1: 0, dq: 1, mash: 2, rot4: 3, rot8: 7 }[src]
      for (let n = 0; n < 2000; n++) {
        expect(c[n]).toBeGreaterThanOrEqual(0)
        expect(c[n]).toBeLessThan(CODE_RANGE[src] + 1e-12)
        // (p + c − offset) mod 8 = 8nα mod 8（量化的 α）；MASH 的狀態從 nStart = −64 歸零、S1 = (k+1)F，所以它的相位是 (n + 65)·8α（常數偏移，與 sim 相同）
        const nn = src === 'mash' ? n + 65 : n
        const phi = ((Math.imul(nn | 0, accWord(0.137) | 0) >>> 0) / 2 ** 29) % 8
        const lhs = (((p[n] + c[n] - off) % 8) + 8) % 8
        expect(Math.abs(lhs - phi) < 1e-9 || Math.abs(Math.abs(lhs - phi) - 8) < 1e-9, `${src} n=${n}`).toBe(true)
      }
      const again = codeSequenceRows(0.137, src, 2000)
      expect(again.c).toEqual(c) // 同 seed 可重現
    }
    expect(codeSequenceRows(0.137, 'acc1', 50)).toEqual({ c: phaseSequence(0.137, 50, 'acc32').rho, p: phaseSequence(0.137, 50, 'acc32').p })
  })

  it('SSPLL: numeric（實際序列的線性相關）——acc1／mash 與 golden 逐位相同（1e-7），dq／rot 統計一致（0.05）；closed vs numeric 的最大差與 golden 一致（0.021）', () => {
    let maxDiff = 0
    for (const [lk, loop] of Object.entries(LOOPS_DI)) {
      for (const src of CODE_SOURCES) {
        for (const a of SEL) {
          const nu = kappaNumericCode(loop, a, src)
          const g = DI.numeric[`${lk}|${src}`][String(a)]
          const det = src === 'acc1' || src === 'mash'
          for (let m = 0; m < 7; m++) close(nu.kappaM[m], g.kappa_m[m], 0, det ? 1e-7 : 0.05)
          close(nu.gosC, g.gos_C, 0, det ? 1e-7 : 0.05 * Math.max(1, g.gos_C))
          close(nu.codeMean, g.code_mean, 0, det ? 1e-9 : 0.05)
          const cl = DI.closed[`${lk}|${src}`][String(a)]
          maxDiff = Math.max(maxDiff, Math.abs(nu.kappaMin - cl.kappa_min))
          close(nu.kappaMin, cl.kappa_min, 0, 0.03)
        }
      }
    }
    close(maxDiff, DI.sim_compare._summary.max_abs_diff_closed_numeric, 0, 0.01)
    expect(DI.sim_compare._summary.max_abs_diff_closed_sim).toBeLessThan(0.01) // closed form vs 時域 sim 存檔（sim_dither_extract.json）
  })

  it('SSPLL: 大訊號 κ_∞（1-bit 相關）——L2-PM45／MASH／α = 0.03：線性 −0.0013（dead zone）但 κ_∞ = −0.258；PM 60° 是 +0.180；acc1／mash 與 golden 逐位相同', () => {
    for (const [lk, loop] of Object.entries(LOOPS_DI)) {
      for (const src of ['acc1', 'mash'] as CodeSource[]) {
        for (const a of [0.01, 0.03, 0.137]) {
          const g = DI.large_signal[`${lk}|${src}`][String(a)].m1
          const ls = largeSignalCode(loop, a, src, 1, [1, 5], CFG)
          close(ls.kappaInf, g.kappa_inf, 1e-7, 1e-9)
          close(ls.lin, g.lin, 1e-7, 1e-9)
          close(ls.g[0], g.g[0], 1e-6, 1e-9)
          close(ls.g[1], g.g[1], 1e-6, 1e-9)
        }
      }
    }
    const hl = DI.headline
    const pm45 = largeSignalCode(LOOPS_DI.L2_pm45, 0.03, 'mash', 1, [1, 5], CFG)
    close(pm45.kappaInf, -0.2583, 0, 2e-4)
    close(pm45.lin, -0.0013, 0, 2e-4)
    close(pm45.kappaInf, hl.kappa_inf, 1e-7)
    const pm60 = largeSignalCode(LOOPS.L2, 0.03, 'mash', 1, [1, 5], CFG)
    close(pm60.kappaInf, hl.pm60.kappa_inf, 1e-7)
    close(pm60.kappaInf, 0.1799, 0, 2e-4)
    // dq／rot：隨機數不同，統計一致
    for (const src of ['dq', 'rot4'] as CodeSource[]) {
      const g = DI.large_signal[`L2|${src}`]['0.03'].m1
      close(largeSignalCode(LOOPS.L2, 0.03, src, 1, [1, 5], CFG).kappaInf, g.kappa_inf, 0, 0.05)
    }
  })

  it('SSPLL: headline——L2-PM45、MASH、α = 0.03 逐項：載波 0.731 × Re H(120 MHz) = −0.280，散開的三項 +0.269 +0.041 −0.009 ⇒ κ₁ = +0.0206（dead zone）；PM 60° 的 Re H = −0.095 ⇒ +0.238', () => {
    const hl = DI.headline
    const loop = LOOPS_DI.L2_pm45
    const h = loopImpulse(loop, 3)
    const f = mashFactors(1)
    const reH = loopH(loop, 0.03).re
    close(reH, hl.ReH, 1e-9)
    close(reH, -0.3825, 0, 1e-4)
    const terms = [f.phi2 * reH, h[0] * f.rtilde[0], h[1] * Math.cos(2 * Math.PI * 0.03) * f.rtilde[1], h[2] * Math.cos(4 * Math.PI * 0.03) * f.rtilde[2]]
    close(terms[0], hl.terms.carrier, 1e-9)
    close(terms[1], hl.terms.k0, 1e-9)
    close(terms[2], hl.terms.k1, 1e-9)
    close(terms[3], hl.terms.k2, 1e-9)
    const k1 = terms.reduce((x, y) => x + y, 0)
    close(k1, kappaModeCode(loop, 0.03, 'mash', 1), 1e-12)
    close(k1, hl.kappa_1, 1e-9)
    close(k1, 0.0206, 0, 1e-4)
    expect(codeVerdict(loop, 0.03, 'mash').verdict).toBe('dead')
    close(loopH(LOOPS.L2, 0.03).re, hl.pm60.ReH, 1e-9)
    close(kappaModeCode(LOOPS.L2, 0.03, 'mash', 1), hl.pm60.kappa_1, 1e-9)
    close(kappaModeCode(LOOPS.L2, 0.03, 'mash', 1), 0.2377, 0, 1e-4)
    expect(codeVerdict(LOOPS.L2, 0.03, 'mash').verdict).toBe('restoring')
    // 手算題 HC-CS.12 的數字：dq 的線與白雜訊、rot4 的 |D|²
    close(dqWhite(1), hl.handcalc_dq.white, 1e-12)
    close(dqLineWeight(1, 0), hl.handcalc_dq.line_m1, 1e-12)
    close(kappaModeCode(loop, 0.03, 'dq', 1), hl.handcalc_dq.kappa_1, 1e-9)
    close(rotFactor(4, 1), hl.handcalc_rot4.D2, 1e-12)
    close(kappaModeCode(loop, 0.03, 'rot4', 1), hl.handcalc_rot4.kappa_1, 1e-9)
    close(kappaModeCode(loop, 0.03, 'rot8', 1), 1, 1e-12)
    // 時域 sim（sim_dither_extract.json）的閉迴路：這一點發散到 10.7 ps
    expect(hl.sim_final_phos_fs).toBeGreaterThan(10000)
  })

  it('SSPLL: 判定 vs Monte Carlo——TS 的 crosscheck 與 golden 的 87 ok／0 mismatch／18 n/a 逐格相同；L2-PM45／MASH／α = 0.03 是 dead zone 且 8/8 發散、PM 60° 是 restoring 且 8/8 收斂', () => {
    let ok = 0
    let bad = 0
    let na = 0
    for (const lk of Object.keys(LOOPS_DI)) {
      for (const src of CODE_SOURCES) {
        for (const a of SEL) {
          const g = DI.mc[`${lk}|${src}`][String(a)]
          const v = codeVerdict(LOOPS_DI[lk], a, src)
          expect(v.verdict).toBe(g.verdict)
          const cc = crosscheckCode(v.verdict, { ciDiv: g.ci_div, ciConv: g.ci_conv })
          expect(cc.status, `${lk}|${src}|${a}`).toBe(g.crosscheck.status)
          ok += cc.status === 'ok' ? 1 : 0
          bad += cc.status === 'mismatch' ? 1 : 0
          na += cc.status === 'n/a' ? 1 : 0
        }
      }
    }
    expect([ok, bad, na]).toEqual([DI.mc._summary.n_ok, DI.mc._summary.n_mismatch, DI.mc._summary.n_na])
    expect(bad).toBe(0)
    const hl = DI.mc['L2_pm45|mash']['0.03']
    expect(hl.n_div).toBe(8)
    expect(hl.verdict).toBe('dead')
    expect(DI.mc['L2|mash']['0.03'].n_conv).toBe(8)
    expect(DI.mc['L2|rot8']['0.02'].n_conv).toBe(8)
    expect(DI.mc['L2|acc1']['0.02'].n_div).toBe(8)
  })

  it('SSPLL: 閉迴路（TS port，runSspllLmsCode）——L2-PM45／MASH／α = 0.03 四個 seeds 都變大，PM 60° 都收斂到 1/4 以下；rot8 在 80 MHz 收斂而 acc1 發散；同 seed 可重現', () => {
    const base = { cfg: CFG, nBlocks: 600, nBlk: 512, tauBlocks: 25, recEvery: 50, variant: 'raw' }
    const bad = divergenceMcCode({ ...base, loop: LOOPS_DI.L2_pm45, alpha: 0.03, source: 'mash', seeds: [0, 1, 2, 3] })
    expect(bad.finalFs.every((f) => f > bad.initFs)).toBe(true)
    close(bad.initFs, 173.29, 0, 0.01)
    expect(bad.traces).toHaveLength(4)
    const good = divergenceMcCode({ ...base, loop: LOOPS.L2, alpha: 0.03, source: 'mash', seeds: [0, 1, 2, 3] })
    expect(good.nConv).toBe(4)
    expect(good.ciConv[0]).toBeGreaterThan(0.5) // 4/4 的 Wilson 下界 0.51：4 個 seeds 才判得了
    expect(crosscheckCode('restoring', good).status).toBe('ok')
    const rot = runSspllLmsCode({ ...base, loop: LOOPS.L2, alpha: 0.02, source: 'rot8', seed: 1 })
    const raw = runSspllLmsCode({ ...base, loop: LOOPS.L2, alpha: 0.02, source: 'acc1', seed: 1 })
    expect(rot.finalPhosRmsFs).toBeLessThan(rot.initPhosRmsFs / 4)
    expect(raw.finalPhosRmsFs).toBeGreaterThan(raw.initPhosRmsFs * 2)
    // acc1 的 code source 等於 runSspllLms 的 acc32 序列：同參數、同 seed 的結果逐位相同
    const ref = runSspllLms({ ...base, loop: LOOPS.L2, alpha: 0.02, variant: 'raw', seed: 1, seq: 'acc32' })
    expect(Array.from(raw.phosRmsFs)).toEqual(Array.from(ref.phosRmsFs))
    expect(runSspllLmsCode({ ...base, loop: LOOPS.L2, alpha: 0.02, source: 'rot8', seed: 1 }).finalPhosRmsFs).toBe(rot.finalPhosRmsFs)
  }, 60000)
})

// ─────────────────────────────────────────────────────────────────────────────
// dead zone 的候選判準（§10b.7）：TS port vs golden 的 score_candidates（results/dither_interaction.json 的 mc[*].candidates 與 mc._summary.candidates）。
// 容差：判定是離散的，逐格相同；e-folding 的成長倍數是同一條式子（相對 1e-12）；最差模態的 κ_∞ 是實際序列上的 1-bit 相關——
// acc1／mash 的序列與 Python 同一個整數遞迴，相對 1e-7（絕對 1e-9）；dq／rot 的隨機數不同（xoshiro128** vs PCG64），只比統計（絕對 0.05；實測最大差 0.018）。
// ─────────────────────────────────────────────────────────────────────────────
import { efoldVerdict, efoldWindow, kappaInfHint, twoStageCandidate } from './sspll'

describe('SSPLL §10b.7：dead zone 的候選判準 vs golden（兩段判定被資料否決、觀測窗的 e-folding 0 個不一致）', () => {
  const DI = readGolden('dither_interaction.json')
  const LOOPS_DI: Record<string, SspllLoop> = { L2: LOOPS.L2, L2_pm45: makeL2({ pm: 45 }), L3: LOOPS.L3 }
  const TAU: number = DI._meta.tau_dead
  const rows = (): { key: string; lk: string; src: CodeSource; a: string; row: Json }[] =>
    Object.entries(DI.mc as Json)
      .filter(([k]) => !k.startsWith('_'))
      .flatMap(([key, t]) => Object.entries(t as Json).map(([a, row]) => ({ key, lk: key.split('|')[0], src: key.split('|')[1] as CodeSource, a, row: row as Json })))

  it('SSPLL: 每一格的兩段判定（最差模態、mode 1）與觀測窗判準都和 golden 相同；計分 87/0/18（線性段）、93/8/4（兩段，dead zone 6/8/4）、92/0/13（e-folding）', () => {
    const idx = { ok: 0, mismatch: 1, 'n/a': 2 } as const
    const tally: Record<string, [number, number, number]> = { two_stage: [0, 0, 0], two_stage_m1: [0, 0, 0], efold: [0, 0, 0] }
    const dz: [number, number, number] = [0, 0, 0]
    const mism: string[] = []
    for (const { key, a, row } of rows()) {
      const c = row.candidates
      const ts = twoStageCandidate(row.kappa_min, row.kappa_inf_worst, TAU)
      expect(ts, `${key}|${a}`).toBe(c.two_stage.verdict)
      expect(twoStageCandidate(row.kappa_min, row.kappa_inf_m1, TAU)).toBe(c.two_stage_m1.verdict)
      const ef = efoldVerdict(row.kappa_min, row.n_blocks, row.tau_blocks, row.grow, row.shrink)
      expect(ef.verdict).toBe(c.efold.verdict)
      close(ef.growth, c.efold.growth, 1e-12)
      for (const name of ['two_stage', 'two_stage_m1', 'efold'] as const) {
        const st = crosscheckCode(c[name].verdict, { ciDiv: row.ci_div, ciConv: row.ci_conv }).status
        expect(st, `${name} ${key}|${a}`).toBe(c[name].status)
        tally[name][idx[st]]++
      }
      if (row.verdict === 'dead') {
        dz[idx[c.two_stage.status as keyof typeof idx]]++
        expect(kappaInfHint(row.kappa_inf_worst, TAU)).toBe(ts)
      }
      if (c.two_stage.status === 'mismatch') mism.push(`${key}|${a}`)
    }
    const s = DI.mc._summary
    for (const name of Object.keys(tally)) expect(tally[name], name).toEqual([s.candidates[name].n_ok, s.candidates[name].n_mismatch, s.candidates[name].n_na])
    expect(tally.two_stage).toEqual([93, 8, 4])
    expect(dz).toEqual([6, 8, 4])
    expect(dz).toEqual([s.candidates.two_stage.dead_zone.n_ok, s.candidates.two_stage.dead_zone.n_mismatch, s.candidates.two_stage.dead_zone.n_na])
    expect(mism.sort()).toEqual([...s.candidates.two_stage.mismatches].sort())
    expect(tally.efold).toEqual([92, 0, 13])
    expect([s.n_ok, s.n_mismatch, s.n_na, s.n_dead]).toEqual([87, 0, 18, 18])
    const w = efoldWindow(1500, 25)
    close(w.kappaDiv, s.candidates.efold.kappa_div, 1e-14)
    close(w.kappaConv, s.candidates.efold.kappa_conv, 1e-14)
    // headline：dead zone；e-folding 說窗內慢慢縮到 0.29 倍（不判），MC 卻 8/8 發散——兩條候選都解釋不了為什麼長大
    const hl = DI.mc['L2_pm45|mash']['0.03']
    const e45 = efoldVerdict(kappaModeCode(LOOPS_DI.L2_pm45, 0.03, 'mash', 1), 1500, 25)
    expect(e45.verdict).toBe('dead')
    close(e45.growth, hl.candidates.efold.growth, 1e-9)
    expect(e45.growth).toBeGreaterThan(0.25)
    expect(e45.growth).toBeLessThan(0.3)
  })

  it('SSPLL: 沿 closed form 最差模態的 κ_∞（頁面用的那一個）——acc1／mash 與 golden 的 kappa_inf_worst 逐位相同、dq／rot 統計一致；TS 的最差模態與 golden 相同（或是共軛的 8 − m，方向相同）', () => {
    let det = 0
    let stat = 0
    let maxStat = 0
    for (const { lk, src, a, row } of rows()) {
      const loop = LOOPS_DI[lk]
      const alpha = Number(a)
      const ls = largeSignalCode(loop, alpha, src, row.worst_mode, [1, 5], CFG)
      if (src === 'acc1' || src === 'mash') {
        close(ls.kappaInf, row.kappa_inf_worst, 1e-7, 1e-9)
        det++
      } else {
        maxStat = Math.max(maxStat, Math.abs(ls.kappaInf - row.kappa_inf_worst))
        close(ls.kappaInf, row.kappa_inf_worst, 0, 0.05)
        stat++
      }
      // 頁面用 TS 的 codeVerdict().worstMode；並列（rot8 七個模態都是 1、共軛對 m 與 8 − m）以外必須是同一個方向
      const kp = codeVerdict(loop, alpha, src)
      const second = Math.min(...kp.kappaM.filter((_, i) => i + 1 !== kp.worstMode && i + 1 !== 8 - kp.worstMode))
      if (second - kp.kappaMin > 1e-9) expect([row.worst_mode, 8 - row.worst_mode], `${lk}|${src}|${a}`).toContain(kp.worstMode)
    }
    expect([det, stat]).toEqual([42, 63])
    expect(maxStat).toBeLessThan(0.05)
    // α = 0.253、0.496 的 acc1：最差模態是 2、4、6，κ_∞ 與 mode 1（+1）完全不同——審查指出頁面用的這個值以前沒有和 golden 比過
    const r = DI.mc['L3|acc1']['0.253']
    expect(r.worst_mode).toBe(4)
    close(largeSignalCode(LOOPS.L3, 0.253, 'acc1', 4, [1, 5], CFG).kappaInf, r.kappa_inf_worst, 1e-7, 1e-9)
    expect(r.kappa_inf_worst).toBeLessThan(-0.7)
    close(r.kappa_inf_m1, 1, 0, 1e-12)
  }, 60000)

  it('SSPLL: κ_∞ 判準的反例（實驗 D 的 preset code-l3-dq：L3、40 MHz、dq）——dead zone、κ_∞ ≈ −0.18 提示發散，TS 的 4 個 seeds 卻沒有一個發散、也沒有收斂；舊的兩段判定在這裡是 mismatch', () => {
    const v = codeVerdict(LOOPS.L3, 0.01, 'dq')
    expect(v.verdict).toBe('dead')
    const ls = largeSignalCode(LOOPS.L3, 0.01, 'dq', v.worstMode, [1, 5], CFG)
    expect(kappaInfHint(ls.kappaInf)).toBe('inverted')
    close(ls.kappaInf, DI.mc['L3|dq']['0.01'].kappa_inf_worst, 0, 0.05)
    const mc = divergenceMcCode({ cfg: CFG, loop: LOOPS.L3, alpha: 0.01, source: 'dq', seeds: [0, 1, 2, 3], nBlocks: 1500, nBlk: 512, tauBlocks: 25, recEvery: 100, variant: 'raw' })
    expect([mc.nDiv, mc.nConv]).toEqual([0, 0])
    for (const f of mc.finalFs) {
      expect(f).toBeGreaterThan(0.5 * mc.initFs)
      expect(f).toBeLessThan(1.5 * mc.initFs)
    }
    expect(crosscheckCode(twoStageCandidate(v.kappaMin, ls.kappaInf), mc).status).toBe('mismatch')
    expect(efoldVerdict(v.kappaMin, 1500, 25).verdict).toBe('dead') // 觀測窗判準：κ_min ≈ 0，倍數 ≈ 1，不判
  }, 60000)
})
