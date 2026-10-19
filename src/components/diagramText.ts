import { accessibleText } from './speech'

/**
 * 方塊圖的「文字版」：把 Mermaid 原始碼解析成可念的結構（節點、連線、群組），給 DiagramFrame 的「文字版」details 與螢幕閱讀器用。
 *
 * 只做結構，不做排版：
 *   - flowchart／graph：節點（A、A[…]、A(…)、A{…}、A[[…]]、A((…))、A([…])、A[(…)]、A{{…}}、A[/…/]…）、
 *     連線（-->、---、-.->、==>、<-->、--o、--x；`-- 文字 -->`、`-->|文字|`；`A & B --> C & D`；鏈 `A --> B --> C`）、
 *     `subgraph … end`（可巢狀）、`;` 分隔的多個敘述。`~~~`（隱形連線，只用來固定排版）不算連線。
 *   - stateDiagram-v2：`state "…" as X`、`X --> Y : 文字`、`[*]`、`state X { … }`（群組）。
 *   - sequenceDiagram：participant／actor（含 as 別名）與訊息（`A->>B: 文字`），訊息依出現順序成為連線。
 *   - 其他圖型（gantt、pie…）：解析不到結構，`parsed: false`，只列出雙引號裡的字串當作「偵測到的節點名稱」。
 *
 * 標籤：`label` 是給螢幕閱讀器的純文字（`$…$` 經 accessibleText 轉成可念的文字）；`raw` 保留 `$…$`，畫面上用 mathText 排成 KaTeX。
 * 純函式，沒有 DOM；SystemMap 用自己的 model 產生同樣的結構（systemMapText）。
 */

export type DiagramKind = 'flowchart' | 'state' | 'sequence' | 'other'

export interface DiagramNode {
  id: string
  /** 可念的純文字 */
  label: string
  /** 保留 `$…$` 的標籤（畫面用 mathText 排版） */
  raw: string
  /** 所屬群組（subgraph／composite state）的 id；沒有群組時省略 */
  group?: string
  /** 形狀（flowchart）：round、stadium、circle、diamond、subroutine、cylinder、hexagon、parallelogram、rect */
  shape?: string
  /** 本章主角（系統地圖的藍色方塊） */
  focus?: boolean
}

export interface DiagramEdge {
  /** 起點、終點的節點 id */
  from: string
  to: string
  /** 連線標籤（可念的純文字）與保留 `$…$` 的版本 */
  label?: string
  raw?: string
  /** 線型：solid 實線、dotted 虛線、thick 粗線 */
  line: 'solid' | 'dotted' | 'thick'
  /** forward：from → to；none：沒有箭頭；both：雙向 */
  arrow: 'forward' | 'none' | 'both'
}

export interface DiagramGroup {
  id: string
  label: string
  raw: string
  /** 直接屬於這個群組的節點 id（不含子群組裡的） */
  nodes: string[]
  /** 上一層群組的 id */
  parent?: string
}

/** sequenceDiagram 的 `Note over A,B: …` */
export interface DiagramNote {
  /** 註記跨過的參與者 id */
  over: string[]
  label: string
  raw: string
  /** 出現在第幾則訊息之後（0 = 第一則訊息之前） */
  after: number
}

export interface DiagramText {
  kind: DiagramKind
  /** false：只偵測到名稱，沒有可靠的結構（見檔頭） */
  parsed: boolean
  /** 排列方向（flowchart／state）：LR、RL、TB、BT */
  direction?: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  groups: DiagramGroup[]
  /** 時序圖的註記（其他圖型沒有） */
  notes?: DiagramNote[]
}

/* ---------- 標籤 → 文字 ---------- */

const MATH_SEGMENT = /\$\$((?:[^$\\]|\\.)+?)\$\$|(?<!\\)\$((?:[^$\\]|\\.)+?)(?<!\\)\$/g

/** 只處理 `$…$` 以外的文字（公式裡的 `<`、`*` 不能被當成 HTML 或 Markdown） */
function mapOutsideMath(text: string, fn: (plain: string) => string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(MATH_SEGMENT)) {
    const start = m.index ?? 0
    out += fn(text.slice(last, start))
    // `$$…$$`（Mermaid 的寫法）與 `$…$` 統一成 `$…$`
    out += `$${m[1] ?? m[2]}$`
    last = start + m[0].length
  }
  return out + fn(text.slice(last))
}

