import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SYSTEM_BLOCK_LABEL,
  SYSTEM_MAP_BLOCKS,
  SYSTEM_MAP_SIZE,
  SYSTEM_MAP_WIRES,
  SystemMap,
  systemMapModel,
  wirePath,
  type SystemBlock,
  type SystemMapBlock,
  type SystemMapWire,
} from './SystemMap'

const all = Object.keys(SYSTEM_BLOCK_LABEL) as SystemBlock[]
const byId = Object.fromEntries(SYSTEM_MAP_BLOCKS.map((b) => [b.id, b])) as Record<SystemBlock, SystemMapBlock>

type Pt = readonly [number, number]
type Seg = readonly [Pt, Pt]
const segments = (pts: ReadonlyArray<Pt>): Seg[] => pts.slice(1).map((p, i) => [pts[i], p] as const)

/** 一條線畫出來的所有折線：本體，加上（用標籤接續的線）分接點到來源標籤的那一小段 */
const allPaths = (w: SystemMapWire): ReadonlyArray<ReadonlyArray<Pt>> => (w.tag ? [w.points, w.tag.tap] : [w.points])

/** 點是否在方塊的邊框上（容許 0.5 的誤差） */
function onEdge(b: SystemMapBlock, [x, y]: Pt): boolean {
  const eps = 0.5
  const inX = x >= b.x - eps && x <= b.x + b.w + eps
  const inY = y >= b.y - eps && y <= b.y + b.h + eps
  const onV = Math.abs(x - b.x) <= eps || Math.abs(x - (b.x + b.w)) <= eps
  const onH = Math.abs(y - b.y) <= eps || Math.abs(y - (b.y + b.h)) <= eps
  return (onV && inY) || (onH && inX)
}

/** 水平／垂直線段是否穿過方塊內部（碰到邊框不算） */
function passesThrough(b: SystemMapBlock, [[x1, y1], [x2, y2]]: Seg): boolean {
  const eps = 0.5
  const lo = (a: number, c: number) => Math.min(a, c)
  const hi = (a: number, c: number) => Math.max(a, c)
  return hi(x1, x2) > b.x + eps && lo(x1, x2) < b.x + b.w - eps && hi(y1, y2) > b.y + eps && lo(y1, y2) < b.y + b.h - eps
}

/** 兩條水平／垂直線段是否在內部相交（共用端點不算） */
function cross([[ax1, ay1], [ax2, ay2]]: Seg, [[bx1, by1], [bx2, by2]]: Seg): boolean {
  const aH = ay1 === ay2
  const bH = by1 === by2
  if (aH === bH) return false // 平行（同一條線上的重疊另外檢查）
  const [h, v] = aH ? [[ax1, ay1, ax2], [bx1, by1, by2]] : [[bx1, by1, bx2], [ax1, ay1, ay2]]
  const [hx1, hy, hx2] = h
  const [vx, vy1, vy2] = v
  return vx > Math.min(hx1, hx2) && vx < Math.max(hx1, hx2) && hy > Math.min(vy1, vy2) && hy < Math.max(vy1, vy2)
}

