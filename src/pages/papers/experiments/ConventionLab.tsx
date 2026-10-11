import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  mathText,
  useDebouncedValue,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { CONVENTIONS, CONVENTION_LABEL, CONVENTION_MU_TEX, CONVENTION_SHORT, CONVENTION_UPDATE_TEX, type Convention } from '../bridge'
import { Num, num, r, texNum } from '../common'
import {
  DEFAULT_PARAMS,
  EXPERIMENT_ID,
  LOCAL_PRESETS,
  RANGES,
  STEP_UNIT,
  analyzeLab,
  crossCheckLab,
  parseLabParams,
  radiusCurve,
  type LabParams,
} from './labModel'

/** 步長控制項的名稱（中文部分；符號另以 KaTeX 顯示）與 aria-label（純文字） */
const MU_NAME: Record<Convention, string> = {
  half: '書上的步長',
  widrow: 'Widrow 型的步長',
  nlms: 'NLMS 的正規化步長',
  signBlock: 'gain step（average 模式）',
}

const MU_REG: Record<Convention, string> = {
  half: 'Behavioral: mu（更新式不帶 2）',
  widrow: 'Behavioral: mu_W（更新式帶 2）',
  nlms: 'Behavioral: mu_tilde（NLMS）',
  signBlock: 'REG_GAIN_STEP（gain_step，fs）',
}

