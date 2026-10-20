import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ExperimentShell, ParamControl, Plot, SelectControl, Tex, mathText, useDebouncedValue, useThemeTokens, type CheckStatus, type ExperimentPreset, type MetricRow } from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  CODE_RANGE,
  CODE_SOURCES,
  codeVerdict,
  crosscheckCode,
  efoldVerdict,
  inversionBands,
  kappaInfHint,
  largeSignalCode,
  loopH,
  makeL2,
  type CodeSource,
  type CodeVerdict,
  type CodeVerdictKind,
  type DivergenceMc,
  type SspllCodeMcCompareParams,
  type SspllCodeMcCompareResult,
  type SspllLoop,
} from '@/simulation/models/sspll'
import { DITHER_NUM, FREF_MHZ, LOOPS, SIM_CFG, type DitherMcRow } from '../data'
import { DataTable, fp, fx, tx } from '../common'

export const CODE_EXPERIMENT_ID = 'sspll-code-source'

export type CodeLoopKey = 'L2' | 'L2_pm45' | 'L3'
/** §10b 的三個迴路：標稱的 L2（PM 60°）、L3，加上 sim 裡發散的 L2 PM 45°（重新調到 320 MHz） */
export const CODE_LOOPS: Record<CodeLoopKey, SspllLoop> = { L2: LOOPS.L2, L2_pm45: makeL2({ pm: 45 }), L3: LOOPS.L3 }
/** 下拉選單標籤裡的反號帶（帶緣、谷底）：由模型算，不手寫 */
const bandText = (lp: SspllLoop): string => {
  const b = inversionBands(lp)[0]
  return b ? `反號帶到 ${fx(b.fHi * FREF_MHZ, 0)} MHz、谷底 ${fx(b.minReH, 2)}` : '沒有反號帶'
}
export const CODE_LOOP_LABEL: Record<CodeLoopKey, string> = {
  L2: `L2：SSPLL Type-II（PM 60°，${bandText(CODE_LOOPS.L2)}）`,
  L2_pm45: `L2-PM45：SSPLL Type-II（PM 45°，${bandText(CODE_LOOPS.L2_pm45)}）`,
  L3: 'L3：CPPLL（3 階 Type-II）',
}
export const CODE_LOOP_TEX: Record<CodeLoopKey, string> = { L2: '$L_2$（PM 60°）', L2_pm45: '$L_2$ PM 45°', L3: '$L_3$' }
/** 下拉選單的純文字標籤（`<option>` 不放公式；「格」= Δ = T_vco/8） */
export const CODE_SOURCE_LABEL: Record<CodeSource, string> = {
  acc1: 'acc1：一階累加器（raw；DTC range 1 格）',
  dq: 'dq：dithered quantizer（2 格）',
  mash: 'MASH 1-1-1（4 格）',
  rot4: 'rot4：PMUX 隨機旋轉 4 相（4 格）',
  rot8: 'rot8：PMUX 隨機旋轉 8 相（8 格）',
}
/** 表格裡的短名稱 */
export const CODE_SOURCE_SHORT: Record<CodeSource, string> = { acc1: 'acc1', dq: 'dq', mash: 'MASH', rot4: 'rot4', rot8: 'rot8' }
/** 警告、指標與圖例用的 `$...$` 版 */
export const CODE_SOURCE_TEX: Record<CodeSource, string> = { acc1: 'acc1（raw，$1\\Delta$）', dq: 'dq（$2\\Delta$）', mash: 'MASH 1-1-1（$4\\Delta$）', rot4: 'rot4（$4\\Delta$）', rot8: 'rot8（$8\\Delta$）' }

export interface CodeParams {
  loop: CodeLoopKey
  /** α·f_ref [MHz] */
  fMHz: number
  caseA: CodeSource
  caseB: CodeSource | 'off'
  nBlocks: number
  nBlk: number
  tauBlocks: number
  /** 比較器雜訊的 seeds 數（code 的 seed 是 1000 + seed，與 golden 相同） */
  nSeeds: number
}

export const CODE_DEFAULTS: CodeParams = { loop: 'L2_pm45', fMHz: 120, caseA: 'mash', caseB: 'rot8', nBlocks: 1500, nBlk: 512, tauBlocks: 25, nSeeds: 4 }
export const CODE_DEFAULT_SEED = 0
/** dead-zone 門檻 τ（F-CS.28；與 golden 的 tau_dead 相同） */
export const CODE_TAU = DITHER_NUM._meta.tau_dead
/** 一次執行的總 sample 上限、參數變更後自動重跑的上限 */
export const CODE_MAX_SAMPLES = 6e7
export const CODE_AUTO_RUN_SAMPLES = 8e6
/** golden 的執行條件（dither_interaction.json 的 mc：N = 512、N_τ = 25、1500 blocks、8 seeds） */
export const GOLDEN_CODE_COND = { nBlk: 512, tauBlocks: 25, nBlocks: 1500 } as const

