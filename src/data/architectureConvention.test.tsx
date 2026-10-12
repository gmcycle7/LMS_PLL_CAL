/**
 * 全站架構約定（docs/assumptions.md §2a）在「共用文字層」的檢查：
 * src/simulation 的檔頭與頁面字串、src/data 的 preset／勘誤、元件展示頁（Showcase）的方塊圖、README。
 *
 *   1. DTC 在 reference 輸入端：Reference clock → DTC → Phase detector；回授路徑上只有 divider／PMUX。
 *   2. LMS 校正迴路（1-bit comparator）的輸入是 PD 的輸出 e[n]，也就是送進 loop filter 的同一個節點。
 *   3. w·x 叫做 DTC 的「補償量」（從基準延遲 T_0 往回扣），不再寫成「DTC 插入／施加的延遲」；
 *      殘餘誤差在 PD 的 reference 輸入端注入：e_PD = +H_PD·φ_dtc、θ_out = +T·φ_dtc。
 * 數學、模型與 golden vector 都不變，所以這裡只檢查敘述與圖，不檢查數字。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import { SHOWCASE_CHART, SHOWCASE_CHART_CAPTION } from '@/components/Showcase'
import errataFile from '@/data/errata.json'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function listFiles(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listFiles(rel, keep))
    else if (keep(name)) out.push(rel)
  }
  return out.sort()
}

interface Edge {
  from: string
  to: string
  label: string
  dashed: boolean
}

/** flowchart 的連線（支援一行串好幾段：A --> B -- "x" --> C -. "y" .-> D）。節點的標籤先拿掉，只留 id。 */
function chartEdges(chart: string): Edge[] {
  const edges: Edge[] = []
  for (const raw of chart.split('\n').slice(1)) {
    const line = raw.trim().replace(/\["[^"]*"\]/g, '')
    if (!line) continue
    const parts = line.split(/\s*(--\s*"[^"]*"\s*-->|-\.\s*"[^"]*"\s*\.->|-\.->|-->)\s*/)
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const op = parts[i + 1]
      edges.push({ from: parts[i], to: parts[i + 2], label: op.match(/"([^"]*)"/)?.[1] ?? '', dashed: op.startsWith('-.') })
    }
  }
  return edges
}

/** 舊接法（DTC 在 divider 之後、feedback 側注入）的說法；出現在 scope 裡任何一個檔案都算錯。 */
const OLD_ARCHITECTURE: ReadonlyArray<[string, RegExp]> = [
  ['DTC 畫在 divider 之後／回授路徑上', /DTC\s*(?:畫)?在\s*(?:divider|除頻器|回授|feedback)[^。；\n]{0,6}(?:之後|後面|路徑)|(?:divider|除頻器)\s*(?:之後|後面)的\s*DTC/],
  ['divider 的 edge 經過 DTC', /(?:divider|除頻器|feedback|回授)[^。；\n]{0,10}edge[^。；\n]{0,6}(?:經過|送進|進入)\s*DTC/],
  ['DTC 插入／施加延遲', /DTC[^。；\n]{0,8}(?:插入|施加|多施加)[^。；\n]{0,6}(?:的)?\s*(?:延遲|delay)/],
  ['把 edge 推回理想時刻', /推回(?:理想|正確)/],
  ['feedback 側／回授側注入', /(?:feedback|回授)\s*(?:側|端|比較路徑)[^。；\n]{0,8}(?:注入|加進)/],
  ['注入點在 PD 比較端', /注入點在\s*PD\s*比較端/],
  ['e_PD = −(θ_out + φ_dtc)', /e_\{?\\?(?:mathrm\{)?PD\}?\}?\s*=\s*-\s*\(|e_PD\s*=\s*[−-]\s*\(/],
  ['θ_out = −T·φ_dtc', /(?:θ_out|\\theta_\{?\\?(?:mathrm\{)?out\}?\}?)\s*=\s*[−-]\s*T/],
  ['e_PD = −H_PD·φ_dtc', /(?:e_PD|e_\{\\mathrm\{PD\}\})\s*=\s*[−-]\s*H/],
]

describe('偵測規則本身：舊接法的例句都抓得到，新接法的句子不會誤判', () => {
  const OLD_SAMPLES = [
    '規格的概念圖把 DTC 畫在 divider 之後',
    'divider 的 edge 經過 DTC 才到 PD',
    'divider edge 早到，DTC 插入延遲把它補回來',
    'DTC 實際多施加的延遲 δt[n] = x[n]·δw[n]',
    'DTC 實際施加 delay 的擾動',
    '把 edge 推回理想時刻',
    'DTC 誤差在 feedback 比較路徑加進來',
    '（注入點在 PD 比較端；極性見 E33）',
    String.raw`e_{\mathrm{PD}}=-(\theta_{\mathrm{out}}+\phi_{\mathrm{dtc}})`,
    String.raw`\theta_{\mathrm{out}}=-T\,\phi_{\mathrm{dtc}}`,
    String.raw`e_{\mathrm{PD}}=-H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}`,
    'θ_out = −T·φ_dtc',
  ]
  const NEW_SAMPLES = [
    'DTC 在 reference 輸入端，回授路徑上只有 divider',
    'carry y[n] 控制回授路徑上的 divider；DTC 不在回授路徑上，而在 reference 輸入端',
    'DTC 只能延遲、不能提前，所以從固定的基準延遲 T_0 往回扣：τ_DTC = T_0 − w·x[n]',
    'e_PD = φ_dtc − θ_fb ⇒ e_PD = +H_PD·φ_dtc，θ_out = +T·φ_dtc',
    String.raw`$u_{\mathrm{pd}}=+H_{\mathrm{PD}}\{e_{\mathrm{DTC}}\}$、$t_{\mathrm{out}}=+T\{e_{\mathrm{DTC}}\}$`,
    'feedback（divider）edge 早到 a·x[n]；reference 端的 DTC 把 reference edge 也提前 w·x[n] 去對齊',
    'GOS 從 reference 端的 DTC 進來、PHOS 從 feedback 端的 PMUX 進來',
  ]
  const flagged = (text: string) => OLD_ARCHITECTURE.filter(([, re]) => re.test(text)).map(([what]) => what)

  it('每一句舊說法至少被一條規則抓到；每一條規則至少抓到一句', () => {
    for (const t of OLD_SAMPLES) expect(flagged(t).length, t).toBeGreaterThan(0)
    for (const [what, re] of OLD_ARCHITECTURE) expect(OLD_SAMPLES.some((t) => re.test(t)), what).toBe(true)
  })

  it('新接法的句子一條都不會被抓', () => {
    for (const t of NEW_SAMPLES) expect(flagged(t), t).toEqual([])
  })
})

describe('元件展示頁（Showcase）的簡化訊號流：DTC 在 reference 輸入端，LMS 的輸入是 PD 的輸出', () => {
  beforeAll(installMermaidSvgShim)
  const edges = chartEdges(SHOWCASE_CHART)
  const has = (from: string, to: string) => edges.some((e) => e.from === from && e.to === to)
  const into = (to: string) => edges.filter((e) => e.to === to).map((e) => e.from).sort()

  it('主迴路：REF → DTC → PD → loop filter → VCO；回授是 VCO → DIV → PD，回授路徑上沒有 DTC', () => {
    expect(has('REF', 'DTC')).toBe(true)
    expect(has('DTC', 'PD')).toBe(true)
    expect(has('PD', 'LF')).toBe(true)
    expect(has('LF', 'VCO')).toBe(true)
    expect(has('VCO', 'DIV')).toBe(true)
    expect(has('DIV', 'PD')).toBe(true)
    // 舊接法的三個特徵都不能出現
    expect(has('DIV', 'DTC')).toBe(false)
    expect(has('REF', 'PD')).toBe(false)
    expect(has('VCO', 'DTC')).toBe(false)
    // PD 的兩個輸入：DTC（reference 那一邊）與 divider（回授那一邊）
    expect(into('PD')).toEqual(['DIV', 'DTC'])
    // DTC 的輸入：reference、小數餘數（code）、校正迴路給的 gain
    expect(into('DTC')).toEqual(['REF', 'RES', 'U'])
    // divider 只接在 VCO 後面
    expect(into('DIV')).toEqual(['VCO'])
  })

  it('校正迴路：comparator 唯一的輸入是 PD 的輸出 e[n]（和 PD → loop filter 同一個訊號名稱），再到 GMAC → gain update → DTC', () => {
    expect(into('CMP')).toEqual(['PD'])
    const tap = edges.find((e) => e.from === 'PD' && e.to === 'CMP')!
    const main = edges.find((e) => e.from === 'PD' && e.to === 'LF')!
    expect(tap.label).toBe('$e[n]$')
    expect(main.label).toBe('$e[n]$')
    expect(tap.dashed).toBe(true) // 觀測用的分接，不在主迴路的訊號路徑上
    expect(main.dashed).toBe(false)
    expect(has('CMP', 'GMAC')).toBe(true)
    expect(has('GMAC', 'U')).toBe(true)
    expect(edges.find((e) => e.from === 'U' && e.to === 'DTC')!.label).toBe('$w_k$')
    // 校正迴路的輸入不是從 DTC、divider 或 loop filter 拉的
    for (const src of ['DTC', 'DIV', 'LF', 'VCO', 'REF']) expect(has(src, 'CMP')).toBe(false)
  })

  it('圖說講清楚兩件事；節點與圖說的數學都是 LaTeX', () => {
    expect(SHOWCASE_CHART_CAPTION).toContain('DTC 在 reference 輸入端')
    expect(SHOWCASE_CHART_CAPTION).toContain('回授路徑只有 divider')
    expect(SHOWCASE_CHART_CAPTION).toContain('comparator 取 PD 的輸出 $e[n]$，也就是送進 loop filter 的同一個訊號')
    expect(SHOWCASE_CHART_CAPTION).toContain('補償量 $w_k\\,x[n]$')
    expect((SHOWCASE_CHART_CAPTION.match(/\$/g) ?? []).length % 2).toBe(0)
    expect(unicodeMathIn(SHOWCASE_CHART_CAPTION.replace(/\$[^$]*\$/g, ''))).toEqual([])
  })

  it('用真正的 Mermaid 畫得出來：10 個節點、沒有 Unsupported markdown、沒有殘留的 $ 或 Unicode 拼的數學', async () => {
    const r = await renderMermaidForTest(SHOWCASE_CHART)
    expect(r.nodeCount).toBe(10)
    expect(r.text).not.toMatch(/Unsupported markdown/)
    expect(r.text).not.toContain('$')
    expect(r.mathCount).toBeGreaterThanOrEqual(4) // x[n]、兩個 e[n]、w_k
    expect(unicodeMathIn(r.plainText)).toEqual([])
    for (const name of ['Reference', 'DTC', 'Phase', 'Loop', 'VCO', 'Divider', 'comparator', 'GMAC', 'Gain']) expect(r.text).toContain(name)
  })

  it('元件展示頁用的就是這張圖（原始碼裡不再有舊的 DSM → DTC → BBPD 直線圖）', () => {
    const src = read('src/components/Showcase.tsx')
    expect(src).toContain('<Mermaid chart={SHOWCASE_CHART} caption={SHOWCASE_CHART_CAPTION} />')
    expect(src).not.toContain('BBPD / Comparator')
    expect((src.match(/<Mermaid\b/g) ?? []).length).toBe(1)
  })
})

describe('模型檔（src/simulation）的檔頭與頁面字串：照 §2a 的說法', () => {
  it('pll.ts：殘餘誤差在 PD 的 reference 輸入端注入，e_PD = φ_dtc − θ_fb ⇒ +H_PD、+T', () => {
    const src = read('src/simulation/models/pll.ts')
    expect(src).toContain('DTC 在 reference 輸入端，回授路徑上只有 divider')
    expect(src).toContain('e_PD = φ_dtc − θ_fb')
    expect(src).toContain('e_PD = +H_PD·φ_dtc，θ_out = +T·φ_dtc（H_PD + T = 1）')
    expect(src).toContain('LMS 的輸入就是這個節點')
  })

  it('dsm.ts／dtc.ts：carry 控制回授的 divider；DTC 在 reference 端，從基準延遲 T_0 往回扣（τ_DTC = T_0 − w·x）', () => {
    const dsm = read('src/simulation/models/dsm.ts')
    expect(dsm).toContain('carry y[n] 控制回授路徑上的 divider；DTC 不在回授路徑上，而在 reference 輸入端')
    expect(dsm).toContain('feedback edge 早到 x[n] = s[n]/M 個 T_vco')
    expect(dsm).toContain('τ_DTC = T_0 − w·x[n]')
    const dtc = read('src/simulation/models/dtc.ts')
    expect(dtc).toContain('DTC 在 reference 輸入端，回授路徑上只有 divider')
    expect(dtc).toContain('τ_DTC[n] = T_0 − w·x[n]')
    expect(dtc).toContain('C_0 − w·x[n]')
    expect(dtc).toContain('「補償量」')
    // 控制碼（LSB）與時間之間差 DTC 的 gain：T_0 = delay(C_0)，以時間計的 w = gain × 以 LSB 計的 w
    expect(dtc).toContain('τ_DTC = gain·(C_0 − w·x) + offset')
    expect(dtc).toContain('T_0 = delay(C_0)')
  })

  it('bias.ts：d(x) 是 reference 端 DTC 在這個 code 多出來的延遲，以正號進入 e（t_ref′ − t_fb = (a − w)x + d(x)）；公式本身不變', () => {
    const src = read('src/simulation/models/bias.ts')
    expect(src).toContain('DTC 在 reference 輸入端，回授路徑上只有 divider')
    expect(src).toContain('feedback edge 早到 a·x（t_fb = −a·x）')
    expect(src).toContain('t_ref′ = T_0 − w·x + d(x)')
    expect(src).toContain('PD 量 t_ref′ − t_fb = (a − w)x + d(x)')
    expect(src).toContain('comparator 取的是 PD 的輸出（送進 loop filter 的同一個節點）')
    // 頁面顯示的 core 區塊：e_det = (a − w)x + b + c_2x² + c_3x³ + κx，正負號沒有動
    expect(src).toContain('return (m.a - w) * x + m.b + m.c2 * x * x + m.c3 * x * x * x + m.kappa * x')
  })

  it('polarity.ts／sspll.ts：誤差在 PD 的 reference 輸入端注入（e_PD = +H_PD·u）；SSPLL 的 DTC 在 reference 端、PMUX 在回授路徑', () => {
    const pol = read('src/simulation/models/polarity.ts')
    expect(pol).toContain('DTC 在 reference 輸入端，ε 在 PD 的 reference 輸入端注入（e_PD = ε − θ_fb）')
    expect(pol).toContain('q 取的是 PD 的輸出（送進 loop filter 的同一個節點）的正負號')
    const ss = read('src/simulation/models/sspll.ts')
    expect(ss).toContain('input DTC 在 reference 端（Reference → DTC → SSPD），8 相 PMUX 在回授路徑')
    expect(ss).toContain('1-bit 比較器取的是 PD 的輸出 e_PD，也就是送進 loop filter 的同一個節點')
    expect(ss).toContain('「比較點」= PD 的輸入端')
    expect(ss).toContain('e_PD = u − y ⇒ e_PD = +H_PD·u（正號）')
    // 模型的注入式與比較器沒有動（golden port）
    expect(ss).toContain('const u = c * Dl + eps[p] - gain * (c * Dl + W[l][p])')
    expect(ss).toContain('const q = Math.sign(e + sig * noise[l].normal() + uOs)')
  })

  it('calNoise.ts（E33）：δt = x·δw 是「多補償的量」，殘餘 timing error 的對應項是 −x·δw；輸出 θ_out = +T·φ_dtc', () => {
    const src = read('src/simulation/models/calNoise.ts')
    expect(src).toContain('δt[n] = x[n]·δw[n] 是 DTC 多補償的量')
    expect(src).toContain('殘餘 timing error e = (a − w)x 的對應項為 −x[n]·δw[n]')
    expect(src).toContain('θ_out = +T·φ_dtc')
    expect(src).not.toContain('多施加的延遲')
    // 輸出相位的正負號沒有改（數值模型不動）：φ_out = −2π f_out T δt，只是理由換成「+T 乘上殘餘誤差 −δt」
    expect(src).toContain('const phi = -scale * (dt[n] - mean)')
    expect(src).toContain('φ_out = +T·φ_dtc，φ_dtc = 2π f_out·(−δt)')
    // 提到「reference edge 提前」的地方都要帶著 T_0 的說明（DTC 不能產生負的延遲）
    expect(src).toContain('延遲是 τ_DTC = T_0 − w·x，所以多補償 δt 就是 reference edge 多提前（少延遲）δt')
  })

  it('凡是說 reference edge「提前」的檔頭，同一段都有 T_0（DTC 只能延遲，不能提前）', () => {
    for (const f of listFiles('src/simulation', (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const lines = read(f).split('\n')
      lines.forEach((line, i) => {
        if (!/(?:reference|ref)\s*edge[^。；\n]{0,12}提前/.test(line)) return
        const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
        expect(near, `${f}:${i + 1}`).toMatch(/T_0/)
      })
    }
  })

  it('blockLms.ts／unifiedLab.ts：DTC 在 reference 輸入端、補償量 w·x、comparator 取 PD 的輸出', () => {
    const blk = read('src/simulation/models/blockLms.ts')
    expect(blk).toContain('DTC 在 reference 輸入端，a·x 是需要補的量、w_applied·x 是 DTC 的補償量')
    expect(blk).toContain('comparator 取的就是 PD 的輸出（送進 loop filter 的同一個節點）')
    const lab = read('src/simulation/models/unifiedLab.ts')
    expect(lab).toContain('e_DTC 在 PD 的 reference 輸入端注入')
    expect(lab).toContain('Comparator（輸入取自 PD 的輸出，也就是送進 loop filter 的同一個節點）')
  })

  it('整個 src/simulation（含測試）沒有舊接法的說法', () => {
    const files = listFiles('src/simulation', (n) => n.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(60)
    const hits: string[] = []
    for (const f of files) {
      const lines = read(f).split('\n')
      lines.forEach((line, i) => {
        for (const [what, re] of OLD_ARCHITECTURE) if (re.test(line)) hits.push(`${f}:${i + 1} ${what}：${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })
})

describe('資料檔（src/data）與 README：照 §2a 的說法', () => {
  it('preset gmac-residue-hand-example：divider edge 早到，reference 端的 DTC 給的是「補償量」；數字不變', () => {
    const p = JSON.parse(read('src/data/presets/gmac-residue-hand-example.json')) as { expected: string }
    expect(p.expected).toContain('feedback 的 divider edge 永遠早到')
    expect(p.expected).toContain('reference 端的 DTC 需要的補償量 ∈ [0, 72115] fs')
    expect(p.expected).not.toContain('需要的延遲')
    expect(p.expected).toContain('r[n] ∈ [−0.9375, 0] T_vco')
    expect(p.expected).toContain('PD 殘差最大 721.15 fs（= 0.01 × 15/16 × 76923 fs）')
  })

  it('勘誤 E33：δt = x·δw 是 DTC「補償量的擾動」；數值證據不變', () => {
    const e33 = (errataFile as { errata: { eid: string; correction: string; evidence: string }[] }).errata.find((e) => e.eid === 'E33')!
    expect(e33.correction).toContain('DTC 補償量的擾動（多補償的時間）δt[n]=x[n]δw[n]')
    expect(e33.correction).toContain('對應的殘餘 timing error 貢獻為 −x[n]δw[n]')
    expect(e33.correction).not.toContain('施加 delay')
    expect(e33.evidence).toBe('取 w*=a=3、w=3.4、x=1：e_DTC=(a−w)x=−0.4，δt=x·δw=+0.4。')
    // docs/validation.md 的 E33 和網站顯示的勘誤（errata.json）是同一段文字
    const validation = read('docs/validation.md')
    expect(validation).toContain('DTC 補償量的擾動（多補償的時間）δt[n]=x[n]δw[n]；對應的殘餘 timing error 貢獻為 −x[n]δw[n]')
    expect(validation).not.toContain('施加 delay')
  })

  it('所有 preset 與勘誤的文字沒有舊接法的說法', () => {
    const files = [...listFiles('src/data/presets', (n) => n.endsWith('.json')), 'src/data/errata.json']
    expect(files.length).toBeGreaterThan(200)
    const hits: string[] = []
    for (const f of files) {
      const text = read(f)
      for (const [what, re] of OLD_ARCHITECTURE) {
        const m = text.match(re)
        if (m) hits.push(`${f} ${what}：${m[0]}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('SSPLL 案例的 golden 資料本來就是這個接法：PMUX 在回授路徑、DTC 在 reference 端', () => {
    const params = JSON.parse(read('src/data/sspll/params.json')) as { assumptions: { fractional_architecture: string } }
    expect(params.assumptions.fractional_architecture).toBe('8-phase PMUX in the feedback path + input (reference-side) DTC')
  })

  it('README：寫明架構約定並連到 docs/assumptions.md §2a', () => {
    const readme = read('README.md')
    expect(readme).toContain('**架構約定**（[docs/assumptions.md](docs/assumptions.md) §2a）')
    expect(readme).toContain('`Reference clock → DTC → Phase detector`')
    expect(readme).toContain('`VCO → Divider → Phase detector`')
    expect(readme).toContain('LMS 校正迴路的輸入是 PD 的輸出 `e[n]`')
    for (const [, re] of OLD_ARCHITECTURE) expect(readme).not.toMatch(re)
    // 約定本身（唯一的來源）有這一節
    expect(read('docs/assumptions.md')).toContain('## 2a. 全站架構約定：DTC 在 reference 輸入端')
  })
})

describe('docs/assumptions.md §2a：各章共用、但單看一章看不出來的正負號約定都寫在這裡', () => {
  const doc = read('docs/assumptions.md')
  const sec = doc.slice(doc.indexOf('## 2a.'), doc.indexOf('## 3.'))

  it('INL 的正負號和模型一致：τ_DTC = T_0 − w·x + d(x)（d = 這個 code 多出來的延遲），e = (a − w)x + d(x) + v', () => {
    expect(sec).toContain('有 INL 時是 `T_0 − w_k·x[n] + d(x)`')
    expect(sec).toContain('`e = (a − w_k)·x + d(x) + v`')
    // 舊的寫法（把 INL 放進被扣掉的括號裡）會讓 e 裡的 d(x) 變成負號，和 bias.ts／blockLms.ts／golden vector 相反
    expect(sec).not.toMatch(/T_0 − \(w_k·x\[n\] \+ INL/)
    expect(read('src/simulation/models/bias.ts')).toContain('t_ref′ = T_0 − w·x + d(x)')
    // Ch04 的兩張概念圖與 Ch11 的圖用同一個正負號
    const ch04 = read('src/chapters/ch04/diagrams.ts')
    expect(ch04.match(/\$= T_0 - w_k\\,x\[n\] \+ d\(x\)\$/g) ?? []).toHaveLength(2)
    expect(ch04).not.toMatch(/T_0 - \(w_k/)
    expect(read('src/chapters/ch11/diagrams.ts')).toContain(String.raw`$t_\mathrm{ref}' = T_0 - w \cdot x + d(x)$`)
  })

  it('雜訊 v[n]：折算到 comparator 輸入（＝PD 輸出）的等效雜訊，e[n] 已經包含它；兩種畫法是同一件事', () => {
    expect(sec).toContain('雜訊 `v[n]` 是折算到這個節點（comparator 的輸入＝PD 的輸出）的等效雜訊，式子裡的 `e[n]` 已經包含它')
    expect(read('src/chapters/ch04/sections/Intro.tsx')).toContain('章首的系統地圖把')
  })

  it('相位的正負號：edge 的時間誤差 × 2π f_out、晚到為正；δt = x·δw 是多補償 ⇒ φ_dtc = −2π f_out δt、φ_out = −2π f_out T δt（負號來自 δt，不是 T）', () => {
    expect(sec).toContain('**晚到為正**')
    expect(sec).toContain('`φ_dtc = −2π·f_out·δt`、`φ_out = θ_out = T·φ_dtc = −2π·f_out·T·δt`（F-12.16）')
    expect(sec).toContain('式子裡的負號來自 `δt` 的定義，不是 `T` 的正負號')
    // 用到這條式子的四個地方寫的是同一個正負號
    const same = String.raw`-2\pi f_{\mathrm{out}}`
    expect(read('src/chapters/ch12/formulas.ts')).toContain(String.raw`\phi_{\mathrm{out}}(s)=${same}T(s)\,\delta t(s)`)
    expect(read('src/pages/formulas/appendixA.ts')).toContain(String.raw`\phi_{\mathrm{out}}(s)=${same}\,T(s)\,\delta t(s)`)
    expect(read('src/chapters/ch13/sections/Intro.tsx')).toContain(String.raw`\phi_\mathrm{dtc}=-2\pi f_\mathrm{out}\,\delta t`)
    expect(read('src/pages/signoff/sections/S4Cases.tsx')).toContain(String.raw`\phi_\text{dtc}=-2\pi f_\text{out}\,\delta t`)
    expect(read('src/simulation/models/calNoise.ts')).toContain('const phi = -scale * (dt[n] - mean)')
  })

  it('PD 兩條輸入線的兩種標法都寫明；刻意保留的差異（Lab 的 x = r ≤ 0、E17 的 x_j = −2）列在已知限制', () => {
    expect(sec).toContain('圖上進 PD 的兩條線有兩種標法')
    expect(sec).toContain('讀圖時以方塊裡的 `e[n] = t_ref′ − t_fb` 為準')
    expect(doc).toContain('和 §2a 架構約定有關、刻意保留的差異')
    expect(doc).toContain('`r[n] = −s[n]/M`（未置中的一階 DSM 為 `x ≤ 0`）')
    expect(doc).toContain('jitter 最小的 code 取 `x_j = −2`')
    // 頁面上對應的說明還在
    expect(read('src/pages/lab/sections/S2Chain.tsx')).toContain('兩者差一個負號')
    expect(read('src/chapters/ch11/sections/OffsetSection.tsx')).toContain('方向的提醒')
    expect(read('src/chapters/ch11/experiments/BiasInlLab.tsx')).toContain('延遲最短的是最大的 code')
  })

  it('docs（規格書原稿除外）沒有舊接法的說法；提到舊接法的地方只有「規格原圖是這樣畫的」與「不要再這樣寫」', () => {
    const allowed = [/規格 §4 的概念圖把 DTC 畫在 divider 之後/, /不要再寫成「DTC 插入的延遲」/]
    const hits: string[] = []
    for (const f of listFiles('docs', (n) => n.endsWith('.md') && !n.includes('Blueprint'))) {
      read(f)
        .split('\n')
        .forEach((line, i) => {
          if (allowed.some((re) => re.test(line))) return
          for (const [what, re] of OLD_ARCHITECTURE) if (re.test(line)) hits.push(`${f}:${i + 1} ${what}：${line.trim().slice(0, 100)}`)
        })
    }
    expect(hits).toEqual([])
    // 使用者晶片的分析文件和案例頁用同一種讀法（DTC 延遲 = T_0 − 補償量；PMUX 的 ε_k 以早到為正）
    const analysis = read('docs/analysis/sspll-gos-phos-polarity.md')
    expect(analysis).toContain('延遲 = T_0 − 補償量')
    expect(analysis).toContain('兩種讀法互為鏡像')
  })
})
