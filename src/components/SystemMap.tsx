import { useId, useMemo } from 'react'
import { DiagramFrame } from './DiagramFrame'
import { mathText } from './Tex'

/**
 * 全站共用的「系統地圖」：DTC-based Fractional-N PLL + Sign-LMS 校正迴路的完整方塊圖（規格 §4 的概念架構）。
 * 每章開頭放同一張圖，並把本章在講的方塊標成藍色，讓讀者知道「現在在系統的哪裡」。
 * 圖是教學用的概念架構，不是特定晶片的 netlist。
 *
 * 這張圖是手排的 SVG（不是 Mermaid 自動排版）：三條水平泳道由上而下是
 * 主 PLL 迴路、小數除頻與補償、LMS 校正迴路；所有連線都是水平或垂直，而且沒有任何交叉。
 */
export type SystemBlock =
  | 'ref' // Reference clock
  | 'pd' // Phase detector / SSPD / BBPD
  | 'lf' // PLL loop filter
  | 'vco' // VCO / DCO
  | 'div' // Divider / PMUX
  | 'fcw' // Frequency control word
  | 'dsm' // Delta-sigma modulator / accumulator
  | 'res' // Fractional residue x[n]（regressor）
  | 'gc' // Gain correction：code × w
  | 'dtc' // Digital-to-time converter
  | 'cmp' // 1-bit comparator q[n] = sign(e[n])
  | 'align' // Code alignment / delay / filtered-x
  | 'gmac' // GMAC：Σ q·x
  | 'scale' // ÷N、× μ
  | 'acc' // Gain accumulator w_k
  | 'qnt' // 有限位元量化（例如 6-bit）
  | 'noise' // comparator 前雜訊 v[n]

export const SYSTEM_BLOCK_LABEL: Record<SystemBlock, string> = {
  ref: 'Reference clock',
  pd: 'Phase detector（PD / SSPD / BBPD）',
  lf: 'PLL loop filter',
  vco: 'VCO / DCO',
  div: 'Divider / PMUX',
  fcw: 'FCW',
  dsm: 'DSM / accumulator',
  res: 'Fractional residue $x[n]$',
  gc: 'Gain correction（$\\times w$）',
  dtc: 'DTC',
  cmp: '1-bit comparator',
  align: 'Code alignment / delay / filtered-x',
  gmac: 'GMAC（$\\sum q\\,x$）',
  scale: 'Normalize + learning rate',
  acc: 'Gain accumulator $w_k$',
  qnt: 'Quantizer（有限位元）',
  noise: 'Comparator 前雜訊 $v[n]$',
}

/* ---------- 版面（單位：SVG 使用者座標，1 單位 = 自然大小下的 1px） ---------- */

/** 圖的自然尺寸 */
export const SYSTEM_MAP_SIZE = { width: 976, height: 584 } as const

const BOX_H = 56
/** 五列的中心 y：A、B 在主 PLL 泳道，C 在小數補償泳道，D、E 在 LMS 泳道 */
const ROW = { a: 84, b: 178, c: 300, d: 424, e: 520 } as const
/** 各欄的 [左緣 x, 寬]。第 1 欄有寬（PD、comparator）窄（DTC、GC、Quantizer）兩種，右緣對齊，
 *  左邊空出來的那一條剛好讓 phase error 直直往下走到 comparator。 */
const COL = { c0: [30, 128], c1w: [202, 164], c1n: [246, 120], c2: [424, 140], c3: [614, 140], c4: [806, 140] } as const
/** phase error e[n] 那條垂直虛線的 x */
const ERR_X = 224

export type SystemLane = 'pll' | 'frac' | 'lms'

export interface SystemMapBlock {
  id: SystemBlock
  lane: SystemLane
  /** 方塊標題與第二行（可含 `$...$`） */
  title: string
  sub?: string
  x: number
  y: number
  w: number
  h: number
  /** 雜訊源畫成膠囊形 */
  pill?: boolean
}

function block(id: SystemBlock, lane: SystemLane, col: keyof typeof COL, row: keyof typeof ROW, title: string, sub?: string, pill?: boolean): SystemMapBlock {
  const [x, w] = COL[col]
  return { id, lane, title, sub, x, y: ROW[row] - BOX_H / 2, w, h: BOX_H, pill }
}

