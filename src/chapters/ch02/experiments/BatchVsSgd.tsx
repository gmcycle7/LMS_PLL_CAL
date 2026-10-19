import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, useDebouncedValue, useThemeTokens, type CheckStatus, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { deriveSeed, meanCI } from '@/simulation/core'
import { batchVsSgd, type BatchMethod, type BatchSgdParams } from '@/simulation/models/sgd'
import { tm, tn, toShellPresets, lab } from '../common'

const ID = 'gd-batch-vs-sgd'

interface P {
  a: number
  w0: number
  xSigma: number
  sigma: number
  nData: number
  mu: number
  epochs: number
  batch: number
}

const DEFAULT: P = { a: 3, w0: 0, xSigma: 1, sigma: 1, nData: 200, mu: 0.05, epochs: 10, batch: 10 }

const INLINE_PRESETS = [
  { name: '預設：N = 200、B = 10、μ = 0.05', params: { ...DEFAULT } },
  { name: 'μ = 0.5：SGD 很吵、batch 仍平順', params: { ...DEFAULT, mu: 0.5, epochs: 4 } },
  { name: 'μ = 2.2 > 2/P̂ₓ：batch GD 發散', params: { ...DEFAULT, mu: 2.2, epochs: 3 } },
  { name: '無雜訊 σ = 0：三者都收斂到同一個 a', params: { ...DEFAULT, sigma: 0 } },
]

/** 圖例名稱（Plot 會把 `$...$` 轉成斜體符號） */
const METHOD_LABEL: Record<BatchMethod, string> = { batch: 'Batch GD（$B=N$）', minibatch: 'Mini-batch', sgd: 'SGD / LMS（$B=1$）' }
const METHOD_SERIES: Record<BatchMethod, number> = { batch: 0, minibatch: 2, sgd: 1 }

function sanitize(p: Record<string, unknown>): P {
  return { ...DEFAULT, ...(p as Partial<P>) }
}

/** 多 seed Monte Carlo 的 seeds 數（deriveSeed(seed, r)，r = 0…R−1；和 Corner 判斷器、BlockLms JSON Lab 一樣 ≥ 8） */
export const BATCH_MC_RUNS = 12
/** transient 要消失：SGD 的更新次數至少要 8τ，τ = 1/(μ P̂_x)（平均動態每次更新乘上 1 − μx²，一個 epoch 約乘 e^{−μΣx²}） */
const MC_TRANSIENT_TAUS = 8

export interface BatchMcCheck {
  status: CheckStatus
  note: string
  runs: number
  /** 每個 seed 的 d_r = SGD 最後的 w − 該資料集的 w_LS（SGD 在經驗最小平方解附近無偏抖動） */
  diffs: number[]
  mean: number
  se: number
  lo: number
  hi: number
  /** 容差 4·se（加一個相對 10⁻⁹ 的下限，σ = 0 時 d_r 全為捨入誤差） */
  tol: number
}

/**
 * Monte Carlo 交叉比對（多 seed）：每個 seed 重抽一組資料（x_i、v_i）與每個 epoch 的洗牌順序，取 d_r = SGD 最後的 w − w_LS。
 * 模型：固定步長 SGD 在經驗最小平方解 w_LS 附近抖動、跨 seeds 無偏（E[d] = 0：重新洗牌造成的固定點偏移 ∝ μΣx_i³r_i/Σx_i²，
 * 對資料集取期望為 0）。判定 |mean d| ≤ 4·se（Student-t 95% CI 另列給讀者看）。transient 沒消失（更新次數 < 8τ）或發散時 n/a 並說明。
 */
