import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Data, Layout, Shape } from 'plotly.js-cartesian-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  mathText,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  useCases,
  useThemeTokens,
  type CaseId,
  type CheckEntry,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { REGIME_LABEL } from '@/simulation/models/calNoise'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { regimeLabelTex, texHz, texNum } from '../format'
import { ErratumTag, Rich } from '../common'
import {
  DEFAULT_CASE,
  DEFAULT_SHARED,
  LIMITS,
  parsePresetParams,
  sanitizeCase,
  UNITS_EXPERIMENT_ID,
  UNITS_PRESETS,
  unitsPresetById,
  type UnitsCase,
  type UnitsShared,
} from '../presets'
import { UNITS_WORKER_FN, UNITS_WORKER_MODULE } from '../unitsLoader'
import { runUnitsMcBatch, unitsCalc, unitsCurves, type UnitsCalcResult, type UnitsMcBatchParams, type UnitsMcResult } from '../unitsModel'
import { UNITS_WORKER_OPTIONS } from './unitsWorker'
import { TableWrap } from '../TableWrap'

/**
 * 互動：單位與頻寬換算器（規格 §0 的單位約定 + §12.1 的 T13 / T14 / §12.4 的 T15）。
 *
 * - 解析部分完全沿用第 12 章的 calLoop（同一個核心），每次參數改變即時重算（useDeferredValue）。
 * - Monte Carlo 只在按「Run」時執行，而且在 Web Worker 裡跑（useWorkerTask + 本頁專用的 units.worker；
 *   worker 不可用或失敗時退回主執行緒並在說明中註明）。每個 case 的 burn-in + blocks 合計最多 2×10⁵ 個 block
 *   （1-bit 引擎每個 block 是一次精確的 Binomial 抽樣，不是逐 sample），固定 seed、A/B/C 共用同一個 seed（paired comparison）。
 * - 交叉比對：Analytic = 封閉式 vs 數值解（二分法、數值積分、Parseval）；Monte Carlo = σ̂_w² 的 z 檢定（AR(1) 有效樣本數）；
 *   Fixed-point = Not implemented（Δ_LSB 在這裡只做單位換算）。
 */

interface McEntry {
  key: string
  res: UnitsMcResult
}

/** 這一次 Monte Carlo 花了多久、是不是 worker 失敗後退回主執行緒（顯示在指標表的說明，方便判斷 worker 有沒有出問題） */
export interface McRunInfo {
  /** true：worker 失敗，改在主執行緒重算（同一組參數、同一個 seed） */
  fallback: boolean
  ms: number | null
  /** fallback = true 時：worker 失敗的原因 */
  reason?: string
}

const REL_TOL = 1e-8

/**
 * 「封閉式 vs 數值解」的相對容差：10⁻⁸，再加上 p 很接近 ±1 時無法避免的捨入誤差界。
 * 封閉式都以 p 為輸入；1 − |p| 本身的相對捨入誤差約 ε/(1 − |p|)（ε = 2.2×10⁻¹⁶），
 * 所以 1 − p² 與 (1 − p)(1 + p) 這類代數上相等的寫法，在 1 − |p| ≲ 10⁻⁸ 時會差到 10⁻⁸ 以上——那是浮點數的極限，不是公式不一致。
 */
export function checkTolerance(p: number): number {
  const margin = 1 - Math.abs(p)
  return margin > 0 ? REL_TOL + (32 * Number.EPSILON) / margin : Infinity
}

function mcKey(shared: UnitsShared, c: UnitsCase, seed: number): string {
  return JSON.stringify([shared.sigmaV, shared.C, shared.engine, shared.chains, shared.blocks, c.N, c.mu, c.gmMode, seed])
}

function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), Number.MIN_VALUE)
}

/** 三項「封閉式 vs 不用封閉式的數值解」檢查的名稱（'$…$' 夾雜的說明文字） */
export const CHECK_NAME = {
  f3db: String.raw`$f_{3\mathrm{dB}}$：封閉式 vs 二分法`,
  enbw: 'ENBW：封閉式 vs 數值積分',
  sigmaW: String.raw`$\sigma_w$：遞迴的穩態解 vs $\sqrt{S_w^{(1)}(0)\cdot\mathrm{ENBW}}$`,
  f3dbExistence: String.raw`$f_{3\mathrm{dB}}$ 存在性：封閉式與二分法不一致`,
} as const

/** 封閉式 vs 數值解的檢查清單（只在量有定義時檢查） */
export function analyticChecks(u: UnitsCalcResult): { name: string; ok: boolean; err: number }[] {
  const out: { name: string; ok: boolean; err: number }[] = []
  const tol = checkTolerance(u.loop.p)
  const add = (name: string, a: number, b: number) => {
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const err = relErr(a, b)
      out.push({ name, ok: err <= tol, err })
    }
  }
  // name 會出現在交叉比對的說明（ExperimentShell 以 KaTeX 顯示 $…$）
  add(CHECK_NAME.f3db, u.loop.f3dbExact, u.f3dbNumeric)
  add(CHECK_NAME.enbw, u.loop.enbw, u.enbwNumeric)
  add(CHECK_NAME.sigmaW, u.loop.sigmaW, u.sigmaFromEnbw)
  // 封閉式有值、數值解卻沒有（或相反）也算不一致
  if (Number.isFinite(u.loop.f3dbExact) !== Number.isFinite(u.f3dbNumeric)) out.push({ name: CHECK_NAME.f3dbExistence, ok: false, err: Infinity })
  return out
}

function vline(x: number, color: string, dash: Shape['line']['dash']): Partial<Shape> {
  return { type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1.5, dash } }
}

