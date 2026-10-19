import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, TexBlock, useThemeTokens, type CsvColumns, type ExperimentPreset, type MetricRow } from '@/components'
import { useUrlPreset } from '@/app/presets'
import type { Matrix } from '@/simulation/core'
import { kq, runTwoParamCheck, secantRatio, type TwoParamParams } from '../judges'
import { Verdict, nf, rich, tx, usePresetList } from '../shared'

export const SSPLL_EXPERIMENT_ID = 'signoff-sspll-jacobian'

export const SSPLL_DEFAULT: TwoParamParams = {
  rho: 0.3,
  cG: 1,
  cP: 0.8,
  sigmaV: 100,
  aG: 0,
  aP: 0,
  wG: 0,
  wP: 0,
  deltaG: 20,
  deltaP: 20,
  N: 2048,
  M: 12,
  muG: 10,
  muP: 10,
  z: 3,
  seed: 20261010,
}

const LOCAL_PRESETS: ExperimentPreset[] = [
  { name: '正常：GOS、PHOS 極性都正確', params: { ...SSPLL_DEFAULT } },
  { name: 'PHOS 路徑變號（c_P < 0）：PHOS loop 單獨就發散', description: '例如某個 SSPLL mode 下 PMUX 相位步階經 sub-sampling PD 以相反符號出現', params: { ...SSPLL_DEFAULT, cP: -0.8 } },
  {
    name: '強耦合 + 大步長：各自穩定、一起更新發散',
    description: 'ρ_GP = 0.7、μK_qc = 1.3：對角 pole 1 − 1.3 = −0.3（穩定），但聯合 eigenvalue 1 − 1.3·(1 + 0.7) = −1.21 < −1；σ_min = 0.3K_q 仍高於量測門檻（約 1.8 倍，可辨識）',
    params: { ...SSPLL_DEFAULT, rho: 0.7, cP: 1, muG: 1.3 / kq(100), muP: 1.3 / kq(100) },
  },
  { name: '不可辨識：ρ_GP = 0.995', description: 'GOS 與 PHOS regressor 幾乎相同：σ_min(Ĵ) → 0', params: { ...SSPLL_DEFAULT, rho: 0.995, cP: 1 } },
]

const POLE_LAYOUT = { xaxis: { title: { text: '$\\mathrm{Re}\\,z$' }, scaleanchor: 'y' as const, range: [-1.6, 1.6] }, yaxis: { title: { text: '$\\mathrm{Im}\\,z$' }, range: [-1.3, 1.3] } }

function MatrixTex({ A, digits = 4 }: { A: Matrix; digits?: number }) {
  return <Tex>{`\\begin{bmatrix}${A.map((r) => r.map((v) => tx(v, digits)).join('&')).join('\\\\')}\\end{bmatrix}`}</Tex>
}

