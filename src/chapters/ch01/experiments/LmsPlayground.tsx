import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { CaseSelector, ExperimentShell, ParamControl, Plot, Tex, useCases, useThemeTokens, type CheckEntry, type ExperimentPreset, type MetricRow, ChapterErratum } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import {
  exactLmsTrace,
  fixedXStability,
  fracToString,
  playgroundClosedForm,
  playgroundEnsemble,
  playgroundTrace,
  playgroundVarW,
  playgroundVarWStationary,
  type Frac,
  type PlaygroundEnsembleResult,
  type PlaygroundTrace,
} from '@/simulation/models/lossCompare'
import { BEHAVIOUR_TEX, BehaviourLabel, f, symLabel, texNum, TryIt } from '../common'

export const PLAYGROUND_ID = 'lms-playground'

export interface PlaygroundUiParams {
  a: number
  w0: number
  x: number
  mu: number
  steps: number
  noiseSigma: number
}

export const PLAYGROUND_DEFAULTS: PlaygroundUiParams = { a: 3, w0: 1, x: 2, mu: 0.1, steps: 20, noiseSigma: 0 }
const DEFAULT_SEED = 20261010
const ENSEMBLE_PATHS = 400
const KEYS: (keyof PlaygroundUiParams)[] = ['a', 'w0', 'x', 'mu', 'steps', 'noiseSigma']
/** 入門課 Lesson 1 的三個 μ：慢 / 穩 / 發散（x = 2 時 p = 0.92 / 0.6 / −1.6） */
const LESSON_MUS = [0.02, 0.1, 0.65] as const
const CASE_ORDER = ['A', 'B', 'C'] as const
/** 精確有理數只算前 EXACT_STEPS 步（分母每步乘上 μ·x² 的分母，位數線性成長）；超過 EXACT_MAX_CHARS 個字元不顯示 */
const EXACT_STEPS = 24
const EXACT_MAX_CHARS = 30
/** T01（a=3, w₀=1, x=2, μ=0.1）的 w₂ 在 IEEE double 下實際印出的字串（即時計算，不手寫） */
const T01_W2_DOUBLE = String(playgroundTrace({ a: 3, w0: 1, x: 2, mu: 0.1, steps: 2, noiseSigma: 0, seed: 1 }).w[2])

/** 從 preset / 匯入的參數中挑出合法的數值欄位 */
export function sanitizePlaygroundParams(p: Record<string, unknown>): Partial<PlaygroundUiParams> {
  const out: Partial<PlaygroundUiParams> = {}
  for (const k of KEYS) {
    const v = p[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = k === 'steps' ? Math.max(1, Math.min(400, Math.round(v))) : v
  }
  return out
}

/** 依參數產生「解釋原因」的警告（規格 §19：不可只寫無法計算） */
export function playgroundWarnings(p: PlaygroundUiParams, divergedAt: number | null): string[] {
  const w: string[] = []
  const st = fixedXStability(p.mu, p.x)
  if (p.x === 0) {
    w.push(
      String.raw`$x=0$：沒有 excitation——$e_n=y_n$ 與 $w$ 無關，梯度 $-e\,x=0$，$w$ 永遠停在 $w_0$；$a$ 不可辨識（$E[x^2]=0$，相當於 $\lambda_{\min}=0$）。$\mu_{\max}=\infty$ 只代表「不會發散」，不代表學得到 $a$。`,
    )
  } else if (p.mu < 0) {
    w.push(String.raw`$\mu<0$：更新極性錯誤——沿著梯度「上坡」走，$p=1-\mu x^2=${texNum(st.pole, 6)}>1$，$|\delta_n|$ 單調變大（$\delta_n=p^n\delta_0$ 不變號）。`)
  } else if (p.mu === 0) {
    w.push(String.raw`$\mu=0$：$p=1$，$w$ 不更新（等同 Freeze），$\delta_n$ 永遠等於 $\delta_0$。`)
  } else if (Math.abs(st.pole + 1) < 1e-12) {
    w.push(String.raw`$\mu=2/x^2=${texNum(st.muMax, 6)}$：$p=-1$ 是穩定邊界——$|\delta_n|$ 不變、每步正負交替，不會收斂到 $a$。`)
  } else if (Math.abs(st.pole) > 1) {
    w.push(
      String.raw`$|p|=|1-\mu x^2|=${texNum(Math.abs(st.pole), 6)}>1$：$\mu=${texNum(p.mu, 6)}$ 超過固定 $x$ 的穩定上限 $2/x^2=${texNum(st.muMax, 6)}$，$|\delta_n|=|p|^n|\delta_0|$ 每步放大（$p<-1$ 時正負交替地放大）。`,
    )
  }
  if (divergedAt !== null) w.push(String.raw`第 ${divergedAt} 步 $|w|>10^{12}$：判定發散並停止模擬（之後的點不畫）。`)
  return w
}

/** 負數加括號，避免 TeX 出現「×−3」 */
const texArg = (v: number, digits = 6) => (v < 0 ? `(${texNum(v, digits)})` : texNum(v, digits))

/** 規格 §1.2「同步顯示資料流、誤差、更新公式與逐步數值」：目前這一步的 ①預測 → ②比較 → ③修正（數字全部來自 tr）。 */
function DataFlowStrip({ tr, n, N, x, mu, frozen }: { tr: PlaygroundTrace; n: number; N: number; x: number; mu: number; frozen: boolean }) {
  if (n >= N || !Number.isFinite(tr.w[n + 1])) {
    return <p className="small muted">已到最後一步（或已發散）：按「重設」或拖曳游標回到前面的步驟。</p>
  }
  const yHat = tr.w[n] * x
  const muEff = frozen ? 0 : mu
  return (
    <div className="ch01-flow" aria-label={`第 ${n} 步的資料流`}>
      <span className="ch01-flow-box">
        ① 預測 <Tex>{String.raw`\hat y_{${n}}=w_{${n}}x=${texArg(tr.w[n])}\times${texArg(x)}=${texNum(yHat, 6)}`}</Tex>
      </span>
      <span className="ch01-flow-arrow">→</span>
      <span className="ch01-flow-box">
        ② 比較 <Tex>{String.raw`e_{${n}}=y_{${n}}-\hat y_{${n}}=${texArg(tr.y[n])}-${texArg(yHat)}=${texNum(tr.e[n], 6)}`}</Tex>
      </span>
      <span className="ch01-flow-arrow">→</span>
      <span className="ch01-flow-box">
        ③ 修正 <Tex>{String.raw`\Delta w=${frozen ? '\\mu_{\\text{eff}}' : '\\mu'}\,e_{${n}}\,x=${texArg(muEff)}\times${texArg(tr.e[n])}\times${texArg(x)}=${texNum(tr.dw[n], 6)}`}</Tex>
      </span>
      <span className="ch01-flow-arrow">→</span>
      <span className="ch01-flow-box">
        <Tex>{String.raw`w_{${n + 1}}=${texNum(tr.w[n + 1], 8)}`}</Tex>
      </span>
    </div>
  )
}

function toPresetList(): ExperimentPreset[] {
  return presetsForExperiment(PLAYGROUND_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description }))
}

