import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CaseSelector,
  ExperimentShell,
  mathText,
  ParamControl,
  SelectControl,
  Tex,
  texNum,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { corrFromPsd, corrSingleTone } from '@/simulation/models/pll'
import {
  calPole,
  classifyPolarity,
  DEFAULT_POLARITY_PARAMS,
  isToneEdge,
  kqFromSigma,
  MAX_CLOSED_LOOP_SAMPLES,
  type ClosedLoopCaseResult,
  type ClosedLoopParams,
  type PllPolarityParams,
  type PllPolarityResult,
  type PolarityParams,
} from '@/simulation/models/polarity'
import { analyzeTone, modelTextTex, POLARITY_EXPERIMENT_ID, polarityWarnings, sanitizeParams, verdict, withDefaults, type ToneAnalysis } from './explorerModel'
import { ExplorerPlots } from './ExplorerPlots'
import { f, fx } from '../shared'

type PllBatchParams = { items: (PllPolarityParams & { id: string })[] }
type PllBatchResult = { results: (PllPolarityResult & { id: string })[] }

/** 每個 case 的分析摘要（單頻：主執行緒解析；PLL：worker） */
export interface CaseSummary {
  id: string
  color: string
  params: PolarityParams
  tone: ToneAnalysis | null
  pll: PllPolarityResult | null
  /** 用於 pole 的 C_D（單頻：解析；PLL：時域經驗值） */
  C: number
  Kq: number
  pole: number
}

/** classifyPolarity 的參考大小：單頻 (A²/2)|H|（filtered-x 時 |H|²）；PLL 模式 σ_x² */
function summaryScale(s: CaseSummary): number {
  if (s.tone) return 0.5 * s.params.A * s.params.A * Math.max(s.params.regressor === 'u' ? s.params.mag * s.params.mag : s.params.mag, 1e-12)
  return s.pll ? s.pll.C.sigma2 : 1
}

/** 封閉式 vs 時域經驗值的容許誤差：iid 是隨機 code（抽樣誤差 ~1/√L ≈ 0.004，取 5σ）；其他是確定性 code（有限長度 ripple） */
function theoryTol(code: PolarityParams['code'], theory: number): number {
  return code === 'iid' ? 0.02 * Math.abs(theory) + 0.02 : 0.02 * Math.abs(theory) + 3e-3
}

function pllItem(p: PolarityParams, id: string, seed: number): PllPolarityParams & { id: string } {
  return {
    id,
    loopType: p.loopType,
    zeta: p.zeta,
    bwRatio: p.bwRatio,
    loopDelay: Math.round(p.loopDelay),
    code: p.code,
    toneRatio: p.toneRatio,
    frac: p.frac,
    D: Math.round(p.D),
    seed,
    delayMax: 48,
  }
}

