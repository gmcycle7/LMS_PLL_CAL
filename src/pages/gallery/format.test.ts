import {
  acceptHalfWidth,
  decimalsOf,
  EXACT_REL,
  extractNumbers,
  findExpectedMatch,
  normalizeNumberText,
  plainNum,
  PRECISE_REL,
  rawToTex,
  sigForMatch,
  texArg,
  texNum,
  texRepr,
  texToPlain,
} from './format'

describe('數字 → 文字／TeX', () => {
  it('plainNum：一般數字去掉多餘 0，整數不轉科學記號', () => {
    expect(plainNum(1.8)).toBe('1.8')
    expect(plainNum(2.2800000000000002)).toBe('2.28')
    expect(plainNum(42499)).toBe('42499')
    expect(plainNum(0)).toBe('0')
    expect(plainNum(-0.25)).toBe('-0.25')
    expect(plainNum(0.5039893563146316, 6)).toBe('0.503989')
  })

  it('plainNum：|x| ≥ 1e6 或 < 1e-4 用科學記號；NaN / ∞ 有固定寫法', () => {
    expect(plainNum(4.0840704496667e-5, 5)).toBe('4.0841e-5')
    expect(plainNum(13e9)).toBe('1.3e10')
    expect(plainNum(NaN)).toBe('NaN')
    expect(plainNum(Infinity)).toBe('∞')
    expect(plainNum(-Infinity)).toBe('-∞')
  })

  it('texNum：科學記號寫成 a\\times10^{b}；texArg 把負數加括號', () => {
    expect(texNum(4.0840704496667e-5, 5)).toBe('4.0841\\times10^{-5}')
    expect(texNum(1.3e10)).toBe('1.3\\times10^{10}')
    expect(texNum(NaN)).toBe('\\text{NaN}')
    expect(texNum(Infinity)).toBe('\\infty')
    expect(texNum(-Infinity)).toBe('-\\infty')
    expect(texArg(-0.25)).toBe('(-0.25)')
    expect(texArg(0.1)).toBe('0.1')
  })

  it('rawToTex：保留文字原本寫出的位數與格式', () => {
    expect(rawToTex('0.5000')).toBe('0.5000')
    expect(rawToTex('4.0841×10^-5')).toBe('4.0841\\times10^{-5}')
    expect(rawToTex('1.5e-3')).toBe('1.5\\times10^{-3}')
    expect(rawToTex('78.75%')).toBe('78.75\\%')
    expect(rawToTex('42,499')).toBe('42{,}499')
  })

  it('texToPlain：$…$ 內的常見 TeX 轉成 Unicode，其餘文字不變', () => {
    expect(texToPlain('單位 $\\mathrm{fs^{-1}}$')).toBe('單位 fs^-1')
    expect(texToPlain('$\\mu=0.1$ 時 $p\\le1$')).toBe('μ=0.1 時 p≤1')
    expect(texToPlain('$\\frac{a}{b}$')).toBe('(a)/(b)')
    expect(texToPlain('沒有數學')).toBe('沒有數學')
  })
})

describe('extractNumbers：從預期文字抽出數字與捨入半寬', () => {
  const vals = (text: string) => extractNumbers(text).map((n) => n.value)

  it('小數位數決定捨入半寬 Δ_t = ½·10^(−n_d)', () => {
    const [a, b, c] = extractNumbers('w₁ = 1.8、w₂ = 2.28、σ = 0.39919')
    expect([a.value, b.value, c.value]).toEqual([1.8, 2.28, 0.39919])
    expect(a.tol).toBeCloseTo(0.05, 15)
    expect(b.tol).toBeCloseTo(0.005, 15)
    expect(c.tol).toBeCloseTo(0.000005, 15)
    expect([decimalsOf(a), decimalsOf(b), decimalsOf(c)]).toEqual([1, 2, 5])
  })

  it('科學記號（×10⁻⁵、×10^-5、e-5）：半寬跟著指數縮放', () => {
    for (const text of ['β = 4.0841×10⁻⁵ rad', 'β = 4.0841×10^-5 rad', 'β = 4.0841e-5 rad']) {
      const [n] = extractNumbers(text)
      expect(n.value).toBeCloseTo(4.0841e-5, 18)
      expect(n.tol).toBeCloseTo(0.5e-9, 20)
    }
  })

  it('百分比同時加入 x 與 x/100；千分位逗號讀成一個數', () => {
    const p = extractNumbers('精確 P(判對) = 78.75%')
    expect(p.map((n) => n.value)).toEqual([78.75, 0.7875])
    expect(p[1].tol).toBeCloseTo(0.00005, 15)
    expect(vals('N ≈ 42,500（奇數精確門檻 42,499）')).toEqual([42500, 42499])
  })

  it('Unicode 減號與負號：符號是數值的一部分', () => {
    expect(vals('C = −0.25 < 0')).toEqual([-0.25, 0])
    expect(vals('spur −93.799 dBc')).toEqual([-93.799])
    expect(normalizeNumberText('10⁻⁴')).toBe('10^-4')
  })

  it('編號與上標不算結果：T06、E30、F-06.15、§12.1、x²', () => {
    expect(vals('golden T06、勘誤 E30、F-06.15、§12.1 的 x² 與 δ_300')).toEqual([])
    expect(vals('pole p = 1 − μx² = 0.6')).toEqual([1, 0.6])
  })

  it('空字串與沒有數字的文字回傳空陣列', () => {
    expect(extractNumbers('')).toEqual([])
    expect(extractNumbers('單調收斂')).toEqual([])
  })
})

