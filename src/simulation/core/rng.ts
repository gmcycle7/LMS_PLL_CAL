/**
 * 可重現亂數產生器（Reproducible PRNG）。
 *
 * - 核心：xoshiro128**（Blackman & Vigna, 2018），128-bit 狀態、32-bit 輸出，週期 2^128 − 1。
 * - Seeding：把 32-bit seed 送進 splitmix32 產生 4 個 32-bit 狀態字（state words）。
 * - uniform()：由兩個 32-bit 輸出組成 53-bit 尾數，值域 [0, 1)，解析度 2^-53。
 * - normal()：Box–Muller，成對產生並快取（cache）另一個 spare 值。
 * - fork(label)：只由「父 seed + label」雜湊出子 seed，與父串流已抽了多少數**無關**，
 *   因此同一實驗的各個雜訊源（comparator noise、dither、DSM…）可以各自獨立、可重現。
 *
 * 所有模擬隨機性一律經由 `createRng(seed)`（dev-conventions §3）；禁止 Math.random()。
 */

export interface Rng {
  /** 均勻分布 U[0, 1)，53-bit 解析度 */
  uniform(): number
  /** 標準常態 N(0, 1)（Box–Muller，含 spare cache） */
  normal(): number
  /** n 個 N(0, σ²) 樣本 */
  normalArray(n: number, sigma?: number): Float64Array
  /** n 個 U[0, 1) 樣本 */
  uniformArray(n: number): Float64Array
  /** 等機率 ±1（例如 iid ±1 pattern、Rademacher dither） */
  sign(): 1 | -1
  /** 均勻整數 lo…hiInclusive（rejection sampling，無模偏差 modulo bias） */
  int(lo: number, hiInclusive: number): number
  /** 以機率 p 回傳 true（p ≤ 0 恆為 false，p ≥ 1 恆為 true） */
  bernoulli(p: number): boolean
  /** 原始 32-bit 無號整數輸出 */
  uint32(): number
  /** 由 seed 與 label 衍生獨立、可重現的子串流 */
  fork(label: string | number): Rng
  /** 建立此串流用的 seed；`createRng(rng.seed)` 會重現同一串流（fork 出來的子串流亦然） */
  readonly seed: number
}

const TWO_POW_32 = 4294967296
const TWO_POW_53 = 9007199254740992
const TWO_PI = 2 * Math.PI

/** splitmix32 的一步：回傳 [下一個 state, 輸出]（Bryc 版本的常數）。 */
function splitmix32Step(state: number): [number, number] {
  const s = (state + 0x9e3779b9) | 0
  let z = s
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  z = z ^ (z >>> 15)
  return [s, z >>> 0]
}

/** 32-bit 混合函式（murmur3 fmix32），用於雜湊 seed 與 label。 */
function fmix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 把任意有限數值 seed 正規化為 32-bit 無號整數：先 Math.trunc 去掉小數，
 * 低 32 位直接使用；若超過 32 位（|seed| ≥ 2^32 或負數），高位以 fmix32 混入。
 * 對 0 ≤ seed < 2^32 的整數，正規化結果就是 seed 本身。
 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error(`createRng：seed 必須是有限數值（finite number），收到 ${String(seed)}`)
  }
  const s = Math.trunc(seed)
  const lo = s >>> 0
  const hi = Math.floor(s / TWO_POW_32)
  if (hi === 0) return lo
  return (lo ^ fmix32((hi >>> 0) ^ 0x5bd1e995)) >>> 0
}

/** FNV-1a 32-bit 字串雜湊（以 UTF-16 code unit 為單位）。 */
function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 由父 seed 與 label 衍生子 seed（32-bit）。
 * label 為數字時以 `String(label)` 雜湊，因此 fork(1) 與 fork('1') 相同。
 */
export function deriveSeed(seed: number, label: string | number): number {
  const parent = normalizeSeed(seed)
  const h = fnv1a32(String(label))
  const [, a] = splitmix32Step(parent ^ 0x632be5ab)
  return fmix32((a ^ Math.imul(h, 0x9e3779b1) ^ fmix32(h + 0x7f4a7c15)) >>> 0)
}