export function UnitsCalculator() {
  const tokens = useThemeTokens()
  const [shared, setShared] = useState<UnitsShared>(DEFAULT_SHARED)
  const cases = useCases<UnitsCase>(DEFAULT_CASE, { seed: 20261010 })
  const [mc, setMc] = useState<Partial<Record<CaseId, McEntry>>>({})
  const [mcInfo, setMcInfo] = useState<McRunInfo | null>(null)
  const [mcError, setMcError] = useState<string | null>(null)
  // Monte Carlo 在 Web Worker 中執行（jsdom／不支援 Worker 時由 hook 自動改成 inline）
  const task = useWorkerTask<UnitsMcBatchParams, UnitsMcResult[]>(UNITS_WORKER_MODULE, UNITS_WORKER_FN, UNITS_WORKER_OPTIONS)
  const { run: runTask, cancel: cancelTask, mode: taskMode } = task
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // ── presets：本頁自帶（presets.ts）＋ src/data/presets 內 experiment = 'units-calculator' 的 JSON（目前沒有）
  const [pending, setPending] = useState<UnitsCase[] | null>(null)
  const handled = useRef<UnitsCase[] | null>(null)
  useEffect(() => {
    // useCases 沒有「一次設定多組」的 API：reset 成 cases[0] 生效後，再逐一 addCase + update（StrictMode 下只做一次）
    if (!pending || handled.current === pending || cases.cases.length !== 1) return
    handled.current = pending
    const ids = pending.map(() => cases.addCase())
    pending.forEach((p, i) => {
      const id = ids[i]
      if (id) cases.update(p, id)
    })
    cases.setActive('A')
    setPending(null)
  }, [pending, cases])

  const loadPreset = useCallback(
    (params: Record<string, unknown>) => {
      const parsed = parsePresetParams(params)
      setShared(parsed.shared)
      if (parsed.seed !== null) cases.setSeed(parsed.seed)
      cases.reset(parsed.cases[0])
      setPending(parsed.cases.length > 1 ? parsed.cases.slice(1) : null)
      cancelTask()
      setMc({})
      setMcInfo(null)
      setMcError(null)
    },
    [cases, cancelTask],
  )

  const [search] = useSearchParams()
  const jsonPreset = useUrlPreset(UNITS_EXPERIMENT_ID)
  const urlPreset = jsonPreset ?? unitsPresetById(search.get('preset'))
  const applied = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [scrollNonce, setScrollNonce] = useState(0)
  useEffect(() => {
    if (!urlPreset || applied.current === urlPreset.id) return
    applied.current = urlPreset.id
    loadPreset(urlPreset.params)
    setScrollNonce((n) => n + 1)
  }, [urlPreset, loadPreset])
  useEffect(() => {
    // 帶 preset 的連結：等版面穩定後捲到換算器（與套用 preset 分開，StrictMode 的重複 effect 才不會把計時器清掉）
    if (scrollNonce === 0) return
    const t = window.setTimeout(() => rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 300)
    return () => window.clearTimeout(t)
  }, [scrollNonce])

  const presets: ExperimentPreset[] = useMemo(
    () => [
      ...UNITS_PRESETS.map((p) => ({ id: p.id, name: p.title, params: p.params, description: `${p.description} 預期：${p.expected}` })),
      ...presetsForExperiment(UNITS_EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    ],
    [],
  )

  // ── 解析計算（拖動滑桿時延後，避免每一格都重畫圖）
  const dShared = useDeferredValue(shared)
  const dCases = useDeferredValue(cases.cases)
  const results = useMemo(
    () =>
      dCases.map((c) => ({
        id: c.id,
        seriesIndex: c.seriesIndex,
        params: c.params,
        u: unitsCalc({ fs: dShared.fs, N: c.params.N, mu: c.params.mu, sigmaV: dShared.sigmaV, C: dShared.C, gmMode: c.params.gmMode, fOut: dShared.fOut, At: dShared.At }),
      })),
    [dShared, dCases],
  )
  const active = results.find((r) => r.id === cases.activeId) ?? results[0]
  const au = active.u
  const lp = au.loop
  const stable = Math.abs(lp.p) < 1 && Number.isFinite(lp.sigmaW)

  // ── Monte Carlo（按 Run 才執行；在 worker 裡跑，失敗時退回主執行緒）
  const run = useCallback(() => {
    const snapshot = { shared, list: cases.cases.map((c) => ({ id: c.id, params: c.params })), seed: cases.seed }
    const params: UnitsMcBatchParams = {
      cases: snapshot.list.map((c) => ({
        mu: c.params.mu,
        sigmaV: snapshot.shared.sigmaV,
        C: snapshot.shared.C,
        N: c.params.N,
        gmMode: c.params.gmMode,
        engine: snapshot.shared.engine,
        chains: snapshot.shared.chains,
        blocks: snapshot.shared.blocks,
        seed: snapshot.seed,
      })),
    }
    const apply = (res: UnitsMcResult[], info: McRunInfo) => {
      if (!alive.current) return
      const out: Partial<Record<CaseId, McEntry>> = {}
      snapshot.list.forEach((c, i) => {
        if (res[i]) out[c.id] = { key: mcKey(snapshot.shared, c.params, snapshot.seed), res: res[i] }
      })
      setMc(out)
      setMcInfo(info)
    }
    setMcError(null)
    const t0 = performance.now()
    runTask(params)
      .then((res) => apply(res, { fallback: false, ms: performance.now() - t0 }))
      .catch((err: unknown) => {
        if (isWorkerCancelled(err) || !alive.current) return // 使用者按了停止／又按了一次 Run／離開頁面
        const reason = err instanceof Error ? err.message : String(err)
        try {
          // worker 本身壞了（例如模組載入失敗）：同一組參數、同一個 seed 改在主執行緒算，結果相同
          const t1 = performance.now()
          apply(runUnitsMcBatch(params), { fallback: true, ms: performance.now() - t1, reason })
        } catch (e2) {
          setMcError(`Monte Carlo 無法執行：${e2 instanceof Error ? e2.message : String(e2)}（worker 的錯誤：${reason}）`)
        }
      })
  }, [shared, cases.cases, cases.seed, runTask])

  const fresh = (id: CaseId, params: UnitsCase): UnitsMcResult | null => {
    const e = mc[id]
    return e && e.key === mcKey(shared, params, cases.seed) ? e.res : null
  }
  const activeMc = fresh(active.id, cases.active.params)
  const anyStale = cases.cases.some((c) => mc[c.id] && !fresh(c.id, c.params))

  const reset = useCallback(() => {
    cancelTask()
    setShared(DEFAULT_SHARED)
    cases.reset({ ...DEFAULT_CASE })
    cases.setSeed(20261010)
    setPending(null)
    setMc({})
    setMcInfo(null)
    setMcError(null)
  }, [cases, cancelTask])

  // ── 警告（解釋原因）
  const warnings: string[] = []
  for (const r of results) for (const w of r.u.loop.warnings) warnings.push(`Case ${r.id}：${w}`)
  if (au.beta > 0.3) {
    warnings.push(
      String.raw`$\beta=${texNum(au.beta)}\,\mathrm{rad}$ 已經不是小角：$20\log_{10}(\beta/2)$ 與 Bessel 精確值相差 $${texNum(Math.abs(au.spurDbc - au.spurDbcBessel), 3)}\,\mathrm{dB}$，而且高階 sideband（$J_2,J_3,\dots$）不可忽略。請檢查 $A_t$ 的單位是不是 fs、是不是 peak。`,
    )
  }
  for (const c of cases.cases) {
    const res = fresh(c.id, c.params)
    if (res && !res.valid) warnings.push(`Case ${c.id} 的 Monte Carlo 不做判定：${res.note}`)
  }
  if (mcError) warnings.push(mcError)

  // ── 交叉比對
  const checks = results.flatMap((r) => analyticChecks(r.u).map((c) => ({ ...c, id: r.id })))
  const analytic: CheckEntry =
    checks.length === 0
      ? { status: 'n/a', note: '沒有任何 case 有穩態（$|p|\\ge1$ 或 $\\sigma_v=0$）：封閉式與數值解都沒有定義，無從比對。' }
      : checks.every((c) => c.ok)
        ? {
            status: 'ok',
            note: String.raw`${checks.length} 項「封閉式 vs 不用封閉式的數值解」（$f_{3\mathrm{dB}}$ 的二分法、ENBW 的數值積分、$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$）相對誤差都在容差內（$10^{-8}$；$p$ 很接近 $\pm1$ 時再加上 $1-|p|$ 的捨入誤差界 $32\varepsilon_{\mathrm{mach}}/(1-|p|)$）；最大 $${texNum(Math.max(...checks.map((c) => c.err)), 2)}$。`,
          }
        : { status: 'mismatch', note: `不一致：${checks.filter((c) => !c.ok).map((c) => `Case ${c.id} ${c.name}`).join('；')}` }

  const mcList = cases.cases.map((c) => ({ id: c.id, res: fresh(c.id, c.params) }))
  const mcDone = mcList.filter((m): m is { id: CaseId; res: UnitsMcResult } => m.res !== null)
  const mcValid = mcDone.filter((m) => m.res.valid)
  const monteCarlo: CheckEntry =
    mcDone.length === 0
      ? { status: 'n/a', note: anyStale ? '參數已改變，上一次的 Monte Carlo 結果不再對應目前設定：請再按一次 Run。' : '尚未執行：按「Run」以目前的 seed 跑 Monte Carlo（每個 case 最多 $2\\times10^5$ 個 block）。' }
      : mcValid.length === 0
        ? { status: 'n/a', note: `沒有可判定的 case（原因見警告）：${mcDone.map((m) => `Case ${m.id}`).join('、')}。` }
        : mcValid.every((m) => Math.abs(m.res.z) <= 4)
          ? {
              status: 'ok',
              note: String.raw`${mcValid.map((m) => String.raw`Case ${m.id}：$\hat\sigma_w=${texNum(m.res.sigmaHat)}\,\mathrm{fs}$、$z=${texNum(m.res.z, 3)}$`).join('；')}（$|z|\le4$；引擎：${shared.engine === 'sign' ? '精確 1-bit Binomial' : '線性 AR(1)'}）。`,
            }
          : {
              status: 'mismatch',
              note: String.raw`${mcValid.filter((m) => Math.abs(m.res.z) > 4).map((m) => String.raw`Case ${m.id}：$z=${texNum(m.res.z, 3)}$`).join('；')} 超過 $|z|\le4$。先換一個 seed 排除偶然；若仍不一致，檢查 $|C|\,\sigma_w/\sigma_v$ 是否太大（小訊號 $K_q$ 失效）。`,
            }
  const fixedPoint: CheckEntry = { status: 'not-implemented', note: '這個換算器沒有量化模型：$\\Delta_{\\mathrm{LSB}}$ 只用來把 fs 換成 LSB。bit-true 的 gain register 見第 13 章與 Models 頁。' }

  // ── 指標（目前選取的 case）
  const metrics: MetricRow[] = [
    { name: String.raw`$g=\mu K${cases.active.params.gmMode === 'sum' ? 'N' : ''}$（無因次 loop gain）`, value: lp.g, formulaId: 'F-12.1', claim: 'approx', note: String.raw`$\mu=${texNum(cases.active.params.mu)}\,\mathrm{fs}$、$K=K_qC=${texNum(lp.K)}\,\mathrm{fs^{-1}}$` },
    { name: String.raw`pole $p=1-g$`, value: lp.p, formulaId: 'F-12.2', claim: 'approx', note: `型態：${regimeLabelTex(REGIME_LABEL[lp.regime])}` },
    { name: String.raw`時間常數 $\tau=-1/\ln|p|$`, value: Number.isFinite(lp.tauBlocks) ? lp.tauBlocks : null, unit: 'blocks', note: Number.isFinite(lp.tauSeconds) ? String.raw`$=${texNum(lp.tauBlocks * cases.active.params.N)}$ samples $=${texNum(lp.tauSeconds * 1e6)}\,\mu\mathrm{s}$` : '沒有穩態' },
    { name: String.raw`$\sigma_w$（gain-equivalent，不是 output jitter）`, value: stable ? lp.sigmaW : null, unit: 'fs', formulaId: 'F-12.5', claim: 'exact', analytic: stable ? au.sigmaFromEnbw : undefined, tolerance: checkTolerance(lp.p), toleranceMode: 'rel', note: String.raw`解析欄：$\sqrt{S_w^{(1)}(0)\cdot\mathrm{ENBW}}$（Parseval 驗算）` },
    { name: String.raw`exact $f_{3\mathrm{dB}}$`, value: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : null, unit: 'Hz', formulaId: 'F-12.7', claim: 'exact', analytic: Number.isFinite(au.f3dbNumeric) ? au.f3dbNumeric : undefined, tolerance: checkTolerance(lp.p), toleranceMode: 'rel', note: Number.isFinite(lp.f3dbExact) ? String.raw`解析欄：二分法解 $|H|^2=\tfrac12|H(1)|^2$` : String.raw`不存在（需 $3-2\sqrt2\le p<1$）` },
    { name: String.raw`$(1-p)f_u/2\pi$ 近似`, value: Number.isFinite(lp.f3dbOneMinusP) ? lp.f3dbOneMinusP : null, unit: 'Hz', formulaId: 'F-12.8', claim: 'approx', analytic: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : undefined, note: String.raw`與 exact 的差 $\approx-(1-p)/2$（相對）` },
    { name: String.raw`$-\ln p\cdot f_u/2\pi$ 近似`, value: Number.isFinite(lp.f3dbNegLnP) ? lp.f3dbNegLnP : null, unit: 'Hz', formulaId: 'F-12.8', claim: 'approx', analytic: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : undefined },
    { name: 'One-sided ENBW', value: Number.isFinite(lp.enbw) ? lp.enbw : null, unit: 'Hz', formulaId: 'F-12.9', claim: 'exact', analytic: Number.isFinite(au.enbwNumeric) ? au.enbwNumeric : undefined, tolerance: checkTolerance(lp.p), toleranceMode: 'rel', note: String.raw`解析欄：$\int_0^{f_u/2}|H|^2df/|H(1)|^2$ 的數值積分` },
    { name: String.raw`$\sqrt{S_w^{(1)}(0)\cdot f_{3\mathrm{dB}}}$（把 $-3\,\mathrm{dB}$ 誤當 Noise BW）`, value: Number.isFinite(au.sigmaFromF3db) ? au.sigmaFromF3db : null, unit: 'fs', claim: 'approx', analytic: stable ? lp.sigmaW : undefined, note: String.raw`E06：低估約 $1-\sqrt{2/\pi}\approx20\%$` },
    { name: String.raw`$f_{3\mathrm{dB}}$ 以下的雜訊功率比例`, value: Number.isFinite(au.fracBelowF3db) ? au.fracBelowF3db : null, claim: 'exact', note: String.raw`$F(f)=\frac2\pi\arctan\!\big(\frac{1+p}{1-p}\tan\frac{\Omega}{2}\big)$；約一半，不是全部` },
    { name: String.raw`$1\,\mathrm{fs}$ 對應的相位（在 $f_{\mathrm{out}}$）`, value: au.radPerFs, unit: 'rad', claim: 'exact', note: String.raw`$2\pi f_{\mathrm{out}}\times10^{-15}$` },
    { name: String.raw`Spur $20\log_{10}(\beta/2)$`, value: au.spurDbc, unit: 'dBc', formulaId: 'F-12.18', claim: 'approx', analytic: au.spurDbcBessel, tolerance: 0.01, note: String.raw`解析欄：Bessel 精確值 $20\log_{10}(J_1/J_0)$；$\beta=${texNum(au.beta)}\,\mathrm{rad}$、$|T|=1$` },
  ]
  if (activeMc) {
    const seSigma = Number.isFinite(activeMc.se) ? activeMc.se / (2 * Math.sqrt(activeMc.varTheory)) : NaN
    metrics.push({
      name: String.raw`Monte Carlo $\hat\sigma_w$（${activeMc.engine === 'sign' ? '1-bit' : '線性'}，$n=${activeMc.nTotal}$）`,
      value: Number.isFinite(activeMc.sigmaHat) ? activeMc.sigmaHat : null,
      unit: 'fs',
      claim: 'approx',
      analytic: activeMc.valid ? lp.sigmaW : undefined,
      tolerance: activeMc.valid ? 4 * seSigma : undefined,
      note: `${activeMc.note}${activeMc.blocksUsed < shared.blocks ? ` 每條 chain 的 block 數因運算量上限由 ${shared.blocks} 減為 ${activeMc.blocksUsed}。` : ''}${mcRunNote(mcInfo, taskMode)}`,
    })
  }

  // ── 圖
  const curves = useMemo(() => results.map((r) => ({ id: r.id, seriesIndex: r.seriesIndex, ok: Math.abs(r.u.loop.p) < 1, c: unitsCurves(r.u.loop.p, r.u.loop.fu, r.u.loop.enbw, 240) })), [results])
  const h2Data: Data[] = useMemo(
    () =>
      curves
        .filter((c) => c.ok)
        .map((c) => ({
          x: c.c.f,
          y: c.c.h2.map((v) => 10 * Math.log10(v)),
          name: `Case ${c.id}`,
          mode: 'lines',
          line: { color: tokens.series[c.seriesIndex] },
        })),
    [curves, tokens],
  )
  const activeColor = tokens.series[active.seriesIndex]
  const h2Layout: Partial<Layout> = useMemo(() => {
    const shapes: Partial<Shape>[] = []
    const annotations: NonNullable<Layout['annotations']> = []
    const mark = (x: number, label: string, dash: Shape['line']['dash'], y: number) => {
      if (!(Number.isFinite(x) && x > 0)) return
      shapes.push(vline(x, activeColor, dash))
      annotations.push({ x: Math.log10(x), xref: 'x', y, yref: 'paper', text: label, showarrow: false, font: { size: 11, color: tokens.textMuted }, xanchor: 'left', xshift: 3 })
    }
    mark(lp.f3dbOneMinusP, String.raw`$(1-p)$`, 'dot', 0.28)
    mark(lp.f3dbExact, String.raw`$f_{3\mathrm{dB}}$`, 'solid', 0.16)
    mark(lp.enbw, String.raw`$\mathrm{ENBW}$`, 'dash', 0.04)
    shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: -3.0103, y1: -3.0103, line: { color: tokens.textMuted, width: 1, dash: 'dot' } })
    return {
      xaxis: { title: { text: String.raw`$f$ [Hz]（block-rate 序列：$0\ldots f_u/2$）` } },
      yaxis: { title: { text: String.raw`$|H|^2/|H(0)|^2$ [dB]` } },
      shapes,
      annotations,
    }
  }, [lp.f3dbExact, lp.f3dbOneMinusP, lp.enbw, activeColor, tokens])

  const fracData: Data[] = useMemo(() => {
    const out: Data[] = curves
      .filter((c) => c.ok)
      .map((c) => ({ x: c.c.f, y: c.c.frac, name: String.raw`Case ${c.id}：$F(f)$`, mode: 'lines', line: { color: tokens.series[c.seriesIndex] } }))
    const a = curves.find((c) => c.id === active.id)
    if (a && a.ok) out.push({ x: a.c.f, y: a.c.rect.map((v) => Math.min(1, v)), name: String.raw`Case ${a.id}：矩形近似 $\min(1,\ f/\mathrm{ENBW})$`, mode: 'lines', line: { color: tokens.series[a.seriesIndex], dash: 'dash', width: 1.5 } })
    return out
  }, [curves, tokens, active.id])
  const fracLayout: Partial<Layout> = useMemo(() => {
    const shapes: Partial<Shape>[] = [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0.5, y1: 0.5, line: { color: tokens.textMuted, width: 1, dash: 'dot' } }]
    if (Number.isFinite(lp.f3dbExact)) shapes.push(vline(lp.f3dbExact, activeColor, 'solid'))
    if (Number.isFinite(lp.enbw) && lp.enbw > 0) shapes.push(vline(lp.enbw, activeColor, 'dash'))
    return { xaxis: { title: { text: '$f$ [Hz]' } }, yaxis: { title: { text: String.raw`$0\ldots f$ 的雜訊功率比例 $F(f)$` }, range: [0, 1.05] }, shapes }
  }, [lp.f3dbExact, lp.enbw, activeColor, tokens])

  const traceData: Data[] = useMemo(() => {
    const out: Data[] = []
    for (const c of cases.cases) {
      const e = mc[c.id]
      if (!e || e.res.trace.length === 0) continue
      out.push({
        x: Array.from({ length: e.res.trace.length }, (_, i) => i),
        y: Array.from(e.res.trace),
        name: String.raw`Case ${c.id}：$\delta_k$（chain 0）`,
        mode: 'lines',
        line: { color: tokens.series[c.seriesIndex], width: 1 },
      })
    }
    return out
  }, [mc, cases.cases, tokens])
  const traceLayout: Partial<Layout> = useMemo(() => {
    const s = stable ? lp.sigmaW : NaN
    const shapes: Partial<Shape>[] = Number.isFinite(s)
      ? [s, -s].map((y) => ({ type: 'line' as const, xref: 'paper' as const, yref: 'y' as const, x0: 0, x1: 1, y0: y, y1: y, line: { color: tokens.textMuted, width: 1, dash: 'dash' as const } }))
      : []
    return { xaxis: { title: { text: 'block $k$（burn-in 之後）' } }, yaxis: { title: { text: String.raw`$\delta_k = a - w_k$ [fs]` } }, shapes }
  }, [stable, lp.sigmaW, tokens])

  const c = cases.active.params
  const setCase = (patch: Partial<UnitsCase>) => cases.update((p) => sanitizeCase({ ...p, ...patch }, p))
  const sumMode = c.gmMode === 'sum'

  return (
    <div ref={rootRef} id="fr-units-calculator" className="fr-calc">
      <ExperimentShell
        id={UNITS_EXPERIMENT_ID}
        title="互動：單位與頻寬換算器（$\mu\to g\to p\to\sigma_w$、Hz ↔ rad/block ↔ rad/sample、fs ↔ rad）"
        level="L1"
        claim="exact"
        source="simulation"
        tests={['T13', 'T14', 'T15']}
        description={
          <>
            輸入帶單位的 <Tex>{String.raw`\mu`}</Tex>、<Tex>{String.raw`\sigma_v`}</Tex>、<Tex>{'N'}</Tex>、<Tex>{'f_s'}</Tex>，一路換算到無因次的{' '}
            <Tex>{'g'}</Tex>、pole、係數雜訊與四個「頻寬」。預設值就是 T13／T14 的條件（<Tex>{String.raw`f_s=4\,\mathrm{GHz}`}</Tex>，與 4 GHz reference 的 SSPLL 相同）。封閉式在指定的線性模型內是精確的；模型本身（小訊號 <Tex>{'K_q'}</Tex>、白色 <Tex>{String.raw`\eta`}</Tex>）是近似，所以另外用 1-bit Monte Carlo 驗算（
            <ErratumTag eid="E06" /> <ErratumTag eid="E13" /> <ErratumTag eid="E18" /> <ErratumTag eid="E30" />）。
          </>
        }
        assumptions={[
          String.raw`線性化 block 模型：$\delta w_{k+1}=p\,\delta w_k+\mu\eta_k$，$\eta_k$ 在 block 之間獨立（白色）`,
          String.raw`Comparator 小訊號增益 $K_q=\sqrt{2/\pi}/\sigma_v$（Gaussian $v$、固定點附近的 deterministic residual $\ll\sigma_v$）`,
          String.raw`$\sigma_\eta^2=1/N$（average mode、unit-RMS code、近平衡）；sum mode 為 $N$`,
          String.raw`$x,u$ 無因次（正規化 code），時間單位由 $a,w$ 承載（fs）；$C=E[xu]$ 由使用者指定`,
          String.raw`1-bit Monte Carlo：$x=\pm1$ iid、$u=Cx$，$\sum qx=2\,\mathrm{Bin}(N,\Phi(C\delta/\sigma_v))-N$（精確抽樣）。comparator 前的確定性殘差是 $C\delta$，所以小訊號的判定是 $|C|\,\sigma_w\le0.2\,\sigma_v$；超過時 Monte Carlo 與線性公式的比對只供參考`,
          String.raw`Spur：單一 tone、$A_t$ 為 output timing tone 的 peak、$|T|=1$、小角調變`,
          String.raw`$f_s$ 不保證等於 $f_{\mathrm{ref}}$；所有數值皆為示例（illustrative）`,
        ]}
        params={{ ...shared, activeCase: cases.activeId, ...Object.fromEntries(cases.cases.flatMap((cs) => [[`N_${cs.id}`, cs.params.N], [`mu_${cs.id}`, cs.params.mu], [`gm_mode_${cs.id}`, cs.params.gmMode]])) }}
        seed={cases.seed}
        onSeedChange={cases.setSeed}
        units={{ fs: 'Hz', sigmaV: 'fs', C: '無因次（[x]²）', fOut: 'Hz', At: 'fs (peak)', lsbFs: 'fs/LSB', mu: 'fs（[w]/[G]）', N: 'samples', chains: 'chains', blocks: 'blocks' }}
        metrics={metrics}
        warnings={warnings}
        crossCheck={{ analytic, monteCarlo, fixedPoint }}
        actions={{ onReset: reset, onRun: run, onStop: cancelTask, running: task.running }}
        presets={presets}
        onLoadPreset={(p) => loadPreset(p.params)}
        exportData={() => {
          const cols: Record<string, ArrayLike<number>> = {}
          for (const cv of curves) {
            if (!cv.ok) continue
            cols[`f_Hz_${cv.id}`] = cv.c.f
            cols[`H2_norm_${cv.id}`] = cv.c.h2
            cols[`cum_power_fraction_${cv.id}`] = cv.c.frac
            cols[`rect_approx_${cv.id}`] = cv.c.rect
          }
          for (const cs of cases.cases) {
            const e = mc[cs.id]
            if (e && e.res.trace.length > 0) cols[`mc_delta_fs_${cs.id}`] = e.res.trace
          }
          return cols
        }}
        controls={
          <>
            <CaseSelector cases={cases} label="比較組（各自的 block 長度、學習率、gm_mode）" />
            <ParamControl
              label={mathText(String.raw`Case ${cases.activeId}：$N$（GMAC block 長度）`)}
              ariaLabel={`Case ${cases.activeId} 的 N`}
              value={c.N}
              onChange={(N) => setCase({ N })}
              min={LIMITS.N[0]}
              max={LIMITS.N[1]}
              log
              integer
              clampOnBlur
              unit="samples"
              reg="REG_GMAC_N（gm_accumulation_length）"
              hint={mathText(String.raw`$f_u=f_s/N=${texHz(shared.fs / c.N)}$；1 block $=${texNum((c.N / shared.fs) * 1e9)}\,\mathrm{ns}$`)}
            />
            <ParamControl
              label={mathText(String.raw`Case ${cases.activeId}：$\mu$（學習率）`)}
              ariaLabel={`Case ${cases.activeId} 的 mu`}
              value={c.mu}
              onChange={(mu) => setCase({ mu })}
              min={LIMITS.mu[0]}
              max={LIMITS.mu[1]}
              log
              unit="fs"
              reg="REG_LMS_MU（learning_rate）"
              hint={mathText(
                sumMode
                  ? String.raw`sum mode：$g=\mu KN$；與 average mode 的 $\mu=${texNum(c.mu * c.N)}\,\mathrm{fs}$ 等價`
                  : String.raw`average mode：$g=\mu K$；改用 sum mode 時要設成 $\mu/N=${texNum(c.mu / c.N)}\,\mathrm{fs}$`,
              )}
            />
            <SelectControl
              label={`Case ${cases.activeId}：GMAC 輸出`}
              value={c.gmMode}
              onChange={(gmMode) => setCase({ gmMode })}
              options={[
                { value: 'average', label: 'average：G = (1/N)Σq·x' },
                { value: 'sum', label: 'sum：G = Σq·x（g 放大 N 倍）' },
              ]}
              reg="gm_mode"
              hint="硬體 accumulator 直接輸出總和時選 sum"
            />
            <ParamControl
              label={mathText(String.raw`$f_s$（comparator 取樣率）`)}
              ariaLabel="f_s"
              value={shared.fs}
              onChange={(fs) => setShared((s) => ({ ...s, fs }))}
              min={LIMITS.fs[0]}
              max={LIMITS.fs[1]}
              log
              unit="Hz"
              reg="behavioral：sample_rate_hz（SSPLL 中 = f_ref）"
            />
            <ParamControl
              label={mathText(String.raw`$\sigma_v$（comparator 前雜訊 RMS）`)}
              ariaLabel="sigma_v"
              value={shared.sigmaV}
              onChange={(sigmaV) => setShared((s) => ({ ...s, sigmaV }))}
              min={LIMITS.sigmaV[0]}
              max={LIMITS.sigmaV[1]}
              log
              unit="fs"
              reg="behavioral：comparator_noise_rms_fs"
              hint={mathText(String.raw`$K_q=\sqrt{2/\pi}/\sigma_v=${texNum(Math.sqrt(2 / Math.PI) / shared.sigmaV, 5)}\,\mathrm{fs^{-1}}$`)}
            />
            <ParamControl
              label={mathText(String.raw`$C=E[xu]$（有效 code 相關）`)}
              ariaLabel="C"
              value={shared.C}
              onChange={(C) => setShared((s) => ({ ...s, C }))}
              min={LIMITS.C[0]}
              max={LIMITS.C[1]}
              step={0.01}
              unit="無因次"
              reg="behavioral：由 code 與 H_PD 決定（第 6 章）"
              hint={mathText(String.raw`unit-RMS code、identity path 時 $C=1$；$C\le0$ 是極性錯誤`)}
            />
            <ParamControl
              label={mathText(String.raw`$f_{\mathrm{out}}$（PLL 輸出頻率）`)}
              ariaLabel="f_out"
              value={shared.fOut}
              onChange={(fOut) => setShared((s) => ({ ...s, fOut }))}
              min={LIMITS.fOut[0]}
              max={LIMITS.fOut[1]}
              log
              unit="Hz"
              reg="behavioral：f_out_hz"
              hint="只影響 fs ↔ rad 與 spur 的換算"
            />
            <ParamControl
              label={mathText(String.raw`$A_t$（output timing tone 的 peak）`)}
              ariaLabel="A_t"
              value={shared.At}
              onChange={(At) => setShared((s) => ({ ...s, At }))}
              min={LIMITS.At[0]}
              max={LIMITS.At[1]}
              log
              unit="fs（peak）"
              reg="behavioral：spur 換算用"
            />
            <ParamControl
              label={mathText(String.raw`$\Delta_{\mathrm{LSB}}$（gain code 的 LSB）`)}
              ariaLabel="Delta_LSB"
              value={shared.lsbFs}
              onChange={(lsbFs) => setShared((s) => ({ ...s, lsbFs }))}
              min={LIMITS.lsbFs[0]}
              max={LIMITS.lsbFs[1]}
              log
              unit="fs/LSB"
              reg="gain_register.lsb_fs"
              hint="只做 fs ↔ LSB 換算（不量化）"
            />
            <SelectControl
              label="Monte Carlo 引擎"
              value={shared.engine}
              onChange={(engine) => setShared((s) => ({ ...s, engine }))}
              options={[
                { value: 'sign', label: '精確 1-bit（Binomial；非線性）' },
                { value: 'linear', label: '線性 AR(1)（Gaussian η）' },
              ]}
              reg="behavioral：模擬引擎"
            />
            <ParamControl
              label="Monte Carlo chains"
              value={shared.chains}
              onChange={(chains) => setShared((s) => ({ ...s, chains }))}
              min={LIMITS.chains[0]}
              max={LIMITS.chains[1]}
              integer
              clampOnBlur
              unit="chains"
              reg="behavioral：獨立 chain 數（各自 fork 一個亂數流）"
            />
            <ParamControl
              label="每條 chain 的 blocks"
              value={shared.blocks}
              onChange={(blocks) => setShared((s) => ({ ...s, blocks }))}
              min={LIMITS.blocks[0]}
              max={LIMITS.blocks[1]}
              log
              integer
              clampOnBlur
              unit="blocks"
              reg="behavioral：num_blocks（不含 burn-in）"
              hint={mathText(String.raw`chains $\times$（burn-in + blocks）超過 $2\times10^5$ 時自動減少（1-bit 引擎在 $N>3600$ 時上限依 $\sqrt N$ 再降低）；burn-in 放不下時不做判定`)}
            />
          </>
        }
      >
        <h4 className="fr-sub">Case {active.id} 的單位鏈：每一步都寫出單位</h4>
        <TableWrap>
          <table className="fr-table fr-chain-table">
            <thead>
              <tr>
                <th>量</th>
                <th>怎麼算</th>
                <th>數值</th>
                <th>單位</th>
              </tr>
            </thead>
            <tbody>
              <ChainRow name="Block update rate" tex={String.raw`f_u=\frac{f_s}{N}`} value={texHz(lp.fu, 6)} unit={String.raw`\mathrm{Hz}`} note={String.raw`1 block $=${texNum((1 / lp.fu) * 1e9)}\,\mathrm{ns}$`} />
              <ChainRow name="Comparator 小訊號增益" tex={String.raw`K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`} value={texNum(lp.Kq, 6)} unit={String.raw`\mathrm{fs^{-1}}`} />
              <ChainRow name="GMAC 斜率" tex={String.raw`K=K_q\,C`} value={texNum(lp.K, 6)} unit={String.raw`\mathrm{fs^{-1}}`} note={String.raw`$C$ 無因次（$x,u$ 都是正規化 code）`} />
              <ChainRow
                name="Loop gain"
                tex={sumMode ? String.raw`g=\mu\,K\,N` : String.raw`g=\mu\,K`}
                value={texNum(lp.g, 6)}
                unit="1"
                note={String.raw`$\mathrm{fs}\times\mathrm{fs^{-1}}$ 相消：$${texNum(c.mu)}\times${texNum(lp.K, 5)}${sumMode ? String.raw`\times${c.N}` : ''}$`}
              />
              <ChainRow name="Pole" tex="p=1-g" value={texNum(lp.p, 7)} unit="1" note={regimeLabelTex(REGIME_LABEL[lp.regime])} />
              <ChainRow
                name="時間常數"
                tex={String.raw`\tau=\frac{-1}{\ln|p|}`}
                value={Number.isFinite(lp.tauBlocks) ? texNum(lp.tauBlocks) : String.raw`\text{—}`}
                unit={String.raw`\mathrm{blocks}`}
                note={Number.isFinite(lp.tauBlocks) ? String.raw`$\times N=${texNum(lp.tauBlocks * c.N)}$ samples；$\div f_u=${texNum(lp.tauSeconds * 1e6)}\,\mu\mathrm{s}$` : '沒有穩態'}
              />
              <ChainRow name="GMAC 雜訊變異數" tex={sumMode ? String.raw`\sigma_\eta^2=N` : String.raw`\sigma_\eta^2=\frac1N`} value={texNum(lp.sigmaEta2, 6)} unit="1" />
              <ChainRow
                name="係數雜訊 RMS"
                tex={String.raw`\sigma_w=\frac{\mu\,\sigma_\eta}{\sqrt{1-p^2}}`}
                value={stable ? texNum(lp.sigmaW, 6) : String.raw`\text{—}`}
                unit={String.raw`\mathrm{fs}`}
                note={
                  stable
                    ? String.raw`$\div\Delta_{\mathrm{LSB}}=${texNum(lp.sigmaW / shared.lsbFs)}\,\mathrm{LSB}$；$\times2\pi f_{\mathrm{out}}=${texNum(lp.sigmaW * au.radPerFs)}\,\mathrm{rad}$（gain-equivalent，還沒乘 code、還沒過 $T$）`
                    : String.raw`$|p|\ge1$：沒有穩態`
                }
              />
              <ChainRow
                name={String.raw`$-3\,\mathrm{dB}$ corner（exact）`}
                tex={String.raw`\Omega_{3\mathrm{dB}}=2\arcsin\frac{1-p}{2\sqrt p}`}
                value={Number.isFinite(lp.f3dbExact) ? texNum(au.omega3dbBlock, 6) : String.raw`\text{—}`}
                unit={String.raw`\mathrm{rad/block}`}
                note={
                  Number.isFinite(lp.f3dbExact)
                    ? String.raw`$\times\frac{f_u}{2\pi}=${texHz(lp.f3dbExact, 5)}$；$\div N=${texNum(au.theta3dbSample)}\,\mathrm{rad/sample}$`
                    : String.raw`需 $3-2\sqrt2\le p<1$`
                }
              />
              <ChainRow
                name="Noise bandwidth"
                tex={String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}`}
                value={Number.isFinite(lp.enbw) ? texHz(lp.enbw, 5) : String.raw`\text{—}`}
                unit={String.raw`\mathrm{Hz}`}
                note={Number.isFinite(lp.enbw) && Number.isFinite(lp.f3dbExact) ? String.raw`$=${texNum(lp.enbw / lp.f3dbExact)}\,f_{3\mathrm{dB}}$` : undefined}
              />
              <ChainRow
                name="DC 的單邊 PSD"
                tex={String.raw`S_w^{(1)}(0)=\frac{2}{f_u}\cdot\frac{\mu^2\sigma_\eta^2}{(1-p)^2}`}
                value={Number.isFinite(lp.sw1Dc) ? texNum(lp.sw1Dc) : String.raw`\text{—}`}
                unit={String.raw`\mathrm{fs^2/Hz}`}
                note={Number.isFinite(lp.sw1Dc) ? String.raw`$\times\mathrm{ENBW}=${texNum(lp.sw1Dc * lp.enbw, 6)}\,\mathrm{fs^2}=\sigma_w^2$` : undefined}
              />
              <ChainRow name="時間 → 相位" tex={String.raw`\phi=2\pi f_{\mathrm{out}}\,t`} value={texNum(au.radPerFs)} unit={String.raw`\mathrm{rad/fs}`} note={String.raw`$f_{\mathrm{out}}=${texHz(shared.fOut)}$`} />
              <ChainRow
                name="調變指數與 spur"
                tex={String.raw`\beta=2\pi f_{\mathrm{out}}A_t,\quad 20\log_{10}\frac\beta2`}
                value={texNum(au.spurDbc)}
                unit={String.raw`\mathrm{dBc}`}
                note={String.raw`$\beta=${texNum(au.beta)}\,\mathrm{rad}$；Bessel 精確 $${texNum(au.spurDbcBessel)}\,\mathrm{dBc}$`}
              />
            </tbody>
          </table>
        </TableWrap>

        {results.length > 1 && (
          <>
            <h4 className="fr-sub">Case 比較</h4>
            <TableWrap>
              <table className="fr-table fr-cases-table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>
                      <Tex>{'N'}</Tex>
                    </th>
                    <th>
                      <Tex>{String.raw`\mu\ [\mathrm{fs}]`}</Tex>
                    </th>
                    <th>mode</th>
                    <th>
                      <Tex>{'g'}</Tex>
                    </th>
                    <th>
                      <Tex>{'p'}</Tex>
                    </th>
                    <th>
                      <Tex>{String.raw`\sigma_w\ [\mathrm{fs}]`}</Tex>
                    </th>
                    <th>
                      <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>
                    </th>
                    <th>ENBW</th>
                    <th>
                      MC <Tex>{String.raw`\hat\sigma_w`}</Tex>
                    </th>
                    <th>型態</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const l = r.u.loop
                    const m = fresh(r.id, r.params)
                    const dash = <span className="muted">—</span>
                    return (
                      <tr key={r.id} className={r.id === active.id ? 'fr-focus' : undefined}>
                        <td data-label="Case">
                          <span className="fr-case-dot" style={{ background: tokens.series[r.seriesIndex] }} aria-hidden="true" /> {r.id}
                        </td>
                        <td data-label="N">{r.params.N}</td>
                        <td data-label="μ">
                          <Tex>{texNum(r.params.mu)}</Tex>
                        </td>
                        <td data-label="mode">{r.params.gmMode}</td>
                        <td data-label="g">
                          <Tex>{texNum(l.g)}</Tex>
                        </td>
                        <td data-label="p">
                          <Tex>{texNum(l.p, 5)}</Tex>
                        </td>
                        <td data-label="σ_w">{Number.isFinite(l.sigmaW) ? <Tex>{texNum(l.sigmaW)}</Tex> : dash}</td>
                        <td data-label="f_3dB">{Number.isFinite(l.f3dbExact) ? <Tex>{texHz(l.f3dbExact)}</Tex> : dash}</td>
                        <td data-label="ENBW">{Number.isFinite(l.enbw) ? <Tex>{texHz(l.enbw)}</Tex> : dash}</td>
                        <td data-label="MC">{m && Number.isFinite(m.sigmaHat) ? <Tex>{`${texNum(m.sigmaHat)}${m.valid ? String.raw`\ (z=${texNum(m.z, 2)})` : String.raw`\ \text{（不判定）}`}`}</Tex> : dash}</td>
                        <td data-label="型態">
                          <Rich text={regimeLabelTex(REGIME_LABEL[l.regime])} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}

        <Plot
          title="$|H_{\eta\to w}|^2$：三條直線標的是三個不同的「頻寬」（目前選取的 case）"
          ariaLabel="正規化功率響應與 f_3dB、(1−p) 近似、ENBW 的位置"
          data={h2Data}
          layout={h2Layout}
          xLog
          height={300}
          csvName="units-h2"
          caption={
            h2Data.length === 0
              ? '沒有穩定的 case 可畫：$|p|\\ge1$ 時 $H_{\\eta\\to w}$ 沒有頻率響應可言。'
              : '解析曲線 $|H|^2/|H(1)|^2=(1-p)^2/(1-2p\\cos\\Omega+p^2)$，$\\Omega=2\\pi f/f_u$（block-rate，單邊 $0\\dots f_u/2$）。實線：exact $-3\\,\\mathrm{dB}$；點線：$(1-p)$ 近似；虛線：$\\mathrm{ENBW}$（積分用的等效矩形寬度）。水平點線是 $-3.01\\,\\mathrm{dB}$。'
          }
        />
        <Plot
          title="累積雜訊功率 $F(f)$：$f_{3\mathrm{dB}}$ 以下只有一半"
          ariaLabel="累積雜訊功率比例與矩形近似"
          data={fracData}
          layout={fracLayout}
          xLog
          height={280}
          csvName="units-cumulative-power"
          caption="$F(f)=\int_0^f|H|^2/\int_0^{f_u/2}|H|^2$（封閉式，已與數值積分比對）。虛線是「把雜訊當成寬度 ENBW 的矩形」的近似：低頻時兩者重合，所以白雜訊積分要用 ENBW；垂直實線是 $f_{3\mathrm{dB}}$（$F\approx0.5$），垂直虛線是 ENBW。"
        />
        {traceData.length > 0 ? (
          <Plot
            title={`Monte Carlo：$\\delta_k=a-w_k$ 的一條樣本路徑（seed ${cases.seed}${anyStale ? '；參數已改變，這是上一次的結果' : ''}）`}
            ariaLabel="Monte Carlo 樣本路徑"
            data={traceData}
            layout={traceLayout}
            height={260}
            csvName="units-mc-trace"
            caption="水平虛線：目前選取 case 的解析 $\pm\sigma_w$。1-bit 引擎從 $\delta=0$ 出發並丟掉 $8\tau+10$ 個 block 的 burn-in（迴路太慢、放不進運算量上限時會截短並標為不判定）；線性引擎的初值直接取穩態分布。"
          />
        ) : (
          <p className="small muted fr-mc-hint">
            按上方的「Run」執行 Monte Carlo（固定 seed，可重現）：會畫出 <Tex>{String.raw`\delta_k`}</Tex> 的樣本路徑，並在指標表與交叉比對列出 <Tex>{String.raw`\hat\sigma_w`}</Tex> 與 z 分數。
          </p>
        )}
      </ExperimentShell>
    </div>
  )
}

/**
 * 「這一次在哪裡算、花多久」的說明（接在 Monte Carlo 指標的 note 後面）。
 * mode 是 useWorkerTask 回報的實際執行方式：'worker'（Web Worker）或 'inline'（環境沒有 Worker，例如 jsdom）。
 */
export function mcRunNote(info: McRunInfo | null, mode: 'worker' | 'inline'): string {
  if (!info) return ''
  const ms = info.ms !== null && Number.isFinite(info.ms) ? `，${Math.max(1, Math.round(info.ms))} ms` : ''
  if (info.fallback) return ` 執行環境：主執行緒${ms}——Web Worker 失敗後自動改用（原因：${info.reason ?? '未知'}）；同一個 seed，結果相同。`
  if (mode === 'worker') return ` 執行環境：Web Worker${ms}（不佔用主執行緒）。`
  return ` 執行環境：主執行緒${ms}（這個環境沒有 Web Worker）。`
}

function ChainRow({ name, tex, value, unit, note }: { name: string; tex: string; value: string; unit: string; note?: string }) {
  return (
    <tr>
      <td data-label="量">{mathText(name)}</td>
      <td data-label="怎麼算">
        <Tex>{tex}</Tex>
      </td>
      <td data-label="數值" className="nowrap">
        <Tex>{value}</Tex>
      </td>
      <td data-label="單位">
        <Tex>{unit}</Tex>
        {note && (
          <div className="small muted">
            <Rich text={note} />
          </div>
        )}
      </td>
    </tr>
  )
}
