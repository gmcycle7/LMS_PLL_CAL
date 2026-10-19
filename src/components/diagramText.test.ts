// @vitest-environment jsdom
import * as ch05 from '@/chapters/ch05/diagrams'
import * as ch11b from '@/chapters/ch11b/diagrams'
import { cleanLabel, diagramToPlainText, edgeToText, endpointText, labelToSpeech, parseDiagramText, type DiagramText } from './diagramText'
import { installMermaidSvgShim, renderMermaidForTest } from './mermaidTestUtils'

const edgeKeys = (m: DiagramText) => m.edges.map((e) => `${e.from}>${e.to}`)
const label = (m: DiagramText, id: string) => m.nodes.find((n) => n.id === id)?.label

describe('labelToSpeech：標籤 → 可念的純文字', () => {
  it('<br/> 變空白、HTML 標籤與 Markdown 記號去掉、$$…$$ 與 $…$ 都經 accessibleText', () => {
    expect(cleanLabel('累加器<br/>$S_N = \\sum q_i$')).toBe('累加器 $S_N = \\sum q_i$')
    expect(cleanLabel('<b>粗體</b> `code` **強調**')).toBe('粗體 code 強調')
    expect(cleanLabel('$$\\text{DTC 拿到 } w_k$$')).toBe('$\\text{DTC 拿到 } w_k$')
    // 公式裡的 < 與 * 不當成 HTML／Markdown
    expect(cleanLabel('$a<b$ 與 $c * d$')).toBe('$a<b$ 與 $c * d$')
    const spoken = labelToSpeech('固定誤差 $s$（fs）')
    expect(spoken).toBe('固定誤差 s（fs）')
    expect(labelToSpeech('$$\\text{block }k\\text{ 開始}$$')).not.toMatch(/[$\\]/)
    expect(labelToSpeech('$\\sigma_v = 100$ fs')).toBe('sigma v 等於 100 fs')
  })
})

