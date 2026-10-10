import { buildHaystack, exactFormulaId, filterByTokens, matchesAll, normalizeSearch, richToPlain, tokenize } from './search'

describe('search：正規化（中文／英文／TeX／Unicode 寫法互通）', () => {
  it('希臘字母：Unicode、TeX 指令、英文名稱得到同一個字串', () => {
    expect(normalizeSearch('μ')).toBe('mu')
    expect(normalizeSearch('\\mu')).toBe('mu')
    expect(normalizeSearch('mu')).toBe('mu')
    expect(normalizeSearch('µ')).toBe('mu') // U+00B5 MICRO SIGN
    expect(normalizeSearch('Ω')).toBe('omega')
    expect(normalizeSearch('\\Omega')).toBe('omega')
    expect(normalizeSearch('σ_v')).toBe('sigmav')
    expect(normalizeSearch('\\sigma_v')).toBe('sigmav')
    expect(normalizeSearch('δw')).toBe('deltaw')
    expect(normalizeSearch('\\delta w')).toBe('deltaw')
    expect(normalizeSearch('delta_w')).toBe('deltaw')
  })

  it('\\varepsilon、\\varphi 與 ε、φ 相同；排版指令（\\mathrm、\\left、\\frac、間距）被去掉', () => {
    expect(normalizeSearch('\\varepsilon_{\\mathrm{cc}}')).toBe('epsiloncc')
    expect(normalizeSearch('ε_cc')).toBe('epsiloncc')
    expect(normalizeSearch('\\varphi')).toBe(normalizeSearch('φ'))
    expect(normalizeSearch('\\mathrm{ENBW}=\\frac{f_u}{2}\\cdot\\frac{1-p}{1+p}')).toBe('enbw=fu2cdot1-p1+p')
    expect(normalizeSearch('K_q\\,C\\;\\!x\\quad y')).toBe('kqcxy')
    expect(normalizeSearch('\\left(\\frac{s}{\\sigma_v}\\right)')).toBe('(ssigmav)')
  })

  it('全形字元、上下標數字、Unicode 減號與比較符號', () => {
    expect(normalizeSearch('ＥＮＢＷ')).toBe('enbw')
    expect(normalizeSearch('σ²')).toBe('sigma2')
    expect(normalizeSearch('x₀')).toBe('x0')
    expect(normalizeSearch('a − w')).toBe('a-w')
    expect(normalizeSearch('C ≤ 0')).toBe('cle0')
    expect(normalizeSearch('C \\le 0')).toBe('cle0')
    expect(normalizeSearch('f_s → ∞')).toBe('fstoinfty')
  })

  it('中文不受影響、空白全部移除、大小寫不分', () => {
    expect(normalizeSearch('等效 雜訊 頻寬')).toBe('等效雜訊頻寬')
    expect(normalizeSearch('Persistent Excitation')).toBe('persistentexcitation')
    expect(normalizeSearch('  GMAC　')).toBe('gmac')
  })

  it('反面：\\mathrm 之類的指令只在完整指令名時才刪（\\textstyle 不會被 \\text 誤刪成 style）', () => {
    // \text 後面接字母 → 不是 \text 指令
    expect(normalizeSearch('\\textstyle')).toBe('textstyle')
    expect(normalizeSearch('\\text{abc}')).toBe('abc')
    // \var 只在後面接字母時才視為 var- 前綴
    expect(normalizeSearch('\\var')).toBe('var')
  })
})

describe('search：tokenize / matchesAll / filter', () => {
  it('以空白、全形空白、逗號、頓號切 token，每個 token 已正規化；空查詢沒有 token', () => {
    expect(tokenize('  μ  ENBW ')).toEqual(['mu', 'enbw'])
    expect(tokenize('sum，average、E18')).toEqual(['sum', 'average', 'e18'])
    expect(tokenize('頻寬　noise')).toEqual(['頻寬', 'noise'])
    expect(tokenize('   ')).toEqual([])
    expect(tokenize('$ { }')).toEqual([])
  })

  it('AND 語意：所有 token 都要出現；空 token 清單一律符合', () => {
    const h = buildHaystack(['F-12.9', 'ENBW', String.raw`\mathrm{ENBW}=\frac{f_u}{2}`, '等效雜訊頻寬'])
    expect(matchesAll(h, tokenize('enbw f_u'))).toBe(true)
    expect(matchesAll(h, tokenize('ENBW 等效'))).toBe(true)
    expect(matchesAll(h, tokenize('enbw sigma'))).toBe(false)
    expect(matchesAll(h, [])).toBe(true)
  })

  it('buildHaystack 以 | 分隔欄位並略過空值：跨欄位不會誤配對', () => {
    const h = buildHaystack(['ab', null, undefined, false, '', 'cd', 12])
    expect(h).toBe('ab|cd|12')
    expect(matchesAll(h, ['abcd'])).toBe(false)
    expect(matchesAll(h, ['ab', 'cd'])).toBe(true)
  })

  it('filterByTokens 保持原順序；空查詢回傳全部（新陣列）', () => {
    const items = [
      { n: 'mu', h: buildHaystack(['μ 學習率']) },
      { n: 'K', h: buildHaystack(['K=K_qC']) },
      { n: 'g', h: buildHaystack(['g=\\mu K']) },
    ]
    expect(filterByTokens(items, (i) => i.h, tokenize('mu')).map((i) => i.n)).toEqual(['mu', 'g'])
    expect(filterByTokens(items, (i) => i.h, tokenize('K')).map((i) => i.n)).toEqual(['K', 'g'])
    const all = filterByTokens(items, (i) => i.h, [])
    expect(all).toEqual(items)
    expect(all).not.toBe(items)
  })

  it('richToPlain：把 $TeX$ 展開成前後有空白的原始碼（正規化後仍可被搜尋）', () => {
    const plain = richToPlain(String.raw`單位是 $\mathrm{fs}^{-1}$，見 $K_q$`)
    expect(plain).not.toContain('$')
    expect(matchesAll(buildHaystack([plain]), tokenize('fs-1 Kq 單位'))).toBe(true)
  })
})

describe('search：精確公式 ID', () => {
  const ids = new Set(['F-12.9', 'F-SO.3', 'F-R10.1', 'F-00.11'])
  it('大小寫不拘、前後空白可接受；回傳標準寫法', () => {
    expect(exactFormulaId('F-12.9', ids)).toBe('F-12.9')
    expect(exactFormulaId('  f-12.9 ', ids)).toBe('F-12.9')
    expect(exactFormulaId('f-so.3', ids)).toBe('F-SO.3')
    expect(exactFormulaId('F-R10.1', ids)).toBe('F-R10.1')
  })
  it('反面：不是 ID 形式、部分 ID、不存在的 ID 都回傳 null', () => {
    expect(exactFormulaId('F-12', ids)).toBeNull()
    expect(exactFormulaId('F-12.99', ids)).toBeNull()
    expect(exactFormulaId('ENBW', ids)).toBeNull()
    expect(exactFormulaId('F-12.9 enbw', ids)).toBeNull()
    expect(exactFormulaId('', ids)).toBeNull()
  })
})
