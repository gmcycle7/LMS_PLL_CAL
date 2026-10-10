import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ExperimentShell, ParamControl, Plot, SelectControl, Tex, stripMathDelimiters, useDebouncedValue, useThemeTokens, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import {
  ALGO_IDS,
  ALGO_LABEL,
  NOISE_KIND_LABEL,
  X_KIND_LABEL,
  driftCurve,
  meanFieldAnalysis,
  noiseMedian,
  noiseOps,
  predictSteadyState,
  xMoments,
  type AlgoId,
  type CaseConfig,
  type CompareMcParams,
  type CompareMcResult,
  type MeanFieldInput,
  type NoiseKind,
  type XKind,
} from '@/simulation/models/sgd'
import { ALGO_SERIES, f4, tm, tn, toShellPresets, lab } from '../common'
import { AlgoToggles } from './AlgoToggles'
import { fixedPointConsistency, summarizeConsistency } from './consistency'
import { stepsToSettle } from './SignLmsCompare'
import { useKeyedWorker } from './useKeyedWorker'

const ID = 'sign-lms-fixed-points'

interface P {
  a: number
  xKind: XKind
  xAmp: number
  noiseKind: NoiseKind
  sigma: number
  outlierProb: number
  outlierSize: number
  huberDelta: number
  nlmsEps: number
  mu: number
  steps: number
  runs: number
  algos: AlgoId[]
}

const DEFAULT: P = {
  a: 3,
  xKind: 'uniformPos',
  xAmp: 1,
  noiseKind: 'skewed',
  sigma: 1,
  outlierProb: 0,
  outlierSize: 0,
  huberDelta: 0.5,
  nlmsEps: 0.1,
  mu: 0.01,
  steps: 6000,
  runs: 24,
  algos: ['lms', 'sign_error', 'sign_sign'],
}

const X_KINDS: XKind[] = ['const', 'bpsk', 'gauss', 'uniformPos']
const NOISE_KINDS: NoiseKind[] = ['none', 'gaussian', 'laplacian', 'impulsive', 'skewed']

function sanitize(p: Record<string, unknown>): P {
  const o = { ...DEFAULT, ...(p as Partial<P>) }
  return {
    ...o,
    xKind: X_KINDS.includes(o.xKind) ? o.xKind : DEFAULT.xKind,
    noiseKind: NOISE_KINDS.includes(o.noiseKind) ? o.noiseKind : DEFAULT.noiseKind,
    algos: sanitizeAlgos(o.algos),
  }
}

function sanitizeAlgos(v: unknown): AlgoId[] {
  const list = Array.isArray(v) ? ALGO_IDS.filter((a) => (v as unknown[]).includes(a)) : []
  return list.length ? list : DEFAULT.algos
}

