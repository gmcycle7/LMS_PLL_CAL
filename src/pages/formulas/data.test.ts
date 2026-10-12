import { pageById } from '@/app/registry'
import { ERRATA, erratumById, erratumExists, erratumSummary, ERRATUM_ID } from './errata'
import { FORMULA_IDS } from './registry'
import { refValues } from './refValues'
import { GLOBAL_SYMBOLS, SYMBOL_COLLISIONS, SYMBOL_GROUP_LABEL, SYMBOL_GROUP_ORDER } from './symbols'
import { QUICK_GROUP_LABEL, QUICK_REF } from './appendixA'
import { LIMITATIONS } from './appendixB'
import { GLOSSARY, GLOSSARY_CATEGORY_LABEL, GLOSSARY_CATEGORY_ORDER } from './glossary'
import { filterEntries, searchIndex, UNIT_TOPICS } from './searchIndex'
import { errataCoverage } from './coverage'
import { tokenize } from './search'
import { texNum, texPct, texHz, plainNum } from './format'
import { lostBackslash, richProblems, texError, texIssue } from './testUtils'

const r = refValues()

function dup(keys: string[]): string[] {
  return keys.filter((k, i) => keys.indexOf(k) !== i)
}

/** 算出來的例子不可以含未定義的數字 */
function exampleProblems(label: string, text: string): string[] {
  const out = richProblems(text).map((p) => `${label}: ${p}`)
  if (/NaN|undefined|n\/a|Infinity/.test(text)) out.push(`${label}: 例子含未定義的數字 → ${text.slice(0, 80)}`)
  return out
}

describe('format：數字 → TeX', () => {
  it('一般數字、科學記號、無限大與 NaN', () => {
    expect(texNum(0.9202115439, 7)).toBe('0.9202115')
    expect(texNum(7.978845608e-3, 4)).toBe('0.007979')
    expect(texNum(7.978845608e-5, 4)).toBe('7.979\\times10^{-5}')
    expect(texNum(1.5e7)).toBe('1.5\\times10^{7}')
    expect(texNum(-325.8135, 4)).toBe('-325.8')
    expect(texNum(Infinity)).toBe('\\infty')
    expect(texNum(-Infinity)).toBe('-\\infty')
    expect(texNum(NaN)).toBe('\\text{n/a}')
    expect(texError(texNum(7.978845608e-5))).toBeNull()
  })
  it('百分比、Hz 的 SI 前綴、純文字', () => {
    expect(texPct(0.0526, 3)).toBe('5.26\\%')
    expect(texHz(12931.28)).toBe('12.93\\,\\mathrm{kHz}')
    expect(texHz(976562.5, 7)).toBe('976.5625\\,\\mathrm{kHz}')
    expect(texHz(4e9)).toBe('4\\,\\mathrm{GHz}')
    expect(texHz(320e6)).toBe('320\\,\\mathrm{MHz}')
    expect(texHz(50)).toBe('50\\,\\mathrm{Hz}')
    expect(texHz(NaN)).toBe('\\text{n/a}')
    expect(plainNum(0.39918614, 4)).toBe('0.3992')
  })
})

describe('測試工具：掉了反斜線的 TeX', () => {
  it('一般字串裡的 \\approx、\\mathbf 會被偵測到；正確寫法與 \\text{…} 內的文字不會誤判', () => {
    expect(lostBackslash('E[q]approx K_q s')).toBe('approx')
    expect(lostBackslash('mathbf V')).toBe('mathbf')
    expect(lostBackslash(String.raw`E[q]\approx K_q s`)).toBeNull()
    expect(lostBackslash(String.raw`\mathbf R=E[\mathbf u\mathbf u^T]`)).toBeNull()
    expect(lostBackslash(String.raw`\text{sigma delta}`)).toBeNull()
    expect(lostBackslash(String.raw`\operatorname{sign}(e)`)).toBeNull()
    expect(richProblems('文字 $E[q]approx K_qs$').length).toBe(1)
    expect(richProblems(String.raw`少了錢字號 \mathrm{fs}`).length).toBe(1)
    expect(richProblems(String.raw`成對 $a$ 與不成對 $b`).length).toBeGreaterThan(0)
    expect(richProblems(String.raw`正常 $\mu K_q$ 文字`)).toEqual([])
  })
})