describe('系統地圖：版面（手排 SVG）', () => {
  it('17 個方塊都在圖裡、都在畫布內，而且互不重疊', () => {
    expect(SYSTEM_MAP_BLOCKS.map((b) => b.id).sort()).toEqual([...all].sort())
    for (const b of SYSTEM_MAP_BLOCKS) {
      expect(b.x, b.id).toBeGreaterThan(0)
      expect(b.y, b.id).toBeGreaterThan(0)
      expect(b.x + b.w, b.id).toBeLessThan(SYSTEM_MAP_SIZE.width)
      expect(b.y + b.h, b.id).toBeLessThan(SYSTEM_MAP_SIZE.height)
    }
    for (const a of SYSTEM_MAP_BLOCKS) {
      for (const b of SYSTEM_MAP_BLOCKS) {
        if (a.id >= b.id) continue
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.id} 與 ${b.id} 重疊`).toBe(true)
      }
    }
  })

  it('連線的拓樸：DTC 在 reference 輸入端（REF → DTC → PD），回授只有 divider（VCO → DIV → PD），共 21 條（含 PLL 輸出）', () => {
    const edges = SYSTEM_MAP_WIRES.map((w) => `${w.from}>${w.to}`).sort()
    expect(edges).toEqual(
      [
        'ref>dtc', 'dtc>pd', 'pd>lf', 'lf>vco', 'vco>out', 'vco>div', 'div>pd',
        'fcw>dsm', 'dsm>res', 'res>gc', 'dsm>div', 'gc>dtc',
        'pd>cmp', 'noise>cmp', 'cmp>gmac', 'res>align', 'align>gmac', 'gmac>scale', 'scale>acc', 'acc>qnt', 'qnt>gc',
      ].sort(),
    )
    // DTC 不在回授路徑上：divider 直接進 PD，沒有任何線從 divider 接到 DTC
    expect(edges).not.toContain('div>dtc')
    expect(edges).not.toContain('ref>pd')
    // DTC 的兩個輸入：reference（左）與 gain correction 的 code（下）；輸出只到 PD
    expect(SYSTEM_MAP_WIRES.filter((w) => w.to === 'dtc').map((w) => w.from).sort()).toEqual(['gc', 'ref'])
    expect(SYSTEM_MAP_WIRES.filter((w) => w.from === 'dtc').map((w) => w.to)).toEqual(['pd'])
    const labels = Object.fromEntries(SYSTEM_MAP_WIRES.filter((w) => w.label).map((w) => [`${w.from}>${w.to}`, w.label]))
    expect(labels['qnt>gc']).toBe('$w$')
    expect(labels['res>align']).toBe('$x[n]$')
    expect(labels['cmp>gmac']).toBe('$q[n]$')
  })

  it('LMS 的輸入取自 PD 的輸出：分接點在 PD → loop filter 那條線上，用成對的標籤接到 comparator（只有這一條是虛線）', () => {
    expect(SYSTEM_MAP_WIRES.filter((w) => w.dashed).map((w) => `${w.from}>${w.to}`)).toEqual(['pd>cmp'])
    const e = SYSTEM_MAP_WIRES.find((w) => w.from === 'pd' && w.to === 'cmp')!
    expect(e.tag).toBeTruthy()
    expect(e.tag!.tapOn).toEqual(['pd', 'lf'])
    // 分接點落在 PD → loop filter 的線段內部
    const main = SYSTEM_MAP_WIRES.find((w) => w.from === 'pd' && w.to === 'lf')!
    const [[x1, y1], [x2, y2]] = main.points
    const [tx, ty] = e.tag!.tap[0]
    expect(y1).toBe(y2)
    expect(ty).toBe(y1)
    expect(tx).toBeGreaterThan(Math.min(x1, x2))
    expect(tx).toBeLessThan(Math.max(x1, x2))
    // 兩個標籤都寫了 e[n]，來源那個說明去處、目的那個說明來源
    expect(e.tag!.source.text).toContain('$e[n]$')
    expect(e.tag!.source.text).toContain('PD 輸出')
    expect(e.tag!.source.text).toContain('LMS')
    expect(e.tag!.dest.text).toContain('$e[n]$')
    expect(e.tag!.dest.text).toContain('PD 輸出')
    // 來源那一小段接到來源標籤的下緣；目的那一小段從目的標籤的右緣出發、箭頭落在 comparator 的上緣
    const tapEnd = e.tag!.tap[e.tag!.tap.length - 1]
    expect(tapEnd[1]).toBe(e.tag!.source.box.y + e.tag!.source.box.h)
    expect(e.points[0][0]).toBe(e.tag!.dest.box.x + e.tag!.dest.box.w)
    expect(onEdge(byId.cmp, e.points[e.points.length - 1])).toBe(true)
  })

  it('comparator 的輸入只有 PD 的輸出與雜訊；雜訊方塊註明它是「折算到輸入端」的等效雜訊（e[n] 已經包含 v[n]，§2a 第 3 點）', () => {
    expect(SYSTEM_MAP_WIRES.filter((w) => w.to === 'cmp').map((w) => w.from).sort()).toEqual(['noise', 'pd'])
    expect(byId.noise.title).toBe('雜訊 $v[n]$')
    expect(byId.noise.sub).toBe('折算到輸入端')
    expect(byId.cmp.sub).toBe(String.raw`$q[n] = \mathrm{sign}(e[n])$`)
    // 架構約定寫明兩種畫法（系統地圖：comparator 的另一個輸入；章節的圖：PD 後面的加法點）是同一件事
    const convention = readFileSync(resolve(process.cwd(), 'docs/assumptions.md'), 'utf8')
    expect(convention).toContain('雜訊 `v[n]` 是折算到這個節點（comparator 的輸入＝PD 的輸出）的等效雜訊，式子裡的 `e[n]` 已經包含它')
  })

  it('每條線都只走水平或垂直，起點在來源方塊的邊上、箭頭落在目標方塊的邊上', () => {
    for (const w of SYSTEM_MAP_WIRES) {
      const name = `${w.from}>${w.to}`
      for (const pts of allPaths(w)) for (const [[x1, y1], [x2, y2]] of segments(pts)) expect(x1 === x2 || y1 === y2, `${name} 有斜線`).toBe(true)
      // 用標籤接續的線：起點是標籤，不是來源方塊（另一個測試檢查分接點）
      if (!w.tag) expect(onEdge(byId[w.from], w.points[0]), `${name} 起點`).toBe(true)
      if (w.to !== 'out') expect(onEdge(byId[w.to], w.points[w.points.length - 1]), `${name} 終點`).toBe(true)
    }
  })

  it('沒有任何兩條線交叉，也沒有線穿過不相干的方塊', () => {
    const wires = SYSTEM_MAP_WIRES.flatMap((w) => allPaths(w).map((pts, i) => ({ name: `${w.from}>${w.to}#${i}`, tap: i > 0, segs: segments(pts) })))
    for (let i = 0; i < wires.length; i++) {
      for (let j = i + 1; j < wires.length; j++) {
        for (const a of wires[i].segs) for (const b of wires[j].segs) expect(cross(a, b), `${wires[i].name} × ${wires[j].name}`).toBe(false)
      }
    }
    for (const w of SYSTEM_MAP_WIRES) {
      for (const b of SYSTEM_MAP_BLOCKS) {
        for (const pts of allPaths(w)) for (const s of segments(pts)) expect(passesThrough(b, s), `${w.from}>${w.to} 穿過 ${b.id}`).toBe(false)
      }
    }
  })

  it('訊號名稱與成對標籤都不蓋到任何方塊，也都在畫布內', () => {
    const boxes = SYSTEM_MAP_WIRES.flatMap((w) => [
      ...(w.labelBox ? [{ name: `${w.from}>${w.to}`, box: w.labelBox }] : []),
      ...(w.tag ? [{ name: `${w.from}>${w.to} 來源標籤`, box: w.tag.source.box }, { name: `${w.from}>${w.to} 目的標籤`, box: w.tag.dest.box }] : []),
    ])
    expect(boxes).toHaveLength(6)
    for (const { name, box: l } of boxes) {
      expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= SYSTEM_MAP_SIZE.width && l.y + l.h <= SYSTEM_MAP_SIZE.height, name).toBe(true)
      for (const b of SYSTEM_MAP_BLOCKS) {
        const apart = l.x + l.w <= b.x || b.x + b.w <= l.x || l.y + l.h <= b.y || b.y + b.h <= l.y
        expect(apart, `${name} 蓋到 ${b.id}`).toBe(true)
      }
    }
  })

  it('wirePath：直線是 M…L…；轉角用圓弧（Q）帶過，半徑不超過線段的一半', () => {
    expect(wirePath([[0, 0], [10, 0]])).toBe('M0,0 L10,0')
    expect(wirePath([[0, 0], [0, 40], [40, 40]], 10)).toBe('M0,0 L0,30 Q0,40 10,40 L40,40')
    expect(wirePath([[0, 0], [0, 8], [40, 8]], 10)).toBe('M0,0 L0,4 Q0,8 4,8 L40,8')
  })
})

