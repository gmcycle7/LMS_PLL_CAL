/**
 * MIMO LMS Lab 的圖表資料產生器（純函式；所有點都來自模擬或解析結果）。
 */
import type { Data } from 'plotly.js-dist-min'
import type { Complex } from '@/simulation/core'
import { RULE_SHORT, type Mat, type MimoCovResult, type MimoTrajCase, type RuleAnalysis, type RuleConfig } from '@/simulation/models/mimo'
import { ellipsePoints } from './labState'

export interface PlotTokens {
  series: string[]
  text: string
  textMuted: string
  border: string
}

const DASHES = ['solid', 'dot', 'dashdot'] as const

/** 抽稀：最多 maxPts 個點（保留最後一點） */
export function decimateIdx(len: number, maxPts = 2500, upto = len - 1): number[] {
  const last = Math.min(upto, len - 1)
  const stride = Math.max(1, Math.ceil((last + 1) / maxPts))
  const idx: number[] = []
  for (let k = 0; k <= last; k += stride) idx.push(k)
  if (idx[idx.length - 1] !== last) idx.push(last)
  return idx
}

function pick(arr: ArrayLike<number>, idx: number[]): (number | null)[] {
  return idx.map((k) => {
    const v = arr[k]
    return Number.isFinite(v) ? v : null
  })
}

export function caseName(id: string, cfg: RuleConfig): string {
  return `Case ${id}：${RULE_SHORT[cfg.rule]}`
}

/** δ_{k,i} 時域軌跡（MC 路徑實線、解析平均虛線、active case 的 ±2σ 帶） */
export function trajectoryTraces(
  traj: MimoTrajCase[],
  ids: string[],
  cfgs: RuleConfig[],
  P: number,
  tokens: PlotTokens,
  activeIdx: number,
  kView: number | null,
  showMeanField: boolean,
): Data[] {
  const out: Data[] = []
  traj.forEach((c, ci) => {
    if (!c.ok || c.delta.length === 0) return
    const color = tokens.series[ci % tokens.series.length]
    const len = c.delta[0].length
    const idx = decimateIdx(len, 2000, kView ?? len - 1)
    // 以資料實際的維度為準（防呆：呼叫端的 P 與結果不同步時不可越界）
    const nP = Math.min(P, c.delta.length, c.meanAnalytic?.length ?? P, c.stdAnalytic?.length ?? P, c.meanField?.length ?? P)
    if (ci === activeIdx && c.meanAnalytic && c.stdAnalytic) {
      for (let i = 0; i < nP; i++) {
        const lo = idx.map((k) => {
          const v = c.meanAnalytic![i][k] - 2 * c.stdAnalytic![i][k]
          return Number.isFinite(v) ? v : null
        })
        const hi = idx.map((k) => {
          const v = c.meanAnalytic![i][k] + 2 * c.stdAnalytic![i][k]
          return Number.isFinite(v) ? v : null
        })
        out.push({ x: idx, y: lo, mode: 'lines', line: { width: 0, color }, hoverinfo: 'skip', showlegend: false, name: `±2σ δ${i + 1}` })
        out.push({
          x: idx,
          y: hi,
          mode: 'lines',
          line: { width: 0, color },
          fill: 'tonexty',
          fillcolor: hexAlpha(color, 0.15),
          hoverinfo: 'skip',
          name: i === 0 ? `Case ${ids[ci]} 解析 ±2σ` : `±2σ δ${i + 1}`,
          showlegend: i === 0,
        })
      }
    }
    for (let i = 0; i < nP; i++) {
      out.push({
        x: idx,
        y: pick(c.delta[i], idx),
        mode: 'lines',
        name: `${caseName(ids[ci], cfgs[ci])} δ${i + 1}`,
        line: { color, width: 1.6, dash: DASHES[i % DASHES.length] },
      })
      if (c.meanAnalytic) {
        out.push({
          x: idx,
          y: pick(c.meanAnalytic[i], idx),
          mode: 'lines',
          name: `Case ${ids[ci]} E[δ${i + 1}]（線性解析）`,
          line: { color, width: 1, dash: 'dash' },
          opacity: 0.8,
          showlegend: i === 0,
        })
      }
      if (showMeanField && c.meanField) {
        out.push({
          x: idx,
          y: pick(c.meanField[i], idx),
          mode: 'lines',
          name: `Case ${ids[ci]} mean-field δ${i + 1}（精確 erf 增益）`,
          line: { color, width: 1, dash: 'longdashdot' },
          opacity: 0.7,
          showlegend: i === 0,
        })
      }
    }
  })
  return out
}