describe('errata：49 項勘誤的機器可讀版本', () => {
  it('E01–E49 齊全、ID 格式正確、摘要可產生', () => {
    expect(ERRATA.length).toBe(49)
    for (let i = 1; i <= 49; i++) expect(erratumExists(`E${String(i).padStart(2, '0')}`)).toBe(true)
    expect(ERRATA.every((e) => ERRATUM_ID.test(e.eid))).toBe(true)
    expect(erratumById('E13')?.area).toBeTruthy()
    expect(erratumSummary('E13')).toMatch(/^E13｜/)
    expect(erratumSummary('E13', 20).length).toBeLessThan(80)
    expect(erratumSummary('E99')).toMatch(/找不到/)
    expect(erratumExists('E50')).toBe(false)
  })
})

describe('全站符號總表（規格 §0 修正版）', () => {
  it('key 唯一、分組合法、每一列的 TeX 都能解析', () => {
    expect(dup(GLOBAL_SYMBOLS.map((s) => s.key))).toEqual([])
    const problems: string[] = []
    for (const s of GLOBAL_SYMBOLS) {
      if (!SYMBOL_GROUP_ORDER.includes(s.group)) problems.push(`${s.key}: group ${s.group}`)
      const e1 = texIssue(s.symbol)
      if (e1) problems.push(`${s.key}.symbol: ${e1}`)
      if (s.unit) {
        const e2 = texIssue(s.unit)
        if (e2) problems.push(`${s.key}.unit: ${e2}`)
      }
      for (const [field, text] of [
        ['meaning', s.meaning],
        ['convention', s.convention],
        ['specOriginal', s.specOriginal ?? ''],
      ] as const)
        problems.push(...richProblems(text).map((p) => `${s.key}.${field}: ${p}`))
      if (s.example) problems.push(...exampleProblems(`${s.key}.example`, s.example(r)))
    }
    expect(problems).toEqual([])
    expect(Object.keys(SYMBOL_GROUP_LABEL).sort()).toEqual(SYMBOL_GROUP_ORDER.slice().sort())
    // 每一組至少一個符號
    for (const g of SYMBOL_GROUP_ORDER) expect(GLOBAL_SYMBOLS.some((s) => s.group === g), g).toBe(true)
  })

  it('頁面 id 與勘誤 id 都存在', () => {
    const bad: string[] = []
    for (const s of GLOBAL_SYMBOLS) {
      for (const p of s.pages) if (!pageById(p)) bad.push(`${s.key}: page ${p}`)
      for (const e of s.errata) if (!erratumExists(e)) bad.push(`${s.key}: ${e}`)
      if (s.pages.length === 0) bad.push(`${s.key}: 沒有頁面`)
    }
    for (const c of SYMBOL_COLLISIONS) for (const e of c.errata) if (!erratumExists(e)) bad.push(`collision ${c.symbol}: ${e}`)
    expect(bad).toEqual([])
  })

  it('規格 §0 的 20 個符號全部涵蓋', () => {
    const need = ['a', 'w', 'delta', 'x', 'u', 'e', 'v', 'q', 'G', 'N', 'rates', 'mu', 'Kq', 'L', 'HPD', 'T', 'R', 'Cmat', 'J']
    const keys = new Set(GLOBAL_SYMBOLS.map((s) => s.key))
    expect(need.filter((k) => !keys.has(k))).toEqual([])
  })

  it('任務指定的修正約定都在表中，並標出改變它的勘誤', () => {
    const by = (k: string) => {
      const s = GLOBAL_SYMBOLS.find((x) => x.key === k)
      if (!s) throw new Error(`缺少符號 ${k}`)
      return s
    }
    // δ = a − w（E32 / E39）
    expect(by('delta').symbol).toContain('a-w_k')
    expect(by('delta').errata).toEqual(expect.arrayContaining(['E32', 'E39']))
    expect(by('delta').specOriginal).toContain('w_n-a')
    // u vs ε_cc（E12）
    expect(by('u').convention).toContain(String.raw`\varepsilon_{\mathrm{cc}}`)
    expect(by('u').errata).toContain('E12')
    expect(by('biasModel').errata).toContain('E12')
    // c_3、κ（E11 / E12）
    expect(by('c3').symbol).toContain('c_3')
    expect(by('c3').symbol).toContain(String.raw`\kappa`)
    expect(by('c3').errata).toEqual(expect.arrayContaining(['E11', 'E12']))
    // C vs C_obs（E31）
    expect(by('Cobs').convention).toContain(String.raw`\mathbf C_{\mathrm{obs}}`)
    expect(by('Cobs').errata).toContain('E31')
    expect(by('Cmat').errata).toContain('E31')
    // λ vs λ_reg（E22）
    expect(by('lamreg').symbol).toContain(String.raw`\lambda_{\mathrm{reg}}`)
    expect(by('lamreg').errata).toContain('E22')
    expect(by('lambda').errata).toContain('E22')
    // G sum / average 與 S_N（E18 / E07）
    expect(by('G').errata).toContain('E18')
    expect(by('SN').errata).toEqual(expect.arrayContaining(['E07', 'E18']))
    // μ、w、K、g 的單位（E13）
    expect(by('mu').unit).toBe('[w]/[G]')
    expect(by('mu').errata).toContain('E13')
    expect(by('K').unit).toBe(String.raw`\mathrm{fs}^{-1}`)
    expect(by('K').errata).toContain('E13')
    expect(by('g').unit).toBe('1')
    expect(by('g').errata).toContain('E13')
    expect(by('a').errata).toContain('E13')
    // 時間索引（E35）
    expect(by('nkm').errata).toContain('E35')
  })

  it('例子的數字來自站內核心：T01 的 δ 反號、T13 的 g 與 pole、sum mode 的 326.8', () => {
    const delta = GLOBAL_SYMBOLS.find((s) => s.key === 'delta')!.example!(r)
    expect(delta).toContain('2,\\ 1.2,\\ 0.72')
    expect(delta).toContain('-2,\\ -1.2,\\ -0.72')
    const g = GLOBAL_SYMBOLS.find((s) => s.key === 'G')!.example!(r)
    expect(g).toContain('0.07979')
    expect(g).toContain('326.8')
    expect(g).toContain('-325.8')
    const f3 = GLOBAL_SYMBOLS.find((s) => s.key === 'f3db')!.example!(r)
    expect(f3).toContain('12.93')
    expect(f3).toContain('12.4')
    const enbw = GLOBAL_SYMBOLS.find((s) => s.key === 'enbw')!.example!(r)
    expect(enbw).toContain('20.29')
  })

  it('符號衝突表：每個字母至少兩個意義、TeX 可解析', () => {
    const problems: string[] = []
    for (const c of SYMBOL_COLLISIONS) {
      if (c.meanings.length < 2) problems.push(`${c.symbol}: 只有 ${c.meanings.length} 個意義`)
      const e = texIssue(c.symbol)
      if (e) problems.push(`${c.symbol}: ${e}`)
      for (const m of c.meanings) {
        const e2 = texIssue(m.tex)
        if (e2) problems.push(`${c.symbol}/${m.tex}: ${e2}`)
        problems.push(...richProblems(m.note).map((p) => `${c.symbol}: ${p}`))
      }
    }
    expect(problems).toEqual([])
    expect(dup(SYMBOL_COLLISIONS.map((c) => c.symbol))).toEqual([])
    for (const need of [String.raw`\delta`, 'u', 'c', 'C', String.raw`\lambda`]) expect(SYMBOL_COLLISIONS.some((c) => c.symbol === need), need).toBe(true)
  })
})

