/** @vitest-environment jsdom */
import mermaid from 'mermaid'
import { installMermaidSvgShim, renderMermaidForTest } from '@/components/mermaidTestUtils'
import * as D from './diagrams'
import { SIGNOFF_CHARTS } from './diagrams'
import { centralDifference, cornerJudge, failureUpperBound, gCrit, kq, mimoJudge, negativeSignatures, polarityVerdict, slopeStdErr, spurDbc } from './judges'
import { PILLARS } from './sections/S0Intro'

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

  it('每一張都能真的畫出來：沒有「Unsupported markdown」、節點不超過 14 個、標籤沒有會被 Markdown／HTML 吃掉的寫法、加法點的每條輸入都標了正負號', async () => {
    for (const c of SIGNOFF_CHARTS) {
      const parsed = await mermaid.parse(c.chart, { suppressErrors: false })
      expect(parsed && typeof parsed === 'object' ? parsed.diagramType : parsed, c.name).toBe('flowchart-v2')
      const { svg, text, nodeCount } = await renderMermaidForTest(c.chart)
      expect(text, c.name).not.toMatch(/Unsupported markdown/)
      expect(nodeCount, `${c.name} 節點數`).toBeLessThanOrEqual(14)
      expect(nodeCount, `${c.name} 節點數`).toBeGreaterThanOrEqual(7)
      const g = await flow(c.chart)
      expect(g.vertices.length, `${c.name} 節點數（parser）`).toBe(nodeCount)
      for (const v of g.vertices) expect(labelHazard(v.text ?? ''), `${c.name} 節點 ${v.id}`).toBeNull()
      for (const e of g.edges) expect(labelHazard(e.text ?? ''), `${c.name} 邊 ${e.start}→${e.end}`).toBeNull()
      // 畫面上的每個標籤都和原始碼相同
      const host = document.createElement('div')
      host.innerHTML = svg
      const shown = new Set(Array.from(host.querySelectorAll('.nodeLabel, .edgeLabel')).map((e) => plain(e.textContent ?? '')))
      for (const v of g.vertices) expect(shown.has(plain(v.text ?? '')), `${c.name} 節點 ${v.id}：「${v.text}」沒有原樣出現在圖上`).toBe(true)
      for (const e of g.edges) if (e.text) expect(shown.has(plain(e.text)), `${c.name} 邊 ${e.start}→${e.end}：「${e.text}」沒有原樣出現在圖上`).toBe(true)
      // 加法點 = 圓形節點、文字是全形「＋」；每條進來的邊都要以「＋」或「−」開頭
      for (const s of g.vertices.filter((v) => v.type === 'circle' && v.text === '＋')) {
        const incoming = g.edges.filter((e) => e.end === s.id)
        expect(incoming.length, `${c.name} 加法點 ${s.id}`).toBeGreaterThanOrEqual(2)
        for (const e of incoming) expect(e.text ?? '', `${c.name}：${e.start} → ${s.id} 要標正負號`).toMatch(/^[＋−]/)
      }
      // 沒有裸的 ASCII 「<」（只允許 <br/>）與分號
      expect(c.chart.replace(/<br\/>/g, ''), c.name).not.toMatch(/[<;]/)
    }
  }, 120_000)

  it('六道關卡：順序與頁面「六個條件」表（PILLARS）一致；每一格「是」往下走、「否」都到不可 sign-off；只有第六格通過才到 OK', async () => {
    expect(PILLARS.map((p) => p.name)).toEqual(['Identifiability', 'Polarity', 'Stability', 'Variance', 'Bias', 'System-level'])
    const g = await flow(D.CHART_SIGNOFF_FLOW)
    const q = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
    q.forEach((id, i) => {
      expect(g.vertices.find((v) => v.id === id)?.type, id).toBe('diamond')
      expect(node(g, id), id).toContain(`${['①', '②', '③', '④', '⑤', '⑥'][i]} ${PILLARS[i].name}`)
      const next = i < 5 ? q[i + 1] : 'OK'
      expect(edgeText(g, id, next), `${id} → ${next}`).toBe('是')
      expect(edgeText(g, id, 'BAD'), `${id} → BAD`).toBe('否')
    })
    // OK 只能從第六格來；起點只接到第一格
    expect(g.edges.filter((e) => e.end === 'OK').map((e) => e.start)).toEqual(['Q6'])
    expect(g.edges.filter((e) => e.start === 'START').map((e) => e.end)).toEqual(['Q1'])
    // 判準與頁面公式一致（F-SO.12、F-SO.1、F-SO.5、F-SO.7）
    expect(node(g, 'Q1')).toContain('σ_min(Ĵ) ＞ z·‖se‖_F')
    expect(node(g, 'Q2')).toContain('K̂ − z·se ＞ 0')
    expect(node(g, 'Q3')).toContain('g ＜ g_crit(d)')
    expect(node(g, 'Q3')).toContain('ρ(I + M·J) ＜ 1')
    expect(node(g, 'Q6')).toContain('T')
    expect(D.CHART_SIGNOFF_FLOW).toMatch(/class OK ok/)
    expect(D.CHART_SIGNOFF_FLOW).toMatch(/class BAD warn/)
  })

  it('freeze ±Δ：Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ)（加法點 ＋Ḡ₊、−Ḡ₋）、K̂ = −Ŝ、se = σ_η/(Δ√(2M))，三分法判決和 polarityVerdict 一致', async () => {
    const g = await flow(D.CHART_FREEZE_MEASURE)
    expect(edgeText(g, 'UP', 'D')).toBe('＋（Ḡ₊）')
    expect(edgeText(g, 'DN', 'D')).toBe('−（Ḡ₋）')
    expect(hasEdge(g, 'FZ', 'UP') && hasEdge(g, 'FZ', 'DN')).toBe(true)
    expect(node(g, 'UP')).toContain('w = w₀ + Δ')
    expect(node(g, 'DN')).toContain('w = w₀ − Δ')
    expect(node(g, 'DIV')).toContain('Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ)')
    expect(node(g, 'NEG')).toContain('K̂ = −Ŝ')
    expect(edgeText(g, 'D', 'DIV')).toBe('')
    expect(edgeText(g, 'DIV', 'NEG')).toBe('Ŝ')
    expect(edgeText(g, 'NEG', 'V')).toBe('K̂')
    expect(node(g, 'SE')).toContain('se(Ŝ) = σ_η/(Δ√(2M))')
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
    expect(node(g, 'PASS')).toContain('K̂ − z·se ＞ 0')
    expect(node(g, 'PASS')).toContain('pass')
    expect(node(g, 'REV')).toContain('K̂ + z·se ＜ 0')
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
    expect(edgeText(g, 'CNT', 'P0')).toBe('k_f = 0')
    expect(edgeText(g, 'CNT', 'CP')).toBe('k_f ＞ 0')
    expect(hasEdge(g, 'P0', 'CLAIM') && hasEdge(g, 'CP', 'CLAIM')).toBe(true)
    expect(hasEdge(g, 'CLAIM', 'NOT')).toBe(true)
    expect(node(g, 'P0')).toContain('p_U = 1 − α^(1/n) ≈ −ln α / n')
    expect(node(g, 'CP')).toContain('P(X ≤ k_f | n, p) ≥ α')
    expect(node(g, 'CLAIM')).toContain('與 sweep 同分布')
    expect(node(g, 'CLAIM')).toContain('失效機率 ≤ p_U')
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
    expect(edgeText(g, 'ST', 'SET')).toContain('ρ ＜ 1')
    expect(node(g, 'G')).toContain('K_c = K_q(σ_v,c)·cos θ_c')
    expect(node(g, 'G')).toContain('g_c = μ·K_c')
    expect(node(g, 'ST')).toContain('z^(d+1) − z^d + g_c = 0')
    expect(node(g, 'PM')).toContain('PM_d(g_c) ≥ PM_t')
    expect(node(g, 'SET')).toContain('k₉₅ ≤ B')
    expect(node(g, 'NS')).toContain('σ_w,c = μ·σ_η·√(Σ h²) ≤ σ_w,max')
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
    expect(edgeText(g, 'MM', 'S')).toMatch(/^＋.*M·J·δw_k/)
    expect(hasEdge(g, 'X', 'J')).toBe(true)
    expect(edgeText(g, 'J', 'MM')).toBe('E[G_k]')
    expect(edgeText(g, 'S', 'DLY')).toBe('δw_(k+1) = (I + M·J)·δw_k')
    expect(hasEdge(g, 'DLY', 'X')).toBe(true)
    expect(node(g, 'J')).toContain('E[G_k] ≈ J·δw_k')
    expect(node(g, 'MM')).toContain('w_(k+1) = w_k + M·G_k')
    expect(node(g, 'X')).toContain('δw_k = w_k − w*')
    expect(node(g, 'DLY')).toContain('z⁻¹')
    expect(node(g, 'DIAG')).toContain('1 + M_ii·J_ii')
    expect(node(g, 'RHO')).toContain('ρ(I + M·J) ＜ 1')
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

  it('輸出路徑：δw_k（block）→ ZOH → δw[n] → × x[n] → δt[n] → T（不是 H_PD）→ φ_out = −2π f_out·T·δt → spur／jitter', async () => {
    const g = await flow(D.CHART_OUTPUT_PATH)
    const chain: [string, string][] = [['W', 'ZOH'], ['ZOH', 'MUL'], ['X', 'MUL'], ['MUL', 'T'], ['T', 'PH'], ['PH', 'BETA'], ['BETA', 'SPUR'], ['PH', 'JIT']]
    for (const [a, b] of chain) expect(hasEdge(g, a, b), `${a} → ${b}`).toBe(true)
    expect(g.vertices.find((v) => v.id === 'MUL')?.type).toBe('circle')
    expect(edgeText(g, 'ZOH', 'MUL')).toBe('δw[n]')
    expect(edgeText(g, 'MUL', 'T')).toBe('δt[n] = x[n]·δw[n]')
    expect(edgeText(g, 'T', 'PH')).toBe('T·δt')
    expect(node(g, 'W')).toContain('block 速率，索引 k')
    expect(node(g, 'ZOH')).toContain('δw[n] = δw_⌊(n − n_c)/N⌋')
    expect(node(g, 'T')).toContain('T = L/(1+L)')
    expect(node(g, 'PH')).toContain('φ_out = −2π f_out·T·δt')
    expect(node(g, 'BETA')).toContain('β = 2π f_out·A_t·|T(f_m)|')
    expect(node(g, 'SPUR')).toContain('20 log₁₀(J₁(β)/J₀(β))')
    expect(node(g, 'SPUR')).toContain('20 log₁₀(β/2)')
    // 輸出路徑用 T，不是 H_PD：H_PD 只在「不是 H_PD」這個提醒裡出現一次
    expect(D.CHART_OUTPUT_PATH.match(/H_PD/g)).toHaveLength(1)
    expect(node(g, 'T')).toContain('不是 H_PD')
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
    expect(node(g, 'FORM')).toContain('σ_w = μσ_η/√(1 − p²)')
    expect(node(g, 'BAD')).toContain('√(1 − p)')
    // 上下兩排互不相連：特徵檢查與交叉比對是兩道獨立的防線
    expect(g.edges.some((e) => ['INJ', 'SIM', 'SIG', 'WARN'].includes(e.start) && ['FORM', 'TD', 'CMP', 'OK', 'BAD'].includes(e.end))).toBe(false)
    const sig = negativeSignatures()
    const p = 1 - 10 * kq(100)
    expect(sig.sigmaWWrong / sig.sigmaWRight).toBeCloseTo(Math.sqrt(1 + p), 8)
  })
})
