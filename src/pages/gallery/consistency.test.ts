import { ALL_PRESETS } from '@/app/presets'
import { fixedXPole, runScalarLms } from '@/simulation/models/lms'
import { checkExpected, detectionWindow, matchCoverage, perturbMetrics, reliabilityRows, unionLength } from './consistency'
import { GALLERY_EXPECTED_KEYS } from './data'
import { extractNumbers } from './format'

/** §19.2 #1 的 preset（T01 的輸入）；重算值由 runScalarLms / fixedXPole 產生 */
const hand = ALL_PRESETS.find((p) => p.galleryIndex === 1)

function handMetrics(poleFn: (mu: number, x: number) => number = fixedXPole) {
  if (!hand) throw new Error('缺少 galleryIndex = 1 的 preset')
  const { a, w0, x, mu } = hand.params as { a: number; w0: number; x: number; mu: number }
  const run = runScalarLms({ variant: 'conventional', a, w0, mu, steps: 3, x: { kind: 'fixed', value: x }, noiseSigma: 0 })
  return [
    { key: 'w1', value: run.w[1] },
    { key: 'w2', value: run.w[2] },
    { key: 'pole', value: poleFn(mu, x) },
    { key: 'w3', value: run.w[3] }, // 非必備：文字沒寫 w₃
  ]
}

describe('checkExpected：重算值 vs 預期文字', () => {
  it('#1 手算例：三個必備數值都相符 ⇒ ok；非必備且文字沒寫的量標為 absent（不是錯）', () => {
    expect(hand).toBeDefined()
    const chk = checkExpected(hand!, handMetrics())
    expect(chk.status).toBe('ok')
    expect(chk.missingKeys).toEqual([])
    expect(Object.fromEntries(chk.rows.map((r) => [r.key, r.status]))).toEqual({ w1: 'match', w2: 'match', pole: 'match', w3: 'absent' })
    expect(chk.rows.find((r) => r.key === 'w2')?.hit?.raw).toBe('2.28')
  })

  it('反面測試（規格 §17 末段「模型公式有錯，UI 卻顯示成功」）：pole 公式寫成 1 + μx² ⇒ mismatch 並指出是哪一個', () => {
    const wrong = handMetrics((mu, x) => 1 + mu * x * x) // 1.4，不是 0.6
    const chk = checkExpected(hand!, wrong)
    expect(chk.status).toBe('mismatch')
    expect(chk.rows.find((r) => r.key === 'pole')?.status).toBe('mismatch')
    expect(chk.note).toContain('pole')
    expect(chk.note).not.toContain('w1、')
  })

  it('反面測試：必備數值在預覽中不見了（預覽程式回歸）⇒ mismatch，列在 missingKeys', () => {
    const chk = checkExpected(hand!, handMetrics().filter((m) => m.key !== 'w2'))
    expect(chk.status).toBe('mismatch')
    expect(chk.missingKeys).toEqual(['w2'])
    expect(chk.note).toContain('w2（預覽未產生）')
  })

  it('反面測試：必備數值是 NaN ⇒ mismatch；非必備的 NaN 與字串只是 skip', () => {
    const m = handMetrics().map((x) => (x.key === 'w1' ? { ...x, value: NaN } : x))
    const chk = checkExpected(hand!, [...m, { key: 'label', value: '[1.3, 1.5]' }, { key: 'opt', value: Infinity }])
    expect(chk.status).toBe('mismatch')
    expect(chk.rows.find((r) => r.key === 'w1')?.status).toBe('mismatch')
    expect(chk.rows.find((r) => r.key === 'label')?.status).toBe('skip')
    expect(chk.rows.find((r) => r.key === 'opt')?.status).toBe('skip')
  })

  it('沒有宣告必備數值的 preset：狀態 n/a，只報告夠精確的相符數字（小整數不算）', () => {
    const p = { id: 'not-a-gallery-preset', expected: 'σ_w = 0.39919 fs、共 2 個 pole、約 598 blocks' }
    const chk = checkExpected(p, [
      { key: 'sigmaW', value: 0.3991861 },
      { key: 'two', value: 2 }, // 文字有「2」，但 2 不夠精確，非必備數值不拿它當證據
      { key: 'k95', value: 597.65 },
      { key: 'other', value: 12.3 },
    ])
    expect(chk.status).toBe('n/a')
    expect(Object.fromEntries(chk.rows.map((r) => [r.key, r.status]))).toEqual({ sigmaW: 'match', two: 'absent', k95: 'match', other: 'absent' })
  })

  it('容差倍數 k：k < 1 更嚴格（連正確的重算值也可能對不上），k > 1 更寬鬆', () => {
    const p = { id: 'x', expected: 'p = 0.920212' }
    const m = [{ key: 'p', value: 0.9202115439197135 }] // 與 0.920212 差 4.6e-7 < 5e-7
    expect(checkExpected(p, m, 1.001).rows[0].status).toBe('match')
    expect(checkExpected(p, m, 0.5).rows[0].status).toBe('absent')
    expect(checkExpected(p, [{ key: 'p', value: 0.920213 }], 1.001).rows[0].status).toBe('absent')
    expect(checkExpected(p, [{ key: 'p', value: 0.920213 }], 3).rows[0].status).toBe('match')
  })

  it('GALLERY_EXPECTED_KEYS 的每個 key 都是非空字串、同一個 preset 內不重複', () => {
    for (const [id, keys] of Object.entries(GALLERY_EXPECTED_KEYS)) {
      expect(keys.length, id).toBeGreaterThan(0)
      expect(new Set(keys).size, id).toBe(keys.length)
    }
  })
})

