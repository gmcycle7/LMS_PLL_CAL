import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  HandCalc,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  StepDerivation,
  Tex,
  TexBlock,
  useCases,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { coloredPsd, MC_BURN_CAP, sigmaW2Colored, sigmaW2Lyapunov, simulateColoredLms } from '../model'
import { ErratumNote, KvTable, mergeParams, mt, n4, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r1-colored'
const PATH = 'src/pages/roadmap/model.ts'

interface R1Params {
  sigmaV: number
  N: number
  mu: number
  C: number
  fs: number
  chains: number
  blocks: number
}

const DEFAULTS: R1Params = { sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9, chains: 16, blocks: 4000 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'T13 條件（σ_v = 100 fs、N = 4096、μ = 10 fs）', params: { ...DEFAULTS }, description: 'ρ = 0 時重現 σ_w ≈ 0.399 fs' },
  { name: '快迴路（μ = 60 fs，p ≈ 0.52）', params: { ...DEFAULTS, mu: 60 }, description: 'p 小時相關的影響變小' },
  { name: '慢迴路（μ = 2 fs，p ≈ 0.984）', params: { ...DEFAULTS, mu: 2 }, description: 'p → 1 時 (1+pρ)/(1−pρ) → (1+ρ)/(1−ρ)' },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_CURVE: Partial<Layout> = { xaxis: { title: { text: 'ρ（η 的 AR(1) 係數）' } }, yaxis: { title: { text: 'σ_w [fs]' } } }
const LAYOUT_PSD: Partial<Layout> = { xaxis: { title: { text: 'f [Hz]（block rate f_u）' } }, yaxis: { title: { text: 'fs²/Hz' } } }

/** 先算一次：T13 條件下 ρ = 0、0.5、−0.5 的 σ_w（全部由 model 計算） */
export function useR1HandCalc() {
  return useMemo(() => {
    const K = Math.sqrt(2 / Math.PI) / 100
    const p = 1 - 10 * K
    const rows = [0, 0.5, -0.5].map((rho) => {
      const s2 = sigmaW2Colored({ p, mu: 10, sigmaEta2: 1 / 4096, rho })
      return { rho, pr: p * rho, factor: (1 + p * rho) / (1 - p * rho), sigmaW: Math.sqrt(s2) }
    })
    return { K, p, rows }
  }, [])
}

function R1Experiment() {
  const [P, setP] = useState<R1Params>(DEFAULTS)
  const cases = useCases({ rho: 0.5 }, { seed: 20261010 })
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (p) => setP((prev) => mergeParams(prev, p)))

  const dP = useDeferredValue(P)
  const dCases = useDeferredValue(cases.cases)
  const seed = cases.seed

  const K = (Math.sqrt(2 / Math.PI) / dP.sigmaV) * dP.C
  const g = dP.mu * K
  const p = 1 - g
  const sigmaEta2 = 1 / dP.N
  const fu = dP.fs / dP.N
  const stable = Math.abs(p) < 1

  const results = useMemo(
    () =>
      dCases.map((c) => {
        const base = { p, mu: dP.mu, sigmaEta2, rho: c.params.rho }
        if (!stable) return { id: c.id, seriesIndex: c.seriesIndex, rho: c.params.rho, closed: Infinity, lyap: NaN, mc: null, psd: null }
        const closed = sigmaW2Colored(base)
        let lyap = NaN
        try {
          lyap = sigmaW2Lyapunov(base)
        } catch {
          lyap = NaN
        }
        const mc = simulateColoredLms({ ...base, chains: Math.round(dP.chains), blocks: Math.round(dP.blocks), seed })
        const psd = coloredPsd({ ...base, fu, points: 4001 })
        return { id: c.id, seriesIndex: c.seriesIndex, rho: c.params.rho, closed, lyap, mc, psd }
      }),
    [dCases, p, dP.mu, sigmaEta2, stable, dP.chains, dP.blocks, seed, fu],
  )
  const active = results.find((r) => r.id === cases.activeId) ?? results[0]
  const white = stable ? sigmaW2Colored({ p, mu: dP.mu, sigmaEta2, rho: 0 }) : Infinity

  const rhoGrid = useMemo(() => Array.from({ length: 199 }, (_, i) => -0.99 + i * 0.01), [])
  const curve = useMemo(() => rhoGrid.map((rho) => (stable ? Math.sqrt(sigmaW2Colored({ p, mu: dP.mu, sigmaEta2, rho })) : NaN)), [rhoGrid, stable, p, dP.mu, sigmaEta2])

  const inCi = (r: (typeof results)[number]) => !!r.mc && r.closed >= r.mc.lo - 0.02 * r.closed && r.closed <= r.mc.hi + 0.02 * r.closed

  const warnings: string[] = []
  if (!stable) warnings.push(String.raw`$p=1-\mu K=${n4(p)}$：$|p|\ge1$，校正迴路不穩定（$g=\mu K=${n4(g)}\ge2$），沒有穩態 $\sigma_w$ 可言；請降低 $\mu$。`)
  else if (p < 0) warnings.push(String.raw`$p=${n4(p)}<0$：$g=\mu K>1$，係數逐 block 正負交替（振盪收斂）；此時 $\rho<0$ 的雜訊反而被放大（因子 $\frac{1+p\rho}{1-p\rho}$ 的 $p\rho>0$）。`)
  for (const r of results) {
    if (!r.mc || !Number.isFinite(r.closed)) continue
    if (!r.mc.burnInAdequate)
      warnings.push(
        String.raw`Case ${r.id}：迴路太慢，時間常數 $\tau=1/(1-\max(|p|,|\rho|))=${n4(r.mc.tauBlocks)}$ blocks，burn-in 上限 ${MC_BURN_CAP} blocks 不到 $5\tau$。$\delta w$ 從 0 出發還沒到穩態，Monte Carlo 會偏低——這一組不拿來判定（顯示 n/a），請看封閉式與 Lyapunov。`,
      )
    else if (!inCi(r))
      warnings.push(String.raw`Case ${r.id}：Monte Carlo 95% CI $[${n4(r.mc.lo)},\ ${n4(r.mc.hi)}]\ \mathrm{fs}^2$ 未涵蓋封閉式 $${n4(r.closed)}\ \mathrm{fs}^2$；請增加 blocks / chains 或換 seed 再確認（CI 寬度與相關長度 $\tau$ 有關）。`)
  }

  const lyapOk = active && Number.isFinite(active.lyap) && Math.abs(active.lyap - active.closed) <= 1e-9 * active.closed
  const mcUsable = !!active?.mc && active.mc.burnInAdequate

  const metrics: MetricRow[] = [
    { name: '$K=K_qC$', value: K, unit: 'fs⁻¹', claim: 'approx', note: 'Gaussian 小訊號增益（第 5 章）' },
    { name: String.raw`$g=\mu K$`, value: g, unit: '—' },
    { name: '$p=1-g$', value: p, unit: '—', analytic: 1 - dP.mu * K, tolerance: 1e-15 },
    { name: String.raw`$\sigma_\eta^2=1/N$`, value: sigmaEta2, unit: '—', note: String.raw`$x=\pm1$ 時精確值為 $(1-m^2)/N$（勘誤 E30）` },
    { name: String.raw`$\sigma_w$（白雜訊 $\rho=0$）`, value: Math.sqrt(white), unit: 'fs', formulaId: 'F-R1.1', claim: 'exact' },
  ]
  if (active && stable) {
    metrics.push(
      { name: String.raw`Case ${active.id}：$\sigma_w^2$ 封閉式（$\rho=${active.rho}$）`, value: active.closed, unit: 'fs²', formulaId: 'F-R1.1', claim: 'exact' },
      { name: String.raw`Case ${active.id}：$\sigma_w^2$ Lyapunov`, value: active.lyap, unit: 'fs²', formulaId: 'F-R1.2', analytic: active.closed, tolerance: 1e-9, toleranceMode: 'rel', claim: 'exact' },
      {
        name: String.raw`Case ${active.id}：$\sigma_w^2$ Monte Carlo`,
        value: active.mc?.meanSq ?? null,
        unit: 'fs²',
        analytic: mcUsable ? active.closed : undefined,
        tolerance: mcUsable && active.mc ? Math.max(active.mc.hi - active.mc.meanSq, active.mc.meanSq - active.mc.lo) + 0.02 * active.closed : undefined,
        claim: 'approx',
        note: active.mc
          ? String.raw`95% CI $[${n4(active.mc.lo)},\ ${n4(active.mc.hi)}]$（${active.mc.chains} chains，每條 ${active.mc.blocks} blocks，burn-in ${active.mc.burnIn}${active.mc.burnInAdequate ? '' : '：不足，不判定'}）`
          : undefined,
      },
      { name: String.raw`Case ${active.id}：$\int S_w^{(1)}(f)\,df$（Parseval）`, value: active.psd?.integral ?? null, unit: 'fs²', analytic: active.closed, tolerance: 0.01, toleranceMode: 'rel', note: '4001 點梯形法' },
      {
        name: String.raw`Case ${active.id}：$\sigma_w/\sigma_{w,\mathrm{white}}$`,
        value: Math.sqrt(active.closed / white),
        unit: '—',
        analytic: Math.sqrt((1 + p * active.rho) / (1 - p * active.rho)),
        tolerance: 1e-12,
        toleranceMode: 'rel',
      },
    )
  }

  const curveData: Data[] = useMemo(() => {
    const d: Data[] = [{ x: rhoGrid, y: curve, name: 'σ_w(ρ) 封閉式', mode: 'lines', line: { color: tokens.textMuted } }]
    for (const r of results) {
      if (!r.mc) continue
      const m = Math.sqrt(r.mc.meanSq)
      d.push({
        x: [r.rho],
        y: [m],
        name: `Case ${r.id} MC`,
        mode: 'markers',
        marker: { color: tokens.series[r.seriesIndex], size: 10 },
        error_y: { type: 'data', symmetric: false, array: [Math.sqrt(Math.max(0, r.mc.hi)) - m], arrayminus: [m - Math.sqrt(Math.max(0, r.mc.lo))] },
      })
    }
    return d
  }, [rhoGrid, curve, results, tokens])

  const psdData: Data[] = useMemo(
    () =>
      results
        .filter((r) => r.psd)
        .map((r) => ({ x: r.psd!.f, y: r.psd!.s1, name: `Case ${r.id}（ρ = ${r.rho}）`, mode: 'lines', line: { color: tokens.series[r.seriesIndex] } })),
    [results, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`R1 預覽：有色 GMAC 雜訊下的係數雜訊 $\sigma_w$`}
      level="L1"
      claim="exact"
      source="simulation"
      description={
        <>
          線性化遞迴 <Tex>{String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k`}</Tex>，<Tex>{'\\eta'}</Tex> 為 AR(1)。三種算法（封閉式、Lyapunov、Monte Carlo）＋ PSD 積分四方比對；<Tex>{'\\rho=0'}</Tex> 即第 12 章的 T13。
        </>
      }
      assumptions={[
        String.raw`線性化 GMAC：$G\approx-K\,\delta w+\eta$（$|\delta w|\,C\ll\sigma_v$），$\delta w=w-w^*$（勘誤 E33）`,
        String.raw`無更新延遲（$d=0$）；average-mode GMAC；$\sigma_\eta^2=1/N$`,
        String.raw`$\eta$ 為零均值、平穩 AR(1)：$R_\eta[\ell]=\sigma_\eta^2\rho^{|\ell|}$（真實的 $S_\eta$ 需量測，屬 R1 待辦）`,
        String.raw`PSD 為單邊 per-Hz，取樣率 $f_u=f_s/N$（勘誤 E28）`,
        String.raw`Monte Carlo 在主執行緒執行：每條 chain 的 burn-in 取 $20\tau$、上限 ${MC_BURN_CAP} blocks；不足 $5\tau$ 時不判定`,
      ]}
      params={{ ...P, rho_active: cases.active.params.rho }}
      seed={seed}
      onSeedChange={cases.setSeed}
      units={{ sigmaV: 'fs', mu: 'fs', fs: 'Hz', N: 'samples/block', rho: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: stable ? { status: lyapOk ? 'ok' : 'mismatch', note: String.raw`封閉式 vs Lyapunov（相對誤差 $\le10^{-9}$）` } : 'n/a',
        monteCarlo: !stable
          ? 'n/a'
          : mcUsable
            ? { status: active && inCi(active) ? 'ok' : 'mismatch', note: String.raw`封閉式落在 95% CI（$\pm2\%$ 容差）內` }
            : { status: 'n/a', note: String.raw`burn-in 不足 $5\tau$：不判定` },
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({
        rho: rhoGrid,
        sigma_w_fs: curve,
        psd_f_Hz: active?.psd?.f ?? [],
        psd_fs2_per_Hz: active?.psd?.s1 ?? [],
        mc_trace_dw_fs: active?.mc?.trace ?? [],
      })}
      controls={
        <>
          <ParamControl {...pl(String.raw`$\sigma_v$（comparator 前雜訊）`, 'sigma_v（comparator 前雜訊）')} value={P.sigmaV} onChange={(v) => setP({ ...P, sigmaV: v })} min={1} max={1000} log unit="fs" reg="Behavioral：comparator noise σ_v" />
          <ParamControl {...pl('$N$（GMAC block 長度）', 'N（GMAC block 長度）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={16} max={65536} log integer clampOnBlur unit="samples" reg="REG_GMAC_N[16:0]" />
          <ParamControl
            {...pl(String.raw`$\mu$（步長）`, 'mu（步長）')}
            value={P.mu}
            onChange={(v) => setP({ ...P, mu: v })}
            min={0.01}
            max={500}
            log
            unit="fs"
            reg="REG_GAIN_STEP（μ）"
            hint={mt(String.raw`$g=\mu K$；穩定需 $0<g<2$`)}
          />
          <ParamControl {...pl('$C$（code 相關）', 'C（code 相關）')} value={P.C} onChange={(v) => setP({ ...P, C: v })} min={0.01} max={2} step={0.01} unit="—" reg="Behavioral：C = E[x·u]" />
          <ParamControl {...pl('$f_s$（comparator 取樣率）', 'f_s（comparator 取樣率）')} value={P.fs} onChange={(v) => setP({ ...P, fs: v })} min={1e8} max={2e10} log unit="Hz" reg="Behavioral：f_ref" />
          <ParamControl label="MC chains" value={P.chains} onChange={(v) => setP({ ...P, chains: v })} min={4} max={24} integer clampOnBlur unit="chains" reg="MC：獨立 chain 數" />
          <ParamControl label="MC blocks / chain" value={P.blocks} onChange={(v) => setP({ ...P, blocks: v })} min={500} max={4000} integer clampOnBlur unit="blocks" reg="MC：每條 chain 的 block 數" />
        </>
      }
    >
      <CaseSelector cases={cases} label="GMAC 雜訊相關係數的比較組（同一 seed）" />
      <ParamControl
        {...pl(String.raw`Case ${cases.activeId} 的 $\rho$（$\eta$ 的 AR(1) 係數）`, `Case ${cases.activeId} 的 rho（eta 的 AR(1) 係數）`)}
        value={cases.active.params.rho}
        onChange={(rho) => cases.update({ rho })}
        min={-0.99}
        max={0.99}
        step={0.01}
        unit="—"
        reg="Behavioral：GMAC 雜訊 block-to-block 相關係數"
      />
      <div className="rm-plots">
        <Plot
          title={String.raw`$\sigma_w$ vs $\rho$：封閉式曲線與 Monte Carlo（95% CI）`}
          data={curveData}
          layout={LAYOUT_CURVE}
          height={300}
          csvName="r1-sigma-w-vs-rho"
        />
        <Plot
          title={String.raw`係數雜訊 PSD $S_w^{(1)}(f)$（單邊、$f_u$ 取樣）`}
          data={psdData}
          xLog
          yLog
          layout={LAYOUT_PSD}
          height={300}
          csvName="r1-psd"
          caption={String.raw`由 DTFT 形式乘 $2/f_u$ 換成單邊 per-Hz（勘誤 E28）；積分 $=\sigma_w^2$`}
        />
      </div>
    </ExperimentShell>
  )
}

export default function R1Preview() {
  const hc = useR1HandCalc()
  return (
    <div className="rm-preview">
      <Prereq title="期望值、變異數與自相關（只用「很多次的平均」）">
        <p>
          <Tex>{'E[X]'}</Tex> 是「同一個實驗重複很多次後的平均」。變異數 <Tex>{'\\mathrm{Var}(X)=E[X^2]-(E[X])^2'}</Tex> 描述抖動大小；零均值時就是 <Tex>{'E[X^2]'}</Tex>。
          期望值是線性的：<Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>；若 <Tex>{'X,Y'}</Tex> 獨立，<Tex>{'E[XY]=E[X]E[Y]'}</Tex>。
        </p>
        <p>
          <strong>自相關（autocorrelation）</strong> <Tex>{'R_\\eta[\\ell]=E[\\eta_k\\eta_{k+\\ell}]'}</Tex>：相隔 <Tex>{'\\ell'}</Tex> 個 block 的兩個雜訊「平均起來有多同號」。
          iid 雜訊只有 <Tex>{'\\ell=0'}</Tex> 不為零。AR(1) 雜訊 <Tex>{String.raw`\eta_{k+1}=\rho\eta_k+\sqrt{1-\rho^2}\,\sigma_\eta\xi_k`}</Tex>（<Tex>{'\\xi_k'}</Tex> 為 iid 標準常態）：
          兩邊乘 <Tex>{'\\eta_k'}</Tex> 再取期望值，因為 <Tex>{'\\xi_k'}</Tex> 與 <Tex>{'\\eta_k'}</Tex> 獨立，得 <Tex>{'R_\\eta[1]=\\rho\\sigma_\\eta^2'}</Tex>；重複 <Tex>{'\\ell'}</Tex> 次得 <Tex>{'R_\\eta[\\ell]=\\sigma_\\eta^2\\rho^{|\\ell|}'}</Tex>。
        </p>
      </Prereq>
      <Prereq title="等比級數（geometric series）">
        <p>
          <Tex>{String.raw`\sum_{i=0}^{\infty}r^i=1+r+r^2+\dots=\frac1{1-r}\quad(|r|<1)`}</Tex>：令 <Tex>{'S'}</Tex> 為總和，<Tex>{'S-rS=1'}</Tex> 就解出來。下面的推導用了三次。
        </p>
      </Prereq>

      <h4>{mt(String.raw`先算一次（T13 條件：$\sigma_v=100$ fs、$N=4096$、$\mu=10$ fs）`)}</h4>
      <p>
        <Tex>{`K=\\sqrt{2/\\pi}/100=${n4(hc.K)}\\ \\mathrm{fs^{-1}}`}</Tex>，<Tex>{`p=1-\\mu K=${n4(hc.p)}`}</Tex>，<Tex>{'\\sigma_\\eta^2=1/4096'}</Tex>。白雜訊的 <Tex>{'\\sigma_w'}</Tex> 再乘上
        放大因子的平方根 <Tex>{'\\sqrt{(1+p\\rho)/(1-p\\rho)}'}</Tex>：
      </p>
      <div className="table-wrap">
        <table aria-label="先算一次：T13 條件下三種相關係數的係數雜訊">
          <thead>
            <tr>
              <th>
                <Tex>{'\\rho'}</Tex>
              </th>
              <th>
                <Tex>{'p\\rho'}</Tex>
              </th>
              <th>
                <Tex>{'\\frac{1+p\\rho}{1-p\\rho}'}</Tex>
              </th>
              <th>
                <Tex>{'\\sigma_w\\ [\\mathrm{fs}]'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {hc.rows.map((r) => (
              <tr key={r.rho}>
                <td>{r.rho}</td>
                <td>{n4(r.pr)}</td>
                <td>{n4(r.factor)}</td>
                <td>{n4(r.sigmaW)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        表中每個數字都由 <code>sigmaW2Colored</code> 即時計算。<Tex>{'\\rho=0'}</Tex> 那一列就是第 12 章的 0.399 fs（T13）；它是 gain-equivalent noise，不是 output jitter。
      </p>

      <StepDerivation
        title={mt(String.raw`一步一步推導：AR(1) 雜訊下的 $\sigma_w^2$（$\delta w=w-w^*$）`)}
        steps={[
          { tex: String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k,\qquad p=1-\mu K`, why: <>第 12 章的線性化遞迴（F-12.2）；極性 <Tex>{'\\delta w=w-w^*'}</Tex>（勘誤 E33）。</> },
          { tex: String.raw`\delta w_k=\mu\sum_{i=0}^{\infty}p^{i}\,\eta_{k-1-i}`, why: <>把遞迴反覆代入自己；<Tex>{'|p|<1'}</Tex> 時初值的影響 <Tex>{'p^k\\delta w_0\\to0'}</Tex>。</> },
          { tex: String.raw`E[\delta w_k^2]=\mu^2\sum_{i=0}^{\infty}\sum_{j=0}^{\infty}p^{i}p^{j}\,E[\eta_{k-1-i}\eta_{k-1-j}]`, why: '平方展開成雙重和，再取期望值（期望值是線性的，可以和加總交換）。' },
          { tex: String.raw`=\mu^2\sigma_\eta^2\sum_{i,j\ge0}p^{i+j}\rho^{|i-j|}`, why: <>代入 AR(1) 的自相關 <Tex>{'R_\\eta[i-j]=\\sigma_\\eta^2\\rho^{|i-j|}'}</Tex>。</> },
          { tex: String.raw`\sum_{i\ge0}p^{2i}=\frac1{1-p^2}`, why: <>對角項 <Tex>{'i=j'}</Tex>：公比 <Tex>{'p^2'}</Tex> 的等比級數。</> },
          { tex: String.raw`2\sum_{i\ge0}\sum_{m\ge1}p^{2i+m}\rho^{m}=\frac{2}{1-p^2}\cdot\frac{p\rho}{1-p\rho}`, why: <>非對角項令 <Tex>{'j=i+m'}</Tex>（<Tex>{'i>j'}</Tex> 的另一半對稱，所以乘 2）；兩個獨立的等比級數相乘。</> },
          { tex: String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\Big(1+\frac{2p\rho}{1-p\rho}\Big)`, why: '對角 + 非對角。' },
        ]}
        result={String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{1+p\rho}{1-p\rho}\qquad(\text{F-R1.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 在線性化模型、AR(1) 雜訊下精確。<Tex>{'p\\rho>0'}</Tex>（迴路慢、雜訊同號相關）時放大；<Tex>{'p\\rho<0'}</Tex> 時縮小。
        <Tex>{'p\\to1'}</Tex> 的極限下因子變成 <Tex>{'(1+\\rho)/(1-\\rho)'}</Tex>，正好是「有效獨立樣本數」縮小的倍數。
        同一個封閉式在 <PageRef id="ch12">第 12 章</PageRef> §12.4 的 Research 框以「變異數遞迴的交叉項」推得（那裡把相關係數記作 <Tex>{'r'}</Tex>；本頁 R7 的觀測 pole 記作 <Tex>{'r_s'}</Tex>，為了不混淆，這裡把相關係數改記 <Tex>{'\\rho'}</Tex>）。
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.1')} />
      <p>
        同一個量也能寫成狀態空間：<Tex>{String.raw`\mathbf s_k=[\delta w_k,\ \eta_k]^T`}</Tex>、
        <Tex>{String.raw`\mathbf A=\begin{bmatrix}p&\mu\\0&\rho\end{bmatrix}`}</Tex>，穩態共變異滿足離散 Lyapunov 方程 <Tex>{String.raw`\mathbf P=\mathbf A\mathbf P\mathbf A^T+\mathbf Q`}</Tex>（F-R1.2）。
        這是 R1 真正需要的工具：量測到的 <Tex>{'S_\\eta'}</Tex> 若能用有限階 ARMA 表示，就把它的狀態串在後面，同一條方程算出 <Tex>{'\\sigma_w^2'}</Tex>。
      </p>
      <TexBlock>{String.raw`\mathbf P=\mathbf A\mathbf P\mathbf A^{T}+\mathbf Q\iff(\mathbf I-\mathbf A\otimes\mathbf A)\,\mathrm{vec}(\mathbf P)=\mathrm{vec}(\mathbf Q)`}</TexBlock>

      <R1Experiment />
      <TryIt
        items={[
          String.raw`把 Case A 的 $\rho$ 拉到 0.9：$\sigma_w$ 放大到約白雜訊的 $\sqrt{(1+0.9p)/(1-0.9p)}$ 倍，PSD 的低頻抬高。`,
          String.raw`按「＋ Case B」並設 $\rho=-0.5$：同號相關放大、反號相關縮小，兩個 MC 點都落在同一條封閉式曲線上。`,
          String.raw`把 $\mu$ 拉到 300 fs（$g>2$）：會出現不穩定的警告，因為根本沒有穩態變異數。`,
          String.raw`把 $\mu$ 降到 0.05 fs：迴路的時間常數超過 burn-in 上限，Monte Carlo 欄位改成 n/a——有限長度的模擬不能拿來判定很慢的迴路。`,
        ]}
      />
      <Observe>
        四種算法（封閉式、Lyapunov、Monte Carlo、PSD 積分）在同一組參數下給出同一個 <Tex>{'\\sigma_w^2'}</Tex>；真正的研究工作是取得可信的 <Tex>{'S_\\eta'}</Tex>，以及把 <Tex>{'\\delta w'}</Tex> 與直接 PD noise 的 cross-spectrum 一起帶進 output jitter。
      </Observe>

      <h4>{mt(String.raw`核心程式碼：同一個 $\sigma_w^2$，三種算法`)}</h4>
      <CodeCompare
        items={[
          { label: '封閉式', source: modelSrc, region: 'sigmaWColored', path: PATH, note: String.raw`白雜訊結果乘上 $\frac{1+p\rho}{1-p\rho}$。` },
          { label: 'Lyapunov', source: modelSrc, region: 'sigmaWLyapunov', path: PATH, note: String.raw`把 $\eta$ 也當成狀態，解 $\mathbf P=\mathbf A\mathbf P\mathbf A^T+\mathbf Q$。` },
          { label: 'Monte Carlo', source: modelSrc, region: 'sigmaWMonteCarlo', path: PATH, note: '直接跑遞迴，多條 chain 求 CI。' },
        ]}
      />
      <ModeGate min="research">
        <h4>Research：頻域驗算與適用範圍</h4>
        <p>
          頻域上 <Tex>{String.raw`\sigma_w^2=\frac1{2\pi}\int_{-\pi}^{\pi}\frac{\mu^2}{|1-pe^{-j\Omega}|^2}\cdot\frac{\sigma_\eta^2(1-\rho^2)}{|1-\rho e^{-j\Omega}|^2}d\Omega`}</Tex>，以留數定理算出同一個封閉式（上方實驗的 Parseval 欄位即其數值版）。
          <ErratumNote eid="E28">{String.raw`PSD 由 DTFT 形式換成單邊 per-Hz 時要乘 $2/f_u$。`}</ErratumNote>
        </p>
        <ul>
          <li><Tex>{'\\rho'}</Tex> 的物理來源（研究假說 <ClaimTag kind="research" />）：遲滯或 metastability 讓相鄰決策相關（R6）；block 長度 <Tex>{'N'}</Tex> 與主迴路時間常數相當時，PD 殘差在 block 之間相關；DSM 相關的確定性殘差。</li>
          <li>Sign-LMS 的真實 <Tex>{'\\eta'}</Tex> 不是 Gaussian、也不一定是 AR(1)；本預覽只說明「方法」，不是量測結論。</li>
          <li>
            <ErratumNote eid="E29">{String.raw`$S_w$ 定義在 block rate；要接到 DTC 的 sample rate 需經 ZOH（見 R2）。`}</ErratumNote>
          </li>
        </ul>
      </ModeGate>
      <KvTable
        caption="與第 12 章的關係"
        rows={[
          ['第 12 章（已有）', String.raw`白色 $\eta$：$\sigma_w$、$S_w$、$-3$ dB 與 ENBW（T13 / T14）；AR(1) 特例的封閉式（§12.4 Research 框、LMS Noise Lab 的 $r$ 控制項）`],
          ['本預覽', String.raw`同一個 $\sigma_w^2$ 的四方比對：封閉式、狀態空間 + Lyapunov、Monte Carlo（A / B / C 比較）、PSD 積分`],
          ['R1 待辦', String.raw`量測 / 模擬真實的 $S_\eta$、cross-spectrum、output jitter 預算`],
        ]}
      />
    </div>
  )
}