describe('parseDiagramText：flowchart 語法', () => {
  it('A --> B、A -- 文字 --> B、A -->|文字| B、A -->|"文字"| B', () => {
    const m = parseDiagramText(`flowchart LR
  A --> B
  B -- 是 --> C
  C -->|否| D
  D -->|"帶 $x$ 的"| E
  E -- "引號 --> 內" --> F`)
    expect(m.kind).toBe('flowchart')
    expect(m.direction).toBe('LR')
    expect(m.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(m.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['A', 'B', undefined],
      ['B', 'C', '是'],
      ['C', 'D', '否'],
      ['D', 'E', '帶 x 的'],
      ['E', 'F', '引號 --> 內'],
    ])
    expect(m.edges[3].raw).toBe('帶 $x$ 的')
  })

  it('節點形狀 [ ]、( )、{ }、[[ ]]、(( ))、([ ])、[( )]、{{ }}、[/ /]；引號、<br/>、$…$ 都在標籤裡', () => {
    const m = parseDiagramText(`graph TD
  A[矩形] --> B(圓角)
  B --> C{判斷 ?}
  C --> D[[子程序]]
  D --> E(("＋"))
  E --> F(["膠囊 $x[n]$"])
  F --> G[("資料庫")]
  G --> H{{"六角"}}
  H --> I[/"平行四邊形"/]
  I --> J["兩行<br/>標籤 $\\sigma_v$"]`)
    expect(m.direction).toBe('TB')
    expect(m.nodes.map((n) => [n.id, n.shape])).toEqual([
      ['A', 'rect'],
      ['B', 'round'],
      ['C', 'diamond'],
      ['D', 'subroutine'],
      ['E', 'circle'],
      ['F', 'stadium'],
      ['G', 'cylinder'],
      ['H', 'hexagon'],
      ['I', 'parallelogram'],
      ['J', 'rect'],
    ])
    expect(m.nodes.map((n) => n.label)).toEqual(['矩形', '圓角', '判斷 ?', '子程序', '加法點（＋）', '膠囊 x[n]', '資料庫', '六角', '平行四邊形', '兩行 標籤 sigma v'])
    expect(m.nodes[5].raw).toBe('膠囊 $x[n]$')
  })

  it('各種線型與箭頭：實線、虛線、粗線、無箭頭、雙向、--o／--x；隱形連線 ~~~ 不算連線', () => {
    const m = parseDiagramText(`flowchart TB
  A --> B
  A --- C
  A -.-> D
  A -. 虛線文字 .-> E
  A ==> F
  A == 粗線文字 ==> G
  A <--> H
  A --o I
  A --x J
  A ~~~ K
  A --- 無箭頭文字測試
  A -- 無箭頭帶字 --- L
  A ---> M`)
    const by = (to: string) => m.edges.find((e) => e.to === to)
    expect(by('B')).toMatchObject({ line: 'solid', arrow: 'forward' })
    expect(by('C')).toMatchObject({ line: 'solid', arrow: 'none' })
    expect(by('D')).toMatchObject({ line: 'dotted', arrow: 'forward' })
    expect(by('E')).toMatchObject({ line: 'dotted', arrow: 'forward', label: '虛線文字' })
    expect(by('F')).toMatchObject({ line: 'thick', arrow: 'forward' })
    expect(by('G')).toMatchObject({ line: 'thick', arrow: 'forward', label: '粗線文字' })
    expect(by('H')).toMatchObject({ arrow: 'both' })
    expect(by('I')).toMatchObject({ line: 'solid', arrow: 'forward' })
    expect(by('J')).toMatchObject({ line: 'solid', arrow: 'forward' })
    expect(by('K')).toBeUndefined()
    expect(m.nodes.map((n) => n.id)).toContain('K') // 隱形連線的端點還是節點
    expect(by('L')).toMatchObject({ arrow: 'none', label: '無箭頭帶字' })
    expect(by('M')).toMatchObject({ arrow: 'forward' })
  })

  it('鏈 A --> B --> C、A & B --> C & D、; 分隔、行尾 :::class、%% 註解與 classDef／class／style 不當成節點', () => {
    const m = parseDiagramText(`flowchart LR
  %% 這是註解
  A --> B --> C
  X & Y --> Z & W
  P --> Q; Q --> R["含;分號"]
  S:::focus --> T
  classDef focus fill:#1f5fa8
  class A,B focus
  style A fill:#fff
  linkStyle 0 stroke:#f00`)
    expect(edgeKeys(m)).toEqual(['A>B', 'B>C', 'X>Z', 'X>W', 'Y>Z', 'Y>W', 'P>Q', 'Q>R', 'S>T'])
    expect(label(m, 'R')).toBe('含;分號')
    expect(m.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'X', 'Y', 'Z', 'W', 'P', 'Q', 'R', 'S', 'T'])
  })

  it('subgraph：id["標題"]、巢狀、標題含公式；節點歸入第一次出現的群組；連到 subgraph 的線端點是群組', () => {
    const m = parseDiagramText(`flowchart TB
  E["入口"]
  subgraph G1["(1) gain 方向：$\\sum_k x$"]
    direction TB
    A1["甲"] --> A2["乙"]
    subgraph INNER["內層"]
      I1["丙"]
    end
  end
  subgraph 無id標題
    B1["丁"]
  end
  E --> G1
  G1 --> FIX["修法"]`)
    expect(m.groups.map((g) => [g.id, g.parent, g.nodes])).toEqual([
      ['G1', undefined, ['A1', 'A2']],
      ['INNER', 'G1', ['I1']],
      ['無id標題', undefined, ['B1']],
    ])
    expect(m.groups[0].label).toBe('(1) gain 方向：對 k 的總和 x')
    expect(m.groups[0].raw).toBe('(1) gain 方向：$\\sum_k x$')
    expect(m.nodes.map((n) => n.id)).toEqual(['E', 'A1', 'A2', 'I1', 'B1', 'FIX']) // G1 是群組，不是節點
    expect(m.nodes.find((n) => n.id === 'A1')?.group).toBe('G1')
    expect(edgeKeys(m)).toEqual(['A1>A2', 'E>G1', 'G1>FIX'])
    expect(edgeToText(m, m.edges[1])).toBe('入口 → 群組「(1) gain 方向：對 k 的總和 x」')
  })

  it('標籤相同的節點（兩個加法點）加上序號，連線清單才分得出誰是誰', () => {
    const m = parseDiagramText(`flowchart LR
  A["a"] --> S1(("+"))
  B["b"] --> S2(("+"))
  S1 --> S2`)
    expect(m.nodes.map((n) => n.label)).toEqual(['a', '加法點（＋） 1', 'b', '加法點（＋） 2'])
    expect(edgeToText(m, m.edges[2])).toBe('加法點（＋） 1 → 加法點（＋） 2')
  })

  it('沒有標籤的節點用 id；標籤晚一點才給也行；edgeToText 與 diagramToPlainText 的格式', () => {
    const m = parseDiagramText(`flowchart TB
  A --> B
  B["之後才給標籤"]
  B -- "$+ s$" --> C`)
    expect(label(m, 'A')).toBe('A')
    expect(label(m, 'B')).toBe('之後才給標籤')
    expect(edgeToText(m, m.edges[0])).toBe('A → 之後才給標籤')
    expect(edgeToText(m, m.edges[1])).toBe('之後才給標籤 → C（正 s）')
    expect(diagramToPlainText(m)).toBe('節點 A\n節點 之後才給標籤\n節點 C\n連線 A → 之後才給標籤\n連線 之後才給標籤 → C（正 s）')
  })
})

