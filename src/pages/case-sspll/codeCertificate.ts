/**
 * §10b.8 code source 的「全頻道證書」（F-CS.29；docs/analysis/sspll-dither-interaction.md §5b）：
 * 把 §7b 的證書工具（gosTheorem.ts 的 gosLipschitz／gosKernelMin：Re H_PD 在所有頻率的「有證明的」下界 g_min）
 * 延伸到 F-CS.27 的 code source 斜率。對任何 α：
 *   Re κ_m(α) = Σ_ℓ w_ℓ g(frac(ℓα)) + Σ_k h[k] cos(2πmαk) R̃_m[k]
 *            ≥ W_m g_min + R̃_m[0] − Σ_{k≥1} |h[k]| |R̃_m[k]|  =: LB_m      （每條線的 g ≥ g_min；cos ≥ −1；h[0] = 1）
 * W_m = 線的總權重（acc1 1、dq 1 − R̃[0]、rotM |D_M|²、MASH |φ_m|²）。min_m LB_m > τ ⇒ 每一個頻道都 restoring；
 * ≥ −τ ⇒ 沒有頻道反號（仍可能有 dead zone）；其餘證書不說話，要掃 κ_min（F-CS.28）。
 * 下界本身在 F-CS.27 的模型內沒有近似（acc1、dq、rot 的模型精確；MASH 繼承 e₃ iid 的近似）。
 *
 * 純函式、不 import React／DOM。Python golden：analysis/sspll/golden/sspll_golden/dither_interaction.py 的 code_certificate、
 * tools/dither_certificate.py → results/dither_certificate.json；codeCertificate.test.ts 逐項比對。
 */
import { CODE_SOURCES, codeSpectralModel, loopH, loopImpulse, makeL2, mashFactors, modeFold, type CodeSource, type SspllLoop } from '@/simulation/models/sspll'
import { gosKernelMin, gosLipschitz, type GosLipschitz } from './gosTheorem'

/** g_min 的格點數（鬆弛 L_g·h/2 = L_g/(4(n_f − 1))，L2 約 6×10⁻⁴；與 golden 的 CERT_NF 相同） */
export const CERT_NF = 20001
/** PM 掃描（L2 重新設計到 320 MHz） */
export const PM_SWEEP = [40, 45, 50, 55, 60, 65, 70]
/** dead-zone 門檻 τ（F-CS.28） */
export const CERT_TAU = 0.05

export type CertStatus = 'restoring-all' | 'never-inverted' | 'inconclusive'

export interface CodeCertificate {
  source: CodeSource
  /** LB_m，m = 1..7 */
  lbModes: number[]
  lbMin: number
  worstMode: number
  /** Re H_PD 的有證明下界（§7b：格點最小值減 L_g·h/2，截在 0） */
  gMin: number
  gridMin: number
  /** 格點最小值所在的正規化頻率（谷底） */
  fAtMin: number
  Lg: number
  /** h_PD[0..2] */
  h: number[]
  status: CertStatus
  tau: number
}

// #region core:codeCertificate
/** 模態 m 的全頻道下界 LB_m = W_m g_min + R̃_m[0] − Σ_{k≥1}|h[k]||R̃_m[k]|（F-CS.29） */
export function codeModeLowerBound(source: CodeSource, m: number, gMin: number, h: ArrayLike<number>): number {
  const sm = codeSpectralModel(source, m, 0) // 只用到線的總權重與 R̃
  let lb = sm.total * gMin + h[0] * sm.rtilde[0] // 每條線都在某個頻率上，那裡 Re H ≥ g_min
  for (let k = 1; k < sm.rtilde.length; k++) lb -= Math.abs(h[k]) * Math.abs(sm.rtilde[k]) // ← 差異：cos(2πmαk) 換成最壞情況
  return lb
}

/** 全頻道證書：LB_min > τ ⇒ 所有頻道 restoring；≥ −τ ⇒ 沒有頻道反號；其餘 inconclusive（要掃 κ_min） */
export function codeCertificate(loop: SspllLoop, source: CodeSource, tau = CERT_TAU, nf = CERT_NF, lip?: GosLipschitz): CodeCertificate {
  const L = lip ?? gosLipschitz(loop)
  const km = gosKernelMin(loop, L.Lg, nf) // §7b 的工具：g(f) ≥ g_min 對所有 f
  const h = Array.from(loopImpulse(loop, 3))
  const lbModes = Array.from({ length: 7 }, (_, i) => codeModeLowerBound(source, i + 1, km.gMin, h))
  let w = 0
  for (let i = 1; i < 7; i++) if (lbModes[i] < lbModes[w]) w = i
  const lbMin = lbModes[w]
  const status: CertStatus = lbMin > tau ? 'restoring-all' : lbMin >= -tau ? 'never-inverted' : 'inconclusive'
  return { source, lbModes, lbMin, worstMode: w + 1, gMin: km.gMin, gridMin: km.gridMin, fAtMin: km.fAtMin, Lg: L.Lg, h, status, tau }
}
// #endregion core:codeCertificate