/** 遞迴 vs 封閉解（F-01.8）：雜訊時以同參數的無雜訊遞迴比較 */
function playgroundAnalyticCheck(
  params: PlaygroundUiParams,
  seed: number,
  tr: PlaygroundTrace,
  freezeAt: number | null,
): CheckEntry {
  // Freeze：從 freezeAt 起 μ_eff = 0，所以封閉解變成 w_n = a − (a − w₀)·p^{min(n, freezeAt)}
  const clean = params.noiseSigma > 0 ? playgroundTrace({ ...params, noiseSigma: 0, seed, freezeAt }) : tr
  let maxErr = 0
  let scale = 1
  for (let n = 0; n <= params.steps; n++) {
    const cf = playgroundClosedForm(params.a, params.w0, params.x, params.mu, freezeAt === null ? n : Math.min(n, freezeAt))
    if (!Number.isFinite(clean.w[n]) || !Number.isFinite(cf)) break
    scale = Math.max(scale, Math.abs(cf))
    maxErr = Math.max(maxErr, Math.abs(clean.w[n] - cf))
  }
  const ok = maxErr <= 1e-9 * scale
  const tag = params.noiseSigma > 0 ? '（同參數的無雜訊遞迴）' : ''
  const fz = freezeAt === null ? '' : `；Freeze 自 $n=${freezeAt}$`
  return { status: ok ? 'ok' : 'mismatch', note: String.raw`遞迴${tag} vs 封閉解：$\max_n|\Delta w_n|=${texNum(maxErr, 3)}$${fz}` }
}

/** Monte Carlo：R 條路徑的 Var(w_N) vs 精確式 F-01.9（4·SE） */
function playgroundMcCheck(sigma: number, stable: boolean, ens: PlaygroundEnsembleResult | null, varAna: number, frozen: boolean): CheckEntry {
  if (sigma === 0) return { status: 'n/a', note: '無雜訊：沒有隨機性' }
  if (!stable) return { status: 'n/a', note: String.raw`$|p|\ge1$：$\operatorname{Var}(w_n)$ 隨 $n$ 無界成長，沒有可比對的穩態` }
  if (!ens) return { status: 'n/a', note: 'Monte Carlo 計算中（參數剛變更）' }
  if (ens.diverged) return { status: 'n/a', note: '有路徑數值發散：統計量無意義' }
  const note = String.raw`$\operatorname{Var}(w_N)$：MC ${f(ens.varW, 4)} vs 解析 ${f(varAna, 4)}（容忍 $4\,\mathrm{SE}$${frozen ? '；比對的是未凍結的遞迴' : ''}）`
  return { status: Math.abs(ens.varW - varAna) <= 4 * ens.seVar ? 'ok' : 'mismatch', note }
}