describe('parseDiagramText：stateDiagram、sequenceDiagram、其他', () => {
  it('stateDiagram-v2：state "…" as X、[*] 起點／終點、轉移文字、自環、composite state', () => {
    const m = parseDiagramText(`stateDiagram-v2
  direction LR
  state "平台：$c_2 = c_{2,0}$" as PLATEAU
  state "歸零" as ZERO
  [*] --> PLATEAU
  PLATEAU --> PLATEAU : $$\\text{沒有 flip，機率 }0.995$$
  PLATEAU --> ZERO : 出現第一個 flip
  ZERO --> [*]
  state OUTER {
    X --> Y
  }
  Y : 補充說明`)
    expect(m.kind).toBe('state')
    expect(m.direction).toBe('LR')
    expect(m.nodes.map((n) => [n.id, n.label])).toEqual([
      ['PLATEAU', labelToSpeech('平台：$c_2 = c_{2,0}$')],
      ['ZERO', '歸零'],
      ['[*]start', '起點'],
      ['[*]end', '終點'],
      ['X', 'X'],
      ['Y', '補充說明'],
    ])
    expect(m.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['[*]start', 'PLATEAU', undefined],
      ['PLATEAU', 'PLATEAU', labelToSpeech('$\\text{沒有 flip，機率 }0.995$')],
      ['PLATEAU', 'ZERO', '出現第一個 flip'],
      ['ZERO', '[*]end', undefined],
      ['X', 'Y', undefined],
    ])
    expect(m.groups.map((g) => [g.id, g.nodes])).toEqual([['OUTER', ['X', 'Y']]])
  })

  it('sequenceDiagram：participant … as …、訊息（實線／虛線）、Note over', () => {
    const m = parseDiagramText(`sequenceDiagram
  participant D as DTC<br/>（正在用的係數）
  participant R as 暫存器
  Note over D,R: $$\\text{block } k \\text{ 開始}$$
  R-->>D: $$\\text{DTC 拿到 } w_{k-1}$$
  D->>R: 更新
  loop 每個 sample
    R->>R: 自己更新
  end`)
    expect(m.kind).toBe('sequence')
    expect(m.nodes.map((n) => [n.id, n.label])).toEqual([
      ['D', 'DTC （正在用的係數）'],
      ['R', '暫存器'],
    ])
    expect(m.edges.map((e) => [e.from, e.to, e.line])).toEqual([
      ['R', 'D', 'dotted'],
      ['D', 'R', 'solid'],
      ['R', 'R', 'solid'],
    ])
    expect(m.notes).toEqual([{ over: ['D', 'R'], raw: '$\\text{block } k \\text{ 開始}$', label: expect.stringContaining('開始'), after: 0 }])
  })

  it('其他圖型（gantt、pie…）：parsed: false，只列出雙引號裡的字串；空字串與壞掉的語法不丟例外', () => {
    const m = parseDiagramText(`pie title 示意
  "甲" : 40
  "乙 $x$" : 60
  "甲" : 1`)
    expect(m.kind).toBe('other')
    expect(m.parsed).toBe(false)
    expect(m.nodes.map((n) => n.label)).toEqual(['甲', '乙 x'])
    expect(m.edges).toEqual([])
    expect(parseDiagramText('')).toMatchObject({ kind: 'other', parsed: false, nodes: [] })
    expect(parseDiagramText('flowchart TB\n  ---> -->').parsed).toBe(false)
    expect(() => parseDiagramText('flowchart LR\n  A["未結束 --> B\n  subgraph\n  end\n  end')).not.toThrow()
    expect(endpointText(parseDiagramText('flowchart LR\n A-->B'), 'zzz')).toBe('zzz')
  })
})

/* ---------- 真實的圖：ch05（28 張）與 ch11b（6 張） ---------- */

const charts = (mod: Record<string, unknown>): Array<[string, string]> =>
  Object.entries(mod).filter((e): e is [string, string] => typeof e[1] === 'string' && /^(flowchart|graph)\b/.test(e[1]))

