import { useId, useMemo } from 'react'
import { DiagramFrame } from './DiagramFrame'
import { cleanLabel, labelToSpeech, type DiagramEdge, type DiagramGroup, type DiagramNode, type DiagramText } from './diagramText'
import { mathText } from './Tex'

/**
 * 全站共用的「系統地圖」：DTC-based Fractional-N PLL + Sign-LMS 校正迴路的完整方塊圖（規格 §4 概念架構的方塊，DTC 改接在 reference 輸入端）。
 * 每章開頭放同一張圖，並把本章在講的方塊標成藍色，讓讀者知道「現在在系統的哪裡」。
 * 圖是教學用的概念架構，不是特定晶片的 netlist。
 *
 * 這張圖是手排的 SVG（不是 Mermaid 自動排版）：三條水平泳道由上而下是
 * 主 PLL 迴路、小數除頻與補償、LMS 校正迴路；所有連線都是水平或垂直，而且沒有任何交叉。
 *
 * 架構（2026-10 起，依使用者的晶片接法）：
 *   - DTC 在 reference 的輸入端：Reference clock → DTC → Phase detector；回授路徑上只有 Divider / PMUX。
 *   - LMS 校正迴路的輸入是 PD 的輸出 e[n]（就是送進 loop filter 的那個節點）。這條線若直接畫到下面的
 *     comparator 會穿過回授與小數補償的線，所以用「成對的標籤」表示：PD 輸出旁一個、comparator 輸入旁一個。
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
export const SYSTEM_MAP_SIZE = { width: 1044, height: 610 } as const

const BOX_H = 56
/** 五列的中心 y：A、B 在主 PLL 泳道（A 上方留一列給 e[n] 的標籤），C 在小數補償泳道，D、E 在 LMS 泳道 */
const ROW = { a: 118, b: 206, c: 326, d: 450, e: 546 } as const
/** 各欄的 [左緣 x, 寬]。第 1 欄有寬（comparator）窄（DTC、GC、Quantizer）兩種，右緣對齊，
 *  左邊多出來的那一段讓 e[n] 的標籤從上方接進 comparator，不會碰到 Quantizer。 */
const COL = { c0: [30, 116], c1w: [172, 162], c1n: [214, 120], c2: [384, 148], c3: [582, 140], c4: [772, 130] } as const
/** e[n] 的標籤接進 comparator 的那條垂直線的 x（在 comparator 左緣與 Quantizer 左緣之間） */
const ERR_X = 193
/** PD 輸出標籤（在 A 列上方）的上下緣 */
const TAG_Y = { top: 50, bottom: 76 } as const

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
  // 主 PLL 迴路（快）：reference 先經過 DTC 才進 PD；回授路徑只有 divider
  block('ref', 'pll', 'c0', 'a', 'Reference clock'),
  block('dtc', 'pll', 'c1n', 'a', 'DTC', 'code → delay'),
  block('pd', 'pll', 'c2', 'a', 'Phase detector', 'PD / SSPD / BBPD'),
  block('lf', 'pll', 'c3', 'a', 'Loop filter'),
  block('vco', 'pll', 'c4', 'a', 'VCO / DCO'),
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
  // v[n] 是折算到 comparator 輸入端（＝PD 輸出這個節點）的等效雜訊；公式裡的 e[n] = (a − w)·x[n] + v[n] 已經包含它（docs/assumptions.md §2a 第 3 點）
  block('noise', 'lms', 'c0', 'e', '雜訊 $v[n]$', '折算到輸入端', true),
  block('cmp', 'lms', 'c1w', 'e', '1-bit comparator', String.raw`$q[n] = \mathrm{sign}(e[n])$`),
  block('gmac', 'lms', 'c3', 'e', 'GMAC', String.raw`$\sum q[n]\,x[n]$`),
  block('align', 'lms', 'c4', 'e', 'Code alignment', 'delay / filtered-x'),
]

type Pt = readonly [number, number]
interface LabelBox {
  x: number
  y: number
  w: number
  h: number
  align: 'left' | 'right' | 'center'
}

