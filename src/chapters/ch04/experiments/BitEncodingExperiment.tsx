import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ExperimentShell, ParamControl, Plot, Tex, useDebouncedValue, useThemeTokens, type CheckEntry, type MetricRow } from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { ar1MeanSe, type ComparatorEncoding, type EncodingCompareParams, type EncodingCompareResult } from '@/simulation/models/gmac'
import { f, mt, tx } from '../common'
import { texifyModelText } from '../modelText'
import { useCasePresets } from './presetHooks'

const R = String.raw
export const BIT_ENCODING_ID = 'gmac-bit-encoding'
/** bug 編碼額外的 Monte Carlo seed 數（worker 內執行） */
const MC_RUNS = 6

export const DEFAULT_ENCODING: Omit<EncodingCompareParams, 'seed'> = {
  N: 256,
  numBlocks: 1500,
  mu: 10,
  sigmaV: 100,
  aTrue: 3,
  w0: 0,
  codeMean: 0.5,
  codeSigma: 1,
}

/**
 * 圖例與指標名稱共用的名稱（字串內的 `$...$`：指標表以 KaTeX 顯示，Plotly 圖例由 Plot 轉成斜體符號與上下標）。
 */
const LABEL: Record<ComparatorEncoding, string> = {
  bipolar_pm_one: R`bipolar $\pm1$`,
  unipolar_mapped: R`0/1 → $q=2b-1$`,
  unipolar_unmapped_bug: '0/1 直接用（bug）',
}

