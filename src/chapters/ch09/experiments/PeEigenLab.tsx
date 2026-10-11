import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ClaimTag,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type CrossCheck,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  corr2,
  meanFieldTrajectory,
  meanSquareTrajectory,
  meanTrajectory,
  modalCoords,
  peAnalytic,
  stepsToDecay,
  type PeLabParams,
  type PeLabResult,
} from '@/simulation/models/pe'
import { m, mt, num, texNum as tn } from '../shared'
import {
  PE_DEFAULT,
  PE_LIMITS,
  blocksForConvergence,
  derivedGain,
  mcModalCheck,
  sanitizePeState,
  switchDetector,
  switchKqMode,
  type KqMode,
  type PeLabState,
} from './peLabState'

export const PE_EXPERIMENT_ID = 'pe-eigen-lab'
const DEFAULT_SEED = 20261010
const DECAY = 0.05

function nullIfNonFinite(v: ArrayLike<number>): (number | null)[] {
  return Array.from(v, (x) => (Number.isFinite(x) ? x : null))
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function squareLayout(xTitle: string, yTitle: string): Partial<Layout> {
  return {
    xaxis: { title: { text: xTitle }, zeroline: true },
    yaxis: { title: { text: yTitle }, scaleanchor: 'x', scaleratio: 1, zeroline: true },
  }
}

// 靜態 layout 放在模組層級：避免每次 render 產生新物件而觸發多餘的 Plotly.react
// 圖內文字的數學一律寫 `$...$`（Plot 元件經 plotMath.ts 轉成斜體符號與上下標；docs/teaching-style.md §3）。
// plotMath 的限制：\boldsymbol／\mathbf／\hat 的參數要加大括號（`\boldsymbol{\delta}`），不然只會吃到一個字元。
const ELLIPSE_LAYOUT = squareLayout('$u_1$', '$u_2$')
const PLANE_LAYOUT = squareLayout(String.raw`$\delta_1$`, String.raw`$\delta_2$`)
const MS_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: '平方誤差（log）' } } }
const PE_LAMBDA_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '窗口起點 $k$（sample）' } }, yaxis: { title: { text: String.raw`$\lambda_{\min}(\mathbf R_k)$` } } }
const PE_KAPPA_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '窗口起點 $k$（sample）' } }, yaxis: { title: { text: String.raw`$\kappa(\mathbf R_k)$` } } }
const PE_SV_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '窗口起點 $k$（sample）' } }, yaxis: { title: { text: String.raw`$\sigma_i(\mathbf U_k)$` } } }
const CASE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$|p_{\mathrm{slow}}|^k$（log）` } } }

interface McState {
  params: PeLabParams
  res: PeLabResult
}

/**
 * PE / Eigen Lab（規格 §19：ρ、μ、N₀；勘誤 E23 加入 GMAC N 與 mean / mean-square 並列；E05 的 K_q 正規化）。
 * 解析量即時計算；Monte Carlo 在 Web Worker（simulatePeLab）。
 */
export function PeEigenLab() {
  const [state, setState] = useState<PeLabState>(PE_DEFAULT)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [frozen, setFrozen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const tokens = useThemeTokens()
  const set = useCallback(<K extends keyof PeLabState>(k: K, v: PeLabState[K]) => setState((s) => ({ ...s, [k]: v })), [])

  // ── presets（Gallery #6 等）與 URL ?preset= ──
  const urlPreset = useUrlPreset(PE_EXPERIMENT_ID)
  const applyParams = useCallback((p: Record<string, unknown>) => {
    setState(sanitizePeState(p))
    if (typeof p.seed === 'number' && Number.isFinite(p.seed)) setSeed(p.seed >>> 0)
  }, [])
  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])
  const presets = useMemo(
    () => presetsForExperiment(PE_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )

  // ── 解析（主執行緒，即時） ──
  const gain = derivedGain(state)
  const gUse = Number.isFinite(gain.g) ? gain.g : 0
  const an = useMemo(
    () => peAnalytic({ rho: state.rho, dist: state.dist, g: gUse, N: state.N, N0: state.N0, detector: state.detector }),
    [state.rho, state.dist, gUse, state.N, state.N0, state.detector],
  )
  const ana = useMemo(() => {
    const R = corr2(state.rho)
    const d0 = [state.d10, state.d20]
    const [m1, m2] = meanTrajectory(R, gUse, d0, state.blocks)
    const Q = an.closed.vectors
    const c0 = modalCoords(Q, d0)
    const p = an.closed.values.map((l) => 1 - gUse * l)
    const k = range(state.blocks + 1)
    const cFast = k.map((kk) => Math.abs(c0[0]) * Math.pow(Math.abs(p[0]), kk))
    const cSlow = k.map((kk) => Math.abs(c0[1]) * Math.pow(Math.abs(p[1]), kk))
    const noiseVar = state.detector === 'linear' ? gain.mu * gain.mu * state.sigmaV * state.sigmaV : gain.mu * gain.mu
    const ms = meanSquareTrajectory({ dist: state.dist, rho: state.rho, g: gUse, N: state.N, delta0: d0, steps: state.blocks, noiseVar, detector: state.detector })
    const mf =
      state.detector === 'sign' && state.sigmaV > 0
        ? meanFieldTrajectory({ dist: state.dist, rho: state.rho, sigmaV: state.sigmaV, mu: gain.mu, delta0: d0, steps: state.blocks })
        : null
    const meanNorm2 = k.map((kk) => m1[kk] * m1[kk] + m2[kk] * m2[kk])
    return { k, m1, m2, c0, p, cFast, cSlow, ms, mf, meanNorm2 }
  }, [state.rho, state.d10, state.d20, state.blocks, state.detector, state.sigmaV, state.dist, state.N, gUse, gain.mu, an])

  // ── Monte Carlo（worker） ──
  const debounced = useDebouncedValue(state, 300)
  const workerParams = useMemo<PeLabParams>(() => {
    const dg = derivedGain(debounced)
    return {
      rho: debounced.rho,
      dist: debounced.dist,
      detector: debounced.detector,
      sigmaV: debounced.sigmaV,
      mu: Number.isFinite(dg.mu) ? dg.mu : 0,
      N: debounced.N,
      delta0: [debounced.d10, debounced.d20],
      blocks: debounced.blocks,
      N0: debounced.N0,
      chains: debounced.chains,
      nPaths: 3,
      scatterCount: 1500,
      peLength: Math.min(200000, Math.max(4000, 20 * debounced.N0)),
      seed,
    }
  }, [debounced, seed])
  const task = useWorkerTask<PeLabParams, PeLabResult>('pe', 'simulatePeLab', { restartOnRun: true })
  const runTask = task.run
  const [mc, setMc] = useState<McState | null>(null)
  const [mcError, setMcError] = useState<string | null>(null)
  // 凍結時參數變更不自動重跑；但按「執行」（nonce 改變）仍會手動重跑一次。
  // handledNonce 在「完成」時才更新（不是開始時），所以 StrictMode 的重複 effect 不會吃掉手動執行。
  const handledNonce = useRef(nonce)
  useEffect(() => {
    if (frozen && handledNonce.current === nonce) return
    let alive = true
    runTask(workerParams)
      .then((res) => {
        if (!alive) return
        handledNonce.current = nonce
        setMc({ params: workerParams, res })
        setMcError(null)
      })
      .catch((e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setMcError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [workerParams, frozen, nonce, runTask])
  const res = mc?.res ?? null
  // 參數剛變（debounce 中）或 MC 參數與目前不同：MC 圖暫時隱藏，避免把舊參數的結果畫在新的解析曲線旁
  const stale = !!mc && (mc.params !== workerParams || state !== debounced)

  // ── MC 交叉比對：k_c 處的模態平均 vs 參考（linear：精確平均遞迴；sign：mean-field） ──
  const mcCheck = useMemo((): { entry: CheckEntry; kc: number; ref: number[]; z: number[] } | null => {
    if (!mc) return null
    const { res: r, params: pp } = mc
    const { kc, ref, z, ok } = mcModalCheck(r, pp)
    const refName = pp.detector === 'linear' ? '精確平均遞迴' : 'mean-field（Bussgang，近似）'
    return {
      kc,
      ref,
      z,
      entry: {
        status: ok ? 'ok' : 'mismatch',
        note: String.raw`$k=${kc}$：$|\mathrm{MC}-\text{${refName}}|/\mathrm{SE}=${tn(z[0], 3)}$（快）、$${tn(z[1], 3)}$（慢）；${r.chainsUsed} chains${r.divergedChains ? `、${r.divergedChains} 條發散` : ''}`,
      },
    }
  }, [mc])

  // ── 警告（必須解釋原因） ──
  const warnings: string[] = []
  if (an.modes.nullCount > 0) {
    warnings.push(
      String.raw`$\lambda_{\min}=0$：$\mathbf R$ 奇異（$\rho=${tn(state.rho)}$），沿 $\mathbf v_{\min}=(1,\ ${state.rho > 0 ? '-1' : '+1'})/\sqrt2$ 的方向不可辨識（Persistent Excitation 不成立）。該方向 pole $=1$，誤差永遠停在初值；加大 $\mu$、加長 $N$ 或跑更多 blocks 都沒有用。`,
    )
  }
  if (state.detector === 'sign' && !(state.sigmaV > 0)) {
    warnings.push(String.raw`$\sigma_v=0$：1-bit comparator 的 $K_q=\sqrt{2/\pi}/\sigma_v\to\infty$，小訊號線性化失效（sign-LMS 變成每步 $\pm\mu$ 的 bang-bang 更新）。請設定 $\sigma_v>0$。`)
  }
  // 只看快模式：λ_min = 0（ρ = ±1）時 |p_slow| = 1 是「不可辨識」，不是 g 太大（上面的警告已說明）
  if (Math.abs(an.pFast) >= 1 && Number.isFinite(gain.g)) {
    warnings.push(
      String.raw`$g\lambda_{\max}=${tn(gUse * an.closed.values[0])}\ge2$：快模式 pole $p=${tn(an.pFast)}$ 的 $|p|\ge1$，平均遞迴發散。需 $0<g<2/\lambda_{\max}=${tn(2 / an.closed.values[0])}$。` +
        (state.detector === 'sign'
          ? String.raw`（1-bit：發散的是 $K_q$ 線性化模型；實際 sign-LMS 的有效增益 $\sqrt{2/\pi}\big/\sqrt{\sigma_v^2+\boldsymbol\delta^T\mathbf R\boldsymbol\delta}$ 隨誤差變大而下降，通常停在一個由 $\mu$ 決定的大振幅 limit cycle，而不是收斂。）`
          : ''),
    )
  }
  if (an.meanRadius < 1 && an.msRadius >= 1) {
    warnings.push(
      state.detector === 'linear'
        ? String.raw`Mean 收斂（$\max|p_i|=${tn(an.meanRadius)}$）但 mean-square 發散（$\rho_{\mathrm{MS}}=${tn(an.msRadius)}$，GMAC $N=${state.N}$）：同一 sample 的 $(1-g\|\mathbf u\|^2)$ 是隨機倍數，偶爾的大樣本把誤差放大，$E\|\boldsymbol\delta\|^2$ 的樣本平均不可靠；598 這類數字只是 mean 的預測（勘誤 E23）。加大 $N$（$\rho=0.99$、$g=0.5$ 時 $N\ge2$）即可讓 $\rho_{\mathrm{MS}}<1$。`
        : String.raw`1-bit 的小訊號均方算子 $\rho_{\mathrm{MS}}=${tn(an.msRadius)}\ge1$（GMAC $N=${state.N}$）：$K_q$ 線性化在此 $g$ 下不可信。sign-LMS 每步增量有界（$|\mu q\,\mathbf u|\le\mu\|\mathbf u\|$），不會像 linear LMS 那樣乘法式爆衝，但誤差會停在由 $\mu$ 決定的有界抖動，而不是收斂到雜訊底；請減小 $g$ 或加大 $N$。`,
    )
  }
  if (state.detector === 'sign' && state.sigmaV > 0) {
    const s = Math.sqrt(state.d10 * state.d10 + 2 * state.rho * state.d10 * state.d20 + state.d20 * state.d20)
    if (s > 0.3 * state.sigmaV) {
      warnings.push(
        String.raw`$\sqrt{\boldsymbol\delta_0^T\mathbf R\boldsymbol\delta_0}\big/\sigma_v=${tn(s / state.sigmaV)}$ 不夠小：$K_q$ 線性化只在 $|\mathbf u^T\boldsymbol\delta|\ll\sigma_v$ 時有效，平均遞迴的 pole 只是近似；請對照 mean-field（Bussgang）曲線。`,
      )
    }
  }
  if (Number.isFinite(an.k95Slow) && an.k95Slow > PE_LIMITS.blocks[1]) {
    warnings.push(
      String.raw`$k_{95}=${an.k95Slow.toLocaleString('en-US').replace(/,/g, '{,}')}$ blocks 超過本實驗的 blocks 上限 ${PE_LIMITS.blocks[1]}：圖上看不到慢模式降到 5%。這不是不收斂，而是 $g\lambda_{\min}=${tn(gUse * an.closed.values[1])}$ 太小（每個 block 只修掉這個比例）。要更快請加大 $g$（單一 $\mu$ 最快是 $g^\star=${tn(an.gOpt)}$）${
        state.detector === 'sign' && state.kqMode === 'physical' ? String.raw`；物理單位下 $g=\mu K_q$，$\mu=${tn(gain.mu)}\ \mathrm{fs}$ 只對應 $g=${tn(gUse)}$（勘誤 E05）` : ''
      }。`,
    )
  }
  if (res?.budgetTruncated)
    warnings.push(
      String.raw`MC 預算保護：$\text{chains}\times\text{blocks}\times N$ 超過 $1.2\times10^{7}$ samples，MC 自動降為 ${res.chainsUsed} chains $\times$ ${res.blocksUsed} blocks（解析曲線仍畫到 ${state.blocks} blocks）。`,
    )
  if (res && res.divergedChains > 0) warnings.push(String.raw`${res.divergedChains} 條 MC chain 發散（$|\boldsymbol\delta|>10^{12}$），已停止；之後的 ensemble 統計為 NaN。`)
  if (mcError) warnings.push(`Monte Carlo 執行失敗：${mcError}`)

  const crossCheck: CrossCheck = {
    analytic: {
      status: an.eigAgreement < 1e-12 ? 'ok' : 'mismatch',
      note: String.raw`閉式 eig2x2 vs Jacobi eigSym：$\max|\Delta\lambda|=${tn(an.eigAgreement, 3)}$`,
    },
    monteCarlo: mcCheck?.entry ?? { status: 'n/a', note: mcError ? `失敗：${mcError}` : '尚無 MC 結果（計算中）' },
    fixedPoint: { status: 'not-implemented', note: '本實驗沒有 bit-true 定點模型' },
  }

  // ── 指標 ──
  const claimMean = state.detector === 'linear' ? 'exact' : 'approx'
  const peStats = useMemo(() => {
    if (!res) return null
    const l = Array.from(res.pe.lmin).filter((v) => v > 0)
    const mean = l.length ? l.reduce((s, v) => s + v, 0) / l.length : Number.NaN
    const sd = l.length > 1 ? Math.sqrt(l.reduce((s, v) => s + (v - mean) ** 2, 0) / (l.length - 1)) : Number.NaN
    const minAll = Math.min(...Array.from(res.pe.lmin))
    return { mean, relSd: sd / mean, minAll }
  }, [res])
  const metrics: MetricRow[] = [
    { name: String.raw`$\lambda_{\max}$（閉式 eig2x2）`, value: an.closed.values[0], analytic: an.modes.lambdas[0], tolerance: 1e-12, formulaId: 'F-09.5', claim: 'exact', note: 'analytic 欄 = Jacobi eigSym（兩種演算法互驗）' },
    { name: String.raw`$\lambda_{\min}$（閉式 eig2x2）`, value: an.closed.values[1], analytic: an.modes.lambdas[1], tolerance: 1e-12, formulaId: 'F-09.5', claim: 'exact' },
    {
      name: String.raw`$\kappa=\lambda_{\max}/\lambda_{\min}$`,
      value: Number.isFinite(an.modes.kappa) ? an.modes.kappa : '∞',
      formulaId: 'F-09.5',
      claim: 'exact',
      note: Number.isFinite(an.modes.kappa) ? undefined : String.raw`$\lambda_{\min}=0$：$\mathbf R$ 奇異`,
    },
    {
      name: '$K_q$',
      value: Number.isFinite(gain.Kq) ? gain.Kq : '∞',
      unit: gain.kqUnitTex,
      note:
        state.detector === 'linear'
          ? String.raw`linear detector：$K_q\equiv1$`
          : Number.isFinite(gain.Kq)
            ? String.raw`$\sqrt{2/\pi}/\sigma_v$（勘誤 E05）`
            : String.raw`$\sigma_v=0\Rightarrow\sqrt{2/\pi}/\sigma_v\to\infty$（勘誤 E05）`,
    },
    { name: String.raw`$\mu$（實際）`, value: gain.mu, unit: gain.muUnit },
    { name: String.raw`$g=\mu K_q$`, value: Number.isFinite(gain.g) ? gain.g : '∞', formulaId: 'F-09.3', claim: claimMean },
    { name: String.raw`$p_{\text{fast}}=1-g\lambda_{\max}$`, value: an.pFast, formulaId: 'F-09.4', claim: claimMean },
    { name: String.raw`$p_{\text{slow}}=1-g\lambda_{\min}$`, value: an.pSlow, formulaId: 'F-09.4', claim: claimMean },
    { name: String.raw`$k_{95}$（慢模式）`, value: Number.isFinite(an.k95Slow) ? an.k95Slow : '∞（不衰減）', unit: 'blocks', formulaId: 'F-09.6', claim: claimMean, note: 'mean recursion（勘誤 E23）' },
    { name: String.raw`$\ln 0.05/\ln|p_{\text{slow}}|$（未取整）`, value: an.k95SlowReal, unit: 'blocks' },
    { name: String.raw`近似 $\ln 20/(g\lambda_{\min})$`, value: an.k95SlowApprox, unit: 'blocks', claim: 'approx' },
    { name: String.raw`mean 半徑 $\max|p_i|$`, value: an.meanRadius, claim: claimMean },
    {
      name: String.raw`mean-square 半徑 $\rho_{\mathrm{MS}}$（$N=${state.N}$）`,
      value: an.msRadius,
      formulaId: state.detector === 'linear' ? 'F-09.8' : 'F-09.18',
      claim: state.detector === 'linear' ? 'exact' : 'approx',
      note:
        state.detector === 'linear'
          ? 'iid regressor、無雜訊時的齊次部分（含四階動差）'
          : String.raw`1-bit：$q^2\equiv1$，沒有四階動差項；$E[q\mathbf u]$ 以 $K_q\mathbf R\boldsymbol\delta$ 線性化（小訊號）`,
    },
    { name: String.raw`最佳 scalar $g^\star=2/(\lambda_{\max}+\lambda_{\min})$`, value: an.gOpt, formulaId: 'F-09.7', claim: 'exact' },
    { name: String.raw`最佳 $\max|p|=(\kappa-1)/(\kappa+1)$`, value: an.pOpt, formulaId: 'F-09.7', claim: 'exact' },
    {
      name: String.raw`PE：退化窗口比例（$N_0=${state.N0}$）`,
      value: res && !stale ? res.pe.degenerateFraction : null,
      analytic: an.degenerateProb,
      formulaId: state.dist === 'pm1' ? 'F-09.11' : undefined,
      claim: 'exact',
      note: '窗口互相重疊，比例只是單一序列的估計（不給容忍度）',
    },
    {
      name: String.raw`PE：$\min_k\lambda_{\min}(\mathbf R_k)$（$\alpha/N_0$ 的樣本估計）`,
      value: peStats && !stale ? peStats.minAll : null,
      formulaId: 'F-09.9',
      claim: 'approx',
      note: '只是這一段序列的樣本下界；$=0$ 表示至少一個窗口不滿足 PE，$>0$ 也不能保證未來窗口',
    },
    {
      name: String.raw`PE：非退化窗口 $\lambda_{\min}(\mathbf R_k)$ 平均`,
      value: peStats && !stale && Number.isFinite(peStats.mean) ? peStats.mean : null,
      analytic: Number.isFinite(an.windowLminMean) ? an.windowLminMean : undefined,
      formulaId: 'F-09.10',
      claim: state.dist === 'pm1' ? 'exact' : 'approx',
      note:
        state.dist === 'pm1'
          ? String.raw`analytic 欄 = 條件在「窗口內至少一次 flip」的精確二項平均（高於 $\lambda_{\min}(\mathbf R)$）`
          : String.raw`analytic 欄 = $\lambda_{\min}(\mathbf R)$（$N_0$ 大時樣本平均趨近它）`,
    },
    {
      name: String.raw`PE：非退化窗口 $\lambda_{\min}(\mathbf R_k)$ 相對散佈`,
      value: peStats && !stale && Number.isFinite(peStats.relSd) ? peStats.relSd : null,
      analytic: Number.isFinite(an.windowLminRelSd) ? an.windowLminRelSd : undefined,
      formulaId: state.dist === 'gaussian' ? 'F-09.12' : undefined,
      claim: state.dist === 'pm1' ? 'exact' : 'approx',
      note: state.dist === 'pm1' ? String.raw`$\pm1$：精確二項分布` : String.raw`Gaussian：漸近 $\sqrt{2/N_0}$`,
    },
  ]
  if (mcCheck && res && !stale) {
    metrics.push({
      name: String.raw`MC：慢模式平均 $c_{\text{slow}}(k=${mcCheck.kc})$`,
      value: res.cMean[1][mcCheck.kc],
      analytic: mcCheck.ref[1],
      tolerance: 4 * res.cSe[1][mcCheck.kc] + 1e-12,
      claim: claimMean,
      note: String.raw`$\pm4$ SE（SE $=${tn(res.cSe[1][mcCheck.kc], 3)}$）`,
    })
    const last = res.blocksUsed
    metrics.push({
      name: String.raw`MC：$E\|\boldsymbol\delta\|^2$（$k=${last}$）`,
      value: res.msNorm[last],
      analytic: Number.isFinite(ana.ms[Math.min(last, ana.ms.length - 1)]) ? ana.ms[Math.min(last, ana.ms.length - 1)] : undefined,
      claim: 'approx',
      note: '樣本均方對重尾非常敏感；不給容忍度',
    })
  }

  // ── 圖：correlation ellipse + u 散佈 ──
  const ellipseData = useMemo<Data[]>(() => {
    const [l1, l2] = an.closed.values
    const Q = an.closed.vectors
    const v1 = [Q[0][0], Q[1][0]]
    const v2 = [Q[0][1], Q[1][1]]
    const s1 = Math.sqrt(Math.max(l1, 0))
    const s2 = Math.sqrt(Math.max(l2, 0))
    const ell = (s: number) => {
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i <= 120; i++) {
        const t = (2 * Math.PI * i) / 120
        xs.push(s * (s1 * v1[0] * Math.cos(t) + s2 * v2[0] * Math.sin(t)))
        ys.push(s * (s1 * v1[1] * Math.cos(t) + s2 * v2[1] * Math.sin(t)))
      }
      return { xs, ys }
    }
    const traces: Data[] = []
    if (res && !stale) {
      if (state.dist === 'gaussian') {
        traces.push({
          x: res.scatterU1,
          y: res.scatterU2,
          mode: 'markers',
          type: 'scatter',
          name: String.raw`$\mathbf u$ 樣本（${res.scatterU1.length} 點）`,
          marker: { size: 3, opacity: 0.35, color: tokens.textMuted },
        } as Data)
      } else {
        const counts = new Map<string, number>()
        for (let i = 0; i < res.scatterU1.length; i++) {
          const key = `${res.scatterU1[i]},${res.scatterU2[i]}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const keys = Array.from(counts.keys())
        const total = res.scatterU1.length
        traces.push({
          x: keys.map((k) => Number(k.split(',')[0])),
          y: keys.map((k) => Number(k.split(',')[1])),
          mode: 'text+markers',
          type: 'scatter',
          name: String.raw`$\pm1$ code 的 4 個點（共 ${total} 樣本）`,
          text: keys.map((k) => String.raw`$n=${counts.get(k)}$`),
          textposition: 'top center',
          marker: { size: keys.map((k) => 8 + 30 * Math.sqrt((counts.get(k) ?? 0) / total)), color: tokens.textMuted, opacity: 0.6 },
        })
      }
    }
    const e1 = ell(1)
    const e2 = ell(2)
    traces.push({ x: e1.xs, y: e1.ys, mode: 'lines', name: String.raw`$1\sigma$ 等高線 $\mathbf u^T\mathbf R^{-1}\mathbf u=1$`, line: { color: tokens.series[0] } })
    traces.push({ x: e2.xs, y: e2.ys, mode: 'lines', name: String.raw`$2\sigma$ 等高線`, line: { color: tokens.series[0], dash: 'dot' } })
    traces.push({
      x: [-2 * s1 * v1[0], 2 * s1 * v1[0]],
      y: [-2 * s1 * v1[1], 2 * s1 * v1[1]],
      mode: 'lines',
      name: String.raw`$\mathbf v_1$（$\lambda_{\max}=${tn(l1)}$）`,
      line: { color: tokens.series[1], width: 3 },
    })
    traces.push({
      x: [-2 * s2 * v2[0], 2 * s2 * v2[0]],
      y: [-2 * s2 * v2[1], 2 * s2 * v2[1]],
      mode: 'lines',
      name: String.raw`$\mathbf v_2$（$\lambda_{\min}=${tn(l2)}$）`,
      line: { color: tokens.series[2], width: 3 },
    })
    return traces
  }, [an, res, stale, state.dist, tokens])

  // ── 圖：eigen-mode 收斂 ──
  const modeData = useMemo<Data[]>(() => {
    // 快模式很快掉到浮點下限（0.005^k）；只畫到相對值 1e-18 為止，避免 log 軸大量略去點
    const floor = 1e-18 * Math.max(Math.abs(ana.c0[0]), Math.abs(ana.c0[1]), 1e-300)
    const cut = (arr: number[]) => {
      const i = arr.findIndex((v) => v < floor)
      return i < 0 ? arr.length : Math.max(i, 1)
    }
    const nf = cut(ana.cFast)
    const ns = cut(ana.cSlow)
    const traces: Data[] = [
      { x: ana.k.slice(0, nf), y: ana.cFast.slice(0, nf), mode: 'lines', name: String.raw`$|c_{\mathrm{fast}}|$ 解析 $=|p_{\mathrm{fast}}|^k\,|c_0|$（$p=${tn(ana.p[0])}$）`, line: { color: tokens.series[1] } },
      { x: ana.k.slice(0, ns), y: ana.cSlow.slice(0, ns), mode: 'lines', name: String.raw`$|c_{\mathrm{slow}}|$ 解析（$p=${tn(ana.p[1])}$）`, line: { color: tokens.series[2] } },
      { x: [0, state.blocks], y: [DECAY * Math.abs(ana.c0[1]), DECAY * Math.abs(ana.c0[1])], mode: 'lines', name: '5% 門檻', line: { color: tokens.textMuted, dash: 'dash' } },
    ]
    if (ana.mf) {
      const Q = an.closed.vectors
      const c = ana.k.map((kk) => modalCoords(Q, [ana.mf![0][kk], ana.mf![1][kk]]))
      traces.push({ x: ana.k, y: c.map((v) => Math.abs(v[1])), mode: 'lines', name: String.raw`$|c_{\mathrm{slow}}|$ mean-field（Bussgang）`, line: { color: tokens.series[2], dash: 'dot' } })
    }
    if (res && !stale) {
      const kk = range(res.blocksUsed + 1)
      traces.push({ x: kk, y: Array.from(res.cMean[0], Math.abs), mode: 'markers', name: String.raw`$|E[c_{\mathrm{fast}}]|$ MC`, marker: { size: 3, color: tokens.series[1] } })
      traces.push({ x: kk, y: Array.from(res.cMean[1], Math.abs), mode: 'markers', name: String.raw`$|E[c_{\mathrm{slow}}]|$ MC`, marker: { size: 3, color: tokens.series[2] } })
    }
    return traces
  }, [ana, an, res, stale, state.blocks, tokens])
  const k95 = an.k95Slow
  const modeLayout = useMemo<Partial<Layout>>(
    () => ({
      xaxis: { title: { text: 'block $k$' } },
      yaxis: { title: { text: String.raw`模態座標絕對值 $|c_i|$（log）` } },
      shapes:
        Number.isFinite(k95) && k95 <= state.blocks
          ? [{ type: 'line', x0: k95, x1: k95, yref: 'paper', y0: 0, y1: 1, line: { color: tokens.danger, dash: 'dot', width: 1 } }]
          : [],
      annotations:
        Number.isFinite(k95) && k95 <= state.blocks
          ? [{ x: k95, yref: 'paper', y: 1, text: String.raw`$k_{95}=${k95}$`, showarrow: false, yanchor: 'bottom', font: { color: tokens.danger } }]
          : [],
    }),
    [k95, state.blocks, tokens],
  )

  // ── 圖：mean vs mean-square ──
  const msData = useMemo<Data[]>(() => {
    const traces: Data[] = [
      { x: ana.k, y: ana.meanNorm2, mode: 'lines', name: String.raw`$\|E[\boldsymbol{\delta}_k]\|^2$（mean，解析）`, line: { color: tokens.series[0] } },
      {
        x: ana.k,
        y: nullIfNonFinite(ana.ms),
        mode: 'lines',
        name: String.raw`$E\|\boldsymbol{\delta}_k\|^2$（mean-square，${state.detector === 'linear' ? '解析' : '線性化近似'}）`,
        line: { color: tokens.series[3], dash: 'dash' },
      },
    ]
    if (res && !stale) {
      traces.push({ x: range(res.blocksUsed + 1), y: nullIfNonFinite(res.msNorm), mode: 'lines', name: String.raw`$E\|\boldsymbol{\delta}_k\|^2$ MC 樣本平均`, line: { color: tokens.series[3] } })
      const kq = Array.from(res.qIndex)
      traces.push({ x: kq, y: Array.from(res.q50, (v) => v * v), mode: 'markers', name: String.raw`中位數 $\|\boldsymbol{\delta}_k\|^2$ MC`, marker: { size: 4, color: tokens.series[4] } })
      traces.push({ x: kq, y: Array.from(res.q90, (v) => v * v), mode: 'lines', name: String.raw`90% 分位 $\|\boldsymbol{\delta}_k\|^2$ MC`, line: { color: tokens.series[4], dash: 'dot', width: 1 } })
      traces.push({ x: kq, y: Array.from(res.q10, (v) => v * v), mode: 'lines', name: String.raw`10% 分位 $\|\boldsymbol{\delta}_k\|^2$ MC`, line: { color: tokens.series[4], dash: 'dot', width: 1 } })
    }
    return traces
  }, [ana, res, stale, state.detector, tokens])

  // ── 圖：(δ₁, δ₂) 平面 ──
  const planeData = useMemo<Data[]>(() => {
    const Q = an.closed.vectors
    const L = 1.2 * Math.max(Math.hypot(state.d10, state.d20), 1e-9)
    const traces: Data[] = [
      { x: [-L * Q[0][0], L * Q[0][0]], y: [-L * Q[1][0], L * Q[1][0]], mode: 'lines', name: String.raw`$\mathbf v_1$ 方向（快）`, line: { color: tokens.series[1], dash: 'dash', width: 1 } },
      { x: [-L * Q[0][1], L * Q[0][1]], y: [-L * Q[1][1], L * Q[1][1]], mode: 'lines', name: String.raw`$\mathbf v_2$ 方向（慢）`, line: { color: tokens.series[2], dash: 'dash', width: 1 } },
      { x: ana.m1, y: ana.m2, mode: 'lines+markers', name: String.raw`$E[\boldsymbol{\delta}_k]$ 平均遞迴`, marker: { size: 3 }, line: { color: tokens.series[0] } },
    ]
    if (ana.mf) traces.push({ x: ana.mf[0], y: ana.mf[1], mode: 'lines', name: 'mean-field（Bussgang）', line: { color: tokens.series[5], dash: 'dot' } })
    if (res && !stale) {
      traces.push({ x: res.meanD1, y: res.meanD2, mode: 'lines', name: String.raw`$E[\boldsymbol{\delta}_k]$ MC（${res.chainsUsed} chains）`, line: { color: tokens.series[3], width: 2 } })
      res.paths.forEach((p, i) =>
        traces.push({ x: p.d1, y: p.d2, mode: 'lines', name: `單一軌跡 #${i + 1}`, line: { color: tokens.textMuted, width: 1 }, opacity: 0.7 }),
      )
    }
    return traces
  }, [an, ana, res, stale, state.d10, state.d20, tokens])

  // ── 圖：滑動窗口 λ_min、κ ──
  const peData = useMemo(() => {
    if (!res || stale) return null
    const k = Array.from(res.pe.k)
    const lmin = an.closed.values[1]
    const lam: Data[] = [
      { x: k, y: Array.from(res.pe.lmin), mode: 'lines', name: String.raw`$\lambda_{\min}(\mathbf R_k)$`, line: { color: tokens.series[2] } },
      { x: [k[0] ?? 0, k[k.length - 1] ?? 0], y: [lmin, lmin], mode: 'lines', name: String.raw`$\lambda_{\min}(\mathbf R)=${tn(lmin)}$`, line: { color: tokens.text, dash: 'dash' } },
    ]
    if (state.dist === 'gaussian' && lmin > 0) {
      const s = an.sampleEigRelStd
      lam.push({ x: [k[0] ?? 0, k[k.length - 1] ?? 0], y: [lmin * (1 + s), lmin * (1 + s)], mode: 'lines', name: String.raw`$\pm\sqrt{2/N_0}$ 預測帶`, line: { color: tokens.textMuted, dash: 'dot', width: 1 } })
      lam.push({ x: [k[0] ?? 0, k[k.length - 1] ?? 0], y: [Math.max(lmin * (1 - s), 1e-300), Math.max(lmin * (1 - s), 1e-300)], mode: 'lines', showlegend: false, line: { color: tokens.textMuted, dash: 'dot', width: 1 } })
    }
    const kap: Data[] = [
      { x: k, y: nullIfNonFinite(res.pe.kappa), mode: 'lines', name: String.raw`$\kappa(\mathbf R_k)$`, line: { color: tokens.series[3] } },
      {
        x: [k[0] ?? 0, k[k.length - 1] ?? 0],
        y: [an.modes.kappa, an.modes.kappa].map((v) => (Number.isFinite(v) ? v : null)),
        mode: 'lines',
        name: String.raw`$\kappa(\mathbf R)=${tn(an.modes.kappa)}$`,
        line: { color: tokens.text, dash: 'dash' },
      },
    ]
    const sv: Data[] = [
      { x: k, y: Array.from(res.pe.svMax), mode: 'lines', name: String.raw`$\sigma_{\max}(\mathbf U_k)$`, line: { color: tokens.series[1] } },
      { x: k, y: Array.from(res.pe.svMin), mode: 'lines', name: String.raw`$\sigma_{\min}(\mathbf U_k)$`, line: { color: tokens.series[2] } },
    ]
    const infCount = Array.from(res.pe.kappa).filter((v) => !Number.isFinite(v)).length
    return { lam, kap, sv, infCount, windows: k.length }
  }, [res, stale, an, state.dist, tokens])

  // ── A / B / C：慢模式的解析比較（同一 seed；只改 ρ 與 g） ──
  const cases = useCases<{ rho: number; g: number }>({ rho: 0.99, g: 0.5 }, { seed })
  const caseInfo = useMemo(
    () =>
      cases.cases.map((c) => {
        const a = peAnalytic({ rho: c.params.rho, dist: 'gaussian', g: c.params.g, N: 1024, N0: 100 })
        return { c, a }
      }),
    [cases.cases],
  )
  const caseData = useMemo<Data[]>(() => {
    const finite = caseInfo.map((ci) => ci.a.k95Slow).filter((v) => Number.isFinite(v))
    const kmax = Math.min(5000, Math.max(50, Math.ceil(1.3 * Math.max(10, ...finite))))
    const k = range(kmax + 1)
    return caseInfo.map(({ c, a }) => ({
      x: k,
      y: k.map((kk) => Math.pow(Math.abs(a.pSlow), kk)),
      mode: 'lines',
      name: String.raw`Case ${c.id}：$\rho=${tn(c.params.rho)}$、$g=${tn(c.params.g)}\to k_{95}=${Number.isFinite(a.k95Slow) ? a.k95Slow : String.raw`\infty`}$`,
      line: { color: tokens.series[c.seriesIndex] },
    }))
  }, [caseInfo, tokens])

  const exportData = () => {
    const out: Record<string, ArrayLike<number | null>> = {
      k: ana.k,
      mean_d1_analytic: ana.m1,
      mean_d2_analytic: ana.m2,
      c_fast_abs_analytic: ana.cFast,
      c_slow_abs_analytic: ana.cSlow,
      ms_norm2_analytic: nullIfNonFinite(ana.ms),
    }
    if (res) {
      out.mc_k = range(res.blocksUsed + 1)
      out.mc_mean_d1 = res.meanD1
      out.mc_mean_d2 = res.meanD2
      out.mc_c_fast = res.cMean[0]
      out.mc_c_slow = res.cMean[1]
      out.mc_c_slow_se = res.cSe[1]
      out.mc_ms_norm2 = nullIfNonFinite(res.msNorm)
      out.pe_window_start = res.pe.k
      out.pe_lambda_min = res.pe.lmin
      out.pe_lambda_max = res.pe.lmax
      out.pe_kappa = nullIfNonFinite(res.pe.kappa)
      out.pe_sv_min = res.pe.svMin
    }
    return out
  }

  const isSign = state.detector === 'sign'
  const muIsPhysical = isSign && state.kqMode === 'physical'
  const muRange = muIsPhysical ? PE_LIMITS.muPhys : PE_LIMITS.g

  return (
    <ExperimentShell
      id={PE_EXPERIMENT_ID}
      title={String.raw`PE / Eigen Lab：correlation ellipse、快慢模式與滑動窗口 $\lambda_{\min}$`}
      level="L3"
      claim={claimMean}
      tests={['T10', 'T11']}
      description={
        <>
          兩個參數、相關係數 {m`\rho`} 的 regressor。左上是 {m`\mathbf u`} 的散佈與 {m`\mathbf R`} 的 eigenvectors；其餘圖比較 mean recursion（{m`p_i=1-g\lambda_i`}）、mean-square 與 Monte Carlo。
          解析量即時更新，MC 在 Web Worker 中執行。
        </>
      }
      assumptions={[
        String.raw`$\boldsymbol\delta=\mathbf a-\mathbf w$；$\mathbf w\leftarrow\mathbf w+\mu\mathbf G$（block 更新，$\mathbf G$ 為 $N$ 個 sample 的平均）`,
        String.raw`$\mathbf u$ 在 sample 與 block 間 iid；Gaussian：$u_2=\rho u_1+\sqrt{1-\rho^2}\,z$；$\pm1$：$u_2=s\,u_1$，$P(s=+1)=(1+\rho)/2$`,
        String.raw`linear detector：$t=e$，$K_q\equiv1$（mean recursion 精確）；1-bit：$t=\mathrm{sign}(e)$，$K_q=\sqrt{2/\pi}/\sigma_v$（小訊號近似，勘誤 E05）`,
        String.raw`mean-square 半徑：linear、iid regressor、無雜訊時精確；1-bit 以 $g=\mu K_q$ 線性化（勘誤 E23）`,
        '滑動窗口 PE 統計使用獨立的 regressor 串流（同 seed 可重現）',
      ]}
      params={{ ...state, mu_actual: gain.mu, g: gain.g, Kq: gain.Kq }}
      seed={seed}
      onSeedChange={setSeed}
      units={{
        rho: '—',
        sigmaV: isSign ? 'fs' : '同 a',
        muInput: muIsPhysical ? 'fs' : '—（g = μK_q）',
        mu_actual: gain.muUnit,
        Kq: gain.kqUnit,
        N: 'samples',
        N0: 'samples',
        d10: isSign ? 'fs' : '—',
        d20: isSign ? 'fs' : '—',
        blocks: 'blocks',
      }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onReset: () => {
          setState(PE_DEFAULT)
          setSeed(DEFAULT_SEED)
        },
        onRun: () => setNonce((n) => n + 1),
        // 執行至收斂：把 blocks 拉到 ⌈1.25·k₉₅⌉（看得到慢模式降到 5%）；到不了時停在上限，警告會解釋原因
        onRunToConvergence: () => {
          const { blocks } = blocksForConvergence(an.k95Slow)
          setFrozen(false)
          setState((s) => ({ ...s, blocks }))
          setNonce((n) => n + 1)
        },
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
          <div className="ch09-controls-group">Regressor</div>
          <ParamControl label={mt`$\rho$（兩個 regressor 的相關係數）`} ariaLabel="ρ（兩個 regressor 的相關係數）" value={state.rho} onChange={(v) => set('rho', v)} min={-1} max={1} step={0.001} unit="—（無因次）" reg="Behavioral: CODE_CORR_RHO" hint={mt`$\lambda=1\pm\rho$；$\rho=\pm1$ 時不可辨識`} />
          <SelectControl
            label="Regressor 分布"
            value={state.dist}
            onChange={(v) => set('dist', v)}
            options={[
              { value: 'gaussian', label: 'Gaussian（連續值）' },
              { value: 'pm1', label: '±1 sparse-flip code' },
            ]}
            reg="Behavioral: REGRESSOR_DIST"
          />
          <ParamControl label={mt`$N_0$（PE 窗口長度）`} ariaLabel="N₀（PE 窗口長度）" value={state.N0} onChange={(v) => set('N0', v)} min={PE_LIMITS.N0[0]} max={PE_LIMITS.N0[1]} log integer clampOnBlur unit="samples" reg="Behavioral: PE_WINDOW_N0" />
          <div className="ch09-controls-group">Detector 與 loop gain（勘誤 E05）</div>
          <SelectControl
            label="GMAC 前的偵測器"
            value={state.detector}
            onChange={(v) => setState((s) => switchDetector(s, v))}
            options={[
              { value: 'linear', label: 'linear（conventional LMS，K_q ≡ 1）' },
              { value: 'sign', label: '1-bit comparator（Sign-LMS）' },
            ]}
            reg="Behavioral: PD_DETECTOR"
          />
          <ParamControl
            label={isSign ? mt`$\sigma_v$（comparator 前雜訊）` : mt`$\sigma_v$（加性雜訊，與 $\boldsymbol\delta$ 同單位）`}
            ariaLabel={isSign ? 'σ_v（comparator 前雜訊）' : 'σ_v（加性雜訊，與 δ 同單位）'}
            value={state.sigmaV}
            onChange={(v) => set('sigmaV', v)}
            min={PE_LIMITS.sigmaV[0]}
            max={PE_LIMITS.sigmaV[1]}
            unit={isSign ? 'fs' : '同 a'}
            reg="Behavioral: SIGMA_V"
            hint={isSign ? mt`$K_q=\sqrt{2/\pi}/\sigma_v=${tn(gain.Kq)}\ \mathrm{fs}^{-1}$` : '0 = 無雜訊'}
          />
          <SelectControl<KqMode>
            label={mt`$K_q$ 正規化`}
            ariaLabel="K_q 正規化"
            value={state.kqMode}
            onChange={(v) => setState((s) => switchKqMode(s, v))}
            options={[
              { value: 'normalized', label: '正規化：滑桿是 g = μK_q（無因次）' },
              { value: 'physical', label: '物理：滑桿是 μ [fs]' },
            ]}
            disabled={!isSign}
            hint={isSign ? mt`切換時保持 $g$ 不變` : mt`linear detector 的 $K_q\equiv1$，兩者相同`}
            reg="Behavioral: KQ_NORMALIZATION"
          />
          <ParamControl
            label={muIsPhysical ? mt`$\mu$（learning rate）` : mt`$g=\mu K_q$（正規化 loop gain）`}
            ariaLabel={muIsPhysical ? 'μ（learning rate）' : 'g = μK_q（正規化 loop gain）'}
            value={state.muInput}
            onChange={(v) => set('muInput', v)}
            min={muRange[0]}
            max={muRange[1]}
            log
            unit={muIsPhysical ? 'fs' : '—（無因次）'}
            reg="REG_LMS_MU"
            hint={mt`$g=${tn(gain.g)}$；$\mu=${tn(gain.mu)}${gain.muUnit === '—' ? '' : `\\ \\mathrm{${gain.muUnit}}`}$；平均穩定需 $0<g<2/\lambda_{\max}=${tn(2 / an.closed.values[0])}$`}
          />
          <ParamControl label={mt`$N$（GMAC block 長度）`} ariaLabel="N（GMAC block 長度）" value={state.N} onChange={(v) => set('N', v)} min={PE_LIMITS.N[0]} max={PE_LIMITS.N[1]} log integer clampOnBlur unit="samples" reg="REG_GMAC_N[15:0]" hint="決定 mean-square 行為（勘誤 E23）" />
          <div className="ch09-controls-group">初值與 Monte Carlo</div>
          <ParamControl label={mt`$\delta_1(0)$`} ariaLabel="δ₁(0)" value={state.d10} onChange={(v) => set('d10', v)} min={PE_LIMITS.d0[0]} max={PE_LIMITS.d0[1]} step={0.01} unit={isSign ? 'fs' : '同 a'} reg="Behavioral: DELTA0[0]" />
          <ParamControl label={mt`$\delta_2(0)$`} ariaLabel="δ₂(0)" value={state.d20} onChange={(v) => set('d20', v)} min={PE_LIMITS.d0[0]} max={PE_LIMITS.d0[1]} step={0.01} unit={isSign ? 'fs' : '同 a'} reg="Behavioral: DELTA0[1]" />
          <ParamControl label="blocks" value={state.blocks} onChange={(v) => set('blocks', v)} min={PE_LIMITS.blocks[0]} max={PE_LIMITS.blocks[1]} integer clampOnBlur unit="blocks" reg="Behavioral: NUM_BLOCKS" />
          <ParamControl label="MC chains" value={state.chains} onChange={(v) => set('chains', v)} min={PE_LIMITS.chains[0]} max={PE_LIMITS.chains[1]} integer clampOnBlur unit="chains" reg="Behavioral: MC_CHAINS" hint={mt`總預算 $1.2\times10^{7}$ samples`} />
        </div>
      }
    >
      <p className="ch09-status" aria-live="polite">
        {task.running ? 'Monte Carlo 計算中…' : res ? `MC：${res.chainsUsed} chains × ${res.blocksUsed} blocks × N = ${mc?.params.N}（${res.totalSamples.toLocaleString('en-US')} samples）` : '尚無 MC 結果'}
        {task.lastDurationMs !== null && !task.running ? `，${Math.round(task.lastDurationMs)} ms（${task.mode}）` : ''}
        {stale && !task.running ? '（參數已變更，MC 結果待更新）' : ''}
        {frozen ? '（已凍結：參數變更不會自動重跑 MC；按「執行」可手動重跑一次）' : ''}
      </p>
      <div className="ch09-plots">
        <Plot
          title="Correlation ellipse 與 eigenvectors"
          csvName="pe-ellipse"
          data={ellipseData}
          layout={ELLIPSE_LAYOUT}
          height={360}
          caption={<>橢圓長軸 = {m`\mathbf v_1`}（長 {m`\sqrt{\lambda_{\max}}`}），短軸 = {m`\mathbf v_2`}（長 {m`\sqrt{\lambda_{\min}}`}）。{m`\rho\to1`} 時短軸消失。</>}
        />
        <Plot
          title={String.raw`$(\delta_1,\delta_2)$ 平面：平均軌跡先沿快方向掉到慢軸上`}
          ariaLabel="(δ₁, δ₂) 平面：平均軌跡先沿快方向掉到慢軸上"
          csvName="pe-delta-plane"
          data={planeData}
          layout={PLANE_LAYOUT}
          height={360}
          caption={String.raw`$E[\boldsymbol\delta_k]$ 一步就消掉 $\mathbf v_1$ 分量，之後沿 $\mathbf v_2$ 慢慢爬回原點；個別軌跡（灰）可能完全不像平均。`}
        />
      </div>
      <Plot
        title={String.raw`Eigen-mode 收斂：$|c_{i,k}|=|p_i|^k\,|c_{i,0}|$`}
        ariaLabel="Eigen-mode 收斂：|c_i,k| = |p_i|^k·|c_i,0|"
        csvName="pe-eigenmodes"
        data={modeData}
        layout={modeLayout}
        yLog
        height={330}
        caption={
          <>
            實線為解析 mean recursion（{state.detector === 'linear' ? <ClaimTag kind="exact" /> : <ClaimTag kind="approx" />}），點為 MC ensemble 平均；紅色虛線標出慢模式的 {m`k_{95}`}。
          </>
        }
      />
      <Plot
        title="Mean vs. mean-square（勘誤 E23）"
        csvName="pe-mean-vs-ms"
        data={msData}
        layout={MS_LAYOUT}
        yLog
        height={330}
        caption={
          <>
            {m`\|E[\boldsymbol\delta_k]\|^2`} 是平均的平方；{m`E\|\boldsymbol\delta_k\|^2`} 是平方的平均（Jensen：後者 {m`\ge`} 前者）。linear detector、{m`N=1`}、Gaussian 時
            {m`E\|\boldsymbol\delta_k\|^2`} 理論上發散，但樣本平均被少數軌跡主導，常常看起來「還好」；1-bit 的增量有界，沒有這種乘法式發散。
          </>
        }
      />
      {peData ? (
        <>
          <div className="ch09-plots">
            <Plot
              title={String.raw`滑動窗口 $\lambda_{\min}(\mathbf R_k)$，$N_0=${mc?.params.N0 ?? state.N0}$`}
              ariaLabel={`滑動窗口 λ_min(R_k)，N₀ = ${mc?.params.N0 ?? state.N0}`}
              csvName="pe-window-lmin"
              data={peData.lam}
              layout={PE_LAMBDA_LAYOUT}
              yLog
              height={300}
              caption={String.raw`共 ${peData.windows} 個窗口；退化窗口（$\lambda_{\min}=0$）在 log 軸上被略去，比例見指標表。`}
            />
            <Plot
              title={String.raw`滑動窗口 $\kappa(\mathbf R_k)$`}
              ariaLabel="滑動窗口 κ(R_k)"
              csvName="pe-window-kappa"
              data={peData.kap}
              layout={PE_KAPPA_LAYOUT}
              yLog
              height={300}
              caption={peData.infCount > 0 ? String.raw`${peData.infCount} 個窗口 $\kappa=\infty$（未畫出）。` : String.raw`所有窗口 $\kappa$ 有限。`}
            />
          </div>
          <Plot
            title={String.raw`資料矩陣 $\mathbf U_k$ 的 singular values（$\sigma_i^2=N_0\,\lambda_i(\mathbf R_k)$）`}
            ariaLabel="資料矩陣 U_k 的 singular values（σ_i² = N₀·λ_i(R_k)）"
            csvName="pe-window-sv"
            data={peData.sv}
            layout={PE_SV_LAYOUT}
            yLog
            height={260}
          />
        </>
      ) : (
        <p className="ch09-note">滑動窗口統計等待 Monte Carlo 結果…</p>
      )}

      <h4>Case A / B / C：只改 {m`\rho`} 與 {m`g`}，慢模式差多少？（解析，mean recursion）</h4>
      <CaseSelector cases={cases} />
      <div className="ch09-controls">
        <ParamControl
          label={mt`Case ${cases.activeId} 的 $\rho$`}
          ariaLabel={`Case ${cases.activeId} 的 ρ`}
          value={cases.active.params.rho}
          onChange={(rho) => cases.update({ rho })}
          min={-1}
          max={1}
          step={0.001}
          unit="—（無因次）"
          reg="Behavioral: CODE_CORR_RHO"
        />
        <ParamControl label={mt`Case ${cases.activeId} 的 $g=\mu K_q$`} ariaLabel={`Case ${cases.activeId} 的 g = μK_q`} value={cases.active.params.g} onChange={(g) => cases.update({ g })} min={1e-4} max={2.5} log unit="—（無因次）" reg="REG_LMS_MU" />
      </div>
      <Plot
        title={String.raw`慢模式包絡 $|p_{\text{slow}}|^k$（A / B / C）`}
        ariaLabel="慢模式包絡 |p_slow|^k（A / B / C）"
        csvName="pe-cases"
        data={caseData}
        layout={CASE_LAYOUT}
        yLog
        height={280}
      />
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">Case</th>
              <th>{m`\rho`}</th>
              <th>{m`g`}</th>
              <th>{m`\lambda_{\min}`}</th>
              <th>{m`\kappa`}</th>
              <th>{m`p_{\text{slow}}`}</th>
              <th>{m`k_{95}`}</th>
            </tr>
          </thead>
          <tbody>
            {caseInfo.map(({ c, a }) => (
              <tr key={c.id}>
                <td className="ch09-left">{c.id}</td>
                <td>{num(c.params.rho)}</td>
                <td>{num(c.params.g)}</td>
                <td>{num(a.closed.values[1])}</td>
                <td>{Number.isFinite(a.modes.kappa) ? num(a.modes.kappa) : m`\infty`}</td>
                <td>{num(a.pSlow, 6)}</td>
                <td>{Number.isFinite(a.k95Slow) ? a.k95Slow : m`\infty`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ch09-note">
        試試看：把 Case B 設成 {m`\rho=0.9`}（{m`k_{95}=${stepsToDecay(1 - 0.5 * 0.1)}`}），Case C 設成 {m`\rho=0.99`}、{m`g=1`}
        （{m`=g^\star`}，最快的單一 {m`\mu`}：{m`k_{95}=${stepsToDecay(0.99)}`}）。再到上方把 {m`N`} 改成 1、分布改成 {m`\pm1`} code，觀察個別軌跡的「階梯」。
      </p>
    </ExperimentShell>
  )
}