export function batchVsSgdMcCheck(p: Omit<BatchSgdParams, 'seed'>, seed: number, runs = BATCH_MC_RUNS): BatchMcCheck {
  const diffs: number[] = []
  const base = { status: 'n/a' as CheckStatus, runs, diffs, mean: NaN, se: NaN, lo: NaN, hi: NaN, tol: NaN }
  // 均方穩定條件（Ch03、勘誤 E14）：Gaussian x 時 μ < 2E[x²]/E[x⁴] = 2/(3σ_x²)；不滿足時 E[δ²] 發散，跨 seeds 的平均沒有信賴區間可言
  const muMsd = (2 * p.xSigma ** 2) / (3 * p.xSigma ** 4)
  if (p.xSigma > 0 && p.mu >= muMsd) {
    return { ...base, note: String.raw`$\mu=${tn(p.mu)}\ge2E[x^2]/E[x^4]=2/(3\sigma_x^2)=${tn(muMsd)}$：SGD 均方（MSD）不穩定，$E[\delta^2]$ 發散（Ch03），跨 seeds 的平均沒有信賴區間可言` }
  }
  let tauNote: string | null = null
  for (let r = 0; r < runs; r++) {
    const res = batchVsSgd({ ...p, seed: deriveSeed(seed, r) })
    const sgd = res.traces.find((t) => t.method === 'sgd')
    if (!sgd || !(res.pxHat > 0)) return { ...base, note: String.raw`有 seed 的 $\sum x_i^2=0$（不可辨識），沒有 $w_{LS}$ 可比` }
    const tau = 1 / (p.mu * res.pxHat)
    if (sgd.updates < MC_TRANSIENT_TAUS * tau) {
      tauNote = String.raw`SGD 的更新次數 $${sgd.updates}$ 少於 $8\tau$（$\tau=1/(\mu\hat P_x)\approx${tau.toPrecision(3)}$ 次更新）：transient 還沒消失，最後的 $w$ 不能當穩態比；加長 epochs 或加大 $\mu$`
      break
    }
    const w = sgd.w[sgd.w.length - 1]
    if (!Number.isFinite(w) || !Number.isFinite(res.wLs)) return { ...base, note: String.raw`SGD 發散（$w$ 非有限值）：沒有穩態可比；$\mu$ 需小於 $2/(3\sigma_x^2)$ 量級（Ch03）` }
    diffs.push(w - res.wLs)
  }
  if (tauNote) return { ...base, note: tauNote }
  const ci = meanCI(diffs)
  const tol = 4 * ci.se + 1e-9 * (1 + Math.abs(ci.mean))
  const ok = Math.abs(ci.mean) <= tol
  return {
    status: ok ? 'ok' : 'mismatch',
    runs,
    diffs,
    mean: ci.mean,
    se: ci.se,
    lo: ci.lo,
    hi: ci.hi,
    tol,
    note:
      String.raw`${runs} 個 seeds（各自重抽資料與洗牌）：SGD 最後的 $w-w_{LS}$ 平均 $${tn(ci.mean)}$，95% CI $[${tn(ci.lo)},\,${tn(ci.hi)}]$，容許 $\pm4\,\mathrm{se}=${tn(tol)}$` +
      (ok ? String.raw`：和「在 $w_{LS}$ 附近無偏抖動」的模型一致` : String.raw`：跨 seeds 的平均偏離 $w_{LS}$——固定步長太大時重新洗牌的偏移 $\propto\mu$ 不再可忽略，或名目 95% 的區間本來就有機會誤報（換 seed 再看）`),
  }
}

