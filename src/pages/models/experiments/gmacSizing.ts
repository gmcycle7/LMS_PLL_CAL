/**
 * GMAC datapath 計算器（實驗 'gmac-datapath-sizing'）的純函式：組合 gmacMath 的位元數、bit-true wrap 與截斷平衡點。
 */
import {
  accBitsExact,
  accBitsRule,
  productExtremes,
  truncationEquilibrium,
  worstCaseAccumulate,
  type CodeRange,
  type ShiftRounding,
} from './gmacMath'

export interface GmacSizingParams {
  bx: number
  log2N: number
  range: CodeRange
  rounding: ShiftRounding
  gFracBits: number
  sigmaV: number
  mu: number
}

export const DEFAULT_GMAC_PARAMS: GmacSizingParams = { bx: 6, log2N: 12, range: 'symmetric', rounding: 'floor', gFracBits: 0, sigmaV: 100, mu: 10 }

export interface GmacSizingOutput {
  N: number
  bitsSel: number
  bitsSym: number
  bitsFull: number
  bitsRule: number
  maxPos: number
  maxNeg: number
  okPos: ReturnType<typeof worstCaseAccumulate>
  okNeg: ReturnType<typeof worstCaseAccumulate>
  shortPos: ReturnType<typeof worstCaseAccumulate>
  shortNeg: ReturnType<typeof worstCaseAccumulate>
  eq: ReturnType<typeof truncationEquilibrium>
  /** 穩態 σ_w（線性化，d = 0，忽略截斷）[fs] */
  sigmaW: number
  /** g = μK */
  g: number
}

/** 計算器的全部輸出（純函式，測試直接呼叫） */
export function gmacSizing(p: GmacSizingParams): GmacSizingOutput {
  const N = 2 ** p.log2N
  const bitsSym = accBitsExact(p.bx, N, 'symmetric')
  const bitsFull = accBitsExact(p.bx, N, 'full')
  const bitsSel = p.range === 'full' ? bitsFull : bitsSym
  const { maxPos, maxNeg } = productExtremes(p.bx, p.range)
  const eq = truncationEquilibrium({ bx: p.bx, log2N: p.log2N, gFracBits: p.gFracBits, rounding: p.rounding, sigmaV: p.sigmaV })
  const g = p.mu * eq.derived.K
  const pole = 1 - g
  const sigmaEta2 = (eq.derived.xNorm * eq.derived.xNorm) / N
  const sigmaW = Math.abs(pole) < 1 ? Math.abs(p.mu) * Math.sqrt(sigmaEta2 / (1 - pole * pole)) : NaN
  return {
    N,
    bitsSel,
    bitsSym,
    bitsFull,
    bitsRule: accBitsRule(p.bx, N),
    maxPos,
    maxNeg,
    okPos: worstCaseAccumulate(p.bx, N, p.range, bitsSel, 1),
    okNeg: worstCaseAccumulate(p.bx, N, p.range, bitsSel, -1),
    shortPos: worstCaseAccumulate(p.bx, N, p.range, bitsSel - 1, 1),
    shortNeg: worstCaseAccumulate(p.bx, N, p.range, bitsSel - 1, -1),
    eq,
    sigmaW,
    g,
  }
}

/** 計算器的警告（每條都說明原因與後果） */
export function gmacWarnings(o: GmacSizingOutput, p: GmacSizingParams): string[] {
  const out: string[] = []
  if (p.range === 'full' && o.bitsRule < o.bitsFull) {
    out.push(
      `經驗法則 $B_x+\\lceil\\log_2N\\rceil=${o.bitsRule}$ bits 對 full-range code 不夠：條件取負 $-(-2^{B_x-1})=+2^{B_x-1}$ 讓最壞總和到 $+${o.maxPos * o.N}$，需要 ${o.bitsFull} bits（或把 code 限制成 symmetric）。`,
    )
  }
  const d = o.eq.derived
  if (d.ell > 0 && d.ditherLsb < 0.4) {
    out.push(
      `自然 dither 不足：截斷前 $S/2^{\\ell}$ 的標準差只有 ${d.ditherLsb.toFixed(3)} LSB（$<0.4$），近似式 $\\delta^*\\approx\\Delta_G/(2K)$ 的前提不成立；$E[\\hat G]$ 在一段 $\\delta$ 內幾乎為 0，$w$ 會停在死區內任何位置。保留更多小數 bit（加大 $F_G$）。`,
    )
  }
  if (!o.eq.hasEquilibrium) {
    out.push('$E[\\hat G]$ 在 $\\delta\\in\\pm12\\sigma_v$ 範圍內不變號：沒有平衡點，$w$ 會單向漂移直到飽和（截斷把正向更新全部吃掉）。')
  } else if (Number.isFinite(o.sigmaW) && Math.abs(o.eq.deltaStar) > o.sigmaW) {
    out.push(
      `截斷偏差 $|\\delta^*|=${Math.abs(o.eq.deltaStar).toPrecision(4)}$ fs 大於雜訊 $\\sigma_w=${o.sigmaW.toPrecision(4)}$ fs：GMAC 歸零時 $w$ 系統性偏離 $a$；需要${p.rounding === 'floor' ? '改用 round half up 或保留更多小數 bit（加大 $F_G$）' : '保留更多小數 bit（加大 $F_G$）'}。`,
    )
  }
  if (o.eq.hasEquilibrium && Number.isFinite(o.sigmaW) && o.eq.deadZone > 0.5 * o.sigmaW) {
    out.push(`死區寬 ${o.eq.deadZone.toPrecision(4)} fs（$>\\tfrac12\\sigma_w$）：在此區間內平均更新小於 $10^{-12}$ LSB/block，$w$ 停在哪裡取決於初值與雜訊歷史。`)
  }
  if (!(o.g > 0 && o.g < 2)) out.push(`$g=\\mu K=${o.g.toPrecision(4)}$ 不在 $(0,2)$：一階平均模型不穩定，$\\sigma_w$ 與偏差的比較不適用。`)
  return out
}