export interface MashScan {
  /** 1 MHz 格點上 closed form 的 κ_min 最小值 */
  min: number
  fMHzAtMin: number
  /** |κ_min| ≤ τ 的頻率範圍（MHz）；沒有就 null */
  deadMHz: [number, number] | null
  /** κ_min < −τ 的頻率範圍（MHz）；沒有就 null */
  invertedMHz: [number, number] | null
}

/** MASH 的 closed form κ_min 在 1 MHz 格點（α_j = j/f_ref[MHz]，j = 1..nAlpha）上的掃描：每個模態只有一條載波線，所以很便宜 */
export function mashKappaMinScan(loop: SspllLoop, nAlpha = 2000, fRefMHz = 4000, tau = CERT_TAU): MashScan {
  const h = loopImpulse(loop, 3)
  const fac = Array.from({ length: 7 }, (_, i) => ({ f: mashFactors(i + 1), mm: modeFold(i + 1) }))
  let min = Infinity
  let fAt = 0
  let dead: [number, number] | null = null
  let inv: [number, number] | null = null
  for (let j = 1; j <= nAlpha; j++) {
    const a = j / fRefMHz
    let k = Infinity
    for (const { f, mm } of fac) {
      const x = mm * a
      let v = f.phi2 * loopH(loop, x - Math.floor(x)).re
      for (let kk = 0; kk < f.rtilde.length; kk++) v += h[kk] * Math.cos(2 * Math.PI * mm * a * kk) * f.rtilde[kk]
      k = Math.min(k, v)
    }
    if (k < min) {
      min = k
      fAt = j
    }
    if (Math.abs(k) <= tau) dead = dead ? [Math.min(dead[0], j), Math.max(dead[1], j)] : [j, j]
    if (k < -tau) inv = inv ? [Math.min(inv[0], j), Math.max(inv[1], j)] : [j, j]
  }
  return { min, fMHzAtMin: fAt, deadMHz: dead, invertedMHz: inv }
}

export interface PmRow {
  pm: number
  Kp: number
  Ki: number
  gMin: number
  fAtMin: number
  lb: Record<'mash' | 'rot4' | 'dq', number>
  statusMash: CertStatus
  mashScan: MashScan
}

/** PM 掃描的一列：L2 在這個 PM 重新設計到 320 MHz，三種 source 的下界與 MASH 的 κ_min 掃描 */
export function pmSweepRow(pm: number): PmRow {
  const lp = makeL2({ pm })
  const lip = gosLipschitz(lp)
  const c = { mash: codeCertificate(lp, 'mash', CERT_TAU, CERT_NF, lip), rot4: codeCertificate(lp, 'rot4', CERT_TAU, CERT_NF, lip), dq: codeCertificate(lp, 'dq', CERT_TAU, CERT_NF, lip) }
  return {
    pm,
    Kp: Number(lp.params.Kp),
    Ki: Number(lp.params.Ki),
    gMin: c.mash.gMin,
    fAtMin: c.mash.fAtMin,
    lb: { mash: c.mash.lbMin, rot4: c.rot4.lbMin, dq: c.dq.lbMin },
    statusMash: c.mash.status,
    mashScan: mashKappaMinScan(lp),
  }
}

/** 表列的值第一次越過 level 的 PM（線性內插；golden 的 interp_threshold 同一條規則） */
export function interpThreshold(pms: number[], vals: number[], level: number): number | null {
  for (let i = 1; i < pms.length; i++) {
    const a = vals[i - 1] - level
    const b = vals[i] - level
    if (a <= 0 && b > 0) return pms[i - 1] + ((pms[i] - pms[i - 1]) * -a) / (b - a)
  }
  return null
}

/** 三個迴路 × 五種 source 的證書（頁面的表） */
export function certificateTable(loops: Record<string, SspllLoop>): Record<string, { Lg: number; certs: Record<CodeSource, CodeCertificate>; mashScan: MashScan }> {
  return Object.fromEntries(
    Object.entries(loops).map(([k, lp]) => {
      const lip = gosLipschitz(lp)
      const certs = Object.fromEntries(CODE_SOURCES.map((s) => [s, codeCertificate(lp, s, CERT_TAU, CERT_NF, lip)])) as Record<CodeSource, CodeCertificate>
      return [k, { Lg: lip.Lg, certs, mashScan: mashKappaMinScan(lp) }]
    }),
  )
}