describe('系統地圖：本章主角', () => {
  it('systemMapModel：只有 focus 裡的方塊被標示；重複的只算一次', () => {
    const m = systemMapModel(['cmp', 'cmp', 'gmac'])
    expect(m.blocks.filter((b) => b.focused).map((b) => b.id)).toEqual(['cmp', 'gmac'])
    expect(systemMapModel([]).blocks.some((b) => b.focused)).toBe(false)
    expect(systemMapModel(all).blocks.every((b) => b.focused)).toBe(true)
  })

  it('畫出 17 個方塊與所有連線；被標示的方塊有 is-focus，圖例與圖說跟著出現', () => {
    const { container } = render(<SystemMap focus={['cmp', 'gmac']} />)
    const figure = container.querySelector('figure.c-mermaid.c-sysmap')
    expect(figure).toBeTruthy()
    expect(figure!.getAttribute('aria-label')).toContain('本章重點：1-bit comparator、GMAC')
    expect(figure!.getAttribute('aria-label')).toContain('DTC 在 reference 輸入端')
    const svg = container.querySelector('.c-mermaid-svg svg.c-sysmap-svg')
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${SYSTEM_MAP_SIZE.width} ${SYSTEM_MAP_SIZE.height}`)
    expect(container.querySelectorAll('.c-sysmap-block')).toHaveLength(17)
    expect([...container.querySelectorAll('.c-sysmap-block.is-focus')].map((g) => g.getAttribute('data-block'))).toEqual(['cmp', 'gmac'])
    // 21 條線各一個 path，加上 e[n] 從 PD 輸出分接到標籤的那一小段（兩段虛線＋一個分接點）
    expect(container.querySelectorAll('.c-sysmap-wires > path')).toHaveLength(SYSTEM_MAP_WIRES.length)
    expect(container.querySelectorAll('.c-sysmap-wires path.is-dashed')).toHaveLength(2)
    expect(container.querySelectorAll('.c-sysmap-tap .c-sysmap-junction')).toHaveLength(1)
    const tags = [...container.querySelectorAll('.c-sysmap-wirelabel.is-tag')].map((t) => t.textContent ?? '')
    expect(tags).toHaveLength(2)
    expect(tags[0]).toContain('PD 輸出')
    expect(tags[0]).toContain('LMS')
    expect(tags[1]).toContain('PD 輸出')
    // DTC 排在 reference 與 PD 之間（同一列、由左到右）
    const xOf = (id: string) => Number(container.querySelector(`.c-sysmap-block[data-block="${id}"] rect`)!.getAttribute('x'))
    const yOf = (id: string) => Number(container.querySelector(`.c-sysmap-block[data-block="${id}"] rect`)!.getAttribute('y'))
    expect(xOf('ref')).toBeLessThan(xOf('dtc'))
    expect(xOf('dtc')).toBeLessThan(xOf('pd'))
    expect(yOf('ref')).toBe(yOf('dtc'))
    expect(yOf('dtc')).toBe(yOf('pd'))
    expect(yOf('div')).toBeGreaterThan(yOf('pd'))
    // 方塊與連線上的數學都由 KaTeX 排版
    expect(container.querySelectorAll('.c-sysmap-svg .katex').length).toBeGreaterThanOrEqual(9)
    expect(container.querySelector('.c-sysmap-legend')?.textContent).toContain('本章主角')
    expect(container.querySelector('.c-sysmap-legend')?.textContent).toContain('同名標籤')
    expect(container.querySelector('figcaption')?.textContent).toContain('藍色是本章的主角')
  })

  it('沒有標示任何方塊時：圖例不出現「本章主角」，圖說寫「整個系統」', () => {
    const { container } = render(<SystemMap focus={[]} />)
    expect(container.querySelectorAll('.c-sysmap-block.is-focus')).toHaveLength(0)
    expect(container.querySelector('.c-sysmap-legend')?.textContent).not.toContain('本章主角')
    expect(container.querySelector('figcaption')?.textContent).toContain('整個系統')
  })

  it('可以自訂圖說；「放大」會開啟第二份圖（marker id 不重複），Esc 關閉', () => {
    const { container } = render(<SystemMap focus={['dtc']} caption="自訂圖說 $w$" />)
    expect(container.querySelector('figcaption .katex')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放大檢視這張圖' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelectorAll('.c-sysmap-block')).toHaveLength(17)
    const ids = [...document.querySelectorAll('marker')].map((m) => m.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
