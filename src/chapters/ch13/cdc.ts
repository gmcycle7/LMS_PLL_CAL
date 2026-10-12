/**
 * Ch13 §13.6 第 4 點：code 跨 clock domain（CDC）時的位元統計（純函式；cdc.test.ts 驗證）。
 *
 * - gray 碼（reflected binary）：gray(n) = n ⊕ ⌊n/2⌋。它是 GF(2) 上的線性運算，所以 gray(a) ⊕ gray(b) = gray(a ⊕ b)；
 *   只有 a ⊕ b = 2^k − 1（也就是 a、b 相鄰）時才只剩 1 個 bit。|Δ| = 2 恰好差 2 個 bit；
 *   |Δ| = 3 時較小的那個數是偶數差 1 個 bit、是奇數差 3 個 bit（32 → 35 差 1 個、31 → 34 差 3 個）。
 * - 接收端在轉換瞬間取樣時，每個「正在變的 bit」各自可能是舊值或新值：H 個 bit 不同就有 2^H 種讀到的字（mixedSamples）。
 * - 本檔只做位元運算與計數；量化策略的 code 序列由 src/simulation/models/quantizer.ts 產生。
 */

/** 二進位 → gray 碼：n ⊕ ⌊n/2⌋。 */
export function grayEncode(n: number): number {
  return (n ^ (n >>> 1)) >>> 0
}

/** gray 碼 → 二進位：最高位照抄，其餘每一位 b_k = b_{k+1} ⊕ g_k（等於把 g、g≫1、g≫2、… 全部 XOR 起來）。 */
export function grayDecode(g: number): number {
  let n = 0
  for (let x = g >>> 0; x; x >>>= 1) n ^= x
  return n >>> 0
}

/** Hamming 距離：兩個字的位元表示有幾個 bit 不同。 */
export function hamming(a: number, b: number): number {
  let x = (a ^ b) >>> 0
  let c = 0
  while (x) {
    c += x & 1
    x >>>= 1
  }
  return c
}

/**
 * code 由 from 變成 to 的瞬間被另一個 clock 取樣時，所有可能讀到的字與它解碼後的值（依字的數值由小到大）：
 * 兩個字不同的每個 bit 各自取舊值或新值，共 2^H 種組合。
 */
export function mixedWords(from: number, to: number, code: 'binary' | 'gray'): { word: number; value: number }[] {
  const enc = code === 'gray' ? grayEncode : (n: number) => n >>> 0
  const dec = code === 'gray' ? grayDecode : (n: number) => n >>> 0
  const a = enc(from)
  const diff = (a ^ enc(to)) >>> 0
  const bits: number[] = []
  for (let i = 0; i < 32; i++) if ((diff >>> i) & 1) bits.push(i)
  const out: { word: number; value: number }[] = []
  for (let m = 0; m < 2 ** bits.length; m++) {
    let w = a
    bits.forEach((b, j) => {
      if ((m >>> j) & 1) w = (w ^ (1 << b)) >>> 0
    })
    out.push({ word: w, value: dec(w) })
  }
  return out.sort((p, q) => p.word - q.word)
}

/** 同上，只留解碼後的值（由小到大、不重複）。 */
export function mixedSamples(from: number, to: number, code: 'binary' | 'gray'): number[] {
  return [...new Set(mixedWords(from, to, code).map((m) => m.value))].sort((p, q) => p - q)
}

export interface CdcStats {
  /** code 有改變的更新次數 */
  trans: number
  /** 其中二進位表示一次翻超過 1 個 bit 的次數 */
  multi: number
  /** 二進位表示的最大 Hamming 距離 */
  maxH: number
  /** 其中 gray 碼一次翻超過 1 個 bit 的次數 */
  grayMulti: number
  /** gray 碼的最大 Hamming 距離 */
  grayMaxH: number
  /** 一次更新最多跳幾個 LSB：max|Δy| */
  maxStep: number
  /** |Δy| ≥ 2 的次數（不能由 grayMulti 反推：32 → 35 跳 3 LSB 但 gray 碼只翻 1 個 bit） */
  multiStep: number
}

/** 一段 code 序列 y[n] 的 CDC 統計（Δy[n] = y[n] − y[n−1]；y[n] = y[n−1] 的更新不算切換）。 */
export function cdcStats(y: ArrayLike<number>): CdcStats {
  const s: CdcStats = { trans: 0, multi: 0, maxH: 0, grayMulti: 0, grayMaxH: 0, maxStep: 0, multiStep: 0 }
  for (let i = 1; i < y.length; i++) {
    if (y[i] === y[i - 1]) continue
    s.trans++
    const h = hamming(y[i], y[i - 1])
    if (h > 1) s.multi++
    if (h > s.maxH) s.maxH = h
    const gh = hamming(grayEncode(y[i]), grayEncode(y[i - 1]))
    if (gh > 1) s.grayMulti++
    if (gh > s.grayMaxH) s.grayMaxH = gh
    const step = Math.abs(y[i] - y[i - 1])
    if (step >= 2) s.multiStep++
    if (step > s.maxStep) s.maxStep = step
  }
  return s
}