export function SspllJacobianExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<TwoParamParams>(SSPLL_DEFAULT)
  const presets = usePresetList(SSPLL_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(SSPLL_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setP({ ...SSPLL_DEFAULT, ...(urlPreset.params as Partial<TwoParamParams>) })
  }, [urlPreset])
  const set = <K extends keyof TwoParamParams>(k: K, v: TwoParamParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDeferredValue(p)
  const { res, error } = useMemo(() => {
    try {
      return { res: runTwoParamCheck(dp), error: null as string | null }
    } catch (e) {
      return { res: null, error: (e as Error).message }
    }
  }, [dp])

  const warnings = error ? [error] : (res?.warnings ?? [])
  const unit: Data = useMemo(() => {
    const th = Array.from({ length: 181 }, (_, i) => (2 * Math.PI * i) / 180)
    return { x: th.map(Math.cos), y: th.map(Math.sin), mode: 'lines', name: 'unit circle', line: { color: tokens.textMuted, width: 1 }, hoverinfo: 'skip' }
  }, [tokens])
  const poles: Data[] = useMemo(
    () =>
      res
        ? [
            unit,
            { x: res.eigA.map((z) => z.re), y: res.eigA.map((z) => z.im), mode: 'markers', name: '聯合 $\\mathrm{eig}(\\mathbf I + \\mathbf M\\hat{\\mathbf J})$', marker: { size: 12, symbol: 'x', color: tokens.series[1] } },
            { x: res.diagPoles, y: res.diagPoles.map(() => 0), mode: 'markers', name: '單獨更新 $1 + \\mu_i\\hat J_{ii}$', marker: { size: 10, symbol: 'circle-open', color: tokens.series[0], line: { width: 2 } } },
          ]
        : [unit],
    [res, unit, tokens],
  )

  const k = kq(p.sigmaV)
  const metrics: MetricRow[] = res
    ? [
        { name: String.raw`$\hat J_{GG}$（量測）`, value: res.Jhat[0][0], unit: '$\\mathrm{fs}^{-1}$', analytic: res.JmeanField[0][0], tolerance: 4 * res.Jse[0][0], claim: 'approx', formulaId: 'F-SO.6' },
        { name: String.raw`$\hat J_{GP}$`, value: res.Jhat[0][1], unit: '$\\mathrm{fs}^{-1}$', analytic: res.JmeanField[0][1], tolerance: 4 * res.Jse[0][1], claim: 'approx' },
        { name: String.raw`$\hat J_{PG}$`, value: res.Jhat[1][0], unit: '$\\mathrm{fs}^{-1}$', analytic: res.JmeanField[1][0], tolerance: 4 * res.Jse[1][0], claim: 'approx' },
        { name: String.raw`$\hat J_{PP}$（量測）`, value: res.Jhat[1][1], unit: '$\\mathrm{fs}^{-1}$', analytic: res.JmeanField[1][1], tolerance: 4 * res.Jse[1][1], claim: 'approx', formulaId: 'F-SO.6' },
        { name: String.raw`$\rho(\mathbf I+\mathbf M\hat{\mathbf J})$（聯合）`, value: res.rhoA, claim: 'exact', formulaId: 'F-SO.7', note: String.raw`$<1$ 才穩定（以量測 $\hat{\mathbf J}$ 計算）` },
        {
          name: String.raw`$\sigma_{\min}(\hat{\mathbf J})$（可辨識性）`,
          value: res.singularValues[1],
          unit: '$\\mathrm{fs}^{-1}$',
          claim: 'approx',
          formulaId: 'F-SO.6',
          note: `門檻 $z\\,\\|\\mathrm{se}\\|_F=${tx(res.sigmaMinThreshold, 3)}\\,\\mathrm{fs}^{-1}$（Weyl：$|\\sigma_{\\min}(\\hat{\\mathbf J})-\\sigma_{\\min}(\\mathbf J)|\\le\\|\\hat{\\mathbf J}-\\mathbf J\\|_F$）；高於門檻才算顯著 $>0$`,
        },
        { name: String.raw`$\sigma_{\min}/\sigma_{\max}$ of $\hat{\mathbf J}$`, value: res.singularValues[1] / res.singularValues[0], note: String.raw`$=1/\kappa(\hat{\mathbf J})$；越小，慢模式越慢、preconditioner 的雜訊放大越大` },
        { name: '使用的 sample 數', value: res.samplesUsed, digits: 8 },
      ]
    : []
  const mcOk = res ? [0, 1].every((i) => [0, 1].every((j) => Math.abs(res.Jhat[i][j] - res.JmeanField[i][j]) <= 4 * res.Jse[i][j])) : false
  // Analytic 交叉比對（真的算）：在 w = a 處，精確 mean-field 的中央差分應等於小訊號 J_lin 乘上 F-SO.2 的截斷比 r_CD(Δ_j|c_j|)——
  // 一條是 erf 的四點列舉，另一條是封閉式。工作點不在 a 時這個關係不成立，不做比對。
  const atTruth = dp.wG === dp.aG && dp.wP === dp.aP
  const analyticOk =
    res && atTruth
      ? [0, 1].every((i) =>
          [0, 1].every((j) => {
            const r = secantRatio((j === 0 ? dp.deltaG : dp.deltaP) * Math.abs(j === 0 ? dp.cG : dp.cP), dp.sigmaV)
            return Math.abs(res.JmeanField[i][j] - r * res.Jlin[i][j]) <= 1e-9 * kq(dp.sigmaV)
          }),
        )
      : false

  return (
    <ExperimentShell
      id={SSPLL_EXPERIMENT_ID}
      title="SSPLL GOS／PHOS：兩參數 Jacobian 極性與聯合穩定檢查"
      level="L3"
      claim="approx"
      source="simulation"
      tests={['T18']}
      description={
        <>
          凍結兩個參數，每次只擾動一個（<Tex>{'w_j\\pm\\Delta_j'}</Tex>），同時記錄兩個 GMAC，得到 <Tex>{'\\hat{\\mathbf J}'}</Tex>。判準：對角 <Tex>{'\\hat J_{ii}<0'}</Tex>（各自極性）、<Tex>{'\\rho(\\mathbf I+\\mathbf M\\hat{\\mathbf J})<1'}</Tex>（聯合穩定）、<Tex>{'\\sigma_{\\min}(\\hat{\\mathbf J})>z\\,\\|\\mathrm{se}\\|_F'}</Tex>（在量測誤差內可辨識）。這是通用的量測流程；SSPLL 中 GOS／PHOS 為何會變號的物理見案例頁。
        </>
      }
      assumptions={[
        String.raw`$e[n]=(a_G-w_G)\,c_G\,x_G[n]+(a_P-w_P)\,c_P\,x_P[n]+v[n]$，$v\sim\mathcal N(0,\sigma_v^2)$`,
        String.raw`$x_G$ 為 iid $\pm1$；$x_P=x_G$（機率 $(1+\rho_{GP})/2$）否則 $-x_G$ ⇒ $E[x_Gx_P]=\rho_{GP}$`,
        String.raw`$c_G$、$c_P$ 為兩條路徑在 code 頻帶的有效相關（$|H|\cos\theta$，可為負）；靜態（無記憶）`,
        String.raw`$G_i=\frac1N\sum_nq[n]\,x_i[n]$（raw-x correlator）；更新 $\mathbf M=\mathrm{diag}(\mu_G,\mu_P)$`,
        String.raw`精確 mean-field：列舉 $(x_G,x_P)$ 四種組合，各自代入 $\mathrm{erf}$`,
        String.raw`可辨識性門檻用 Weyl 不等式 $|\sigma_i(\hat{\mathbf J})-\sigma_i(\mathbf J)|\le\|\hat{\mathbf J}-\mathbf J\|_2\le\|\hat{\mathbf J}-\mathbf J\|_F$，並以 $\|\mathrm{se}\|_F=\sqrt{\sum_{ij}\mathrm{se}_{ij}^2}$ 估計右邊的量級（保守）`,
      ]}
      params={{ ...p }}
      seed={p.seed}
      onSeedChange={(s) => set('seed', s)}
      units={{ sigmaV: 'fs', deltaG: 'fs', deltaP: 'fs', muG: 'fs', muP: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic:
          res && atTruth
            ? { status: analyticOk ? 'ok' : 'mismatch', note: analyticOk ? String.raw`精確 mean-field 中央差分 $=\mathbf J_\text{lin}\times r_\text{CD}(\Delta_j|c_j|)$（F-SO.2 的截斷比）` : String.raw`精確 mean-field 與 $\mathbf J_\text{lin}\times r_\text{CD}$ 不一致` }
            : { status: 'n/a', note: res ? String.raw`工作點不在真值（$w\ne a$）：精確 mean-field 與 $\mathbf J_\text{lin}\times r_\text{CD}$ 的關係只在 $w=a$ 成立，不做比對` : '模擬失敗（見警告），沒有可比的 Jacobian' },
        monteCarlo: res ? { status: mcOk ? 'ok' : 'mismatch', note: mcOk ? String.raw`四個元素皆在 $\pm4\,\mathrm{se}$ 內` : String.raw`至少一個元素超出 $\pm4\,\mathrm{se}$` } : { status: 'n/a', note: '模擬失敗（見警告），沒有量測值可比' },
        fixedPoint: { status: 'not-implemented', note: '兩個 GMAC 與 gain register 的定點位寬未建模（roadmap R9 bit-true）' },
      }}
      actions={{ onReset: () => setP(SSPLL_DEFAULT) }}
      exportData={(): CsvColumns =>
        res
          ? {
              entry: ['J_GG', 'J_GP', 'J_PG', 'J_PP'],
              J_hat: res.Jhat.flat(),
              J_se: res.Jse.flat(),
              J_meanfield: res.JmeanField.flat(),
              J_lin: res.Jlin.flat(),
            }
          : {}
      }
      presets={presets}
      onLoadPreset={(pr) => setP({ ...SSPLL_DEFAULT, ...(pr.params as Partial<TwoParamParams>) })}
      controls={
        <>
          <ParamControl label={rich(String.raw`$\rho_{GP}$（GOS 與 PHOS regressor 相關）`)} ariaLabel="ρ_GP（GOS 與 PHOS regressor 相關）" value={p.rho} onChange={(v) => set('rho', v)} min={-0.999} max={0.999} step={0.001} reg="behav: code_correlation" />
          <ParamControl label={rich('$c_G$（GOS 路徑有效相關）')} ariaLabel="c_G（GOS 路徑有效相關）" value={p.cG} onChange={(v) => set('cG', v)} min={-2} max={2} step={0.01} reg="behav: H_G cos θ_G" />
          <ParamControl label={rich('$c_P$（PHOS 路徑有效相關）')} ariaLabel="c_P（PHOS 路徑有效相關）" value={p.cP} onChange={(v) => set('cP', v)} min={-2} max={2} step={0.01} reg="behav: H_P cos θ_P" />
          <ParamControl label={rich(String.raw`$\sigma_v$（comparator 前雜訊）`)} ariaLabel="σ_v（comparator 前雜訊）" value={p.sigmaV} onChange={(v) => set('sigmaV', v)} min={1} max={1000} log unit="fs" reg="behav: comparator.sigma_v_fs" />
          <ParamControl label={rich(String.raw`$\Delta_G$（GOS 擾動）`)} ariaLabel="Δ_G（GOS 擾動）" value={p.deltaG} onChange={(v) => set('deltaG', v)} min={0.1} max={300} log unit="fs" reg="REG_GOS_PERTURB" />
          <ParamControl label={rich(String.raw`$\Delta_P$（PHOS 擾動）`)} ariaLabel="Δ_P（PHOS 擾動）" value={p.deltaP} onChange={(v) => set('deltaP', v)} min={0.1} max={300} log unit="fs" reg="REG_PHOS_PERTURB" />
          <ParamControl label={rich('$N$（每 block 樣本數）')} ariaLabel="N（每 block 樣本數）" value={p.N} onChange={(v) => set('N', v)} min={64} max={8192} integer clampOnBlur reg="REG_GMAC_N[15:0]" />
          <ParamControl label={rich('$M$（每次擾動每側 block 數）')} ariaLabel="M（每次擾動每側 block 數）" value={p.M} onChange={(v) => set('M', v)} min={2} max={48} integer clampOnBlur reg="behav: perturb_blocks" />
          <ParamControl label={rich(String.raw`$\mu_G$（GOS 步長）`)} ariaLabel="μ_G（GOS 步長）" value={p.muG} onChange={(v) => set('muG', v)} min={0.01} max={1000} log unit="fs" reg="REG_GOS_MU" />
          <ParamControl label={rich(String.raw`$\mu_P$（PHOS 步長）`)} ariaLabel="μ_P（PHOS 步長）" value={p.muP} onChange={(v) => set('muP', v)} min={0.01} max={1000} log unit="fs" reg="REG_PHOS_MU" />
          <ParamControl label={rich('$z$（判決信心倍數）')} ariaLabel="z（判決信心倍數）" value={p.z} onChange={(v) => set('z', v)} min={1} max={6} step={0.1} reg="behav: decision_z" />
        </>
      }
    >
      {res && (
        <>
          <div className="so-kv">
            <div>
              <div className="k">
                GOS 極性（<Tex>{'-\\hat J_{GG}'}</Tex> vs <Tex>{'z\\,\\mathrm{se}'}</Tex>）
              </div>
              <div className="v">
                <Verdict kind={res.diagVerdicts[0] === 'pass' ? 'ok' : res.diagVerdicts[0] === 'reversed' ? 'bad' : 'warn'}>{res.diagVerdicts[0] === 'pass' ? '正確' : res.diagVerdicts[0] === 'reversed' ? '相反' : '不確定'}</Verdict>
              </div>
            </div>
            <div>
              <div className="k">
                PHOS 極性（<Tex>{'-\\hat J_{PP}'}</Tex> vs <Tex>{'z\\,\\mathrm{se}'}</Tex>）
              </div>
              <div className="v">
                <Verdict kind={res.diagVerdicts[1] === 'pass' ? 'ok' : res.diagVerdicts[1] === 'reversed' ? 'bad' : 'warn'}>{res.diagVerdicts[1] === 'pass' ? '正確' : res.diagVerdicts[1] === 'reversed' ? '相反' : '不確定'}</Verdict>
              </div>
            </div>
            <div>
              <div className="k">
                聯合 <Tex>{'\\rho(\\mathbf I+\\mathbf M\\hat{\\mathbf J})'}</Tex>
              </div>
              <div className="v">
                {nf(res.rhoA, 5)} <Verdict kind={res.rhoA < 1 ? 'ok' : 'bad'}>{res.rhoA < 1 ? '穩定' : '不穩定'}</Verdict>
              </div>
            </div>
            <div>
              <div className="k">
                可辨識性（<Tex>{'\\sigma_{\\min}(\\hat{\\mathbf J})'}</Tex> vs <Tex>{'z\\,\\|\\mathrm{se}\\|_F'}</Tex>）
              </div>
              <div className="v">
                <Verdict kind={res.identifiable ? 'ok' : 'warn'}>{res.identifiable ? '顯著' : '不顯著'}</Verdict>
              </div>
            </div>
            <div>
              <div className="k">
                <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>
              </div>
              <div className="v">
                {nf(k, 5)} <Tex>{'\\mathrm{fs}^{-1}'}</Tex>
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>矩陣</th>
                  <th>值</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <Tex>{'\\hat{\\mathbf J}'}</Tex>（量測）
                  </td>
                  <td>
                    <MatrixTex A={res.Jhat} />
                  </td>
                  <td className="small">
                    中央差分；各元素的 <Tex>{'\\mathrm{se}'}</Tex> 見 metrics
                  </td>
                </tr>
                <tr>
                  <td>
                    <Tex>{'\\mathbf J_\\text{mf}'}</Tex>
                  </td>
                  <td>
                    <MatrixTex A={res.JmeanField} />
                  </td>
                  <td className="small">精確 mean-field 的同一個中央差分（含 erf 截斷）</td>
                </tr>
                <tr>
                  <td>
                    <Tex>{'\\mathbf J_\\text{lin}'}</Tex>
                  </td>
                  <td>
                    <MatrixTex A={res.Jlin} />
                  </td>
                  <td className="small">
                    <Tex>{'-K_q\\mathbf R\\,\\mathrm{diag}(c_G,c_P)'}</Tex>（小訊號）
                  </td>
                </tr>
                <tr>
                  <td>
                    <Tex>{'\\mathbf I+\\mathbf M\\hat{\\mathbf J}'}</Tex>
                  </td>
                  <td>
                    <MatrixTex A={res.A} />
                  </td>
                  <td className="small">
                    eigenvalues <Tex>{res.eigA.map((z) => (Math.abs(z.im) > 1e-12 ? `${tx(z.re, 4)}${z.im < 0 ? '-' : '+'}j${tx(Math.abs(z.im), 3)}` : tx(z.re, 5))).join(',\\ ')}</Tex>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <TexBlock>{String.raw`\sigma(\hat{\mathbf J})=\{${res.singularValues.map((s) => tx(s, 4)).join(',\\ ')}\},\qquad \kappa=${tx(res.singularValues[0] / res.singularValues[1], 4)}`}</TexBlock>
        </>
      )}
      <Plot
        title={String.raw`Poles：單獨更新（○）vs 聯合更新（$\times$）`}
        data={poles}
        layout={POLE_LAYOUT}
        height={320}
        csvName="signoff-sspll-poles"
      />
    </ExperimentShell>
  )
}