describe('附錄 A：一頁公式速查（修正版）', () => {
  it('規格的 17 列都保留（單頻兩列合併成一列 → 16 列），另有本站補充列', () => {
    expect(QUICK_REF.filter((q) => q.fromSpec).length).toBe(16)
    expect(QUICK_REF.filter((q) => !q.fromSpec).length).toBeGreaterThanOrEqual(10)
    expect(dup(QUICK_REF.map((q) => q.key))).toEqual([])
    expect(Object.keys(QUICK_GROUP_LABEL)).toEqual(['A', 'B', 'C'])
  })

  it('TeX、使用條件、規格原文、例子都能解析；勘誤與站內公式 ID 都存在', () => {
    const problems: string[] = []
    for (const q of QUICK_REF) {
      const e = texIssue(q.tex, true)
      if (e) problems.push(`${q.key}.tex: ${e}`)
      problems.push(...richProblems(q.conditions).map((p) => `${q.key}.conditions: ${p}`))
      if (q.spec) problems.push(...richProblems(q.spec).map((p) => `${q.key}.spec: ${p}`))
      if (q.example) problems.push(...exampleProblems(`${q.key}.example`, q.example(r)))
      for (const id of q.errata) if (!erratumExists(id)) problems.push(`${q.key}: ${id} 不存在`)
      for (const id of q.related) if (!FORMULA_IDS.has(id)) problems.push(`${q.key}: 公式 ${id} 不存在`)
      if (q.related.length === 0) problems.push(`${q.key}: 沒有站內公式`)
    }
    expect(problems).toEqual([])
  })

  it('依勘誤修正的重點列：頻寬／ENBW、方向機率的 tie、sum/average、polarity margin、corner μ 區間', () => {
    const by = (k: string) => QUICK_REF.find((q) => q.key === k)!
    expect(by('bw').tex).toContain(String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}`)
    expect(by('bw').errata).toEqual(expect.arrayContaining(['E06', 'E10', 'E26', 'E27']))
    expect(by('bw').example!(r)).toMatch(/12\.93.*20\.29.*12\.4/)
    expect(by('direction').errata).toEqual(expect.arrayContaining(['E02', 'E07']))
    expect(by('direction').example!(r)).toContain('0.492')
    expect(by('sumAvg').example!(r)).toContain('326.8')
    expect(by('polarity').tex).toContain(String.raw`\arcsin(\cos\theta)`)
    expect(by('polarity').example!(r)).toContain('-60')
    expect(by('corner').errata).toContain('E16')
    expect(by('pm').tex).toContain(String.raw`2\sin\frac{\pi}{4d+2}`)
    expect(by('lms').example!(r)).toContain('1.8')
    expect(by('lms').example!(r)).toContain('2.28')
    // 規格原文被改寫的列，Engineer 模式可以對照
    expect(QUICK_REF.filter((q) => q.spec).length).toBeGreaterThanOrEqual(7)
  })

  it('T06: 「先算一次」—— 單頻列的例子是算出來的（C = −0.25、pole 1.0199；D = 4 對齊後 C_D = +0.5）；其他補上的例子也來自核心', () => {
    const by = (k: string) => QUICK_REF.find((q) => q.key === k)!
    const tone = by('tone').example!(r)
    expect(tone).toContain(texNum(r.tone.C)) // −0.25
    expect(tone).toContain(texNum(r.tone.pole, 6)) // 1.01995
    expect(tone).toContain(texNum(r.tone.CD)) // 0.5
    expect(tone).toContain('-0.25')
    expect(tone).toContain('1.01995')
    // Sign-Error 與 LMS 走同一筆資料：1.2 vs 1.4（入門課第 3 課）
    const se = by('signError').example!(r)
    expect(se).toMatch(/w_1=1\.2/)
    expect(se).toContain('1.4')
    // MSD ≠ MSE（E42）
    expect(by('msd').example!(r)).toMatch(/0\.0625.*1\.25/)
    // offset 的假 gain bias 與共用 BBPD（E03）
    expect(by('bias').example!(r)).toMatch(/1\.2143.*w\^\*=1(?!\.)/)
    // E[δ_B²]（E48）與 golden msd_after_blocks 同一組輸入
    expect(by('msdB').example!(r)).toMatch(/75\.95.*0\.6756/)
    // PSD 正規化（E28）與 output transfer 的示例
    expect(by('psd').example!(r)).toContain(texNum(r.psd.sw1Dc))
    expect(by('output').example!(r)).toContain(texNum(r.psd.exampleL, 5))
    expect(by('dtc').example!(r)).toContain(String(r.units.exampleKWithLatency))
    // 有「代入數字」的列數：只剩純定義／多參數積分式的列沒有例子
    const without = QUICK_REF.filter((q) => !q.example).map((q) => q.key)
    expect(without.sort()).toEqual(['codeCorr', 'filteredX', 'signSign'])
    // 帶 ≈ 的 preconditioner 變異數式不可標成「精確」（E37）
    expect(by('precond').claim).toBe('approx')
    expect(by('precond').conditions).toMatch(/不是第 \$i\$ 個參數的/)
  })
})

describe('附錄 B：關鍵限制', () => {
  it('規格的 10 條各出現一次，另有本站補充；TeX 可解析、連結都存在', () => {
    const nos = LIMITATIONS.map((l) => l.specNo).filter((n): n is number => n !== null)
    expect(nos.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(LIMITATIONS.filter((l) => l.specNo === null).length).toBe(5)
    expect(dup(LIMITATIONS.map((l) => l.key))).toEqual([])
    const problems: string[] = []
    for (const l of LIMITATIONS) {
      problems.push(...richProblems(l.text).map((p) => `${l.key}.text: ${p}`))
      problems.push(...richProblems(l.why).map((p) => `${l.key}.why: ${p}`))
      if (l.example) problems.push(...exampleProblems(`${l.key}.example`, l.example(r)))
      else problems.push(`${l.key}: 沒有算出來的例子`)
      for (const p of l.pages) if (!pageById(p)) problems.push(`${l.key}: page ${p}`)
      for (const e of l.errata) if (!erratumExists(e)) problems.push(`${l.key}: ${e}`)
    }
    expect(problems).toEqual([])
  })

  it('反例的數字：Type-II 低頻 Re{H_PD} < 0、g = 1.5 且 d = 1 的 PM < 0、AR(1) 有效樣本數', () => {
    const by = (k: string) => LIMITATIONS.find((l) => l.key === k)!.example!(r)
    expect(by('paths')).toContain('-0.08')
    expect(by('polarityVsPm')).toMatch(/\\mathrm\{PM\}_1=-\d/)
    expect(by('noiseCorrelated')).toMatch(/有效樣本數只有/)
    expect(by('mc')).toContain('1.32') // E[(1 − 0.8x²)²] = 1 − 1.6 + 1.92
    expect(by('quantTones')).toContain('0.24')
  })
})

describe('術語表', () => {
  it('key 唯一、分類合法、定義可解析；頁面、公式、勘誤連結都存在', () => {
    expect(dup(GLOSSARY.map((g) => g.key))).toEqual([])
    const problems: string[] = []
    for (const g of GLOSSARY) {
      if (!GLOSSARY_CATEGORY_ORDER.includes(g.category)) problems.push(`${g.key}: category`)
      problems.push(...richProblems(g.def).map((p) => `${g.key}: ${p}`))
      if (g.pages.length === 0) problems.push(`${g.key}: 沒有頁面連結`)
      for (const p of g.pages) if (!pageById(p)) problems.push(`${g.key}: page ${p}`)
      for (const f of g.formulas ?? []) if (!FORMULA_IDS.has(f)) problems.push(`${g.key}: 公式 ${f} 不存在`)
      for (const e of g.errata ?? []) if (!erratumExists(e)) problems.push(`${g.key}: ${e}`)
      if (!g.zh.trim() || !g.en.trim() || g.def.length < 12) problems.push(`${g.key}: 中文／英文／定義不完整`)
    }
    expect(problems).toEqual([])
    expect(Object.keys(GLOSSARY_CATEGORY_LABEL).sort()).toEqual(GLOSSARY_CATEGORY_ORDER.slice().sort())
  })

  it('DTC 在 reference 輸入端（docs/assumptions.md §2a）：術語、符號與 PLL 輸出式都用同一個接法與號誌', () => {
    const dtc = GLOSSARY.find((g) => g.key === 'dtc')!.def
    expect(dtc).toContain('reference 輸入端')
    expect(dtc).toContain(String.raw`\tau_{\mathrm{DTC}}=T_0-w\,x`) // 只能延遲：從基準延遲 T_0 往回扣補償量
    expect(dtc).toContain(String.raw`e=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w)\,x+v`) // PD 量 reference 減 feedback
    expect(dtc).not.toMatch(/回授路徑|divider 之後/)
    // H_PD、T：殘差在 PD 的 reference 輸入注入，兩者都是正號
    expect(GLOSSARY.find((g) => g.key === 'hpd')!.def).toContain(String.raw`e_{\mathrm{PD}}=H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}`)
    const sym = (k: string) => GLOBAL_SYMBOLS.find((x) => x.key === k)!
    expect(sym('HPD').convention).toContain(String.raw`e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{fb}}`)
    expect(sym('HPD').convention).toContain(String.raw`e_{\mathrm{PD}}=+H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}`)
    expect(sym('T').convention).toContain(String.raw`\theta_{\mathrm{out}}=+T\,\phi_{\mathrm{dtc}}`)
    // δt = x·δw 是「補償量的擾動」：殘差裡的貢獻是 −x·δw（與 e = (a − w)x 同號誌），不再叫「DTC 多施加的延遲」
    expect(sym('dt').meaning).toContain('多補償')
    expect(sym('dt').convention).toContain(String.raw`-x\,\delta w`)
    // 速查表的 δt 一列也要說明它是「多補償的時間」，殘差的對應項帶負號（不是 DTC 插入的延遲）
    const dtRow = QUICK_REF.find((q) => q.key === 'dtc')!
    expect(dtRow.tex).toContain(String.raw`\delta t[n]=x[n]\,\delta w[n]`)
    expect(dtRow.conditions).toContain('reference 端的 DTC 多補償的時間')
    expect(dtRow.conditions).toContain(String.raw`$-x\,\delta w$`)
    // 輸出式 φ_out = −2π f_out T δt 的負號來自殘差 = −δt，T 本身是正號
    const out = QUICK_REF.find((q) => q.key === 'output')!
    expect(out.tex).toContain(String.raw`\phi_{\mathrm{out}}(s)=-2\pi f_{\mathrm{out}}\,T(s)\,\delta t(s)`)
    expect(out.conditions).toContain(String.raw`殘差 $=-\delta t$`)
    expect(out.conditions).toContain(String.raw`\theta_{\mathrm{out}}=+T\,\phi_{\mathrm{dtc}}`)
    expect(out.conditions).not.toMatch(/feedback injection/)
  })

  it('GOS / PHOS：術語表同時說明兩種用法（規格 §9.2 的 global offset／案例頁的 DTC gain error），不互相矛盾', () => {
    const gos = GLOSSARY.find((g) => g.key === 'gos')!
    const phos = GLOSSARY.find((g) => g.key === 'phos')!
    // 規格 §9.2、第 9 章：GOS = global offset b（regressor 是常數 1）
    expect(gos.def).toMatch(/global offset/)
    expect(gos.def).toMatch(/regressor 是常數/)
    // 案例頁（使用者的 SSPLL）：GOS = DTC 的 gain error（regressor 是 DTC 的細部殘差）
    expect(gos.def).toMatch(/DTC 的 gain error/)
    expect(gos.def).toMatch(/細部殘差/)
    expect(gos.pages).toEqual(expect.arrayContaining(['ch09', 'case-sspll']))
    expect(gos.formulas).toEqual(expect.arrayContaining(['F-09.13', 'F-CS.11'])) // gauge freedom ＋ 案例頁的 C_GOS
    expect(phos.def).toMatch(/one-hot/)
    expect(phos.def).toMatch(/8 相/)
    expect(phos.formulas).toEqual(expect.arrayContaining(['F-09.15', 'F-CS.13']))
    expect(phos.errata).toContain('E04')
  })

  it('術語定義裡引用的數字與核心計算一致（定義是靜態字串，所以在這裡逐一核對）', () => {
    const def = (k: string) => GLOSSARY.find((g) => g.key === k)!.def
    const pct = (x: number) => `${(100 * x).toFixed(1)}%`
    // tie rule：N = 100 的嚴格判對率與 sign(0) = +1 的判對率
    expect(def('tie')).toContain(pct(r.direction.n100.pos)) // 49.2%
    expect(def('tie')).toContain(pct(r.direction.n100PlusRule)) // 57.1%
    // almost-sure 界、mean-square 界
    expect(def('almostSure')).toContain(r.stability.asMuMax.toFixed(2)) // 2.42
    expect(r.stability.msMuMax).toBeCloseTo(2 / 3, 12)
    expect(def('meanSquare')).toMatch(/\$2\/3\$ vs \$2\$/)
    expect(r.stability.meanMuMax).toBe(2)
    // calibration PM 與 delay margin：g = 1、d = 0 → 60°，剛好容忍 1 個 block
    expect(def('calPm')).toContain(String.raw`${Math.round(r.pm.g1.pmDeg)}^\circ`)
    expect(r.pm.g1.pmDeg).toBeCloseTo(60, 10)
    expect(((r.pm.g1.pmDeg * Math.PI) / 180 / r.pm.g1.omegaC)).toBeCloseTo(1, 10)
    expect(def('delayMargin')).toMatch(/只容忍 1 個 block/)
    // ENBW ≈ (π/2)·f_3dB（慢迴路）：T14 的比值 1.569
    expect(r.loop.enbwOverF3db).toBeGreaterThan(1.55)
    expect(r.loop.enbwOverF3db).toBeLessThan(Math.PI / 2)
    // 量化：32.4 的週期 5、stochastic rounding 的 p(1 − p)
    expect(def('limitCycle')).toMatch(/32\.4\$ 的週期 5/)
    expect(r.quant.stochasticVar).toBeCloseTo(0.4 * 0.6, 12)
  })

  it('任務指定的術語全部收錄', () => {
    const need = ['LMS', 'Sign-Error LMS', 'GMAC', 'DTC', 'DSM', 'MASH', 'BBPD', 'SSPD', 'PMUX', 'GOS', 'PHOS', 'PE', 'Jacobian', 'Preconditioner', 'ENBW', 'Limit cycle', 'Dither']
    const idx = searchIndex()
    const missing = need.filter((t) => filterEntries(idx.glossary, tokenize(t)).length === 0)
    expect(missing).toEqual([])
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(70)
  })
})

describe('搜尋索引：一個關鍵字同時過濾所有段落', () => {
  const idx = searchIndex()
  const count = (q: string) => {
    const t = tokenize(q)
    return {
      symbols: filterEntries(idx.symbols, t).length,
      collisions: filterEntries(idx.collisions, t).length,
      quick: filterEntries(idx.quick, t).length,
      limits: filterEntries(idx.limits, t).length,
      glossary: filterEntries(idx.glossary, t).length,
      units: filterEntries(idx.units, t).length,
      formulas: filterEntries(idx.formulas, t).length,
    }
  }

  it('空查詢：每一段都回傳全部', () => {
    const c = count('')
    expect(c.symbols).toBe(GLOBAL_SYMBOLS.length)
    expect(c.quick).toBe(QUICK_REF.length)
    expect(c.limits).toBe(LIMITATIONS.length)
    expect(c.glossary).toBe(GLOSSARY.length)
    expect(c.units).toBe(UNIT_TOPICS.length)
  })

  it('ENBW：符號、單位、速查、公式、限制、術語六段都有結果', () => {
    const c = count('ENBW')
    for (const k of ['symbols', 'units', 'quick', 'formulas', 'limits', 'glossary'] as const) expect(c[k], k).toBeGreaterThan(0)
    expect(c.symbols).toBeLessThan(GLOBAL_SYMBOLS.length)
  })

  it('勘誤編號可搜尋：E13 找到 μ／K／g 的單位；E18 找到 sum / average', () => {
    const t = tokenize('E13')
    const keys = filterEntries(idx.symbols, t).map((s) => s.key)
    expect(keys).toEqual(expect.arrayContaining(['mu', 'K', 'g', 'a']))
    expect(filterEntries(idx.units, t).map((u) => u.id)).toContain('muUnits')
    expect(filterEntries(idx.quick, tokenize('E18')).map((q) => q.key)).toContain('sumAvg')
  })

  it('算出來的例子也能搜尋：12.93（T14 的 −3 dB）、326.8（sum mode 的 g）', () => {
    expect(filterEntries(idx.symbols, tokenize('12.93')).map((s) => s.key)).toContain('f3db')
    expect(filterEntries(idx.symbols, tokenize('326.8')).map((s) => s.key)).toContain('G')
    expect(filterEntries(idx.quick, tokenize('20.29')).map((q) => q.key)).toContain('bw')
  })

  it('中文、英文、TeX 三種寫法找到同一個符號；多個關鍵字為 AND', () => {
    const a = filterEntries(idx.symbols, tokenize('學習率')).map((s) => s.key)
    const b = filterEntries(idx.symbols, tokenize('\\mu 學習率')).map((s) => s.key)
    expect(a).toContain('mu')
    expect(b).toContain('mu')
    expect(b.length).toBeLessThanOrEqual(a.length)
    expect(filterEntries(idx.glossary, tokenize('persistent excitation')).map((g) => g.key)).toContain('pe')
    expect(filterEntries(idx.glossary, tokenize('持續激勵')).map((g) => g.key)).toContain('pe')
    expect(count('zzzqqq不存在').symbols).toBe(0)
  })

  it('UNIT_TOPICS：id 唯一、勘誤存在、搜尋用標題不含 TeX 分隔符、顯示用標題（label）是可解析的 LaTeX', () => {
    expect(dup(UNIT_TOPICS.map((u) => u.id))).toEqual([])
    for (const u of UNIT_TOPICS) {
      for (const e of u.errata) expect(erratumExists(e), `${u.id}:${e}`).toBe(true)
      expect(u.title.includes('$')).toBe(false)
      expect(richProblems(u.label), u.id).toEqual([])
      expect(u.label).not.toMatch(/[μσδΩθ]/) // 顯示用標題不拿 Unicode 拼符號
    }
    expect(filterEntries(idx.units, tokenize('n k m')).map((u) => u.id)).toContain('index')
    expect(filterEntries(idx.units, tokenize('rad fs')).map((u) => u.id)).toContain('timePhase')
    expect(filterEntries(idx.units, tokenize('one-sided')).map((u) => u.id)).toContain('psd')
  })
})

describe('勘誤覆蓋：49 項勘誤每一項都在本頁或公式登錄中被引用', () => {
  it('沒有任何一項勘誤完全沒被引用', () => {
    const cov = errataCoverage()
    expect(cov.length).toBe(49)
    const uncovered = cov.filter((c) => c.onPage + c.formulas.length === 0).map((c) => c.eid)
    expect(uncovered).toEqual([])
  })

  it('本頁（符號、附錄 A／B、術語、單位）自己就涵蓋全部 49 項', () => {
    const cov = errataCoverage()
    const notOnPage = cov.filter((c) => c.onPage === 0).map((c) => c.eid)
    expect(notOnPage).toEqual([])
  })
})
