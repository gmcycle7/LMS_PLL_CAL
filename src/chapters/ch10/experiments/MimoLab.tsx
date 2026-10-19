import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import {
  CASE_IDS,
  CaseSelector,
  Callout,
  ClaimTag,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  mathText,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CaseId,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { identity, matAdd, matMul, matScale, studentTInv } from '@/simulation/core'
import {
  MARGINAL_TOL,
  MAX_SAMPLE_BUDGET,
  RULES,
  RULE_LABEL,
  RULE_SHORT,
  analyzeRule,
  buildPlant,
  estimateSampleCost,
  inspectMatrix,
  mSequential,
  resolveJhat,
  type JhatSource,
  type Mat,
  type MimoCovParams,
  type MimoCovResult,
  type MimoEngine,
  type MimoRule,
  type MimoTrajParams,
  type MimoTrajResult,
  type PlantMode,
  type RegForm,
  type RegressorDist,
  type RuleAnalysis,
  type RuleConfig,
} from '@/simulation/models/mimo'
import { Erratum, chop, n, nint, texMat, tint, tn } from '../common'
import {
  DEFAULT_CASES,
  DEFAULT_PARAMS,
  DEFAULT_SEED,
  EXPERIMENT_ID,
  allRulesFrom,
  delta0Of,
  embedMat,
  jhatSpecOf,
  k95Metric,
  parsePresetParams,
  plantSpecOf,
  sliceMat,
  type LabParams,
} from './labState'
import { mcTraces, normTraces, phasePlaneTraces, poleTraces, trajectoryTraces } from './labPlots'
import { MatrixEditor } from './MatrixEditor'

const RULE_OPTIONS = (Object.keys(RULE_LABEL) as MimoRule[]).map((r) => ({ value: r, label: RULE_LABEL[r] }))

/** pole／eigenvalue 的顯示：實部、虛部各自把浮點殘餘（< 10⁻¹²）當成 0（deadbeat 的 pole 不印成 5.6e−17） */
function complexText(z: { re: number; im: number }): string {
  if (Math.abs(z.im) < 1e-12) return n(chop(z.re), 5)
  return `${n(chop(z.re), 4)} ${z.im >= 0 ? '+' : '−'} j${n(Math.abs(z.im), 4)}`
}

/** TeX 版（放在 `$...$` 字串裡）：1.2+j0.4 */
function complexTex(z: { re: number; im: number }): string {
  if (Math.abs(z.im) < 1e-12) return tn(chop(z.re), 5)
  return `${tn(chop(z.re), 4)}${z.im >= 0 ? '+' : '-'}j${tn(Math.abs(z.im), 4)}`
}

function KPI({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <div className="ch10-kpi-label">{label}</div>
      <div className="ch10-kpi-value">{value}</div>
    </div>
  )
}

interface Effective {
  params: LabParams
  cases: { id: CaseId; params: RuleConfig }[]
  activeId: CaseId
  seed: number
}

/** 共變異矩陣 → 相關係數矩陣（±1 碼要求對角 = 1）：R_ij / √(R_ii R_jj)；功率 ≤ 0 的列維持原值 */
function toCorrelation(R: Mat): Mat {
  return R.map((row, i) => row.map((v, j) => (i === j ? 1 : R[i][i] > 0 && R[j][j] > 0 ? v / Math.sqrt(R[i][i] * R[j][j]) : v)))
}

export function MimoLab() {
  const tokens = useThemeTokens()
  const [params, setParams] = useState<LabParams>(DEFAULT_PARAMS)
  const cases = useCases<RuleConfig>(DEFAULT_CASES[0], { seed: DEFAULT_SEED })
  const [kView, setKView] = useState<number | null>(null)
  /** 硬體 Freeze gain：k ≥ freezeAt 後 w 不再更新（null = 不凍結） */
  const [freezeAt, setFreezeAt] = useState<number | null>(null)
  const set = <K extends keyof LabParams>(k: K, v: LabParams[K]) => setParams((p) => ({ ...p, [k]: v }))

  // ── cases 的批次設定（先 addCase 再 update，避免 addCase 的同步 state 覆蓋 functional update） ──
  const applyCases = useCallback(
    (list: RuleConfig[]) => {
      const ids: CaseId[] = cases.cases.map((c) => c.id)
      while (ids.length < list.length) {
        const id = cases.addCase()
        if (!id) break
        ids.push(id)
      }
      ids.sort((a, b) => CASE_IDS.indexOf(a) - CASE_IDS.indexOf(b))
      list.forEach((cfg, i) => {
        if (ids[i]) cases.update({ ...cfg }, ids[i])
      })
      ids.slice(list.length).forEach((id) => cases.removeCase(id))
      cases.setActive(ids[0])
    },
    [cases],
  )

  const applyPreset = useCallback(
    (raw: Record<string, unknown>) => {
      const parsed = parsePresetParams(raw)
      setParams(parsed.params)
      applyCases(parsed.cases)
      cases.setSeed(parsed.seed)
      setKView(null)
      setFreezeAt(null)
    },
    [applyCases, cases],
  )

  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const initRef = useRef(false)
  const appliedPreset = useRef<string | null>(null)
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true
      if (urlPreset) {
        appliedPreset.current = urlPreset.id
        applyPreset(urlPreset.params)
      } else applyCases(DEFAULT_CASES)
      return
    }
    if (urlPreset && appliedPreset.current !== urlPreset.id) {
      appliedPreset.current = urlPreset.id
      applyPreset(urlPreset.params)
    }
  }, [urlPreset, applyPreset, applyCases])

  // ── 有效參數（debounce） ──
  const dParams = useDebouncedValue(params, 250)
  const dCases = useDebouncedValue(cases.cases, 250)
  const live: Effective = useMemo(
    () => ({ params: dParams, cases: dCases.map((c) => ({ id: c.id, params: c.params })), activeId: cases.activeId, seed: cases.seed }),
    [dParams, dCases, cases.activeId, cases.seed],
  )
  const eff = live
  const P = eff.params.P
  const activeIdx = Math.max(0, eff.cases.findIndex((c) => c.id === eff.activeId))
  const activeCfg = eff.cases[activeIdx]?.params ?? DEFAULT_CASES[0]

  // ── 解析（同步） ──
  const plantSpec = useMemo(() => plantSpecOf(eff.params), [eff.params])
  const plant = useMemo(() => buildPlant(plantSpec), [plantSpec])
  const jhatSpec = useMemo(() => jhatSpecOf(eff.params), [eff.params])
  const delta0 = useMemo(() => delta0Of(eff.params), [eff.params])
  const jhatSync = useMemo(
    () => (eff.params.jhatSource === 'finiteDiff' || plant.errors.length ? null : resolveJhat(plant, jhatSpec, delta0, eff.seed)),
    [plant, jhatSpec, delta0, eff.seed, eff.params.jhatSource],
  )

  // ── 時域模擬（worker；paired seed） ──
  const trajReq: MimoTrajParams = useMemo(
    () => ({
      plant: plantSpec,
      cases: [...eff.cases.map((c) => c.params), ...(eff.params.showAllRules ? allRulesFrom(activeCfg) : [])],
      delta0,
      blocks: eff.params.blocks,
      engine: eff.params.engine,
      jhat: jhatSpec,
      seed: eff.seed,
      freezeAt,
    }),
    [plantSpec, eff.cases, eff.params.showAllRules, eff.params.blocks, eff.params.engine, activeCfg, delta0, jhatSpec, eff.seed, freezeAt],
  )
  const trajCost =
    eff.params.engine === 'sample'
      ? estimateSampleCost({ cases: trajReq.cases.length, blocks: eff.params.blocks, N: eff.params.N, fdSamples: eff.params.jhatSource === 'finiteDiff' ? eff.params.fdSamples : 0, P })
      : 0
  const { run: runTraj, running: trajRunning } = useWorkerTask<MimoTrajParams, MimoTrajResult>('mimo', 'runMimoTrajectories', { restartOnRun: true })
  const [traj, setTraj] = useState<{ req: MimoTrajParams; res: MimoTrajResult } | null>(null)
  const [trajErr, setTrajErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setTrajErr(null)
    runTraj(trajReq)
      .then((res) => {
        if (alive) setTraj({ req: trajReq, res })
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setTrajErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [trajReq, runTraj])
  const trajFresh = traj?.req === trajReq

  // finiteDiff 的 Ĵ 由 worker 量測：只有「同一個 plant / Ĵ 設定 / δ₀ / seed」的結果才可用。
  // 參數剛改變（例如 P 從 2 換成 3）而新結果還沒回來時，舊的 Ĵ 尺寸或內容已不對，必須顯示「等待 Ĵ 量測」而不是拿來算。
  const trajJhatValid = !!traj && traj.res.ok && traj.req.plant === plantSpec && traj.req.jhat === jhatSpec && traj.req.delta0 === delta0 && traj.req.seed === eff.seed
  const JnHat: Mat | null = jhatSync?.JnHat ?? (trajJhatValid && traj ? traj.res.JnHat : null)
  const jhatInfo = jhatSync?.info ?? (trajJhatValid && traj ? traj.res.jhatInfo : null)

  const analyses: (RuleAnalysis | null)[] = useMemo(
    () => eff.cases.map((c) => (JnHat && !plant.errors.length ? analyzeRule(plant, c.params, JnHat) : null)),
    [eff.cases, JnHat, plant],
  )
  const allRuleAnalyses = useMemo(
    () => (JnHat && !plant.errors.length ? allRulesFrom(activeCfg).map((c) => analyzeRule(plant, c, JnHat)) : []),
    [JnHat, plant, activeCfg],
  )
  const inspection = useMemo(() => (plant.errors.length ? null : inspectMatrix(eff.params.mode === 'R' ? plant.Ru : plant.Jn)), [plant, eff.params.mode])
  const activeAn = analyses[activeIdx] ?? null

  // ── Monte Carlo 穩態共變異（按 Run） ──
  const mcReq: MimoCovParams = useMemo(
    () => ({
      plant: plantSpec,
      rule: activeCfg,
      jhat: jhatSpec,
      engine: eff.params.engine,
      chains: eff.params.mcChains,
      recordBlocks: eff.params.mcRecord,
      delta0,
      seed: eff.seed,
    }),
    [plantSpec, activeCfg, jhatSpec, eff.params.engine, eff.params.mcChains, eff.params.mcRecord, delta0, eff.seed],
  )
  const mcKey = JSON.stringify(mcReq)
  const { run: runMc, cancel: cancelMc, running: mcRunning } = useWorkerTask<MimoCovParams, MimoCovResult>('mimo', 'runMimoCovarianceMc', { restartOnRun: true })
  const [mc, setMc] = useState<{ key: string; caseId: CaseId; res: MimoCovResult } | null>(null)
  const [mcErr, setMcErr] = useState<string | null>(null)
  const onRunMc = () => {
    setMcErr(null)
    const key = mcKey
    const caseId = eff.activeId
    runMc(mcReq)
      .then((res) => setMc({ key, caseId, res }))
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setMcErr(e instanceof Error ? e.message : String(e))
      })
  }
  const mcStale = mc !== null && mc.key !== mcKey
  // burn-in 的規則是 ⌈6/(−ln ρ)⌉ ≈ 2·⌈ln 0.05/ln ρ⌉（mimo.ts），所以用「只看 ρ(A)」的 blocks95Asymptotic 估，不用範數版的 k₉₅
  const kBurn = activeAn?.blocks95Asymptotic ?? activeAn?.blocks95
  const mcCost =
    eff.params.engine === 'sample'
      ? estimateSampleCost({ cases: 1, blocks: eff.params.mcRecord + (kBurn ? Math.min(200000, Math.ceil((6 * kBurn) / 3)) : 0), N: eff.params.N, chains: eff.params.mcChains })
      : 0

  // ── 單步 / 執行至收斂 ──
  const blocks = eff.params.blocks
  const onStep = () => setKView((k) => (k === null ? 1 : Math.min(blocks, k + 1)))
  const onRunToConvergence = () => {
    const ks = analyses.map((a) => a?.blocks95 ?? null).filter((k): k is number => k !== null)
    setKView(ks.length ? Math.min(blocks, Math.max(...ks)) : blocks)
  }
  const onReset = () => {
    setParams(DEFAULT_PARAMS)
    applyCases(DEFAULT_CASES)
    cases.setSeed(DEFAULT_SEED)
    setKView(null)
    setFreezeAt(null)
    setMc(null)
  }
  /** Freeze gain（§10.2「先 Freeze Gain」）：在目前檢視的 block（或 active case 的 k₉₅）停止更新 w；再按一次解除 */
  const onFreeze = () => {
    setFreezeAt((f) => {
      if (f !== null) return null
      const k = kView ?? activeAn?.blocks95 ?? Math.floor(blocks / 2)
      return Math.max(0, Math.min(blocks, k))
    })
  }

  // ── 警告（每一條都要說明原因） ──
  const warnings: string[] = []
  plant.errors.forEach((e) => warnings.push(`Plant：${e}`))
  plant.warnings.forEach((w) => warnings.push(`Plant：${w}`))
  analyses.forEach((a, i) => {
    const id = eff.cases[i]?.id
    if (!a) return
    if (a.error) warnings.push(`Case ${id}（${RULE_SHORT[a.rule]}）：${a.error}`)
    a.warnings.forEach((w) => warnings.push(`Case ${id}（${RULE_SHORT[a.rule]}）：${w}`))
    if (a.validityIndex !== null && a.validityIndex > 0.05) {
      warnings.push(
        String.raw`Case ${id}：線性化有效性指標 $E[\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta]/\sigma_v^2=${tn(a.validityIndex, 3)}$ 不夠小（$>0.05$），殘差已與 comparator noise 同量級，$K_q$ 線性化高估增益；sample 引擎的結果會偏離封閉式。`,
      )
    }
  })
  if (eff.params.mode === 'J' && inspection && inspection.eig.some((z) => z.re >= 0)) {
    warnings.push(
      String.raw`$\mathbf J$ 有實部 $\ge0$ 的 eigenvalue（$${inspection.eig.map(complexTex).join(String.raw`,\ `)}$）：$-\mathbf J$ 非正定（mismatched correlator / 共模極性錯誤），$\mathbf M=\mu\mathbf I$ 對任何 $\mu>0$ 都不收斂；需要 $-\gamma\hat{\mathbf J}^{-1}$ 或 regularized pinv 修正極性。`,
    )
  }
  if (jhatInfo && jhatInfo.source !== 'exact' && jhatInfo.relErr > 1e-12) {
    warnings.push(
      String.raw`$\hat{\mathbf J}\ne\mathbf J$（相對誤差 ${n(100 * jhatInfo.relErr, 3)}%）：$p_i=1-\gamma\sigma_i^2/(\sigma_i^2+\lambda_{\mathrm{reg}})$ 與 $1-\gamma$ 的封閉式不再成立（勘誤 E24）；poles 一律以 $\operatorname{eig}\big(\mathbf I+\mathbf M(\hat{\mathbf J})\,\mathbf J\big)$ 計算。`,
    )
  }
  // plant 本身無效時，時域模擬回報的是同一個原因，不重複列出
  if (traj?.res.error && !plant.errors.length) warnings.push(`時域模擬：${traj.res.error}`)
  if (trajErr) warnings.push(`時域模擬失敗：${trajErr}`)
  if (eff.params.dist === 'pm1' && eff.params.engine === 'linear') {
    warnings.push(String.raw`regressor 分布只影響 sample 引擎與中央差分量測；linear 引擎只用二階統計 $\mathbf R$（Gaussian 化的 GMAC 雜訊）。`)
  }
  traj?.res.cases.forEach((c, i) => {
    if (i < eff.cases.length && c.diverged) warnings.push(String.raw`Case ${eff.cases[i].id}：時域模擬在 block ${c.divergedAt} 數值發散（$|\delta|>10^9\ \mathrm{fs}$），已停止。`)
  })
  if (mc?.res.error && !mcStale) warnings.push(`Monte Carlo：${mc.res.error}`)
  if (mcErr) warnings.push(`Monte Carlo 失敗：${mcErr}`)
  if (mc && !mcStale) mc.res.warnings.forEach((w) => warnings.push(`Monte Carlo：${w}`))

  // ── 交叉比對 ──
  // 兩個獨立計算互相比對：(1) 數值 eig(I+MJ) vs 封閉式 poles；(2) Lyapunov 數值解 vs 封閉式模式變異（F-10.6/F-10.7）。
  // 沒有任何封閉式可比（Ĵ ≠ J、一般不對稱 J、diagonal/sequential）時誠實回報 n/a，而不是 ok。
  const analyticCheck: CheckEntry = (() => {
    if (plant.errors.length) return { status: 'n/a', note: 'Plant 無效（見警告），沒有可分析的迴路' }
    const withClosed = analyses.filter((a): a is RuleAnalysis => !!a && a.ok && !!a.closedPoles)
    if (withClosed.length === 0) {
      return {
        status: 'n/a',
        note: String.raw`此設定沒有封閉式可比（$\hat{\mathbf J}\ne\mathbf J$、一般 $\mathbf J$、diagonal 或 sequential）；poles 只由 $\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)$ 數值計算`,
      }
    }
    // 明確列出「哪些 case 真的比對了」：其餘 case 沒有封閉式，不算在 ok 裡
    const comparedIds = analyses.map((a, i) => (a && a.ok && a.closedPoles ? eff.cases[i]?.id : null)).filter((id): id is CaseId => !!id)
    const scope = comparedIds.length === analyses.length ? '' : `（只比對 Case ${comparedIds.join('、')}；其餘 case 無封閉式）`
    const worstPole = Math.max(
      ...withClosed.map((a) => {
        const eigRe = a.poles.map((z) => z.re).sort((x, y) => x - y)
        const cl = a.closedPoles!.slice().sort((x, y) => x - y)
        const imag = Math.max(...a.poles.map((z) => Math.abs(z.im)))
        return Math.max(imag, ...cl.map((c, i) => Math.abs(c - eigRe[i])))
      }),
    )
    const withVar = withClosed.filter((a) => a.closedModeVar && a.modeVar)
    const worstVar = withVar.length
      ? Math.max(...withVar.map((a) => Math.max(...a.closedModeVar!.map((c, i) => Math.abs(a.modeVar![i] / c - 1)))))
      : null
    const varText = worstVar === null ? '（無封閉式變異可比）' : String.raw`；Lyapunov vs F-10.7 模式變異最大相對差 $${tn(worstVar, 2)}$`
    const ok = worstPole < 1e-9 && (worstVar === null || worstVar < 1e-6)
    return ok
      ? { status: 'ok', note: String.raw`$\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)$ vs 封閉式 poles：$\max|\Delta p|=${tn(worstPole, 2)}$${varText}${scope}` }
      : { status: 'mismatch', note: String.raw`$\max|\Delta p|=${tn(worstPole, 3)}$${varText}${scope}` }
  })()
  const mcCheck: CheckEntry = (() => {
    if (!mc || mcStale) return { status: 'n/a', note: mc ? '參數已改變，請重新執行 Run' : '尚未執行（按「執行 Run」跑穩態共變異 MC）' }
    const r = mc.res
    if (!r.ok || !r.covAnalytic) return { status: 'n/a', note: r.error ?? '無解析值可比' }
    // 95% CI 半寬 = t_{0.975, chains−1} · SE（Student-t）⇒ SE = 半寬 / t；chains 少時 t 遠大於 1.96，不可用常態近似
    const tq = studentTInv(0.975, Math.max(1, r.chains - 1))
    let worstZ = 0
    for (let i = 0; i < P; i++) {
      const half = (r.covHi[i][i] - r.covLo[i][i]) / 2
      const z = half > 0 ? Math.abs(r.cov[i][i] - r.covAnalytic[i][i]) / (half / tq) : Infinity
      worstZ = Math.max(worstZ, z)
    }
    return worstZ <= 4
      ? { status: 'ok', note: String.raw`$\operatorname{Var}(\delta_j)$：MC vs Lyapunov 最大 ${n(worstZ, 2)} SE` }
      : { status: 'mismatch', note: String.raw`$\operatorname{Var}(\delta_j)$ 偏離 ${n(worstZ, 2)} SE（${eff.params.engine === 'sample' ? '1-bit 非線性 / 增益壓縮' : '請檢查'}）` }
  })()

  // ── 指標 ──
  const metrics: MetricRow[] = []
  if (!plant.errors.length) {
    metrics.push({ name: String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$`, value: plant.Kq, unit: String.raw`$\mathrm{fs}^{-1}$`, formulaId: 'F-10.1', claim: 'approx', digits: 6 })
    if (eff.params.mode === 'R') {
      metrics.push({ name: String.raw`$\lambda_{\max}(\mathbf R)$`, value: plant.modeValues[0], claim: 'exact' })
      metrics.push({ name: String.raw`$\lambda_{\min}(\mathbf R)$`, value: plant.modeValues[P - 1], claim: 'exact', note: plant.modeValues[P - 1] <= 1e-12 ? '不可辨識（缺乏 PE）' : undefined })
    } else {
      metrics.push({ name: String.raw`$\sigma_{\max}(\mathbf J_n)$`, value: plant.modeValues[0], claim: 'exact' })
      metrics.push({ name: String.raw`$\sigma_{\min}(\mathbf J_n)$`, value: plant.modeValues[P - 1], claim: 'exact' })
    }
    metrics.push({ name: String.raw`condition number $\kappa$`, value: inspection?.cond ?? null, claim: 'exact' })
  }
  analyses.forEach((a, i) => {
    if (!a || !a.ok) return
    const id = eff.cases[i].id
    // deadbeat（γ = 1）時 ρ(A) 與封閉式都是 0：浮點殘餘（1.1e−16）顯示成 0
    const cl = a.closedPoles ? chop(Math.max(...a.closedPoles.map(Math.abs))) : undefined
    metrics.push({
      name: String.raw`Case ${id} $\rho(\mathbf I+\mathbf M\mathbf J)$（${RULE_SHORT[a.rule]}）`,
      value: chop(a.spectralRadius),
      analytic: a.rule === 'sequential' ? undefined : cl,
      tolerance: cl !== undefined && a.rule !== 'sequential' ? 1e-9 : undefined,
      formulaId: a.rule === 'full' ? 'F-10.4' : a.rule === 'regularized' ? (cfgOf(eff, i).regForm === 'R' ? 'F-10.8' : 'F-10.10') : 'F-10.2',
      claim: 'exact',
      digits: 6,
      note: a.rule === 'sequential' ? String.raw`每 block 等效 $\rho(\boldsymbol\Phi_{\text{sweep}})^{1/(PK)}$` : undefined,
    })
    metrics.push(k95Metric(id, a))
    if (a.perParamVar) {
      metrics.push({
        name: String.raw`Case ${id} 穩態 $\max_j\mathrm{RMS}(\delta_j)$`,
        value: Math.sqrt(Math.max(...a.perParamVar)),
        unit: 'fs',
        formulaId: 'F-10.15',
        claim: 'approx',
        note: a.covKind === 'final' ? '排程結束（凍結）時' : undefined,
      })
    }
  })
  if (mc && !mcStale && mc.res.ok) {
    const tq = studentTInv(0.975, Math.max(1, mc.res.chains - 1))
    for (let i = 0; i < P; i++) {
      const se = (mc.res.covHi[i][i] - mc.res.covLo[i][i]) / 2 / tq
      metrics.push({
        name: String.raw`MC $\operatorname{Var}(\delta_{${i + 1}})$（Case ${mc.caseId}）`,
        value: mc.res.cov[i][i],
        unit: String.raw`$\mathrm{fs}^2$`,
        analytic: mc.res.covAnalytic ? mc.res.covAnalytic[i][i] : undefined,
        tolerance: mc.res.covAnalytic ? 4 * se : undefined,
        claim: 'approx',
        note: String.raw`95% CI [${n(mc.res.covLo[i][i], 4)}, ${n(mc.res.covHi[i][i], 4)}]；容差 $=\pm4$ SE`,
      })
    }
  }

  // ── 圖 ──
  const caseIds = useMemo(() => eff.cases.map((c) => c.id as string), [eff.cases])
  const caseCfgs = useMemo(() => eff.cases.map((c) => c.params), [eff.cases])
  const nCases = eff.cases.length
  // 時域結果可能是「上一組參數」的（新結果還在 worker 裡）：參數個數 P 不同時維度對不上，不能畫，否則會讀到不存在的 δ₃。
  // 請求裡的 case 數 = 使用者 case（≤ 3）＋（勾選「全部六種規則」時）6；case 數與現在不同時，舊結果的 case 對不上標籤，也不畫。
  const reqUserCases = traj ? (traj.req.cases.length > CASE_IDS.length ? traj.req.cases.length - RULES.length : traj.req.cases.length) : 0
  const trajUsable = !!traj && traj.res.ok && traj.req.delta0.length === P && reqUserCases === nCases
  const userTraj = useMemo(() => (trajUsable && traj ? traj.res.cases.slice(0, nCases) : []), [traj, trajUsable, nCases])
  const allTraj = useMemo(() => (trajUsable && traj && traj.req.cases.length > nCases ? traj.res.cases.slice(nCases) : []), [traj, trajUsable, nCases])
  const isSample = eff.params.engine === 'sample'
  const trajData: Data[] = useMemo(
    () => trajectoryTraces(userTraj, caseIds, caseCfgs, P, tokens, activeIdx, kView, isSample),
    [userTraj, caseIds, caseCfgs, P, tokens, activeIdx, kView, isSample],
  )
  const field: Mat | null = useMemo(() => {
    if (!JnHat || plant.errors.length || P < 2) return null
    const a = activeAn
    let D: Mat | null = null
    if (a?.ok && a.A && activeCfg.rule !== 'sequential') D = matAdd(a.A, matScale(identity(P), -1))
    else if (a?.ok && activeCfg.rule === 'sequential') D = matMul(mSequential(JnHat, activeCfg, kView ?? 0), plant.Jn)
    return D ? sliceMat(D, 2) : null
  }, [JnHat, plant, P, activeAn, activeCfg, kView])
  const L = useMemo(() => {
    const d = Math.max(Math.abs(delta0[0] ?? 0), Math.abs(delta0[1] ?? 0))
    const s = activeAn?.perParamVar ? 3 * Math.sqrt(Math.max(activeAn.perParamVar[0], activeAn.perParamVar[1] ?? 0)) : 0
    return 1.15 * Math.max(d, s, 1e-3)
  }, [delta0, activeAn])
  const scheduleEnd = useMemo(() => caseCfgs.map((c) => (c.rule === 'sequential' ? P * c.seqSweeps * c.seqBlocksPerPhase : null)), [caseCfgs, P])
  const phaseData: Data[] = useMemo(
    () => phasePlaneTraces({ traj: userTraj, analyses, ids: caseIds, tokens, field, L, kView, scheduleEnd }),
    [userTraj, analyses, caseIds, tokens, field, L, kView, scheduleEnd],
  )
  // Freeze gain 的位置畫成垂直虛線
  const freezeShapes = useMemo(
    () =>
      freezeAt === null
        ? []
        : [{ type: 'line' as const, xref: 'x' as const, yref: 'paper' as const, x0: freezeAt, x1: freezeAt, y0: 0, y1: 1, line: { color: tokens.textMuted, width: 1.5, dash: 'dash' as const } }],
    [freezeAt, tokens],
  )
  const trajLayout = useMemo(
    () => ({ xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$\delta_{k,i} = a_i - w_{k,i}$ (fs)` } }, shapes: freezeShapes }),
    [freezeShapes],
  )
  const normLayout = useMemo(() => ({ xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$\|\delta_k\|$ (fs)` } }, shapes: freezeShapes }), [freezeShapes])
  const poleLayout = useMemo(() => ({ xaxis: { title: { text: String.raw`$\mathrm{Re}$` }, zeroline: true }, yaxis: { title: { text: String.raw`$\mathrm{Im}$` }, scaleanchor: 'x' as const, scaleratio: 1 } }), [])
  const phaseLayout = useMemo(
    () => ({
      xaxis: { title: { text: String.raw`$\delta_1$ (fs)` }, range: [-L, L] },
      yaxis: { title: { text: String.raw`$\delta_2$ (fs)` }, range: [-L, L], scaleanchor: 'x' as const, scaleratio: 1 },
    }),
    [L],
  )
  const mcLayout = useMemo(() => ({ xaxis: { title: { text: String.raw`$\delta_1$ (fs)` } }, yaxis: { title: { text: String.raw`$\delta_2$ (fs)` }, scaleanchor: 'x' as const, scaleratio: 1 } }), [])
  const poleData = useMemo(() => poleTraces(analyses, caseIds, tokens), [analyses, caseIds, tokens])
  const normData = useMemo(() => normTraces(allTraj, tokens, kView), [allTraj, tokens, kView])
  const mcData = useMemo(() => (mc && mc.res.ok ? mcTraces(mc.res, tokens, tokens.series[Math.max(0, CASE_IDS.indexOf(mc.caseId))]) : []), [mc, tokens])

  // ── 匯出 CSV ──
  const exportData = () => {
    const cols: Record<string, ArrayLike<number | string | null>> = {}
    if (userTraj.length) {
      const len = userTraj.find((c) => c.ok)?.norm.length ?? 0
      cols.k = Array.from({ length: len }, (_, k) => k)
      userTraj.forEach((c, i) => {
        if (!c.ok) return
        for (let j = 0; j < P; j++) {
          cols[`case${caseIds[i]}_${c.rule}_delta${j + 1}_fs`] = c.delta[j]
          if (c.meanAnalytic) cols[`case${caseIds[i]}_mean_delta${j + 1}_fs`] = c.meanAnalytic[j]
          if (c.stdAnalytic) cols[`case${caseIds[i]}_std_delta${j + 1}_fs`] = c.stdAnalytic[j]
        }
      })
      allTraj.forEach((c) => {
        if (c.ok) cols[`all_${c.rule}_norm_fs`] = c.norm
      })
    }
    if (mc && mc.res.ok) mc.res.scatter.forEach((s, j) => (cols[`mc_case${mc.caseId}_delta${j + 1}_fs`] = s))
    if (Object.keys(cols).length === 0) throw new Error('尚無模擬資料')
    return cols
  }

  // ── 控制面板 ──
  const activeCase = cases.active.params
  const updateActive = (patch: Partial<RuleConfig>) => cases.update(patch)

  const controls = (
    <>
      <fieldset className="ch10-fieldset">
        <legend>Plant（誤差路徑與 regressor）</legend>
        <SelectControl<number>
          label={mathText('參數個數 $P$')}
          ariaLabel="參數個數 P"
          value={params.P}
          onChange={(v) => set('P', v === 3 ? 3 : 2)}
          options={[
            { value: 2, label: '2（2×2）' },
            { value: 3, label: '3（3×3，例如 GOS / PHOS / gain）' },
          ]}
          reg="BEH_NUM_PARAMS"
        />
        <SelectControl<PlantMode>
          label="模型"
          value={params.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'R', label: 'R：匹配模型（x = u，J = −K_qR）' },
            { value: 'J', label: 'J：一般 Jacobian（可不對稱，T18）' },
          ]}
          reg="BEH_PLANT_MODEL"
        />
        {params.mode === 'R' ? (
          <>
            <MatrixEditor
              label={String.raw`\mathbf R=E[\mathbf u\mathbf u^T]`}
              value={sliceMat(params.R, params.P)}
              onChange={(A) => set('R', embedMat(params.R, A))}
              symmetric
              min={-1}
              max={4}
              reg="BEH_R[i][j]"
              unit="無因次"
              lockDiagonal={params.dist === 'pm1'}
              hint={params.dist === 'pm1' ? String.raw`$\pm1$ 碼：對角固定為 1（相關係數矩陣）` : String.raw`對角 $R_{ii}=E[u_i^2]$ 是各 regressor 的功率；非對角 $R_{ij}=E[u_iu_j]$ 是互相關`}
            />
            <ParamControl
              label={mathText(String.raw`$\rho_{12}$（快速設定 $R_{12}=R_{21}$）`)}
              ariaLabel="ρ₁₂（快速設定 R₁₂ = R₂₁）"
              value={params.R[0][1]}
              onChange={(v) => {
                const R = params.R.map((r) => r.slice())
                R[0][1] = v
                R[1][0] = v
                set('R', R)
              }}
              min={-1}
              max={1}
              step={0.0001}
              digits={6}
              unit="無因次"
              reg="BEH_RHO12"
              hint={mathText(String.raw`$\lambda=1\pm\rho_{12}$（$2\times2$、對角為 1）；$|\rho_{12}|=1\Rightarrow\lambda_{\min}=0$（不可辨識）`)}
            />
          </>
        ) : (
          <MatrixEditor
            label={String.raw`\mathbf J_n=\mathbf J/K_q`}
            value={sliceMat(params.Jn, params.P)}
            onChange={(A) => set('Jn', embedMat(params.Jn, A))}
            min={-10}
            max={10}
            reg="MEAS_J[i][j]"
            unit="無因次"
            hint={String.raw`$J_{ij}=\partial E[G_i]/\partial w_j$；對角 $<0$ 代表單一 loop 極性正確。T18：$\begin{bmatrix}-1&2\\2&-1\end{bmatrix}$`}
          />
        )}
        <ParamControl
          label={mathText(String.raw`$\sigma_v$（comparator 前雜訊）`)}
          ariaLabel="σ_v（comparator 前雜訊）"
          value={params.sigmaV}
          onChange={(v) => set('sigmaV', v)}
          min={0.01}
          max={10000}
          log
          unit="fs"
          reg="BEH_SIGMA_V"
          hint={mathText(String.raw`$K_q=\sqrt{2/\pi}/\sigma_v=${tn(Math.sqrt(2 / Math.PI) / params.sigmaV, 4)}\ \mathrm{fs}^{-1}$；$\sigma_v=0.7979\ \mathrm{fs}\Rightarrow K_q=1$`)}
        />
        <ParamControl
          label={mathText('$N$（GMAC block 長度）')}
          ariaLabel="N（GMAC block 長度）"
          value={params.N}
          onChange={(v) => set('N', v)}
          min={1}
          max={1048576}
          log
          integer
          clampOnBlur
          unit="samples"
          reg="REG_GMAC_N[19:0]"
          hint={mathText(String.raw`$\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R_x/N$；$N$ 越大雜訊越小、但每次更新越慢`)}
        />
        <SelectControl<RegressorDist>
          label="Regressor 分布"
          value={params.dist}
          onChange={(v) =>
            // ±1 碼的功率恆為 1：切換時把 R 換成相關係數矩陣（否則鎖住的對角線無法修正）
            setParams((p) => ({ ...p, dist: v, R: v === 'pm1' ? toCorrelation(p.R) : p.R }))
          }
          options={[
            { value: 'gaussian', label: 'Gaussian（u ~ N(0, R)）' },
            { value: 'pm1', label: '±1 碼（E[uuᵀ] = R，P ≤ 3）' },
          ]}
          reg="BEH_CODE_DIST"
        />
        <SelectControl<MimoEngine>
          label="模擬引擎"
          value={params.engine}
          onChange={(v) => set('engine', v)}
          options={[
            { value: 'linear', label: 'linear：G = K_qCδ + η（封閉式精確）' },
            { value: 'sample', label: 'sample：逐 sample 1-bit comparator（真正 Sign-LMS）' },
          ]}
          reg="BEH_ENGINE"
        />
      </fieldset>

      <fieldset className="ch10-fieldset">
        <legend>初始誤差與長度</legend>
        {Array.from({ length: params.P }, (_, i) => (
          <ParamControl
            key={i}
            label={mathText(String.raw`$\delta_{0,${i + 1}}=a_{${i + 1}}-w_{${i + 1}}(0)$`)}
            ariaLabel={`δ₀,${i + 1} = a${i + 1} − w${i + 1}(0)`}
            value={params.delta0[i]}
            onChange={(v) => set('delta0', params.delta0.map((d, j) => (j === i ? v : d)))}
            min={-1000}
            max={1000}
            step={0.1}
            unit="fs"
            reg={`BEH_DELTA0_${i + 1}`}
          />
        ))}
        <ParamControl label={mathText('blocks（更新次數 $k$）')} ariaLabel="blocks（更新次數 k）" value={params.blocks} onChange={(v) => set('blocks', v)} min={1} max={50000} log integer clampOnBlur unit="blocks" reg="BEH_SIM_BLOCKS" />
        <ToggleControl label="同時畫出全部六種規則（同 seed）" value={params.showAllRules} onChange={(v) => set('showAllRules', v)} reg="BEH_PLOT_ALL_RULES（顯示選項）" hint={mathText(String.raw`使用 active case 的 $\mu K_q$／$\gamma$／$\lambda_{\mathrm{reg}}$`)} />
      </fieldset>

      <fieldset className="ch10-fieldset">
        <legend>
          <Tex>{String.raw`\hat{\mathbf J}`}</Tex>（建構 <Tex>{String.raw`\mathbf M`}</Tex> 用的 Jacobian 估計）
        </legend>
        <SelectControl<JhatSource>
          label={mathText(String.raw`$\hat{\mathbf J}$ 來源`)}
          ariaLabel="Ĵ 來源"
          value={params.jhatSource}
          onChange={(v) => set('jhatSource', v)}
          options={[
            { value: 'exact', label: 'exact：Ĵ = J（模型完全匹配）' },
            { value: 'finiteDiff', label: 'finiteDiff：§10.2 中央差分量測' },
            { value: 'perturbed', label: 'perturbed：J + 隨機誤差 ε' },
            { value: 'custom', label: 'custom：自行輸入 Ĵ_n' },
          ]}
          reg="FW_JHAT_SOURCE"
        />
        {params.jhatSource === 'perturbed' && (
          <ParamControl
            label={mathText(String.raw`$\varepsilon$（相對 Frobenius 誤差）`)}
            ariaLabel="ε（相對 Frobenius 誤差）"
            value={params.perturbRel}
            onChange={(v) => set('perturbRel', v)}
            min={0}
            max={2}
            step={0.0001}
            unit="無因次"
            reg="BEH_JHAT_ERR"
            hint={mathText(String.raw`$\|\hat{\mathbf J}-\mathbf J\|_F=\varepsilon\|\mathbf J\|_F$（seeded）`)}
          />
        )}
        {params.jhatSource === 'finiteDiff' && (
          <>
            <ParamControl
              label={mathText(String.raw`$\Delta$（擾動量）`)}
              ariaLabel="Δ（擾動量）"
              value={params.fdDeltaFs}
              onChange={(v) => set('fdDeltaFs', v)}
              min={0.001}
              max={10000}
              log
              unit="fs"
              reg="FW_JAC_DELTA"
              hint={mathText(String.raw`$\Delta/\sigma_v=${tn(params.fdDeltaFs / params.sigmaV, 3)}$；太大 ⇒ 截斷偏小，太小 ⇒ 雜訊大`)}
            />
            <ParamControl label={mathText('$N_J$（每次量測的 samples）')} ariaLabel="N_J（每次量測的 samples）" value={params.fdSamples} onChange={(v) => set('fdSamples', v)} min={16} max={4000000} log integer clampOnBlur unit="samples" reg="FW_JAC_NSAMP" />
          </>
        )}
        {params.jhatSource === 'custom' && (
          <MatrixEditor
            label={String.raw`\hat{\mathbf J}_n`}
            value={sliceMat(params.jhatCustom, params.P)}
            onChange={(A) => set('jhatCustom', embedMat(params.jhatCustom, A))}
            min={-10}
            max={10}
            reg="FW_JHAT[i][j]"
            unit="無因次"
            hint={String.raw`E24 例：真實 $\rho=0.99$，$\hat{\mathbf J}_n$ 用 $\hat\rho=0.996$ ⇒ $\begin{bmatrix}-1&-0.996\\-0.996&-1\end{bmatrix}$`}
          />
        )}
      </fieldset>

      <fieldset className="ch10-fieldset">
        <legend>
          更新矩陣 <Tex>{String.raw`\mathbf M`}</Tex>（Case A / B / C）
        </legend>
        <CaseSelector cases={cases} />
        <SelectControl<MimoRule> label={`Case ${cases.activeId} 規則`} value={activeCase.rule} onChange={(v) => updateActive({ rule: v })} options={RULE_OPTIONS} reg="REG_CAL_MODE" />
        {activeCase.rule === 'scalar' && (
          <ParamControl
            label={mathText(String.raw`$\mu K_q$（正規化步長）`)}
            ariaLabel="μK_q（正規化步長）"
            value={activeCase.muKq}
            onChange={(v) => updateActive({ muKq: v })}
            min={0}
            max={4}
            step={0.0001}
            digits={6}
            unit="無因次"
            reg="REG_CAL_MU"
            hint={mathText(String.raw`實體 $\mu=\mu K_q/K_q=${tn(activeCase.muKq / (Math.sqrt(2 / Math.PI) / params.sigmaV), 4)}\ \mathrm{fs}$（勘誤 E05）`)}
          />
        )}
        {activeCase.rule !== 'scalar' && (
          <ParamControl
            label={mathText(activeCase.rule === 'nlms' ? String.raw`$\tilde\mu$（NLMS 正規化步長）` : String.raw`$\gamma$（目標 loop gain）`)}
            ariaLabel={activeCase.rule === 'nlms' ? 'μ̃（NLMS 正規化步長）' : 'γ（目標 loop gain）'}
            value={activeCase.gamma}
            onChange={(v) => updateActive({ gamma: v })}
            min={0}
            max={4}
            step={0.0001}
            digits={6}
            unit="無因次"
            reg="REG_CAL_GAMMA"
            hint={mathText(
              activeCase.rule === 'full'
                ? String.raw`$\hat{\mathbf J}=\mathbf J$ 時所有 pole $=1-\gamma$；穩定需 $0<\gamma<2$`
                : activeCase.rule === 'nlms'
                  ? String.raw`$p_i=1-\tilde\mu\lambda_i/\operatorname{tr}\mathbf R$`
                  : String.raw`單一 loop pole $=1-\gamma$`,
            )}
          />
        )}
        {activeCase.rule === 'regularized' && (
          <>
            <SelectControl<RegForm>
              label="Regularizer 形式"
              value={activeCase.regForm}
              onChange={(v) => updateActive({ regForm: v })}
              options={[
                { value: 'R', label: 'R 形式：γ(R̂ + λ_reg I)⁻¹（需 Ĵ 對稱）' },
                { value: 'J', label: 'J 形式：−γ(ĴᵀĴ + λ_reg I)⁻¹Ĵᵀ' },
              ]}
              reg="REG_CAL_REG_FORM"
            />
            <ParamControl
              label={mathText(String.raw`$\lambda_{\mathrm{reg}}$`)}
              ariaLabel="λ_reg"
              value={activeCase.lambdaReg}
              onChange={(v) => updateActive({ lambdaReg: v })}
              min={0}
              max={100}
              step={0.00001}
              digits={6}
              unit={activeCase.regForm === 'R' ? String.raw`無因次（$\mathbf R$ 尺度）` : String.raw`無因次（$J_n^2$ 尺度）`}
              reg="REG_CAL_LAMBDA_REG"
              hint={mathText(
                activeCase.regForm === 'R'
                  ? String.raw`與 $\mathbf R$ 同尺度（無因次）`
                  : String.raw`與 $J_n^2$ 同尺度；實體 $\lambda_{\mathrm{reg}}=${tn(activeCase.lambdaReg * Math.pow(Math.sqrt(2 / Math.PI) / params.sigmaV, 2), 3)}\ \mathrm{fs}^{-2}$（勘誤 E22）`,
              )}
            />
          </>
        )}
        {activeCase.rule === 'sequential' && (
          <>
            <ParamControl label={mathText('每階段 blocks $K$')} ariaLabel="每階段 blocks K" value={activeCase.seqBlocksPerPhase} onChange={(v) => updateActive({ seqBlocksPerPhase: v })} min={1} max={10000} integer clampOnBlur unit="blocks" reg="FSM_PHASE_LEN" />
            <ParamControl label="輪流次數（sweeps）" value={activeCase.seqSweeps} onChange={(v) => updateActive({ seqSweeps: v })} min={1} max={1000} integer clampOnBlur unit="sweeps" reg="FSM_NUM_SWEEPS" hint="1 = 一次性分階段；之後全部凍結" />
          </>
        )}
      </fieldset>

      <fieldset className="ch10-fieldset">
        <legend>Monte Carlo（穩態共變異，按 Run）</legend>
        <ParamControl label="chains" value={params.mcChains} onChange={(v) => set('mcChains', v)} min={2} max={4096} log integer clampOnBlur unit="chains" reg="MC_CHAINS" hint="CI 以 chains 間的 Student-t 計算" />
        <ParamControl label="每條 chain 記錄 blocks" value={params.mcRecord} onChange={(v) => set('mcRecord', v)} min={1} max={200000} log integer clampOnBlur unit="blocks" reg="MC_RECORD_BLOCKS" hint={mathText(String.raw`burn-in 自動 $=\lceil6/(-\ln\rho(\mathbf A))\rceil$`)} />
      </fieldset>
    </>
  )

  const units: Record<string, string> = {
    sigmaV: 'fs',
    N: 'samples',
    delta0: 'fs',
    blocks: 'blocks',
    muKq: '無因次（μK_q）',
    gamma: '無因次',
    lambdaReg: 'R 形式無因次；J 形式 J_n² 尺度',
    fdDeltaFs: 'fs',
    fdSamples: 'samples',
    'M_n': '無因次（K_q·M）',
    M: 'fs',
  }

  const shellParams: Record<string, unknown> = {
    P,
    mode: eff.params.mode,
    matrix: JSON.stringify(sliceMat(eff.params.mode === 'R' ? eff.params.R : eff.params.Jn, P)),
    sigmaV: eff.params.sigmaV,
    Kq: plant.Kq,
    N: eff.params.N,
    dist: eff.params.dist,
    engine: eff.params.engine,
    delta0: JSON.stringify(delta0),
    blocks: eff.params.blocks,
    jhatSource: eff.params.jhatSource,
    freezeAt: freezeAt ?? 'none',
    cases: eff.cases.map((c) => `${c.id}:${c.params.rule}(μK_q=${c.params.muKq},γ=${c.params.gamma},λ_reg=${c.params.lambdaReg},${c.params.regForm})`).join('; '),
  }

  const presets = presetsForExperiment(EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.galleryIndex ? `Gallery #${p.galleryIndex}：${p.title}` : p.title, params: p.params, description: p.description }))

  const kText = kView === null ? '全部' : `k = ${kView}`

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title="MIMO LMS Lab：Matrix Inspector、更新方向、權重軌跡與穩態共變異"
      level="L3"
      claim="exact"
      tests={['T18', 'T10']}
      headingLevel={3}
      description={
        <>
          同一個 seed 下比較 scalar / diagonal / NLMS / 完整反矩陣 / regularized / sequential。poles 一律由實際使用的 <Tex>{String.raw`\mathbf M`}</Tex>（以 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 建構）與真實 <Tex>{String.raw`\mathbf J`}</Tex> 計算{' '}
          <Tex>{String.raw`\operatorname{eig}(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J)`}</Tex>
          <Erratum id="E24" />；穩態共變異以離散 Lyapunov 解出，並可用 Monte Carlo（worker）驗證。<Tex>{String.raw`\mu`}</Tex> 以無因次的{' '}
          <Tex>{String.raw`\mu K_q`}</Tex> 輸入並同時顯示實體 fs 值
          <Erratum id="E05" />。「凍結 Freeze」模擬硬體的 Freeze gain（§10.2）：在目前檢視的 block（或 active case 的 <Tex>{'k_{95}'}</Tex>）之後停止更新{' '}
          <Tex>{String.raw`\mathbf w`}</Tex>，GMAC 照常量測。
        </>
      }
      assumptions={[
        String.raw`$\boldsymbol\delta=\mathbf a-\mathbf w$（fs）；regressor 正規化（無因次）；$\mathbf G$ 為 average 模式 $\frac1N\sum q\,\mathbf x$`,
        String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$：Gaussian comparator noise、小誤差線性化（sample 引擎不需此假設）`,
        String.raw`linear 引擎：$\mathbf G=K_q\mathbf C\boldsymbol\delta+\boldsymbol\eta$，$\boldsymbol\eta\sim\mathcal N(\mathbf 0,\mathbf R_x/N)$（iid block、近平衡）；所有封閉式在此模型下精確`,
        String.raw`sample 引擎：block 內 $\mathbf u[n]$、$v[n]$ iid；$\pm1$ 碼以 $p(\mathbf s)=\big(1+\sum_{i<j}s_is_jR_{ij}\big)/2^P$ 產生（$P\le3$）`,
        String.raw`poles $=\operatorname{eig}\big(\mathbf I+\mathbf M(\hat{\mathbf J})\,\mathbf J_{\text{true}}\big)$，$\hat{\mathbf J}\ne\mathbf J$ 時與封閉式不同（勘誤 E24）；$\lambda_{\mathrm{reg}}$ 不是 eigenvalue（勘誤 E22）`,
        String.raw`$k_{95}$：最小的 $k$，使所有 $j\ge k$ 都有 $\|\mathbf A^j\|_2\le0.05$（最壞初始方向的誤差長度降到 5% 以下、且之後不再超過；sequential 用 $\|\boldsymbol\Phi_j\|_2$）。$\mathbf A=\mathbf I+\mathbf M\mathbf J$ 是正規矩陣（$\mathbf A\mathbf A^T=\mathbf A^T\mathbf A$，對稱屬之）時等於 F-10.5 的 $\lceil\ln0.05/\ln\rho(\mathbf A)\rceil$；非正規（一般 $\mathbf J$、$\hat{\mathbf J}\ne\mathbf J$、各 loop 增益不同）時 F-10.5 只是下界`,
        '靜態 plant：沒有 PLL 動態、更新延遲、定點量化（見第 8、13 章）',
        'Case A/B/C 與「六種規則」共用同一條 GMAC 亂數串流（paired comparison）',
      ]}
      params={shellParams}
      units={units}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: analyticCheck, monteCarlo: mcCheck, fixedPoint: { status: 'not-implemented', note: 'MIMO 的定點 / RTL 模型尚未實作（見第 13 章單參數版本）' } }}
      actions={{
        onReset,
        onStep,
        onRun: onRunMc,
        onStop: cancelMc,
        onRunToConvergence,
        onFreeze,
        running: mcRunning,
        frozen: freezeAt !== null,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={controls}
    >
      <div className="ch10-kpi">
        <KPI
          label={<Tex>{'K_q'}</Tex>}
          value={
            <>
              {n(plant.Kq, 4)} <Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>
            </>
          }
        />
        <KPI
          label={<Tex>{eff.params.mode === 'R' ? String.raw`\lambda_i(\mathbf R)` : String.raw`\sigma_i(\mathbf J_n)`}</Tex>}
          value={plant.modeValues.map((v) => n(v, 4)).join(' / ') || '—'}
        />
        <KPI label={<Tex>{String.raw`\kappa`}</Tex>} value={inspection ? n(inspection.cond, 4) : '—'} />
        <KPI label="檢視 block" value={<span className="ch10-step-cursor">{kText}</span>} />
        {analyses.map((a, i) => (
          <KPI
            key={eff.cases[i].id}
            label={
              <>
                <span className="ch10-swatch" style={{ background: tokens.series[i] }} />
                Case {eff.cases[i].id}：{RULE_SHORT[eff.cases[i].params.rule]}
              </>
            }
            value={
              a && a.ok ? (
                <span className={a.stable ? undefined : 'ch10-bad'}>
                  <Tex>{String.raw`\rho(\mathbf A)=${tn(chop(a.spectralRadius), 5)},\ k_{95}${a.blocks95Basis === 'lower-bound' ? String.raw`\ge` : '='}${a.blocks95 === null ? '\\infty' : tint(a.blocks95)}`}</Tex>
                </span>
              ) : (
                <span className="ch10-bad small">{mathText(plant.errors.length ? 'Plant 無效（見警告）' : a?.error ? String.raw`無法建立 $\mathbf M$` : JnHat ? '—' : String.raw`等待 $\hat{\mathbf J}$…`)}</span>
              )
            }
          />
        ))}
      </div>

      {plant.errors.length === 0 && inspection && (
        <details className="ch10-deriv" open>
          <summary>
            <span className="ch10-deriv-badge">Matrix Inspector</span> eigen / singular values、反矩陣、<Tex>{String.raw`\mathbf M`}</Tex> 與 <Tex>{String.raw`\mathbf A=\mathbf I+\mathbf M\mathbf J`}</Tex>（Case {eff.activeId}）
          </summary>
          <div className="ch10-deriv-body">
            <div className="grid-2">
              <div className="ch10-scroll">
                <p className="small">
                  <Tex>{`${eff.params.mode === 'R' ? String.raw`\mathbf R` : String.raw`\mathbf J_n`}=${texMat(sliceMat(eff.params.mode === 'R' ? plant.Ru : plant.Jn, P), 4)}`}</Tex>
                </p>
                <p className="small">
                  eigenvalues <Tex>{eff.params.mode === 'R' ? String.raw`\lambda_i(\mathbf R)` : String.raw`\operatorname{eig}(\mathbf J_n)`}</Tex>：{inspection.eig.map(complexText).join('、')}
                  <br />
                  singular values <Tex>{String.raw`\sigma_i`}</Tex>：{inspection.singular.map((s) => n(s, 5)).join('、')}
                  <br />
                  <Tex>{String.raw`\det=${tn(inspection.det, 5)},\ \operatorname{tr}=${tn(inspection.trace, 5)},\ \kappa=${tn(inspection.cond, 5)}`}</Tex>
                  {inspection.symmetric ? '，對稱' : '，不對稱'}
                  {eff.params.mode === 'R' && (inspection.positiveDefinite ? '，正定' : '，非正定')}
                </p>
                {inspection.inverse ? (
                  <p className="small">
                    反矩陣：<Tex>{texMat(inspection.inverse, 4)}</Tex>
                  </p>
                ) : (
                  <p className="small ch10-bad">
                    奇異：反矩陣不存在（<Tex>{String.raw`\lambda_{\min}=0`}</Tex> ⇒ 不可辨識）
                  </p>
                )}
                {JnHat && jhatInfo && jhatInfo.source !== 'exact' && (
                  <p className="small">
                    <Tex>{String.raw`\hat{\mathbf J}_n=${texMat(JnHat, 4)}`}</Tex>（{mathText(jhatInfo.note)}；
                    <Tex>{String.raw`\|\hat{\mathbf J}-\mathbf J\|_F/\|\mathbf J\|_F=${tn(100 * jhatInfo.relErr, 3)}\%`}</Tex>）
                    {jhatInfo.expected && (
                      <>
                        <br />
                        理論期望（含 1-bit 截斷）<Tex>{String.raw`E[\hat{\mathbf J}_n]=${texMat(jhatInfo.expected, 4)}`}</Tex>，每元素{' '}
                        <Tex>{String.raw`\operatorname{std}\approx${tn(jhatInfo.std?.[0]?.[0] ?? NaN, 3)}`}</Tex>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="ch10-scroll">
                {activeAn && activeAn.ok ? (
                  <>
                    {activeAn.Mn && (
                      <p className="small">
                        <Tex>{String.raw`\mathbf M_n=K_q\mathbf M=${texMat(activeAn.Mn, 4)}`}</Tex>
                        <br />
                        <Tex>{String.raw`\mathbf M=${texMat(activeAn.Mphys as Mat, 4)}\ \mathrm{fs}`}</Tex>
                      </p>
                    )}
                    {activeAn.A && (
                      <p className="small">
                        <Tex>{String.raw`${activeCfg.rule === 'sequential' ? '\\boldsymbol\\Phi_{\\text{sweep}}' : '\\mathbf A=\\mathbf I+\\mathbf M\\mathbf J'}=${texMat(activeAn.A, 4, 1)}`}</Tex>
                      </p>
                    )}
                    <p className="small">
                      poles：{activeAn.poles.map(complexText).join('、')}
                      {activeAn.closedPoles && (
                        <>
                          <br />
                          封閉式（依模式 <Tex>{String.raw`i=1,\dots,${P}`}</Tex> 的順序，<Tex>{eff.params.mode === 'R' ? String.raw`\lambda_i` : String.raw`\sigma_i`}</Tex> 由大到小）：{activeAn.closedPoles.map((p) => n(chop(p), 5)).join('、')} <ClaimTag kind="exact" />
                          <br />
                          模式 loop gain <Tex>{String.raw`g_i=1-p_i`}</Tex>
                          {activeCfg.rule === 'scalar' && eff.params.mode === 'R' && (
                            <>
                              （<Tex>{String.raw`=\mu K_q\lambda_i`}</Tex>
                              <Erratum id="E05" />）
                            </>
                          )}
                          ：
                          {activeAn.closedPoles.map((p) => n(1 - chop(p), 5)).join('、')}
                        </>
                      )}
                    </p>
                    {activeAn.modeVar && (
                      <p className="small">
                        模式變異 <Tex>{String.raw`\operatorname{Var}(\xi_i),\ \boldsymbol\xi=\mathbf V^T\boldsymbol\delta`}</Tex>：{activeAn.modeVar.map((v) => n(v, 4)).join('、')} <Tex>{String.raw`\mathrm{fs}^2`}</Tex>
                        {activeAn.closedModeVar && <>（封閉式 F-10.7：{activeAn.closedModeVar.map((v) => n(v, 4)).join('、')}）</>}
                        <br />
                        每參數 <Tex>{String.raw`\operatorname{Var}(\delta_j)`}</Tex>：{activeAn.perParamVar?.map((v) => n(v, 4)).join('、')} <Tex>{String.raw`\mathrm{fs}^2`}</Tex>（兩者不同
                        <Erratum id="E37" />）
                      </p>
                    )}
                  </>
                ) : (
                  <p className="small ch10-bad">{mathText(activeAn?.error ?? (JnHat ? '—' : String.raw`等待 $\hat{\mathbf J}$ 量測…`))}</p>
                )}
              </div>
            </div>
          </div>
        </details>
      )}

      <div className="ch10-plot-pair">
        <Plot
          title={String.raw`poles $=\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)$（單位圓內才收斂）`}
          ariaLabel="poles = eig(I + MJ)（單位圓內才收斂）"
          data={poleData}
          height={360}
          csvName="ch10-poles"
          layout={poleLayout}
        />
        <Plot
          title={String.raw`相平面 $(\delta_1,\delta_2)$ 與平均更新方向（Case ${eff.activeId}）`}
          ariaLabel={`相平面 (δ₁, δ₂) 與平均更新方向（Case ${eff.activeId}）`}
          data={phaseData}
          height={480}
          csvName="ch10-phase-plane"
          layout={phaseLayout}
          caption={P === 3 ? String.raw`$P=3$：方向場畫在 $\delta_3=0$ 的切面上。` : '箭頭 = 平均每個 block 的修正方向；scalar LMS 的箭頭不指向原點（沿快模式先走），完整反矩陣則直指原點。'}
        />
      </div>

      <Plot
        title={String.raw`權重誤差軌跡 $\boldsymbol\delta_k$（${eff.params.engine === 'sample' ? '逐 sample 1-bit GMAC' : '線性 GMAC'}；同 seed）${trajRunning ? '…計算中' : ''}`}
        ariaLabel={`權重誤差軌跡 δ_k（${eff.params.engine === 'sample' ? '逐 sample 1-bit GMAC' : '線性 GMAC'}；同 seed）`}
        data={trajData}
        height={340}
        csvName="ch10-trajectories"
        layout={trajLayout}
        caption={String.raw`實線 = 模擬路徑（$\delta_1$ 實線、$\delta_2$ 點線、$\delta_3$ 點劃線）；虛線 = 線性模型的精確平均 $E[\boldsymbol\delta_k]$；色帶 = active case 的解析 $\pm2\sigma$。${eff.params.engine === 'sample' ? ' 長點劃線 = 含 erf 增益壓縮的 mean-field。' : ''}${freezeAt !== null ? String.raw` 垂直虛線 = Freeze gain（$k=${freezeAt}$），之後 $\mathbf w$ 不再更新。` : ''}${trajFresh ? '' : '（結果更新中）'}`}
      />

      {eff.params.showAllRules && (
        <Plot
          title={String.raw`全部六種規則 $\|\boldsymbol\delta_k\|$（同 seed、active case 的超參數：$\mu K_q=${tn(activeCfg.muKq, 6)}$、$\gamma=${tn(activeCfg.gamma, 6)}$、$\lambda_{\mathrm{reg}}=${tn(activeCfg.lambdaReg, 6)}$）`}
          ariaLabel={`全部六種規則 ‖δ_k‖（同 seed、active case 的超參數：μK_q = ${activeCfg.muKq}、γ = ${activeCfg.gamma}、λ_reg = ${activeCfg.lambdaReg}）`}
          data={normData}
          height={300}
          yLog
          csvName="ch10-all-rules-norm"
          layout={normLayout}
          caption={String.raw`Diagonal / sequential 需要 $\hat J_{ii}<0$；任一規則失敗會在警告中說明原因。`}
        />
      )}

      <h3 className="ch10-sub">收斂速度 vs 雜訊懲罰（六種規則，解析）</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>規則</th>
              <th className="ch10-num">
                <Tex>{String.raw`\rho(\mathbf I+\mathbf M\mathbf J)`}</Tex>
              </th>
              <th className="ch10-num">
                <Tex>{'k_{95}'}</Tex>（blocks）
              </th>
              <th className="ch10-num">
                穩態 <Tex>{String.raw`\max_j\mathrm{RMS}(\delta_j)`}</Tex>
              </th>
              <th className="ch10-num">雜訊懲罰（vs Scalar）</th>
              <th className="ch10-num">有效性指標</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {allRuleAnalyses.map((a) => {
              const base = allRuleAnalyses[0]
              const rms = a.perParamVar ? Math.sqrt(Math.max(...a.perParamVar)) : null
              const baseRms = base?.perParamVar ? Math.sqrt(Math.max(...base.perParamVar)) : null
              return (
                <tr key={a.rule} className={a.rule === activeCfg.rule ? 'ch10-hl' : undefined}>
                  <td>{RULE_SHORT[a.rule]}</td>
                  <td className="ch10-num">{a.ok ? n(chop(a.spectralRadius), 5) : '—'}</td>
                  <td className="ch10-num">
                    {a.ok ? (a.blocks95 === null ? mathText(String.raw`$\infty$ / 未達成`) : a.blocks95Basis === 'lower-bound' ? mathText(String.raw`$\ge$ ${nint(a.blocks95)}`) : nint(a.blocks95)) : '—'}
                  </td>
                  <td className="ch10-num">{rms !== null ? `${n(rms, 4)} fs` : '—'}</td>
                  <td className="ch10-num">{rms !== null && baseRms ? <Tex>{String.raw`\times${tn(rms / baseRms, 3)}`}</Tex> : '—'}</td>
                  <td className="ch10-num">{a.validityIndex !== null ? n(a.validityIndex, 2) : '—'}</td>
                  <td className={a.ok && a.stable && !(a.rule === 'sequential' && a.blocks95 === null) ? 'ch10-good small' : a.ok ? 'ch10-bad small' : 'ch10-bad small ch10-status-msg'}>
                    {a.ok
                      ? !a.stable
                        ? Math.abs(a.spectralRadius - 1) <= MARGINAL_TOL
                          ? mathText(String.raw`臨界（$|p|=1$：不收斂）`)
                          : '發散'
                        : a.rule === 'sequential' && a.blocks95 === null
                          ? mathText(String.raw`排程結束時誤差仍 $>5\%$（未收斂就凍結）`)
                          : '穩定'
                      : mathText(a.error)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        有效性指標 = <Tex>{String.raw`\operatorname{tr}(\mathbf R_u\operatorname{Cov}\boldsymbol\delta)/\sigma_v^2`}</Tex>，需 <Tex>{String.raw`\ll1`}</Tex> 才能用{' '}
        <Tex>{'K_q'}</Tex> 線性化（§10.4.1 Research）。Sequential 的 RMS 是排程結束凍結時的值。雜訊懲罰 = 該規則的 RMS 除以 Scalar 的 RMS（同一組超參數）。<Tex>{'k_{95}'}</Tex>{' '}
        六列用同一個定義：最壞初始方向的 <Tex>{String.raw`\|\boldsymbol\delta_k\|`}</Tex> 降到 5% 以下、且之後不再超過；<Tex>{String.raw`\mathbf A`}</Tex> 對稱（正規）時就是最慢 pole 的{' '}
        <Tex>{String.raw`\lceil\ln0.05/\ln|p|\rceil`}</Tex>（F-10.5），否則 F-10.5 只是下界（§10.3.1）。
      </p>

      <h3 className="ch10-sub">穩態共變異：Monte Carlo vs 公式（Case {mc?.caseId ?? eff.activeId}）</h3>
      {!mc && !mcRunning && (
        <Callout kind="info" title="按上方「執行 Run」">
          <p>
            在 worker 中跑 {eff.params.mcChains} 條獨立 chain（{eff.params.engine === 'sample' ? `逐 sample，預估 ${n(mcCost, 3)} samples` : '線性引擎'}），以 chains 間的 Student-t 給出 95% CI，與 Lyapunov
            解析共變異及 F-10.6 / F-10.7 封閉式比較。
            {mcCost > MAX_SAMPLE_BUDGET && <span className="ch10-bad"> 預估運算量超過預算，請減少 chains / record / N。</span>}
          </p>
        </Callout>
      )}
      {mcRunning && <p className="small muted">Monte Carlo 執行中…（可按「停止」）</p>}
      {mc && mc.res.ok && (
        <>
          {mcStale && <p className="small ch10-bad">參數已改變：下列結果對應舊參數，請重新執行。</p>}
          <Plot
            title={String.raw`$\boldsymbol\delta$ 的${mc.res.kind === 'final' ? '排程結束' : '穩態'}分布與 95% 橢圓（fs）`}
            ariaLabel={`δ 的${mc.res.kind === 'final' ? '排程結束' : '穩態'}分布與 95% 橢圓（fs）`}
            data={mcData}
            height={320}
            csvName="ch10-mc-scatter"
            layout={mcLayout}
            caption={`${mc.res.chains} chains $\\times$ ${mc.res.recordBlocks} blocks（burn-in ${mc.res.burnIn}）；${mc.res.samplesUsed > 0 ? `${n(mc.res.samplesUsed, 3)} comparator samples` : '線性引擎'}。`}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    模式 i（<Tex>{String.raw`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta`}</Tex>）
                  </th>
                  <th className="ch10-num">
                    <Tex>{eff.params.mode === 'R' ? String.raw`\lambda_i` : String.raw`\sigma_i`}</Tex>
                  </th>
                  <th className="ch10-num">
                    封閉式 <Tex>{String.raw`\operatorname{Var}(\xi_i)`}</Tex>
                  </th>
                  <th className="ch10-num">Lyapunov</th>
                  <th className="ch10-num">MC [95% CI]</th>
                </tr>
              </thead>
              <tbody>
                {mc.res.modeVar.map((v, i) => (
                  <tr key={i}>
                    <td>mode {i + 1}</td>
                    <td className="ch10-num">{n(mc.res.modeValues[i], 4)}</td>
                    <td className="ch10-num">{mc.res.modeVarClosed ? n(mc.res.modeVarClosed[i], 5) : '—'}</td>
                    <td className="ch10-num">{mc.res.modeVarAnalytic ? n(mc.res.modeVarAnalytic[i], 5) : '—'}</td>
                    <td className="ch10-num">
                      {n(v, 5)} [{n(mc.res.modeVarLo[i], 4)}, {n(mc.res.modeVarHi[i], 4)}]
                    </td>
                  </tr>
                ))}
                {/* 以 MC 結果自己的維度為準：結果可能是舊參數（P 不同）的，不能用目前的 P 去索引 */}
                {mc.res.cov.map((_, j) => (
                  <tr key={`p${j}`}>
                    <td>
                      參數 <Tex>{`\\delta_{${j + 1}}`}</Tex>
                    </td>
                    <td className="ch10-num">—</td>
                    <td className="ch10-num">—</td>
                    <td className="ch10-num">{mc.res.covAnalytic ? n(mc.res.covAnalytic[j][j], 5) : '—'}</td>
                    <td className="ch10-num">
                      {n(mc.res.cov[j][j], 5)} [{n(mc.res.covLo[j][j], 4)}, {n(mc.res.covHi[j][j], 4)}]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            單位 <Tex>{String.raw`\mathrm{fs}^2`}</Tex>。模式變異與每參數變異是兩件事（勘誤 E37）。MC 有效性指標 <Tex>{String.raw`E[\boldsymbol\delta^T\mathbf R_u\boldsymbol\delta]/\sigma_v^2=${tn(mc.res.validityIndexMc, 3)}`}</Tex>。
          </p>
        </>
      )}
      {mc && !mc.res.ok && <p className="small ch10-bad">{mathText(mc.res.error)}</p>}

      <p className="small muted">
        模式：{eff.params.engine === 'sample' ? `sample 引擎，時域約 ${n(trajCost, 3)} samples` : 'linear 引擎'}；
        {freezeAt !== null ? (
          <span data-freeze-at={freezeAt}>
            Freeze gain：<Tex>{String.raw`k\ge${freezeAt}`}</Tex> 後 <Tex>{String.raw`\mathbf w`}</Tex> 不再更新（GMAC 照常量測）
          </span>
        ) : (
          <>
            未凍結（再按 Freeze 會在目前檢視的 block 或 <Tex>{'k_{95}'}</Tex> 停止更新）
          </>
        )}
        ；參數變更後 250 ms 自動重算；<Tex>{String.raw`\hat{\mathbf J}`}</Tex>：
        {mathText(jhatInfo?.note ?? '—')}。
      </p>
    </ExperimentShell>
  )
}

function cfgOf(eff: Effective, i: number): RuleConfig {
  return eff.cases[i]?.params ?? DEFAULT_CASES[0]
}