describe('detectionWindow（F-GA.2）：解 |ŷ(1+ε) − y_t| ≤ W', () => {
  it('ŷ > 0：視窗兩端代回去剛好在接受區間的邊界上，視窗外不相符', () => {
    const hit = extractNumbers('2.28')[0]
    const v = 2.2800000000000002
    const w = detectionWindow(v, hit, 1)
    expect(v * (1 + w.lo)).toBeCloseTo(2.275, 12)
    expect(v * (1 + w.hi)).toBeCloseTo(2.285, 12)
    expect(w.lo).toBeCloseTo(-0.005 / 2.28, 9)
    expect(w.hi).toBeCloseTo(0.005 / 2.28, 9)
  })

  it('ŷ < 0：兩端對調後仍然 lo < hi，且包含 ε = 0', () => {
    const hit = extractNumbers('-93.799')[0]
    const w = detectionWindow(-93.79873541326019, hit, 1)
    expect(w.lo).toBeLessThan(0)
    expect(w.hi).toBeGreaterThan(0)
    expect(-93.79873541326019 * (1 + w.lo)).toBeCloseTo(-93.7985, 9)
    expect(-93.79873541326019 * (1 + w.hi)).toBeCloseTo(-93.7995, 9)
  })

  it('短數字：視窗窄到只剩相對 1e-9；k 只放大夠精確數字的視窗', () => {
    const short = extractNumbers('0.6')[0]
    const w = detectionWindow(0.6, short, 1)
    expect(w.hi - w.lo).toBeCloseTo(2e-9 / 0.6, 12)
    expect(detectionWindow(0.6, short, 5)).toEqual(w)
    const precise = extractNumbers('1.019804')[0]
    const w1 = detectionWindow(1.019803902718557, precise, 1)
    const w2 = detectionWindow(1.019803902718557, precise, 2)
    expect(w2.hi - w2.lo).toBeCloseTo(2 * (w1.hi - w1.lo), 12)
  })

  it('ŷ = 0 或非有限：相對誤差沒有定義，回傳整條實數線', () => {
    const hit = extractNumbers('0.25')[0]
    expect(detectionWindow(0, hit)).toEqual({ lo: -Infinity, hi: Infinity })
    expect(detectionWindow(NaN, hit)).toEqual({ lo: -Infinity, hi: Infinity })
  })
})

