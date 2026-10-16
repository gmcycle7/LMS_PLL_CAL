/**
 * 案例頁的結論標籤與極性約定的文字（審查 A7a、A7b）：
 *   - A7a：用了線性化、漸近或 ≈ 的公式不可標成「精確」（比照 R06a 對 F-09.3 的處理）；
 *   - A7b：ε_k 的方向（feedback edge 早到為正）在頁面、分析文件、assumptions.md 與 analysis/sspll 的 Python 文件裡說的是同一件事。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const by = (id: string) => FORMULAS.find((f) => f.id === id)!

/** 標成近似的案例頁公式：線性化（Bussgang：F-CS.2 與建立在它上面的 F-CS.18、F-CS.19）、低頻／慢鋸齒漸近，以及原本就是大訊號割線斜率的 F-CS.20 */
const APPROX_IDS = ['F-CS.2', 'F-CS.5', 'F-CS.6', 'F-CS.12', 'F-CS.18', 'F-CS.19', 'F-CS.20']

describe('A7a：近似的公式不標「精確」', () => {
  it('登錄檔：式子含 \\approx 或條件寫線性化／漸近的一律是 approx；approx 的剛好是 F-CS.2／.5／.6／.12／.18／.19／.20，其餘（含 F-CS.11、.13 的諧波和）仍是 exact', () => {
    for (const f of FORMULAS) if (/\\approx/.test(f.tex)) expect(f.claim, f.id).toBe('approx')
    expect(FORMULAS.filter((f) => f.claim === 'approx').map((f) => f.id)).toEqual(APPROX_IDS)
    const exact = FORMULAS.filter((f) => f.claim === 'exact').map((f) => f.id)
    expect(exact).toHaveLength(FORMULAS.length - APPROX_IDS.length)
    // 無理數 α 下確實是精確的諧波和——審查特別註明不要順手改
    expect(by('F-CS.11').claim).toBe('exact')
    expect(by('F-CS.13').claim).toBe('exact')
    // 條件寫「線性化」或「漸近」的也是 approx（F-CS.18 建立在 F-CS.2 的小訊號平均模型上；遞迴本身在模型內對任何 N_τ 精確，C07 + R10，這句保留在 conditions 裡）
    for (const f of FORMULAS) if (/線性化|漸近/.test(f.conditions)) expect(f.claim, f.id).toBe('approx')
    expect(by('F-CS.18').claim).toBe('approx')
    expect(FORMULAS.filter((f) => f.claim === 'research')).toEqual([])
  })

  it('標成近似的公式在 conditions 開頭說明是哪個模型（線性化、凍結權重、漸近）；精確的公式沒有這句', () => {
    const why: Record<string, string[]> = {
      'F-CS.2': ['小訊號線性化', '凍結權重'],
      'F-CS.5': ['低頻漸近式'],
      'F-CS.6': ['低頻漸近式', 'F-CS.10'],
      'F-CS.12': ['慢鋸齒', '漸近式'],
      'F-CS.18': ['F-CS.2', '小訊號線性化', '對任何 $N_\\tau>0$ 都精確'],
      'F-CS.19': ['小訊號線性化', '凍結權重', '精確'],
    }
    for (const [id, frags] of Object.entries(why)) {
      const c = by(id).conditions
      expect(c.startsWith('標為近似的原因：'), id).toBe(true)
      for (const frag of frags) expect(c, `${id}：${frag}`).toContain(frag)
    }
    for (const f of FORMULAS) if (f.claim === 'exact') expect(f.conditions, f.id).not.toContain('標為近似的原因')
    // 原有的條件一字不少（F-CS.2 的小訊號條件、F-CS.6 的判據、F-CS.12 的 β→0、F-CS.19 的 raw regressor）
    expect(by('F-CS.2').conditions).toContain('$\\lvert e_{PD}\\rvert\\ll\\sigma_v$（Bussgang 線性化）')
    expect(by('F-CS.6').conditions).toContain('$\\iff K(d-\\tfrac12)>1$')
    expect(by('F-CS.12').conditions).toContain('$\\beta\\to0$（$\\alpha\\approx k/8$）')
    expect(by('F-CS.19').conditions).toContain('raw regressor（$\\langle\\rho\\rangle\\approx\\tfrac12$')
  })

  it('手算題：公式含 ≈ 的是 approx（HC-CS.2／.3／.5）；連到 approx 公式的不可標 exact（HC-CS.7 連到 F-CS.19）；其餘仍是精確', () => {
    const defs = new Map(HANDCALCS.map((h) => [h.id, h]))
    for (const h of HANDCALCS) {
      if (/\\approx/.test(h.formulaTex ?? '')) expect(h.claim, h.id).toBe('approx')
      const linked = h.formulaId ? FORMULAS.find((f) => f.id === h.formulaId) : undefined
      if (linked?.claim === 'approx') expect(h.claim, `${h.id} → ${h.formulaId}`).toBe('approx')
    }
    expect(['HC-CS.2', 'HC-CS.3', 'HC-CS.5', 'HC-CS.7'].map((id) => defs.get(id)!.claim)).toEqual(['approx', 'approx', 'approx', 'approx'])
    expect(['HC-CS.1', 'HC-CS.4', 'HC-CS.6', 'HC-CS.8'].map((id) => defs.get(id)!.claim)).toEqual(['exact', 'exact', 'exact', 'exact'])
  })

  it('S04 的「平均收斂 ⟺ Re eig(C) > 0」那一句：標籤是近似，註明 Bussgang 線性化、穩態平均、權重慢變', () => {
    const s04 = read('src/pages/case-sspll/sections/S04MeanUpdate.tsx')
    expect(s04).toContain('<Claim kind="approx">指 Bussgang 線性化、穩態平均、權重慢變（時間尺度分離）下</Claim>')
    expect(s04).not.toContain('<Claim kind="exact">指 Bussgang')
  })
})

