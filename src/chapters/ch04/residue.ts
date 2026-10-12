/**
 * Ch04 §2：一階 DSM 累加器與 fractional residue（規格 §4、§4.1 第一列）。
 *
 * 一階累加器（B-bit，M = 2^B，FCW 小數字 K_F，frac = K_F/M）：
 *   t[n] = s[n−1] + K_F；y[n] = (t[n] ≥ M)；s[n] = t[n] − M·y[n]
 *   ⇒ M·y[n] = K_F − (s[n] − s[n−1])
 *   ⇒ r[n] := Σ_{m=0}^{n} (y[m] − frac) = −(s[n] − s[−1])/M   [T_vco]（feedback（divider）edge 的累積時間誤差，正 = 晚到）
 *
 * 架構（全站約定，docs/assumptions.md §2a）：DTC 在 reference 輸入端。feedback edge 早到 −r[n]·T_vco，所以 reference edge 也要提前這麼多：
 * 這個「需要的補償量」就是下面的 dtcNeedFs（DTC 的延遲是基準延遲 T_0 減掉實際的補償量）。變數名稱沿用 need / resid，數值與原來相同。
 *
 * firstOrderAccumulator 是頁面手算表實際執行的程式碼；residue.test.ts 以 dsm.ts（runDsm）逐點交叉比對。
 * residueSignals 則直接呼叫 dsm.ts 產生互動圖用的序列（一階或 MASH 1-1-1）。純數值、無 React/DOM。
 */

import { runDsm, type DsmKind } from '@/simulation/models/dsm'

export interface AccumulatorRow {
  n: number
  /** s[n−1] */
  sPrev: number
  /** t[n] = s[n−1] + K_F */
  t: number
  /** carry y[n] ∈ {0, 1}：這個 reference cycle divider 多除一個 VCO 週期 */
  y: number
  /** s[n]：留在累加器內的餘數（= DTC code） */
  s: number
  /** Σ_{m≤n} (y[m] − K_F/M)：逐項累加的時間誤差 [T_vco] */
  cumErr: number
  /** −(s[n] − s[−1])/M：telescoping 後的封閉式 [T_vco] */
  residue: number
}

// #region core:firstOrderAccumulator
/** 一階 DSM：每個 reference cycle 做一次 t = s + K_F，溢位（carry）就是 divider 的 +1。 */
export function firstOrderAccumulator(KF: number, bits: number, length: number, s0 = 0): AccumulatorRow[] {
  const M = 2 ** bits
  const rows: AccumulatorRow[] = []
  let s = s0
  let cum = 0
  for (let n = 0; n < length; n++) {
    const sPrev = s
    const t = sPrev + KF // 累加 FCW 小數字
    const y = t >= M ? 1 : 0 // carry out：divider 這一拍除 N_int + 1
    s = t - M * y // 餘數留在累加器：這就是 DTC 要補償的量
    cum += y - KF / M // 實際多除的週期數 − 理想的 frac
    rows.push({ n, sPrev, t, y, s, cumErr: cum, residue: -(s - s0) / M })
  }
  return rows
}
// #endregion

export interface ResidueSignals {
  n: Float64Array
  /** divider modulus offset y[n] */
  y: Float64Array
  /** feedback（divider）edge 時間誤差 r[n]·T_vco [fs]（正 = 晚到） */
  edgeErrFs: Float64Array
  /** 需要的補償量 −r[n]·T_vco [fs]：reference edge 要提前（少延遲）的時間 */
  dtcNeedFs: Float64Array
  /** DTC gain 有 ε 相對誤差時，PD 看到的殘差（reference edge 減 feedback edge）ε·(−r[n]·T_vco) [fs] */
  residualFs: Float64Array
  tvcoFs: number
  period: number
  fracEff: number
  residueRange: [number, number]
  M: number
  K: number
  warnings: string[]
}

/** 互動圖用：dsm.ts 產生 y、residue，換算成 fs，並加上 DTC gain 誤差 ε 的殘差。 */
export function residueSignals(p: { kind: DsmKind; frac: number; bits: number; length: number; gainErrPct: number; fvcoGHz: number }): ResidueSignals {
  const r = runDsm({ kind: p.kind, frac: p.frac, bits: p.bits, length: p.length })
  const tvcoFs = 1e6 / p.fvcoGHz // T_vco = 1/f_vco；1 GHz ↔ 1e6 fs
  const eps = p.gainErrPct / 100
  const L = p.length
  const n = new Float64Array(L)
  const edge = new Float64Array(L)
  const need = new Float64Array(L)
  const resid = new Float64Array(L)
  for (let i = 0; i < L; i++) {
    n[i] = i
    edge[i] = r.residue[i] * tvcoFs
    need[i] = 0 - edge[i] // 0 − 0 = +0（避免顯示 −0）
    resid[i] = eps * need[i] + 0 // DTC 實際的補償量 (1 − ε)·need ⇒ 殘差 = need − (1 − ε)need = ε·need（+ 0 把 −0 變成 +0）
  }
  return {
    n,
    y: r.y,
    edgeErrFs: edge,
    dtcNeedFs: need,
    residualFs: resid,
    tvcoFs,
    period: r.period,
    fracEff: r.fracEff,
    residueRange: r.residueRange,
    M: r.M,
    K: r.K,
    warnings: r.warnings,
  }
}
