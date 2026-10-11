import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Callout,
  ClaimTag,
  ExperimentShell,
  MathText,
  ModeGate,
  Plot,
  Tex,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type CheckStatus,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  analyzeFxLab,
  CL_Z_MISMATCH,
  closedLoopConsistent,
  meanWStdErr,
  type FxCaseSpec,
  type FxComparisonResult,
  type FxLabAnalysis,
  type FxScenario,
} from '@/simulation/models/filteredX'
import {
  DEFAULT_CASES,
  DEFAULT_SCENARIO,
  DEFAULT_SEED,
  EXPERIMENT_ID,
  MAX_BLOCKS,
  CONVERGENCE_TAUS,
  MODE_LABEL,
  blocksToConverge,
  parseLabPreset,
  toCaseSpec,
  toCodeSpec,
  toFxScenario,
  toHatSpec,
  toPathSpec,
  type LabCase,
  type LabScenario,
} from './labState'
import { closedLoopFigure, phaseFigure, sweepFigure, waveFigure } from './labPlots'
import { LabControls } from './LabControls'
import { CLOSED_LOOP_WARNING, diagMath } from './diagText'
import { fx, kq, signClass, txs } from '../util'

const r = String.raw

interface ComparisonParams {
  scenario: FxScenario
  cases: { id: string; spec: FxCaseSpec }[]
}

/** 自動重跑閉迴路的總 sample 上限（超過時需按「執行」） */
const AUTO_RUN_LIMIT = 6_000_000
/** 參數的值相等鍵（scenario + 最多 3 個 Case，很小）：用來避免重複執行、以及判斷說明訊息是否仍適用 */
const paramsKey = (p: ComparisonParams): string => JSON.stringify(p)

/**
 * Case 的一句話描述。tex = false：純文字（匯出的 params JSON）；
 * tex = true：數學寫成 `$...$`，給頁面上經過 mathText 的地方、以及 Plot 的圖例（plotMath 轉成斜體符號）用。
 */
function caseLabel(c: LabCase, tex = false): string {
  const eq = (plain: string, math: string): string => (tex ? `$${math}$` : plain)
  if (c.mode === 'raw') return 'raw-x'
  if (c.mode === 'delayed') return `delayed-x，${eq(`D = ${c.D}`, `D=${c.D}`)}`
  const mis: string[] = []
  if (c.hatBase === 'second_diff') mis.push('二次差分')
  if (c.bwErrPct) mis.push(`頻寬 ${c.bwErrPct > 0 ? '+' : ''}${c.bwErrPct}%`)
  // 二次差分沒有 loop latency 參數（buildHat 忽略 Δd）
  if (c.loopDelayErr && c.hatBase !== 'second_diff') mis.push(eq(`Δd = ${c.loopDelayErr}`, r`\Delta d=${c.loopDelayErr}`))
  if (c.extraDelay) mis.push(eq(`Δ = ${c.extraDelay}`, r`\Delta=${c.extraDelay}`))
  if (c.phaseErrDeg) mis.push(eq(`Δφ = ${c.phaseErrDeg}°`, r`\Delta\phi=${c.phaseErrDeg}^\circ`))
  if (c.gainErrPct) mis.push(`增益 ${c.gainErrPct > 0 ? '+' : ''}${c.gainErrPct}%`)
  return `filtered-x${c.D ? `，${eq(`D = ${c.D}`, `D=${c.D}`)}` : ''}${mis.length ? `（${mis.join('、')}）` : `（${eq('Ĥ = H', r`\hat H=H`)}）`}`
}

/**
 * 實驗 'delay-fx-lab'（L2，T07）：raw-x / delayed-x / filtered-x 三模式、Ĥ 模型誤差、x/u/x_D/u_f 疊圖、相關 vs D、
 * 逐頻率相位，以及同一 seed 的閉迴路 A/B/C 比較（runBlockLms，Web Worker）。
 */