/** 固定點 = 平均更新方向 ψ(w) 的零交越；不同演算法看的是不同的「平均」。 */
export function FixedPointExplorer() {
  const [p, setP] = useState<P>(DEFAULT)
  const [seed, setSeed] = useState(20261010)
  const urlPreset = useUrlPreset(ID)
  useEffect(() => {
    if (urlPreset) setP(sanitize(urlPreset.params))
  }, [urlPreset])
  const tokens = useThemeTokens()
  const set = <K extends keyof P>(k: K, v: P[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDebouncedValue(p, 200)

  const inp: MeanFieldInput = useMemo(
    () => ({
      a: dp.a,
      x: { kind: dp.xKind, amp: dp.xAmp },
      noise: { kind: dp.noiseKind, sigma: dp.sigma, outlierProb: dp.outlierProb, outlierSize: dp.outlierSize },
      huberDelta: dp.huberDelta,
      nlmsEps: dp.nlmsEps,
    }),
    [dp],
  )
  const m = xMoments(inp.x)
  const mf = useMemo(() => dp.algos.map((a) => meanFieldAnalysis(a, inp)), [dp.algos, inp])
  const muOf = (a: AlgoId) => (a === 'nlms' ? dp.mu * m.m2 : dp.mu)
  const pred = mf.map((r) => predictSteadyState(r, muOf(r.algo), inp))
  const med = useMemo(() => noiseMedian(inp.noise), [inp.noise])
  const ops = useMemo(() => noiseOps(inp.noise), [inp.noise])
  const signV = ops.signMean(0) // E[sign v] = 1 − 2F_v(0)

  // ψ(w)/K 曲線（每條在 w* 處斜率為 −1，方便比較零交越位置）
  const curves = useMemo(() => {
    const ws = mf.filter((r) => r.identifiable).map((r) => r.wStar)
    const spread = ws.length ? Math.max(...ws.map((w) => Math.abs(w - inp.a))) : 0
    const noiseScale = (inp.noise.sigma + inp.noise.outlierProb * Math.abs(inp.noise.outlierSize)) / Math.max(1e-6, Math.sqrt(m.m2))
    const R = Math.max(0.5, 2.5 * spread, 1.5 * noiseScale)
    const center = ws.length ? 0.5 * (Math.min(...ws, inp.a) + Math.max(...ws, inp.a)) : inp.a
    return mf.map((r) => {
      const c = driftCurve(r.algo, inp, center - R, center + R, 241)
      const scale = Number.isFinite(r.K) && r.K > 0 ? r.K : Math.max(1e-12, ...Array.from(c.psi, Math.abs))
      return { algo: r.algo, w: c.w, y: Float64Array.from(c.psi, (v) => v / scale) }
    })
  }, [mf, inp, m.m2])

  const plotData = useMemo<Data[]>(() => {
    const out: Data[] = curves.map((c) => ({
      x: Array.from(c.w),
      y: Array.from(c.y),
      name: `ψ/K：${ALGO_LABEL[c.algo]}`,
      mode: 'lines',
      line: { color: tokens.series[ALGO_SERIES[c.algo]], width: 2 },
    }))
    const xs = curves[0] ? [curves[0].w[0], curves[0].w[curves[0].w.length - 1]] : [inp.a - 1, inp.a + 1]
    out.push({ x: xs, y: [0, 0], name: 'ψ = 0', mode: 'lines', line: { color: tokens.textFaint, width: 1 }, showlegend: false })
    mf.forEach((r) => {
      if (r.identifiable)
        out.push({
          x: [r.wStar],
          y: [0],
          name: `w*（${ALGO_LABEL[r.algo]}）= ${f4(r.wStar, 5)}`,
          mode: 'markers',
          marker: { size: 11, symbol: 'diamond', color: tokens.series[ALGO_SERIES[r.algo]], line: { width: 1, color: tokens.text } },
        })
    })
    return out
  }, [curves, mf, tokens, inp.a])

  // Monte Carlo 驗證（Worker）：從 w0 = a 出發、固定步長，取後半段時間平均
  const mcParams = useMemo<CompareMcParams | null>(
    () =>
      m.m2 > 0
        ? {
            a: dp.a,
            w0: dp.a,
            mu: dp.mu,
            steps: dp.steps,
            xKind: dp.xKind,
            xAmp: dp.xAmp,
            noiseKind: dp.noiseKind,
            sigma: dp.sigma,
            outlierProb: dp.outlierProb,
            outlierSize: dp.outlierSize,
            tie: 'plus',
            schedule: 'constant',
            n0: 1,
            stepMatch: 'same-mu',
            huberDelta: dp.huberDelta,
            nlmsEps: dp.nlmsEps,
            algos: dp.algos,
            seed,
            runs: dp.runs,
            checkpoints: 20,
          }
        : null,
    [dp, seed, m.m2],
  )
  const mc = useKeyedWorker<CompareMcParams, CompareMcResult>('sgd', 'monteCarloCompare', mcParams)

  const fpCase: CaseConfig = useMemo(
    () => ({ ...(mcParams ?? { a: dp.a, w0: dp.a, mu: dp.mu, steps: dp.steps, xKind: dp.xKind, xAmp: dp.xAmp, noiseKind: dp.noiseKind, sigma: dp.sigma, outlierProb: dp.outlierProb, outlierSize: dp.outlierSize, tie: 'plus', schedule: 'constant', n0: 1, stepMatch: 'same-mu', huberDelta: dp.huberDelta, nlmsEps: dp.nlmsEps }) }),
    [mcParams, dp],
  )
  const rows = mf.map((r, i) => {
    const st = mc.result?.stats.find((s) => s.algo === r.algo)
    const { expect, tol, ok, reason } = fixedPointConsistency({ c: fpCase, algo: r.algo, mu: muOf(r.algo), mf: r, pred: pred[i], st })
    return { r, st, expect, tol, ok, reason, pred: pred[i] }
  })
  const analyticSummary = summarizeConsistency(rows.map((x) => ({ ok: x.ok, reason: x.reason, label: ALGO_LABEL[x.r.algo] })))
  // 以真值 a 為基準：哪些演算法的固定點偏離 a？彼此是否相同？（不依賴 LMS 是否被勾選）
  const tolStar = 1e-6 * (1 + Math.abs(dp.a))
  const ident = mf.filter((r) => r.identifiable)
  const offTruth = ident.filter((r) => Math.abs(r.wStar - dp.a) > tolStar)
  const spread = ident.length ? Math.max(...ident.map((r) => r.wStar)) - Math.min(...ident.map((r) => r.wStar)) : 0
  const allSame = spread <= tolStar

  const warnings: string[] = []
  if (!(m.m2 > 0)) warnings.push(String.raw`$x\equiv0$：$E[x^2]=\lambda_{\min}=0$，任何演算法的 $\psi(w)\equiv0$——不可辨識，沒有固定點可言。`)
  rows.forEach(({ st }) => {
    if (st && st.diverged > 0)
      warnings.push(
        String.raw`${ALGO_LABEL[st.algo]}：${st.diverged}/${dp.runs} 個 run 發散（$|w|>10^{12}$）。LMS 需要 $\mu<2E[x^2]/E[x^4]$（均方穩定）、NLMS 需要 $\tilde\mu<2$；請減小 $\mu$。`,
      )
  })

  const metrics: MetricRow[] = rows.flatMap(({ r, st, expect, tol }) => [
    {
      name: String.raw`${ALGO_LABEL[r.algo]}：MC 時間平均 vs $w^*$（$+O(\mu)$ 修正）`,
      value: st ? st.tavgMean : mc.pending ? '計算中…' : null,
      analytic: Number.isFinite(expect) ? expect : undefined,
      tolerance: st ? tol : undefined,
      formulaId: 'F-02.8',
      claim: 'exact' as const,
      note: st ? String.raw`95% CI $\pm${tn(st.tavgHalf)}$；${dp.runs} seeds $\times$ ${dp.steps} 步` : undefined,
    },
  ])

  return (
    <ExperimentShell
      id={ID}
      title={String.raw`固定點 = 平均更新方向 $\psi(w)$ 的零交越`}
      level="L0"
      claim="exact"
      source="simulation"
      description={
        <>
          畫出 <Tex>{String.raw`\psi(w)=E[\text{更新方向}]`}</Tex>（除以各自的斜率 <Tex>{'K'}</Tex>）。零交越就是固定點 <Tex>{'w^*'}</Tex>；
          下方表格用 Worker 跑 Monte Carlo 驗證（後半段時間平均 <Tex>{'\\pm'}</Tex> 95% 信賴區間）。
        </>
      }
      assumptions={[
        '$y=a\\,x+v$；$x$ 與 $v$ 獨立、iid；$\\delta=a-w$（全站約定）',
        String.raw`$\psi(w)$ 為 mean-field（期望值）函數：對 $x$ 用數值積分（Simpson）、對 $v$ 用 CDF 與部分動差的封閉式`,
        String.raw`MC：從 $w_0=a$ 出發、固定 $\mu$、tie 輸出 $+1$，取後半段時間平均；預期值含 $O(\mu)$ 的曲率修正 $\psi''(w^*)\operatorname{Var}(w)/(2K)$`,
      ]}
      params={{ ...dp, algos: dp.algos.join(',') }}
      seed={seed}
      onSeedChange={setSeed}
      units={{ a: '同 y/x', sigma: '同 y', xAmp: '無因次', mu: '依演算法', outlierSize: '同 y' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic:
          mcParams === null
            ? { status: 'n/a', note: String.raw`$x\equiv0$：不可辨識，沒有固定點` }
            : mc.result
              ? analyticSummary
              : { status: 'n/a', note: mc.error ?? 'MC 計算中…' },
        monteCarlo:
          mcParams === null
            ? { status: 'n/a', note: '不可辨識：未執行' }
            : mc.result
              ? { status: 'ok', note: `${dp.runs} seeds（${mc.mode}${mc.durationMs ? `，${Math.round(mc.durationMs)} ms` : ''}）` }
              : { status: 'n/a', note: mc.error ?? '計算中…' },
        fixedPoint: 'not-implemented',
      }}
      actions={{
        onReset: () => setP(DEFAULT),
        onRunToConvergence: () => {
          // 從 w₀ = a 出發：只需等暫態（a → w*）衰減，取各演算法 2×(等速段 + 8τ) 的最大值
          const need = Math.max(0, ...rows.map(({ r, pred: pr }) => stepsToSettle({ algo: r.algo, mu: muOf(r.algo), mf: r, pred: pr }, fpCase)))
          if (need > 0) set('steps', Math.max(500, Math.min(20000, Math.ceil(need))))
        },
      }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number>> = {}
        curves.forEach((c) => {
          cols[`w_${c.algo}`] = c.w
          cols[`psi_over_K_${c.algo}`] = c.y
        })
        return cols
      }}
      presets={toShellPresets(presetsForExperiment(ID))}
      onLoadPreset={(pr) => setP(sanitize(pr.params))}
      controls={
        <>
          <AlgoToggles value={p.algos} onChange={(v) => set('algos', v)} />
          <SelectControl {...lab(String.raw`$x$ 的分布`, 'x 的分布')} value={p.xKind} onChange={(v) => set('xKind', v)} options={X_KINDS.map((k) => ({ value: k, label: X_KIND_LABEL[k] }))} reg="behavioural: code distribution" />
          <ParamControl {...lab(String.raw`$x$ 的幅度 $A$`, 'x 幅度 A')} unit="無因次" value={p.xAmp} onChange={(v) => set('xAmp', v)} min={0} max={4} step={0.01} reg="behavioural: code scale" />
          <SelectControl label="雜訊形狀" value={p.noiseKind} onChange={(v) => set('noiseKind', v)} options={NOISE_KINDS.map((k) => ({ value: k, label: NOISE_KIND_LABEL[k] }))} reg="behavioural: comparator-input noise pdf" />
          <ParamControl {...lab(String.raw`$\sigma_v$（雜訊標準差）`, 'σ（雜訊標準差）')} unit="同 y" value={p.sigma} onChange={(v) => set('sigma', v)} min={0} max={5} step={0.01} reg="behavioural: sigma_v" />
          <ParamControl {...lab(String.raw`outlier 機率 $p_{\rm out}$`, 'outlier 機率 p_out')} unit="機率" value={p.outlierProb} onChange={(v) => set('outlierProb', v)} min={0} max={0.5} step={0.001} reg="behavioural: impulsive disturbance rate" />
          <ParamControl {...lab(String.raw`outlier 大小 $s$（單邊，加在 $v$ 上）`, 'outlier 大小 s（單邊，加在 v 上）')} unit="同 y" value={p.outlierSize} onChange={(v) => set('outlierSize', v)} min={-50} max={50} step={0.1} reg="behavioural: disturbance size" />
          <ParamControl {...lab(String.raw`$a$（真實係數）`, 'a（真實係數）')} unit="同 y/x" value={p.a} onChange={(v) => set('a', v)} min={-10} max={10} step={0.01} reg="behavioural: true gain a" />
          <ParamControl {...lab(String.raw`MC：$\mu$`, 'MC：μ')} unit="依演算法" value={p.mu} onChange={(v) => set('mu', v)} min={1e-4} max={0.2} log reg="REG_LMS_MU" hint={tm(String.raw`小 $\mu$ 讓 $O(\mu)$ 偏移可忽略`)} />
          <ParamControl label="MC：步數" unit="samples" value={p.steps} onChange={(v) => set('steps', v)} min={500} max={20000} integer clampOnBlur reg="sim length" />
          <ParamControl label="MC：seeds 數" unit="seeds" value={p.runs} onChange={(v) => set('runs', v)} min={4} max={128} integer clampOnBlur reg="Monte Carlo runs" />
          <ParamControl {...lab(String.raw`$\delta_{\rm H}$（Huber 門檻）`, 'δₕ（Huber 門檻）')} unit="同 y" value={p.huberDelta} onChange={(v) => set('huberDelta', v)} min={0.01} max={10} log reg="REG_ERR_CLIP" />
          <ParamControl {...lab(String.raw`NLMS 的 $\varepsilon$`, 'NLMS ε')} unit="[x]^2" value={p.nlmsEps} onChange={(v) => set('nlmsEps', v)} min={0} max={10} step={0.001} reg="behavioural: nlms_eps" />
        </>
      }
    >
      <Plot title={String.raw`$\psi(w)/K$：零交越 = 固定點 $w^*$`} data={plotData} height={320} csvName="psi-curves" layout={{ xaxis: { title: { text: 'w' } }, yaxis: { title: { text: 'ψ(w)/K（正 → w 往上走）' } } }} />
      <div className="table-wrap">
        <table className="ch02-table">
          <thead>
            <tr>
              <th>演算法</th>
              <th>
                固定點條件 <ClaimTag kind="exact" />
              </th>
              <th className="num">
                <Tex>{'w^*'}</Tex>
              </th>
              <th className="num">
                <Tex>{'w^*-a'}</Tex>
              </th>
              <th className="num">
                <Tex>{'K'}</Tex>
              </th>
              <th className="num">
                MC 平均 <Tex>{'\\pm'}</Tex> 95% CI
              </th>
              <th>一致？</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, st, ok, reason }) => (
              <tr key={r.algo}>
                <td>{ALGO_LABEL[r.algo]}</td>
                <td>
                  <Tex>{CONDITION[r.algo]}</Tex>
                </td>
                <td className="num">{r.identifiable ? f4(r.wStar, 6) : '不可辨識'}</td>
                <td className="num">{r.identifiable ? f4(r.wStar - dp.a, 4) : '—'}</td>
                <td className="num">{Number.isFinite(r.K) ? f4(r.K) : tm(String.raw`$\infty$（無雜訊）`)}</td>
                <td className="num">{st ? tm(String.raw`${f4(st.tavgMean, 5)} $\pm$ ${f4(st.tavgHalf, 2)}`) : mc.pending ? '計算中…' : '—'}</td>
                <td title={reason ? stripMathDelimiters(reason) : undefined}>{ok === null ? (reason && st ? '未比較（原因見上方交叉比對）' : '—') : ok ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ch02-note">
        雜訊中位數 <Tex>{String.raw`\operatorname{med}(v)=${f4(med, 5)}`}</Tex>；<Tex>{String.raw`E[v]=${f4(ops.mean, 5)}`}</Tex>；<Tex>{String.raw`E[x]=${f4(m.m1, 5)}`}</Tex>。
      </p>
      {ident.length === 0 ? null : offTruth.length > 0 ? (
        <Callout kind="warn" title={allSame ? <>固定點彼此相同，但都不等於 <Tex>{'a'}</Tex></> : '固定點不同'}>
          {offTruth.map((r) => `${ALGO_LABEL[r.algo]}：${f4(r.wStar, 5)}`).join('；')}（<Tex>{String.raw`a=${f4(dp.a)}`}</Tex>）。判斷法（F-02.18）：在 <Tex>{'w=a'}</Tex> 處誤差只剩 <Tex>{'e=v'}</Tex>，
          而 <Tex>{'v'}</Tex> 與 <Tex>{'x'}</Tex> 獨立，所以平均更新方向拆成兩個期望值的乘積：
          <Tex>{String.raw`\psi_{\rm LMS}(a)=E[v]\,E[x]`}</Tex>、<Tex>{String.raw`\psi_{\rm SE}(a)=E[\operatorname{sign}v]\,E[x]`}</Tex>、
          <Tex>{String.raw`\psi_{\rm SS}(a)=E[\operatorname{sign}v]\,E[\operatorname{sign}x]`}</Tex>。
          本例 <Tex>{String.raw`E[v]=${f4(ops.mean, 4)},\ E[\operatorname{sign}v]=1-2F_v(0)=${f4(signV, 4)},\ E[x]=${f4(m.m1, 4)}`}</Tex>：
          LMS 只看雜訊的<strong>平均</strong>，sign 類演算法看的是<strong>中位數</strong>（<Tex>{'E[\\operatorname{sign}v]=0'}</Tex> 等價於中位數為 0）；
          乘積不為 0 的那個演算法，固定點就會離開 <Tex>{'a'}</Tex>。
        </Callout>
      ) : (
        <Callout kind="ok" title={<>所選演算法的固定點都等於 <Tex>{'a'}</Tex></>}>
          由 F-02.18：雜訊的平均與中位數都是 0（例如對稱雜訊），或 code 對稱
          （<Tex>{'E[x]=0'}</Tex> 且 <Tex>{'E[\\operatorname{sign}x]=0'}</Tex>，例如 <Tex>{'\\pm A'}</Tex>、Gaussian code）時，<Tex>{'\\psi(a)=0'}</Tex> 對每個演算法都成立。
        </Callout>
      )}
      <ul className="ch02-try">
        <li>
          試試看：把 <Tex>{'x'}</Tex> 的分布切成「<Tex>{'\\pm A'}</Tex> 等機率」。雜訊仍然偏斜，但三條曲線的零交越重合在 <Tex>{'a'}</Tex>——對稱的 code 讓 sign 類演算法對偏斜雜訊免疫。
        </li>
        <li>
          雜訊改成 Gaussian、<Tex>{'x'}</Tex> 改成常數，再把 outlier 機率設 0.05、大小設 20：LMS 的零交越移到 <Tex>{String.raw`a+p_{\rm out}s=4`}</Tex>，Sign-Error 只移動約 <Tex>{String.raw`0.066\,\sigma_v`}</Tex>
          （中位數由 <Tex>{String.raw`(1-p_{\rm out})\,\Phi(m/\sigma_v)=\tfrac12`}</Tex> 決定，與 <Tex>{'s'}</Tex> 多大無關——outlier 再大也只算一票）。
        </li>
        <li>
          勾選 Huber，把 <Tex>{'\\delta_{\\rm H}'}</Tex> 從 0.05 慢慢拉到 5：固定點從中位數附近（像 Sign-Error）滑向平均（像 LMS）。
        </li>
      </ul>
    </ExperimentShell>
  )
}

const CONDITION: Record<AlgoId, string> = {
  lms: String.raw`E[e\,x]=0`,
  sign_error: String.raw`E[\operatorname{sign}(e)\,x]=0`,
  sign_sign: String.raw`E[\operatorname{sign}(e)\operatorname{sign}(x)]=0`,
  huber: String.raw`E[\psi_{\rm H}(e)\,x]=0`,
  nlms: String.raw`E\!\big[\tfrac{e\,x}{\varepsilon+x^2}\big]=0`,
}