/**
 * Mermaid 標籤 → 保留 `$…$` 的單行文字：`<br/>` 變空白、其他 HTML 標籤與 Markdown 記號去掉、
 * `#quot;` 之類的實體還原、`$$…$$` 統一成 `$…$`。
 */
export function cleanLabel(label: string): string {
  const text = mapOutsideMath(label.replace(/<br\s*\/?>/gi, ' '), (plain) =>
    plain
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/`/g, '')
      .replace(/\*\*|__/g, '')
      .replace(/#quot;|&quot;/g, '"')
      .replace(/#35;/g, '#')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' '),
  )
  return text.replace(/\s+/g, ' ').trim()
}

/** 標籤 → 可念的純文字（`$…$` 經 accessibleText） */
export function labelToSpeech(label: string): string {
  return accessibleText(cleanLabel(label)).replace(/\s+/g, ' ').trim()
}

/** 加法點之類只有一個符號的圓形節點：念「加法點」比念「加號」有用 */
function nodeLabel(raw: string, shape: string | undefined): { raw: string; label: string } {
  const clean = cleanLabel(raw)
  if (shape === 'circle' && /^[＋+−-]$/.test(clean)) {
    const sign = clean === '+' ? '＋' : clean === '-' ? '−' : clean
    return { raw: `加法點（${sign}）`, label: `加法點（${sign}）` }
  }
  return { raw: clean, label: accessibleText(clean).replace(/\s+/g, ' ').trim() }
}

/* ---------- 共用的建構器 ---------- */

class Builder {
  nodes = new Map<string, DiagramNode>()
  edges: DiagramEdge[] = []
  groups: DiagramGroup[] = []
  private stack: DiagramGroup[] = []
  private explicit = new Set<string>()

  /** 登記（或補上標籤的）節點；在群組裡第一次出現時歸入該群組 */
  touch(id: string, rawLabel?: string, shape?: string): DiagramNode {
    let node = this.nodes.get(id)
    if (!node) {
      node = { id, label: labelToSpeech(id), raw: id }
      this.nodes.set(id, node)
    }
    if (rawLabel !== undefined && !this.explicit.has(id)) {
      this.explicit.add(id)
      const l = nodeLabel(rawLabel, shape)
      if (l.raw !== '') {
        node.raw = l.raw
        node.label = l.label
      }
      if (shape) node.shape = shape
    }
    const g = this.stack[this.stack.length - 1]
    if (g && node.group === undefined) {
      node.group = g.id
      g.nodes.push(id)
    }
    return node
  }

  push(id: string, rawLabel: string): DiagramGroup {
    const clean = cleanLabel(rawLabel)
    const parent = this.stack[this.stack.length - 1]
    const g: DiagramGroup = { id, label: accessibleText(clean).replace(/\s+/g, ' ').trim(), raw: clean, nodes: [], ...(parent ? { parent: parent.id } : {}) }
    this.groups.push(g)
    this.stack.push(g)
    return g
  }

  pop(): void {
    this.stack.pop()
  }

  edge(from: string, to: string, link: Partial<Pick<DiagramEdge, 'line' | 'arrow'>> & { label?: string }): void {
    const e: DiagramEdge = { from, to, line: link.line ?? 'solid', arrow: link.arrow ?? 'forward' }
    if (link.label !== undefined) {
      const raw = cleanLabel(link.label)
      if (raw !== '') {
        e.raw = raw
        e.label = accessibleText(raw).replace(/\s+/g, ' ').trim()
      }
    }
    this.edges.push(e)
  }

  result(kind: DiagramKind, direction?: string): DiagramText {
    // `E --> G1` 的 G1 若是 subgraph 的 id，它是群組不是節點（連線的端點保留這個 id，edgeToText 會當群組念）
    const groupIds = new Set(this.groups.map((g) => g.id))
    for (const id of groupIds) {
      if (!this.nodes.has(id)) continue
      this.nodes.delete(id)
      for (const g of this.groups) g.nodes = g.nodes.filter((n) => n !== id)
    }
    const nodes = [...this.nodes.values()]
    // 標籤相同的節點（例如兩個加法點）加上序號，連線清單才分得出誰是誰
    const seen = new Map<string, number>()
    for (const n of nodes) seen.set(n.label, (seen.get(n.label) ?? 0) + 1)
    const counter = new Map<string, number>()
    for (const n of nodes) {
      if ((seen.get(n.label) ?? 0) < 2) continue
      const k = (counter.get(n.label) ?? 0) + 1
      counter.set(n.label, k)
      n.label = `${n.label} ${k}`
      n.raw = `${n.raw} ${k}`
    }
    return { kind, parsed: nodes.length > 0, ...(direction ? { direction } : {}), nodes, edges: this.edges, groups: this.groups }
  }
}

/* ---------- 前處理 ---------- */

/** 去掉 front-matter、`%%` 註解與 `%%{init}%%`；回傳有內容的敘述（`;` 分隔的拆開，雙引號裡的 `;` 不算） */
function statements(source: string): string[] {
  let text = source.replace(/\r\n?/g, '\n')
  text = text.replace(/^\s*---\n[\s\S]*?\n---\n/, '')
  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%')) continue
    let cur = ''
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      if (ch === ';' && !quoted) {
        if (cur.trim() !== '') out.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    if (cur.trim() !== '') out.push(cur.trim())
  }
  return out
}

/* ---------- flowchart ---------- */

const SKIP_STATEMENT = /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|title|callback|href)\b/

/** 節點形狀的開頭、對應的結尾與形狀名稱（長的在前） */
const OPENERS: ReadonlyArray<{ open: string; close: readonly string[]; shape: string }> = [
  { open: '(((', close: [')))'], shape: 'circle' },
  { open: '((', close: ['))'], shape: 'circle' },
  { open: '([', close: ['])'], shape: 'stadium' },
  { open: '(', close: [')'], shape: 'round' },
  { open: '[[', close: [']]'], shape: 'subroutine' },
  { open: '[(', close: [')]'], shape: 'cylinder' },
  { open: '[/', close: ['/]', '\\]'], shape: 'parallelogram' },
  { open: '[\\', close: ['\\]', '/]'], shape: 'parallelogram' },
  { open: '[', close: [']'], shape: 'rect' },
  { open: '{{', close: ['}}'], shape: 'hexagon' },
  { open: '{', close: ['}'], shape: 'diamond' },
]

const ID_REST = /^[\p{L}\p{N}_]+/u

interface Link {
  line: 'solid' | 'dotted' | 'thick' | 'invisible'
  arrow: 'forward' | 'none' | 'both'
  label?: string
}

class FlowScanner {
  i = 0
  constructor(
    private s: string,
    private b: Builder,
  ) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }

  /** 一個節點：id、可選的形狀與標籤、可選的 `:::class` */
  private node(): string | null {
    this.ws()
    const m = ID_REST.exec(this.s.slice(this.i))
    if (!m) return null
    const id = m[0]
    this.i += id.length
    let label: string | undefined
    let shape: string | undefined
    const rest = this.s.slice(this.i)
    const op = OPENERS.find((o) => rest.startsWith(o.open))
    if (op) {
      let j = this.i + op.open.length
      while (j < this.s.length && /\s/.test(this.s[j])) j++
      let text: string
      let end = -1
      if (this.s[j] === '"') {
        const q = this.s.indexOf('"', j + 1)
        if (q >= 0) {
          text = this.s.slice(j + 1, q)
          j = q + 1
          while (j < this.s.length && /\s/.test(this.s[j])) j++
          const c = op.close.find((cl) => this.s.startsWith(cl, j))
          end = c !== undefined ? j + c.length : -1
        } else text = ''
      } else {
        text = ''
        let best = -1
        let bestLen = 0
        for (const cl of op.close) {
          const k = this.s.indexOf(cl, j)
          if (k >= 0 && (best < 0 || k < best)) {
            best = k
            bestLen = cl.length
          }
        }
        if (best >= 0) {
          text = this.s.slice(j, best)
          end = best + bestLen
        }
      }
      if (end >= 0) {
        label = text
        shape = op.shape
        this.i = end
      }
    } else if (rest.startsWith('@{')) {
      // 新語法 A@{ shape: …, label: "…" }
      const close = rest.indexOf('}')
      if (close >= 0) {
        const body = rest.slice(2, close)
        const lm = /label:\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/.exec(body)
        if (lm) label = (lm[1] ?? lm[2] ?? lm[3] ?? '').trim()
        const sm = /shape:\s*([\w-]+)/.exec(body)
        if (sm) shape = sm[1]
        this.i += close + 1
      }
    }
    const cls = /^:::[\w-]+/.exec(this.s.slice(this.i))
    if (cls) this.i += cls[0].length
    this.b.touch(id, label, shape)
    return id
  }

  /** `A & B & C` */
  private nodeGroup(): string[] | null {
    const first = this.node()
    if (first === null) return null
    const ids = [first]
    for (;;) {
      const save = this.i
      this.ws()
      if (this.s[this.i] !== '&') {
        this.i = save
        break
      }
      this.i++
      const next = this.node()
      if (next === null) {
        this.i = save
        break
      }
      ids.push(next)
    }
    return ids
  }

  /** 連線（含箭頭記號、線內文字、`|文字|`）；解析不到回傳 null */
  private link(): Link | null {
    this.ws()
    const rest = this.s.slice(this.i)
    let line: Link['line'] | null = null
    let arrow: Link['arrow'] = 'forward'
    let label: string | undefined
    let consumed = 0

    // 線內文字：`-- 文字 -->`、`== 文字 ==>`、`-. 文字 .->`
    const t = /^(<?)(--|==|-\.)\s+/.exec(rest)
    if (t) {
      const opener = t[2]
      const closeRe = opener === '--' ? /^\s*-{2,}(>|[ox](?=\s|$))?/ : opener === '==' ? /^\s*={2,}(>)?/ : /^\s*\.+-(>)?/
      const bodyStart = t[0].length
      let text: string | undefined
      let closeAt = -1
      let m: RegExpExecArray | null = null
      if (rest[bodyStart] === '"') {
        const q = rest.indexOf('"', bodyStart + 1)
        if (q >= 0) {
          m = closeRe.exec(rest.slice(q + 1))
          if (m) {
            text = rest.slice(bodyStart + 1, q)
            closeAt = q + 1
          }
        }
      }
      if (!m) {
        const scan = opener === '--' ? /\s+-{2,}(?:>|[ox](?=\s|$))?(?=\s|$)/ : opener === '==' ? /\s+={2,}>?(?=\s|$)/ : /\s+\.+-(?:>)?(?=\s|$)/
        const found = scan.exec(rest.slice(bodyStart))
        if (found) {
          text = rest.slice(bodyStart, bodyStart + found.index)
          closeAt = bodyStart + found.index
          m = closeRe.exec(rest.slice(closeAt))
        }
      }
      if (m) {
        line = opener === '--' ? 'solid' : opener === '==' ? 'thick' : 'dotted'
        arrow = t[1] === '<' ? 'both' : m[1] === '>' ? 'forward' : 'none'
        label = text
        consumed = closeAt + m[0].length
      }
    }

    if (line === null) {
      const d = /^(<?)(?:(-\.+-)(>?)|(-{2,})(>|[ox](?=\s|$))?|(={2,})(>)?|(~{3,}))/.exec(rest)
      if (!d) return null
      if (d[8]) line = 'invisible'
      else if (d[2]) line = 'dotted'
      else if (d[6]) line = 'thick'
      else line = 'solid'
      const head = d[3] ?? d[5] ?? d[7] ?? ''
      arrow = d[1] === '<' ? 'both' : head === '' ? 'none' : 'forward'
      consumed = d[0].length
      // `A --- B` 與 `A --> B`：沒有箭頭的 `---` 是無向連線
      if (line !== 'invisible' && d[1] !== '<' && head === '') arrow = 'none'
    }
    this.i += consumed
    // `-->|文字|`
    const save = this.i
    this.ws()
    if (this.s[this.i] === '|') {
      let j = this.i + 1
      while (j < this.s.length && /\s/.test(this.s[j])) j++
      let text: string | null = null
      if (this.s[j] === '"') {
        const q = this.s.indexOf('"', j + 1)
        if (q >= 0) {
          let k = q + 1
          while (k < this.s.length && /\s/.test(this.s[k])) k++
          if (this.s[k] === '|') {
            text = this.s.slice(j + 1, q)
            this.i = k + 1
          }
        }
      }
      if (text === null) {
        const q = this.s.indexOf('|', this.i + 1)
        if (q >= 0) {
          text = this.s.slice(this.i + 1, q)
          this.i = q + 1
        }
      }
      if (text !== null) label = text
      else this.i = save
    } else this.i = save
    return { line, arrow, label }
  }

  run(): void {
    let prev: string[] | null = null
    let pending: Link | null = null
    for (;;) {
      const ids = this.nodeGroup()
      if (ids === null) return
      if (prev && pending && pending.line !== 'invisible') {
        for (const from of prev) for (const to of ids) this.b.edge(from, to, { line: pending.line, arrow: pending.arrow, label: pending.label })
      }
      prev = ids
      pending = this.link()
      if (pending === null) return
    }
  }
}

function parseFlowchart(stmts: string[], direction: string | undefined): DiagramText {
  const b = new Builder()
  let anon = 0
  for (const s of stmts) {
    if (s === 'end') {
      b.pop()
      continue
    }
    if (s.startsWith('subgraph')) {
      const rest = s.slice('subgraph'.length).trim()
      let id: string
      let title: string
      const withId = /^([^\s[\]"]+)\s*\[\s*"?([\s\S]*?)"?\s*\]$/.exec(rest)
      if (withId) {
        id = withId[1]
        title = withId[2]
      } else {
        title = rest.replace(/^"([\s\S]*)"$/, '$1')
        id = /^[\p{L}\p{N}_]+$/u.test(rest) ? rest : `group${++anon}`
      }
      b.push(id, title)
      continue
    }
    if (SKIP_STATEMENT.test(s)) continue
    new FlowScanner(s, b).run()
  }
  return b.result('flowchart', direction)
}

/* ---------- stateDiagram ---------- */

function parseState(stmts: string[], direction: string | undefined): DiagramText {
  const b = new Builder()
  const START = '[*]'
  const stateId = (raw: string, role: 'from' | 'to'): string => {
    if (raw !== START) return raw
    return role === 'from' ? '[*]start' : '[*]end'
  }
  const touchState = (id: string) => {
    if (id === '[*]start') b.touch(id, '起點')
    else if (id === '[*]end') b.touch(id, '終點')
    else b.touch(id)
  }
  for (const s of stmts) {
    if (s === '}') {
      b.pop()
      continue
    }
    if (/^(direction|classDef|class|style|accTitle|accDescr|title|note|end note|--)\b/.test(s) || s === '--') continue
    let m = /^state\s+"([^"]*)"\s+as\s+([^\s{]+)\s*(\{)?$/.exec(s)
    if (m) {
      if (m[3]) {
        b.push(m[2], m[1])
      } else b.touch(m[2], m[1])
      continue
    }
    m = /^state\s+([^\s{:]+)\s*\{$/.exec(s)
    if (m) {
      b.push(m[1], m[1])
      continue
    }
    m = /^state\s+([^\s:]+)\s*<<(choice|fork|join)>>$/.exec(s)
    if (m) {
      b.touch(m[1], m[2] === 'choice' ? '選擇點' : m[2] === 'fork' ? '分岔' : '匯合')
      continue
    }
    m = /^state\s+([^\s:]+)\s*:\s*(.+)$/.exec(s)
    if (m) {
      b.touch(m[1], m[2])
      continue
    }
    m = /^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)\s*(?::\s*(.*))?$/.exec(s)
    if (m) {
      const from = stateId(m[1], 'from')
      const to = stateId(m[2], 'to')
      touchState(from)
      touchState(to)
      b.edge(from, to, { label: m[3] })
      continue
    }
    m = /^([^\s:]+)\s*:\s*(.+)$/.exec(s)
    if (m) {
      b.touch(m[1], m[2])
      continue
    }
  }
  return b.result('state', direction)
}

/* ---------- sequenceDiagram ---------- */

const SEQ_ARROW = /^(\S+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?(\S+?)\s*:\s*(.*)$/

function parseSequence(stmts: string[]): DiagramText {
  const b = new Builder()
  const notes: DiagramNote[] = []
  for (const s of stmts) {
    const note = /^Note\s+(?:over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(s)
    if (note) {
      const over = note[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
      for (const id of over) b.touch(id)
      const raw = cleanLabel(note[2])
      notes.push({ over, raw, label: accessibleText(raw).replace(/\s+/g, ' ').trim(), after: b.edges.length })
      continue
    }
    let m = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(s)
    if (m) {
      b.touch(m[1], m[2] ?? m[1])
      continue
    }
    m = SEQ_ARROW.exec(s)
    if (m) {
      b.touch(m[1])
      b.touch(m[3])
      b.edge(m[1], m[3], { line: m[2].startsWith('--') ? 'dotted' : 'solid', label: m[4] })
    }
  }
  return { ...b.result('sequence'), notes }
}

/* ---------- 入口 ---------- */

/** 解析不到結構的圖：只把雙引號裡的字串當作偵測到的節點名稱 */
function parseOther(stmts: string[]): DiagramText {
  const names: string[] = []
  for (const s of stmts.slice(1)) for (const m of s.matchAll(/"([^"]+)"/g)) names.push(m[1])
  const nodes = [...new Set(names)].map((raw, i): DiagramNode => {
    const clean = cleanLabel(raw)
    return { id: `n${i + 1}`, raw: clean, label: accessibleText(clean).replace(/\s+/g, ' ').trim() }
  })
  return { kind: 'other', parsed: false, nodes, edges: [], groups: [] }
}

/** Mermaid 原始碼 → 文字版的結構。永遠回傳物件（不丟例外）；解析不到結構時 `parsed: false`。 */
export function parseDiagramText(source: string): DiagramText {
  try {
    const stmts = statements(source)
    const header = stmts[0] ?? ''
    const body = stmts.slice(1)
    let m = /^(?:flowchart|graph)(?:-elk)?(?:\s+(TB|TD|BT|RL|LR))?\s*$/.exec(header)
    if (m) {
      const dir = m[1] === 'TD' ? 'TB' : m[1]
      const r = parseFlowchart(body, dir)
      return r.nodes.length > 0 ? r : { ...r, parsed: false }
    }
    m = /^stateDiagram(?:-v2)?\s*$/.exec(header)
    if (m) {
      const dirLine = body.find((s) => /^direction\s+(TB|BT|RL|LR)$/.test(s))
      const r = parseState(body, dirLine?.split(/\s+/)[1])
      return r.nodes.length > 0 ? r : { ...r, parsed: false }
    }
    if (/^sequenceDiagram\s*$/.test(header)) {
      const r = parseSequence(body)
      return r.nodes.length > 0 ? r : { ...r, parsed: false }
    }
    return parseOther(stmts)
  } catch {
    return { kind: 'other', parsed: false, nodes: [], edges: [], groups: [] }
  }
}

/* ---------- 顯示用的小函式（DiagramFrame 與測試共用） ---------- */

export const DIRECTION_TEXT: Record<string, string> = { LR: '由左到右', RL: '由右到左', TB: '由上到下', BT: '由下到上' }

export const LINE_TEXT: Record<DiagramEdge['line'], string> = { solid: '', dotted: '虛線', thick: '粗線' }

/** 連線端點的名稱：節點用它的標籤；端點是 subgraph 時念「群組「…」」。raw = true 回傳保留 `$…$` 的版本 */
export function endpointText(model: Pick<DiagramText, 'nodes' | 'groups'>, id: string, raw = false): string {
  const n = model.nodes.find((x) => x.id === id)
  if (n) return raw ? n.raw : n.label
  const g = model.groups.find((x) => x.id === id)
  if (g) return `群組「${raw ? g.raw : g.label}」`
  return id
}

/** 一條連線的可念文字：「A → B（標籤）」；無箭頭用「—」，雙向用「↔」；虛線、粗線加註 */
export function edgeToText(model: Pick<DiagramText, 'nodes' | 'groups'>, e: DiagramEdge): string {
  const arrow = e.arrow === 'forward' ? '→' : e.arrow === 'both' ? '↔' : '—'
  const parts = [LINE_TEXT[e.line], e.label].filter((x): x is string => !!x)
  return `${endpointText(model, e.from)} ${arrow} ${endpointText(model, e.to)}${parts.length > 0 ? `（${parts.join('；')}）` : ''}`
}

/** 整張圖的純文字摘要（測試、除錯、無障礙名稱用）：群組、節點、連線各一行 */
export function diagramToPlainText(model: DiagramText): string {
  const lines: string[] = []
  for (const g of model.groups) lines.push(`群組 ${g.label}：${g.nodes.map((id) => model.nodes.find((n) => n.id === id)?.label ?? id).join('、')}`)
  for (const n of model.nodes) lines.push(`節點 ${n.label}`)
  for (const e of model.edges) lines.push(`連線 ${edgeToText(model, e)}`)
  return lines.join('\n')
}