export function DelayFxLab() {
  const tokens = useThemeTokens()
  const [scenario, setScenarioState] = useState<LabScenario>(DEFAULT_SCENARIO)
  const setScenario = useCallback((patch: Partial<LabScenario>) => setScenarioState((s) => ({ ...s, ...patch })), [])
  const cases = useCases<LabCase>(DEFAULT_CASES[0], { seed: DEFAULT_SEED })

  // A/B/C 尚未初始化（pending）時閉迴路不跑；此 ref 必須在閉迴路 effect 之前宣告
  const pending = useRef<LabCase[] | null>(DEFAULT_CASES)

  // ── 閉迴路 A/B/C（Web Worker；debounce）──
  const task = useWorkerTask<ComparisonParams, FxComparisonResult>('filteredX', 'runFxComparison', { restartOnRun: true })
  const clParams: ComparisonParams = useMemo(
    () => ({
      scenario: toFxScenario(scenario, cases.seed),
      cases: cases.cases.map((c) => ({ id: c.id, spec: toCaseSpec(c.params) })),
    }),
    [scenario, cases.cases, cases.seed],
  )
  const totalSamples = clParams.cases.length * scenario.N * scenario.blocks
  const debounced = useDebouncedValue(clParams, 450)
  const [cl, setCl] = useState<{ params: ComparisonParams; result: FxComparisonResult } | null>(null)
  const [clError, setClError] = useState<string | null>(null)
  // Run-to-Convergence 的說明訊息（無法收斂的原因、或被上限截斷）；記下當時的參數，參數一變就不再顯示
  const [convNote, setConvNote] = useState<{ key: string; text: string } | null>(null)
  const lastRunKey = useRef<string | null>(null)
  const runTask = task.run
  const runClosedLoop = useCallback(
    (p: ComparisonParams) => {
      lastRunKey.current = paramsKey(p)
      runTask(p).then(
        (result) => {
          setCl({ params: p, result })
          setClError(null)
        },
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setClError(e instanceof Error ? e.message : String(e))
        },
      )
    },
    [runTask],
  )
  useEffect(() => {
    // 這個 effect 宣告在 pending effect 之前：掛載時 pending 尚未消耗，不會先跑一次只有 Case A 的模擬
    if (pending.current !== null) return
    // 同一組參數已經（由 Run 或 Run-to-Convergence）跑過就不再重跑
    if (paramsKey(debounced) === lastRunKey.current) return
    if (debounced.cases.length * debounced.scenario.N * debounced.scenario.blocks <= AUTO_RUN_LIMIT) runClosedLoop(debounced)
  }, [debounced, runClosedLoop])
  // ── A/B/C 初始化與 preset 套用（useCases 只從 Case A 開始；兩階段加入 B、C）──
  useEffect(() => {
    const list = pending.current
    if (!list || cases.cases.length !== 1) return
    pending.current = null
    const ids = list.slice(1).map(() => cases.addCase())
    ids.forEach((id, i) => {
      if (id) cases.update(list[i + 1], id)
    })
    cases.setActive('A')
  }, [cases])

  const applyPreset = useCallback(
    (params: unknown) => {
      const parsed = parseLabPreset(params)
      if (!parsed) return
      setScenarioState(parsed.scenario)
      pending.current = parsed.cases
      cases.reset(parsed.cases[0])
      if (parsed.seed !== undefined) cases.setSeed(parsed.seed)
    },
    [cases],
  )
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const appliedUrl = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && appliedUrl.current !== urlPreset.id) {
      appliedUrl.current = urlPreset.id
      applyPreset(urlPreset.params)
    }
  }, [urlPreset, applyPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )

  // ── 即時分析（目前 Case；約 3·10⁴ samples，主執行緒）──
  const active = cases.active.params
  const seed = cases.seed
  const analysisRaw = useMemo(() => ({ scenario, active, seed }), [scenario, active, seed])
  const analysisInput = useDeferredValue(analysisRaw)
  const analysis = useMemo((): { ok: true; an: FxLabAnalysis } | { ok: false; error: string } => {
    const { scenario: s, active: c, seed: sd } = analysisInput
    try {
      const an = analyzeFxLab({
        path: toPathSpec(s),
        code: toCodeSpec(s),
        mode: c.mode,
        D: c.D,
        hat: toHatSpec(c),
        seed: sd,
        Dmax: Math.max(s.Dmax, c.mode === 'raw' ? 0 : c.D),
      })
      return { ok: true, an }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [analysisInput])

  // 結果是否對應目前的參數（以值比較：Run-to-Convergence 送出的參數物件與之後重算的 clParams 不是同一個物件）
  const clKey = useMemo(() => paramsKey(clParams), [clParams])
  const resultKey = useMemo(() => (cl ? paramsKey(cl.params) : null), [cl])
  const stale = resultKey !== null && resultKey !== clKey

  /** Run-to-Convergence：依目前結果的 τ 加長 block 數後重跑；沒有會收斂的 Case 時說明原因 */
  const runToConvergence = () => {
    // 還沒有結果、或結果不是目前這組參數的：先照目前設定跑一次（τ 要用目前參數的）
    if (!cl || stale) {
      runClosedLoop(clParams)
      return
    }
    const need = blocksToConverge(cl.result.cases)
    if (need === null) {
      setConvNote({ key: clKey, text: r`Run-to-Convergence：沒有任何 Case 預測會收斂（$C\le0$：極性錯誤；或 $C\approx0$：沒有恢復力）——加長模擬也不會收斂，請先修正 regressor（$D$ 或 $\hat H$）` })
      return
    }
    const next: ComparisonParams = { ...clParams, scenario: { ...clParams.scenario, blocks: Math.max(need.blocks, clParams.scenario.blocks) } }
    if (need.capped) {
      setConvNote({ key: paramsKey(next), text: r`Run-to-Convergence：最慢的 Case 需要超過 ${MAX_BLOCKS} 個 block 才到 $${CONVERGENCE_TAUS}\tau$，已截在上限 ${MAX_BLOCKS}；請加大該 Case 的 $\mu$（以 block 計的 $\tau$ 只由 $g=\mu K_qC$ 決定）` })
    }
    if (next.scenario.blocks !== scenario.blocks) setScenario({ blocks: next.scenario.blocks })
    // 直接跑一次（不受自動重跑的樣本數上限限制）；debounce 的自動重跑看到同一組參數會略過
    runClosedLoop(next)
  }

  // ── 指標、警告、交叉比對 ──
  const an = analysis.ok ? analysis.an : null
  const Kq = kq(scenario.sigmaV)
  const warnings: string[] = []
  // 模型回傳的診斷訊息是純文字：顯示前用 diagMath 把 Unicode 拼的數學換成 `$...$`（warnings 會經過 mathText）
  if (!analysis.ok) warnings.push(`分析失敗：${diagMath(analysis.error)}`)
  if (an) warnings.push(...an.warnings.map((w) => `Case ${cases.activeId}：${diagMath(w)}`))
  if (scenario.codeKind === 'sinusoid') {
    const nSin = scenario.N * Math.abs(Math.sin(scenario.omega))
    if (nSin < 4) {
      warnings.push(
        r`$N\,|\sin\Omega|=${txs(nSin, 3)}<4$：GMAC block 太短，單一 block 的單頻相關有明顯 ripple、甚至可能變號（E46 有限 $N$）；請加大 $N$，或讓 $N$ 為 code 週期 $2\pi/\Omega$ 的整數倍`,
      )
    }
  }
  if (totalSamples > AUTO_RUN_LIMIT && resultKey !== clKey && !task.running) {
    warnings.push(`閉迴路總樣本數 ${totalSamples.toLocaleString()} 超過自動重跑上限 ${AUTO_RUN_LIMIT.toLocaleString()}，目前顯示的不是這組參數的結果：請按「執行 Run」`)
  }
  if (clError) warnings.push(`閉迴路模擬錯誤：${diagMath(clError)}`)
  if (convNote && convNote.key === clKey) warnings.push(convNote.text)
  if (cl) {
    for (const c of cl.result.cases) {
      for (const w of c.warnings) {
        if (CLOSED_LOOP_WARNING.test(w)) warnings.push(`Case ${c.id}（閉迴路）：${diagMath(w)}`)
      }
    }
  }

  const corrRow = (name: string, pair: FxLabAnalysis['corr']['raw'], formulaId: string, note?: string): MetricRow => ({
    name,
    value: pair.empirical,
    analytic: pair.analytic ?? undefined,
    tolerance: pair.analytic !== null ? 5 * pair.se + 1e-9 : undefined,
    formulaId,
    claim: 'exact',
    digits: 5,
    note: note ?? (pair.analytic === null ? '無封閉式 PSD：只有經驗值' : r`經驗值 $\pm5$ SE（SE $=${txs(pair.se, 2)}$）`),
  })
  const metrics: MetricRow[] = []
  if (an) {
    metrics.push(corrRow(r`$C_{\mathrm{raw}}=E[x\,u]$`, an.corr.raw, 'F-07.8'))
    metrics.push(corrRow(r`$C_D=E\big[x[n-${active.D}]\,u\big]$`, an.corr.delayed, 'F-07.8'))
    metrics.push(corrRow(r`$E[u\,u_f]$（$D=${active.D}$）`, an.corr.filtered, 'F-07.12'))
    metrics.push(corrRow(r`$E[u^2]$`, an.Eu2, 'F-07.12', r`$\hat H=H$ 時 filtered-x 的相關`))
    metrics.push({ name: r`$\rho$（${MODE_LABEL[active.mode]}，Case ${cases.activeId}）`, value: an.rhoActive, formulaId: 'F-07.13', claim: 'exact', digits: 4, note: r`Cauchy–Schwarz：$|\rho|\le1$` })
    if (an.tone) {
      metrics.push({ name: r`殘餘相位 $\theta$（code 頻率）`, value: an.tone.thetaDeg, unit: 'deg', formulaId: 'F-07.4', claim: 'exact', digits: 5 })
      metrics.push({ name: r`polarity margin $90^\circ-|\theta|$`, value: an.tone.marginDeg, unit: 'deg', formulaId: 'F-07.4', claim: 'exact', digits: 5 })
      metrics.push({ name: r`$D^\star$（延遲 code 的連續解）`, value: an.tone.best.continuous, unit: 'samples', formulaId: 'F-07.4', claim: 'exact', digits: 6, note: r`整數最佳 $D=${an.tone.best.D}$` })
    }
    const cAct = an.corr.active.analytic ?? an.corr.active.empirical
    metrics.push({
      name: r`平均 pole $p=1-\mu K_qC$（Case ${cases.activeId}）`,
      value: 1 - active.mu * Kq * cAct,
      formulaId: 'F-07.11',
      claim: 'approx',
      digits: 6,
      note: r`$K_q=${txs(Kq, 4)}\ \mathrm{fs^{-1}}$`,
    })
  }
  if (cl) {
    for (const c of cl.result.cases) {
      // 只有「預測收斂、且 block 數 ≥ 10τ」時才拿固定點當解析值比對；容許 5 個標準誤（與 crossCheck 相同的判準）
      const K = c.w.length - 1
      const settled = c.analytic.stableMean && c.analytic.g > 1e-3 && Number.isFinite(c.analytic.tauBlocks) && K >= 10 * c.analytic.tauBlocks
      const se = settled ? meanWStdErr(c.analytic.sigmaWPred, c.analytic.p, K + 1 - Math.ceil((K + 1) / 2)) : NaN
      metrics.push({
        name: r`Case ${c.id}：後半段 mean $w$`,
        value: c.metrics.diverged ? '發散' : c.metrics.meanW,
        unit: 'fs',
        analytic: settled && Number.isFinite(c.analytic.wStarMeanField) ? c.analytic.wStarMeanField : undefined,
        tolerance: Number.isFinite(se) ? CL_Z_MISMATCH * se : undefined,
        claim: 'approx',
        digits: 5,
        note:
          r`$C=${txs(c.analytic.Cest, 4)}$、$g=${txs(c.analytic.g, 4)}$、$p=${txs(c.analytic.p, 5)}$；$\operatorname{std}(w)=${txs(c.metrics.stdW, 3)}\ \mathrm{fs}$（預測 $${txs(c.analytic.sigmaWPred, 3)}\ \mathrm{fs}$）` +
          (Number.isFinite(se) ? r`；mean 的 $\mathrm{SE}=${txs(se, 3)}\ \mathrm{fs}$` : c.analytic.stableMean && c.analytic.g > 1e-3 ? r`；block 數不足 $10\tau$，尚未收斂，不比對` : ''),
      })
    }
  }

  const crossCheck = useMemo(() => {
    let analytic: CheckEntry = { status: 'n/a', note: '分析尚未完成' }
    if (an) {
      const pairs = [an.corr.raw, an.corr.delayed, an.corr.filtered, an.Eu2]
      if (pairs.some((p) => p.analytic === null)) analytic = { status: 'n/a', note: 'DSM code（mash111／dsm1）不提供封閉式 PSD：只顯示同一段 code 的經驗值' }
      else {
        const bad = pairs.filter((p) => Math.abs(p.empirical - (p.analytic as number)) > 5 * p.se + 1e-9)
        analytic = bad.length
          ? { status: 'mismatch', note: r`${bad.length} 個相關值超出 $\pm5$ SE` }
          : { status: 'ok', note: r`封閉式 $C$（單頻公式，或時域雙重和 $\sum_k\sum_l h[k]\,\hat h[l]\,R_x[k-l]$）與同一段 code 的時間平均一致（$\pm5$ SE）` }
      }
    }
    let monteCarlo: CheckEntry = { status: 'n/a', note: task.running ? '閉迴路模擬執行中…' : '尚未執行閉迴路模擬' }
    if (cl) {
      // 用模擬當時的 a、w₀（參數改變、尚在重算時也不會誤判）
      const { a, w0 } = cl.params.scenario
      const checks = cl.result.cases.map((c) => ({ id: c.id, ...closedLoopConsistent(c, a, w0) }))
      const statuses = checks.map((c) => c.status)
      const status: CheckStatus = statuses.includes('mismatch') ? 'mismatch' : statuses.every((s) => s === 'n/a') ? 'n/a' : 'ok'
      monteCarlo = { status, note: checks.map((c) => `Case ${c.id}：${c.status}（${diagMath(c.note)}）`).join('；') + (stale ? '（參數已改變，重算中）' : '') }
    }
    const fixedPoint: CheckEntry = { status: 'not-implemented', note: '本實驗未啟用 gain register 量化（quantize_physical）；定點行為見 Ch13' }
    return { analytic, monteCarlo, fixedPoint }
  }, [an, cl, stale, task.running])

  // ── 圖 ──
  const figWave = useMemo(() => (an ? waveFigure(an, active.mode, active.D) : null), [an, active.mode, active.D])
  const figSweep = useMemo(() => (an ? sweepFigure(an, active.D, active.mode) : null), [an, active.D, active.mode])
  const figPhase = useMemo(() => (an ? phaseFigure(an) : null), [an])
  const colors = useMemo(() => Object.fromEntries(cases.cases.map((c) => [c.id, tokens.series[c.seriesIndex]])), [cases.cases, tokens.series])
  // 圖例名稱裡的數學寫成 `$...$`（Plot 元件轉成斜體符號與上下標）
  const labels = useMemo(() => Object.fromEntries(cases.cases.map((c) => [c.id, caseLabel(c.params, true)])), [cases.cases])
  const figCl = useMemo(() => (cl ? closedLoopFigure(cl.result, cl.params.scenario, colors, labels) : null), [cl, colors, labels])

  const params = {
    path: scenario.pathKind,
    code: scenario.codeKind,
    ...(scenario.pathKind === 'single_tone' ? { H_mag: scenario.mag, phi_deg: scenario.phiDeg } : {}),
    ...(scenario.pathKind === 'type2_dt' ? { wn_ts: scenario.wnTs, zeta: scenario.zeta, loop_delay: scenario.loopDelay } : {}),
    ...(scenario.codeKind === 'sinusoid' || scenario.pathKind === 'single_tone' ? { omega_rad_per_sample: scenario.omega } : {}),
    ...(scenario.codeKind === 'ar1' ? { ar1: scenario.rho } : {}),
    ...(scenario.codeKind === 'mash111' || scenario.codeKind === 'dsm1' ? { fcw_frac: scenario.frac } : {}),
    gain_true_fs: scenario.a,
    gain_initial_fs: scenario.w0,
    pd_noise_rms_fs: scenario.sigmaV,
    N: scenario.N,
    num_blocks: scenario.blocks,
    ...Object.fromEntries(cases.cases.map((c) => [`case_${c.id}`, caseLabel(c.params) + `，μ = ${c.params.mu} fs`])),
  }

  const exportData = () => {
    if (!an) throw new Error('分析尚未完成，無資料可匯出')
    const cols: Record<string, ArrayLike<number | string | null>> = {
      D: an.sweep.D,
      C_codeDelay_empirical: an.sweep.codeDelay.empirical,
      C_errorDelay_empirical: an.sweep.errorDelay.empirical,
      C_filtered_empirical: an.sweep.filtered.empirical,
      wave_n: an.wave.n,
      wave_x: an.wave.x,
      wave_u: an.wave.u,
      wave_xD: an.wave.xD,
      wave_uf: an.wave.uf,
    }
    if (an.sweep.codeDelay.analytic) cols.C_codeDelay_analytic = an.sweep.codeDelay.analytic
    if (an.sweep.errorDelay.analytic) cols.C_errorDelay_analytic = an.sweep.errorDelay.analytic
    if (an.sweep.filtered.analytic) cols.C_filtered_analytic = an.sweep.filtered.analytic
    if (cl) {
      cols.block_k = Array.from({ length: cl.result.cases[0]?.w.length ?? 0 }, (_, i) => i)
      for (const c of cl.result.cases) cols[`w_case${c.id}_fs`] = c.w
    }
    return cols
  }

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title="Delay / Filtered-x Lab：raw-x vs delayed-x vs filtered-x"
      level="L2"
      claim="exact"
      source="simulation"
      tests={['T07']}
      headingLevel={3}
      description={
        <>
          同一個 code、同一個 PLL 誤差路徑，比較 GMAC 用 <Tex>{'x[n]'}</Tex>、<Tex>{'x[n-D]'}</Tex> 或 <Tex>{r`u_f=\hat h*x`}</Tex> 當 regressor。
          上半部（波形、相關 vs <Tex>{'D'}</Tex>、逐頻率相位）是目前選取 Case 的即時分析；下半部是 A/B/C 三組在<strong>同一個 seed</strong>下的閉迴路
          Block Sign-LMS（<code>runBlockLms</code>，Web Worker）。
        </>
      }
      assumptions={[
        r`$\delta=a-w$ 極性；時間單位 fs；code 正規化為 $E[x^2]=1$（sinusoid 為 $\sqrt2\cos(\Omega n)$，DSM code（MASH 1-1-1、一階）為 standardize、無 dither）`,
        r`誤差路徑為離散時間 $H(e^{j\Omega})$（$\Omega$：rad/sample，comparator 取樣率；E44），狀態跨 GMAC block 持續`,
        r`comparator 前雜訊 $v\sim\mathcal N(0,\sigma_v^2)$ iid、與 code 獨立；$q=\mathrm{sign}(e)$，$e\ge0\Rightarrow q=+1$`,
        r`GMAC：$G_k=\frac1N\sum q\,x_{\mathrm{ref}}$，$w_{k+1}=w_k+\mu G_k$（E45 的 block 形式），無更新延遲、gain register 未量化`,
        r`解析 $C$ 為長時間平均（單頻：$0<\Omega<\pi$，E46）；經驗 $C$ 為同一段 code 的時間平均（略過濾波器暫態）`,
        r`pole $p=1-\mu K_qC$ 為小訊號線性化（$|\delta u|\ll\sigma_v$）；$C<0$ 時 sign-LMS 先指數再線性漂移`,
      ]}
      params={params}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      units={{ gain_true_fs: 'fs', gain_initial_fs: 'fs', pd_noise_rms_fs: 'fs', omega_rad_per_sample: 'rad/sample', wn_ts: 'rad/sample', mu: 'fs' }}
      metrics={metrics}
      warnings={Array.from(new Set(warnings))}
      crossCheck={crossCheck}
      actions={{
        onRun: () => runClosedLoop(clParams),
        onRunToConvergence: runToConvergence,
        onStop: () => task.cancel(),
        onReset: () => applyPreset({ scenario: DEFAULT_SCENARIO, cases: DEFAULT_CASES, seed: DEFAULT_SEED }),
        running: task.running,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={<LabControls scenario={scenario} setScenario={setScenario} cases={cases} />}
    >
      {an && (
        <div className="ch07-kv" aria-label="目前 Case 的重點數值">
          <div>
            <div className="k">目前 Case {cases.activeId}</div>
            <div className="v">
              <MathText>{caseLabel(active, true)}</MathText>
            </div>
          </div>
          <div>
            <div className="k">
              <Tex>{r`C_{\mathrm{ref}}`}</Tex>（解析）
            </div>
            <div className={`v ${signClass(an.corr.active.analytic ?? an.corr.active.empirical, 1e-9)}`}>
              {an.corr.active.analytic !== null ? fx(an.corr.active.analytic, 5) : '—'}
            </div>
          </div>
          <div>
            <div className="k">
              <Tex>{r`C_{\mathrm{ref}}`}</Tex>（經驗）
            </div>
            <div className="v">{fx(an.corr.active.empirical, 5)}</div>
          </div>
          <div>
            <div className="k">
              <Tex>{'\\rho'}</Tex>（Cauchy–Schwarz：<Tex>{r`|\rho|\le1`}</Tex>）
            </div>
            <div className="v">{fx(an.rhoActive, 4)}</div>
          </div>
          {an.tone && (
            <div>
              <div className="k">
                <Tex>{r`\angle H`}</Tex>、殘餘相位 <Tex>{'\\theta'}</Tex>
              </div>
              <div className="v">
                {fx((Math.atan2(an.tone.H.im, an.tone.H.re) * 180) / Math.PI, 2)}°、{fx(an.tone.thetaDeg, 2)}°
              </div>
            </div>
          )}
        </div>
      )}
      {figWave && (
        <Plot
          title={r`波形疊圖：$x$、$u=h*x$、$x_D=x[n-D]$、$u_f=\hat h*x$`}
          data={figWave.data}
          layout={figWave.layout}
          height={300}
          csvName="ch07-waveforms"
          caption={
            <>
              unit-power code；transient 之後的一段。delayed-x 對齊時 <Tex>{'x_D'}</Tex> 與 <Tex>{'u'}</Tex> 同相；filtered-x（<Tex>{r`\hat H=H`}</Tex>）時
              <Tex>{'u_f'}</Tex> 與 <Tex>{'u'}</Tex> 重合。
            </>
          }
        />
      )}
      {figSweep && (
        <Plot
          title={r`相關 vs $D$：延遲 code（$+\Omega D$）、延遲 error（$-\Omega D$）、filtered-x`}
          data={figSweep.data}
          layout={figSweep.layout}
          height={320}
          csvName="ch07-corr-vs-delay"
          caption={
            <>
              線 = 封閉式（F-07.2／F-07.8／F-07.12），點 = 同一段 code 的時間平均；直虛線 = 目前 Case 的 <Tex>{'D'}</Tex>
            </>
          }
        />
      )}
      <ModeGate min="engineer">
        {figPhase && (
          <Plot
            title={r`逐頻率殘餘相位 $\theta(\Omega)$（目前 Case）與 $\pm90^\circ$ 界線`}
            data={figPhase.data}
            layout={figPhase.layout}
            xLog
            height={320}
            csvName="ch07-phase-profile"
            caption={
              <>
                <Tex>{r`\theta(\Omega)=\angle H-\angle\hat H_{\mathrm{ref}}+\Omega D`}</Tex>（regressor 路徑 <Tex>{r`\hat H_{\mathrm{ref}}=1`}</Tex>：raw／delayed；
                <Tex>{r`\hat H_{\mathrm{ref}}=\hat H`}</Tex>：filtered）。加權高的頻率若落在
                <Tex>{r`\pm90^\circ`}</Tex> 外，就會對 <Tex>{'C'}</Tex> 投負票（E45）。直線 = code tone。
              </>
            }
          />
        )}
      </ModeGate>
      <h4 className="ch07-subhead">閉迴路 A/B/C（同 seed、同 code、同 comparator 雜訊）</h4>
      {figCl ? (
        <Plot
          title={r`閉迴路 $w_k$：${cl?.result.cases.length ?? 0} 個 Case（實線 = 模擬，點線 = 線性化平均）${stale ? '（重算中…）' : ''}`}
          data={figCl.data}
          layout={figCl.layout}
          height={340}
          csvName="ch07-closed-loop"
          caption={
            <>
              <code>runBlockLms</code>，<Tex>{`N=${cl?.params.scenario.N}`}</Tex>、{cl?.params.scenario.blocks} blocks、
              <Tex>{`\\sigma_v=${cl?.params.scenario.sigmaV}\\ \\mathrm{fs}`}</Tex>、seed = {cl?.params.scenario.seed}；水平虛線 = <Tex>{'a'}</Tex>，點線 = 線性化平均軌跡
              <Tex>{r`a-(a-w_0)\,p^k`}</Tex>。總 sample 數 {(cl?.result.totalSamples ?? 0).toLocaleString()}
              {task.lastDurationMs !== null ? `，耗時 ${Math.round(task.lastDurationMs)} ms（${task.mode}）` : ''}
            </>
          }
        />
      ) : (
        <p className="ch07-note">{task.running ? '閉迴路模擬執行中…' : clError ? '閉迴路模擬失敗（見上方警告）' : '尚未執行閉迴路模擬。'}</p>
      )}
      <Callout kind="info" title="試試看">
        <ul>
          <li>
            預設（Gallery #4）：Case A raw-x 被推離 <Tex>{'a'}</Tex>（<Tex>{r`C=-0.5`}</Tex>），B 的 <Tex>{'D=4'}</Tex> 與 C 的 filtered-x 收斂。把 B 的
            <Tex>{'D'}</Tex> 改成 1 或 7（<Tex>{r`\theta=\pm90^\circ`}</Tex>）：沒有恢復力，<Tex>{'w'}</Tex> 只會隨雜訊漂移。
          </li>
          <li>
            選 Case C，把 <Tex>{r`\hat H`}</Tex> 額外延遲 <Tex>{r`\Delta`}</Tex> 調到 3、再到 4：<Tex>{r`E[u\,u_f]=\cos(30^\circ\Delta)`}</Tex> 從 0 變負，filtered-x 也發散（E45）。
          </li>
          <li>
            載入 preset「Type-II 低頻 tone」：需要 <Tex>{'D=119'}</Tex>；把 code 的 <Tex>{'\\Omega'}</Tex> 從 0.03 改成 0.05，延遲立刻失效，filtered-x 不受影響。
          </li>
          <li>
            載入 preset「MASH DSM code」（或把誤差路徑換成 type2_dt、code 換成 iid <Tex>{r`\pm1`}</Tex>）：<Tex>{r`h_{\mathrm{PD}}[0]=1`}</Tex>、高頻
            <Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex>，相關 vs <Tex>{'D'}</Tex> 的曲線在 <Tex>{'D=0'}</Tex> 最大——寬頻 code 不需要、也不能用 delay。注意：預設的
            single_tone 路徑是只在 <Tex>{r`\Omega_0`}</Tex> 精確的 2-tap FIR，寬頻 code 經過它時最大值不一定在 <Tex>{'D=0'}</Tex>。
          </li>
          <li>
            載入 preset「FCW 與一階 DSM code」（寬頻 PLL、loop latency 2）：FCW 小數 0.05 時 raw-x 發散、<Tex>{'D=12'}</Tex> 收斂。把 FCW 小數改成 0.3（換一個
            channel）：raw-x 變成收斂，原本調好的 <Tex>{'D=12'}</Tex> 反而發散；只有 filtered-x 兩邊都收斂。再改成 0.01（near-integer）：raw-x 的
            <Tex>{'\\rho'}</Tex> 掉到接近 0。
          </li>
          <li>
            交叉比對若顯示「block 數不足 <Tex>{r`10\tau`}</Tex>」（收斂太慢，還看不出結果），按「執行至收斂 Run-to-Convergence」：Lab 會把 block 數加長到最慢 Case 的
            <Tex>{r`12\tau`}</Tex> 再重跑；如果沒有任何 Case 預測會收斂（<Tex>{r`C\le0`}</Tex> 或 <Tex>{r`C\approx0`}</Tex>），它會直接告訴你原因——加長模擬沒有用。
          </li>
        </ul>
      </Callout>
      <ModeGate min="research">
        {an && (
          <p className="ch07-note">
            分析細節：經驗相關使用 {an.samples.toLocaleString()} 個 sample（略過前 {an.transient.toLocaleString()} 個暫態），SE 以 {an.seBatch.toLocaleString()}-sample batch means 估計（batch 至少 4 倍相關時間）
            （單頻 code 為確定性 ripple 上界 <Tex>{r`|H||\hat H_{\mathrm{ref}}|/(N_{\mathrm{avg}}|\sin\Omega|)`}</Tex>，<Tex>{r`N_{\mathrm{avg}}`}</Tex> 為平均的 sample 數）；<Tex>{r`\hat H`}</Tex>：<code>{an.hat.description}</code>。閉迴路 crossCheck 的判準見
            <code>closedLoopConsistent</code>（單一 seed 的假設檢定）：預測收斂且 block 數 <Tex>{r`\ge10\tau`}</Tex> 時，後半段 <Tex>{'M'}</Tex> 個 block 的平均
            <Tex>{r`\bar w`}</Tex> 的標準誤為 <Tex>{r`\mathrm{SE}=\sigma_w\sqrt{\tfrac{1+p}{(1-p)M}}`}</Tex>（相鄰 block 高度相關，不是 <Tex>{r`\sigma_w/\sqrt M`}</Tex>）；
            <Tex>{r`|\bar w-w^\star|>5\,\mathrm{SE}`}</Tex> 判為 mismatch，另外要 <Tex>{r`|\bar w-w_0|>3\,\mathrm{SE}`}</Tex>（看得出 <Tex>{'w'}</Tex> 確實離開初值）才給 ok，否則 n/a。
            預測發散時，要求 <Tex>{r`|w_{\mathrm{end}}-a|-|w_0-a|>3\sigma_{\mathrm{rw}}`}</Tex>，<Tex>{r`\sigma_{\mathrm{rw}}=\mu\sqrt{K\sigma_\eta^2}`}</Tex> 是沒有恢復力時隨機漫步的標準差。
            <ClaimTag kind="approx" />
          </p>
        )}
      </ModeGate>
    </ExperimentShell>
  )
}
