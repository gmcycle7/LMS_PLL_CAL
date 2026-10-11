import type { Dash, Data, Layout } from 'plotly.js-dist-min'
import type { Complex } from '@/simulation/core'

/**
 * Ch08 圖表的小工具：單位圓、極點標記、參考線（以 scatter trace 繪製，避免 log 軸上 shape 座標的歧義）。
 * 只產生 Plotly trace 物件；所有數值都由呼叫端以模型計算後傳入。
 * 圖內文字（trace 名稱、軸標題、hover）的數學一律寫 `$...$`（teaching-style §3）；`Plot` 元件會轉成斜體符號與上下標（plotMath.ts）。
 */

export function unitCircleTrace(color: string, name = String.raw`單位圓 $|z| = 1$`): Data {
  const n = 361
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / (n - 1)
    x[i] = Math.cos(t)
    y[i] = Math.sin(t)
  }
  return { x, y, name, mode: 'lines', line: { color, width: 1, dash: 'dot' }, hoverinfo: 'skip' }
}

/** 半徑 R 的圓弧（角度 deg，由 a0 到 a1） */
export function arcTrace(R: number, a0: number, a1: number, color: string, name: string, cx = 0, cy = 0): Data {
  const n = 121
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180
    x[i] = cx + R * Math.cos(t)
    y[i] = cy + R * Math.sin(t)
  }
  return { x, y, name, mode: 'lines', line: { color, width: 1.5, dash: 'dash' } }
}

export function poleTrace(
  roots: Complex[],
  name: string,
  color: string,
  symbol: string = 'x',
  size = 11,
  extraHover = '',
): Data {
  return {
    x: roots.map((z) => z.re),
    y: roots.map((z) => z.im),
    name,
    mode: 'markers',
    marker: { color, symbol, size, line: { width: 2, color } },
    hovertemplate: `${name}<br>$z$ = %{x:.4f} %{y:+.4f}$j$${extraHover}<extra></extra>`,
  }
}

/** 水平參考線（兩點 scatter） */
export function hLine(y: number, x0: number, x1: number, color: string, name: string, dash: Dash = 'dash'): Data {
  return { x: [x0, x1], y: [y, y], name, mode: 'lines', line: { color, width: 1, dash }, hoverinfo: 'skip' }
}

/** 垂直參考線 */
export function vLine(x: number, y0: number, y1: number, color: string, name: string, dash: Dash = 'dot'): Data {
  return { x: [x, x], y: [y0, y1], name, mode: 'lines', line: { color, width: 1, dash }, hoverinfo: 'skip' }
}

/** z 平面的等比例座標軸 */
export function zPlaneLayout(range = 1.6): Partial<Layout> {
  return {
    xaxis: { title: { text: String.raw`$\mathrm{Re}\,z$` }, range: [-range, range], zeroline: true },
    yaxis: { title: { text: String.raw`$\mathrm{Im}\,z$` }, range: [-range, range], scaleanchor: 'x', scaleratio: 1, zeroline: true },
  }
}

/** 0..n 的整數索引 */
export function indexArray(n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = i
  return out
}

/** '#rrggbb' → 'rgba(r,g,b,a)'（Plotly 無法讀 CSS 變數，填色需實際色碼）；非 hex 時原樣回傳 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim())
  if (!m) return color
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
}