/**
 * 原始 xoshiro128** 產生器（給測試與進階使用）：以 4 個 32-bit 狀態字初始化，
 * 回傳逐次產生 32-bit 無號整數的函式。狀態不可全為 0。
 */
export function xoshiro128ss(s0: number, s1: number, s2: number, s3: number): () => number {
  let a = s0 >>> 0
  let b = s1 >>> 0
  let c = s2 >>> 0
  let d = s3 >>> 0
  if ((a | b | c | d) === 0) {
    throw new Error('xoshiro128**：狀態不可全為 0')
  }
  return () => {
    // result = rotl(s1 * 5, 7) * 9
    const t5 = Math.imul(b, 5)
    const result = Math.imul((t5 << 7) | (t5 >>> 25), 9) >>> 0
    const t = b << 9
    c ^= a
    d ^= b
    b ^= c
    a ^= d
    c ^= t
    d = (d << 11) | (d >>> 21)
    return result
  }
}

/** 由 32-bit seed 經 splitmix32 產生 xoshiro128** 的 4 個狀態字。 */
export function seedState(seed32: number): [number, number, number, number] {
  let st = seed32 | 0
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const [next, z] = splitmix32Step(st)
    st = next
    out.push(z)
  }
  // 全 0 狀態機率 2^-128，仍保險處理
  if ((out[0] | out[1] | out[2] | out[3]) === 0) out[0] = 0x9e3779b9
  return [out[0], out[1], out[2], out[3]]
}

/** 建立可重現的亂數串流。同一 seed ⇒ 完全相同的序列。 */
export function createRng(seed: number): Rng {
  const seed32 = normalizeSeed(seed)
  const [s0, s1, s2, s3] = seedState(seed32)
  const next = xoshiro128ss(s0, s1, s2, s3)
  let spare = 0
  let hasSpare = false

  const uniform = (): number => {
    // 53-bit：高 27 位 × 2^26 + 高 26 位
    const hi = next() >>> 5
    const lo = next() >>> 6
    return (hi * 67108864 + lo) / TWO_POW_53
  }

  const normal = (): number => {
    if (hasSpare) {
      hasSpare = false
      return spare
    }
    // u1 ∈ (0, 1]，避免 log(0)
    const u1 = 1 - uniform()
    const u2 = uniform()
    const r = Math.sqrt(-2 * Math.log(u1))
    const theta = TWO_PI * u2
    spare = r * Math.sin(theta)
    hasSpare = true
    return r * Math.cos(theta)
  }

  const rng: Rng = {
    seed,
    uniform,
    normal,
    normalArray(n: number, sigma = 1): Float64Array {
      const out = new Float64Array(Math.max(0, Math.floor(n)))
      for (let i = 0; i < out.length; i++) out[i] = sigma * normal()
      return out
    },
    uniformArray(n: number): Float64Array {
      const out = new Float64Array(Math.max(0, Math.floor(n)))
      for (let i = 0; i < out.length; i++) out[i] = uniform()
      return out
    },
    sign(): 1 | -1 {
      return next() >>> 31 ? 1 : -1
    },
    int(lo: number, hiInclusive: number): number {
      if (!Number.isInteger(lo) || !Number.isInteger(hiInclusive)) {
        throw new Error(`rng.int：上下界必須是整數，收到 (${lo}, ${hiInclusive})`)
      }
      if (hiInclusive < lo) {
        throw new Error(`rng.int：需要 lo ≤ hiInclusive，收到 (${lo}, ${hiInclusive})`)
      }
      const range = hiInclusive - lo + 1
      if (range <= TWO_POW_32) {
        // rejection sampling：丟掉不足一整輪的尾段，避免 modulo bias
        const limit = TWO_POW_32 - (TWO_POW_32 % range)
        let x = next()
        while (x >= limit) x = next()
        return lo + (x % range)
      }
      if (range > TWO_POW_53) {
        throw new Error('rng.int：範圍超過 2^53，無法以 double 精確表示')
      }
      // 大範圍：以 53-bit uniform 縮放（偏差 < 2^-53 × range，可忽略）
      return lo + Math.floor(uniform() * range)
    },
    bernoulli(p: number): boolean {
      return uniform() < p
    },
    uint32: next,
    fork(label: string | number): Rng {
      return createRng(deriveSeed(seed32, label))
    },
  }
  return rng
}