describe('acceptHalfWidth / findExpectedMatch：相符判據（F-GA.1）', () => {
  const one = (text: string) => extractNumbers(text)[0]

  it('夠精確的數字（Δ_t ≤ 1%·|y_t|）：接受半寬 = k·Δ_t', () => {
    const n = one('0.399')
    expect(n.tol / n.value).toBeLessThanOrEqual(PRECISE_REL)
    expect(acceptHalfWidth(n, 1)).toBeCloseTo(0.0005, 15)
    expect(acceptHalfWidth(n, 2)).toBeCloseTo(0.001, 15)
    expect(findExpectedMatch(0.39919, [n])).toBe(n)
    expect(findExpectedMatch(0.3996, [n])).toBeNull() // 超出 ±0.0005
  })

  it('短數字（不夠精確）：只接受相等；allowExact = false 時完全不接受', () => {
    const n = one('0.40')
    expect(n.tol / n.value).toBeGreaterThan(PRECISE_REL)
    expect(acceptHalfWidth(n, 1, true)).toBeCloseTo(EXACT_REL, 20)
    expect(acceptHalfWidth(n, 1, false)).toBe(-1)
    expect(findExpectedMatch(0.39919, [n], 1.001, true)).toBeNull() // 四捨五入後是 0.40，但不算證據
    expect(findExpectedMatch(0.4 + 1e-13, [n], 1.001, true)).toBe(n)
    expect(findExpectedMatch(0.4, [n], 1.001, false)).toBeNull()
  })

  it('整數：小整數要相等，三位數以上的整數夠精確（±0.5）', () => {
    const two = one('2')
    expect(findExpectedMatch(1.9, [two])).toBeNull() // 反面：1.9 不可以對到「2」
    expect(findExpectedMatch(2, [two])).toBe(two)
    const big = one('598')
    expect(findExpectedMatch(597.65, [big])).toBe(big)
    expect(findExpectedMatch(598.6, [big])).toBeNull()
  })

  it('符號相反不相符；多個候選時取最接近者；NaN / ∞ 不相符', () => {
    const nums = extractNumbers('C = −0.250、另一個 0.250、0.2502')
    expect(findExpectedMatch(0.25, nums)?.raw).toBe('0.250')
    expect(findExpectedMatch(-0.25, nums)?.raw).toBe('-0.250')
    expect(findExpectedMatch(0.25019, nums)?.raw).toBe('0.2502')
    expect(findExpectedMatch(NaN, nums)).toBeNull()
    expect(findExpectedMatch(Infinity, nums)).toBeNull()
  })

  it('y_t = 0：只接受絕對值 ≤ 1e-9 的重算值', () => {
    const z = one('0')
    expect(findExpectedMatch(1e-12, [z])).toBe(z)
    expect(findExpectedMatch(1e-6, [z])).toBeNull()
  })
})

describe('texRepr / sigForMatch', () => {
  it('texRepr：最短可還原表示，不另外捨入', () => {
    expect(texRepr(0.6)).toBe('0.6')
    expect(texRepr(2.2800000000000002)).toBe('2.2800000000000002')
    expect(texRepr(4.44e-16)).toBe('4.44\\times10^{-16}')
    expect(texRepr(NaN)).toBe('\\text{NaN}')
  })

  it('sigForMatch：比文字多一位有效數字（至少 base、至多 12）', () => {
    expect(sigForMatch(1.0199471140200715, 5e-8)).toBe(9) // 文字 1.0199471（8 位）→ 顯示 9 位
    expect(sigForMatch(2.28, 0.005)).toBe(6)
    expect(sigForMatch(0.6, 1e-30)).toBe(12)
    expect(sigForMatch(0, 0.005)).toBe(6)
    expect(sigForMatch(1, 0)).toBe(6)
  })
})