function playgroundMetrics(
  params: PlaygroundUiParams,
  tr: PlaygroundTrace,
  cur: number,
  freezeAt: number | null,
  ens: PlaygroundEnsembleResult | null,
  varAna: number,
): MetricRow[] {
  const st = fixedXStability(params.mu, params.x)
  const N = params.steps
  // freeze 從第 freezeAt 步才生效，所以 w₁、w₂ 只有在 freezeAt ≥ 1、≥ 2 時才仍等於封閉解
  const cleanAt = (n: number) => params.noiseSigma === 0 && (freezeAt === null || freezeAt >= n)
  const isT01 = params.a === 3 && params.w0 === 1 && params.x === 2 && params.mu === 0.1 && params.noiseSigma === 0
  const rows: MetricRow[] = [
    {
      name: '$w_1$',
      value: N >= 1 ? tr.w[1] : null,
      analytic: playgroundClosedForm(params.a, params.w0, params.x, params.mu, 1),
      tolerance: cleanAt(1) ? 1e-12 : undefined,
      formulaId: 'F-01.8',
      claim: 'exact',
      digits: 10,
      note: isT01
        ? String.raw`T01：$a=3,\ w_0=1,\ x=2,\ \mu=0.1\ \Rightarrow\ w_1=1.8$（精確 $\tfrac95$）`
        : params.noiseSigma > 0
          ? '有雜訊時與無雜訊封閉解的差 = 雜訊造成（不設容忍度）'
          : String.raw`封閉解 $a-(a-w_0)\,p$`,
    },
    {
      name: '$w_2$',
      value: N >= 2 ? tr.w[2] : null,
      analytic: playgroundClosedForm(params.a, params.w0, params.x, params.mu, 2),
      tolerance: cleanAt(2) ? 1e-12 : undefined,
      formulaId: 'F-01.8',
      claim: 'exact',
      digits: 10,
      note: isT01 ? String.raw`T01 $\Rightarrow\ w_2=2.28$（精確 $\tfrac{57}{25}$；IEEE double 為 ${String(tr.w[2])}）` : String.raw`封閉解 $a-(a-w_0)\,p^2$`,
    },
    { name: String.raw`pole $p=1-\mu x^2$`, value: st.pole, formulaId: 'F-01.8', claim: 'exact', digits: 8 },
    { name: '穩定上限 $2/x^2$（T02）', value: Number.isFinite(st.muMax) ? st.muMax : '∞（輸入為 0：不可辨識）', claim: 'exact', digits: 8 },
    { name: '行為', value: BEHAVIOUR_TEX[st.behaviour][1], note: `$${BEHAVIOUR_TEX[st.behaviour][0]}$` },
    { name: `$w_{${cur}}$（目前步）`, value: tr.w[cur], digits: 8 },
  ]
  if (params.noiseSigma > 0) {
    const okEns = ens !== null && !ens.diverged
    rows.push({
      name: String.raw`$\operatorname{Var}(w_N)$，$N=${ens ? ens.n : N}$（MC，${ENSEMBLE_PATHS} 條路徑）`,
      value: okEns ? ens.varW : null,
      analytic: varAna,
      tolerance: okEns ? 4 * ens.seVar : undefined,
      formulaId: 'F-01.9',
      claim: 'exact',
      note: okEns ? String.raw`容忍度 $=4\,\mathrm{SE}$，$\mathrm{SE}=\operatorname{Var}\cdot\sqrt{2/(R-1)}$（$w_N$ 是 Gaussian，$R$ 為路徑數）` : '不穩定或計算中：不比對',
    })
    rows.push({
      name: String.raw`穩態 $\operatorname{Var}(w)=\mu\sigma_v^2/(2-\mu x^2)$`,
      value: st.converges ? playgroundVarWStationary(params.mu, params.x, params.noiseSigma) : '∞（不穩定：沒有穩態）',
      formulaId: 'F-01.9',
      claim: 'exact',
    })
  }
  return rows
}