describe('parseDiagramText：真實的圖當 fixture', () => {
  const fixtures: Array<[string, string]> = [...charts(ch05).map(([k, v]): [string, string] => [`ch05.${k}`, v]), ...charts(ch11b).map(([k, v]): [string, string] => [`ch11b.${k}`, v])]

  it('抓得到 ch05 的 28 張、ch11b 的 6 張 flowchart', () => {
    expect(fixtures.filter(([k]) => k.startsWith('ch05.'))).toHaveLength(28)
    expect(fixtures.filter(([k]) => k.startsWith('ch11b.'))).toHaveLength(6)
  })

  it('每張圖：解析成功、連線的端點都存在、標籤沒有殘留的 $、反斜線或 <br>', () => {
    for (const [name, chart] of fixtures) {
      const m = parseDiagramText(chart)
      expect(m.parsed, name).toBe(true)
      expect(m.nodes.length, name).toBeGreaterThanOrEqual(2)
      const ids = new Set([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)])
      for (const e of m.edges) {
        expect(ids.has(e.from), `${name}: ${e.from}`).toBe(true)
        expect(ids.has(e.to), `${name}: ${e.to}`).toBe(true)
      }
      for (const text of [...m.nodes.map((n) => n.label), ...m.edges.map((e) => e.label ?? ''), ...m.groups.map((g) => g.label)]) {
        expect(text, name).not.toMatch(/[$\\]|<br|&#/)
        expect(text.trim(), name).toBe(text)
      }
      // 節點的標籤彼此不同（連線清單才分得出誰是誰）
      expect(new Set(m.nodes.map((n) => n.label)).size, name).toBe(m.nodes.length)
    }
  })

  it('節點數、連線數、群組數和真正的 Mermaid 渲染結果一致（g.node、path.flowchart-link、g.cluster）', async () => {
    installMermaidSvgShim()
    for (const [name, chart] of fixtures) {
      const { svg, nodeCount } = await renderMermaidForTest(chart)
      const host = document.createElement('div')
      host.innerHTML = svg
      const m = parseDiagramText(chart)
      expect(m.nodes.length, `${name} 節點`).toBe(nodeCount)
      expect(m.edges.length, `${name} 連線`).toBe(host.querySelectorAll('path.flowchart-link').length)
      expect(m.groups.length, `${name} 群組`).toBe(host.querySelectorAll('g.cluster').length)
    }
  }, 120_000)

  it('CHART_L1_MODEL：節點與連線的文字（加法點、公式標籤都轉成可念的文字）', () => {
    const m = parseDiagramText(ch05.CHART_L1_MODEL)
    expect(m.direction).toBe('LR')
    expect(m.nodes.map((n) => n.label)).toEqual(['固定誤差 s（fs）', '加法點（＋）', '雜訊 v 約為 N(0, sigma v 平方)', 'Comparator threshold theta', '累加器 S N 等於 總和 q i', '方向判斷'])
    expect(m.edges.map((e) => edgeToText(m, e))).toEqual([
      '固定誤差 s（fs） → 加法點（＋）（正 s）',
      '雜訊 v 約為 N(0, sigma v 平方) → 加法點（＋）（正 v）',
      '加法點（＋） → Comparator threshold theta（e 等於 s 加 v）',
      'Comparator threshold theta → 累加器 S N 等於 總和 q i（q 等於 正負 1）',
      '累加器 S N 等於 總和 q i → 方向判斷（sign(S N) S N 等於 0 時依 tie rule）',
    ])
  })

  it('ch11b CHART_GAUGE：三個 subgraph 各有 2 個節點，E → G1／G2／G3 的端點是群組', () => {
    const m = parseDiagramText(ch11b.CHART_GAUGE)
    expect(m.groups.map((g) => [g.id, g.nodes])).toEqual([
      ['G1', ['A1', 'A2']],
      ['G2', ['B1', 'B2']],
      ['G3', ['C1', 'C2']],
    ])
    expect(m.nodes.map((n) => n.id)).toEqual(['E', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'FIX'])
    expect(edgeKeys(m)).toEqual(['A1>A2', 'B1>B2', 'C1>C2', 'E>G1', 'E>G2', 'E>G3', 'G1>FIX', 'G2>FIX', 'G3>FIX'])
    expect(edgeToText(m, m.edges[3])).toMatch(/^comparator 只看得到 .* → 群組「\(1\) gain 方向/)
  })

  it('全站其他章節的圖（含 stateDiagram、sequenceDiagram）也不丟例外，端點都存在', () => {
    const all = import.meta.glob<Record<string, unknown>>(['/src/chapters/*/diagrams.ts', '/src/pages/*/diagrams.ts'], { eager: true })
    let count = 0
    let seq = 0
    let state = 0
    for (const [file, mod] of Object.entries(all)) {
      for (const [k, v] of Object.entries(mod)) {
        if (typeof v !== 'string' || !/^(flowchart|graph|stateDiagram|sequenceDiagram)/.test(v)) continue
        const m = parseDiagramText(v)
        count++
        if (m.kind === 'sequence') seq++
        if (m.kind === 'state') state++
        expect(m.parsed, `${file}#${k}`).toBe(true)
        const ids = new Set([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)])
        for (const e of m.edges) {
          expect(ids.has(e.from) && ids.has(e.to), `${file}#${k}: ${e.from}>${e.to}`).toBe(true)
        }
      }
    }
    expect(count).toBeGreaterThan(200)
    expect(seq).toBeGreaterThan(3)
    expect(state).toBeGreaterThan(5)
  })
})