/** ‖δ_k‖（log）——全部六種規則同 seed */
export function normTraces(traj: MimoTrajCase[], tokens: PlotTokens, kView: number | null): Data[] {
  return traj
    .map((c, i): Data | null => {
      if (!c.ok || c.norm.length === 0) return null
      const idx = decimateIdx(c.norm.length, 2000, kView ?? c.norm.length - 1)
      return {
        x: idx,
        y: idx.map((k) => (Number.isFinite(c.norm[k]) && c.norm[k] > 0 ? c.norm[k] : null)),
        mode: 'lines',
        name: RULE_SHORT[c.rule] + (c.diverged ? '（發散）' : ''),
        line: { color: tokens.series[i % tokens.series.length], width: 1.5 },
      }
    })
    .filter((d): d is Data => d !== null)
}

function hexAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

/** 單位圓 + 各 case 的 poles（eig(I + MJ)） */
export function poleTraces(analyses: (RuleAnalysis | null)[], ids: string[], tokens: PlotTokens): Data[] {
  const th = Array.from({ length: 181 }, (_, i) => (2 * Math.PI * i) / 180)
  const out: Data[] = [
    { x: th.map(Math.cos), y: th.map(Math.sin), mode: 'lines', name: '單位圓 |z| = 1', line: { color: tokens.textMuted, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
  ]
  analyses.forEach((a, i) => {
    if (!a || !a.ok) return
    const poles: Complex[] = a.poles
    out.push({
      x: poles.map((z) => z.re),
      y: poles.map((z) => z.im),
      mode: 'markers',
      name: `Case ${ids[i]}：${RULE_SHORT[a.rule]}${a.rule === 'sequential' ? '（sweep Φ）' : ''}`,
      marker: { size: 11 - i * 2, color: tokens.series[i % tokens.series.length], symbol: ['x', 'circle-open', 'diamond-open'][i % 3], line: { width: 2 } },
    })
  })
  return out
}

/** 相平面 (δ₁, δ₂)：平均更新方向場 + 各 case 軌跡 + 解析 95% 共變異橢圓 */
export function phasePlaneTraces(opts: {
  traj: MimoTrajCase[]
  analyses: (RuleAnalysis | null)[]
  ids: string[]
  tokens: PlotTokens
  /** active case 在 (δ₁,δ₂) 平面的平均更新矩陣 (A − I) 的左上 2×2 */
  field: Mat | null
  L: number
  kView: number | null
  /** sequential case 的排程結束 block（P·sweeps·K）；其他規則 null */
  scheduleEnd?: (number | null)[]
}): Data[] {
  const { traj, analyses, ids, tokens, field, L, kView, scheduleEnd } = opts
  const out: Data[] = []
  if (field) {
    const n = 13
    const cell = (2 * L) / (n - 1)
    let maxMag = 0
    const pts: { x: number; y: number; dx: number; dy: number }[] = []
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const x = -L + a * cell
        const y = -L + b * cell
        const dx = field[0][0] * x + field[0][1] * y
        const dy = field[1][0] * x + field[1][1] * y
        const m = Math.hypot(dx, dy)
        if (Number.isFinite(m)) maxMag = Math.max(maxMag, m)
        pts.push({ x, y, dx, dy })
      }
    }
    const xs: (number | null)[] = []
    const ys: (number | null)[] = []
    if (maxMag > 0) {
      for (const p of pts) {
        const m = Math.hypot(p.dx, p.dy)
        if (!(m > 0)) continue
        const len = 0.85 * cell * Math.sqrt(m / maxMag)
        const ux = p.dx / m
        const uy = p.dy / m
        const tx = p.x + len * ux
        const ty = p.y + len * uy
        const h = Math.min(0.35 * len, 0.3 * cell)
        const c = Math.cos(0.45)
        const s = Math.sin(0.45)
        xs.push(p.x, tx, null, tx, tx - h * (c * ux - s * uy), null, tx, tx - h * (c * ux + s * uy), null)
        ys.push(p.y, ty, null, ty, ty - h * (s * ux + c * uy), null, ty, ty - h * (-s * ux + c * uy), null)
      }
    }
    out.push({ x: xs, y: ys, mode: 'lines', name: '平均更新方向 −MG（active case）', line: { color: tokens.textMuted, width: 1 }, hoverinfo: 'skip' })
  }
  traj.forEach((c, i) => {
    if (!c.ok || c.delta.length < 2) return
    const idx = decimateIdx(c.delta[0].length, 1500, kView ?? c.delta[0].length - 1)
    out.push({
      x: pick(c.delta[0], idx),
      y: pick(c.delta[1], idx),
      mode: 'lines',
      name: `Case ${ids[i]} 軌跡`,
      line: { color: tokens.series[i % tokens.series.length], width: 1.4 },
    })
    const k = idx[idx.length - 1]
    out.push({
      x: [c.delta[0][k]],
      y: [c.delta[1][k]],
      mode: 'markers',
      name: `Case ${ids[i]} 目前 k = ${k}`,
      marker: { color: tokens.series[i % tokens.series.length], size: 8, line: { width: 1, color: tokens.text } },
      showlegend: false,
    })
  })
  analyses.forEach((a, i) => {
    if (!a || !a.ok || !a.cov) return
    let cx = 0
    let cy = 0
    if (a.covKind === 'final') {
      // sequential：共變異是排程結束時的值，中心是那時的平均；只有軌跡涵蓋整個排程才畫得出中心
      const c = traj[i]
      const end = scheduleEnd?.[i] ?? null
      if (!c?.meanAnalytic || end === null || end > c.meanAnalytic[0].length - 1) return
      cx = c.meanAnalytic[0][end]
      cy = c.meanAnalytic[1][end]
    }
    const e = shiftPts(
      ellipsePoints([
        [a.cov[0][0], a.cov[0][1]],
        [a.cov[1][0], a.cov[1][1]],
      ]),
      cx,
      cy,
    )
    out.push({
      x: e.x,
      y: e.y,
      mode: 'lines',
      name: a.covKind === 'final' ? `Case ${ids[i]} 排程結束 95% 橢圓（解析）` : `Case ${ids[i]} 穩態 95% 橢圓（解析）`,
      line: { color: tokens.series[i % tokens.series.length], width: 1, dash: 'dot' },
    })
  })
  out.push({ x: [0], y: [0], mode: 'markers', name: 'δ = 0（w = a）', marker: { symbol: 'cross', size: 10, color: tokens.text } })
  return out
}

