import { runQuantLab, type QuantStrategy } from '@/simulation/models/quantizer'
import { cdcStats, grayDecode, grayEncode, hamming, mixedSamples, mixedWords, type CdcStats } from './cdc'
import { DEFAULT_LAB_PARAMS } from './common'

/**
 * 審查 R04：gray 碼「只翻 1 個 bit、最壞差 1 LSB」只對相鄰的 code（|Δy| = 1）成立。
 * 這裡的期望值都另外用 Python（reflect-and-prefix 建表，不用 XOR 公式）與站內模型各算過一次。
 */

const b6 = (n: number) => n.toString(2).padStart(6, '0')

/** [trans, multi, maxH, grayMulti, grayMaxH, maxStep, multiStep] */
const row = (s: CdcStats) => [s.trans, s.multi, s.maxH, s.grayMulti, s.grayMaxH, s.maxStep, s.multiStep]

/** §13.6 第 4 點那張表的情境（NonIdeal.tsx 的同一個呼叫）；seed 與「w_H 是否含 LMS 雜訊」可換。 */
function tableScenario(opts: { seed?: number; lmsNoise?: boolean } = {}): Record<QuantStrategy, CdcStats> {
  const lab = runQuantLab({
    params: { ...DEFAULT_LAB_PARAMS, seed: opts.seed ?? DEFAULT_LAB_PARAMS.seed, mixing: false, length: 4096, traceLen: 4096 },
    cases: [],
    compareAll: true,
    compareScenario: { lmsNoise: opts.lmsNoise ?? true, nUpd: 1 },
  })
  return Object.fromEntries(lab.compare.map((r) => [r.strategy, cdcStats(r.trace.y)])) as Record<QuantStrategy, CdcStats>
}