export interface SystemMapWire {
  from: SystemBlock
  /** 終點方塊；'out' 表示 PLL 輸出（圖的右邊） */
  to: SystemBlock | 'out'
  /** 折線的頂點（由起點到箭頭尖端）。用標籤接續的線（見 tag）這裡是「進入終點方塊」的那一小段 */
  points: ReadonlyArray<Pt>
  /** 虛線：只是「觀測」訊號，不在主迴路的訊號路徑上 */
  dashed?: boolean
  /** 連線上的訊號名稱（可含 `$...$`）與它的位置 */
  label?: string
  labelBox?: LabelBox
  /**
   * 用成對的標籤代替中間那一段連線（像電路圖的 net label）：
   * `tap` 是來源那一側的小段（從分接點到來源標籤），`source`／`dest` 是兩個標籤的文字與位置。
   */
  tag?: {
    /** 分接點（在哪一條線上分出來）與那條線的起訖方塊 */
    tapOn: readonly [SystemBlock, SystemBlock]
    tap: ReadonlyArray<Pt>
    source: { text: string; box: LabelBox }
    dest: { text: string; box: LabelBox }
  }
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
const X_BUS_Y = 379
/** e[n] 的分接點：PD 與 loop filter 之間那條線的中點 */
const TAP_X = (right('pd') + left('lf')) / 2

export const SYSTEM_MAP_WIRES: readonly SystemMapWire[] = [
  // 主 PLL 迴路：reference → DTC → PD → loop filter → VCO；VCO → divider → PD
  across('ref', 'dtc'),
  across('dtc', 'pd'),
  across('pd', 'lf'),
  across('lf', 'vco'),
  { from: 'vco', to: 'out', points: [[right('vco'), ROW.a], [right('vco') + 34, ROW.a]], label: String.raw`輸出 $f_{\mathrm{out}}$`, labelBox: { x: right('vco') + 40, y: ROW.a - 14, w: 96, h: 28, align: 'left' } },
  { from: 'vco', to: 'div', points: [[cx('vco'), bottom('vco')], [cx('vco'), ROW.b], [right('div'), ROW.b]] },
  { from: 'div', to: 'pd', points: [[left('div'), ROW.b], [cx('pd'), ROW.b], [cx('pd'), bottom('pd')]] },
  // 小數除頻與補償：carry → divider；residue → gain correction → reference 端的 DTC
  across('fcw', 'dsm'),
  across('dsm', 'res'),
  across('res', 'gc'),
  along('dsm', 'div'),
  along('gc', 'dtc'),
  // LMS 校正迴路：輸入是 PD 的輸出 e[n]（用成對的標籤接過來）
  {
    from: 'pd',
    to: 'cmp',
    dashed: true,
    points: [[COL.c0[0] + COL.c0[1] + 4, ROW.d], [ERR_X, ROW.d], [ERR_X, top('cmp')]],
    tag: {
      tapOn: ['pd', 'lf'],
      tap: [[TAP_X, ROW.a], [TAP_X, TAG_Y.bottom]],
      source: { text: String.raw`PD 輸出 $e[n]$ → 給 LMS 校正迴路`, box: { x: TAP_X - 112, y: TAG_Y.top, w: 224, h: TAG_Y.bottom - TAG_Y.top, align: 'center' } },
      dest: { text: String.raw`$e[n]$（PD 輸出）`, box: { x: COL.c0[0] - 8, y: ROW.d - 13, w: COL.c0[1] + 12, h: 26, align: 'right' } },
    },
  },
  across('noise', 'cmp'),
  { ...across('cmp', 'gmac'), label: '$q[n]$', labelBox: { x: cx('acc') - 40, y: ROW.e - 31, w: 80, h: 26, align: 'center' } },
  {
    from: 'res',
    to: 'align',
    points: [[cx('res'), bottom('res')], [cx('res'), X_BUS_Y], [cx('align'), X_BUS_Y], [cx('align'), top('align')]],
    label: '$x[n]$',
    labelBox: { x: cx('align') + 9, y: ROW.d - 13, w: 56, h: 26, align: 'left' },
  },
  across('align', 'gmac'),
  along('gmac', 'scale'),
  across('scale', 'acc'),
  across('acc', 'qnt'),
  { ...along('qnt', 'gc'), label: '$w$', labelBox: { x: cx('gc') + 9, y: X_BUS_Y - 13, w: 40, h: 26, align: 'left' } },
]

const LANES: ReadonlyArray<{ id: SystemLane; title: string; y: number; h: number }> = [
  { id: 'pll', title: '主 PLL 迴路（快）', y: 22, h: 226 },
  { id: 'frac', title: '小數除頻與補償', y: 266, h: 104 },
  { id: 'lms', title: 'LMS 校正迴路（慢）', y: 388, h: 206 },
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

/** 'out'（PLL 輸出）在文字版裡的節點 id 與標籤 */
const OUT_NODE = { id: 'out', raw: 'PLL 輸出（圖的右邊）' } as const

/**
 * 系統地圖的文字版（DiagramFrame 的「文字版」details 用）：由 systemMapModel 產生和 Mermaid 圖同樣的結構——
 * 三條泳道是群組、方塊是節點（本章主角標 focus）、連線是邊（虛線＝只是觀測的訊號；e[n] 的成對標籤算一條 PD → comparator 的連線）。
 */
export function systemMapText(focus: readonly SystemBlock[]): DiagramText {
  const model = systemMapModel(focus)
  const nodes: DiagramNode[] = model.blocks.map((b) => {
    const raw = cleanLabel(b.sub ? `${b.title}：${b.sub}` : b.title)
    return { id: b.id, raw, label: labelToSpeech(raw), group: b.lane, shape: b.pill ? 'stadium' : 'rect', ...(b.focused ? { focus: true } : {}) }
  })
  const outRaw = cleanLabel(OUT_NODE.raw)
  nodes.push({ id: OUT_NODE.id, raw: outRaw, label: labelToSpeech(outRaw) })
  const groups: DiagramGroup[] = LANES.map((l) => ({
    id: l.id,
    raw: l.title,
    label: l.title,
    nodes: nodes.filter((n) => n.group === l.id).map((n) => n.id),
  }))
  const edges: DiagramEdge[] = model.wires.map((w) => {
    const raw = w.label !== undefined ? cleanLabel(w.label) : w.tag ? cleanLabel(w.tag.dest.text) : undefined
    return {
      from: w.from,
      to: w.to,
      line: w.dashed ? 'dotted' : 'solid',
      arrow: 'forward',
      ...(raw ? { raw, label: labelToSpeech(raw) } : {}),
    }
  })
  return { kind: 'flowchart', parsed: true, nodes, edges, groups }
}

export interface SystemMapProps {
  /** 本章在講的方塊（會標成藍色） */
  focus: SystemBlock[]
  /** 圖說；預設列出被標示的方塊名稱 */
  caption?: string
}

function WireLabel({ box, text, className }: { box: LabelBox; text: string; className: string }) {
  return (
    <foreignObject x={box.x} y={box.y} width={box.w} height={box.h}>
      <div className={`c-sysmap-wirelabel is-${box.align} ${className}`}>
        <span>{mathText(text)}</span>
      </div>
    </foreignObject>
  )
}

/** 系統地圖的 SVG 本體（同一頁可能出現兩份：正文與放大檢視，所以 marker id 由 useId 產生）。 */
function SystemMapSvg({ focus }: { focus: readonly SystemBlock[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const arrow = `sysmap-arrow-${uid}`
  const model = useMemo(() => systemMapModel(focus), [focus])
  const anyFocus = model.blocks.some((b) => b.focused)
  const { width, height } = SYSTEM_MAP_SIZE
  // 圖例放在主 PLL 泳道右下的空位（VCO 往下接 divider 那條線的右邊）
  const legendX = cx('vco') + 26
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
        {model.wires.map(
          (w) =>
            w.tag && (
              <g key={`tap-${w.from}-${w.to}`} className="c-sysmap-tap" data-from={w.from} data-to={w.to}>
                <path className="c-sysmap-wire is-dashed" d={wirePath(w.tag.tap)} />
                <circle className="c-sysmap-junction" cx={w.tag.tap[0][0]} cy={w.tag.tap[0][1]} r={3.2} />
              </g>
            ),
        )}
      </g>

      {model.wires.map((w) => w.label && w.labelBox && <WireLabel key={`label-${w.from}-${w.to}`} box={w.labelBox} text={w.label} className="" />)}
      {model.wires.map(
        (w) =>
          w.tag && (
            <g key={`tag-${w.from}-${w.to}`} className="c-sysmap-tags">
              <WireLabel box={w.tag.source.box} text={w.tag.source.text} className="is-tag" />
              <WireLabel box={w.tag.dest.box} text={w.tag.dest.text} className="is-tag" />
            </g>
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
          同名標籤＝同一條線
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
      ariaLabel={`DTC-based Fractional-N PLL 與 Sign-LMS 校正迴路的系統方塊圖（DTC 在 reference 輸入端；LMS 的輸入取自 PD 的輸出）；本章重點：${names || '整個系統'}`}
      naturalSize={SYSTEM_MAP_SIZE}
      zoomChildren={<SystemMapSvg focus={focus} />}
      textModel={() => systemMapText(focus)}
    >
      <SystemMapSvg focus={focus} />
    </DiagramFrame>
  )
}
