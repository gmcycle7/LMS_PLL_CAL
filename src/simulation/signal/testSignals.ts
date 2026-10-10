/**
 * 測試用的可重現訊號（僅供 *.test.ts 使用，不從 index.ts 匯出）。
 * 以 32-bit LCG（Numerical Recipes：s ← 1664525·s + 1013904223 mod 2³²）產生，
 * 與 Python 版本逐位元相同，因此可把 SciPy 計算的參考值直接貼進測試：
 *
 *   def lcg(n, seed):
 *       s = seed & 0xFFFFFFFF; out = []
 *       for i in range(n):
 *           s = (1664525*s + 1013904223) & 0xFFFFFFFF; out.append(s / 2**32)
 *   test_signal(n, seed) = 1.5*sin(2π·0.1234·k) + 2*(lcg − 0.5) + 0.3
 */

/** u[i] ∈ [0, 1)，與 Python 的 lcg(n, seed) 相同。 */
export function lcg(n: number, seed: number): Float64Array {
  let s = seed >>> 0
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    out[i] = s / 4294967296
  }
  return out
}

/** 1.5·sin(2π·0.1234·k) + 2·(u − 0.5) + 0.3：tone + 均勻雜訊 + DC。 */
export function testSignal(n: number, seed: number): Float64Array {
  const u = lcg(n, seed)
  const x = new Float64Array(n)
  for (let k = 0; k < n; k++) x[k] = 1.5 * Math.sin(2 * Math.PI * 0.1234 * k) + 2 * (u[k] - 0.5) + 0.3
  return x
}

/** 相對誤差 |a − b| / max(|b|, floor)。 */
export function relErr(a: number, b: number, floor = 1e-300): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), floor)
}