/** MC 穩態 δ 樣本 + 解析 / MC 95% 橢圓 */
export function mcTraces(mc: MimoCovResult, tokens: PlotTokens, color: string): Data[] {
  const out: Data[] = []
  if (mc.scatter.length >= 2) {
    out.push({
      x: Array.from(mc.scatter[0]),
      y: Array.from(mc.scatter[1]),
      mode: 'markers',
      name: `MC 樣本（${mc.kind === 'final' ? '排程結束時' : '穩態'}）`,
      marker: { size: 3, color, opacity: 0.45 },
    })
  }
  const sub = (A: Mat) => [
    [A[0][0], A[0][1]],
    [A[1][0], A[1][1]],
  ]
  // stationary：理論中心 0；sequential（final）：MC 橢圓以樣本平均為中心、解析橢圓以 Φ_total δ₀ 為中心
  const final = mc.kind === 'final'
  if (mc.cov.length >= 2) {
    const c = final && mc.mean.length >= 2 ? mc.mean : [0, 0]
    const e = shiftPts(ellipsePoints(sub(mc.cov)), c[0], c[1])
    out.push({ x: e.x, y: e.y, mode: 'lines', name: final ? 'MC 95% 橢圓（以樣本平均為中心）' : 'MC 95% 橢圓', line: { color, width: 2 } })
  }
  if (mc.covAnalytic) {
    const c = final && mc.meanAnalytic && mc.meanAnalytic.length >= 2 ? mc.meanAnalytic : [0, 0]
    const e = shiftPts(ellipsePoints(sub(mc.covAnalytic)), c[0], c[1])
    out.push({
      x: e.x,
      y: e.y,
      mode: 'lines',
      name: final ? '解析 95% 橢圓（協方差傳遞，中心 = 解析平均）' : '解析 95% 橢圓（Lyapunov）',
      line: { color: tokens.text, width: 1.5, dash: 'dash' },
    })
  }
  return out
}

/** 把點列平移到 (cx, cy) */
export function shiftPts(e: { x: number[]; y: number[] }, cx: number, cy: number): { x: number[]; y: number[] } {
  return { x: e.x.map((v) => v + cx), y: e.y.map((v) => v + cy) }
}
