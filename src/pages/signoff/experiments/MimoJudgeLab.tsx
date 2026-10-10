import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, SelectControl, Tex, useThemeTokens, type CsvColumns, type ExperimentPreset, type MetricRow } from '@/components'
import { useUrlPreset } from '@/app/presets'
import type { Matrix } from '@/simulation/core'
import { jacobianRobustness, mimoJudge, regPinvM, type MimoJudgement, type RobustnessCheck } from '../judges'
import { Verdict, nf, plainText, rich, tx, usePresetList } from '../shared'

export const MIMO_EXPERIMENT_ID = 'signoff-mimo-judge'

export type MimoMode = 'diag' | 'regpinv'

export interface MimoParams {
  J11: number
  J12: number
  J21: number
  J22: number
  mode: MimoMode
  mu1: number
  mu2: number
  gamma: number
  epsJ: number
  /** 建構 M 時用的 Ĵ：非對角元素的相對誤差（Ĵ_ij = J_ij(1 + e_off)，i ≠ j） */
  eOff: number
}

export const MIMO_DEFAULT: MimoParams = { J11: -1, J12: 2, J21: 2, J22: -1, mode: 'diag', mu1: 0.2, mu2: 0.2, gamma: 0.5, epsJ: 0.1, eOff: 0 }

const LOCAL_PRESETS: ExperimentPreset[] = [
  { name: 'T18：各自穩定、一起發散（M = 0.2I）', params: { ...MIMO_DEFAULT } },
  { name: 'T18 + regularized pseudoinverse（γ = 0.5、ε_J = 0.1）', params: { ...MIMO_DEFAULT, mode: 'regpinv' } },
  { name: 'E24：近奇異 J，Ĵ 用 ρ̂ = 0.996、γ = 1、ε_J = 0 ⇒ 發散', params: { J11: -1, J12: -0.99, J21: -0.99, J22: -1, mode: 'regpinv', mu1: 0.5, mu2: 0.5, gamma: 1, epsJ: 0, eOff: 0.996 / 0.99 - 1 } },
  { name: 'E24：同上加 ε_J = 1e-4 ⇒ 穩定', params: { J11: -1, J12: -0.99, J21: -0.99, J22: -1, mode: 'regpinv', mu1: 0.5, mu2: 0.5, gamma: 1, epsJ: 1e-4, eOff: 0.996 / 0.99 - 1 } },
  { name: '§9 匹配模型 J = −R（ρ = 0.99）、M = 0.5I：慢模式 0.995', params: { J11: -1, J12: -0.99, J21: -0.99, J22: -1, mode: 'diag', mu1: 0.5, mu2: 0.5, gamma: 0.5, epsJ: 0, eOff: 0 } },
]

function MatrixTex({ A }: { A: Matrix }) {
  return <Tex>{`\\begin{bmatrix}${A.map((r) => r.map((v) => tx(v, 4)).join('&')).join('\\\\')}\\end{bmatrix}`}</Tex>
}

const POLE_LAYOUT = { xaxis: { title: { text: 'Re z' }, scaleanchor: 'y' as const, range: [-1.8, 1.8] }, yaxis: { title: { text: 'Im z' }, range: [-1.3, 1.3] } }

/** 複數 eigenvalue 的文字：共軛對的兩個成員各自帶正負號（a + jb、a − jb），不重複寫成兩次「a ± jb」。 */
const zText = (z: { re: number; im: number }) => (Math.abs(z.im) > 1e-12 ? `${nf(z.re, 4)} ${z.im < 0 ? '−' : '+'} j${nf(Math.abs(z.im), 4)}` : nf(z.re, 6))
/** 同上，但輸出 TeX（放進 `$…$` 或 <Tex>） */
const zTex = (z: { re: number; im: number }) => (Math.abs(z.im) > 1e-12 ? `${tx(z.re, 4)}${z.im < 0 ? '-' : '+'}j\\,${tx(Math.abs(z.im), 4)}` : tx(z.re, 6))
const listTex = (xs: string[]) => xs.join(',\\ ')