/** §6/§7 Polarity Explorer（規格 §19；T06；L2）。單頻模式（|H|、φ、Ω、D）與 PLL 模式（Type-I/II、code 種類）。 */
export function PolarityExplorer() {
  const cases = useCases<PolarityParams>(DEFAULT_POLARITY_PARAMS, { seed: 20261010 })
  const { reset, update } = cases
  const [chains, setChains] = useState(8)
  const [runToken, setRunToken] = useState(0)
  const tokens = useThemeTokens()
  const active = cases.active.params
  const set = useCallback((patch: Partial<PolarityParams>) => update(patch), [update])

  const urlPreset = useUrlPreset(POLARITY_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) reset(withDefaults(urlPreset.params))
  }, [urlPreset, reset])
  const presets = useMemo(
    () => presetsForExperiment(POLARITY_EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )

  const dCases = useDebouncedValue(cases.cases, 250)
  const dSeed = useDebouncedValue(cases.seed, 250)

  // ── 單頻：主執行緒 ──
  const toneMap = useMemo(() => {
    const m = new Map<string, ToneAnalysis>()
    for (const c of dCases) if (c.params.mode === 'tone') m.set(c.id, analyzeTone(c.params))
    return m
  }, [dCases])

  // ── PLL：worker ──
  const pllTask = useWorkerTask<PllBatchParams, PllBatchResult>('polarity', 'analyzePllPolarityBatch', { restartOnRun: true })
  const runPll = pllTask.run
  const [pllMap, setPllMap] = useState<Map<string, PllPolarityResult>>(new Map())
  const [pllErr, setPllErr] = useState<string | null>(null)
  useEffect(() => {
    const items = dCases.filter((c) => c.params.mode === 'pll').map((c) => pllItem(c.params, c.id, dSeed))
    if (items.length === 0) {
      setPllMap(new Map())
      setPllErr(null)
      return
    }
    let alive = true
    runPll({ items })
      .then((r) => {
        if (!alive) return
        setPllMap(new Map(r.results.map((x) => [x.id, x])))
        setPllErr(null)
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) {
          setPllMap(new Map())
          setPllErr(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      alive = false
    }
  }, [dCases, dSeed, runPll])

  // ── 閉迴路：worker ──
  const loopTask = useWorkerTask<ClosedLoopParams, { results: ClosedLoopCaseResult[] }>('polarity', 'runPolarityClosedLoop', {
    restartOnRun: true,
  })
  const runLoop = loopTask.run
  const cancelLoop = loopTask.cancel
  // 結果連同「它是哪一組參數算出來的」一起存：參數剛改、新結果還沒回來時，舊結果仍可畫圖，但不拿來和新的解析值比對
  const [loopState, setLoopState] = useState<{ key: string; map: Map<string, ClosedLoopCaseResult> }>({ key: '', map: new Map() })
  const loopRes = loopState.map
  const [loopErr, setLoopErr] = useState<string | null>(null)
  const loopKey = useMemo(() => JSON.stringify([dCases.map((c) => [c.id, c.params]), dSeed, chains]), [dCases, dSeed, chains])
  const loopFresh = loopState.key === loopKey
  const tooBig = dCases.find((c) => Math.round(c.params.N) * Math.round(c.params.blocks) > MAX_CLOSED_LOOP_SAMPLES)
  useEffect(() => {
    if (tooBig) {
      setLoopState({ key: loopKey, map: new Map() })
      setLoopErr(
        String.raw`Case ${tooBig.id}：$N\times\text{blocks}=${Math.round(tooBig.params.N) * Math.round(tooBig.params.blocks)}$ 超過單條 chain 上限 ${MAX_CLOSED_LOOP_SAMPLES}，閉迴路模擬未執行（請減少 $N$ 或 blocks）。`,
      )
      return
    }
    let alive = true
    runLoop({ cases: dCases.map((c) => ({ ...c.params, id: c.id })), seed: dSeed, chains, reference: true })
      .then((r) => {
        if (!alive) return
        setLoopState({ key: loopKey, map: new Map(r.results.map((x) => [x.id, x])) })
        setLoopErr(null)
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) {
          setLoopState({ key: loopKey, map: new Map() })
          setLoopErr(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      alive = false
    }
  }, [dCases, dSeed, chains, runToken, runLoop, tooBig, loopKey])

  // ── 摘要 ──
  const summaries: CaseSummary[] = useMemo(
    () =>
      dCases.map((c) => {
        const tone = toneMap.get(c.id) ?? null
        const pll = c.params.mode === 'pll' ? (pllMap.get(c.id) ?? null) : null
        const Kq = kqFromSigma(c.params.sigmaV)
        // GMAC 實際使用的相關：raw / delayed x 用 C_D；filtered-x 用 E[u_D·u]
        const C = tone ? tone.Ceff : pll ? (c.params.regressor === 'u' ? pll.C.filtered : pll.C.empirical) : Number.NaN
        return { id: c.id, color: tokens.series[c.seriesIndex], params: c.params, tone, pll, C, Kq, pole: calPole(c.params.mu, Kq, C) }
      }),
    [dCases, toneMap, pllMap, tokens],
  )
  const activeSum = summaries.find((s) => s.id === cases.activeId) ?? summaries[0]
  // 指標與交叉比對只用「與目前參數相符」的閉迴路結果
  const activeLoop = activeSum && loopFresh ? loopRes.get(activeSum.id) : undefined

  // ── 警告（必須解釋原因）──
  const warnings: string[] = []
  const multi = summaries.length > 1
  for (const s of summaries) {
    const prefix = multi ? `Case ${s.id} — ` : ''
    const scale = summaryScale(s)
    if (Number.isFinite(s.C)) warnings.push(...polarityWarnings(prefix, s.C, classifyPolarity(s.C, scale), s.Kq, s.params.mu))
    if (s.tone?.edge) {
      warnings.push(
        String.raw`${prefix}$\Omega=${s.params.omega === 0 ? '0' : String.raw`\pi`}$（E46）：實係數 $h$ 的 $H(e^{j\Omega})$ 必為實數，$\phi$ 已吸附為 $${fx((s.tone.phiEffRad * 180) / Math.PI, 0)}^\circ$；此時 $C=A^2|H|\cos\phi\cos(\Omega D)$，是一般公式的 2 倍。`,
      )
    } else if (s.params.mode === 'tone' && s.params.N * Math.abs(Math.sin(s.params.omega)) < 4) {
      warnings.push(
        String.raw`${prefix}$\Omega$ 接近 0 或 $\pi$：$N|\sin\Omega|=${texNum(s.params.N * Math.abs(Math.sin(s.params.omega)), 3)}$，單一 GMAC block 的 ripple 上界 $${texNum(s.tone?.rippleN ?? NaN, 3)}$ 與 $|C|$ 同量級，個別 block 的 $G$ 可能變號（E46）；需多個 block 平均。`,
      )
    }
    // 模型的警告是純文字（Unicode 數學）：C ≤ 0／C ≈ 0 兩條已由上面的 polarityWarnings 取代，其餘換成 `$...$` 再顯示
    if (s.pll) for (const w of s.pll.warnings) if (!w.startsWith('C ≤ 0') && !w.startsWith('C ≈ 0')) warnings.push(prefix + modelTextTex(w))
    const lr = loopFresh ? loopRes.get(s.id) : undefined
    if (lr) for (const w of lr.warnings) warnings.push(prefix + modelTextTex(w))
  }
  if (pllErr) warnings.push(`PLL 分析無法執行：${modelTextTex(pllErr)}`)
  if (loopErr) warnings.push(modelTextTex(loopErr))

  // ── 指標（目前編輯的 case）──
  const metrics: MetricRow[] = []
  const ap = activeSum?.params ?? active // 與分析結果同一份（debounced）參數
  if (activeSum?.tone) {
    const t = activeSum.tone
    metrics.push(
      { name: '$C_D$（解析）', value: t.C, formulaId: 'F-06.4', claim: 'exact', note: isToneEdge(ap.omega) ? String.raw`$\Omega=0$ 或 $\pi$：2 倍公式（E46）` : String.raw`$\tfrac{A^2}{2}|H|\cos(\phi+\Omega D)$` },
      {
        name: '$C_D$（時域：實際 FIR 濾波）',
        value: t.Cemp,
        analytic: t.C,
        tolerance: t.empTol,
        claim: 'exact',
        note: `${t.empLength} 點平均；容許誤差 = 長度 ripple 上界 + 邊緣項`,
      },
      {
        name: '$C_D$（pll.ts corrSingleTone，共用實作）',
        value: corrSingleTone({ amplitude: ap.A, magnitude: ap.mag, phaseRad: t.phiEffRad, omega: ap.omega, delay: Math.round(ap.D) }),
        analytic: t.C,
        tolerance: 1e-12,
        claim: 'exact',
        note: '與本章 toneCorrelation 交叉比對',
      },
      {
        name: String.raw`filtered-x 的有效相關 $E[u_D\,u]$`,
        value: t.Cfx,
        claim: 'exact',
        note: ap.regressor === 'u' ? '目前 GMAC 用 $u$：pole 以此計算' : String.raw`若改用 filtered-x（$\hat H=H$）會得到的值`,
      },
      { name: String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$`, value: t.Kq, unit: String.raw`$\mathrm{fs}^{-1}$`, claim: 'approx' },
      { name: String.raw`平均 pole $p=1-\mu K_qC$`, value: t.pole, formulaId: 'F-06.3', claim: 'exact', note: ap.regressor === 'u' ? String.raw`$C=E[u_D\,u]$` : '$C=C_D$' },
      { name: String.raw`polarity margin $90^\circ-|\mathrm{wrap}_{180}(\phi+\Omega D)|$`, value: t.marginDeg, unit: 'deg', claim: 'exact' },
      { name: '有限 $N$ block 的 ripple 上界', value: t.rippleN, formulaId: 'F-06.5', claim: 'exact' },
      { name: String.raw`大誤差增益 $\tfrac{2A}{\pi}\cos(\phi+\Omega D)$（等分布）`, value: t.largeErrorGain, formulaId: 'F-06.15', claim: 'approx' },
    )
  } else if (activeSum?.pll) {
    const r = activeSum.pll
    metrics.push(
      { name: String.raw`$\omega_LT_s$`, value: r.design.wLTs, unit: 'rad/sample', note: ap.loopType === 'typeII' ? String.raw`$\omega_nT_s$` : String.raw`$\omega_cT_s=K$` },
      { name: String.raw`$\sigma_x^2$（standardize 後）`, value: r.C.sigma2 },
      {
        name: '$C_D$ 封閉式',
        value: r.C.theory,
        claim: 'exact',
        note: modelTextTex(r.C.theoryLabel),
      },
      { name: '$C_D$ 時域經驗值', value: r.C.empirical, analytic: r.C.theory ?? undefined, tolerance: r.C.theory !== null ? theoryTol(ap.code, r.C.theory) : undefined, claim: 'approx', note: ap.code === 'iid' ? String.raw`隨機 code：抽樣誤差 $\sim1/\sqrt L$` : '確定性 code：只差有限長度（非整數週期）的 ripple' },
      { name: '$C_D$ 週期圖譜線和', value: r.C.periodogram, analytic: r.C.empirical, tolerance: 0.01 * Math.abs(r.C.empirical) + 2e-3, formulaId: 'F-06.16', claim: 'exact' },
      { name: '$C_D$ 頻域積分（Welch PSD）', value: r.C.welch, analytic: r.C.empirical, tolerance: 0.05 * Math.abs(r.C.empirical) + 5e-3, formulaId: 'F-06.11', claim: 'approx' },
      {
        name: '$C_D$ 頻域積分（pll.ts corrFromPsd，共用實作）',
        value: corrFromPsd({ omega: r.psd.omega, sxx: r.psd.sxx, h: { b: r.design.b, a: r.design.a }, delay: Math.round(ap.D) }),
        analytic: r.C.welch,
        tolerance: 1e-9 + 1e-9 * Math.abs(r.C.welch),
        claim: 'exact',
        note: '同一個 Welch PSD，與本章 spectralCorrelation 交叉比對',
      },
      { name: String.raw`$C_D$ 自相關和 $\sum_kh[k]\,\hat R_x[k-D]$`, value: r.C.autocorr, analytic: r.C.empirical, tolerance: 0.01 * Math.abs(r.C.empirical) + 2e-3, formulaId: 'F-06.12', claim: 'exact' },
      { name: String.raw`filtered-x 的有效相關 $E[u_D\,u]$`, value: r.C.filtered, claim: 'approx', note: ap.regressor === 'u' ? '目前 GMAC 用 $u$：pole 以此計算' : String.raw`若改用 filtered-x（$\hat H=H$）會得到的值` },
      { name: String.raw`平均 pole $p=1-\mu K_qC$`, value: activeSum.pole, formulaId: 'F-06.3', claim: 'exact', note: ap.regressor === 'u' ? String.raw`$C=E[u_D\,u]$` : '$C=C_D$（時域）' },
      { name: String.raw`$\operatorname{Re}\{H\}<0$ 的第一個邊界 $\Omega_b/(\omega_LT_s)$`, value: r.bands.negative.length > 0 ? r.bands.negative[0][1] / r.design.wLTs : null, note: r.bands.negative.length > 0 ? '低於此頻率的 code 能量會反轉極性' : String.raw`沒有 $\operatorname{Re}\{H\}<0$ 的頻帶` },
      { name: String.raw`大誤差極限 $E[x_D\operatorname{sign}u]$（$\delta\to\infty$）`, value: r.largeErrorGain, formulaId: 'F-06.15', claim: 'approx', note: String.raw`$u$ 有長尾巴的 code（鋸齒經 Type-II）要極大的 $\delta$ 才到這個極限；中間請看 mean-field 曲線` },
      { name: '分析長度 / 暫態略過', value: `${r.length} / ${r.skip}`, unit: 'samples' },
    )
  }
  if (activeLoop) {
    metrics.push(
      { name: String.raw`閉迴路：in-run $C_D$（$x_{\mathrm{ref}}$ 與 $u$）`, value: activeLoop.C, analytic: Number.isFinite(activeSum?.C ?? NaN) ? activeSum?.C : undefined, tolerance: 0.02 * Math.abs(activeSum?.C ?? 0) + 0.01, claim: 'approx' },
      { name: String.raw`閉迴路：blockLms 參考模型的 $\hat C$`, value: activeLoop.reference?.Cest ?? null, note: '共用 L2 reference simulator（同 seed）' },
      { name: String.raw`閉迴路：MC 平均 $\bar\delta$ 在 $k^*=${activeLoop.check.k}$`, value: activeLoop.check.mean, unit: 'fs', analytic: activeLoop.check.pred, note: modelTextTex(activeLoop.check.note) },
      {
        name: String.raw`閉迴路：最後 block 平均 $\delta$`,
        value: activeLoop.deltaMean[activeLoop.deltaMean.length - 1],
        unit: 'fs',
        note: activeLoop.diverging ? '遠離 $a$（發散／漂移）' : activeLoop.pole > 1 ? '尚未明顯遠離，但線性 pole $>1$' : '留在 $a$ 附近',
      },
    )
    metrics.push({
      name: String.raw`閉迴路：線性穩態 RMS $\sigma_w$ 預測`,
      value: Number.isFinite(activeLoop.sigmaWPred) ? activeLoop.sigmaWPred : null,
      unit: 'fs',
      claim: 'approx',
      note: Number.isFinite(activeLoop.sigmaWPred) ? String.raw`$\mu\sqrt{E[x_{\mathrm{ref}}^2]/N/(1-p^2)}$；「遠離 $a$」的判定門檻含 $4\sigma_w$，避免把穩定但吵的迴路誤判` : String.raw`$|p|\ge1$：沒有穩態`,
    })
    metrics.push({
      name: String.raw`PD 看到的 $u$：峰值 $u_{\max}$ / RMS`,
      value: `${f(activeLoop.uMax, 4)} / ${f(activeLoop.uRms, 4)}`,
      note: String.raw`線性區上限 $0.3\,\sigma_v/u_{\max}=${texNum((0.3 * ap.sigmaV) / Math.max(activeLoop.uMax, 1e-300), 3)}\,\mathrm{fs}$（Monte Carlo 只在這個範圍內和線性 pole 比對）`,
    })
    metrics.push({
      name: String.raw`mean-field 變號點 $\delta_c$`,
      value: activeLoop.sCurve.cross,
      unit: 'fs',
      formulaId: 'F-06.19',
      claim: 'approx',
      note:
        activeLoop.sCurve.cross === null
          ? String.raw`$E[G](\delta)$ 在 $0.02\dots50\,\sigma_v/u_{\max}$ 內與小訊號斜率同號（極性不隨誤差大小改變）`
          : activeLoop.C > 0
            ? String.raw`$C>0$ 但只有局部穩定：$|\delta|>\delta_c$ 時平均更新方向反過來（basin 有限）`
            : String.raw`$C<0$：遠離 $a$ 之後平均動態會停在 $|\delta|\approx\delta_c$`,
    })
    if (activeLoop.diverging && Number.isFinite(activeLoop.driftPred)) {
      metrics.push({
        name: String.raw`閉迴路：chain 0 的 $|\delta|$ 漂移斜率（最後 1/4）`,
        value: activeLoop.driftSlope,
        unit: 'fs/block',
        analytic: activeLoop.driftPred,
        tolerance: activeLoop.driftTol,
        formulaId: 'F-06.19',
        claim: 'approx',
        note: String.raw`預測 = $\mu\,|E[G](\delta)|$（mean-field：$E[x_{\mathrm{ref}}\,\mathrm{erf}(\delta u/\sqrt2\sigma_v)]$）；單頻且完全飽和時退化成 F-06.15${activeLoop.saturated ? '' : '（尚未完全進入飽和區）'}`,
      })
    }
  }

  // ── 交叉比對 ──
  let analytic: CheckEntry = { status: 'n/a', note: '計算中' }
  if (activeSum?.tone) {
    const t = activeSum.tone
    const ok = Math.abs(t.Cemp - t.C) <= t.empTol
    analytic = { status: ok ? 'ok' : 'mismatch', note: `解析 ${f(t.C, 5)} vs 時域 ${f(t.Cemp, 5)}` }
  } else if (activeSum?.pll) {
    const c = activeSum.pll.C
    const ref = c.empirical
    const tol = 0.02 * Math.abs(ref) + 3e-3
    const ok = Math.abs(c.periodogram - ref) <= tol && Math.abs(c.autocorr - ref) <= tol && (c.theory === null || Math.abs(c.theory - ref) <= theoryTol(activeSum.params.code, c.theory))
    analytic = { status: ok ? 'ok' : 'mismatch', note: `時域 ${f(ref, 4)}、譜線和 ${f(c.periodogram, 4)}、自相關 ${f(c.autocorr, 4)}${c.theory !== null ? `、封閉式 ${f(c.theory, 4)}` : ''}` }
  }
  let monteCarlo: CheckEntry = { status: 'n/a', note: loopTask.running ? '模擬中' : loopErr ? modelTextTex(loopErr) : '尚未執行' }
  if (activeLoop) {
    let refNote = ''
    if (activeLoop.reference && activeLoop.deltaChains[0]) {
      let maxd = 0
      const a0 = activeLoop.deltaChains[0]
      for (let k = 0; k < a0.length; k++) maxd = Math.max(maxd, Math.abs(a0[k] - activeLoop.reference.delta[k]))
      refNote = String.raw`；chain 0 與 blockLms 參考模型最大差 $${texNum(maxd, 2)}\,\mathrm{fs}$`
    }
    monteCarlo = { status: activeLoop.check.status, note: modelTextTex(activeLoop.check.note) + refNote }
  } else if (!loopFresh && !loopErr) {
    monteCarlo = { status: 'n/a', note: '模擬中（參數已變更，等待新的閉迴路結果）' }
  }

  const exportData = () => {
    const out: Record<string, ArrayLike<number>> = {}
    for (const s of summaries) {
      if (s.tone) {
        out[`${s.id}_D`] = s.tone.CD.D
        out[`${s.id}_CD_analytic`] = s.tone.CD.analytic
        out[`${s.id}_CD_empirical`] = s.tone.CD.empirical
        out[`${s.id}_wave_n`] = s.tone.wave.n
        out[`${s.id}_wave_x`] = s.tone.wave.x
        out[`${s.id}_wave_u`] = s.tone.wave.u
      }
      if (s.pll) {
        out[`${s.id}_D`] = s.pll.CD.D
        out[`${s.id}_CD_empirical`] = s.pll.CD.empirical
        out[`${s.id}_CD_periodogram`] = s.pll.CD.periodogram
        if (s.pll.CD.theory) out[`${s.id}_CD_closed_form`] = s.pll.CD.theory
        out[`${s.id}_omega`] = s.pll.grid.omega
        out[`${s.id}_ReH`] = s.pll.grid.re
      }
      const lr = loopFresh ? loopRes.get(s.id) : undefined
      if (lr) {
        out[`${s.id}_delta_mean_fs`] = lr.deltaMean
        out[`${s.id}_delta_linear_pred_fs`] = lr.predLinear
        if (lr.reference) out[`${s.id}_delta_blockLms_fs`] = lr.reference.delta
        out[`${s.id}_meanfield_delta_fs`] = lr.sCurve.delta
        out[`${s.id}_meanfield_G`] = lr.sCurve.G
      }
    }
    return out
  }

  const isTone = active.mode === 'tone'
  const omegaDeg = (active.omega * 180) / Math.PI
  const assumptions = [
    String.raw`$\delta=a-w$ 極性；average-mode GMAC；$w_{k+1}=w_k+\mu G_k$（無更新延遲）`,
    String.raw`comparator 前雜訊 $v\sim\mathcal N(0,\sigma_v^2)$ iid；$q=\operatorname{sign}(e)$，$e=0$（tie）時取 $q=+1$`,
    String.raw`$H_{\mathrm{PD}}$ 為 LTI 且狀態跨 block 持續；PLL 與 comparator 同一取樣率（E44）`,
    isTone
      ? String.raw`單頻模式：2-tap FIR 在 $\Omega$ 精確給出 $|H|e^{j\phi}$；code 不正規化（振幅 $A$）`
      : String.raw`PLL 模式：DT Type-I / Type-II 迴路（E44）；code 以 standardize 正規化（$\sigma_x^2=1$）`,
    String.raw`pole $p=1-\mu K_qC$ 為小訊號線性化平均模型（$|\delta|\,u_{\max}\le0.3\,\sigma_v$ 才比對）；閉迴路為逐 sample 的非線性 sign-LMS；mean-field 曲線假設 $w$ 在 $H_{\mathrm{PD}}$ 的記憶長度內近似常數`,
  ]

  return (
    <ExperimentShell
      id={POLARITY_EXPERIMENT_ID}
      title="Polarity Explorer：PLL 相位與 GMAC 更新極性"
      level="L2"
      claim="exact"
      tests={['T06']}
      description={
        <>
          單頻模式直接指定 <Tex>{'|H|,\\phi,\\Omega,D'}</Tex>；PLL 模式由 Type-I / Type-II DT 迴路與 code 種類（tone、一階 DSM、MASH、iid）決定 <Tex>{'H_{\\mathrm{PD}}'}</Tex>{' '}
          與 code 頻譜。用 Case A / B / C 在同一個 seed 下比較。
        </>
      }
      assumptions={assumptions}
      params={{ ...active, chains }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{
        mag: '—',
        phiDeg: 'deg',
        omega: 'rad/sample',
        A: '—',
        D: 'samples',
        zeta: '—',
        bwRatio: 'BW/f_ref',
        loopDelay: 'samples',
        toneRatio: 'Ω/(ω_L T_s)',
        frac: 'FCW frac',
        mu: 'fs',
        sigmaV: 'fs',
        N: 'samples',
        blocks: 'blocks',
        a: 'fs',
        w0: 'fs',
      }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic,
        monteCarlo,
        fixedPoint: { status: 'not-implemented', note: '定點 gain register / GMAC 位寬見第 13 章與 Calibration Lab' },
      }}
      actions={{
        onReset: () => reset(DEFAULT_POLARITY_PARAMS),
        onRun: () => setRunToken((t) => t + 1),
        onStop: cancelLoop,
        running: loopTask.running,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => set(sanitizeParams(p.params))}
      controls={
        <>
          <p className="small muted">
            目前編輯：<strong>Case {cases.activeId}</strong>
          </p>
          <SelectControl
            label="模式"
            value={active.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'tone', label: '單頻（直接指定 |H|、φ、Ω）' },
              { value: 'pll', label: 'PLL（Type-I / II 迴路 + code）' },
            ]}
            reg="Behavioral: polarity_explorer.mode"
          />
          {isTone ? (
            <div className="ch06-controls-group">
              <div className="ch06-controls-title">單頻路徑與 code</div>
              <ParamControl label={<Tex>{'|H|'}</Tex>} ariaLabel="|H|（路徑增益）" value={active.mag} onChange={(mag) => set({ mag })} min={0} max={3} step={0.01} reg="pll_error_path.single_tone.magnitude" />
              <ParamControl
                label={<Tex>{'\\phi=\\angle H(e^{j\\Omega})'}</Tex>}
                ariaLabel="φ（路徑相位）"
                value={active.phiDeg}
                onChange={(phiDeg) => set({ phiDeg })}
                min={-180}
                max={180}
                step={1}
                unit="deg"
                reg="pll_error_path.single_tone.phase_deg"
                hint={<Tex>{'|\\mathrm{wrap}(\\phi+\\Omega D)|>90^\\circ\\Rightarrow C<0'}</Tex>}
              />
              <ParamControl
                label={<Tex>{'\\Omega'}</Tex>}
                ariaLabel="Ω（code 角頻率）"
                value={active.omega}
                onChange={(omega) => set({ omega })}
                min={0}
                max={Math.PI}
                step={0.001}
                unit="rad/sample"
                digits={7}
                reg="seeded_pattern.sinusoid.omega"
                hint={mathText(String.raw`= $${fx(omegaDeg, 2)}^\circ$/sample，週期 ${active.omega > 0 ? fx((2 * Math.PI) / active.omega, 2) : String.raw`$\infty$`} samples；$\Omega=0,\pi$ 為 E46 邊界`)}
              />
              <ParamControl label={mathText('$A$（code 振幅）')} ariaLabel="A（code 振幅）" value={active.A} onChange={(A) => set({ A })} min={0.01} max={4} step={0.01} reg="seeded_pattern.sinusoid.amplitude" />
            </div>
          ) : (
            <div className="ch06-controls-group">
              <div className="ch06-controls-title">主 PLL 與 code</div>
              <SelectControl
                label="迴路型式"
                value={active.loopType}
                onChange={(loopType) => set({ loopType })}
                options={[
                  { value: 'typeII', label: 'Type-II（PI + DCO）' },
                  { value: 'typeI', label: 'Type-I（比例 + DCO）' },
                ]}
                reg="Behavioral: pll_loop.type"
              />
              <ParamControl label={<Tex>{'\\zeta'}</Tex>} ariaLabel="ζ（阻尼比）" value={active.zeta} onChange={(zeta) => set({ zeta })} min={0.2} max={3} step={0.01} reg="REG_PLL_KP / REG_PLL_KI → ζ" disabled={active.loopType === 'typeI'} />
              <ParamControl
                label={<Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}'}</Tex>}
                ariaLabel="BW/f_ref"
                value={active.bwRatio}
                onChange={(bwRatio) => set({ bwRatio })}
                min={1e-4}
                max={0.05}
                log
                reg="REG_PLL_KP / REG_PLL_KI → −3 dB 頻寬"
                hint={mathText(String.raw`CT 原型 $T(s)$ 的 $-3\,\mathrm{dB}$ 頻寬除以 $f_{\mathrm{ref}}$（$=f_s$）`)}
              />
              <ParamControl
                label={mathText('loop latency $d$')}
                ariaLabel="loop latency d"
                value={active.loopDelay}
                onChange={(loopDelay) => set({ loopDelay })}
                min={0}
                max={8}
                integer
                clampOnBlur
                unit="samples"
                reg="REG_PLL_LATENCY"
              />
              <SelectControl
                label="code"
                value={active.code}
                onChange={(code) => set({ code })}
                options={[
                  { value: 'tone', label: '單頻 tone' },
                  { value: 'dsm1', label: '一階 DSM residue' },
                  { value: 'mash', label: 'MASH 1-1-1 residue' },
                  { value: 'iid', label: 'iid ±1（白色）' },
                ]}
                reg="seeded_pattern.kind"
              />
              {active.code === 'tone' ? (
                <ParamControl
                  label={
                    <>
                      tone 頻率 <Tex>{'\\Omega/(\\omega_LT_s)'}</Tex>
                    </>
                  }
                  ariaLabel="tone 頻率比 Ω/(ω_L T_s)"
                  value={active.toneRatio}
                  onChange={(toneRatio) => set({ toneRatio })}
                  min={0.01}
                  max={100}
                  log
                  reg="seeded_pattern.sinusoid.omega"
                  hint={
                    <>
                      <Tex>{'\\Omega=\\text{ratio}\\cdot\\omega_LT_s'}</Tex>；Type-II：比值 <Tex>{'\\lesssim1'}</Tex> 時 <Tex>{'\\operatorname{Re}H<0'}</Tex>
                    </>
                  }
                />
              ) : active.code === 'iid' ? null : (
                <ParamControl
                  label={mathText(String.raw`FCW 小數 $\mathrm{frac}$`)}
                  ariaLabel="FCW 小數 frac"
                  value={active.frac}
                  onChange={(frac) => set({ frac })}
                  min={1e-4}
                  max={0.5}
                  log
                  reg="REG_FCW_FRAC[19:0]（20-bit DSM）"
                  hint={mathText(String.raw`近整數 = $\mathrm{frac}$ 很小（§6.4）`)}
                />
              )}
            </div>
          )}
          <div className="ch06-controls-group">
            <div className="ch06-controls-title">GMAC 與閉迴路</div>
            <ParamControl
              label={mathText('GMAC code delay $D$')}
              ariaLabel="GMAC code delay D"
              value={active.D}
              onChange={(D) => set({ D })}
              min={0}
              max={isTone ? 64 : 48}
              integer
              clampOnBlur
              unit="samples"
              reg="REG_GMAC_CODE_DLY（gm_code_delay_samples）"
              hint={mathText('$D>0$：GMAC 用 $x[n-D]$（delay alignment，第 07 章）')}
            />
            <SelectControl
              label="GMAC regressor"
              value={active.regressor}
              onChange={(regressor) => set({ regressor })}
              options={[
                { value: 'x', label: 'raw / delayed x（硬體預設）' },
                { value: 'u', label: 'filtered-x u = h * x（Ĥ = H 理想，預覽第 07 章）' },
              ]}
              reg="regressor_mode"
            />
            <ParamControl label={mathText(String.raw`$\mu$（gain_step）`)} ariaLabel="μ（gain_step）" value={active.mu} onChange={(mu) => set({ mu })} min={0.01} max={1000} log unit="fs" reg="REG_GAIN_STEP（gain_step）" />
            <ParamControl label={<Tex>{'\\sigma_v'}</Tex>} ariaLabel="σ_v（comparator 前雜訊）" value={active.sigmaV} onChange={(sigmaV) => set({ sigmaV })} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs（comparator 前雜訊）" hint={mathText(String.raw`$K_q=${texNum(kqFromSigma(active.sigmaV), 4)}\,\mathrm{fs}^{-1}$`)} />
            <ParamControl label={mathText('$N$（GMAC block 長度）')} ariaLabel="N（GMAC block 長度）" value={active.N} onChange={(N) => set({ N })} min={16} max={16384} log integer clampOnBlur unit="samples" reg="REG_GMAC_N[15:0]（gm_accum_samples）" />
            <ParamControl label="blocks" value={active.blocks} onChange={(blocks) => set({ blocks })} min={20} max={2000} integer clampOnBlur reg="num_blocks" />
            <ParamControl label={mathText('$a$（真實 gain）')} ariaLabel="a（真實 gain）" value={active.a} onChange={(a) => set({ a })} min={-50} max={50} step={0.1} unit="fs" reg="gain_true" />
            <ParamControl label={mathText('$w_0$（初值）')} ariaLabel="w₀（初值）" value={active.w0} onChange={(w0) => set({ w0 })} min={-50} max={50} step={0.1} unit="fs" reg="gain_initial（REG_GAIN_INIT）" />
            <ParamControl label="Monte Carlo chains" value={chains} onChange={setChains} min={1} max={32} integer clampOnBlur reg="Behavioral: MC chains（每條不同 comparator 雜訊）" />
          </div>
        </>
      }
    >
      <CaseSelector cases={cases} label="比較 Case（同一 seed）" />
      <div className="table-wrap">
        <table className="ch06-table ch06-case-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>模式</th>
              <th className="num">
                <Tex>{'C_D'}</Tex>
              </th>
              <th className="num">
                <Tex>{'p=1-\\mu K_qC'}</Tex>
              </th>
              <th>判定</th>
              <th>閉迴路</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const scale = summaryScale(s)
              const v = Number.isFinite(s.C) ? verdict(classifyPolarity(s.C, scale), s.pole) : null
              const lr = loopFresh ? loopRes.get(s.id) : undefined
              return (
                <tr key={s.id}>
                  <td>
                    <span className="ch06-case-badge" style={{ background: s.color }}>
                      {s.id}
                    </span>
                  </td>
                  <td>
                    {mathText(
                      (s.params.mode === 'tone'
                        ? String.raw`單頻 $\phi=${fx(s.params.phiDeg, 0)}^\circ$、$\Omega=${texNum(s.params.omega, 4)}$`
                        : `${s.params.loopType === 'typeII' ? 'Type-II' : 'Type-I'}、${s.params.code}`) + (s.params.D > 0 ? `、$D=${Math.round(s.params.D)}$` : ''),
                    )}
                  </td>
                  <td className={`num ${s.C < 0 ? 'neg' : s.C > 0 ? 'pos' : ''}`}>{f(s.C, 4)}</td>
                  <td className="num">{f(s.pole, 6)}</td>
                  <td>{v ? <span className={`ch06-verdict ${v.tone}`}>{mathText(v.text)}</span> : '計算中…'}</td>
                  <td data-loop-state={lr ? (lr.diverging ? (v?.tone === 'pos' ? 'left-basin' : 'diverging') : v?.tone === 'neg' ? 'near-but-unstable' : 'near') : 'pending'}>
                    {mathText(
                      lr
                        ? lr.diverging
                          ? v?.tone === 'pos'
                            ? '遠離 $a$（線性 pole 穩定，但離開了 basin）'
                            : '遠離 $a$'
                          : v?.tone === 'neg'
                            ? '還在 $a$ 附近，但 $|p|>1$（多跑幾個 block 會遠離）'
                            : '留在 $a$ 附近'
                        : loopErr
                          ? '—'
                          : '計算中…',
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ExplorerPlots summaries={summaries} activeId={cases.activeId} loopRes={loopRes} />
    </ExperimentShell>
  )
}