export const SYSTEM_MAP_BLOCKS: readonly SystemMapBlock[] = [
  // 主 PLL 迴路（快）
  block('ref', 'pll', 'c0', 'a', 'Reference clock'),
  block('pd', 'pll', 'c1w', 'a', 'Phase detector', 'PD / SSPD / BBPD'),
  block('lf', 'pll', 'c2', 'a', 'Loop filter'),
  block('vco', 'pll', 'c3', 'a', 'VCO / DCO'),
  block('dtc', 'pll', 'c1n', 'b', 'DTC', 'code → delay'),
  block('div', 'pll', 'c3', 'b', 'Divider / PMUX'),
  // 小數除頻與補償
  block('gc', 'frac', 'c1n', 'c', 'Gain correction', String.raw`code $\times\, w$`),
  block('res', 'frac', 'c2', 'c', 'Fractional residue', '$x[n]$（regressor）'),
  block('dsm', 'frac', 'c3', 'c', 'DSM / accumulator'),
  block('fcw', 'frac', 'c4', 'c', 'FCW'),
  // LMS 校正迴路（慢）
  block('qnt', 'lms', 'c1n', 'd', 'Quantizer', '有限位元'),
  block('acc', 'lms', 'c2', 'd', 'Gain accumulator', '$w_k$'),
  block('scale', 'lms', 'c3', 'd', 'Normalize', String.raw`$\div N$、$\times\,\mu$`),
  block('noise', 'lms', 'c0', 'e', '雜訊 $v[n]$', undefined, true),
  block('cmp', 'lms', 'c1w', 'e', '1-bit comparator', String.raw`$q[n] = \mathrm{sign}(e[n])$`),
  block('gmac', 'lms', 'c3', 'e', 'GMAC', String.raw`$\sum q[n]\,x[n]$`),
  block('align', 'lms', 'c4', 'e', 'Code alignment', 'delay / filtered-x'),
]

export interface SystemMapWire {
  from: SystemBlock
  /** 終點方塊；'out' 表示 PLL 輸出（圖的右邊） */
  to: SystemBlock | 'out'
  /** 折線的頂點（由起點到箭頭尖端） */
  points: ReadonlyArray<readonly [number, number]>
  /** 虛線：只是「觀測」訊號，不在主迴路的訊號路徑上 */
  dashed?: boolean
  /** 連線上的訊號名稱（可含 `$...$`）與它的位置 */
  label?: string
  labelBox?: { x: number; y: number; w: number; h: number; align: 'left' | 'right' | 'center' }
}

const B = Object.fromEntries(SYSTEM_MAP_BLOCKS.map((b) => [b.id, b])) as Record<SystemBlock, SystemMapBlock>
const cx = (id: SystemBlock) => B[id].x + B[id].w / 2
const cy = (id: SystemBlock) => B[id].y + B[id].h / 2
const left = (id: SystemBlock) => B[id].x
const right = (id: SystemBlock) => B[id].x + B[id].w
const top = (id: SystemBlock) => B[id].y
const bottom = (id: SystemBlock) => B[id].y + B[id].h

/** 水平連線：from 的側邊 → to 的側邊（依左右位置自動決定方向） */
function across(from: SystemBlock, to: SystemBlock): SystemMapWire {
  const ltr = cx(from) < cx(to)
  return { from, to, points: [[ltr ? right(from) : left(from), cy(from)], [ltr ? left(to) : right(to), cy(to)]] }
}
/** 垂直連線：沿著 to 的中心線，from 的上／下緣 → to 的下／上緣 */
function along(from: SystemBlock, to: SystemBlock, x = cx(to)): SystemMapWire {
  const down = cy(from) < cy(to)
  return { from, to, points: [[x, down ? bottom(from) : top(from)], [x, down ? top(to) : bottom(to)]] }
}

/** x[n] 由 residue 往下、沿兩條泳道之間往右，再往下進 code alignment */
const X_BUS_Y = 353

export const SYSTEM_MAP_WIRES: readonly SystemMapWire[] = [
  // 主 PLL 迴路
  across('ref', 'pd'),
  across('pd', 'lf'),
  across('lf', 'vco'),
  { from: 'vco', to: 'out', points: [[right('vco'), ROW.a], [right('vco') + 58, ROW.a]], label: String.raw`輸出 $f_{\mathrm{out}}$`, labelBox: { x: right('vco') + 66, y: ROW.a - 14, w: 110, h: 28, align: 'left' } },
  along('vco', 'div'),
  across('div', 'dtc'),
  along('dtc', 'pd'),
  // 小數除頻與補償
  across('fcw', 'dsm'),
  across('dsm', 'res'),
  across('res', 'gc'),
  along('dsm', 'div'),
  along('gc', 'dtc'),
  // LMS 校正迴路
  {
    from: 'pd',
    to: 'cmp',
    points: [[ERR_X, bottom('pd')], [ERR_X, top('cmp')]],
    dashed: true,
    label: 'phase error $e[n]$',
    labelBox: { x: 36, y: ROW.c - 14, w: ERR_X - 46, h: 28, align: 'right' },
  },
  across('noise', 'cmp'),
  { ...across('cmp', 'gmac'), label: '$q[n]$', labelBox: { x: cx('acc') - 40, y: ROW.e - 31, w: 80, h: 26, align: 'center' } },
  {
    from: 'res',
    to: 'align',
    points: [[cx('res'), bottom('res')], [cx('res'), X_BUS_Y], [cx('align'), X_BUS_Y], [cx('align'), top('align')]],
    label: '$x[n]$',
    labelBox: { x: cx('align') + 9, y: ROW.d - 13, w: 60, h: 26, align: 'left' },
  },
  across('align', 'gmac'),
  along('gmac', 'scale'),
  across('scale', 'acc'),
  across('acc', 'qnt'),
  { ...along('qnt', 'gc'), label: '$w$', labelBox: { x: cx('gc') + 9, y: X_BUS_Y - 15, w: 40, h: 26, align: 'left' } },
]