/** 「文獻寫法換算器」：把論文／教科書的步長換成本站的 loop gain，並看更新延遲下的穩定性。 */
export function ConventionLab() {
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const [params, setParams] = useState<LabParams>(() => (urlPreset ? parseLabParams(urlPreset.params) : DEFAULT_PARAMS))
  useEffect(() => {
    if (urlPreset) setParams(parseLabParams(urlPreset.params))
  }, [urlPreset])
  const set = (patch: Partial<LabParams>) => setParams((p) => ({ ...p, ...patch }))

  const deferred = useDebouncedValue(params, 60)
  const res = useMemo(() => analyzeLab(deferred), [deferred])
  const curve = useMemo(() => radiusCurve(deferred.d), [deferred.d])
  const tokens = useThemeTokens()

  const presets: ExperimentPreset[] = useMemo(
    () => [
      ...LOCAL_PRESETS.map((p) => ({ name: p.name, description: p.description, params: p.params as Record<string, unknown> })),
      ...presetsForExperiment(EXPERIMENT_ID).map((p) => ({ name: p.title, description: p.description, params: p.params })),
    ],
    [],
  )

  const k = useMemo(() => Array.from({ length: deferred.steps + 1 }, (_, i) => i), [deferred.steps])
  const trajData: Data[] = useMemo(() => {
    // log 軸：|δ| 掉到 1e−30 以下（含一步歸零）或發散停止（NaN）之後就不畫，避免大量 ≤ 0 的點
    const trim = (ys: ArrayLike<number>) => {
      const y: number[] = []
      for (let i = 0; i < ys.length; i++) {
        const v = Math.abs(ys[i])
        if (!Number.isFinite(v) || v < 1e-30) break
        y.push(v)
      }
      return { x: k.slice(0, y.length), y }
    }
    const env = (rad: number) => trim(k.map((i) => rad ** i))
    return [
      { ...trim(res.trajFast), name: `快模式（$\\lambda_{\\max}$，$g = ${num(res.gFast, 4)}$）`, mode: 'lines', line: { color: tokens.series[0] } },
      { ...trim(res.trajSlow), name: `慢模式（$\\lambda_{\\min}$，$g = ${num(res.gSlow, 4)}$）`, mode: 'lines', line: { color: tokens.series[1] } },
      { ...env(res.radiusFast), name: '快模式包絡 $|z|_{\\max}^k$', mode: 'lines', line: { color: tokens.series[0], dash: 'dot', width: 1 } },
      { ...env(res.radiusSlow), name: '慢模式包絡 $|z|_{\\max}^k$', mode: 'lines', line: { color: tokens.series[1], dash: 'dot', width: 1 } },
    ]
  }, [k, res, tokens])

  const curveData: Data[] = useMemo(() => {
    const out: Data[] = [
      { x: curve.g, y: curve.rD, name: `$d = ${deferred.d}$`, mode: 'lines', line: { color: tokens.series[2] } },
      { x: curve.g, y: curve.r0, name: '$d = 0$（無延遲）', mode: 'lines', line: { color: tokens.series[3], dash: 'dash' } },
      {
        x: [curve.g[0], curve.g[curve.g.length - 1]],
        y: [1, 1],
        name: '$|z| = 1$（穩定邊界）',
        mode: 'lines',
        line: { color: tokens.textMuted, dash: 'dot', width: 1 },
      },
    ]
    const pts = [
      { g: res.gFast, r: res.radiusFast, name: '目前的快模式' },
      { g: res.gSlow, r: res.radiusSlow, name: '目前的慢模式' },
    ].filter((p) => p.g > 0)
    if (pts.length) {
      out.push({
        x: pts.map((p) => p.g),
        y: pts.map((p) => p.r),
        text: pts.map((p) => p.name),
        name: '目前設定',
        mode: 'markers',
        marker: { size: 10, color: tokens.series[4] },
      })
    }
    return out
  }, [curve, res, deferred.d, tokens])

  const unit = STEP_UNIT[deferred.convention]
  const metrics: MetricRow[] = [
    {
      name: r`$s$（每單位 $\lambda$ 的 loop gain）`,
      value: res.s,
      claim: deferred.convention === 'nlms' || deferred.convention === 'signBlock' ? 'approx' : 'exact',
      note: `換算式 ${deferred.convention === 'nlms' ? 'F-PR.2' : deferred.convention === 'signBlock' ? 'F-PR.3' : 'F-PR.1'}（本頁 §4）`,
    },
    { name: r`$\lambda_{\max}=P_x(1+|\rho|)$`, value: res.lmax, claim: 'exact' },
    { name: r`$\lambda_{\min}=P_x(1-|\rho|)$`, value: res.lmin, claim: 'exact' },
    {
      name: r`eigenvalue spread $\lambda_{\max}/\lambda_{\min}$`,
      value: res.lmin > 0 ? res.lmax / res.lmin : '無限大（不可辨識）',
      note: res.lmin > 0 ? undefined : r`$\lambda_{\min}=0$`,
    },
    { name: r`$g_{\mathrm{fast}}=s\,\lambda_{\max}$`, value: res.gFast, claim: 'exact' },
    { name: r`$g_{\mathrm{slow}}=s\,\lambda_{\min}$`, value: res.gSlow, claim: 'exact' },
    { name: r`快模式 $|z|_{\max}$`, value: res.radiusFast, claim: 'exact', note: res.radiusFast < 1 ? r`$<1$：收斂` : r`$\ge1$：不收斂` },
    { name: r`慢模式 $|z|_{\max}$`, value: res.radiusSlow, claim: 'exact', note: res.radiusSlow < 1 ? r`$<1$：收斂` : r`$\ge1$：不收斂` },
    {
      name: r`$g^*(d)=2\sin\dfrac{\pi}{4d+2}$（封閉式）`,
      value: res.gStar,
      analytic: res.gStarNumeric,
      tolerance: 1e-8,
      claim: 'exact',
      note: 'F-PR.4；analytic 欄是不用封閉式的數值求根',
    },
    {
      name: `此寫法的步長上限 $g^*(d)/\\lambda_{\\max}$ 換算（${CONVENTION_SHORT[deferred.convention]}）`,
      value: Number.isFinite(res.muBookMax) ? res.muBookMax : 'n/a（極性錯誤）',
      unit,
      claim: deferred.convention === 'nlms' || deferred.convention === 'signBlock' ? 'approx' : 'exact',
      note:
        deferred.convention === 'nlms' && res.nlmsCapped
          ? `NLMS：取 a posteriori 界限 $2(\\epsilon_{\\mathrm{reg}}+\\mathrm{tr}\\,\\mathbf R)/\\mathrm{tr}\\,\\mathbf R$；平均模型的界限 $${texNum(res.bounds.nlms, 5)}$ 較寬，只保證 $E[\\boldsymbol\\delta]$ 收斂`
          : undefined,
    },
    { name: r`慢模式（$\lambda_{\min}$）95% 衰減`, value: Number.isFinite(res.stepsSlow) ? res.stepsSlow : '不衰減', unit: 'steps' },
    {
      name: r`快模式（$\lambda_{\max}$）95% 衰減`,
      value: Number.isFinite(res.stepsFast) ? res.stepsFast : '不衰減',
      unit: 'steps',
      note:
        res.radiusFast > res.radiusSlow && res.radiusFast < 1
          ? r`步長太大：$\lambda_{\max}$ 的模式過衝，$|z|_{\max}$ 反而比 $\lambda_{\min}$ 的模式大，整體收斂改由它決定`
          : undefined,
    },
    {
      name: r`快模式 PM $=90^\circ-(2d+1)\arcsin(g/2)$`,
      value: Number.isFinite(res.pmFast) ? res.pmFast : 'n/a',
      unit: '°',
      claim: 'exact',
      note: Number.isFinite(res.pmFast) ? 'F-PR.4' : r`只在 $0<g\le2$ 時有定義`,
    },
  ]

  const check = crossCheckLab(deferred, res)

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title={r`文獻寫法換算器：把 $\mu$、$\lambda$、延遲 $d$ 換成本站的 loop gain $g$ 與 pole`}
      level="L1"
      claim="exact"
      source="illustrative"
      tests={['T08', 'T11', 'T13']}
      description={
        <>
          選擇論文或教科書的步長寫法、輸入書上的數字，網站把它換成本站的 <Tex>{r`g_i=s\lambda_i`}</Tex>，再用延遲遞迴{' '}
          <Tex>{r`\delta_{k+1}=\delta_k-g\,\delta_{k-d}`}</Tex> 判斷每個 eigen-mode 是否收斂。全部是平均（mean）模型的解析計算，沒有隨機性。
        </>
      }
      assumptions={[
        '平均（mean）線性模型：regressor 與係數誤差獨立（iid 純量時精確，時間相關時為近似）',
        r`兩個參數、$\mathbf R=P_x\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}$；更新延遲 $d$ 為固定整數 block`,
        r`NLMS 以 $\mathrm{tr}\,\mathbf R$ 代替每筆的 $\|\mathbf x\|^2$（近似）`,
        r`Block sign-GMAC 以 comparator 小訊號增益 $K_q=\sqrt{2/\pi}/\sigma_v$ 線性化（$|\delta|\ll\sigma_v$；Gaussian $v$），identity path（$\mathbf C=\mathbf R$）`,
        r`極性：$\delta=a-w$；$q=\mathrm{sign}(e)$，$e\ge0\Rightarrow q=+1$`,
        '所有數字為 illustrative，不是任何文獻的結果',
      ]}
      params={{ ...deferred }}
      units={{ mu: unit, Px: '—', rho: '—', epsReg: '—', sigmaV: 'fs', N: 'samples', d: 'blocks', steps: 'steps' }}
      metrics={metrics}
      warnings={res.warnings}
      crossCheck={{
        analytic: check.ok ? { status: 'ok', note: check.note } : { status: 'mismatch', note: check.note },
        monteCarlo: { status: 'not-implemented', note: '本實驗只算平均（mean）模型，沒有隨機性；隨機 LMS 的 Monte Carlo 見 Ch03、Ch09、Ch12' },
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setParams(DEFAULT_PARAMS) }}
      exportData={() => ({
        k,
        delta_fast: res.trajFast,
        delta_slow: res.trajSlow,
        g_grid: curve.g,
        radius_d: curve.rD,
        radius_d0: curve.r0,
      })}
      presets={presets}
      onLoadPreset={(p) => setParams(parseLabParams(p.params, DEFAULT_PARAMS))}
      controls={
        <>
          <SelectControl<Convention>
            label="文獻的步長寫法"
            value={params.convention}
            onChange={(convention) => set({ convention })}
            options={CONVENTIONS.map((c) => ({ value: c, label: CONVENTION_LABEL[c] }))}
            reg="Behavioral: convention"
            hint={
              <>
                更新式：<Tex>{CONVENTION_UPDATE_TEX[params.convention]}</Tex>
              </>
            }
          />
          <ParamControl
            label={
              <>
                {MU_NAME[params.convention]} <Tex>{CONVENTION_MU_TEX[params.convention]}</Tex>
              </>
            }
            ariaLabel={MU_NAME[params.convention]}
            value={params.mu}
            onChange={(mu) => set({ mu })}
            min={RANGES.mu[0]}
            max={RANGES.mu[1]}
            log
            unit={STEP_UNIT[params.convention]}
            reg={MU_REG[params.convention]}
            hint={
              <>
                書上寫的 <Tex>{CONVENTION_MU_TEX[params.convention]}</Tex>，照抄即可
              </>
            }
          />
          <ParamControl
            label={
              <>
                regressor 功率 <Tex>{r`P_x=E[x^2]`}</Tex>
              </>
            }
            ariaLabel="regressor 功率 P_x"
            value={params.Px}
            onChange={(Px) => set({ Px })}
            min={RANGES.Px[0]}
            max={RANGES.Px[1]}
            log
            unit="—"
            reg="Behavioral: P_x（正規化 code 時為 1）"
          />
          <ParamControl
            label={
              <>
                兩個參數 regressor 的相關係數 <Tex>{r`\rho`}</Tex>
              </>
            }
            ariaLabel="相關係數 rho"
            value={params.rho}
            onChange={(rho) => set({ rho })}
            min={RANGES.rho[0]}
            max={RANGES.rho[1]}
            step={0.001}
            unit="—"
            reg="Behavioral: rho = corr(u_1, u_2)"
            hint={
              <>
                <Tex>{r`\lambda=P_x(1\pm|\rho|)`}</Tex>；<Tex>{r`|\rho|=1`}</Tex> 時不可辨識
              </>
            }
          />
          <ParamControl
            label={
              <>
                更新延遲 <Tex>{'d'}</Tex>
              </>
            }
            ariaLabel="更新延遲 d"
            value={params.d}
            onChange={(d) => set({ d })}
            min={RANGES.d[0]}
            max={RANGES.d[1]}
            integer
            clampOnBlur
            unit="blocks"
            reg="cal_update_delay_blocks"
            hint={
              <>
                臨界增益 <Tex>{r`g^*(d)=2\sin\frac{\pi}{4d+2}`}</Tex>
              </>
            }
          />
          {params.convention === 'nlms' && (
            <ParamControl
              label={
                <>
                  NLMS regularizer <Tex>{r`\epsilon_{\mathrm{reg}}`}</Tex>
                </>
              }
              ariaLabel="NLMS regularizer"
              value={params.epsReg}
              onChange={(epsReg) => set({ epsReg })}
              min={RANGES.epsReg[0]}
              max={RANGES.epsReg[1]}
              unit="—"
              reg="Behavioral: eps_reg"
            />
          )}
          {params.convention === 'signBlock' && (
            <>
              <ParamControl
                label={
                  <>
                    comparator 前雜訊 <Tex>{r`\sigma_v`}</Tex>
                  </>
                }
                ariaLabel="comparator 前雜訊 sigma_v"
                value={params.sigmaV}
                onChange={(sigmaV) => set({ sigmaV })}
                min={RANGES.sigmaV[0]}
                max={RANGES.sigmaV[1]}
                log
                unit="fs"
                reg="Behavioral: sigma_v_fs"
                hint={
                  <>
                    <Tex>{r`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>
                  </>
                }
              />
              <ParamControl
                label={
                  <>
                    GMAC 長度 <Tex>{'N'}</Tex>
                  </>
                }
                ariaLabel="GMAC 長度 N"
                value={params.N}
                onChange={(N) => set({ N })}
                min={RANGES.N[0]}
                max={RANGES.N[1]}
                integer
                clampOnBlur
                unit="samples"
                reg="REG_GMAC_N"
              />
              <ToggleControl
                label={
                  <>
                    GMAC 用總和（sum）但沿用 average 的 <Tex>{r`\mu`}</Tex>（反面測試）
                  </>
                }
                ariaLabel="GMAC 用總和但沿用 average 的步長（反面測試）"
                value={params.sumMode}
                onChange={(sumMode) => set({ sumMode })}
                reg="gm_mode = sum"
              />
            </>
          )}
          <ToggleControl
            label="極性接反（comparator 的 0/1 映射或 GMAC 乘號錯）"
            value={params.polarity < 0}
            onChange={(v) => set({ polarity: v ? -1 : 1 })}
            reg="REG_CMP_POLARITY"
          />
          <ParamControl
            label="軌跡長度（畫幾步）"
            value={params.steps}
            onChange={(steps) => set({ steps })}
            min={RANGES.steps[0]}
            max={RANGES.steps[1]}
            integer
            clampOnBlur
            unit="steps"
            reg="Behavioral: steps"
          />
        </>
      }
    >
      <div className="table-wrap">
        <table className="papers-table">
          <caption className="small muted">
            同一個平均動態（相同的 <Tex>{'s'}</Tex>）在四種寫法下的步長，以及各自的上限（快模式 <Tex>{r`g=g^*(d)`}</Tex>，即 <Tex>{r`s=g^*(d)/\lambda_{\max}`}</Tex>
            ；NLMS 另受單筆收縮界限限制）
          </caption>
          <thead>
            <tr>
              <th>寫法</th>
              <th className="num">等效步長</th>
              <th className="num">步長上限</th>
              <th>換算關係</th>
            </tr>
          </thead>
          <tbody>
            {CONVENTIONS.map((c) => (
              <tr key={c} className={c === deferred.convention ? 'papers-row-hl' : undefined}>
                <td>{mathText(CONVENTION_SHORT[c])}</td>
                <td className="num mono">
                  <Num x={res.equivalents[c]} digits={5} /> {STEP_UNIT[c] === 'fs' ? 'fs' : ''}
                </td>
                <td className="num mono">
                  <Num x={res.boundsShown[c]} digits={5} /> {STEP_UNIT[c] === 'fs' ? 'fs' : ''}
                </td>
                <td>
                  <Tex>
                    {c === 'half'
                      ? r`s=\mu`
                      : c === 'widrow'
                        ? r`s=2\mu_W`
                        : c === 'nlms'
                          ? r`s\approx\tilde\mu/(\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R)`
                          : r`s=\mu K_q\,(\times N\ \text{if sum})`}
                  </Tex>
                  {c === 'nlms' && res.nlmsCapped && (
                    <div className="small muted">
                      上限取 a posteriori 界限 <Tex>{r`2(\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R)/\mathrm{tr}\,\mathbf R`}</Tex>；平均模型的{' '}
                      <Tex>{texNum(res.bounds.nlms, 5)}</Tex> 較寬，只保證 <Tex>{r`E[\boldsymbol\delta]`}</Tex> 收斂
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Plot
        title={r`各 eigen-mode 的平均誤差 $|c_{i,k}|$（$c_{i,0}=1$；虛線為 $|z|_{\max}^{\,k}$ 包絡）`}
        ariaLabel="各 eigen-mode 的平均誤差軌跡"
        data={trajData}
        yLog
        height={300}
        csvName="papers-convention-trajectory"
        layout={{ xaxis: { title: { text: '$k$（step / block）' } }, yaxis: { title: { text: '$|c_{i,k}|$' } } }}
      />
      <Plot
        title={r`最大根的模 $|z|_{\max}$ 對 $g$：延遲把穩定區從 $g<2$ 縮到 $g<g^*(d)$`}
        ariaLabel="最大根的模對 loop gain 的曲線"
        data={curveData}
        xLog
        height={300}
        csvName="papers-convention-radius"
        layout={{ xaxis: { title: { text: '$g = s\\lambda$' } }, yaxis: { title: { text: '$|z|_{\\max}$' }, range: [0, 2] } }}
      />
      <p className="small muted">
        試試看：(1) 載入「延遲 d = 2、g = 0.7：極性正確仍發散」preset，把 <Tex>{'d'}</Tex> 改成 <Tex>{'0'}</Tex>，快模式就收斂了；(2) 把{' '}
        <Tex>{r`\rho`}</Tex> 調到 <Tex>{'0.999'}</Tex>，慢模式要很久才衰減，這就是「穩定」與「夠快」之間的 eigenvalue spread 取捨；(3) 載入 T13 preset
        後打開「GMAC 用總和」，看 <Tex>{'g'}</Tex> 被放大 <Tex>{'N'}</Tex> 倍。
      </p>
    </ExperimentShell>
  )
}