/** Batch GD vs mini-batch vs SGD：以「看過的樣本數」為橫軸公平比較。 */
export function BatchVsSgd() {
  const [p, setP] = useState<P>(DEFAULT)
  const [seed, setSeed] = useState(20261010)
  const urlPreset = useUrlPreset(ID)
  useEffect(() => {
    if (urlPreset) setP(sanitize(urlPreset.params))
  }, [urlPreset])
  const tokens = useThemeTokens()
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDebouncedValue(p, 120)
  const res = useMemo(() => batchVsSgd({ ...dp, seed }), [dp, seed])
  const mc = useMemo(() => batchVsSgdMcCheck(dp, seed), [dp, seed])
  const byM = Object.fromEntries(res.traces.map((t) => [t.method, t])) as Record<BatchMethod, (typeof res.traces)[number]>
  const total = byM.sgd.samples[byM.sgd.samples.length - 1]
  const batchPole = 1 - dp.mu * res.pxHat
  const batchPred = res.wLs + (dp.w0 - res.wLs) * batchPole ** byM.batch.updates
  const batchFinal = byM.batch.w[byM.batch.w.length - 1]

  const wData = useMemo<Data[]>(
    () => [
      ...res.traces.map(
        (t): Data => ({
          x: Array.from(t.samples),
          y: Array.from(t.w),
          name: METHOD_LABEL[t.method],
          mode: t.method === 'batch' ? 'lines+markers' : 'lines',
          line: { color: tokens.series[METHOD_SERIES[t.method]], width: t.method === 'sgd' ? 1 : 2 },
        }),
      ),
      { x: [0, total], y: [res.wLs, res.wLs], name: String.raw`$w_{LS}=\sum x_iy_i/\sum x_i^2$`, mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
      { x: [0, total], y: [dp.a, dp.a], name: '$a$', mode: 'lines', line: { dash: 'dot', color: tokens.textFaint } },
    ],
    [res, tokens, total, dp.a],
  )
  const cData = useMemo<Data[]>(
    () =>
      res.traces.map(
        (t): Data => ({
          x: Array.from(t.samples),
          y: Array.from(t.cost, (c) => c - res.costMin),
          name: METHOD_LABEL[t.method],
          mode: 'lines',
          line: { color: tokens.series[METHOD_SERIES[t.method]], width: t.method === 'sgd' ? 1 : 2 },
        }),
      ),
    [res, tokens],
  )

  const warnings: string[] = []
  if (!(res.pxHat > 0)) warnings.push(String.raw`所有 $x_i=0$：$\sum x_i^2=0$（$\lambda_{\min}=0$），經驗成本與 $w$ 無關——不可辨識。`)
  else if (Math.abs(batchPole) >= 1)
    warnings.push(
      String.raw`Batch GD：$|1-\mu\hat P_x|=${tn(Math.abs(batchPole))}\ge1$，${Math.abs(batchPole) > 1 ? '發散' : '臨界（永遠來回跳）'}（需 $0<\mu<2/\hat P_x=${tn(2 / res.pxHat)}$）。這是 Ch03 的 mean 條件：batch 的平均梯度曲率是 $\hat P_x=\frac1N\sum x_i^2$。`,
    )
  if (dp.mu >= (2 * dp.xSigma ** 2) / (3 * dp.xSigma ** 4) && dp.xSigma > 0)
    warnings.push(
      String.raw`SGD：$\mu=${tn(dp.mu)}\ge2E[x^2]/E[x^4]=${tn(2 / (3 * dp.xSigma ** 2))}$（Gaussian $x$：$E[x^4]=3\sigma_x^4$）：均方（MSD）不穩定——個別大 $|x_i|$ 讓 $1-\mu x_i^2<-1$，$E[\delta^2]$ 發散（Ch03、勘誤 E14）。`,
    )

  const metrics: MetricRow[] = [
    { name: String.raw`$w_{LS}=\sum x_iy_i/\sum x_i^2$（經驗最小平方解）`, value: res.wLs, note: '有限資料下的最佳解，不等於 $a$' },
    { name: 'Batch GD 最終 $w$', value: batchFinal, analytic: batchPred, tolerance: 1e-9, toleranceMode: 'rel', claim: 'exact', note: String.raw`封閉解 $w_{LS}+(w_0-w_{LS})(1-\mu\hat P_x)^k$（$k$：更新次數）` },
    { name: 'Mini-batch 最終 $w$', value: byM.minibatch.w[byM.minibatch.w.length - 1] },
    { name: 'SGD 最終 $w$', value: byM.sgd.w[byM.sgd.w.length - 1], note: String.raw`固定 $\mu$：在 $w_{LS}$ 附近抖動` },
    { name: String.raw`$\hat P_x=\sum x_i^2/N$`, value: res.pxHat },
    { name: '更新次數（batch / mini / SGD）', value: `${byM.batch.updates} / ${byM.minibatch.updates} / ${byM.sgd.updates}` },
    {
      name: String.raw`多 seed：SGD 最後的 $w-w_{LS}$（${mc.runs} 個 seeds 平均）`,
      value: Number.isFinite(mc.mean) ? mc.mean : '—',
      claim: 'approx',
      ...(Number.isFinite(mc.mean) ? { analytic: 0, tolerance: mc.tol } : {}),
      note: Number.isFinite(mc.mean) ? String.raw`每個 seed 重抽資料；95% CI $[${tn(mc.lo)},\,${tn(mc.hi)}]$（Student-$t$）；解析值 $0$ = 在 $w_{LS}$ 附近無偏抖動` : mc.note,
    },
  ]

  return (
    <ExperimentShell
      id={ID}
      title="Batch GD vs Mini-batch vs SGD（同一組資料）"
      level="L0"
      claim="exact"
      description={
        <>
          三種方法都看了相同數量的樣本（橫軸）。batch 每 <Tex>{'N'}</Tex> 筆才更新一次但方向精確；SGD 每筆都更新但方向有雜訊。
        </>
      }
      assumptions={[
        String.raw`$x_i\sim\mathcal N(0,\sigma_x^2)$、$v_i\sim\mathcal N(0,\sigma_v^2)$，iid、彼此獨立`,
        '每個 epoch 重新洗牌（SGD 的「隨機」）',
        String.raw`經驗成本 $\hat J(w)=\frac{1}{2N}\sum_i(y_i-wx_i)^2$（含 $\tfrac12$，E41）`,
      ]}
      params={{ ...dp }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '同 y/x', sigma: '同 y', xSigma: '無因次', mu: '1/[x]^2', nData: 'samples', batch: 'samples' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: {
          status: Number.isFinite(batchFinal) && Math.abs(batchFinal - batchPred) <= 1e-9 * (1 + Math.abs(batchPred)) ? 'ok' : Number.isFinite(batchFinal) ? 'mismatch' : 'n/a',
          note: Number.isFinite(batchFinal) ? String.raw`Batch GD 最終 $w$ vs 封閉解 $w_{LS}+(w_0-w_{LS})(1-\mu\hat P_x)^k$（相對 $10^{-9}$）` : 'Batch GD 發散（非有限值），沒有可比的終值',
        },
        monteCarlo: { status: mc.status, note: mc.note },
        fixedPoint: { status: 'n/a', note: 'L0 浮點教學模型，沒有暫存器或位寬可量化；定點 GMAC 與 gain register 見 Ch04、Ch13 與 Unified Lab' },
      }}
      actions={{ onReset: () => setP(DEFAULT) }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number>> = {}
        for (const t of res.traces) {
          cols[`${t.method}_samples`] = t.samples
          cols[`${t.method}_w`] = t.w
          cols[`${t.method}_cost`] = t.cost
        }
        return cols
      }}
      presets={[...INLINE_PRESETS, ...toShellPresets(presetsForExperiment(ID))]}
      onLoadPreset={(pr) => setP(sanitize(pr.params))}
      controls={
        <>
          <ParamControl {...lab(String.raw`資料筆數 $N$`, '資料筆數 N')} unit="samples" value={p.nData} onChange={(v) => set('nData', v)} min={10} max={2000} integer clampOnBlur reg="GMAC block length（類比）" />
          <ParamControl {...lab(String.raw`mini-batch 大小 $B$`, 'mini-batch 大小 B')} unit="samples" value={p.batch} onChange={(v) => set('batch', v)} min={2} max={1000} integer clampOnBlur reg="REG_GMAC_N（類比）" hint={tm('$B=N$ 就是 batch；$B=1$ 就是 SGD')} />
          <ParamControl {...lab(String.raw`$\mu$（步長）`, 'μ（步長）')} unit="$1/[x]^2$" value={p.mu} onChange={(v) => set('mu', v)} min={1e-4} max={3} log reg="REG_LMS_MU" />
          <ParamControl label="epochs" unit="epochs" value={p.epochs} onChange={(v) => set('epochs', v)} min={1} max={50} integer clampOnBlur reg="sim length" />
          <ParamControl {...lab(String.raw`$\sigma_v$（雜訊標準差）`, 'σ（雜訊標準差）')} unit="同 $y$" value={p.sigma} onChange={(v) => set('sigma', v)} min={0} max={5} step={0.01} reg="behavioural: sigma_v" />
          <ParamControl {...lab(String.raw`$\sigma_x$（$x$ 的標準差）`, 'σₓ（x 標準差）')} unit="無因次" value={p.xSigma} onChange={(v) => set('xSigma', v)} min={0} max={3} step={0.01} reg="behavioural: code scale" />
          <ParamControl {...lab(String.raw`$a$（真實係數）`, 'a（真實係數）')} unit="同 $y/x$" value={p.a} onChange={(v) => set('a', v)} min={-10} max={10} step={0.1} reg="behavioural: true gain a" />
          <ParamControl {...lab(String.raw`$w_0$（初值）`, 'w₀（初值）')} unit="同 $a$" value={p.w0} onChange={(v) => set('w0', v)} min={-10} max={10} step={0.1} reg="REG_W_INIT" />
        </>
      }
    >
      <Plot title="$w$ vs 已使用樣本數" data={wData} height={300} csvName="batch-vs-sgd-w" layout={{ xaxis: { title: { text: '已使用樣本數（梯度計算次數）' } }, yaxis: { title: { text: '$w$' } } }} />
      <Plot
        title={String.raw`經驗成本差 $\hat J(w)-\hat J(w_{LS})$（log）`}
        data={cData}
        yLog
        height={260}
        csvName="batch-vs-sgd-cost"
        layout={{ xaxis: { title: { text: '已使用樣本數' } }, yaxis: { title: { text: String.raw`$\hat J(w)-\hat J_{\min}$` } } }}
        caption={String.raw`$\hat J(w)-\hat J_{\min}=\tfrac12\hat P_x\,(w-w_{LS})^2$：曲線就是 $(w-w_{LS})^2$ 乘上常數`}
      />
      <ul className="ch02-try">
        <li>
          你會發現：SGD 在前幾百筆就走到 <Tex>{'w_{LS}'}</Tex> 附近（batch 那時才更新一兩次），但之後停不下來，一直抖動。
        </li>
        <li>
          把 <Tex>{'B'}</Tex> 調大：抖動變小（梯度雜訊變異 <Tex>{'\\propto 1/B'}</Tex>），但每次更新要等 <Tex>{'B'}</Tex> 筆——這正是 GMAC「累加 <Tex>{'N'}</Tex> 筆再更新」的取捨（Ch04、Ch14）。
        </li>
      </ul>
    </ExperimentShell>
  )
}
