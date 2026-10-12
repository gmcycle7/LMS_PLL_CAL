/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest, unicodeMathIn } from '@/components/mermaidTestUtils'
import * as D from './diagrams'
import { CIRC, SIGNOFF_CHARTS } from './diagrams'
import { centralDifference, cornerJudge, failureUpperBound, gCrit, kq, mimoJudge, negativeSignatures, polarityVerdict, slopeStdErr, spurDbc } from './judges'
import { PILLARS } from './sections/S0Intro'
import { hasMath, mathLabelCount, quotedLabels, renderProblems, unicodeMathInSource } from '../lab/diagramTestUtils'

/** 圖原始碼的 TeX 反斜線只寫一次（與 diagrams.ts 的 String.raw 相同） */
const R = String.raw

interface Vertex {
  id: string
  text?: string
  type?: string
}
interface Edge {
  start: string
  end: string
  text?: string
}
type Graph = { vertices: Vertex[]; edges: Edge[] }

/** 用真正的 mermaid parser 取出 flowchart 的節點與邊。 */
async function flow(chart: string): Promise<Graph> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(chart)
  const db = diagram.db as unknown as { getVertices: () => Map<string, Vertex>; getEdges: () => Edge[] }
  return { vertices: [...db.getVertices().values()], edges: db.getEdges() }
}

/** 某條邊的標籤（找不到就丟錯，讓測試訊息指出是哪一條）。 */
function edgeText(g: Graph, start: string, end: string): string {
  const e = g.edges.find((x) => x.start === start && x.end === end)
  if (!e) throw new Error(`沒有 ${start} → ${end} 這條邊`)
  return e.text ?? ''
}
/** 連線標籤開頭的正負號（可能寫成 `$-$`、`$+$`）：統一成全形「＋」與減號「−」（U+2212） */
function leadingSign(text: string): string {
  const c = text.trim().replace(/^\$/, '').charAt(0)
  return c === '+' ? '＋' : c === '-' ? '−' : c
}
const hasEdge = (g: Graph, start: string, end: string) => g.edges.some((e) => e.start === start && e.end === end)
const node = (g: Graph, id: string): string => {
  const v = g.vertices.find((x) => x.id === id)
  if (!v) throw new Error(`沒有節點 ${id}`)
  return v.text ?? ''
}

/** 比對用：拿掉換行標籤與空白，並還原 mermaid 在含 HTML 的標籤裡做的 entity 編碼。 */
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')

