import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, useDebouncedValue, useThemeTokens, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { batchVsSgd, type BatchMethod } from '@/simulation/models/sgd'
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
        analytic: { status: Number.isFinite(batchFinal) && Math.abs(batchFinal - batchPred) <= 1e-9 * (1 + Math.abs(batchPred)) ? 'ok' : Number.isFinite(batchFinal) ? 'mismatch' : 'n/a', note: 'Batch GD vs 封閉解' },
        monteCarlo: 'not-implemented',
        fixedPoint: 'not-implemented',
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