export function LmsPlayground() {
  const [params, setParams] = useState<PlaygroundUiParams>(PLAYGROUND_DEFAULTS)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [cursor, setCursor] = useState(2)
  const [running, setRunning] = useState(false)
  const [freezeAt, setFreezeAt] = useState<number | null>(null)
  const tokens = useThemeTokens()
  const urlPreset = useUrlPreset(PLAYGROUND_ID)
  const presets = useMemo(toPresetList, [])

  const applyParams = useCallback((raw: Record<string, unknown>) => {
    setParams((prev) => ({ ...prev, ...sanitizePlaygroundParams(raw) }))
    if (typeof raw.seed === 'number' && Number.isFinite(raw.seed)) setSeed(raw.seed >>> 0)
    setCursor(2)
    setRunning(false)
    setFreezeAt(null)
  }, [])

  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  const set = <K extends keyof PlaygroundUiParams>(k: K) => (v: number) => setParams((p) => ({ ...p, [k]: v }))

  const tr = useMemo(() => playgroundTrace({ ...params, seed, freezeAt }), [params, seed, freezeAt])
  const st = fixedXStability(params.mu, params.x)
  const N = params.steps
  const cur = Math.min(cursor, N)

  // 動畫：Run 時每 350 ms 前進一步
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setCursor((c) => Math.min(N, c + 1)), 350)
    return () => window.clearInterval(id)
  }, [running, N])
  useEffect(() => {
    if (running && cur >= N) setRunning(false) // 走到最後一步自動停止
  }, [running, cur, N])

  const runToConvergence = () => {
    setRunning(false)
    if (!st.converges) {
      setCursor(N) // |p| ≥ 1：不會收斂，直接走到最後一步讓警告與發散曲線可見
      return
    }
    const d0 = Math.abs(tr.delta[0])
    // 有雜訊：進入穩態 ±3σ 帶（σ² = μσᵥ²/(2 − μx²)）；無雜訊：|δ| 縮到初值的 10⁻³
    const band = params.noiseSigma > 0 ? 3 * Math.sqrt(playgroundVarWStationary(params.mu, params.x, params.noiseSigma)) : 1e-3 * d0
    let n = N
    for (let k = 0; k <= N; k++) {
      if (Number.isFinite(tr.delta[k]) && Math.abs(tr.delta[k]) <= band) {
        n = k
        break
      }
    }
    setCursor(n)
  }

  // 解析 vs 遞迴（無雜訊的封閉解；雜訊時比較同一參數的無雜訊遞迴）
  const analyticCheck = useMemo(() => playgroundAnalyticCheck(params, seed, tr, freezeAt), [params, seed, tr, freezeAt])

  // Monte Carlo：R 條路徑在第 N 步的 Var(w_N) vs 精確式 F-01.9。
  // 400 × N ≤ 1.6×10⁵ 次更新（< 2×10⁵，主執行緒即可）；用 deferred 參數避免拖動時卡頓，
  // 解析值也用同一組 deferred 參數，比對才不會在更新途中出現假的 mismatch。
  const deferred = useDeferredValue(params)
  const deferredSeed = useDeferredValue(seed)
  const ens = useMemo(
    () =>
      deferred.noiseSigma > 0 && fixedXStability(deferred.mu, deferred.x).converges
        ? playgroundEnsemble({ ...deferred, seed: deferredSeed, paths: ENSEMBLE_PATHS })
        : null,
    [deferred, deferredSeed],
  )
  const varAna = playgroundVarW(deferred.mu, deferred.x, deferred.noiseSigma, deferred.steps)
  const mcCheck = playgroundMcCheck(params.noiseSigma, st.converges, ens, varAna, freezeAt !== null)

  const exact = useMemo(() => {
    if (params.noiseSigma !== 0) return null
    try {
      return exactLmsTrace(params.a, params.w0, params.x, params.mu, Math.min(N, EXACT_STEPS))
    } catch {
      return null
    }
  }, [params, N])

  const warnings = playgroundWarnings(params, tr.divergedAt)

  const metrics = playgroundMetrics(params, tr, cur, freezeAt, ens, varAna)

  // ───── 圖 1：w_n ─────
  const nAxis = useMemo(() => Array.from({ length: N + 1 }, (_, i) => i), [N])
  const wPlot = useMemo<Data[]>(() => {
    const cf = nAxis.map((n) => playgroundClosedForm(params.a, params.w0, params.x, params.mu, n))
    return [
      { x: nAxis, y: Array.from(tr.w), name: '$w_n$（模擬）', mode: 'lines+markers', line: { color: tokens.series[0] } },
      {
        x: nAxis,
        y: cf.map((v) => (Number.isFinite(v) && Math.abs(v) < 1e12 ? v : null)),
        name: String.raw`無雜訊封閉解 $a-(a-w_0)\,p^n$`,
        mode: 'lines',
        line: { dash: 'dot', color: tokens.series[2] },
      },
      { x: [0, N], y: [params.a, params.a], name: '$a$（真值）', mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
      {
        x: [cur],
        y: [tr.w[cur]],
        name: `目前 $n=${cur}$`,
        mode: 'markers',
        marker: { size: 13, color: tokens.series[1], symbol: 'circle-open', line: { width: 3 } },
      },
    ]
  }, [nAxis, tr, params, N, cur, tokens])

  // ───── 圖 2：e_n ─────
  const ePlot = useMemo<Data[]>(
    () => [
      { x: nAxis.slice(0, N), y: Array.from(tr.e), name: '$e_n=y_n-w_n x$', mode: 'lines+markers', line: { color: tokens.series[3] } },
      { x: [0, N], y: [0, 0], name: '0', mode: 'lines', line: { dash: 'dash', color: tokens.textMuted }, showlegend: false },
    ],
    [nAxis, tr, N, tokens],
  )

  // ───── 圖 3：J(w) 拋物線 + 目前點 + 切線 ─────
  const jView = useMemo(() => {
    const J = (w: number) => 0.5 * ((params.a - w) ** 2 * params.x ** 2 + params.noiseSigma ** 2)
    const span = Math.max(Math.abs(params.a - params.w0) * 1.5, 1)
    const path: number[] = []
    for (let n = 0; n <= cur; n++) if (Number.isFinite(tr.w[n]) && Math.abs(tr.w[n] - params.a) <= 6 * span) path.push(tr.w[n])
    const lo = Math.min(params.a - span, ...path) - 0.1 * span
    const hi = Math.max(params.a + span, ...path) + 0.1 * span
    const grid = Array.from({ length: 201 }, (_, i) => lo + ((hi - lo) * i) / 200)
    const wc = tr.w[cur]
    const data: Data[] = [
      { x: grid, y: grid.map(J), name: String.raw`$J(w)=\tfrac12E[(y-wx)^2]$`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: path, y: path.map(J), name: String.raw`$w_0\ldots w_{${cur}}$`, mode: 'lines+markers', line: { color: tokens.series[1], width: 1 }, marker: { size: 7 } },
    ]
    const annotations: Partial<Layout>['annotations'] = []
    if (Number.isFinite(wc) && Math.abs(wc - params.a) <= 6 * span) {
      const slope = -(params.a - wc) * params.x ** 2 // dJ/dw = −(a − w)x² = −E[e·x]
      const half = 0.25 * (hi - lo)
      data.push({
        x: [wc - half, wc + half],
        y: [J(wc) - slope * half, J(wc) + slope * half],
        name: String.raw`切線：斜率 $dJ/dw=${texNum(slope, 4)}$`,
        mode: 'lines',
        line: { dash: 'dot', color: tokens.series[3] },
      })
      data.push({ x: [wc], y: [J(wc)], name: `目前 $w_{${cur}}$`, mode: 'markers', marker: { size: 14, color: tokens.series[1] } })
      const wn = tr.w[cur + 1]
      if (cur < N && Number.isFinite(wn) && Math.abs(wn - params.a) <= 6 * span && wn !== wc) {
        annotations.push({
          x: wn,
          y: J(wn),
          ax: wc,
          ay: J(wc),
          xref: 'x',
          yref: 'y',
          axref: 'x',
          ayref: 'y',
          showarrow: true,
          arrowhead: 3,
          arrowwidth: 2,
          arrowcolor: tokens.series[1],
          text: '',
        })
      }
    }
    return { data, annotations }
  }, [params, tr, cur, N, tokens])

  // ───── A / B / C：不同 μ 的 |δ_n|（log 軸，同 seed） ─────
  const cases = useCases<{ mu: number }>({ mu: 0.02 }, { seed })
  const loadCaseExample = () => {
    // 先補齊 A/B/C 三組，再以函式型 update 各自設定 μ。
    // （不可先 reset：useCases 的 reset 不會同步更新 addCase 讀的內部 ref，接著 addCase 的整包 setState 會蓋掉 reset／update。）
    for (let k = cases.cases.length; k < 3; k++) if (!cases.addCase()) break
    LESSON_MUS.forEach((mu, i) => cases.update({ mu }, CASE_ORDER[i]))
    cases.setActive('A')
  }
  const casePlot = useMemo<Data[]>(
    () =>
      cases.cases.map((c) => {
        const t = playgroundTrace({ ...params, mu: c.params.mu, seed, freezeAt: null })
        const p = fixedXStability(c.params.mu, params.x).pole
        return {
          x: nAxis,
          y: Array.from(t.delta).map((d) => (Number.isFinite(d) ? Math.abs(d) : null)),
          name: String.raw`Case ${c.id}：$\mu=${texNum(c.params.mu, 4)}$（$p=${texNum(p, 4)}$）`,
          mode: 'lines+markers',
          line: { color: tokens.series[c.seriesIndex] },
        }
      }),
    [cases.cases, params, seed, nAxis, tokens],
  )

  // ───── 逐步表 ─────
  const rowEnd = Math.min(Math.max(cur, 1), N) - 1
  const rowStart = Math.max(0, rowEnd - 7)
  const rows = Array.from({ length: Math.max(0, rowEnd - rowStart + 1) }, (_, i) => rowStart + i)
  // 精確分數只模擬「未凍結」的遞迴：凍結後（n > freezeAt）不顯示，避免和實際的 w_n 對不上
  const exactStr = (n: number, fr: Frac | undefined) => {
    if (!fr || (freezeAt !== null && n > freezeAt)) return ''
    const str = fracToString(fr)
    return str.length <= EXACT_MAX_CHARS ? str : '（分數過長）'
  }

  return (
    <ExperimentShell
      id={PLAYGROUND_ID}
      title="LMS Playground：一步一步看 $w_n$ 怎麼走"
      level="L0"
      claim="exact"
      tests={['T01', 'T02']}
      description={
        <>
          固定 <Tex>{'x'}</Tex>、可選零均值雜訊 <Tex>{'v_n'}</Tex> 的純量 LMS。每一步呼叫{' '}
          <code>lms.ts</code> 的 <code>conventionalStep</code>：<Tex>{String.raw`w_{n+1}=w_n+\mu e_nx`}</Tex>。下方的拋物線是 <Tex>{String.raw`J(w)=\tfrac12E[(y-wx)^2]=\tfrac12\big[(a-w)^2x^2+\sigma_v^2\big]`}</Tex>，切線斜率與 LMS
          更新量用同一個 scaling <ChapterErratum id="E41" />。
        </>
      }
      assumptions={[
        '$x$ 固定且已知（非零才可辨識 $a$）',
        String.raw`量測雜訊 $v_n$ iid $\sim\mathcal N(0,\sigma_v^2)$、與 $x$ 獨立；$\sigma_v=0$ 為規格 §1.2 的無雜訊手算例`,
        String.raw`$\delta_n=a-w_n$（全站極性，勘誤 E39）`,
        String.raw`$J(w)$ 含 $\tfrac12$（勘誤 E41）：LMS = 對 $\tfrac12J_2$ 的隨機梯度下降`,
        String.raw`Freeze：從目前步起 $\mu_{\text{eff}}=0$（模擬暫存器 $\texttt{REG\_LMS\_FREEZE}$）`,
      ]}
      params={{ ...params, freezeAt }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '[y]/[x]（例：fs/code）', w0: '[y]/[x]（同 a）', x: '[x]（正規化 code，無因次）', mu: '1/[x]²（此處無因次）', noiseSigma: '[y]', steps: 'samples', freezeAt: 'sample index' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: mcCheck,
        fixedPoint: { status: 'not-implemented', note: String.raw`$\mu$／$w$ 的定點量化在 Ch13` },
      }}
      actions={{
        onReset: () => {
          setRunning(false)
          setCursor(0)
          setFreezeAt(null)
        },
        onStep: () => setCursor((c) => Math.min(N, c + 1)),
        onRun: () => {
          if (cur >= N) setCursor(0)
          setRunning(true)
        },
        onStop: () => setRunning(false),
        onRunToConvergence: runToConvergence,
        onFreeze: () => setFreezeAt((fz) => (fz === null ? cur : null)),
        running,
        frozen: freezeAt !== null,
        // 350 ms 一步的動畫：Run 鈕顯示「第 n/N 步」，「跳到結尾」把游標直接放到最後一步（軌跡 tr 一次算好，和逐步看的是同一份）
        runKind: 'animate',
        progress: { done: cur, total: N },
        onSkipToEnd: () => {
          setRunning(false)
          setCursor(N)
        },
      }}
      exportData={() => ({
        n: nAxis,
        w: tr.w,
        delta_a_minus_w: tr.delta,
        e: tr.e,
        y: tr.y,
        v: tr.v,
        dw: tr.dw,
        w_closed_form_noise_free: nAxis.map((n) => playgroundClosedForm(params.a, params.w0, params.x, params.mu, n)),
      })}
      presets={presets}
      onLoadPreset={(p) => applyParams(p.params)}
      controls={
        <>
          <ParamControl label={symLabel('a', '真實係數')} ariaLabel="a（真實係數）" value={params.a} onChange={set('a')} min={-10} max={10} step={0.01} unit="$[y]/[x]$" reg="Behavioral: true_gain_a" hint="黑盒子裡我們不知道的數" />
          <ParamControl
            label={symLabel('x', '固定輸入')}
            ariaLabel="x（固定輸入）"
            value={params.x}
            onChange={set('x')}
            min={-4}
            max={4}
            step={0.01}
            unit="$[x]$"
            reg="Behavioral: regressor_x（正規化 DSM code）"
            hint={
              <>
                <Tex>{'x=0'}</Tex> 時 <Tex>{'a'}</Tex> 不可辨識（<Tex>{'E[x^2]=0'}</Tex>）
              </>
            }
          />
          <ParamControl label={symLabel('w_0', '初始值')} ariaLabel="w₀（初始值）" value={params.w0} onChange={set('w0')} min={-10} max={10} step={0.01} unit="$[y]/[x]$" reg="REG_LMS_W_INIT" />
          <ParamControl
            label={symLabel('\\mu', '學習率')}
            ariaLabel="μ（學習率）"
            value={params.mu}
            onChange={set('mu')}
            min={-0.05}
            max={1.5}
            step={0.001}
            digits={6}
            unit="$1/[x]^2$"
            reg="REG_LMS_MU"
            hint={
              Number.isFinite(st.muMax) ? (
                <>
                  穩定：<Tex>{String.raw`0<\mu<2/x^2=${texNum(st.muMax, 5)}`}</Tex>；一步到位 <Tex>{String.raw`\mu=1/x^2=${texNum(st.muOneStep, 5)}`}</Tex>
                </>
              ) : (
                <>
                  <Tex>{'x=0'}</Tex>：<Tex>{'\\mu'}</Tex> 無作用
                </>
              )
            }
          />
          <ParamControl label={symLabel('\\sigma_v', '量測雜訊 RMS')} ariaLabel="σᵥ（量測雜訊 RMS）" value={params.noiseSigma} onChange={set('noiseSigma')} min={0} max={5} step={0.01} unit="$[y]$" reg="Behavioral: noise_rms_v" hint="0 = 規格 §1.2 的無雜訊例" />
          <ParamControl
            label={
              <>
                步數 <Tex>{'N'}</Tex>
              </>
            }
            ariaLabel="步數 N"
            value={params.steps} onChange={set('steps')} min={1} max={400} step={1} integer clampOnBlur unit="samples" reg="Behavioral: num_updates" />
        </>
      }
    >
      <div className="ch01-cursor">
        <label htmlFor="ch01-pg-cursor">
          目前步 <Tex>{'n'}</Tex> = {cur}
        </label>
        <input
          id="ch01-pg-cursor"
          type="range"
          min={0}
          max={N}
          step={1}
          value={cur}
          onChange={(e) => {
            setRunning(false)
            setCursor(Number(e.target.value))
          }}
          aria-label="目前步 n"
        />
        <span className="small muted">
          {freezeAt !== null ? `已從 n = ${freezeAt} 凍結` : '用「單步」或拖曳觀察拋物線上的點'}
        </span>
      </div>
      <div className="ch01-stat-row">
        <div className="ch01-stat">
          <div className="ch01-stat-label">
            pole <Tex>{String.raw`p=1-\mu x^2`}</Tex>
          </div>
          <div className="ch01-stat-value">{f(st.pole, 6)}</div>
        </div>
        <div className="ch01-stat">
          <div className="ch01-stat-label">
            <Tex>{String.raw`\delta_{${cur}}=a-w_{${cur}}`}</Tex>
          </div>
          <div className="ch01-stat-value">{f(tr.delta[cur], 6)}</div>
        </div>
        <div className="ch01-stat">
          <div className="ch01-stat-label">行為</div>
          <div className="ch01-stat-value small">
            <BehaviourLabel b={st.behaviour} />
          </div>
        </div>
      </div>
      <DataFlowStrip tr={tr} n={cur} N={N} x={params.x} mu={params.mu} frozen={freezeAt !== null && cur >= freezeAt} />
      <div className="ch01-two">
        <Plot
          title="$w_n$ 隨步數 $n$"
          ariaLabel="w 隨步數 n 的軌跡"
          data={wPlot}
          layout={{ xaxis: { title: { text: '$n$（sample）' } }, yaxis: { title: { text: '$w_n$' } } }}
          height={280}
          csvName="lms-playground-w"
        />
        <Plot
          title="誤差 $e_n$"
          ariaLabel="誤差 e 隨步數 n 的變化"
          data={ePlot}
          layout={{ xaxis: { title: { text: '$n$（sample）' } }, yaxis: { title: { text: '$e_n$' } } }}
          height={280}
          csvName="lms-playground-e"
        />
      </div>
      <Plot
        title="成本拋物線 $J(w)$：目前點、切線與下一步（箭頭）"
        ariaLabel="成本拋物線 J(w)：目前點、切線與下一步"
        data={jView.data}
        layout={{ xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: '$J(w)$' } }, annotations: jView.annotations }}
        height={300}
        csvName="lms-playground-cost"
        caption={
          <>
            切線斜率 <Tex>{String.raw`dJ/dw=-(a-w)x^2=-E[e\,x]`}</Tex>；平均步長 <Tex>{String.raw`E[\Delta w]=-\mu\,dJ/dw`}</Tex>。有雜訊時箭頭是實際的隨機步，與平均步不同。
          </>
        }
      />

      <div className="table-wrap">
        <table className="ch01-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'n'}</Tex>
              </th>
              <th className="num">
                <Tex>{'w_n'}</Tex>
              </th>
              {exact && <th>精確分數</th>}
              <th className="num">
                <Tex>{'y_n'}</Tex>
              </th>
              <th className="num">
                <Tex>{String.raw`\hat y_n=w_nx`}</Tex>
              </th>
              <th className="num">
                <Tex>{'e_n=y_n-\\hat y_n'}</Tex>
              </th>
              <th className="num">
                <Tex>{String.raw`\Delta w_n=\mu e_nx`}</Tex>
              </th>
              <th className="num">
                <Tex>{'w_{n+1}'}</Tex>
              </th>
              <th className="num">
                <Tex>{String.raw`\delta_{n+1}=a-w_{n+1}`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n} className={n === rowEnd ? 'is-current' : undefined}>
                <td className="num">{n}</td>
                <td className="num">{f(tr.w[n], 8)}</td>
                {exact && <td className="mono">{exactStr(n, exact[n])}</td>}
                <td className="num">{f(tr.y[n], 6)}</td>
                <td className="num">{f(tr.w[n] * params.x, 6)}</td>
                <td className="num">{f(tr.e[n], 6)}</td>
                <td className="num">{f(tr.dw[n], 6)}</td>
                <td className="num">{f(tr.w[n + 1], 8)}</td>
                <td className="num">{f(tr.delta[n + 1], 6)}</td>
              </tr>
            ))}
          </tbody>
          <caption>
            逐步更新表（最多顯示最近 8 步）。「精確分數」以十進位輸入的有理數重算（無雜訊時；只算前 {EXACT_STEPS} 步，太長的分數不顯示），例如 T01 的{' '}
            <Tex>{String.raw`w_2=\tfrac{57}{25}`}</Tex>；IEEE double 會印出 {T01_W2_DOUBLE}。
          </caption>
        </table>
      </div>

      <TryIt>
        把 <Tex>{'\\mu'}</Tex> 改成 0.25（一步到位）、0.4（正負交替收斂）、0.5（邊界）、0.6（發散）；再把{' '}
        <Tex>{'\\sigma_v'}</Tex> 拉到 1、<Tex>{'N=200'}</Tex>，看 <Tex>{'w_n'}</Tex> 在 <Tex>{'a'}</Tex> 附近抖動，抖動的變異數接近{' '}
        <Tex>{String.raw`\mu\sigma_v^2/(2-\mu x^2)`}</Tex>
        {params.noiseSigma > 0 && st.converges ? (
          <>
            {' '}
            （目前 = <Tex>{texNum(playgroundVarWStationary(params.mu, params.x, params.noiseSigma), 4)}</Tex>）
          </>
        ) : null}
        。最後按「凍結 Freeze」：<Tex>{'w'}</Tex> 停住，但誤差 <Tex>{'e_n'}</Tex> 仍隨雜訊跳動。
      </TryIt>

      <h4>
        Case A / B / C：同一組雜訊、不同 <Tex>{'\\mu'}</Tex> 的 <Tex>{String.raw`|\delta_n|`}</Tex>（log 軸）
      </h4>
      <p className="small muted">
        log 軸上 <Tex>{String.raw`|\delta_n|=|p|^n|\delta_0|`}</Tex> 是一條直線，斜率 = <Tex>{String.raw`\log|p|`}</Tex>（無雜訊時）。各 case 共用上方的 <Tex>{'a'}</Tex>、<Tex>{'x'}</Tex>、<Tex>{'w_0'}</Tex>、<Tex>{'\\sigma_v'}</Tex> 與 seed（paired comparison）。
      </p>
      <CaseSelector cases={cases} label="學習率比較組" />
      <div className="ch01-cursor">
        <ParamControl
          label={
            <>
              Case {cases.activeId} 的 <Tex>{'\\mu'}</Tex>
            </>
          }
          ariaLabel={`Case ${cases.activeId} 的 μ`}
          value={cases.active.params.mu}
          onChange={(mu) => cases.update({ mu })}
          min={-0.05}
          max={1.5}
          step={0.001}
          digits={6}
          unit="$1/[x]^2$"
          reg="REG_LMS_MU"
        />
        <button type="button" className="btn" onClick={loadCaseExample}>
          載入入門課範例 <Tex>{String.raw`\mu=0.02\,/\,0.10\,/\,0.65`}</Tex>
        </button>
      </div>
      <Plot
        title="$|\delta_n|=|a-w_n|$（log 軸）"
        ariaLabel="各比較組的參數誤差絕對值（log 軸）"
        data={casePlot}
        yLog
        layout={{ xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: String.raw`$|\delta_n|$` } } }}
        height={280}
        csvName="lms-playground-cases"
      />
    </ExperimentShell>
  )
}