describe('A7b：ε_k 的方向（feedback edge 早到為正）各處一致', () => {
  it('頁面：§2 的 PHOS 段、極性約定框、符號表、方塊圖都寫「早到」；極性約定框說明反過來讀要改哪裡', () => {
    const s02 = read('src/pages/case-sspll/sections/S02Architecture.tsx')
    expect(s02).toContain('還多早到一個固定的時間偏差')
    expect(s02).toContain('晚到就是負值')
    expect(s02).toContain('晚到為正')
    expect(s02).toContain('w_k\\leftarrow w_k-\\mu\\,q\\,r')
    expect(read('src/pages/case-sspll/symbols.tsx')).toContain('以 feedback edge「早到」為正')
    const dg = read('src/pages/case-sspll/diagrams.ts')
    expect(dg).toContain('以「早到」為正')
    expect(dg).toContain('早到 $\\varepsilon_k$')
  })

  it('analysis/sspll/sim：sim.py 的 e_inj docstring 與 README 的注入模型照同一個讀法（早到、補償量、u = t_ref′ − t_fb），不再說 PMUX 相位晚到', () => {
    const sim = read('analysis/sspll/sim/sim.py')
    const doc = sim.slice(sim.indexOf('def e_inj('), sim.indexOf('D = cfg[', sim.indexOf('def e_inj(')))
    expect(doc).toContain('arrives EARLY by c*Delta + eps_p')
    expect(doc).toContain('required compensation')
    expect(doc).toContain("u = required - actual = t_ref' - t_fb")
    expect(doc).toContain('only flips the sign convention')
    expect(doc).not.toMatch(/is late by eps_p/)
    expect(doc).not.toContain('required reference delay')
    // 程式碼沒動：u 的算式與固定點照舊
    expect(sim).toContain('u = (cD + eps_p)[..., None] - gain[None] * (cD[..., None] + w_p)')
    const md = read('analysis/sspll/sim/README.md')
    expect(md).toContain('比理想時刻**早到** $c\\Delta+\\varepsilon_p$')
    expect(md).toContain('$u$＝需要的補償量 − 實際的補償量，也就是 VCO 修正前的 $t_{ref}\'-t_{fb}$')
    expect(md).toContain('$u[n]=c[n]\\Delta+\\varepsilon_{p[n]}-(1-a)(1+w_g)\\big(c[n]\\Delta+w_{p[n]}\\big).$')
    expect(md).toContain('$w_k\\leftarrow w_k-\\mu_p G_k$')
    expect(md).not.toContain('需要的 reference delay')
    expect(md).not.toContain('$t_{fb}-t_{ref}$')
    expect(md).toContain('（以 feedback edge **早到**為正）')
  })

  it('docs/assumptions.md：§4 標題日期是 2026-10-16；「刻意保留的差異」多了 ε_k 方向這一條（真實電路決定讀法，改讀法只動 ε_k 的約定與 S02 的 w_k 更新式註記）', () => {
    const a = read('docs/assumptions.md')
    expect(a).toContain('## 4. 已知限制清單（2026-10-16 修訂）')
    expect(a).not.toContain('已知限制清單（2026-10-10）')
    const sec4 = a.slice(a.indexOf('## 4.'))
    expect(sec4).toContain('前兩條是 2026-10-12 加的，第三條是 2026-10-16 加的')
    const item = sec4.split('\n').find((l) => l.startsWith('- 案例頁 `/case/sspll` 的 `ε_k`'))!
    expect(item).toBeTruthy()
    for (const frag of ['以 feedback edge **早到**為正', '§2a 第 5 點', '**晚到**為正', '`sim/sim.py`', '`sim/README.md`', '真實電路決定', '`w_k ← w_k − μqr`', '不影響任何結論'])
      expect(item, frag).toContain(frag)
    // 三條「刻意保留的差異」並列（Lab、Ch11、案例頁）
    const diffs = sec4.slice(sec4.indexOf('刻意保留的差異'), sec4.indexOf('**呈現與驗證方式的限制**')).split('\n').filter((l) => l.startsWith('- '))
    expect(diffs).toHaveLength(3)
  })

  it('docs/analysis/sspll-gos-phos-polarity.md：極性約定段說明 Python 文件自 2026-10-16 起照同一個讀法，並保留「兩種讀法互為鏡像」', () => {
    const d = read('docs/analysis/sspll-gos-phos-polarity.md')
    expect(d).toContain('從 2026-10-16 起照同一個讀法寫')
    expect(d).toContain('兩種讀法互為鏡像')
    expect(d).toContain('由電路決定')
    expect(d).toContain('assumptions.md §4')
  })
})