const SOURCE_SET = new Set<string>(CODE_SOURCES)
const LOOP_SET = new Set<string>(['L2', 'L2_pm45', 'L3'])

export function mergeCodeParams(prev: CodeParams, raw: unknown): CodeParams {
  if (!raw || typeof raw !== 'object') return prev
  const o = raw as Record<string, unknown>
  const next = { ...prev }
  if (typeof o.loop === 'string' && LOOP_SET.has(o.loop)) next.loop = o.loop as CodeLoopKey
  if (typeof o.fMHz === 'number' && o.fMHz > 0 && o.fMHz < FREF_MHZ) next.fMHz = o.fMHz
  else if (typeof o.alpha === 'number' && o.alpha > 0 && o.alpha < 1) next.fMHz = o.alpha * FREF_MHZ
  if (typeof o.caseA === 'string' && SOURCE_SET.has(o.caseA)) next.caseA = o.caseA as CodeSource
  if (typeof o.caseB === 'string' && (SOURCE_SET.has(o.caseB) || o.caseB === 'off')) next.caseB = o.caseB as CodeSource | 'off'
  const int = (k: 'nBlocks' | 'nBlk' | 'nSeeds' | 'tauBlocks', lo: number, hi: number) => {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) next[k] = k === 'tauBlocks' ? v : Math.round(v)
  }
  int('nBlocks', 100, 20000)
  int('nBlk', 64, 4096)
  int('nSeeds', 2, 16)
  int('tauBlocks', 2, 500)
  return next
}

export interface CodeSourceVerdict {
  /** F-CS.28（只有線性段）：closed form 的 κ_min 和 ±τ 比 */
  linear: CodeVerdict
  /** 沿 closed form 最差模態的 1-bit 大訊號斜率 κ_∞（F-CS.20 的 1-bit 相關，實際序列） */
  kappaInf: number
  /** 判定 = linear.verdict：dead zone 一律不判 */
  final: CodeVerdictKind
  /** dead zone 時 κ_∞ 的正負號（研究假說的提示，不參與判定；golden 的 dead zone 案例裡它錯 8 組）；不在 dead zone 時為 null */
  hint: CodeVerdictKind | null
}

/**
 * F-CS.28 的判定（只有線性段）加上 dead zone 時的 κ_∞ 提示。審查（2026-10-19）否決了「dead zone 時看 κ_∞ 的正負號」的兩段判定：
 * golden 的 18 個 dead zone 案例裡 6 個一致、8 個不一致、4 個不判（ditherNumbers.json 的 mc._summary.candidates.two_stage）。
 */
export function codeSourceVerdict(loop: SspllLoop, alpha: number, source: CodeSource, tau = CODE_TAU): CodeSourceVerdict {
  const linear = codeVerdict(loop, alpha, source, tau)
  const ls = largeSignalCode(loop, alpha, source, linear.worstMode, [1, 5], SIM_CFG)
  return { linear, kappaInf: ls.kappaInf, final: linear.verdict, hint: linear.verdict === 'dead' ? kappaInfHint(ls.kappaInf, tau) : null }
}

export const VERDICT_ZH: Record<CodeVerdictKind, string> = { inverted: '反號（預測發散）', restoring: 'restoring（預測收斂）', dead: 'dead zone（不判）' }
/** κ_∞ 提示的文字（不是判定） */
export const HINT_ZH: Record<CodeVerdictKind, string> = { inverted: '提示發散', restoring: '提示收斂', dead: '沒有提示（$\\lvert\\kappa_\\infty\\rvert\\le\\tau$）' }
/** golden 對「dead zone 看 κ_∞」這條候選判準的計分（18 個 dead zone 案例） */
export const TWO_STAGE_DZ = DITHER_NUM.mc._summary.candidates.two_stage.dead_zone
const twoStageScoreText = `golden 的 ${DITHER_NUM.mc._summary.n_dead} 個 dead zone 案例裡，把它當判定是 ${TWO_STAGE_DZ.n_ok} 個一致、${TWO_STAGE_DZ.n_mismatch} 個不一致、${TWO_STAGE_DZ.n_na} 個不判`

/** golden（Python，8 seeds）在同一組（迴路、source、α）的多 seed 結果；沒有就 null */
export function goldenMc(loop: CodeLoopKey, source: CodeSource, alpha: number): { alphaKey: string; row: DitherMcRow } | null {
  const table = DITHER_NUM.mc[`${loop}|${source}`]
  if (!table) return null
  for (const [k, row] of Object.entries(table)) if (Math.abs(Number(k) - alpha) < 1e-9) return { alphaKey: k, row }
  return null
}

