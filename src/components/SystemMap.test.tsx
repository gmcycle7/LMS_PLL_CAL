import { fireEvent, render, screen } from '@testing-library/react'
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
} from './SystemMap'

const all = Object.keys(SYSTEM_BLOCK_LABEL) as SystemBlock[]
const byId = Object.fromEntries(SYSTEM_MAP_BLOCKS.map((b) => [b.id, b])) as Record<SystemBlock, SystemMapBlock>

type Pt = readonly [number, number]
type Seg = readonly [Pt, Pt]
const segments = (pts: ReadonlyArray<Pt>): Seg[] => pts.slice(1).map((p, i) => [pts[i], p] as const)

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

  it('連線的拓樸和規格 §4 的概念架構一致（22 條，含 PLL 輸出）', () => {
    const edges = SYSTEM_MAP_WIRES.map((w) => `${w.from}>${w.to}`).sort()
    expect(edges).toEqual(
      [
        'ref>pd', 'pd>lf', 'lf>vco', 'vco>out', 'vco>div', 'div>dtc', 'dtc>pd',
        'fcw>dsm', 'dsm>res', 'res>gc', 'dsm>div', 'gc>dtc',
        'pd>cmp', 'noise>cmp', 'cmp>gmac', 'res>align', 'align>gmac', 'gmac>scale', 'scale>acc', 'acc>qnt', 'qnt>gc',
      ].sort(),
    )
    // 只有 phase error 是虛線（觀測），而且有標訊號名
    expect(SYSTEM_MAP_WIRES.filter((w) => w.dashed).map((w) => `${w.from}>${w.to}`)).toEqual(['pd>cmp'])
    const labels = Object.fromEntries(SYSTEM_MAP_WIRES.filter((w) => w.label).map((w) => [`${w.from}>${w.to}`, w.label]))
    expect(labels['pd>cmp']).toContain('$e[n]$')
    expect(labels['qnt>gc']).toBe('$w$')
    expect(labels['res>align']).toBe('$x[n]$')
    expect(labels['cmp>gmac']).toBe('$q[n]$')
  })

  it('每條線都只走水平或垂直，起點在來源方塊的邊上、箭頭落在目標方塊的邊上', () => {
    for (const w of SYSTEM_MAP_WIRES) {
      const name = `${w.from}>${w.to}`
      for (const [[x1, y1], [x2, y2]] of segments(w.points)) expect(x1 === x2 || y1 === y2, `${name} 有斜線`).toBe(true)
      expect(onEdge(byId[w.from], w.points[0]), `${name} 起點`).toBe(true)
      if (w.to !== 'out') expect(onEdge(byId[w.to], w.points[w.points.length - 1]), `${name} 終點`).toBe(true)
    }
  })

  it('沒有任何兩條線交叉，也沒有線穿過不相干的方塊', () => {
    const wires = SYSTEM_MAP_WIRES.map((w) => ({ name: `${w.from}>${w.to}`, segs: segments(w.points) }))
    for (let i = 0; i < wires.length; i++) {
      for (let j = i + 1; j < wires.length; j++) {
        for (const a of wires[i].segs) for (const b of wires[j].segs) expect(cross(a, b), `${wires[i].name} × ${wires[j].name}`).toBe(false)
      }
    }
    for (const w of SYSTEM_MAP_WIRES) {
      for (const b of SYSTEM_MAP_BLOCKS) {
        for (const s of segments(w.points)) expect(passesThrough(b, s), `${w.from}>${w.to} 穿過 ${b.id}`).toBe(false)
      }
    }
  })

  it('訊號名稱的標籤不蓋到任何方塊，也都在畫布內', () => {
    for (const w of SYSTEM_MAP_WIRES) {
      if (!w.labelBox) continue
      const l = w.labelBox
      expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= SYSTEM_MAP_SIZE.width && l.y + l.h <= SYSTEM_MAP_SIZE.height, `${w.from}>${w.to}`).toBe(true)
      for (const b of SYSTEM_MAP_BLOCKS) {
        const apart = l.x + l.w <= b.x || b.x + b.w <= l.x || l.y + l.h <= b.y || b.y + b.h <= l.y
        expect(apart, `${w.from}>${w.to} 的標籤蓋到 ${b.id}`).toBe(true)
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
    const svg = container.querySelector('.c-mermaid-svg svg.c-sysmap-svg')
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${SYSTEM_MAP_SIZE.width} ${SYSTEM_MAP_SIZE.height}`)
    expect(container.querySelectorAll('.c-sysmap-block')).toHaveLength(17)
    expect([...container.querySelectorAll('.c-sysmap-block.is-focus')].map((g) => g.getAttribute('data-block'))).toEqual(['cmp', 'gmac'])
    expect(container.querySelectorAll('.c-sysmap-wires path')).toHaveLength(SYSTEM_MAP_WIRES.length)
    expect(container.querySelectorAll('.c-sysmap-wires path.is-dashed')).toHaveLength(1)
    // 方塊與連線上的數學都由 KaTeX 排版
    expect(container.querySelectorAll('.c-sysmap-svg .katex').length).toBeGreaterThanOrEqual(9)
    expect(container.querySelector('.c-sysmap-legend')?.textContent).toContain('本章主角')
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