const LANES: ReadonlyArray<{ id: SystemLane; title: string; y: number; h: number }> = [
  { id: 'pll', title: '主 PLL 迴路（快）', y: 22, h: 200 },
  { id: 'frac', title: '小數除頻與補償', y: 240, h: 104 },
  { id: 'lms', title: 'LMS 校正迴路（慢）', y: 362, h: 206 },
]
const LANE_X = 14
const LANE_W = SYSTEM_MAP_SIZE.width - 2 * LANE_X

/** 折線 → SVG path；轉角用半徑 r 的圓弧帶過 */
export function wirePath(points: ReadonlyArray<readonly [number, number]>, r = 9): string {
  if (points.length < 2) return ''
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    const inLen = Math.hypot(x - px, y - py)
    const outLen = Math.hypot(nx - x, ny - y)
    const k = Math.min(r, inLen / 2, outLen / 2)
    const ax = x - ((x - px) / inLen) * k
    const ay = y - ((y - py) / inLen) * k
    const bx = x + ((nx - x) / outLen) * k
    const by = y + ((ny - y) / outLen) * k
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`
  }
  const last = points[points.length - 1]
  return `${d} L${last[0]},${last[1]}`
}

export interface SystemMapModel {
  blocks: Array<SystemMapBlock & { focused: boolean }>
  wires: readonly SystemMapWire[]
}

/** 系統地圖的內容（純資料，方便測試）：每個方塊有沒有被標成本章主角，以及所有連線。 */
export function systemMapModel(focus: readonly SystemBlock[]): SystemMapModel {
  const on = new Set(focus)
  return { blocks: SYSTEM_MAP_BLOCKS.map((b) => ({ ...b, focused: on.has(b.id) })), wires: SYSTEM_MAP_WIRES }
}

const NODE_ID: Record<SystemBlock, string> = {
  ref: 'REF',
  pd: 'PD',
  lf: 'LF',
  vco: 'VCO',
  div: 'DIV',
  fcw: 'FCW',
  dsm: 'DSM',
  res: 'RES',
  gc: 'GC',
  dtc: 'DTC',
  cmp: 'CMP',
  align: 'ALIGN',
  gmac: 'GMAC',
  scale: 'SCALE',
  acc: 'ACC',
  qnt: 'QNT',
  noise: 'NOISE',
}

/**
 * 同一張系統地圖的 Mermaid 原始碼（純函式）。畫面上的圖已改用手排的 SVG；
 * 這個文字版保留給需要「圖的原始碼」的地方（例如測試比對拓樸、匯出文字版）。
 */
export function systemMapChart(focus: readonly SystemBlock[]): string {
  const lines = [
    'flowchart TB',
    '  subgraph MAIN["主 PLL 迴路（快）"]',
    '    direction LR',
    '    REF["Reference clock"] --> PD["Phase detector<br/>PD / SSPD / BBPD"]',
    '    PD --> LF["Loop filter"]',
    '    LF --> VCO["VCO / DCO"]',
    '    VCO --> DIV["Divider / PMUX"]',
    '    DIV --> DTC["DTC<br/>code → delay"]',
    '    DTC --> PD',
    '  end',
    '  subgraph FRAC["小數除頻與補償"]',
    '    direction LR',
    '    FCW["FCW"] --> DSM["DSM / accumulator"]',
    String.raw`    DSM --> RES["Fractional residue<br/>$x[n]$（regressor）"]`,
    String.raw`    RES --> GC["Gain correction<br/>code $\times\, w$"]`,
    '  end',
    '  subgraph CAL["LMS 校正迴路（慢）"]',
    '    direction LR',
    String.raw`    NOISE(["雜訊 $v[n]$"]) --> CMP["1-bit comparator<br/>$q[n] = \mathrm{sign}(e[n])$"]`,
    String.raw`    CMP --> GMAC["GMAC<br/>$\sum q[n]\, x[n]$"]`,
    '    ALIGN["Code alignment<br/>delay / filtered-x"] --> GMAC',
    String.raw`    GMAC --> SCALE["$\div N$、$\times\,\mu$"]`,
    String.raw`    SCALE --> ACC["Gain accumulator<br/>$w_k$"]`,
    '    ACC --> QNT["Quantizer<br/>有限位元"]',
    '  end',
    '  DSM --> DIV',
    '  GC --> DTC',
    String.raw`  PD -. "phase error $e[n]$" .-> CMP`,
    '  RES --> ALIGN',
    String.raw`  QNT -- "$w$" --> GC`,
    '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px',
  ]
  const ids = [...new Set(focus)].map((b) => NODE_ID[b])
  if (ids.length) lines.push(`  class ${ids.join(',')} focus`)
  return lines.join('\n')
}

export interface SystemMapProps {
  /** 本章在講的方塊（會標成藍色） */
  focus: SystemBlock[]
  /** 圖說；預設列出被標示的方塊名稱 */
  caption?: string
}

/** 系統地圖的 SVG 本體（同一頁可能出現兩份：正文與放大檢視，所以 marker id 由 useId 產生）。 */
function SystemMapSvg({ focus }: { focus: readonly SystemBlock[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const arrow = `sysmap-arrow-${uid}`
  const model = useMemo(() => systemMapModel(focus), [focus])
  const anyFocus = model.blocks.some((b) => b.focused)
  const { width, height } = SYSTEM_MAP_SIZE
  // 圖例放在主 PLL 泳道右邊的空位（Divider 的右邊）
  const legendX = right('div') + 62
  const legendY = ROW.b - (anyFocus ? 20 : 8)

  return (
    <svg className="c-sysmap-svg" viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="presentation" focusable="false">
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path className="c-sysmap-arrowhead" d="M0.5,1 L9.5,5 L0.5,9 Z" />
        </marker>
      </defs>

      {LANES.map((l) => (
        <g key={l.id} className={`c-sysmap-lane c-sysmap-lane-${l.id}`}>
          <rect x={LANE_X} y={l.y} width={LANE_W} height={l.h} rx={14} />
          <text x={LANE_X + 14} y={l.y + 20}>
            {l.title}
          </text>
        </g>
      ))}

      <g className="c-sysmap-wires">
        {model.wires.map((w) => (
          <path key={`${w.from}-${w.to}`} className={`c-sysmap-wire${w.dashed ? ' is-dashed' : ''}`} d={wirePath(w.points)} markerEnd={`url(#${arrow})`} data-from={w.from} data-to={w.to} />
        ))}
      </g>

      {model.wires.map(
        (w) =>
          w.label &&
          w.labelBox && (
            <foreignObject key={`label-${w.from}-${w.to}`} x={w.labelBox.x} y={w.labelBox.y} width={w.labelBox.w} height={w.labelBox.h}>
              <div className={`c-sysmap-wirelabel is-${w.labelBox.align}`}>
                <span>{mathText(w.label)}</span>
              </div>
            </foreignObject>
          ),
      )}

      {model.blocks.map((b) => (
        <g key={b.id} className={`c-sysmap-block${b.focused ? ' is-focus' : ''}`} data-block={b.id} data-focus={b.focused ? 'true' : undefined}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.pill ? b.h / 2 : 9} />
          <foreignObject x={b.x} y={b.y} width={b.w} height={b.h}>
            <div className="c-sysmap-label">
              <span className="c-sysmap-title">{mathText(b.title)}</span>
              {b.sub && <span className="c-sysmap-sub">{mathText(b.sub)}</span>}
            </div>
          </foreignObject>
        </g>
      ))}

      <g className="c-sysmap-legend">
        {anyFocus && (
          <>
            <rect className="c-sysmap-legend-focus" x={legendX} y={legendY} width={22} height={13} rx={3.5} />
            <text x={legendX + 30} y={legendY + 10.5}>
              本章主角
            </text>
          </>
        )}
        <path className="c-sysmap-wire is-dashed" d={`M${legendX},${legendY + (anyFocus ? 31 : 7)} h22`} />
        <text x={legendX + 30} y={legendY + (anyFocus ? 35 : 11)}>
          只是觀測（虛線）
        </text>
      </g>
    </svg>
  )
}

/** 每章開頭的「你在這裡」系統方塊圖。 */
export function SystemMap({ focus, caption }: SystemMapProps) {
  const names = [...new Set(focus)].map((b) => SYSTEM_BLOCK_LABEL[b]).join('、')
  return (
    <DiagramFrame
      className="c-sysmap"
      caption={caption ?? `系統地圖：藍色是本章的主角（${names || '整個系統'}）。教學用概念架構，不是特定晶片的 netlist。`}
      ariaLabel={`DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖；本章重點：${names || '整個系統'}`}
      naturalSize={SYSTEM_MAP_SIZE}
      zoomChildren={<SystemMapSvg focus={focus} />}
    >
      <SystemMapSvg focus={focus} />
    </DiagramFrame>
  )
}