export function BitEncodingExperiment() {
  const [p, setP] = useState(DEFAULT_ENCODING)
  const [seed, setSeed] = useState(20261010)
  const tokens = useThemeTokens()
  const applyShared = useCallback((v: Record<string, unknown>) => setP({ ...DEFAULT_ENCODING, ...(v as Partial<EncodingCompareParams>) }), [])
  const { presets, load } = useCasePresets<never>({ experiment: BIT_ENCODING_ID, applyShared, setSeed })
  const params = useDebouncedValue<EncodingCompareParams>(
    useMemo(() => ({ ...p, seed, mcRuns: MC_RUNS }), [p, seed]),
    250,
  )
  const task = useWorkerTask<EncodingCompareParams, EncodingCompareResult>('gmac', 'compareEncodings', { restartOnRun: true })
  const [res, setRes] = useState<EncodingCompareResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run } = task
  useEffect(() => {
    let alive = true
    run(params).then(
      (r) => {
        if (alive) {
          setRes(r)
          setErr(null)
        }
      },
      (e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setErr((e as Error).message)
      },
    )
    return () => {
      alive = false
    }
  }, [params, run])

  const warnings: string[] = []
  if (err) warnings.push(`模擬錯誤：${err}`)
  if (p.N * p.numBlocks > 2 ** 24) warnings.push(R`$N\times\text{blocks}=${p.N * p.numBlocks}$ 很大，計算可能需要數秒`)
  const bug = res?.runs.find((r) => r.encoding === 'unipolar_unmapped_bug')
  const good = res?.runs.find((r) => r.encoding === 'bipolar_pm_one')
  const mapped = res?.runs.find((r) => r.encoding === 'unipolar_mapped')
  if (bug) warnings.push(...bug.warnings.filter((w) => /unipolar_unmapped_bug|偏差/.test(w)).map(texifyModelText))
  if (Math.abs(p.codeMean) < 1e-12) warnings.push(R`$E[x]=0$：忘了映射時固定點不會偏，但 GMAC 增益減半（收斂變慢一倍）——零均值 code 會把這個 bug 藏起來`)

  // metrics.meanW 取後半段 blocks（blockLms 約定）；SE 以 AR(1) 有效樣本數修正（w_k 高度相關）
  const half = res ? Math.floor((res.k.length - 1) / 2) : 0
  const seOf = (w: Float64Array, m: number): number => ar1MeanSe(w.subarray(half), m)
  const bugSe = bug ? seOf(bug.w, bug.meanW) : NaN
  const identical = good && mapped ? good.w.every((v, i) => v === mapped.w[i]) : false
  // 正確編碼的固定點是 a（零均值雜訊、identity path）；bug 的固定點用 F-04.16 的封閉式（Gaussian code，不依賴取樣）
  const bugTol = 4 * bugSe + 0.01 * Math.abs(res?.bugExactPred ?? 0)
  const analytic: CheckEntry =
    bug && res && good
      ? {
          status: Math.abs(bug.meanW - res.bugExactPred) <= bugTol && Math.abs(good.meanW - p.aTrue) <= 4 * seOf(good.w, good.meanW) + 0.01 * Math.abs(p.aTrue) && identical ? 'ok' : 'mismatch',
          note: R`bug 模擬平均 $${tx(bug.meanW, 5)}$ vs F-04.16 封閉式 $${tx(res.bugExactPred, 5)}\,\mathrm{fs}$（容差 $4\,\mathrm{SE}+1\%=${tx(bugTol, 3)}\,\mathrm{fs}$）；$\pm1$ 模擬 $${tx(good.meanW, 4)}$ vs $a=${tx(p.aTrue, 6)}\,\mathrm{fs}$；$q=2b-1$ 與 $\pm1$ 逐 block ${identical ? '完全相同' : '不同'}`,
        }
      : { status: 'n/a', note: '計算中' }

  const mc = res?.bugMc ?? null
  const mcCheck: CheckEntry =
    mc && res
      ? {
          status: Math.abs(mc.mean - res.bugExactPred) <= 4 * mc.se + 0.01 * Math.abs(res.bugExactPred) ? 'ok' : 'mismatch',
          note: R`bug 編碼 ${mc.seeds.length} 個 seed（deriveSeed(seed, 'mc-i')）：平均 $w=${tx(mc.mean, 5)}\pm${tx(mc.se, 3)}\,\mathrm{fs}$（SE）vs F-04.16 $=${tx(res.bugExactPred, 5)}\,\mathrm{fs}$`,
        }
      : { status: 'n/a', note: '計算中' }

  const metrics: MetricRow[] = res
    ? [
        ...res.runs.map((r) => {
          const isBug = r.encoding === 'unipolar_unmapped_bug'
          const se = seOf(r.w, r.meanW)
          return {
            name: `${LABEL[r.encoding]}：後半段平均 $w$`,
            value: r.meanW,
            unit: 'fs',
            digits: 5,
            analytic: isBug ? res.bugExactPred : p.aTrue,
            tolerance: 4 * se + 0.01 * Math.abs(isBug ? res.bugExactPred : p.aTrue),
            formulaId: isBug ? 'F-04.16' : undefined,
            claim: 'exact' as const,
            note: R`analytic：${isBug ? 'F-04.16 封閉式固定點' : R`$a$（正確編碼無偏差）`}；SE（AR(1)）$=${tx(se, 3)}\,\mathrm{fs}$；blockLms 取樣 mean-field $=${tx(r.wStarMeanField, 5)}\,\mathrm{fs}$`,
          }
        }),
        { name: R`bug 的線性化固定點 $a+E[x]/(K_qE[x^2])$`, value: res.bugLinearPred, unit: 'fs', digits: 5, claim: 'approx', formulaId: 'F-04.7', note: R`$|\delta x|$ 不夠小時與精確固定點有差距` },
        { name: R`bug 的 $\xi^*=\delta^*/\sigma_v$（只和 code 分布有關）`, value: res.bugXi, digits: 6, claim: 'exact', formulaId: 'F-04.16', note: R`$w^*-a=-\xi^*\sigma_v$ 與 $\sigma_v$ 精確成正比` },
        ...(mc
          ? [
              {
                name: `bug：Monte Carlo 平均 $w$（${mc.seeds.length} seeds）`,
                value: mc.mean,
                unit: 'fs',
                digits: 5,
                analytic: res.bugExactPred,
                tolerance: 4 * mc.se + 0.01 * Math.abs(res.bugExactPred),
                formulaId: 'F-04.16',
                note: R`SE $=${tx(mc.se, 3)}\,\mathrm{fs}$；各 seed：${mc.meanW.map((v) => f(v, 4)).join('、')}`,
              },
            ]
          : []),
        { name: R`$K_\mathrm{bug}/K$（忘了映射的增益 / 正確的增益）`, value: bug && good ? bug.K / good.K : null, digits: 6, claim: 'exact', note: '增益減半' },
      ]
    : []

  const data = useMemo<Data[]>(
    () =>
      res
        ? [
            ...res.runs.map((r, i) => ({
              x: res.k,
              y: r.w,
              name: LABEL[r.encoding],
              mode: 'lines' as const,
              line: { color: tokens.series[i], dash: r.encoding === 'unipolar_mapped' ? ('dash' as const) : ('solid' as const) },
            })),
            { x: [0, p.numBlocks], y: [p.aTrue, p.aTrue], name: '$a$', mode: 'lines', line: { dash: 'dot', color: tokens.textMuted } },
            ...(bug
              ? [
                  {
                    x: [0, p.numBlocks],
                    y: [res.bugExactPred, res.bugExactPred],
                    name: R`bug 的精確 $w^*$（F-04.16）`,
                    mode: 'lines' as const,
                    line: { dash: 'dashdot' as const, color: tokens.series[2] },
                  },
                  { x: [0, p.numBlocks], y: [res.bugLinearPred, res.bugLinearPred], name: R`bug 的線性化 $w^*$`, mode: 'lines' as const, line: { dash: 'dot' as const, color: tokens.series[4] } },
                ]
              : []),
          ]
        : [],
    [res, bug, p.numBlocks, p.aTrue, tokens],
  )
  const layout = useMemo(() => ({ xaxis: { title: { text: R`block $k$` } }, yaxis: { title: { text: R`$w_k$ [fs/code]` } } }), [])

  return (
    <ExperimentShell
      id={BIT_ENCODING_ID}
      source="simulation"
      title={R`反面教材：comparator 0/1 忘了映射成 $\pm1$`}
      level="L1"
      claim="approx"
      tests={['T04']}
      description={
        <>
          同一個 seed、同一組 code 與雜訊，只改 comparator 編碼。code 為 Gaussian（平均 <Tex>{R`E[x]`}</Tex>，正規化 none），以 <code>blockLms.runBlockLms</code> 實際模擬。
        </>
      }
      assumptions={[
        R`$x[n]\sim\mathcal N(E[x],\sigma_x^2)$ iid，code_normalization = none（保留 DC）；F-04.16 的封閉式只對 Gaussian code 成立`,
        R`identity error path（$u=x$），$x_\mathrm{ref}=x$`,
        R`$v\sim\mathcal N(0,\sigma_v^2)$ iid；tie $e=0$ 判 $b=1$（E07）`,
        R`統計取後半段 block；mean-field 固定點由 blockLms 以 $2^{14}$ 個 code 樣本求根`,
      ]}
      params={{ ...p, seed }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ mu: 'fs', sigmaV: 'fs', aTrue: 'fs per unit code', w0: 'fs per unit code', codeMean: '—', codeSigma: '—' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic,
        monteCarlo: mcCheck,
        fixedPoint: { status: 'n/a', note: '浮點模型' },
      }}
      actions={{ onReset: () => setP(DEFAULT_ENCODING), running: task.running }}
      exportData={() => {
        if (!res) return {}
        const cols: Record<string, ArrayLike<number>> = { k: res.k }
        for (const r of res.runs) cols[`w_${r.encoding}`] = r.w
        return cols
      }}
      presets={presets}
      onLoadPreset={(pr) => load(pr.params)}
      controls={
        <>
          <ParamControl
            label={mt(R`$E[x]$（code 平均）`)}
            ariaLabel="E[x]（code 平均）"
            value={p.codeMean}
            onChange={(codeMean) => setP({ ...p, codeMean })}
            min={-2}
            max={2}
            step={0.01}
            reg="seeded_pattern.parameters.mean"
            hint={R`$0$ = 零均值 code`}
          />
          <ParamControl label={mt(R`$\sigma_x$（code 標準差）`)} ariaLabel="σ_x（code 標準差）" value={p.codeSigma} onChange={(codeSigma) => setP({ ...p, codeSigma })} min={0.01} max={4} step={0.01} reg="seeded_pattern.parameters.sigma" />
          <ParamControl label={mt(R`$\sigma_v$`)} ariaLabel="σ_v" value={p.sigmaV} onChange={(sigmaV) => setP({ ...p, sigmaV })} min={1} max={500} step={0.1} unit="fs" reg="pd_noise_rms_fs" />
          <ParamControl label={mt(R`$\mu$`)} ariaLabel="μ" value={p.mu} onChange={(mu) => setP({ ...p, mu })} min={0.01} max={100} step={0.01} unit="fs" reg="REG_LMS_MU" />
          <ParamControl label={mt(R`$a$`)} ariaLabel="a" value={p.aTrue} onChange={(aTrue) => setP({ ...p, aTrue })} min={-100} max={100} step={0.1} unit="fs/code" reg="gain_true" />
          <ParamControl label={mt(R`$w_0$`)} ariaLabel="w₀" value={p.w0} onChange={(w0) => setP({ ...p, w0 })} min={-100} max={100} step={0.1} unit="fs/code" reg="REG_DTC_GAIN_INIT" />
          <ParamControl label={mt(R`$N$`)} ariaLabel="N" value={p.N} onChange={(N) => setP({ ...p, N })} min={1} max={16384} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="block 數" value={p.numBlocks} onChange={(numBlocks) => setP({ ...p, numBlocks })} min={10} max={20000} integer clampOnBlur unit="blocks" reg="num_blocks" />
        </>
      }
    >
      <Plot title={R`三種 comparator 編碼的 $w_k$（同 seed）`} data={data} layout={layout} height={300} csvName="ch04-encoding" />
      {task.running && <p className="small muted">計算中…（Web Worker）</p>}
      <Callout kind="info" title="你會發現">
        「<Tex>{R`q=2b-1`}</Tex>」與 <Tex>{R`\pm1`}</Tex> 的曲線完全重合（虛線蓋在實線上）。忘了映射的那條：(1) 收斂速度只有一半（增益 <Tex>{R`\times\tfrac12`}</Tex>）；(2) 停在 F-04.16 的精確固定點{' '}
        <Tex>{R`w^*=a-\xi^*\sigma_v`}</Tex>，而不是 <Tex>a</Tex>；線性化 <Tex>{R`a+E[x]/(K_qE[x^2])`}</Tex> 只在 <Tex>{R`|\delta x|\ll\sigma_v`}</Tex> 時接近它。把 <Tex>{R`E[x]`}</Tex> 調成
        0，偏差消失但速度仍減半——這個 bug 在零均值 code 的模擬裡很容易被漏掉。把 <Tex>{R`\sigma_v`}</Tex> 減半，偏差也剛好減半（偏差 <Tex>{R`\propto\sigma_v`}</Tex>）。
      </Callout>
    </ExperimentShell>
  )
}