/**
 * 本頁 Monte Carlo（TS，xoshiro128**）vs golden（Python，PCG64）的發散比例：兩個 95% Wilson 區間重疊、或都在 ½ 的同一側 → ok；
 * 分別在 ½ 的兩側且不重疊 → mismatch；其餘（本頁的區間含 ½ 而 golden 不含）→ n/a。
 */
export function mcAgreement(ts: Pick<DivergenceMc, 'ciDiv' | 'fracDiv' | 'n' | 'nDiv'>, g: DitherMcRow): { status: CheckStatus; why: string } {
  const [lo, hi] = ts.ciDiv
  const [glo, ghi] = g.ci_div
  const overlap = lo <= ghi && glo <= hi
  const sameSide = (lo > 0.5 && glo > 0.5) || (hi < 0.5 && ghi < 0.5)
  const base = `本頁 ${ts.nDiv}/${ts.n} 發散（95% Wilson $[${fx(lo, 2)},\\,${fx(hi, 2)}]$）vs golden ${g.n_div}/${g.n}（$[${fx(glo, 2)},\\,${fx(ghi, 2)}]$）`
  if (overlap || sameSide) return { status: 'ok', why: `${base}：區間${overlap ? '重疊' : '都在 ½ 的同一側'}` }
  if ((lo > 0.5 && ghi < 0.5) || (hi < 0.5 && glo > 0.5)) return { status: 'mismatch', why: `${base}：分別在 ½ 的兩側` }
  return { status: 'n/a', why: `${base}：本頁的區間含 ½，seeds 不夠` }
}

type Slot = 'A' | 'B'

const INLINE_PRESETS: ExperimentPreset[] = [
  { id: 'code-pm45-mash', name: 'L2-PM45、120 MHz：MASH 在 dead zone（線性模型不判）卻發散，rot8 收斂（sim 的那一點；發散的機制是研究假說）', params: { ...CODE_DEFAULTS } },
  { id: 'code-pm60-mash', name: 'L2（PM 60°）、同樣 120 MHz：MASH 收斂——Re H 只有 −0.09', params: { ...CODE_DEFAULTS, loop: 'L2' } },
  { id: 'code-l2-dq', name: 'L2、80 MHz：dq 只攤掉 10%，反號；MASH restoring', params: { ...CODE_DEFAULTS, loop: 'L2', fMHz: 80, caseA: 'dq', caseB: 'mash' } },
  { id: 'code-pm45-raw', name: 'L2-PM45、120 MHz：acc1（raw）反號 vs rot4（載波剩 43%）', params: { ...CODE_DEFAULTS, caseA: 'acc1', caseB: 'rot4' } },
  { id: 'code-l3-dq', name: 'L3、40 MHz：dq 在 dead zone、κ∞ ≈ −0.18 卻沒有發散（κ∞ 判準的反例）vs MASH', params: { ...CODE_DEFAULTS, loop: 'L3', fMHz: 40, caseA: 'dq', caseB: 'mash' } },
]

/**
 * 實驗 D（'sspll-code-source'，L3）：code source × dither × 旋轉的多 seed 閉迴路 sign-error LMS。
 * 每個 case 用 nSeeds 個 seed 各跑一次 runSspllLmsCode（Web Worker，runSspllCodeMcCompare），統計發散比例與 95% Wilson 區間，
 * 和 F-CS.28 的判定（只有線性段：closed form 的 κ_min；dead zone 不判，κ_∞ 只當研究假說的提示）交叉比對；golden（Python，8 seeds）的同一組結果在 ditherNumbers.json。
 */