export function MimoJudgeExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<MimoParams>(MIMO_DEFAULT)
  const presets = usePresetList(MIMO_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(MIMO_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setP({ ...MIMO_DEFAULT, ...(urlPreset.params as Partial<MimoParams>) })
  }, [urlPreset])
  const set = <K extends keyof MimoParams>(k: K, v: MimoParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDeferredValue(p)

  const out = useMemo(() => {
    const J: Matrix = [
      [dp.J11, dp.J12],
      [dp.J21, dp.J22],
    ]
    const Jhat: Matrix = [
      [dp.J11, dp.J12 * (1 + dp.eOff)],
      [dp.J21 * (1 + dp.eOff), dp.J22],
    ]
    try {
      const M: Matrix = dp.mode === 'diag' ? [[dp.mu1, 0], [0, dp.mu2]] : regPinvM(Jhat, dp.gamma, dp.epsJ)
      const j = mimoJudge(J, M)
      // 公式預測（只在 Ĵ = J 時成立）：p_i = 1 − γσ_i²/(σ_i² + ε_J)
      const formulaPoles = dp.mode === 'regpinv' ? j.singularValues.map((s) => 1 - (dp.gamma * s * s) / (s * s + dp.epsJ)) : []
      const rob = dp.mode === 'regpinv' ? jacobianRobustness(J, Jhat, M) : null
      return { J, Jhat, M, j, formulaPoles, rob, error: null as string | null }
    } catch (e) {
      return { J, Jhat, M: null, j: null as MimoJudgement | null, formulaPoles: [] as number[], rob: null as RobustnessCheck | null, error: (e as Error).message }
    }
  }, [dp])

  const warnings: string[] = []
  if (out.error) {
    warnings.push(
      out.error.includes('singular') || out.error.includes('奇異')
        ? `$\\lambda_{\\min}=0$：$\\hat{\\mathbf J}^T\\hat{\\mathbf J}+\\varepsilon_J\\mathbf I$ 奇異（${plainText(out.error)}）——$\\hat{\\mathbf J}$ 有零奇異值時必須 $\\varepsilon_J>0$；這代表某個參數組合不可辨識，preconditioner 不能製造資訊。`
        : plainText(out.error),
    )
  }
  const j = out.j
  // Analytic 交叉比對（真的算）：2×2 的 eigenvalue 有封閉式 λ = (T ± √(T² − 4D))/2（T = trace、D = det），與 eigvals（Hessenberg + QR）求得的 ρ 比對
  const rhoClosed = (() => {
    if (!j) return NaN
    const [[a, b], [c, d]] = j.A
    const T = a + d
    const D = a * d - b * c
    const disc = T * T - 4 * D
    return disc >= 0 ? Math.max(Math.abs((T + Math.sqrt(disc)) / 2), Math.abs((T - Math.sqrt(disc)) / 2)) : Math.sqrt(D)
  })()
  const analyticOk = j ? Math.abs(rhoClosed - j.rho) <= 1e-9 * (1 + j.rho) : false
  if (j) {
    if (j.eachLoopStable && !j.jointStable) {
      // 兩種不同的成因要分開解釋：(a) J 有實部為正的 eigenvalue（某個方向的恢復力是負的）；(b) 恢復力都存在，但耦合後某個模式的有效增益超過臨界
      const hasPositive = j.eigJ.some((z) => z.re > 1e-12)
      warnings.push(
        `各 loop 單獨穩定（對角 pole $${listTex(j.diagPoles.map((x) => tx(x, 4)))}$），但 $\\rho(\\mathbf I+\\mathbf M\\mathbf J)=${tx(j.rho, 5)}\\ge1$：一起更新時發散（T18 機制）。` +
          (hasPositive
            ? `$\\mathbf J$ 的 eigenvalue $${listTex(j.eigJ.map(zTex))}$ 中有實部為正的值 ⇒ $-\\mathbf J$ 不是正定，沿那個方向的「恢復力」是負的（$\\mathbf M=\\mu\\mathbf I$ 時任何 $\\mu>0$ 都發散）；要改的是 correlator／regressor 的對應，不是步長。`
            : `$\\mathbf J$ 的 eigenvalue $${listTex(j.eigJ.map(zTex))}$ 實部都是負的（每個方向都有恢復力），不穩定來自交叉耦合讓某個模式的有效增益超過臨界（eigenvalue $<-1$）：把步長調小，或改用 preconditioner。`),
      )
    }
    if (!j.jointStable && !j.eachLoopStable) warnings.push(`$\\rho(\\mathbf I+\\mathbf M\\mathbf J)=${tx(j.rho, 5)}\\ge1$：閉迴路不穩定（而且至少一個 loop 單獨更新就不穩定）。`)
    const smin = j.singularValues[j.singularValues.length - 1]
    if (smin < 1e-9 * j.singularValues[0]) warnings.push(String.raw`$\lambda_{\min}=0$：$\mathbf J$ 奇異（$\sigma_{\min}(\mathbf J)=0$）——有一個參數方向完全沒有資訊（不可辨識），任何 $\mathbf M$ 都不能讓它收斂。`)
    if (dp.mode === 'regpinv' && dp.eOff !== 0) warnings.push(
        `$\\hat{\\mathbf J}\\ne\\mathbf J$（非對角相對誤差 ${nf(100 * dp.eOff, 4)}%）：poles 必須用 $\\mathrm{eig}\\big(\\mathbf I+\\mathbf M(\\hat{\\mathbf J})\\,\\mathbf J_\\text{true}\\big)$，公式 $1-\\gamma\\sigma_i^2/(\\sigma_i^2+\\varepsilon_J)$ 不再成立（勘誤 E24）。`,
      )
  }

  const plot: Data[] = useMemo(() => {
    const th = Array.from({ length: 181 }, (_, i) => (2 * Math.PI * i) / 180)
    const d: Data[] = [{ x: th.map(Math.cos), y: th.map(Math.sin), mode: 'lines', name: 'unit circle', line: { color: tokens.textMuted, width: 1 }, hoverinfo: 'skip' }]
    if (out.j) {
      d.push({ x: out.j.eigA.map((z) => z.re), y: out.j.eigA.map((z) => z.im), mode: 'markers', name: 'eig(I + MJ)（聯合）', marker: { size: 12, symbol: 'x', color: tokens.series[1] } })
      d.push({ x: out.j.diagPoles, y: out.j.diagPoles.map(() => 0), mode: 'markers', name: '單獨 1 + M_iiJ_ii', marker: { size: 10, symbol: 'circle-open', color: tokens.series[0], line: { width: 2 } } })
      if (out.formulaPoles.length) d.push({ x: out.formulaPoles, y: out.formulaPoles.map(() => 0), mode: 'markers', name: '公式 1 − γσ²/(σ² + ε)（假設 Ĵ = J）', marker: { size: 9, symbol: 'diamond-open', color: tokens.series[2] } })
    }
    return d
  }, [out, tokens])

  const metrics: MetricRow[] = j
    ? [
        { name: String.raw`$\rho(\mathbf I+\mathbf M\mathbf J)$`, value: j.rho, formulaId: 'F-SO.7', claim: 'exact', note: String.raw`$<1$ ⇔ 局部線性穩定` },
        { name: String.raw`$\kappa(\mathbf J)=\sigma_{\max}/\sigma_{\min}$`, value: j.cond, claim: 'exact' },
        ...j.eigA.map((z, i) => ({ name: `$\\lambda_{${i + 1}}(\\mathbf I+\\mathbf M\\mathbf J)$`, value: zText(z), claim: 'exact' as const })),
        ...j.diagPoles.map((x, i) => ({ name: `單獨 loop ${i + 1} 的 pole $1+M_{${i + 1}${i + 1}}J_{${i + 1}${i + 1}}$`, value: x, claim: 'exact' as const })),
        ...(out.formulaPoles.length ? out.formulaPoles.map((x, i) => ({ name: `公式 pole $p_{${i + 1}}=1-\\gamma\\sigma_{${i + 1}}^2/(\\sigma_{${i + 1}}^2+\\varepsilon_J)$（假設 $\\hat{\\mathbf J}=\\mathbf J$）`, value: x, claim: 'exact' as const })) : []),
        ...(out.rob
          ? [
              { name: String.raw`設計者以為的 $\rho(\mathbf I+\mathbf M\hat{\mathbf J})$`, value: out.rob.rhoHat, claim: 'exact' as const },
              { name: String.raw`$\|\mathbf E\|_2$，$\mathbf E=\mathbf M(\mathbf J-\hat{\mathbf J})$`, value: out.rob.normE, claim: 'exact' as const },
              {
                name: String.raw`Bauer–Fike 上界 $\rho(\hat{\mathbf A})+\|\mathbf E\|_2$（$\hat{\mathbf A}$ 對稱）`,
                value: out.rob.symmetric ? out.rob.bound : '不適用（非對稱）',
                claim: 'exact' as const,
                note: out.rob.symmetric
                  ? out.rob.bound < 1
                    ? String.raw`$<1$：對此 $\hat{\mathbf J}$ 誤差保證穩定（充分條件）`
                    : String.raw`$\ge1$：充分條件不成立（不代表一定不穩，見真實 $\rho$）`
                  : String.raw`$\hat{\mathbf A}$ 非對稱：上界還要乘 eigenvector 矩陣的條件數 $\kappa(\mathbf V)$`,
              },
            ]
          : []),
      ]
    : []

  return (
    <ExperimentShell
      id={MIMO_EXPERIMENT_ID}
      title={String.raw`MIMO 判斷器：$\rho(\mathbf I+\mathbf M\mathbf J)$、奇異值、各自 vs 聯合`}
      level="L3"
      claim="exact"
      source="illustrative"
      tests={['T18', 'T10']}
      description={
        <>
          輸入量測到（或模型）的 <Tex>{'\\mathbf J=\\partial E[\\mathbf G]/\\partial\\mathbf w'}</Tex> 與更新矩陣 <Tex>{'\\mathbf M'}</Tex>，判斷 <Tex>{'\\boldsymbol\\delta\\mathbf w_{k+1}=(\\mathbf I+\\mathbf M\\mathbf J)\\boldsymbol\\delta\\mathbf w_k'}</Tex> 的穩定性。
          regularized pseudoinverse 模式下，<Tex>{'\\mathbf M'}</Tex> 由帶誤差的 <Tex>{'\\hat{\\mathbf J}'}</Tex> 建構，但 poles 一律以真實 <Tex>{'\\mathbf J'}</Tex> 計算。
        </>
      }
      assumptions={[
        String.raw`在固定點附近線性化：$E[\mathbf G(\mathbf w)]\approx\mathbf J\,(\mathbf w-\mathbf w^*)$`,
        String.raw`更新 $\mathbf w_{k+1}=\mathbf w_k+\mathbf M\,\mathbf G_k$（無更新延遲）`,
        String.raw`$\mathbf M=\mathrm{diag}(\mu_1,\mu_2)$ 或 $\mathbf M=-\gamma(\hat{\mathbf J}^T\hat{\mathbf J}+\varepsilon_J\mathbf I)^{-1}\hat{\mathbf J}^T$（$\varepsilon_J$ 取代規格的 $\lambda$，E22）`,
        String.raw`$\hat{\mathbf J}$ 的誤差只加在非對角元素：$\hat J_{ij}=J_{ij}(1+e_\text{off})$，$i\ne j$（示範用）`,
      ]}
      params={{ ...p }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: j
          ? { status: analyticOk ? 'ok' : 'mismatch', note: analyticOk ? String.raw`數值 eigenvalue 的 $\rho$ 與 $2\times2$ 封閉式（trace／determinant）相符` : String.raw`數值 eigenvalue 與 $2\times2$ 封閉式不一致` }
          : 'not-implemented',
        monteCarlo: 'not-implemented',
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(MIMO_DEFAULT) }}
      exportData={(): CsvColumns => (out.j ? { eigA_re: out.j.eigA.map((z) => z.re), eigA_im: out.j.eigA.map((z) => z.im), singular_values: out.j.singularValues, diag_poles: out.j.diagPoles } : {})}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...MIMO_DEFAULT, ...(pr.params as Partial<MimoParams>) })}
      controls={
        <>
          <div className="so-matrix-input">
            <ParamControl label={<Tex>{'J_{11}'}</Tex>} ariaLabel="J₁₁" value={p.J11} onChange={(v) => set('J11', v)} min={-10} max={10} step={0.001} unit="fs⁻¹" reg="measured Ĵ" />
            <ParamControl label={<Tex>{'J_{12}'}</Tex>} ariaLabel="J₁₂" value={p.J12} onChange={(v) => set('J12', v)} min={-10} max={10} step={0.001} unit="fs⁻¹" reg="measured Ĵ" />
            <ParamControl label={<Tex>{'J_{21}'}</Tex>} ariaLabel="J₂₁" value={p.J21} onChange={(v) => set('J21', v)} min={-10} max={10} step={0.001} unit="fs⁻¹" reg="measured Ĵ" />
            <ParamControl label={<Tex>{'J_{22}'}</Tex>} ariaLabel="J₂₂" value={p.J22} onChange={(v) => set('J22', v)} min={-10} max={10} step={0.001} unit="fs⁻¹" reg="measured Ĵ" />
          </div>
          <SelectControl
            label={rich(String.raw`$\mathbf M$ 的形式`)}
            ariaLabel="M 的形式"
            value={p.mode}
            onChange={(v) => set('mode', v)}
            options={[
              { value: 'diag', label: '各自步長 diag(μ₁, μ₂)' },
              { value: 'regpinv', label: 'Regularized pseudoinverse' },
            ]}
            reg="RTL: update matrix / LUT"
          />
          {p.mode === 'diag' ? (
            <>
              <ParamControl label={<Tex>{'\\mu_1'}</Tex>} ariaLabel="μ₁" value={p.mu1} onChange={(v) => set('mu1', v)} min={0} max={10} step={0.001} unit="fs" reg="REG_MU_1" />
              <ParamControl label={<Tex>{'\\mu_2'}</Tex>} ariaLabel="μ₂" value={p.mu2} onChange={(v) => set('mu2', v)} min={0} max={10} step={0.001} unit="fs" reg="REG_MU_2" />
            </>
          ) : (
            <>
              <ParamControl label={rich(String.raw`$\gamma$（正規化步長）`)} ariaLabel="γ（正規化步長）" value={p.gamma} onChange={(v) => set('gamma', v)} min={0} max={2} step={0.001} reg="behav: gamma" />
              <ParamControl label={rich(String.raw`$\varepsilon_J$（regularization）`)} ariaLabel="ε_J（regularization）" value={p.epsJ} onChange={(v) => set('epsJ', v)} min={0} max={10} step={0.0001} unit="fs⁻²" reg="behav: eps_J" />
              <ParamControl label={rich(String.raw`$\hat{\mathbf J}$ 非對角相對誤差 $e_\text{off}$`)} ariaLabel="Ĵ 非對角相對誤差 e_off" value={p.eOff} onChange={(v) => set('eOff', v)} min={-0.5} max={0.5} step={0.0001} reg="behav: jacobian_error" />
            </>
          )}
        </>
      }
    >
      {j && (
        <>
          <p>
            判定：
            {j.jointStable ? (
              <Verdict kind="ok">
                聯合穩定 <Tex>{`\\rho=${tx(j.rho, 5)}`}</Tex>
              </Verdict>
            ) : (
              <Verdict kind="bad">
                聯合不穩定 <Tex>{`\\rho=${tx(j.rho, 5)}`}</Tex>
              </Verdict>
            )}{' '}
            {j.eachLoopStable ? <Verdict kind="ok">各自穩定</Verdict> : <Verdict kind="warn">至少一個 loop 單獨就不穩定</Verdict>}
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>
                    <Tex>{'\\mathbf J'}</Tex>
                  </td>
                  <td>
                    <MatrixTex A={out.J} />
                  </td>
                  <td className="small">
                    eigenvalues <Tex>{listTex(j.eigJ.map(zTex))}</Tex>；奇異值 <Tex>{`\\sigma_i=${listTex(j.singularValues.map((v) => tx(v, 5)))}`}</Tex>
                  </td>
                </tr>
                {out.M && (
                  <tr>
                    <td>
                      <Tex>{'\\mathbf M'}</Tex>
                    </td>
                    <td>
                      <MatrixTex A={out.M} />
                    </td>
                    <td className="small">{p.mode === 'diag' ? '各自步長' : rich(String.raw`由 $\hat{\mathbf J}$ 建構`)}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    <Tex>{'\\mathbf I+\\mathbf M\\mathbf J'}</Tex>
                  </td>
                  <td>
                    <MatrixTex A={j.A} />
                  </td>
                  <td className="small">
                    eigenvalues <Tex>{listTex(j.eigA.map(zTex))}</Tex>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <Plot
        title={String.raw`Poles：單獨（○）、聯合（×）、公式預測（◇，只在 $\hat{\mathbf J}=\mathbf J$ 時成立）`}
        data={plot}
        layout={POLE_LAYOUT}
        height={320}
        csvName="signoff-mimo-poles"
      />
    </ExperimentShell>
  )
}
