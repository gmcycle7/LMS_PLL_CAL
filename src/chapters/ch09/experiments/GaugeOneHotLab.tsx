import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { ClaimTag, ExperimentShell, ModeGate, ParamControl, Plot, SelectControl, Tex, ToggleControl, mathText, useDebouncedValue, useThemeTokens, type CheckEntry, type CrossCheck, type MetricRow, ChapterErratum } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { gaugeNullVector, type GaugeConstraintRow, type GaugeLmsRun, type GaugeParams, type GaugeResult } from '@/simulation/models/pe'
import { m, mt, num, texMatrix, texNum } from '../shared'
import { GAUGE_DEFAULT, GAUGE_LIMITS, W0_A, W0_B, gaugeTfTex, gaugeWarningTex, sanitizeGaugeState, toGaugeParams, type GaugeLabState } from './gaugeLabState'

export const GAUGE_EXPERIMENT_ID = 'gauge-one-hot'
const DEFAULT_SEED = 20261010
/** 參數名稱（TeX；表頭以 <Tex> 顯示） */
const PARAM_NAMES = ['b', 'a_0', 'a_1', 'a_2', 'a_3']
const N_VEC = gaugeNullVector(4)
/**
 * 約束表的列名（`$…$` 由 mathText 轉成 KaTeX）。模型回傳的 name 是純文字（匯出／報告用），
 * 畫面上依 id 改用 LaTeX 版本（docs/teaching-style.md §3）；意思與模型的 name 逐列相同。
 */
const CONSTRAINT_LABEL: Record<GaugeConstraintRow['id'], string> = {
  none: String.raw`不加約束（$b,\ a_0\dots a_3$ 共 5 個參數）`,
  ref: String.raw`固定 reference phase：$a_0:=0$`,
  sumzero: String.raw`強制 $\sum_ia_i=0$（重新參數化）`,
  dropb: String.raw`此路徑不更新 $b$（$b$ 併入 $a_i$）`,
  dropb_ref: String.raw`不更新 $b$ ＋ 固定 $a_0:=0$`,
}