export function CodeSourceLab() {
  const tokens = useThemeTokens()
  const [P, setP] = useState<CodeParams>(CODE_DEFAULTS)
  const [seed, setSeed] = useState(CODE_DEFAULT_SEED)
  const set = (patch: Partial<CodeParams>) => setP((prev) => ({ ...prev, ...patch }))
  const alpha = P.fMHz / FREF_MHZ
  const loop = CODE_LOOPS[P.loop]

  const cases = useMemo(() => {
    const kinds: Record<Slot, CodeSource | 'off'> = { A: P.caseA, B: P.caseB }
    return (['A', 'B'] as Slot[]).flatMap((slot, i) => {
      const source = kinds[slot]
      if (source === 'off') return []
      return [{ slot, source, verdict: codeSourceVerdict(loop, alpha, source), golden: goldenMc(P.loop, source, alpha), colorIndex: i }]
    })
  }, [P.loop, P.caseA, P.caseB, alpha, loop])

  const seeds = useMemo(() => Array.from({ length: P.nSeeds }, (_, i) => seed + i), [P.nSeeds, seed])
  const totalSamples = cases.length * P.nSeeds * (4096 + P.nBlocks * P.nBlk)
  const task = useWorkerTask<SspllCodeMcCompareParams, SspllCodeMcCompareResult>('sspll', 'runSspllCodeMcCompare', { restartOnRun: true })
  const [run, setRun] = useState<{ key: string; result: SspllCodeMcCompareResult; ms: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runKey = JSON.stringify({ P, seed })
  const runTask = task.run
  const onRun = useCallback(() => {
    if (cases.length === 0 || totalSamples > CODE_MAX_SAMPLES) return
    const params: SspllCodeMcCompareParams = {
      common: { loop, alpha, cfg: SIM_CFG, seeds, nBlocks: P.nBlocks, nBlk: P.nBlk, tauBlocks: P.tauBlocks, recEvery: Math.max(1, Math.round(P.nBlocks / 60)) },
      cases: cases.map((c) => ({ id: c.slot, source: c.source })),
    }
    const key = runKey
    const t0 = Date.now()
    setError(null)
    runTask(params).then(
      (result) => setRun({ key, result, ms: Date.now() - t0 }),
      (e: unknown) => {
        if (!isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
      },
    )
  }, [cases, totalSamples, loop, alpha, seeds, P, runKey, runTask])

  // 參數穩定 0.5 秒後自動重跑（總 sample 數不大時）；StrictMode 的雙重掛載處理與實驗 C 相同
  const settledKey = useDebouncedValue(runKey, 500)
  const lastAuto = useRef<string | null>(null)
  useEffect(() => {
    if (settledKey !== runKey || lastAuto.current === runKey) return
    if (totalSamples > CODE_AUTO_RUN_SAMPLES) return
    lastAuto.current = runKey
    onRun()
    return () => {
      if (lastAuto.current === runKey) lastAuto.current = null
    }
  }, [settledKey, runKey, totalSamples, onRun])

  const fresh = run !== null && run.key === runKey
  const resultOf = (slot: Slot): DivergenceMc | null => (fresh ? (run.result.cases.find((c) => c.id === slot)?.result ?? null) : null)
  const tagOf = (c: (typeof cases)[number]) => `Case ${c.slot}（${CODE_SOURCE_TEX[c.source]}）`
  const deltaFs = SIM_CFG.deltaPs * 1000
  const goldenComparable = P.nBlk === GOLDEN_CODE_COND.nBlk && P.tauBlocks === GOLDEN_CODE_COND.tauBlocks && P.nBlocks === GOLDEN_CODE_COND.nBlocks

  // ── 警告 ──
  const warnings: string[] = []
  if (error) warnings.push(`模擬錯誤：${error}`)
  if (totalSamples > CODE_MAX_SAMPLES) warnings.push(`總 sample 數 ${totalSamples.toLocaleString()} 超過上限 ${CODE_MAX_SAMPLES.toLocaleString()}：請減少 seeds、block 數或 $N$，否則不會執行。`)
  else if (totalSamples > CODE_AUTO_RUN_SAMPLES && !fresh) warnings.push(`總 sample 數 ${totalSamples.toLocaleString()} 超過自動重跑上限 ${CODE_AUTO_RUN_SAMPLES.toLocaleString()}：請按「執行 Run」。`)
  for (const c of cases) {
    const res = resultOf(c.slot)
    if (!res) continue
    const v = c.verdict
    if (res.nDiv * 2 > res.n) {
      const g = efoldVerdict(v.linear.kappaMin, P.nBlocks, P.tauBlocks).growth
      const why =
        v.final === 'dead'
          ? `closed form 的 $\\kappa_{\\min}=${tx(v.linear.kappaMin, 4)}$（模態 ${v.linear.worstMode}）在 dead zone（$\\lvert\\kappa_{\\min}\\rvert\\le${CODE_TAU}$）：線性模型沒有恢復力（這個觀測窗內最慢模態的線性倍數 $e^{-\\kappa_{\\min}B/N_\\tau}=${tx(g, 2)}$），在這個窗內校不回來，但它不預測「長大」。長大的機制是研究假說：1-bit 大訊號的 $\\kappa_\\infty=${tx(v.kappaInf, 3)}$ 是候選解釋，可是 ${twoStageScoreText}（§10b.7）`
          : v.final === 'inverted'
            ? `closed form 的 $\\kappa_{\\min}=${tx(v.linear.kappaMin, 4)}<-${CODE_TAU}$：載波 $m\\alpha f_{ref}$ 落在反號帶內，留在載波上的功率乘上負的 $\\mathrm{Re}\\,H_{PD}$ 壓過了散開到高頻的正項（F-CS.27）`
            : `closed form 的 $\\kappa_{\\min}=${tx(v.linear.kappaMin, 4)}>0$，預測應該收斂——發散來自線性分析以外的機制（有限步長、大訊號；機制是研究假說）`
      warnings.push(`${tagOf(c)}：${res.nDiv}/${res.n} 個 seeds 發散（PHOS 誤差 rms 由 ${fx(res.initFs, 1)} fs 變成最終中位數 ${fp(median(res.finalFs), 4)} fs）。${why}。超過 DTC range（${CODE_RANGE[c.source]} 格 $=${fx(CODE_RANGE[c.source] * deltaFs, 0)}$ fs）的值來自無界的線性模型。`)
    }
  }

  // ── 指標 ──
  const metrics: MetricRow[] = [{ name: '$\\alpha$', value: alpha, digits: 6, note: `PMUX 旋轉頻率 ${fx(Math.min(P.fMHz, FREF_MHZ - P.fMHz), 2)} MHz；$\\mathrm{Re}\\,H_{PD}(\\alpha)$ 在這個迴路是 ${fx(reHAt(loop, alpha), 4)}` }]
  for (const c of cases) {
    const res = resultOf(c.slot)
    const tag = tagOf(c)
    const v = c.verdict
    metrics.push({
      name: `${tag}：closed form 的 $\\kappa_{\\min}$`,
      value: v.linear.kappaMin,
      digits: 4,
      formulaId: 'F-CS.27',
      claim: 'approx',
      note: `最差模態 $m=${v.linear.worstMode}$；${VERDICT_ZH[v.linear.verdict]}（$\\tau=${CODE_TAU}$）；DTC range ${CODE_RANGE[c.source]} 格`,
    })
    const ef = efoldVerdict(v.linear.kappaMin, P.nBlocks, P.tauBlocks)
    metrics.push({
      name: `${tag}：觀測窗內最慢模態的線性倍數 $e^{-\\kappa_{\\min}B/N_\\tau}$`,
      value: ef.growth,
      digits: 3,
      formulaId: 'F-CS.28',
      claim: 'approx',
      note: `F-CS.2 的平均模型讀在這組 $B=${P.nBlocks}$ blocks、$N_\\tau=${fx(P.tauBlocks, 0)}$ 上：$>2$ 才在窗內「發散」、$<\\tfrac14$ 才「收斂」（$\\kappa_{\\min}<-${fx(ef.kappaDiv, 4)}$ 或 $>${fx(ef.kappaConv, 4)}$），其餘不判；golden 的 105 組用這條讀法 0 個不一致（§10b.7），但它不參與 Analytic 欄`,
    })
    metrics.push({
      name: `${tag}：1-bit 大訊號 $\\kappa_\\infty$（模態 ${v.linear.worstMode}，$A\\to\\infty$）`,
      value: v.kappaInf,
      digits: 4,
      formulaId: 'F-CS.28',
      claim: 'research',
      note: v.hint
        ? `dead zone：F-CS.28 不判；$\\kappa_\\infty$ ${HINT_ZH[v.hint]}，只是研究假說的提示——${twoStageScoreText}，所以不參與判定`
        : `closed form 已判得了（${VERDICT_ZH[v.final]}）；$\\kappa_\\infty$ 只是對照`,
    })
    metrics.push({
      name: `${tag}：發散的 seeds（最終 PHOS rms $>2\\times$ 初值）`,
      value: res ? res.nDiv : '尚未執行',
      digits: 0,
      note: res
        ? `${res.nDiv}/${res.n}，95% Wilson $[${fx(res.ciDiv[0], 2)},\\,${fx(res.ciDiv[1], 2)}]$；收斂（$<\\tfrac14$ 初值）${res.nConv}/${res.n}；最終 PHOS rms 中位數 ${fp(median(res.finalFs), 4)} fs（初值 ${fx(res.initFs, 1)} fs）${c.golden ? `；golden（Python，${c.golden.row.n} seeds）：${c.golden.row.n_div}/${c.golden.row.n} 發散、${c.golden.row.n_conv}/${c.golden.row.n} 收斂` : ''}`
        : c.golden
          ? `golden（Python，${c.golden.row.n} seeds）：${c.golden.row.n_div}/${c.golden.row.n} 發散、${c.golden.row.n_conv}/${c.golden.row.n} 收斂`
          : '這組（迴路、$\\alpha$、source）沒有 golden 存檔',
    })
  }

  // ── 交叉比對 ──
  let analytic: CheckStatus = 'n/a'
  let analyticNote = '即時模擬尚未完成'
  let mc: CheckStatus = 'n/a'
  let mcNote = '即時模擬尚未完成'
  if (fresh) {
    const parts: string[] = []
    let ok = 0
    let bad = 0
    let na = 0
    const mcParts: string[] = []
    let mOk = 0
    let mBad = 0
    let mNa = 0
    for (const c of cases) {
      const res = resultOf(c.slot)
      if (!res) continue
      // dead zone：F-CS.28 不判（crosscheckCode 的 dead zone 說明是舊的兩段判定，這裡自己寫）
      const cc = c.verdict.final === 'dead' ? { status: 'n/a' as const, why: `dead zone：線性模型沒有恢復力、不做預測；$\\kappa_\\infty$ ${HINT_ZH[c.verdict.hint ?? 'dead']}（研究假說，不參與判定）` } : crosscheckCode(c.verdict.final, res)
      ok += cc.status === 'ok' ? 1 : 0
      bad += cc.status === 'mismatch' ? 1 : 0
      na += cc.status === 'n/a' ? 1 : 0
      parts.push(`${c.slot}：判定 ${VERDICT_ZH[c.verdict.final]} vs MC ${res.nDiv}/${res.n} 發散、${res.nConv}/${res.n} 收斂 → ${cc.status}（${cc.why}）`)
      if (c.golden && goldenComparable) {
        const a = mcAgreement(res, c.golden.row)
        mOk += a.status === 'ok' ? 1 : 0
        mBad += a.status === 'mismatch' ? 1 : 0
        mNa += a.status === 'n/a' ? 1 : 0
        mcParts.push(`${c.slot}：${a.why}`)
      }
    }
    analytic = bad > 0 ? 'mismatch' : ok > 0 ? 'ok' : 'n/a'
    analyticNote = `F-CS.28（只有線性段）vs 多 seed 閉迴路（比例的 95% Wilson 區間不含 ½ 才判；dead zone 不判；${ok} 個一致、${bad} 個不一致、${na} 個不判）：${parts.join('；')}`
    if (!goldenComparable) mcNote = `目前的設定與 golden 的條件（$N=${GOLDEN_CODE_COND.nBlk}$、$N_\\tau=${GOLDEN_CODE_COND.tauBlocks}$、${GOLDEN_CODE_COND.nBlocks} blocks）不同，沒有可比的參考`
    else if (mcParts.length === 0) mcNote = '這組（迴路、$\\alpha$、source）沒有 golden 存檔：golden 掃的是 3 個迴路 × 5 種 source × $\\alpha\\in\\{0.002, 0.01, 0.02, 0.03, 0.137, 0.253, 0.496\\}$'
    else {
      mc = mBad > 0 ? 'mismatch' : mOk > 0 ? 'ok' : 'n/a'
      mcNote = `本頁（${run?.ms ?? '—'} ms，${task.mode}）vs golden（Python，8 seeds）的發散比例（${mOk} 個一致、${mBad} 個不一致、${mNa} 個不判）：${mcParts.join('；')}`
    }
  }

  // ── 圖 ──
  const traces = useMemo(() => {
    const phos: Data[] = []
    for (const c of cases) {
      const res = fresh ? (run.result.cases.find((x) => x.id === c.slot)?.result ?? null) : null
      if (!res) continue
      const color = tokens.series[c.colorIndex]
      res.traces.forEach((t, i) => {
        phos.push({ x: t.block, y: t.phosRmsFs, name: `Case ${c.slot}：${CODE_SOURCE_TEX[c.source]}（${res.n} seeds）`, legendgroup: c.slot, showlegend: i === 0, mode: 'lines', line: { color, width: 1.4 }, opacity: 0.85 })
      })
    }
    if (phos.length) {
      const xMax = P.nBlocks
      phos.push({ x: [0, xMax], y: [deltaFs, deltaFs], name: '$\\Delta=T_{\\mathrm{vco}}/8$（acc1 的 DTC range）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } })
    }
    return phos
  }, [cases, fresh, run, tokens, deltaFs, P.nBlocks])

  const goldenRows = cases.filter((c) => c.golden)

  return (
    <ExperimentShell
      id={CODE_EXPERIMENT_ID}
      title="實驗 D：code source 與 dither——MASH、dithered quantizer、PMUX 隨機旋轉的多 seed 閉迴路"
      level="L3"
      claim="approx"
      source="simulation"
      seed={seed}
      onSeedChange={setSeed}
      description={
        <>
          同一個迴路與 <Tex>{'\\alpha'}</Tex> 下，兩種 code source 各用 {P.nSeeds} 個 seed 跑閉迴路 sign-error LMS（<code>runSspllCodeMcCompare</code>，Web Worker），數「發散的 seeds」並給 95% Wilson 區間；Analytic 欄用 F-CS.28 的判定（只有線性段：closed form 的 <Tex>{'\\kappa_{\\min}'}</Tex> 和 <Tex>{'\\pm\\tau'}</Tex> 比，dead zone 不判；1-bit 的 <Tex>{'\\kappa_\\infty'}</Tex> 只列成研究假說的提示），Monte Carlo 欄和 golden（Python、8 seeds）的同一組結果比。
        </>
      }
      assumptions={[
        '每個 reference cycle 一步；code source 照 §10b（與 sim.py 的 SeqSource 同一套構造：acc1、dq、MASH 1-1-1、rot4、rot8），總補償量 $P+c=\\Phi+$ 常數不變',
        `插圖值：$\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}$ fs、$\\Delta=T_{vco}/8=${SIM_CFG.deltaPs}$ ps（$f_{vco}=16$ GHz）、$a=${SIM_CFG.a}$、$\\varepsilon_k$ 取 golden 的 seed 7（rms 173 fs）；regressor 一律 raw（GOS 的 regressor 是含偏移的 DTC code $c$）`,
        '步長以 $N_\\tau$ 設定（§12）並對 regressor 功率做 NLMS 式正規化；權重初值 0；比較器無 offset',
        `判定（F-CS.28，只有線性段）：$\\tau=${CODE_TAU}$，dead zone 不判；「發散」= 最終 PHOS rms（去共模）$>2\\times$ 初值、「收斂」= $<\\tfrac14$ 初值；比例的 95% Wilson 區間不含 ½ 才和判定比（seeds 太少時區間含 ½，標 n/a）`,
        `$\\kappa_\\infty$ 沿 closed form 的最差模態、在實際序列上以 $2^{16}$ 拍算 1-bit 相關（§10.4）；只沿一個方向、不含 GOS 耦合與其他模態的誤差。它只是研究假說的提示：${twoStageScoreText}`,
        '線性、無界的 SSPD 與無限的 DTC range：超過 DTC range 的「發散值」在硬體上是飽和／cycle slip／失鎖；沒有 DTC INL、字長、FLL；沒有 fixed-point 模型',
        `golden 的條件：$N=${GOLDEN_CODE_COND.nBlk}$、$N_\\tau=${GOLDEN_CODE_COND.tauBlocks}$、${GOLDEN_CODE_COND.nBlocks} blocks、8 seeds（Python PCG64）；本頁用 xoshiro128**，逐點數值不同，只比發散比例`,
      ]}
      params={{ ...P, alpha, seeds }}
      units={{ fMHz: 'MHz', nBlocks: 'blocks', nBlk: 'samples/block', tauBlocks: 'blocks' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analytic, note: analyticNote },
        monteCarlo: { status: mc, note: mcNote },
        fixedPoint: { status: 'not-implemented', note: '兩個 GMAC 與 gain register 的定點位寬未建模（roadmap R9 bit-true）' },
      }}
      actions={{
        onReset: () => {
          setP(CODE_DEFAULTS)
          setSeed(CODE_DEFAULT_SEED)
          setRun(null)
        },
        onRun,
        onStop: task.cancel,
        running: task.running,
      }}
      presets={INLINE_PRESETS}
      onLoadPreset={(pr) => setP((prev) => mergeCodeParams(prev, pr.params))}
      exportData={() => {
        const out: Record<string, ArrayLike<number | string | null>> = {}
        for (const c of cases) {
          const res = resultOf(c.slot)
          if (!res) continue
          res.traces.forEach((t, i) => {
            out[`${c.slot}_${c.source}_seed${res.seeds[i]}_block`] = t.block
            out[`${c.slot}_${c.source}_seed${res.seeds[i]}_phos_rms_fs`] = t.phosRmsFs
          })
          out[`${c.slot}_${c.source}_final_fs`] = res.finalFs
          out[`${c.slot}_${c.source}_diverged`] = res.diverged.map((d) => (d ? 1 : 0))
        }
        return out
      }}
      controls={
        <>
          <SelectControl label="迴路" value={P.loop} onChange={(loop) => set({ loop })} options={(Object.keys(CODE_LOOP_LABEL) as CodeLoopKey[]).map((k) => ({ value: k, label: CODE_LOOP_LABEL[k] }))} reg="PLL 架構（PM）" />
          <ParamControl
            label={mathText('PMUX 旋轉頻率 $\\alpha f_{ref}$')}
            ariaLabel="α·f_ref"
            value={P.fMHz}
            onChange={(fMHz) => set({ fMHz })}
            min={0.5}
            max={3999.5}
            step={0.5}
            unit="MHz"
            digits={8}
            reg="FCW 的分數部分 × f_ref"
            hint={mathText(`$\\alpha=${(P.fMHz / FREF_MHZ).toFixed(6)}$；golden 存檔的 $\\alpha$：0.002、0.01、0.02、0.03、0.137、0.253、0.496（8、40、80、120、548、1012、1984 MHz）`)}
          />
          <SelectControl label="Case A 的 code source" value={P.caseA} onChange={(caseA) => set({ caseA })} options={CODE_SOURCES.map((k) => ({ value: k, label: CODE_SOURCE_LABEL[k] }))} reg="分數累加器／DSM／PMUX 旋轉" />
          <SelectControl
            label="Case B 的 code source"
            value={P.caseB}
            onChange={(caseB) => set({ caseB })}
            options={[{ value: 'off', label: '（關閉）' }, ...CODE_SOURCES.map((k) => ({ value: k, label: CODE_SOURCE_LABEL[k] }))]}
            reg="分數累加器／DSM／PMUX 旋轉"
          />
          <ParamControl label="seeds 數（每個 case）" value={P.nSeeds} onChange={(nSeeds) => set({ nSeeds })} min={2} max={16} integer clampOnBlur hint="4/4 的 Wilson 下界 0.51 才判得了；golden 用 8" />
          <ParamControl label="block 數" value={P.nBlocks} onChange={(nBlocks) => set({ nBlocks })} min={100} max={20000} integer clampOnBlur unit="blocks" hint="golden 用 1500" />
          <ParamControl label={mathText('$N$（每 block 的 sample 數）')} ariaLabel="N" value={P.nBlk} onChange={(nBlk) => set({ nBlk })} min={64} max={4096} integer clampOnBlur unit="samples" reg="GMAC 累加長度" />
          <ParamControl label={mathText('$N_\\tau$（開迴路名義時間常數）')} ariaLabel="N_tau" value={P.tauBlocks} onChange={(tauBlocks) => set({ tauBlocks })} min={2} max={500} log unit="blocks" reg="LMS 步長" />
        </>
      }
    >
      {!fresh && (
        <Callout kind="info" title={task.running ? '即時模擬執行中…' : '即時模擬尚未完成'}>
          <p>
            參數穩定 0.5 秒後會自動用 TS port 在 Web Worker 裡跑（預設 2 個 case × {CODE_DEFAULTS.nSeeds} seeds × {CODE_DEFAULTS.nBlocks} blocks，約 2–3 秒）；總 sample 數超過 {CODE_AUTO_RUN_SAMPLES.toLocaleString()} 時請按「執行 Run」。
            {goldenRows.length ? '下面的表先列 golden 的同一組結果。' : ''}
          </p>
        </Callout>
      )}
      <div className="cs-plots">
        <Plot
          title="每個 seed 的 PHOS 誤差 rms（去掉共模）對 block"
          data={traces}
          yLog
          height={360}
          csvName="sspll-code-source-phos"
          layout={{ xaxis: { title: { text: 'block $k$（每 block $N$ 個 sample）' } }, yaxis: { title: { text: 'fs（log）' } } }}
          caption="同一個 case 的線同色、一個 seed 一條；判「發散」的門檻是初值的 2 倍（173 fs → 347 fs），「收斂」是 1/4（43 fs）。"
        />
      </div>
      {goldenRows.length > 0 && (
        <DataTable
          className="cs-num"
          caption={`golden（Python，ditherNumbers.json 的 mc）：同一組（迴路、$\\alpha$、source）8 個 seeds 的「發散／收斂」個數與最終 PHOS rms 的中位數；F-CS.28 vs 多數：${goldenRows.map((c) => `${c.slot} ${c.golden!.row.crosscheck.status}`).join('、')}（dead zone 一律 n/a）。$\\kappa_\\infty$ 沿 closed form 的最差模態（研究假說的提示）。`}
          head={['Case', '$\\kappa_{\\min}$', '判定', '$\\kappa_\\infty$（最差模態）', '發散／收斂', '中位數']}
          rows={goldenRows.map((c) => {
            const g = c.golden!.row
            return [
              `${c.slot}：${CODE_SOURCE_SHORT[c.source]}`,
              fx(g.kappa_min, 4),
              VERDICT_ZH[g.verdict],
              fx(g.kappa_inf_worst, 3),
              `${g.n_div}／${g.n_conv}`,
              `${fp(median(g.final_fs), 3)} fs`,
            ]
          })}
        />
      )}
    </ExperimentShell>
  )
}

function reHAt(loop: SspllLoop, alpha: number): number {
  return loopH(loop, alpha).re
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])
}
