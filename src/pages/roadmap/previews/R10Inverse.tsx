import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  ClaimTag,
  CodeBlock,
  ExperimentShell,
  HandCalc,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { inverseDesign, T13_SIGMA_W_FS } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r10-inverse'
const PATH = 'src/pages/roadmap/model.ts'

interface R10Params {
  sigmaV: number
  C: number
  fs: number
  sigmaWMax: number
  tMaxUs: number
  eps: number
  delta0: number
  pmMinDeg: number
}

const DEFAULTS: R10Params = { sigmaV: 100, C: 1, fs: 4e9, sigmaWMax: 0.5, tMaxUs: 200, eps: 0.01, delta0: 20, pmMinDeg: 60 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'T13 條件、σ_w ≤ 0.5 fs、200 µs', params: { ...DEFAULTS } },
  { name: '規格太嚴：σ_w ≤ 0.15 fs', params: { ...DEFAULTS, sigmaWMax: 0.15 }, description: '低於 tanh 律在掃描範圍內的最小值 ⇒ 任何 N 都不可行' },
  { name: '介於兩者：σ_w ≤ 0.2 fs', params: { ...DEFAULTS, sigmaWMax: 0.2 }, description: '低於多 block 極限，只剩很少、很長的 block 可行' },
  { name: '大初始誤差 δ0 = 2000 fs', params: { ...DEFAULTS, delta0: 2000 }, description: 'sign-LMS 的 slew 限制淘汰大 N' },
  { name: '時間很短 T_max = 20 µs', params: { ...DEFAULTS, tMaxUs: 20 } },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_SIGMA: Partial<Layout> = { xaxis: { title: { text: '$N$（GMAC 長度）' } }, yaxis: { title: { text: '$\\sigma_w$ [fs]' } } }
const LAYOUT_MU: Partial<Layout> = { xaxis: { title: { text: '$N$' } }, yaxis: { title: { text: '$\\mu$ [fs]' } } }