/** Mermaid 11 把標籤當 Markdown：這些寫法會被畫成「Unsupported markdown: …」或被 HTML 解析吃掉。 */
function labelHazard(text: string): string | null {
  for (const line of text.split(/<br\s*\/?>/)) {
    const t = line.trim()
    if (t === '+' || t === '-' || t === '*') return `單獨的「${t}」會被當成清單`
    if (/^[+\-*] /.test(t)) return `「${t.slice(0, 8)}」以清單符號開頭`
    if (/^\d+[.)] /.test(t)) return `「${t.slice(0, 8)}」以編號清單開頭`
    if (/^#{1,6} /.test(t)) return `「${t.slice(0, 8)}」以標題符號開頭`
    if (/`/.test(t)) return '反引號會被當成 code span'
  }
  if (/<(?!br\s*\/?>)[A-Za-z/!]/.test(text)) return '「<」後面緊接字母，會被當成 HTML 標籤'
  return null
}

describe('Sign-off 頁的方塊圖（真正的 mermaid）', () => {
  beforeAll(() => {
    installMermaidSvgShim()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true })
  })

  it('清單：七張圖，diagrams.ts 匯出的每張圖都在清單裡，沒有重複', () => {
    expect(SIGNOFF_CHARTS.map((c) => c.name)).toEqual([
      'CHART_SIGNOFF_FLOW',
      'CHART_FREEZE_MEASURE',
      'CHART_EVIDENCE',
      'CHART_CORNER_JUDGE',
      'CHART_MIMO_LOOP',
      'CHART_OUTPUT_PATH',
      'CHART_NEGATIVE_CHECKS',
    ])
    const exported = Object.entries(D).filter(([, v]) => typeof v === 'string' && /^(flowchart|stateDiagram|sequenceDiagram)/.test(v as string))
    expect(exported.map(([k]) => k).sort()).toEqual(SIGNOFF_CHARTS.map((c) => c.name).sort())
    for (const [k, v] of exported) expect(SIGNOFF_CHARTS.find((c) => c.name === k)?.chart).toBe(v)
    expect(new Set(SIGNOFF_CHARTS.map((c) => c.chart)).size).toBe(SIGNOFF_CHARTS.length)
  })

  it('版面：七張都是直向（flowchart TB）。橫向（LR）的長鏈在桌機的正文欄（約 900 px）會寬出欄寬好幾倍、要橫向捲動（teaching-style §8「版面寬度」；diagram-audit 量過：TB 之後最寬 800 px）', () => {
    for (const c of SIGNOFF_CHARTS) expect(c.chart, c.name).toMatch(/^flowchart TB\n/)
  })

  it('每一張都能真的畫出來：沒有「Unsupported markdown」、畫出來的文字沒有 $、公式都由 KaTeX 排版、KaTeX 以外沒有 Unicode 拼的數學、節點不超過 14 個、標籤沒有會被 Markdown／HTML 吃掉的寫法、加法點的每條輸入都標了正負號', async () => {
    for (const c of SIGNOFF_CHARTS) {
      const parsed = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(parsed && typeof parsed === 'object' ? parsed.diagramType : parsed, c.name).toBe('flowchart-v2')
      const r = await renderMermaidForTest(c.chart)
      const { text, nodeCount } = r
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(text, c.name).not.toContain('$')
      expect(unicodeMathIn(r.plainText), `${c.name} 畫面上 KaTeX 以外的 Unicode 數學`).toEqual([])
      expect(unicodeMathInSource(c.chart), `${c.name} 原始碼 $...$ 以外的 Unicode 數學`).toEqual([])
      expect(r.mathCount, `${c.name} KaTeX 公式數`).toBe(mathLabelCount(c.chart))
      expect(r.mathCount, c.name).toBeGreaterThanOrEqual(5)
      expect(renderProblems(c.chart, r), c.name).toEqual([])
      expect(nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(7)
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數（parser）`).toBe(nodeCount)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      // 不含公式的標籤原樣畫出來；含公式的標籤由 KaTeX 排版（renderProblems 已逐一核對它的文字部分）
      const shown = plain(text)
      for (const v of g.vertices) if (!hasMath(v.text ?? '')) expect(shown.includes(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text && !hasMath(e.text)) expect(shown.includes(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
      // 加法點 = 圓形節點、文字是全形「＋」；每條進來的邊都要以「＋」或「−」開頭（後面還有說明時，負號寫成 `$-$`）
      for (const s of g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(leadingSign(e.text ?? ''), `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
      // 沒有裸的 ASCII 「<」（只允許 <br/>）與分號
      expect(c.chart.replace(/<br\/>/g, ''), c.name).not.toMatch(/[<;]/)
      // 圖內的數學都是成對的 `$...$`
      expect(quotedLabels(c.chart).some(hasMath), c.name).toBe(true)
      for (const label of quotedLabels(c.chart)) expect((label.match(/(?<!\\)\$/g) ?? []).length % 2, `${c.name}：「${label}」的 $ 要成對`).toBe(0)
    }
  }, 120_000)

  it('六道關卡：順序與頁面「六個條件」表（PILLARS）一致；每一格「是」往下走、「否」都到不可 sign-off；只有第六格通過才到 OK', async () => {
    expect(PILLARS.map((p) => p.name)).toEqual(['Identifiability', 'Polarity', 'Stability', 'Variance', 'Bias', 'System-level'])
    const g = await flow(D.CHART_SIGNOFF_FLOW)
    const q = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
    q.forEach((id, i) => {
      expect(g.vertices.find((v) => v.id === id)?.type, id).toBe('diamond')
      expect(node(g, id), id).toContain(`${CIRC[i]} ${PILLARS[i].name}`)
      const next = i < 5 ? q[i + 1] : 'OK'
      expect(edgeText(g, id, next), `${id} → ${next}`).toBe('是')
      expect(edgeText(g, id, 'BAD'), `${id} → BAD`).toBe('否')
    })
    // OK 只能從第六格來；起點只接到第一格
    expect(g.edges.filter((e) => e.end === 'OK').map((e) => e.start)).toEqual(['Q6'])
    expect(g.edges.filter((e) => e.start === 'START').map((e) => e.end)).toEqual(['Q1'])
    // 判準與頁面公式一致（F-SO.12、F-SO.1、F-SO.5、F-SO.7）
    expect(node(g, 'Q1')).toContain(R`$\sigma_{\min}(\hat{\mathbf J}) \gt z\cdot\lVert\mathrm{se}\rVert_F$`)
    expect(node(g, 'Q1')).toContain(R`$\lambda_{\min}(\mathbf R) \gt 0$`)
    expect(node(g, 'Q2')).toContain(R`$\hat K - z\cdot\mathrm{se} \gt 0$`)
    expect(node(g, 'Q3')).toContain(R`$g \lt g_{\mathrm{crit}}(d)$`)
    expect(node(g, 'Q3')).toContain(R`$\rho(\mathbf I + \mathbf M\mathbf J) \lt 1$`)
    expect(node(g, 'Q6')).toContain('T')
    // 技術審查 R14：σ_δt 是還沒經過 PLL 的 DTC 補償誤差 RMS（符號表），不可標成「輸出 σ_δt」；第六格驗收的是輸出的 jitter 與 spur（δt 經 T）
    expect(node(g, 'Q6')).toContain('輸出 jitter 與 spur')
    expect(node(g, 'Q6')).toContain(R`$\delta t$ 經 $T$`)
    expect(D.CHART_SIGNOFF_FLOW).not.toMatch(/輸出\s*\$\\sigma_\{\\delta t\}\$/)
    expect(D.CHART_SIGNOFF_FLOW).toMatch(/class OK ok/)
    expect(D.CHART_SIGNOFF_FLOW).toMatch(/class BAD warn/)
  })

  it('freeze ±Δ：Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ)（加法點 ＋Ḡ₊、−Ḡ₋）、K̂ = −Ŝ、se = σ_η/(Δ√(2M))，三分法判決和 polarityVerdict 一致（公式在圖上是 LaTeX）', async () => {
    const g = await flow(D.CHART_FREEZE_MEASURE)
    expect(edgeText(g, 'UP', 'D')).toBe(R`＋（$\bar G_+$）`)
    expect(leadingSign(edgeText(g, 'DN', 'D'))).toBe('−')
    expect(edgeText(g, 'DN', 'D')).toBe(R`$-$（$\bar G_-$）`)
    expect(hasEdge(g, 'FZ', 'UP') && hasEdge(g, 'FZ', 'DN')).toBe(true)
    expect(node(g, 'UP')).toContain(R`$w = w_0 + \Delta$`)
    expect(node(g, 'DN')).toContain(R`$w = w_0 - \Delta$`)
    expect(node(g, 'DIV')).toContain(R`$\hat S = (\bar G_+ - \bar G_-)/(2\Delta)$`)
    expect(node(g, 'NEG')).toContain(R`$\hat K = -\hat S$`)
    expect(edgeText(g, 'D', 'DIV')).toBe('')
    expect(edgeText(g, 'DIV', 'NEG')).toBe(R`$\hat S$`)
    expect(edgeText(g, 'NEG', 'V')).toBe(R`$\hat K$`)
    expect(node(g, 'SE')).toContain(R`$\mathrm{se}(\hat S) = \sigma_\eta/(\Delta\sqrt{2M})$`)
    expect(hasEdge(g, 'SE', 'V')).toBe(true)
    for (const id of ['PASS', 'REV', 'INC']) expect(hasEdge(g, 'V', id), id).toBe(true)
    // 數值：線性模型 Ḡ(w) = K·(a − w)，w₀ = a：Ḡ₊ = −KΔ、Ḡ₋ = +KΔ ⇒ Ŝ = −K、K̂ = +K（圖上的代數）
    const K = 0.0125
    const delta = 20
    const est = centralDifference([-K * delta], [K * delta], delta)
    expect(est.S).toBeCloseTo(-K, 12)
    expect(est.K).toBeCloseTo(K, 12)
    // 標準誤公式 = 頁面計算用的 slopeStdErr：σ_η = 1/√N、每側 M 個 block
    expect(slopeStdErr(20, 4096, 8)).toBeCloseTo(1 / Math.sqrt(4096) / (20 * Math.sqrt(2 * 8)), 15)
    // 三個出口：K̂ − z·se ＞ 0 → pass、K̂ + z·se ＜ 0 → reversed、其餘 inconclusive
    expect(node(g, 'PASS')).toContain(R`$\hat K - z\cdot\mathrm{se} \gt 0$`)
    expect(node(g, 'PASS')).toContain('pass')
    expect(node(g, 'REV')).toContain(R`$\hat K + z\cdot\mathrm{se} \lt 0$`)
    expect(node(g, 'REV')).toContain('reversed')
    expect(node(g, 'INC')).toContain('inconclusive')
    expect(polarityVerdict(1, 0.1, 3)).toBe('pass')
    expect(polarityVerdict(-1, 0.1, 3)).toBe('reversed')
    expect(polarityVerdict(0.1, 0.1, 3)).toBe('inconclusive')
    // block 平均（索引 k）：圖上沒有 sample 速率的 [n]
    expect(D.CHART_FREEZE_MEASURE).not.toMatch(/\[n\]/)
  })

  it('證據強度：k_f = 0 走 rule of three（p_U = 1 − α^(1/n) ≈ −ln α/n），k_f ＞ 0 走 Clopper–Pearson；結論只對同分布的條件成立', async () => {
    const g = await flow(D.CHART_EVIDENCE)
    expect(edgeText(g, 'CNT', 'P0')).toBe(R`$k_f = 0$`)
    expect(edgeText(g, 'CNT', 'CP')).toBe(R`$k_f \gt 0$`)
    expect(hasEdge(g, 'P0', 'CLAIM') && hasEdge(g, 'CP', 'CLAIM')).toBe(true)
    expect(hasEdge(g, 'CLAIM', 'NOT')).toBe(true)
    expect(node(g, 'P0')).toContain(R`$p_U = 1 - \alpha^{1/n} \approx -\ln\alpha / n$`)
    expect(node(g, 'CP')).toContain(R`$P(X \le k_f \mid n, p) \ge \alpha$`)
    expect(node(g, 'CLAIM')).toContain('與 sweep 同分布')
    expect(node(g, 'CLAIM')).toContain(R`失效機率 $\le p_U$`)
    // 數值：n = 100、α = 0.05 ⇒ 1 − 0.05^(1/100) = 0.02951…，≈ 3/n = 0.03（rule of three）
    expect(failureUpperBound(0, 100)).toBeCloseTo(1 - 0.05 ** (1 / 100), 12)
    expect(failureUpperBound(0, 100)).toBeCloseTo(-Math.log(0.05) / 100, 3)
    // 有失效時上界比沒有失效時大
    expect(failureUpperBound(2, 100)).toBeGreaterThan(failureUpperBound(0, 100))
  })

  it('Corner 判準：五項判準對應 cornerJudge 的 ok 欄位；穩定（ρ ＜ 1）是收斂與雜訊的前提；全部都過才可行', async () => {
    const g = await flow(D.CHART_CORNER_JUDGE)
    for (const [a, b] of [['MU', 'G'], ['CS', 'G'], ['G', 'P'], ['G', 'ST'], ['G', 'PM'], ['ST', 'SET'], ['ST', 'NS'], ['P', 'ALL'], ['ST', 'ALL'], ['PM', 'ALL'], ['SET', 'ALL'], ['NS', 'ALL']]) {
      expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    }
    expect(edgeText(g, 'ST', 'SET')).toContain(R`$\rho \lt 1$`)
    expect(node(g, 'G')).toContain(R`$K_c = K_q(\sigma_{v,c})\cdot\cos\theta_c$`)
    expect(node(g, 'G')).toContain(R`$g_c = \mu\cdot K_c$`)
    expect(node(g, 'ST')).toContain(R`$z^{d+1} - z^d + g_c = 0$`)
    expect(node(g, 'PM')).toContain(R`$\mathrm{PM}_d(g_c) \ge \mathrm{PM}_t$`)
    expect(node(g, 'SET')).toContain(R`$k_{95} \le B$`)
    expect(node(g, 'NS')).toContain(R`$\sigma_{w,c} = \mu\cdot\sigma_\eta\cdot\sqrt{\sum h^2} \le \sigma_{w,\max}$`)
    // 五項判準的編號（圈圈數字）依序 ①–⑤
    CIRC.slice(0, 5).forEach((mark, i) => expect(node(g, ['P', 'ST', 'PM', 'SET', 'NS'][i]), mark).toContain(mark))
    // cornerJudge 的判準恰好是這五項；g 超過臨界值時 k₉₅ 與 σ_w 都是 ∞（所以圖上它們排在「穩定」之後）
    const o = { d: 1, pmTargetDeg: 30, B: 100, N: 4096, sigmaWMax: 5 }
    const K = kq(100)
    const good = cornerJudge([{ name: 'ok', sigmaV: 100, thetaDeg: 0 }], { ...o, mu: 0.5 / K })[0]
    expect(Object.keys(good.ok).sort()).toEqual(['noise', 'pm', 'polarity', 'settle', 'stable'])
    expect(good.g).toBeCloseTo(0.5, 12)
    expect(good.g).toBeLessThan(gCrit(1))
    expect(Object.values(good.ok).every(Boolean)).toBe(true)
    const bad = cornerJudge([{ name: 'fast', sigmaV: 100, thetaDeg: 0 }], { ...o, mu: 1.2 / K })[0]
    expect(bad.g).toBeGreaterThan(gCrit(1))
    expect(bad.ok.stable).toBe(false)
    expect(bad.settle95).toBe(Infinity)
    expect(bad.sigmaW).toBe(Infinity)
    // 極性：C ＜ 0（θ = 120°）時 K ＜ 0
    expect(cornerJudge([{ name: 'rev', sigmaV: 100, thetaDeg: 120 }], { ...o, mu: 0.5 / K })[0].ok.polarity).toBe(false)
  })

  it('多參數：δw_(k+1) = δw_k + M·J·δw_k = (I + M·J)·δw_k（直通與修正量都是＋）；只看對角會漏掉交叉項', async () => {
    const g = await flow(D.CHART_MIMO_LOOP)
    const sums = g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')
    expect(sums.map((s) => s.id)).toEqual(['S'])
    expect(edgeText(g, 'X', 'S')).toBe('＋')
    expect(edgeText(g, 'MM', 'S')).toMatch(/^＋/)
    expect(edgeText(g, 'MM', 'S')).toContain(R`$\mathbf M\cdot\mathbf J\cdot\delta\mathbf w_k$`)
    expect(hasEdge(g, 'X', 'J')).toBe(true)
    expect(edgeText(g, 'J', 'MM')).toBe(R`$E[\mathbf G_k]$`)
    expect(edgeText(g, 'S', 'DLY')).toBe(R`$\delta\mathbf w_{k+1} = (\mathbf I + \mathbf M\cdot\mathbf J)\cdot\delta\mathbf w_k$`)
    expect(hasEdge(g, 'DLY', 'X')).toBe(true)
    expect(node(g, 'J')).toContain(R`$E[\mathbf G_k] \approx \mathbf J\cdot\delta\mathbf w_k$`)
    expect(node(g, 'MM')).toContain(R`$\mathbf w_{k+1} = \mathbf w_k + \mathbf M\cdot\mathbf G_k$`)
    expect(node(g, 'X')).toContain(R`$\delta\mathbf w_k = \mathbf w_k - \mathbf w^*$`)
    expect(node(g, 'DLY')).toContain(R`$z^{-1}$`)
    expect(node(g, 'DIAG')).toContain(R`$1 + M_{ii}\cdot J_{ii}$`)
    expect(node(g, 'RHO')).toContain(R`$\rho(\mathbf I + \mathbf M\cdot\mathbf J) \lt 1$`)
    // 數值（T18）：J = [[−1, 2],[2, −1]]、M = 0.2·I：對角 pole 0.8（各自穩定），但 ρ(I + M·J) = 1.2（一起更新發散）
    const r = mimoJudge(
      [[-1, 2], [2, -1]],
      [[0.2, 0], [0, 0.2]],
    )
    expect(r.diagPoles[0]).toBeCloseTo(0.8, 12)
    expect(r.diagPoles[1]).toBeCloseTo(0.8, 12)
    expect(r.rho).toBeCloseTo(1.2, 10)
    // I + M·J 的元素：圖上的 δw_(k+1) = δw_k + M·J·δw_k
    expect(r.A[0][0]).toBeCloseTo(0.8, 12)
    expect(r.A[0][1]).toBeCloseTo(0.4, 12)
    // block rate：圖上沒有 sample 速率的 [n]
    expect(D.CHART_MIMO_LOOP).not.toMatch(/\[n\]/)
  })

  it('輸出路徑：δw_k（block）→ ZOH → δw[n] → × x[n] → δt[n]（補償誤差）→ T（不是 H_PD；殘差在 PD 的 reference 輸入注入）→ φ_out = −2π f_out·T·δt → spur／jitter', async () => {
    const g = await flow(D.CHART_OUTPUT_PATH)
    const chain: [string, string][] = [['W', 'ZOH'], ['ZOH', 'MUL'], ['X', 'MUL'], ['MUL', 'T'], ['T', 'PH'], ['PH', 'BETA'], ['BETA', 'SPUR'], ['PH', 'JIT']]
    for (const [a, b] of chain) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(g.vertices.find((v) => v.id === 'MUL')?.type).toBe('circle')
    expect(edgeText(g, 'ZOH', 'MUL')).toBe(R`$\delta w[n]$`)
    expect(edgeText(g, 'MUL', 'T')).toBe(R`補償誤差 $\delta t[n] = x[n]\cdot\delta w[n]$`)
    expect(edgeText(g, 'T', 'PH')).toBe(R`$T\cdot\delta t$`)
    expect(edgeText(g, 'PH', 'BETA')).toBe(R`$\varphi_{\mathrm{out}}$`)
    expect(edgeText(g, 'PH', 'JIT')).toBe(R`$\varphi_{\mathrm{out}}$`)
    expect(node(g, 'W')).toContain(R`block 速率，索引 $k$`)
    expect(node(g, 'ZOH')).toContain(R`$\delta w[n] = \delta w_{\lfloor (n - n_c)/N\rfloor}$`)
    expect(node(g, 'T')).toContain(R`$T = \frac{L}{1+L}$`)
    // 架構（docs/assumptions.md §2a）：DTC 殘差在 PD 的 reference 輸入注入，θ_out = +T·φ_dtc（正號）；負號只來自「殘差 = −δt」
    expect(node(g, 'T')).toContain('reference 輸入注入')
    expect(node(g, 'T')).toContain(R`$\theta_{\mathrm{out}} = +T\cdot\phi_{\mathrm{dtc}}$`)
    expect(node(g, 'PH')).toContain(R`殘差為 $-\delta t$`)
    expect(D.CHART_OUTPUT_PATH).not.toMatch(/feedback|回授/)
    expect(node(g, 'PH')).toContain(R`$\varphi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\cdot T\cdot\delta t$`)
    expect(node(g, 'BETA')).toContain(R`$\beta = 2\pi f_{\mathrm{out}}\cdot A_t\cdot\lvert T(f_m)\rvert$`)
    expect(node(g, 'SPUR')).toContain(R`$\approx 20\log_{10}(J_1(\beta)/J_0(\beta))$`)
    expect(node(g, 'SPUR')).toContain(R`$\approx 20\log_{10}(\beta/2)$`)
    // 輸出路徑用 T，不是 H_PD：H_PD 只在「不是 H_PD」這個提醒裡出現一次
    expect(D.CHART_OUTPUT_PATH.match(/H_\{\\mathrm\{PD\}\}/g)).toHaveLength(1)
    expect(node(g, 'T')).toContain(R`不是 $H_{\mathrm{PD}}$`)
    // 數值：T13 的例子（f_out = 13 GHz、A_t = 0.5 fs）用 20·log10(β/2) 與 Bessel 精確值 J₁/J₀ 一致（小角近似）
    const beta = 2 * Math.PI * 13e9 * 0.5e-15
    const bessel = (n: number, x: number) => {
      // 級數：J_n(x) = Σ (−1)^m / (m!(m+n)!) (x/2)^(2m+n)
      let s = 0
      let fm = 1
      for (let m = 0; m < 12; m++) {
        if (m > 0) fm *= m
        let fn = 1
        for (let i = 2; i <= m + n; i++) fn *= i
        s += (((-1) ** m) / (fm * fn)) * (x / 2) ** (2 * m + n)
      }
      return s
    }
    const exact = 20 * Math.log10(bessel(1, beta) / bessel(0, beta))
    expect(spurDbc(13e9, 0.5)).toBeCloseTo(20 * Math.log10(beta / 2), 10)
    expect(Math.abs(exact - spurDbc(13e9, 0.5))).toBeLessThan(1e-3)
  })

  it('反面測試：公式與獨立 Monte Carlo 兩條路徑交叉比對；漏掉平方的 √(1 − p) 版本的 σ_w 比正確版本大 √(1 + p) 倍', async () => {
    const g = await flow(D.CHART_NEGATIVE_CHECKS)
    for (const [a, b] of [['INJ', 'SIM'], ['SIM', 'SIG'], ['SIG', 'WARN'], ['FORM', 'CMP'], ['TD', 'CMP']]) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(g.vertices.find((v) => v.id === 'CMP')?.type).toBe('diamond')
    expect(edgeText(g, 'CMP', 'OK')).toBe('是')
    expect(edgeText(g, 'CMP', 'BAD')).toBe('否')
    expect(node(g, 'FORM')).toContain(R`$\sigma_w = \mu\sigma_\eta/\sqrt{1 - p^2}$`)
    expect(node(g, 'BAD')).toContain(R`$\sqrt{1 - p}$`)
    // 上下兩排互不相連：特徵檢查與交叉比對是兩道獨立的防線
    expect(g.edges.some((e) => ['INJ', 'SIM', 'SIG', 'WARN'].includes(e.start) && ['FORM', 'TD', 'CMP', 'OK', 'BAD'].includes(e.end))).toBe(false)
    const sig = negativeSignatures()
    const p = 1 - 10 * kq(100)
    expect(sig.sigmaWWrong / sig.sigmaWRight).toBeCloseTo(Math.sqrt(1 + p), 8)
  })
})