// 圖內文字的數學一律寫 `$...$`（Plot 元件經 plotMath.ts 轉成斜體符號與上下標；docs/teaching-style.md §3）。
// plotMath 的限制：\boldsymbol／\mathbf／\hat／\tilde 的參數要加大括號（`\boldsymbol{\theta}`），不然只會吃到一個字元。
const OUT_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'sample $n$' } }, yaxis: { title: { text: '$y[n]$（fs）' } } }
const PD_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`sample $n-\text{skip}$` } }, yaxis: { title: { text: String.raw`$e_{\mathrm{PD}}[n]$（fs）` } } }
/** eigenvalue 的長條圖：x 用序號 1…5，刻度文字用 `ticktext`（分類軸的字串不會經過 plotMath） */
const EIG_INDEX = [1, 2, 3, 4, 5]
const EIG_LAYOUT: Partial<Layout> = {
  barmode: 'group',
  xaxis: { title: { text: '由大到小' }, tickmode: 'array', tickvals: EIG_INDEX, ticktext: EIG_INDEX.map((i) => String.raw`$\lambda_${i}$`) },
  yaxis: { title: { text: String.raw`$\lambda$` } },
}
const WB_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '$w_b$（fs）' } } }
const NULL_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '投影（fs）' } } }
const ERR_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$\mathrm{RMS}(e)$（fs）` } } }

/**
 * LMS demo 各 run 的名稱（模型 GaugeLmsRun.label 是純文字、含 Unicode 數學，匯出／報告用；畫面上依 run 的代號 A／B／C 改用 LaTeX 版本，
 * 意思與模型的 label 逐項相同：A、B 是 raw-x 的兩組初值，C 是 u-domain（raw 或 filtered GMAC regressor），初值 w₀ᴬ）。
 */
function lmsRunTex(label: string, gmacReg: GaugeParams['gmacReg'] | undefined): string {
  switch (label[0]) {
    case 'A':
      return String.raw`A：raw-x，初值 $\mathbf w_0^A$`
    case 'B':
      return String.raw`B：raw-x，初值 $\mathbf w_0^B$`
    case 'C':
      return String.raw`C：u-domain（${gmacReg === 'filtered' ? String.raw`filtered $\tilde{\mathbf u}$` : String.raw`raw $\tilde{\mathbf x}$`} GMAC），初值 $\mathbf w_0^A$`
    default:
      return label
  }
}

interface GaugeMc {
  params: GaugeParams
  res: GaugeResult
}

/** 顯示用：把相對於最大元素小於 1e-12 的數值零顯示成 0（只影響矩陣的顯示，不影響任何計算） */
function snapTiny(A: number[][]): number[][] {
  const big = Math.max(...A.flat().map(Math.abs), 1e-300)
  return A.map((row) => row.map((v) => (Math.abs(v) < 1e-12 * big ? 0 : v)))
}

function maxAbsDev(v: ArrayLike<number>): number {
  let m0 = 0
  for (let i = 0; i < v.length; i++) m0 = Math.max(m0, Math.abs(v[i] - v[0]))
  return m0
}

/**
 * 四相 One-Hot + Global Offset（規格 §9.2、Gallery #11；勘誤 E04）：
 * 兩組參數同輸出、raw-x vs u-domain eigenvalues、null space、約束、PLL DC-null toggle、LMS demo。
 */
export function GaugeOneHotLab() {
  const [state, setState] = useState<GaugeLabState>(GAUGE_DEFAULT)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [frozen, setFrozen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const tokens = useThemeTokens()
  const set = useCallback(<K extends keyof GaugeLabState>(k: K, v: GaugeLabState[K]) => setState((s) => ({ ...s, [k]: v })), [])

  const urlPreset = useUrlPreset(GAUGE_EXPERIMENT_ID)
  const applyParams = useCallback((p: Record<string, unknown>) => {
    setState(sanitizeGaugeState(p))
    if (typeof p.seed === 'number' && Number.isFinite(p.seed)) setSeed(p.seed >>> 0)
  }, [])
  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])
  const presets = useMemo(
    () => presetsForExperiment(GAUGE_EXPERIMENT_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )

  const debounced = useDebouncedValue(state, 250)
  const params = useMemo(() => toGaugeParams(debounced, seed), [debounced, seed])
  const task = useWorkerTask<GaugeParams, GaugeResult>('pe', 'gaugeAnalysis', { restartOnRun: true })
  const runTask = task.run
  const [mc, setMc] = useState<GaugeMc | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // 凍結時參數變更不自動重算；按「執行」（nonce 改變）仍會手動重算一次（handledNonce 在完成時才更新）
  const handledNonce = useRef(nonce)
  useEffect(() => {
    if (frozen && handledNonce.current === nonce) return
    let alive = true
    runTask(params)
      .then((res) => {
        if (!alive) return
        handledNonce.current = nonce
        setMc({ params, res })
        setErr(null)
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [params, frozen, nonce, runTask])
  const res = mc?.res ?? null
  const used = mc?.params ?? null
  const stale = !!mc && (mc.params !== params || state !== debounced)
  const pd = used ? used.path !== 'none' : state.dcNull

  // ── 指標、交叉比對、警告 ──
  const nVec = N_VEC
  const rawNulls = res ? res.eigRx.filter((v) => Math.abs(v) <= 1e-9 * Math.abs(res.eigRx[0])).length : null
  const pdNulls = res && pd ? res.eigRu.filter((v) => Math.abs(v) <= 1e-9 * Math.abs(res.eigRu[0])).length : null
  const lmsA = res?.lms.runs[0]
  const lmsB = res?.lms.runs[1]
  const lmsC = res?.lms.runs[2]
  const nullDevA = lmsA ? maxAbsDev(lmsA.nullProj) : null
  const nullDevB = lmsB ? maxAbsDev(lmsB.nullProj) : null
  const cosAB = useMemo(() => {
    if (!lmsA || !lmsB) return null
    const d = lmsA.final.map((v, i) => v - lmsB.final[i])
    const nn = Math.hypot(...N_VEC)
    const dn = Math.hypot(...d)
    if (!(dn > 0)) return null
    // 只看平行與否（方向號誌取決於哪組初值的 null 分量較大）
    return Math.abs(d.reduce((s, x, i) => s + (x * N_VEC[i]) / nn, 0) / dn)
  }, [lmsA, lmsB])

  const eigTol = useMemo(() => {
    if (!used) return 0
    const teff = Math.max(1, Math.max(used.T, used.skip + used.blocks * used.N + 1) - used.skip)
    return 6 * Math.sqrt(2 / teff)
  }, [used])
  const analyticCheck = useMemo((): CheckEntry => {
    if (!res || !used) return { status: 'n/a', note: err ? `失敗：${err}` : '計算中…' }
    const dev = (s: number[], a: number[]) => Math.max(...s.map((v, i) => Math.abs(v - a[i]) / Math.max(Math.abs(a[i]), 0.25)))
    const dRaw = dev(res.eigRx, res.eigRxAnalytic)
    const pdComparable = pd && res.eigRuAnalytic !== null
    const dPd = pdComparable ? dev(res.eigRu, res.eigRuAnalytic as number[]) : 0
    const ok = dRaw <= eigTol && dPd <= eigTol && (rawNulls ?? 0) === 1 && (!pd || pdNulls === 2 || Math.abs(res.dcGain) > 1e-9)
    const pdNote = !pd ? '' : pdComparable ? `、u $${texNum(dPd, 3)}$` : '、u-domain：cyclic 序列沒有 iid 解析式（只比對零 eigenvalue 個數）'
    return {
      status: ok ? 'ok' : 'mismatch',
      note: String.raw`樣本 eig vs 解析：最大相對差 raw $${texNum(dRaw, 3)}$${pdNote}（容忍 $6\sqrt{2/T}=${texNum(eigTol, 3)}$）`,
    }
  }, [res, used, err, pd, eigTol, rawNulls, pdNulls])
  const mcCheck = useMemo((): CheckEntry => {
    if (nullDevA === null || nullDevB === null) return { status: 'n/a', note: '計算中…' }
    const ok = nullDevA < 1e-9 && nullDevB < 1e-9
    return { status: ok ? 'ok' : 'mismatch', note: String.raw`raw-x LMS：$\max_k|\hat{\mathbf n}^T\mathbf w_k-\hat{\mathbf n}^T\mathbf w_0|=${texNum(Math.max(nullDevA, nullDevB), 3)}$（理論 $0$）` }
  }, [nullDevA, nullDevB])
  const crossCheck: CrossCheck = {
    analytic: analyticCheck,
    monteCarlo: mcCheck,
    fixedPoint: { status: 'not-implemented', note: '本實驗沒有 bit-true 定點模型' },
  }

  const warnings: string[] = []
  if (rawNulls !== null && rawNulls > 0) {
    warnings.push(
      String.raw`$\lambda_{\min}(\mathbf R_x)=0$（${rawNulls} 個零 eigenvalue）：$b$ 與 $a_i$ 的 common mode 不可同時辨識——每一個 one-hot 輸入都滿足 $\tilde{\mathbf x}^T(1,-1,-1,-1,-1)=0$（gauge freedom），不是樣本不夠。LMS 收斂到的 $(b,a_i)$ 分配取決於初值。`,
    )
  }
  if (res && pd && pdNulls !== null && pdNulls >= 2) {
    warnings.push(
      String.raw`u-domain 有 ${pdNulls} 個零 eigenvalue：$H_{\mathrm{PD}}(1)=${texNum(res.dcGain, 3)}\Rightarrow b$ 在穩態完全不可觀察（$\tilde u_b\to0$），且 $\sum_i\tilde u_i\to0$（勘誤 E04）。固定 reference phase 或 $\sum_ia_i=0$ 只能處理 $a_i$ 的 gauge，$b$ 仍無法辨識；需獨立觀測路徑或不在此路徑更新 $b$。`,
    )
  }
  if (res && pd && used?.gmacReg === 'raw' && (used?.sigmaV ?? 0) > 0) {
    const damped = res.lms.driftDamping < 0.999
    warnings.push(
      String.raw`u-domain 以 raw $\tilde{\mathbf x}$ 當 GMAC regressor：$E[G_b]=0$，$w_b$ 與 $a_i$ 共模沒有恢復力，在雜訊下 random walk（預測 $\mathrm{std}\approx\mu\sigma_v\sqrt{K/N}${
        damped ? String.raw`\times${texNum(res.lms.driftDamping, 3)}` : ''
      }=${texNum(res.lms.driftStdPred, 3)}\ \mathrm{fs}$${
        damped
          ? String.raw`；type-I 的 $H_{\mathrm{PD}}$ step response 總和 $S=${texNum(res.hStepSum, 4)}\ne0$，每次更新的 step 會被主迴路「回吐」一部分，步進被阻尼成 $1/(1+1.25\,\mu S/N)$（F-09.19），但仍然沒有把 $w_b$ 拉回真值的恢復力`
          : ''
      }）；實際硬體會漂移甚至飽和。`,
    )
  }
  if (state.mu * 1.25 >= 2) warnings.push(String.raw`$\mu\lambda_{\max}(\mathbf R_x)=${texNum(state.mu * 1.25)}\ge2$：raw-x LMS 的快模式平均發散（需 $\mu<1.6$）。`)
  if (res) warnings.push(...res.warnings.map(gaugeWarningTex))
  if (err) warnings.push(`計算失敗：${err}`)

  const metrics: MetricRow[] = res
    ? [
        { name: String.raw`raw-x：$\max|y_{\theta}-y_{\theta'}|$（gauge 平移 $c$）`, value: res.maxDiffRawGauge, analytic: 0, tolerance: 1e-12, formulaId: 'F-09.13', claim: 'exact', note: '只剩浮點捨入' },
        { name: String.raw`raw-x：$\max|y_{\theta}-y_{\theta''}|$（只動 $b$）`, value: res.maxDiffRawB, analytic: Math.abs(used?.dB ?? 0), tolerance: 1e-12, claim: 'exact', note: 'raw domain 看得到 $b$ 本身' },
        ...(pd
          ? ([
              { name: String.raw`u-domain：$\max|e_{\theta}-e_{\theta'}|$（暖機後）`, value: res.maxDiffPdGauge, analytic: 0, tolerance: 1e-9, formulaId: 'F-09.15', claim: 'exact' },
              { name: String.raw`u-domain：$\max|e_{\theta}-e_{\theta''}|$（只動 $b$，暖機後）`, value: res.maxDiffPdB, analytic: 0, tolerance: 1e-9, formulaId: 'F-09.15', claim: 'exact', note: String.raw`$H_{\mathrm{PD}}(1)=0$：$b$ 完全看不到（勘誤 E04）` },
              { name: String.raw`$H_{\mathrm{PD}}(1)$（DC gain）`, value: res.dcGain, analytic: 0, tolerance: 1e-12, claim: 'exact' },
              { name: String.raw`$\|h\|^2=\sum_nh[n]^2$`, value: res.hNorm2, claim: 'exact', note: String.raw`u-domain 非零 eigenvalue 的預測值 $=\|h\|^2/4$` },
            ] as MetricRow[])
          : []),
        { name: String.raw`$\mathbf R_x$ 零 eigenvalue 個數`, value: rawNulls, analytic: 1, tolerance: 0, formulaId: 'F-09.14', claim: 'exact' },
        ...(pd ? ([{ name: String.raw`$\mathbf R_u$ 零 eigenvalue 個數`, value: pdNulls, analytic: 2, tolerance: 0, formulaId: 'F-09.15', claim: 'exact' }] as MetricRow[]) : []),
        { name: String.raw`raw-x LMS A：$\max_k|\hat{\mathbf n}^T\mathbf w_k-\hat{\mathbf n}^T\mathbf w_0|$`, value: nullDevA, analytic: 0, tolerance: 1e-9, claim: 'exact', note: 'null 分量凍結在初值' },
        { name: String.raw`$|\cos\angle(\mathbf w_{A,\infty}-\mathbf w_{B,\infty},\ \mathbf n)|$`, value: cosAB, analytic: 1, tolerance: 1e-3, claim: 'approx', note: '兩組初值收斂到只差一個 gauge 平移的解（需已收斂）' },
        ...(lmsC
          ? ([
              {
                name: String.raw`u-domain LMS C：$|w_{b,K}-w_{b,0}|$（${used?.gmacReg === 'raw' ? String.raw`raw $\tilde{\mathbf x}$` : String.raw`filtered $\tilde{\mathbf u}$`} GMAC）`,
                value: Math.abs(lmsC.wb[lmsC.wb.length - 1] - lmsC.wb[0]),
                unit: 'fs',
                formulaId: used?.gmacReg === 'raw' ? 'F-09.19' : undefined,
                note:
                  used?.gmacReg === 'raw'
                    ? String.raw`random walk：單次實現；預測 $\mathrm{std}\approx\mu\sigma_v\sqrt{K/N}\big/(1+1.25\,\mu S/N)=${texNum(res.lms.driftStdPred, 3)}\ \mathrm{fs}$（$S=${texNum(res.hStepSum, 3)}$）`
                    : String.raw`filtered-x：$\tilde u_b\approx0\Rightarrow$ 不更新`,
                claim: 'approx',
              },
            ] as MetricRow[])
          : []),
      ]
    : []

  // ── 圖 ──
  const outData = useMemo<Data[]>(() => {
    if (!res) return []
    return [
      { x: res.previewN, y: res.yRaw, mode: 'markers', name: String.raw`$y_{\theta}$`, marker: { size: 8, color: tokens.series[0] } },
      { x: res.previewN, y: res.yRawGauge, mode: 'lines', name: String.raw`$y_{\theta'}$（$\boldsymbol{\theta}+c\,\mathbf n$）`, line: { color: tokens.series[1] } },
      { x: res.previewN, y: res.yRawB, mode: 'lines', name: String.raw`$y_{\theta''}$（只動 $b$）`, line: { color: tokens.series[3], dash: 'dash' } },
    ]
  }, [res, tokens])
  const pdData = useMemo<Data[]>(() => {
    if (!res || !pd) return []
    return [
      { x: res.previewN, y: res.yPd, mode: 'markers', name: String.raw`$e_{\theta}$（經 $H_{\mathrm{PD}}$）`, marker: { size: 8, color: tokens.series[0] } },
      { x: res.previewN, y: res.yPdGauge, mode: 'lines', name: String.raw`$e_{\theta'}$（$\boldsymbol{\theta}+c\,\mathbf n$）`, line: { color: tokens.series[1] } },
      { x: res.previewN, y: res.yPdB, mode: 'lines', name: String.raw`$e_{\theta''}$（只動 $b$）`, line: { color: tokens.series[3], dash: 'dash' } },
    ]
  }, [res, pd, tokens])
  const eigData = useMemo<Data[]>(() => {
    if (!res) return []
    const labels = EIG_INDEX
    // 長條上的數值標籤：科學記號（例如浮點捨入的 -3.7e-18）寫成 TeX 的 $-3.7\times10^{-18}$，其餘照常
    const fmtE = (v: number) => {
      const d = Math.abs(v) < 1e-9 ? 2 : 4
      const t = num(v, d)
      return /e[+-]?\d/.test(t) ? `$${texNum(v, d)}$` : t
    }
    const traces: Data[] = [
      { type: 'bar', x: labels, y: res.eigRx, name: String.raw`raw-x（樣本 $\mathbf R_x$）`, text: res.eigRx.map(fmtE), textposition: 'outside', marker: { color: tokens.series[0] } },
    ]
    if (pd) traces.push({ type: 'bar', x: labels, y: res.eigRu, name: String.raw`u-domain（樣本 $\mathbf R_u$）`, text: res.eigRu.map(fmtE), textposition: 'outside', marker: { color: tokens.series[2] } })
    traces.push({ type: 'scatter', x: labels, y: res.eigRxAnalytic, mode: 'markers', name: String.raw`raw-x 解析 $\lambda=5/4,\ 1/4,\ 1/4,\ 1/4,\ 0$`, marker: { symbol: 'x', size: 10, color: tokens.text } })
    if (pd && res.eigRuAnalytic)
      traces.push({ type: 'scatter', x: labels, y: res.eigRuAnalytic, mode: 'markers', name: String.raw`u-domain 解析 $\|h\|^2/4\ (\times3),\ 0,\ 0$`, marker: { symbol: 'diamond-open', size: 10, color: tokens.text } })
    return traces
  }, [res, pd, tokens])
  const lmsData = useMemo(() => {
    if (!res) return null
    const k = res.lms.k
    const colors = [tokens.series[0], tokens.series[1], tokens.series[3]]
    const tag = (r: GaugeLmsRun) => lmsRunTex(r.label, used?.gmacReg)
    const wb: Data[] = res.lms.runs.map((r, i) => ({ x: k, y: r.wb, mode: 'lines', name: String.raw`$w_b$ ${tag(r)}`, line: { color: colors[i] } }))
    wb.push({ x: [0, k[k.length - 1]], y: [used?.b ?? 0, used?.b ?? 0], mode: 'lines', name: '真值 $b$', line: { color: tokens.textMuted, dash: 'dash' } })
    const nul: Data[] = res.lms.runs
      .filter((r) => r.domain === 'raw')
      .map((r, i) => ({ x: k, y: r.nullProj, mode: 'lines', name: String.raw`$\hat{\mathbf n}^T\mathbf w$ ${tag(r)}`, line: { color: colors[i] } }))
    res.lms.runs
      .filter((r) => r.domain === 'pd')
      .forEach((r) => nul.push({ x: k, y: r.cm, mode: 'lines', name: String.raw`$a_i$ 共模 $(1/4)\sum_ia_i$ ${tag(r)}`, line: { color: colors[2], dash: 'dot' } }))
    const err: Data[] = res.lms.runs.map((r, i) => ({ x: k, y: r.errRms, mode: 'lines', name: String.raw`$\mathrm{RMS}(e)$ ${tag(r)}`, line: { color: colors[i] } }))
    return { wb, nul, err }
  }, [res, used, tokens])

  const exportData = () => {
    if (!res) return {}
    const out: Record<string, ArrayLike<number | null>> = {
      preview_n: res.previewN,
      y_raw_theta: res.yRaw,
      y_raw_gauge: res.yRawGauge,
      y_raw_bshift: res.yRawB,
      eig_Rx: res.eigRx,
      eig_Ru: res.eigRu,
      sv_C: res.svC,
      lms_k: res.lms.k,
    }
    if (pd) {
      out.e_pd_theta = res.yPd
      out.e_pd_gauge = res.yPdGauge
      out.e_pd_bshift = res.yPdB
    }
    res.lms.runs.forEach((r, i) => {
      const tag = ['A', 'B', 'C'][i]
      out[`lms_${tag}_wb`] = r.wb
      out[`lms_${tag}_null_proj`] = r.nullProj
      out[`lms_${tag}_a_common_mode`] = r.cm
      r.a.forEach((col, j) => (out[`lms_${tag}_a${j}`] = col))
    })
    return out
  }

  const theta = [state.b, state.a0, state.a1, state.a2, state.a3]
  const thetaG = theta.map((t, i) => t + state.c * nVec[i])

  return (
    <ExperimentShell
      id={GAUGE_EXPERIMENT_ID}
      title="四相 One-Hot ＋ Global Offset：兩組參數、同一個輸出"
      level="L3"
      claim="exact"
      description={
        <>
          參數 {m`\boldsymbol\theta=(b,a_0,a_1,a_2,a_3)`}、regressor {m`\tilde{\mathbf x}=(1,x_0,\dots,x_3)`}（one-hot）。開啟「PLL 抑制 DC」後，誤差先經 {m`H_{\mathrm{PD}}`}（{m`H_{\mathrm{PD}}(1)=0`}）——
          null space 從 1 維變 2 維（<ChapterErratum id="E04" />）。
        </>
      }
      assumptions={[
        String.raw`$y=b+\sum_ia_ix_i$，one-hot：每個 sample 恰一個 $x_i=1$（$P=4$）`,
        'random：各相 iid 等機率；cyclic：0,1,2,3,0,…（解析式只對 iid 成立）',
        String.raw`u-domain：每個 regressor 欄位各自經同一個有狀態的 $H_{\mathrm{PD}}$（從 rest 開始、暖機 skip 個 sample 後才統計）`,
        String.raw`LMS demo：block conventional LMS，$\mathbf M=\mu\mathbf I$，GMAC 為 $N$ 個 sample 的平均；誤差加 $\mathcal N(0,\sigma_v^2)$ 雜訊`,
        String.raw`LMS 初值：$\mathbf w_0^{A}=(${W0_A.join(',\\ ')})$、$\mathbf w_0^{B}=(${W0_B.join(',\\ ')})$`,
        String.raw`u-domain LMS 的誤差 $d[n]=\tilde{\mathbf x}^T(\boldsymbol\theta-\mathbf w_k)$ 經同一個有狀態 $H_{\mathrm{PD}}$ 濾波（主 PLL 不在每個 block 重置）`,
      ]}
      params={{ ...state }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ b: 'fs', a0: 'fs', a1: 'fs', a2: 'fs', a3: 'fs', c: 'fs', dB: 'fs', wnTs: 'rad/sample', T: 'samples', skip: 'samples', N: 'samples', blocks: 'blocks', sigmaV: 'fs', mu: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          setState(GAUGE_DEFAULT)
          setSeed(DEFAULT_SEED)
        },
        onRun: () => setNonce((n) => n + 1),
        onStop: task.cancel,
        onFreeze: () => setFrozen((f) => !f),
        running: task.running,
        frozen,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyParams(p.params)}
      controls={
        <div className="ch09-controls">
          <div className="ch09-controls-group">真值 {m`\boldsymbol\theta`} 與兩種平移</div>
          <ParamControl label={mt`$b$（global offset）`} ariaLabel="b（global offset）" value={state.b} onChange={(v) => set('b', v)} min={GAUGE_LIMITS.theta[0]} max={GAUGE_LIMITS.theta[1]} step={0.01} unit="fs" reg="REG_GOS_OFS（behavioural b）" />
          {(['a0', 'a1', 'a2', 'a3'] as const).map((key, i) => (
            <ParamControl
              key={key}
              label={mt`$a_${i}$（phase ${i} offset）`}
              ariaLabel={`a${'₀₁₂₃'[i]}（phase ${i} offset）`}
              value={state[key]}
              onChange={(v) => set(key, v)}
              min={GAUGE_LIMITS.theta[0]}
              max={GAUGE_LIMITS.theta[1]}
              step={0.01}
              unit="fs"
              reg={`REG_PHOS_OFS[${i}]`}
            />
          ))}
          <ParamControl label={mt`$c$（gauge 平移：$b+c$、$a_i-c$）`} ariaLabel="c（gauge 平移：b+c、aᵢ−c）" value={state.c} onChange={(v) => set('c', v)} min={GAUGE_LIMITS.theta[0]} max={GAUGE_LIMITS.theta[1]} step={0.01} unit="fs" reg="Behavioral: GAUGE_SHIFT" />
          <ParamControl label={mt`$d_b$（只平移 $b$）`} ariaLabel="d_b（只平移 b）" value={state.dB} onChange={(v) => set('dB', v)} min={GAUGE_LIMITS.theta[0]} max={GAUGE_LIMITS.theta[1]} step={0.01} unit="fs" reg="Behavioral: B_SHIFT" />
          <div className="ch09-controls-group">主 PLL error path</div>
          <ToggleControl label={mt`PLL 抑制 DC（$H_{\mathrm{PD}}(1)=0$）`} ariaLabel="PLL 抑制 DC（H_PD(1) = 0）" value={state.dcNull} onChange={(v) => set('dcNull', v)} reg="Behavioral: PLL_DC_NULL" hint={mt`關閉時 $\tilde{\mathbf u}=\tilde{\mathbf x}$（例如校正期間主迴路 frozen）`} />
          <SelectControl
            label={mt`$H_{\mathrm{PD}}$ 種類`}
            ariaLabel="H_PD 種類"
            value={state.pathType}
            onChange={(v) => set('pathType', v)}
            options={[
              { value: 'type2', label: 'type-II DPLL（designDtLoop）' },
              { value: 'type1', label: 'type-I：(1 − z⁻¹)/(1 − r·z⁻¹)' },
            ]}
            disabled={!state.dcNull}
            reg="Behavioral: PLL_TYPE"
          />
          <SelectControl
            label="type-II 離散化"
            value={state.pllMethod}
            onChange={(v) => set('pllMethod', v)}
            options={[
              { value: 'dpll', label: 'DPLL 差分方程（E44，預設）' },
              { value: 'bilinear', label: 'bilinear（E04 數值證據所用）' },
            ]}
            disabled={!state.dcNull || state.pathType !== 'type2'}
            reg="Behavioral: PLL_DISCRETIZATION"
          />
          <ParamControl label={mt`$\omega_nT_s$`} ariaLabel="ω_nT_s" value={state.wnTs} onChange={(v) => set('wnTs', v)} min={GAUGE_LIMITS.wnTs[0]} max={GAUGE_LIMITS.wnTs[1]} log unit="rad/sample" disabled={!state.dcNull || state.pathType !== 'type2'} reg="Behavioral: PLL_WN_TS" />
          <ParamControl label={mt`$\zeta$`} ariaLabel="ζ" value={state.zeta} onChange={(v) => set('zeta', v)} min={GAUGE_LIMITS.zeta[0]} max={GAUGE_LIMITS.zeta[1]} step={0.01} unit="—（無因次）" disabled={!state.dcNull || state.pathType !== 'type2'} reg="Behavioral: PLL_ZETA" />
          <ParamControl label={mt`type-I pole $r$`} ariaLabel="type-I pole r" value={state.hpPole} onChange={(v) => set('hpPole', v)} min={GAUGE_LIMITS.hpPole[0]} max={GAUGE_LIMITS.hpPole[1]} step={0.001} unit="—（z 平面半徑）" hint={mt`$r=1-K$（type-I DPLL 的 loop gain $K$）`} disabled={!state.dcNull || state.pathType !== 'type1'} reg="Behavioral: PLL_TYPE1_POLE" />
          <div className="ch09-controls-group">Phase 序列</div>
          <SelectControl
            label="one-hot 序列"
            value={state.sequence}
            onChange={(v) => set('sequence', v)}
            options={[
              { value: 'random', label: 'random（iid 等機率）' },
              { value: 'cyclic', label: 'cyclic 0,1,2,3,…' },
            ]}
            reg="Behavioral: PHASE_SEQUENCE"
          />
          <ParamControl label={mt`$T$（統計長度）`} ariaLabel="T（統計長度）" value={state.T} onChange={(v) => set('T', v)} min={GAUGE_LIMITS.T[0]} max={GAUGE_LIMITS.T[1]} log integer clampOnBlur unit="samples" reg="Behavioral: STAT_LENGTH" />
          <ParamControl label="暖機 skip" value={state.skip} onChange={(v) => set('skip', v)} min={GAUGE_LIMITS.skip[0]} max={GAUGE_LIMITS.skip[1]} integer clampOnBlur unit="samples" reg="Behavioral: PLL_SETTLE_SKIP" hint={mt`讓 $H_{\mathrm{PD}}$ 的 step 暫態消失`} />
          <div className="ch09-controls-group">LMS demo（{m`\mathbf M=\mu\mathbf I`}）</div>
          <ParamControl label={mt`$\mu$`} ariaLabel="μ" value={state.mu} onChange={(v) => set('mu', v)} min={GAUGE_LIMITS.mu[0]} max={GAUGE_LIMITS.mu[1]} log unit="—（無因次）" reg="REG_LMS_MU" hint={mt`raw-x 平均穩定需 $\mu<2/\lambda_{\max}=1.6$`} />
          <ParamControl label={mt`$N$（GMAC block）`} ariaLabel="N（GMAC block）" value={state.N} onChange={(v) => set('N', v)} min={GAUGE_LIMITS.N[0]} max={GAUGE_LIMITS.N[1]} log integer clampOnBlur unit="samples" reg="REG_GMAC_N[15:0]" />
          <ParamControl label="blocks" value={state.blocks} onChange={(v) => set('blocks', v)} min={GAUGE_LIMITS.blocks[0]} max={GAUGE_LIMITS.blocks[1]} integer clampOnBlur unit="blocks" reg="Behavioral: NUM_BLOCKS" hint={mt`$\text{blocks}\cdot N\le400{,}000$`} />
          <ParamControl label={mt`$\sigma_v$（誤差雜訊）`} ariaLabel="σ_v（誤差雜訊）" value={state.sigmaV} onChange={(v) => set('sigmaV', v)} min={GAUGE_LIMITS.sigmaV[0]} max={GAUGE_LIMITS.sigmaV[1]} step={0.001} unit="fs" reg="Behavioral: SIGMA_V" />
          <SelectControl
            label="u-domain 的 GMAC regressor"
            value={state.gmacReg}
            onChange={(v) => set('gmacReg', v)}
            options={[
              { value: 'raw', label: 'raw x̃（硬體常見）' },
              { value: 'filtered', label: 'filtered ũ = h * x̃（filtered-x）' },
            ]}
            disabled={!state.dcNull}
            reg="Behavioral: GMAC_REGRESSOR"
          />
        </div>
      }
    >
      <p className="ch09-status" aria-live="polite">
        {task.running ? '計算中…' : res ? mathText(String.raw`${gaugeTfTex(res.tf.description)}；$T=${used?.T ?? ''}$，暖機 $${used?.skip ?? ''}$ samples`) : '尚無結果'}
        {task.lastDurationMs !== null && !task.running ? `（${Math.round(task.lastDurationMs)} ms，${task.mode}）` : ''}
        {stale && !task.running ? '（參數已變更，結果待更新）' : ''}
        {frozen ? '（已凍結：參數變更不會自動重算；按「執行」可手動重算一次）' : ''}
      </p>
      <p>
        目前 {m`\boldsymbol\theta=(${theta.map((v) => texNum(v, 3)).join(',\\ ')})`}，
        {m`\boldsymbol\theta'=\boldsymbol\theta+c\,\mathbf n=(${thetaG.map((v) => texNum(v, 3)).join(',\\ ')})`}：兩者對任何 one-hot 輸入的輸出都相同。
      </p>
      {res && (
        <>
          <div className="ch09-plots">
            <Plot
              title={String.raw`raw-x：$\boldsymbol\theta$ 與 $\boldsymbol\theta'$ 的輸出逐點重合`}
              ariaLabel="raw-x：θ 與 θ' 的輸出逐點重合"
              csvName="gauge-raw-output"
              data={outData}
              layout={OUT_LAYOUT}
              height={300}
              caption={
                <>
                  {m`\boldsymbol\theta'=\boldsymbol\theta+c\,\mathbf n`} 與 {m`\boldsymbol\theta`} 的輸出完全相同；只動 {m`b`}（虛線）則整條平移 {m`d_b`}——raw domain 看得到 {m`b`} 本身，看不到「{m`b`} 加 {m`c`}、每個 {m`a_i`} 減 {m`c`}」這種反向平移。
                </>
              }
            />
            {pd ? (
              <Plot
                title={String.raw`u-domain（經 $H_{\mathrm{PD}}$，暖機後）：連 $b$ 都看不到`}
                ariaLabel="u-domain（經 H_PD，暖機後）：連 b 都看不到"
                csvName="gauge-pd-output"
                data={pdData}
                layout={PD_LAYOUT}
                height={300}
                caption={
                  <>
                    {m`H_{\mathrm{PD}}(1)=0`}：只動 {m`b`} 的 {m`\boldsymbol\theta''`} 與 {m`\boldsymbol\theta`} 也重合（<ChapterErratum id="E04" />）。
                  </>
                }
              />
            ) : (
              <p className="ch09-note">開啟「PLL 抑制 DC」即可看到 u-domain 的輸出比較。</p>
            )}
          </div>
          <Plot
            title={pd ? 'Eigenvalues：raw-x（1 個 0）vs. u-domain（2 個 0）' : 'Eigenvalues：raw-x（1 個 0）'}
            csvName="gauge-eigenvalues"
            data={eigData}
            layout={EIG_LAYOUT}
            height={320}
            caption={String.raw`長條為樣本相關矩陣的 eigenvalue（標註數值），$\times$ / $\diamond$ 為 iid one-hot 的解析值。零 eigenvalue 的長條高度為 0。`}
          />
          <h4>Null space（數值上 {m`\lambda\approx0`} 的 eigenvectors）</h4>
          <div className="table-wrap">
            <table className="ch09-table">
              <thead>
                <tr>
                  <th className="ch09-left">domain</th>
                  <th className="ch09-left">null space 基底（欄向量，順序 {m`b,a_0,\dots,a_3`}）</th>
                  <th className="ch09-left">檢查</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ch09-left">raw-x</td>
                  <td className="ch09-left">
                    <Tex>{texMatrix(res.nullRx, 3)}</Tex>
                  </td>
                  <td className="ch09-left">
                    {m`\|\mathbf R_x\mathbf n\|/\|\mathbf n\|=${texNum(res.residual.nOnRx, 2)}`}，{m`\mathbf n\propto(1,-1,-1,-1,-1)`}
                  </td>
                </tr>
                {pd && (
                  <tr>
                    <td className="ch09-left">u-domain</td>
                    <td className="ch09-left">
                      <Tex>{texMatrix(res.nullRu, 3)}</Tex>
                    </td>
                    <td className="ch09-left">
                      {m`\|\mathbf R_u\mathbf e_b\|=${texNum(res.residual.ebOnRu, 2)}`}、{m`\|\mathbf R_u(0,1,1,1,1)\|/2=${texNum(res.residual.cmOnRu, 2)}`}：2 維 null space ＝ {m`\mathrm{span}\{\mathbf e_b,\ (0,1,1,1,1)\}`}（{m`b`} 方向與 {m`a_i`} 共模；Jacobi 給的基底是其中任一組正交基）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h4>約束能不能救？（最小 eigenvalue／零方向數，由樣本 {m`\mathbf R`} 即時計算）</h4>
          <div className="table-wrap">
            <table className="ch09-table">
              <thead>
                <tr>
                  <th className="ch09-left">約束</th>
                  <th>參數數</th>
                  <th>raw-x {m`\lambda_{\min}`}</th>
                  <th>raw-x 零方向</th>
                  <th>u-domain {m`\lambda_{\min}`}</th>
                  <th>u-domain 零方向</th>
                </tr>
              </thead>
              <tbody>
                {res.constraints.map((c) => (
                  <tr key={c.id}>
                    <td className="ch09-left">{mathText(CONSTRAINT_LABEL[c.id])}</td>
                    <td>{c.params}</td>
                    <td>{num(c.rawMinEig, 3)}</td>
                    <td className={c.rawNull > 0 ? 'ch09-bad' : 'ch09-ok'}>{c.rawNull}</td>
                    <td>{c.pdMinEig === null ? '—' : num(c.pdMinEig, 3)}</td>
                    <td className={c.pdNull === null ? undefined : c.pdNull > 0 ? 'ch09-bad' : 'ch09-ok'}>{c.pdNull === null ? '—（DC null 關閉）' : c.pdNull}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ch09-note">
            u-domain 唯一完全可辨識的是「不更新 {m`b`} ＋ 固定 {m`a_0`}」：剩下的 3 個參數正好是相位差 {m`a_i-a_0`}。 <ClaimTag kind="exact" />
          </p>

          {lmsData && (
            <>
              <div className="ch09-plots">
                <Plot
                  title={String.raw`LMS：$w_b(k)$`}
                  ariaLabel="LMS：w_b(k)"
                  csvName="gauge-lms-wb"
                  data={lmsData.wb}
                  layout={WB_LAYOUT}
                  height={300}
                  caption={
                    <>
                      raw-x 的 A、B 從不同初值出發，收斂到不同的 {m`w_b`}（都不一定等於真值 {m`b`}）；u-domain 的 C：filtered-x 時 {m`w_b`} 凍結，raw GMAC 時 random walk。
                    </>
                  }
                />
                <Plot
                  title={String.raw`null 分量 $\hat{\mathbf n}^T\mathbf w$（raw-x）與 $a_i$ 共模（u-domain）`}
                  ariaLabel="null 分量 n̂ᵀw（raw-x）與 aᵢ 共模（u-domain）"
                  csvName="gauge-lms-null"
                  data={lmsData.nul}
                  layout={NULL_LAYOUT}
                  height={300}
                  caption={
                    <>
                      raw-x 的更新永遠 {m`\propto\tilde{\mathbf x}\perp\mathbf n`}，所以 {m`\hat{\mathbf n}^T\mathbf w_k`} 是水平線（精確守恆）。
                    </>
                  }
                />
              </div>
              <Plot
                title="誤差 RMS：所有 run 的誤差都收斂（到雜訊底），參數卻不同"
                csvName="gauge-lms-err"
                data={lmsData.err}
                layout={ERR_LAYOUT}
                yLog
                height={260}
              />
              <div className="table-wrap">
                <table className="ch09-table">
                  <thead>
                    <tr>
                      <th className="ch09-left">run</th>
                      {PARAM_NAMES.map((n) => (
                        <th key={n}>
                          <Tex>{n}</Tex>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="ch09-left">真值 {m`\boldsymbol\theta`}</td>
                      {(used ? [used.b, ...used.a] : theta).map((v, i) => (
                        <td key={i}>{num(v, 4)}</td>
                      ))}
                    </tr>
                    {res.lms.runs.map((r) => (
                      <tr key={r.label}>
                        <td className="ch09-left">{mathText(lmsRunTex(r.label, used?.gmacReg))}</td>
                        {r.final.map((v, i) => (
                          <td key={i}>{num(v, 4)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <ModeGate min="research">
            <h4>樣本相關矩陣（Research）</h4>
            <div className="table-wrap">
              <p>
                {m`\mathbf R_x=`} <Tex>{texMatrix(snapTiny(res.Rx), 4)}</Tex>
              </p>
              {pd && (
                <>
                  <p>
                    {m`\mathbf R_u=`} <Tex>{texMatrix(snapTiny(res.Ru), 4)}</Tex>
                  </p>
                  <p>
                    {m`\mathbf C=E[\tilde{\mathbf x}\tilde{\mathbf u}^T]`} 的 singular values：{m`${res.svC.map((v) => texNum(v, 3)).join(',\\ ')}`}（2 個 {m`\approx0`}：{m`\mathbf C`} 也有 2 維 null space）
                  </p>
                  <p className="ch09-note">
                    矩陣中相對大小低於 {m`10^{-12}`} 的元素是浮點捨入，顯示為 0（{m`\mathbf R_u`} 的 {m`b`} 列與 {m`b`} 欄：最大原始值{' '}
                    {m`${texNum(Math.max(...res.Ru[0].map(Math.abs)), 2)}`}）。
                  </p>
                </>
              )}
            </div>
          </ModeGate>
        </>
      )}
    </ExperimentShell>
  )
}