function R10Experiment() {
  const [P, setP] = useState<R10Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const res = useMemo(
    () =>
      inverseDesign({
        sigmaV: dP.sigmaV,
        C: dP.C,
        fs: dP.fs,
        sigmaWMax: dP.sigmaWMax,
        tMax: dP.tMaxUs * 1e-6,
        eps: dP.eps,
        delta0: dP.delta0,
        pmMinDeg: dP.pmMinDeg,
        log2Nmin: 4,
        log2Nmax: 18,
      }),
    [dP],
  )
  const feasible = res.rows.filter((r) => r.feasible)
  const checkT13 = Math.sqrt((10 * res.K) / (res.K * res.K * 4096 * (2 - 10 * res.K)))
  const atT13 = dP.sigmaV === 100 && dP.C === 1 // 只有在 T13 的 σ_v、C 下才有參考值可比

  const minCont = Math.min(...res.rows.filter((r) => r.Bmax >= 1).map((r) => r.sigmaWContinuous))
  const warnings: string[] = []
  if (!feasible.length) {
    warnings.push(
      dP.sigmaWMax < minCont
        ? String.raw`沒有任何 $N$（$2^4$ 到 $2^{18}$）可行：$\sigma_{w,\max}=${dP.sigmaWMax}$ fs 低於 tanh 律在此範圍內的最小值 ${n4(minCont)} fs（多 block 極限 ${n4(res.floorMany)} fs）。在這個 $N$ 範圍內固定 $\mu$ 做不到；需要更長 $T_{\max}$、更小 $\sigma_v$、更大 $C$，或改用步長排程（$1/k$ 排程不論 $N$ 都能達到一次平均的 ${n4(res.floorOneShot)} fs，見第 14 章）。`
        : '沒有任何 $N$ 可行：見表中每一列的失敗原因（slew / 時間 / PM）。',
    )
  } else if (dP.sigmaWMax < res.floorMany) {
    warnings.push(
      String.raw`$\sigma_{w,\max}=${dP.sigmaWMax}$ fs 低於多 block 極限 ${n4(res.floorMany)} fs：只剩 block 數很少（$B_{\max}$ 小、$g$ 大）的設計可行——它們靠的是「接近一次平均」，對 $K$ 的誤差、非線性與 PVT 漂移都更敏感。`,
    )
  }
  if (dP.delta0 / dP.sigmaV > 0.3)
    warnings.push(String.raw`$|\delta_0|/\sigma_v=${n4(dP.delta0 / dP.sigmaV)}>0.3$：大誤差時 sign-LMS 不再線性（$E[G]$ 飽和在 $\pm1$），時間下界只是必要條件，實際收斂更慢（勘誤 E48）。`)

  const metrics: MetricRow[] = [
    { name: '$K=K_qC$', value: res.K, unit: String.raw`$\mathrm{fs}^{-1}$` },
    { name: String.raw`總比較次數 $f_sT_{\max}$`, value: dP.fs * dP.tMaxUs * 1e-6, unit: 'samples' },
    { name: String.raw`多 block 極限 $\sqrt{L_\varepsilon/(2K^2f_sT)}$`, value: res.floorMany, unit: 'fs', formulaId: 'F-R10.1', claim: 'approx' },
    { name: String.raw`一次平均 $1/(K\sqrt{f_sT})$`, value: res.floorOneShot, unit: 'fs', claim: 'approx', note: String.raw`把 $f_sT$ 個樣本平均一次（$N=f_sT$、$g=1$）；固定 $\mu$ 的 tanh 律只在 $B\to1$ 時才接近它` },
    { name: '可行的 $N$ 數', value: feasible.length, unit: `/ ${res.rows.length}` },
    { name: String.raw`最小可達 $\sigma_w$（可行列）`, value: res.best ? res.best.sigmaWAtLo : '無', unit: 'fs', note: res.best ? `$N=${res.best.N}$` : undefined },
    {
      name: String.raw`驗算：T13（$\mu=10$ fs、$N=4096$）的 $\sigma_w$`,
      value: checkT13,
      unit: 'fs',
      analytic: atT13 ? T13_SIGMA_W_FS : undefined,
      tolerance: atT13 ? 1e-9 : undefined,
      note: atT13 ? String.raw`與 golden T13 的 $\sigma_w$ 比對` : String.raw`目前的 $\sigma_v$、$C$ 不是 T13 的條件（100 fs、1）：只顯示數值，不比對`,
    },
  ]

  const Ns = useMemo(() => res.rows.map((r) => r.N), [res])
  const sigmaData: Data[] = useMemo(
    () => [
      { x: Ns, y: res.rows.map((r) => (r.feasible ? r.sigmaWAtLo : null)), name: '可行：$\\sigma_w$ @ $g_{\\mathrm{lo}}$（整數 $B$）', mode: 'lines+markers', marker: { size: 6 }, line: { color: tokens.series[0] } },
      { x: Ns, y: res.rows.map((r) => (!r.feasible && Number.isFinite(r.sigmaWAtLo) ? r.sigmaWAtLo : null)), name: '不可行列', mode: 'markers', marker: { size: 7, symbol: 'x', color: tokens.series[3] } },
      { x: Ns, y: res.rows.map((r) => r.sigmaWContinuous), name: 'tanh 律（連續 $B$）', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: [Ns[0], Ns[Ns.length - 1]], y: [dP.sigmaWMax, dP.sigmaWMax], name: '$\\sigma_{w,\\max}$（規格）', mode: 'lines', line: { color: tokens.text, dash: 'dot' } },
      { x: [Ns[0], Ns[Ns.length - 1]], y: [res.floorMany, res.floorMany], name: '多 block 極限', mode: 'lines', line: { color: tokens.textMuted } },
      { x: [Ns[0], Ns[Ns.length - 1]], y: [res.floorOneShot, res.floorOneShot], name: '一次平均（$N = f_sT$、$g = 1$）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dashdot' } },
    ],
    [Ns, res, dP.sigmaWMax, tokens],
  )
  const muData: Data[] = useMemo(
    () => [
      { x: Ns, y: res.rows.map((r) => (r.feasible ? r.muLo : null)), name: '$\\mu$ 下界（時間 / slew）', mode: 'lines+markers', marker: { size: 5 }, line: { color: tokens.series[0] } },
      { x: Ns, y: res.rows.map((r) => (r.feasible ? r.muHi : null)), name: '$\\mu$ 上界（雜訊 / PM）', mode: 'lines+markers', marker: { size: 5 }, line: { color: tokens.series[2] }, fill: 'tonexty' },
    ],
    [Ns, res, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`R10 預覽：由 $T_{\max}$、$\sigma_{w,\max}$、$\varepsilon$、$\delta_0$、PM 反推 $(N,\mu)$`}
      level="L1"
      claim="approx"
      description={<>單一參數、線性一階模型；每個 <Tex>{'N=2^k'}</Tex> 算出 <Tex>{'g=\\mu K'}</Tex> 的可行區間 <Tex>{'[g_{\\mathrm{lo}},g_{\\mathrm{hi}}]'}</Tex>，並取 <Tex>{'g_{\\mathrm{lo}}'}</Tex>（雜訊最小）的 <Tex>{'\\sigma_w'}</Tex>。</>}
      assumptions={[
        String.raw`$x=\pm1$（$C=E[x\,u]$）、average-mode GMAC、$\sigma_\eta^2=1/N$、Gaussian comparator 小訊號 $K=K_qC$`,
        String.raw`平均誤差 $(1-g)^B|\delta_0|\le\varepsilon|\delta_0|$（$\varepsilon$ 為相對比例，勘誤 E16）；$B$ 取整數 $\lfloor f_sT_{\max}/N\rfloor$`,
        String.raw`sign-LMS 每 block 最多走 $\mu$（$|E[G]|\le1$），所以 slew 下界是 $\mu B\ge|\delta_0|$（必要條件）`,
        String.raw`一階 $L=g/(z-1)$、無更新延遲：$PM\ge PM_{\min}\iff g\le2\cos PM_{\min}$`,
        '未含 spur / jitter budget、多 corner、多參數（R10 待辦）',
      ]}
      params={{ ...P }}
      units={{ sigmaV: 'fs', fs: 'Hz', sigmaWMax: 'fs', tMaxUs: 'µs', delta0: 'fs', pmMinDeg: 'deg' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: res.rows.every((r) => !r.feasible || r.gLo !== r.gTime || r.sigmaWAtLo >= r.sigmaWContinuous * (1 - 1e-12)) ? 'ok' : 'mismatch', note: String.raw`整數 $B$ 的 $\sigma_w$ 不小於連續的 tanh 律` },
        monteCarlo: 'not-implemented',
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({
        N: Ns,
        Bmax: res.rows.map((r) => r.Bmax),
        g_lo: res.rows.map((r) => r.gLo),
        g_hi: res.rows.map((r) => r.gHi),
        mu_lo_fs: res.rows.map((r) => r.muLo),
        mu_hi_fs: res.rows.map((r) => r.muHi),
        sigma_w_at_lo_fs: res.rows.map((r) => r.sigmaWAtLo),
        feasible: res.rows.map((r) => (r.feasible ? 1 : 0)),
      })}
      controls={
        <>
          <ParamControl {...pl(String.raw`$\sigma_v$`, 'sigma_v')} value={P.sigmaV} onChange={(v) => setP({ ...P, sigmaV: v })} min={1} max={1000} log unit="fs" reg="Behavioral：comparator noise" />
          <ParamControl {...pl('$C$（code 相關）', 'C（code 相關）')} value={P.C} onChange={(v) => setP({ ...P, C: v })} min={0.01} max={2} step={0.01} unit="—" reg="Behavioral：C = E[x·u]" />
          <ParamControl {...pl('$f_s$', 'f_s')} value={P.fs} onChange={(v) => setP({ ...P, fs: v })} min={1e8} max={2e10} log unit="Hz" reg="Behavioral：f_ref" />
          <ParamControl {...pl(String.raw`$\sigma_{w,\max}$（規格）`, 'sigma_w,max（規格）')} value={P.sigmaWMax} onChange={(v) => setP({ ...P, sigmaWMax: v })} min={0.01} max={20} log unit="fs" reg="Spec：gain-equivalent noise 上限" />
          <ParamControl {...pl(String.raw`$T_{\max}$（規格）`, 'T_max（規格）')} value={P.tMaxUs} onChange={(v) => setP({ ...P, tMaxUs: v })} min={0.1} max={100000} log unit={String.raw`$\mu\mathrm{s}$`} reg="Spec：校正時間上限" />
          <ParamControl {...pl(String.raw`$\varepsilon$（平均誤差縮減比）`, 'epsilon（平均誤差縮減比）')} value={P.eps} onChange={(v) => setP({ ...P, eps: v })} min={1e-6} max={0.5} log unit="—" reg="Spec：相對比例（勘誤 E16）" />
          <ParamControl {...pl(String.raw`$|\delta_0|$（初始誤差）`, 'delta_0（初始誤差）')} value={P.delta0} onChange={(v) => setP({ ...P, delta0: v })} min={0.01} max={10000} log unit="fs" reg="Spec：上電 / PVT 跳變" />
          <ParamControl {...pl(String.raw`$PM_{\min}$`, 'PM_min')} value={P.pmMinDeg} onChange={(v) => setP({ ...P, pmMinDeg: v })} min={1} max={89} step={1} unit="deg" reg="Design：calibration PM" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title={String.raw`可達到的 $\sigma_w$ vs $N$（取 $g_{\mathrm{lo}}$）`} data={sigmaData} xLog yLog layout={LAYOUT_SIGMA} height={300} csvName="r10-sigma-w" />
        <Plot title={String.raw`$\mu$ 的可行帶 vs $N$`} data={muData} xLog yLog layout={LAYOUT_MU} height={300} csvName="r10-mu-band" />
      </div>
      <div className="table-wrap">
        <table className="rm-r10-table">
          <thead>
            <tr>
              <th>
                <Tex>{'N'}</Tex>
              </th>
              <th>
                <Tex>{'f_u'}</Tex>
              </th>
              <th>
                <Tex>{'B_{\\max}'}</Tex>
              </th>
              <th>
                <Tex>{'g_{\\mathrm{lo}}'}</Tex>
              </th>
              <th>
                <Tex>{'g_{\\mathrm{hi}}'}</Tex>
              </th>
              <th>{mt(String.raw`$\mu$ 區間 [fs]`)}</th>
              <th>
                <Tex>{'\\sigma_w(g_{\\mathrm{lo}})'}</Tex> [fs]
              </th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.N} data-feasible={r.feasible}>
                <td>{r.N}</td>
                <td className="nowrap">{n4(r.fu / 1e3)} kHz</td>
                <td>{r.Bmax}</td>
                <td>{n4(r.gLo)}</td>
                <td>{n4(r.gHi)}</td>
                <td className="nowrap">{r.feasible ? `${n4(r.muLo)} – ${n4(r.muHi)}` : '—'}</td>
                <td>{n4(r.sigmaWAtLo)}</td>
                <td>{r.feasible ? '可行' : mt(r.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ExperimentShell>
  )
}

export default function R10Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="指數、對數與 tanh">
        <p>
          <Tex>{'\\varepsilon^u=e^{u\\ln\\varepsilon}=e^{-uL_\\varepsilon}'}</Tex>，其中 <Tex>{'L_\\varepsilon=\\ln(1/\\varepsilon)'}</Tex>（<Tex>{'\\varepsilon=0.01'}</Tex> 時約 4.6）。
          雙曲正切 <Tex>{'\\tanh y=\\frac{e^{y}-e^{-y}}{e^{y}+e^{-y}}=\\frac{1-e^{-2y}}{1+e^{-2y}}'}</Tex>；泰勒展開 <Tex>{'\\tanh y=y-y^3/3+\\dots'}</Tex>，所以 <Tex>{'\\tanh(y)/y\\le1'}</Tex>、且 <Tex>{'y\\to0'}</Tex> 時趨近 1。
        </p>
      </Prereq>
      <StepDerivation
        title={mt(String.raw`一步一步推導：固定 $\mu$ 時，$\sigma_w$ 與校正時間的取捨（tanh 律）`)}
        steps={[
          { tex: String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{g}{K^2N(2-g)}`, why: <>第 12 章的白雜訊結果，<Tex>{'\\sigma_\\eta^2=1/N'}</Tex>、<Tex>{'\\mu=g/K'}</Tex>、<Tex>{'1-p^2=g(2-g)'}</Tex>。</> },
          { tex: String.raw`|E[\delta_B]|=(1-g)^B|\delta_0|\le\varepsilon|\delta_0|`, why: <>線性模型的平均誤差；<Tex>{'\\varepsilon'}</Tex> 是相對比例（勘誤 E16）。</> },
          { tex: String.raw`B=\frac{f_sT}{N}\;\Rightarrow\;u:=\frac{N}{f_sT}=\frac1B`, why: <>時間全部用完：每個 block <Tex>{'N'}</Tex> 個 comparator sample。</> },
          { tex: String.raw`g=1-\varepsilon^{u}`, why: <><Tex>{'\\sigma_w^2'}</Tex> 隨 <Tex>{'g'}</Tex> 遞增，所以取剛好滿足時間的最小 <Tex>{'g'}</Tex>。</> },
          { tex: String.raw`\sigma_w^2=\frac{1-\varepsilon^u}{K^2N(1+\varepsilon^u)}=\frac{\tanh(uL_\varepsilon/2)}{K^2N}`, why: <><Tex>{'2-g=1+\\varepsilon^u'}</Tex>；<Tex>{'(1-e^{-x})/(1+e^{-x})=\\tanh(x/2)'}</Tex>。</> },
          { tex: String.raw`=\frac{L_\varepsilon}{2K^2f_sT}\cdot\frac{\tanh y}{y},\qquad y=\frac{uL_\varepsilon}{2}=\frac{NL_\varepsilon}{2f_sT}`, why: <>代入 <Tex>{'N=uf_sT'}</Tex>，分子分母同乘 <Tex>{'L_\\varepsilon/2'}</Tex>。</> },
        ]}
        result={String.raw`\sigma_{w,\min}^2(N)=\frac{L_\varepsilon}{2K^2f_sT}\cdot\frac{\tanh y}{y}\ \le\ \frac{\ln(1/\varepsilon)}{2K^2f_sT}\qquad(\text{F-R10.1})`}
      />
      <p>
        <ClaimTag kind="approx" /> 結論：在線性模型裡，<Tex>{'N'}</Tex> 只透過 <Tex>{'\\tanh(y)/y'}</Tex> 影響 <Tex>{'\\sigma_w'}</Tex>；多 block（小 <Tex>{'y'}</Tex>）時幾乎與 <Tex>{'N'}</Tex> 無關，
        所以規格的第一個可行性檢查是 <Tex>{'\\sigma_{w,\\max}^2\\ge\\ln(1/\\varepsilon)/(2K^2f_sT_{\\max})'}</Tex>。
        <Tex>{'N'}</Tex> 的選擇改由其他約束決定：slew（sign-LMS 每 block 最多走 <Tex>{'\\mu'}</Tex>）、PM、PE 窗口、tracking（R8）與硬體位寬（R9）。
        另一個極端是把全部 <Tex>{'f_sT'}</Tex> 個樣本平均一次（<Tex>{'N=f_sT'}</Tex>、<Tex>{'g=1'}</Tex>）：<Tex>{'\\sigma_w^2=1/(K^2f_sT)'}</Tex>，比多 block 極限小 <Tex>{'L_\\varepsilon/2'}</Tex> 倍（<Tex>{'\\varepsilon=0.01'}</Tex> 時 {n4(Math.log(100) / 2)} 倍）。
        固定 <Tex>{'\\mu'}</Tex> 只有在 block 很少（<Tex>{'y\\to L_\\varepsilon/2'}</Tex>，即 <Tex>{'B\\to1'}</Tex>）時才沿 tanh 律接近它；<PageRef id="ch14">第 14 章</PageRef>的 <Tex>{'1/k'}</Tex> 步長排程則不論 <Tex>{'N'}</Tex> 都能達到。
        注意這裡的 <Tex>{'\\sigma_w'}</Tex> 是「以這個 <Tex>{'g'}</Tex> 持續背景追蹤」的穩態值；<Tex>{'T_{\\max}'}</Tex> 只約束收斂時間，兩者是分開的規格。
        <ErratumNote eid="E16">{String.raw`$\varepsilon$ 必須是相對比例；以 fs 絕對值輸入會讓下界變成 0。`}</ErratumNote>
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.10')} />
      <R10Experiment />
      <TryIt
        items={[
          <>預設下 <Tex>{'N\\le2^{14}'}</Tex>（block 很多）的 <Tex>{'\\sigma_w(g_{\\mathrm{lo}})'}</Tex> 幾乎一樣——這就是 tanh 律的平坦區；只有最大的幾個 <Tex>{'N'}</Tex>（<Tex>{'B_{\\max}'}</Tex> 只剩個位數）才沿 <Tex>{'\\tanh(y)/y'}</Tex> 稍微下降。</>,
          <>把 <Tex>{'\\sigma_{w,\\max}'}</Tex> 降到 0.2 fs：只剩最大的 <Tex>{'N'}</Tex>（很少的 block）可行；降到 0.15 fs 則全部失敗。</>,
          <>把 <Tex>{'|\\delta_0|'}</Tex> 拉到 2000 fs：大 <Tex>{'N'}</Tex>（block 少）被 slew 淘汰，同時出現「非線性區」警告。</>,
        ]}
      />
      <Observe>
        規格反推不是找「一個好 <Tex>{'\\mu'}</Tex>」，而是先確認可行集合非空；R10 的待辦是把 spur limit、PN / jitter budget（經 <Tex>{'T(f)'}</Tex> 與 code 混頻）、多 corner、多參數與面積功耗都放進同一個可行性問題。
      </Observe>
      <h4>核心程式碼</h4>
      <CodeBlock source={modelSrc} region="inverseDesign" path={PATH} caption="每個 $N$：兩個下界（時間、slew）與兩個上界（雜訊、PM）。" />
      <ModeGate min="research">
        <h4>Research：還沒放進來的約束</h4>
        <ul>
          <li>
            Spur：係數雜訊經 code 混頻後的 PSD（<PageRef id="ch12">第 12 章</PageRef>）乘上 <Tex>{'(2\\pi f_{\\mathrm{out}})^2|T(f)|^2'}</Tex> 再與 PN mask 比較；量化 limit cycle 的譜線（R3）另計。
          </li>
          <li>多 corner：<Tex>{'K^{(c)}'}</Tex> 在各 corner 不同，<Tex>{'\\mu'}</Tex> 必須同時滿足所有 corner（第 14 章的 corner-based 區間）。</li>
          <li>更新延遲 <Tex>{'d>0'}</Tex>：PM 條件變成 <Tex>{'(2d+1)\\arcsin(g/2)\\le90^\\circ-PM_{\\min}'}</Tex>。<ClaimTag kind="research" /></li>
        </ul>
      </ModeGate>
    </div>
  )
}