describe('unionLength / matchCoverage（F-GA.3）', () => {
  it('unionLength：重疊的區間只算一次，空區間不算', () => {
    expect(unionLength([])).toBe(0)
    expect(unionLength([{ lo: 0, hi: 1 }])).toBe(1)
    expect(unionLength([{ lo: 0, hi: 1 }, { lo: 0.5, hi: 2 }])).toBe(2)
    expect(unionLength([{ lo: 3, hi: 4 }, { lo: 0, hi: 1 }, { lo: 1, hi: 1 }, { lo: 2, hi: 1 }])).toBe(2)
    expect(unionLength([{ lo: 0, hi: 1 }, { lo: 1, hi: 2 }])).toBe(2) // 相接
  })

  it('只有一個數字：P_self = 視窗長度 / (2ε_max)，P_other = 0', () => {
    const nums = extractNumbers('w₂ = 2.28')
    const cov = matchCoverage(2.28, nums, nums[0], 0.1, 1)
    expect(cov.self).toBeCloseTo(0.01 / 2.28 / 0.2, 9) // 視窗全長 2·0.005/2.28，除以 2·0.1
    expect(cov.other).toBeCloseTo(0, 12)
    expect(cov.total).toBeCloseTo(cov.self, 12)
  })

  it('文字裡還有另一個夠精確、又落在 ±ε_max 內的數字 ⇒ P_other > 0，數值可手算', () => {
    const nums = extractNumbers('exact 12.931 kHz（近似 12.924）')
    const cov = matchCoverage(12.931284, nums, nums[0], 0.01, 1)
    // 兩個接受區間各寬 0.001（±0.0005），互不重疊，都在 ±1% 內：各占 0.001/12.931284/0.02
    const each = 0.001 / 12.931284 / 0.02
    expect(cov.self).toBeCloseTo(each, 9)
    expect(cov.other).toBeCloseTo(each, 9)
    expect(cov.total).toBeCloseTo(2 * each, 9)
  })

  it('ε_max 比視窗還小：P_self 夾在 1；ε_max ≤ 0 或 ŷ = 0 回傳 NaN', () => {
    const nums = extractNumbers('2.28')
    expect(matchCoverage(2.28, nums, nums[0], 1e-5, 1).self).toBeCloseTo(1, 12)
    expect(matchCoverage(2.28, nums, nums[0], 0, 1).total).toBeNaN()
    expect(matchCoverage(0, nums, nums[0], 0.1, 1).total).toBeNaN()
  })

  it('小整數不會造成巧合相符：#1 的文字有「2」「3」，w₂ 的 P_other 仍然是 0', () => {
    const nums = extractNumbers(hand!.expected)
    const hit = nums.find((n) => n.raw === '2.28')!
    const cov = matchCoverage(2.2800000000000002, nums, hit, 0.5, 1) // ±50%：範圍內有「2」「3」「1.8」「1.2」
    expect(cov.other).toBeLessThan(1e-7) // 短數字只接受相等：區間長度 ~1e-9
    expect(cov.self).toBeGreaterThan(0)
  })
})

describe('perturbMetrics / reliabilityRows', () => {
  it('perturbMetrics：有限數值乘上 (1 + ε)，字串與 NaN 不動；ε = 0 回傳同一個陣列', () => {
    const m = [
      { key: 'a', value: 2 },
      { key: 'b', value: 'text' },
      { key: 'c', value: NaN },
    ]
    expect(perturbMetrics(m, 0)).toBe(m)
    const out = perturbMetrics(m, 0.01)
    expect(out[0].value).toBeCloseTo(2.02, 12)
    expect(out[1].value).toBe('text')
    expect(out[2].value).toBeNaN()
    expect(m[0].value).toBe(2) // 不改動輸入
  })

  it('反面測試：#1 的重算值注入 1% 誤差 ⇒ mismatch；注入的誤差在視窗內（1e-5）⇒ w₂ 仍相符', () => {
    const base = handMetrics()
    expect(checkExpected(hand!, perturbMetrics(base, 0.01)).status).toBe('mismatch')
    const tiny = checkExpected(hand!, perturbMetrics(base, 1e-5))
    expect(tiny.rows.find((r) => r.key === 'w2')?.status).toBe('match') // 2.28 有 3 位有效數字：1e-5 抓不到
    expect(tiny.rows.find((r) => r.key === 'w1')?.status).toBe('mismatch') // 1.8 是短數字：要求相等
  })

  it('reliabilityRows：只列相符的必備數值；視窗一定包含 0；注入視窗外的 ε 一定 mismatch', () => {
    const base = handMetrics()
    const rows = reliabilityRows(hand!, base, 0.1, 1)
    expect(rows.map((r) => r.key)).toEqual(['w1', 'w2', 'pole'])
    for (const r of rows) {
      expect(r.window.lo).toBeLessThanOrEqual(0)
      expect(r.window.hi).toBeGreaterThanOrEqual(0)
      expect(r.coverage.self).toBeGreaterThan(0)
      expect(r.coverage.self).toBeLessThanOrEqual(1)
    }
    const w2 = rows.find((r) => r.key === 'w2')!
    const outside = w2.window.hi * 1.5
    expect(checkExpected(hand!, perturbMetrics(base, outside)).rows.find((r) => r.key === 'w2')?.status).toBe('mismatch')
    const inside = w2.window.hi * 0.5
    expect(checkExpected(hand!, perturbMetrics(base, inside)).rows.find((r) => r.key === 'w2')?.status).toBe('match')
  })

  it('沒有宣告必備數值的 preset：reliabilityRows 為空', () => {
    expect(reliabilityRows({ id: 'nope', expected: '2.28' }, [{ key: 'w2', value: 2.28 }], 0.1)).toEqual([])
  })
})