describe('cdc：gray 碼與混合取樣（位元運算）', () => {
  it('反例（審查 R04）：31 → 34 的 gray 碼是 010000 → 110011，差 3 個 bit；取樣到新舊混合的字可能讀到 28 到 35', () => {
    expect(grayEncode(31)).toBe(0b010000)
    expect(grayEncode(34)).toBe(0b110011)
    expect(hamming(grayEncode(31), grayEncode(34))).toBe(3)
    // 不同的是 bit 5、bit 1、bit 0（正文手算第 3 步）
    expect(b6(grayEncode(31) ^ grayEncode(34))).toBe('100011')
    // 審查舉的混合字 010011 解碼是 29；010010 是 28（比舊值 31 還低 3 LSB）
    expect(grayDecode(0b010011)).toBe(29)
    expect(grayDecode(0b010010)).toBe(28)
    expect(mixedSamples(31, 34, 'gray')).toEqual([28, 29, 30, 31, 32, 33, 34, 35])
    // 8 種新舊組合逐一解碼（正文手算第 6 步列的就是這 8 項）
    expect(mixedWords(31, 34, 'gray').map((m) => `${b6(m.word)}→${m.value}`)).toEqual([
      '010000→31',
      '010001→30',
      '010010→28',
      '010011→29',
      '110000→32',
      '110001→33',
      '110010→35',
      '110011→34',
    ])
  })

  it('正常對照：相鄰的 31 → 32，gray 碼只差 1 個 bit、只會讀到 31 或 32；二進位差 6 個 bit、可能讀到 0 到 63 的任何值', () => {
    expect(grayEncode(32)).toBe(0b110000)
    expect(hamming(grayEncode(31), grayEncode(32))).toBe(1)
    expect(mixedSamples(31, 32, 'gray')).toEqual([31, 32])
    expect(hamming(31, 32)).toBe(6)
    const bin = mixedSamples(31, 32, 'binary')
    expect(bin).toHaveLength(64)
    expect(bin[0]).toBe(0)
    expect(bin[63]).toBe(63)
    for (let a = 0; a < 64; a++) expect(grayDecode(grayEncode(a)), `a = ${a}`).toBe(a)
    // gray 碼是一對一：64 個 code 對到 64 個不同的字
    expect(new Set(Array.from({ length: 64 }, (_, a) => grayEncode(a))).size).toBe(64)
  })

  it('6-bit 全部列舉：跳 1 LSB 恰好翻 1 個 bit、跳 2 LSB 恰好翻 2 個；跳 3 LSB 時較小的 code 是偶數翻 1 個（32 → 35）、是奇數翻 3 個（31 → 34）', () => {
    for (let a = 0; a < 64; a++) {
      if (a + 1 < 64) expect(hamming(grayEncode(a), grayEncode(a + 1)), `${a} → ${a + 1}`).toBe(1)
      if (a + 2 < 64) expect(hamming(grayEncode(a), grayEncode(a + 2)), `${a} → ${a + 2}`).toBe(2)
      if (a + 3 < 64) expect(hamming(grayEncode(a), grayEncode(a + 3)), `${a} → ${a + 3}`).toBe(a % 2 === 0 ? 1 : 3)
    }
    // 兩個方向都要守住：「gray 碼永遠只翻 1 個 bit」是錯的，「多 LSB 的跳動一定是多 bit 翻轉」也是錯的
    expect(b6(grayEncode(32))).toBe('110000')
    expect(b6(grayEncode(35))).toBe('110010')
    expect(mixedSamples(32, 35, 'gray')).toEqual([32, 35])
    // 混合取樣離開 [舊值, 新值] 區間最遠多少：跳 1 LSB 是 0、跳 2 LSB 是 1、跳 3 LSB 是 3（31 → 34 讀到 28）
    const worst = (step: number) => {
      let w = 0
      for (let a = 0; a + step < 64; a++) for (const v of mixedSamples(a, a + step, 'gray')) w = Math.max(w, a - v, v - (a + step))
      return w
    }
    expect([1, 2, 3].map(worst)).toEqual([0, 1, 3])
  })

  it('cdcStats：手排的短序列（含不變的更新、相鄰、跳 2、跳 3 的兩種情形）', () => {
    // 32 → 32（不算切換）→ 33（1 LSB）→ 31（2 LSB；二進位 100001 → 011111 差 5、gray 110001 → 010000 差 2）
    // → 34（3 LSB；二進位 011111 → 100010 差 5、gray 差 3）→ 32 → 35（3 LSB；二進位 100000 → 100011 差 2、gray 差 1）
    const s = cdcStats([32, 32, 33, 31, 34, 32, 35])
    expect(s.trans).toBe(5)
    expect(s.maxStep).toBe(3)
    expect(s.multiStep).toBe(4) // 33→31、31→34、34→32、32→35
    expect(s.multi).toBe(3) // 33→31（5）、31→34（5）、32→35（2）；34→32 是 100010 → 100000，只差 1
    expect(s.maxH).toBe(5)
    expect(s.grayMulti).toBe(3) // 33→31（2）、31→34（3）、34→32（2）；32→35 只差 1
    expect(s.grayMaxH).toBe(3)
    expect(row(cdcStats([]))).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(row(cdcStats([7, 7, 7]))).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('cdc：量化策略的 code 序列（站內模型 runQuantLab）', () => {
  it('§13.6 的表（w_H 含 LMS 雜訊、4096 次更新、預設 seed）：二進位三欄不變；D 有 3 次跳 2 LSB，E 有 462 次跳 2 LSB 以上、gray 碼仍有 462 次多 bit 翻轉', () => {
    const t = tableScenario()
    expect(row(t.freeze)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(row(t.toggle)).toEqual([2376, 4, 6, 0, 1, 1, 0])
    expect(row(t.stochastic)).toEqual([1755, 4, 6, 0, 1, 1, 0])
    expect(row(t.deltaSigma)).toEqual([2704, 6, 6, 3, 2, 2, 3])
    expect(row(t.deltaSigmaDither)).toEqual([2777, 403, 6, 462, 3, 3, 462])
  })

  it('§13.6 讀表文字「gray 碼最多翻 3 個 bit，就是上面手算的 31 → 34」：同一張表的 E，gray 碼差 3 個 bit 的切換全部是 31 ↔ 34（14 + 19 次）', () => {
    const lab = runQuantLab({
      params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 4096, traceLen: 4096 },
      cases: [],
      compareAll: true,
      compareScenario: { lmsNoise: true, nUpd: 1 },
    })
    const y = lab.compare.find((r) => r.strategy === 'deltaSigmaDither')!.trace.y
    const steps: Record<number, number> = {}
    const threeBit: Record<string, number> = {}
    for (let i = 1; i < y.length; i++) {
      if (y[i] === y[i - 1]) continue
      const d = Math.abs(y[i] - y[i - 1])
      steps[d] = (steps[d] ?? 0) + 1
      if (hamming(grayEncode(y[i]), grayEncode(y[i - 1])) === 3) {
        const k = `${y[i - 1]}→${y[i]}`
        threeBit[k] = (threeBit[k] ?? 0) + 1
      }
    }
    // 2777 次切換 = 2315 次跳 1 LSB + 429 次跳 2 LSB + 33 次跳 3 LSB；429 + 33 = 462
    expect(steps).toEqual({ 1: 2315, 2: 429, 3: 33 })
    expect(threeBit).toEqual({ '31→34': 14, '34→31': 19 })
  })

  it('「這次沒看到」不是保證（反面測試）：同一個情境只換 seed = 2，C 出現一次 31 → 33 的 2 LSB 跳動；E 的 gray 多 bit 翻轉（423）反而比二進位（428）少', () => {
    const t = tableScenario({ seed: 2 })
    expect(row(t.stochastic)).toEqual([1717, 2, 6, 1, 2, 2, 1])
    expect(t.stochastic.maxStep).toBe(2)
    expect(row(t.deltaSigmaDither)).toEqual([2695, 428, 6, 423, 3, 3, 423])
    // 預設 seed 是 462 > 403，seed = 2 是 423 < 428：「gray 比二進位多」不是可以寫進正文的結論
    expect(t.deltaSigmaDither.grayMulti).toBeLessThan(t.deltaSigmaDither.multi)
    expect(tableScenario().deltaSigmaDither.grayMulti).toBeGreaterThan(tableScenario().deltaSigmaDither.multi)
  })

  it('正常對照：w_H 固定不動時 B、C、D 只在相鄰的兩個 code 之間切換（gray 碼的前提成立）；E 仍然會跳 2、3 LSB', () => {
    const t = tableScenario({ lmsNoise: false })
    for (const s of ['toggle', 'stochastic', 'deltaSigma'] as const) {
      expect(t[s].trans, s).toBeGreaterThan(1000)
      expect(t[s].maxStep, s).toBe(1)
      expect(t[s].multiStep, s).toBe(0)
      expect(t[s].multi, s).toBe(0)
      expect(t[s].grayMulti, s).toBe(0)
    }
    expect(row(t.deltaSigmaDither)).toEqual([2914, 274, 5, 324, 3, 3, 324])
  })

  it('§13.4E 的情境（常數 32.4、A = 1 LSB RPDF、2^14 次更新）：6.9% 的更新跳 2 LSB、0.7% 跳 3 LSB，3 LSB 的全是 31 ↔ 34；與精確的穩態機率 42/625、4/625 相符', () => {
    const lab = runQuantLab({
      params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 1 << 14, traceLen: 1 << 14, ditherLsb: 1, ditherPdf: 'uniform' },
      cases: [{ id: 'E', strategy: 'deltaSigmaDither', lmsNoise: false, nUpd: 1 }],
      compareAll: false,
    })
    const y = lab.runs[0].trace.y
    expect(y.length).toBe(1 << 14)
    let j2 = 0
    let j3 = 0
    const pairs: Record<string, number> = {}
    for (let i = 1; i < y.length; i++) {
      const d = Math.abs(y[i] - y[i - 1])
      if (d === 2) j2++
      if (d >= 3) {
        j3++
        const k = `${y[i - 1]}→${y[i]}`
        pairs[k] = (pairs[k] ?? 0) + 1
      }
    }
    expect(j2).toBe(1134)
    expect(j3).toBe(116)
    expect(pairs).toEqual({ '31→34': 54, '34→31': 62 })
    const s = cdcStats(y)
    expect([s.trans, s.multi, s.grayMulti, s.maxStep, s.multiStep]).toEqual([11600, 1080, 1250, 3, 1250])
    // 獨立對照：(r, y) 的有限 Markov chain 以有理數解出的穩態機率 P(|Δy| = 2) = 42/625、P(|Δy| = 3) = 4/625
    const n = y.length - 1
    expect(Math.abs(j2 / n - 42 / 625)).toBeLessThan(0.01)
    expect(Math.abs(j3 / n - 4 / 625)).toBeLessThan(0.003)
  })
})
