import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ModeGate, Plot, Section, SelectControl, SourceTag, Tex, mathText, useThemeTokens } from '@/components'
import { FREF_MHZ, LMS_NOTE_ZH, LOOP_KEYS, PARAMS, PRED, SIM_CFG, type LoopKey, type LsCount } from '../data'
import { Claim, DataTable, Diagram, Formula, Kappa, ModelCode, Src, fmtFs, fp, fx, intervalsText, loopTex, r } from '../common'

const COUNT_VARIANTS: [string, string][] = [
  ['raw', 'raw'],
  ['1diff', '1diff'],
  ['2diff', '2diff'],
  ['fx:exact', 'fx（exact）'],
  ['fx:bw0.8', 'fx（BW −20%）'],
  ['fx:bw1.2', 'fx（BW +20%）'],
  ['D:1', '$D=1$'],
]

const LS_VARIANTS: [string, string][] = [
  ['raw', 'raw'],
  ['ac', 'ac（GOS 去平均）'],
  ['1diff', '1diff'],
  ['fx:exact', 'fx exact'],
  ['P-only|raw', 'P-only + raw'],
  ['P-only|ac', 'P-only + ac'],
]

const LMS_CASES: [string, string][] = [
  ['L2|0.02', 'L2 $\\alpha=0.02$（80 MHz，帶內）'],
  ['L2|0.002', 'L2 $\\alpha=0.002$（8 MHz，dead zone）'],
  ['L2|0.496', 'L2 $\\alpha=0.496$（alias）'],
  ['L2|0.253', 'L2 $\\alpha=0.253$（alias）'],
  ['L3|0.016', 'L3 $\\alpha=0.016$（64 MHz）'],
  ['L3|0.002', 'L3 $\\alpha=0.002$'],
  ['L1|0.02', 'L1 $\\alpha=0.02$'],
]
const LMS_COLS: [string, string][] = [
  ['raw', 'raw'],
  ['1diff', '1diff'],
  ['fx:exact', 'fx exact'],
  ['raw|Ponly', 'P-only（raw）'],
  ['ac|Ponly', 'P-only + ac'],
]

type FineQty = 'small' | 'large'

/** fine grid（α = 0.001…0.500）的預測 vs 時域 sim；資料全部來自 pred_vs_sim.json */
function FinePlot() {
  const tokens = useThemeTokens()
  const [loop, setLoop] = useState<LoopKey>('L2')
  const [qty, setQty] = useState<FineQty>('small')
  const data: Data[] = useMemo(() => {
    const f = PRED.fine.alpha.map((a) => a * FREF_MHZ)
    const d = PRED.fine[loop]
    if (qty === 'small')
      return [
        { x: f, y: d.kP_theory, name: 'raw：理論（精確週期，sim 的正規化）', mode: 'lines', line: { color: tokens.series[0], width: 2 } },
        { x: f, y: d.kP_sim, name: 'raw：時域 sim（erf estimator）', mode: 'markers', marker: { size: 4, color: tokens.series[1] } },
        { x: f, y: d.kP_theory_1diff, name: '1diff：理論', mode: 'lines', line: { color: tokens.series[2], width: 2 } },
        { x: f, y: d.kP_sim_1diff, name: '1diff：時域 sim', mode: 'markers', marker: { size: 4, color: tokens.series[3], symbol: 'diamond' } },
      ]
    return [
      { x: f, y: d.LSinf_theory, name: '$A\\to\\infty$：$\\kappa_\\infty$（理論，6 個方向的最差值）', mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: f, y: d.LS_sim_A5ps, name: '$A=5$ ps：時域 sim 的割線斜率', mode: 'markers', marker: { size: 4, color: tokens.series[1] } },
      { x: f, y: d.LS_sim_A1ps, name: '$A=1$ ps：時域 sim 的割線斜率', mode: 'markers', marker: { size: 4, color: tokens.series[3], symbol: 'diamond' } },
      { x: f, y: d.kP_theory, name: '小訊號 $\\kappa_{\\mathrm{PHOS}}$（對照）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
    ]
  }, [loop, qty, tokens])
  return (
    <div className="card">
      <div className="cs-inline-controls">
        <SelectControl label="迴路" value={loop} onChange={setLoop} options={LOOP_KEYS} />
        <SelectControl
          label="比較的量"
          value={qty}
          onChange={setQty}
          options={[
            { value: 'small', label: '小訊號 κ_PHOS：raw 與 1diff' },
            { value: 'large', label: '大訊號：κ∞ 與 A = 1、5 ps 的割線斜率' },
          ]}
        />
      </div>
      <Plot
        title={`${loopTex(loop)}：預測（線）vs 時域 sim（點），$\\alpha=0.001\\ldots0.500$`}
        data={data}
        xLog
        height={340}
        csvName={`sspll-pred-vs-sim-${loop}-${qty}`}
        layout={{
          xaxis: { title: { text: '$\\alpha\\cdot f_{\\mathrm{ref}}$ [MHz]' } },
          yaxis: { title: { text: '$\\kappa$（$>0$ restoring；$<0$ 反號）' } },
          shapes: [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }],
        }}
        caption="資料：pred_vs_sim.json 的 fine（golden 的理論與 analysis/sspll/sim 的時域模擬；非本頁即時模擬）。"
      />
      <p className="small">
        <SourceTag kind="simulation" />
      </p>
    </div>
  )
}

/** §10 模擬證據：預測與時域 sim 的比對、大訊號「持續時間 vs 面積」、閉迴路 LMS。 */
export function S10Sim() {
  const sel = PRED.selected
  const excerpt = [0.01, 0.016, 0.02, 0.03, 0.123, 0.247, 0.496]
  const cnt = PRED.counts
  const ls = PRED.large_signal_counts
  const web = PARAMS.signmap_summary
  const l1dirs = ls.L1.L1_raw_inf_dirs
  const epsRmsFs = Math.sqrt(SIM_CFG.epsPs.reduce((a, e) => a + e * e, 0) / SIM_CFG.epsPs.length) * 1000
  return (
    <Section kind="example" level={2} title="10. 模擬證據：預測與時域 sim 的比對" id="cs-10">
      <h3>10.1 sim 的量測方式</h3>
      <p>
        <code>analysis/sspll/sim</code> 是獨立寫的時域模型（<SourceTag kind="simulation" />）：
      </p>
      <ul>
        <li>
          每個 reference cycle 一步，32-bit 累加器，物理注入模型 <Tex>{r`u=c\Delta+\varepsilon_p-(1-a)(1+w_g)(c\Delta+w_p)`}</Tex>，<Tex>{`a=${SIM_CFG.a}`}</Tex>，<Tex>{r`\varepsilon_k`}</Tex> 取 seed {PARAMS.assumptions.sim_physics.eps_seed}（以標準差 0.25 ps 抽 8 個值再去平均；這 8 個值實際的 rms 是 {fx(epsRmsFs, 0)} fs），
          <Tex>{`f_{vco}=${PARAMS.assumptions.f_vco_Hz_illustrative / 1e9}`}</Tex> GHz（插圖值）。
        </li>
        <li>
          把 LMS 凍結在校準點，對每個權重做 <Tex>{r`\pm30`}</Tex> fs 的擾動，記錄 <Tex>{'2^{16}'}</Tex> 個 sample 的 GMAC 平均，得到斜率矩陣。'erf' estimator 是對比較器雜訊的精確平均（<Tex>{`\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}`}</Tex> fs）。
        </li>
        <li>
          正規化：除以同一段紀錄在 <Tex>{r`H\equiv1`}</Tex> 時的開迴路值。
        </li>
      </ul>
      <Diagram id="sim-measure" />
      <p>
        圖分成兩列：每一列由左往右、兩列由上往下，就是量測的順序。先看前四格（第一列的三格加第二列的第一格）：LMS 不動，只把某一個權重推開一點點，看 GMAC 的平均跟著變多少，這個斜率就是「LMS 會用多大的力把它拉回來」。再看第二列中間藍色的那一格：同一段紀錄再用 <Tex>{r`H_{PD}\equiv1`}</Tex>（把主迴路拿掉）算一次，兩者相除。所以 sim 報出來的{' '}
        <Tex>{r`\kappa`}</Tex> 和理論的 <Tex>{r`\kappa`}</Tex> 是同一個意思：1 表示和沒有迴路時一樣，負值表示主迴路把恢復力變成推力。
      </p>
      <p>
        golden 有兩種對照：(1) <code>replica_S</code>：照同樣流程重算一次（deterministic），與 sim 存檔的 <Tex>{r`\kappa`}</Tex> 差在 <Tex>{r`10^{-5}`}</Tex> 以內。
        <Claim kind="exact" />
        (2) <code>theory_point</code>：用同樣的物理模型與累加器那一側（left/right limit）計算 exact periodic steady state。
      </p>

      <h3>
        10.2 選定 <Tex>{r`\alpha`}</Tex> 的 <Tex>{r`\kappa_{PHOS}`}</Tex>：七種算法並排
      </h3>
      <DataTable
        className="cs-num"
        caption={
          <>
            L2（Type-II SSPLL）。sim／replica／exact 用 sim 的正規化與物理模型；<Tex>{r`8\lambda`}</Tex> 有理／ergodic／mode-1／單線是理想模型。GOS sim 保留 regressor 的 DC，所以與 <Tex>{'12C'}</Tex> 約差 4 倍。
          </>
        }
        head={[
          <><Tex>{r`\alpha`}</Tex>（MHz）</>,
          'sim',
          'replica',
          'exact',
          <><Tex>{r`8\lambda`}</Tex> 有理</>,
          'ergodic',
          'mode-1',
          <>單線 <Tex>{r`W_1\mathrm{Re}H`}</Tex></>,
          'GOS sim',
          <>GOS <Tex>{'12C'}</Tex></>,
          <>大訊號 <Tex>{r`\kappa_\infty`}</Tex></>,
        ]}
        rows={sel.L2.map((x) => [
          `${x.alpha}（${fx(x.f_MHz, 0)}）`,
          <Kappa key="a" v={x.kP_sim} />,
          <Kappa key="b" v={x.kP_replica} />,
          <Kappa key="c" v={x.kP_exact_simnorm} />,
          <Kappa key="d" v={x.kP_8lam_rational} />,
          <Kappa key="e" v={x.kP_8lam_ergodic} />,
          <Kappa key="f" v={x.kP_m1_ergodic} />,
          <Kappa key="g" v={x.kP_single_line} />,
          <Kappa key="h" v={x.kG_sim} />,
          <Kappa key="i" v={x.kG_12C_ergodic} />,
          <Kappa key="j" v={x.LS_kinf_worst} digits={3} />,
        ])}
      />
      <DataTable
        className="cs-num"
        caption="L1 與 L3（節錄）。"
        head={[<Tex key="a">{r`\alpha`}</Tex>, 'L1 sim', 'L1 exact', <>L1 GOS <Tex>{'12C'}</Tex></>, <>L1 <Tex>{r`\kappa_\infty`}</Tex></>, 'L3 sim', 'L3 exact', 'L3 ergodic', <>L3 <Tex>{r`\kappa_\infty`}</Tex></>]}
        rows={excerpt.flatMap((a) => {
          const x1 = sel.L1.find((x) => x.alpha === a)
          const x3 = sel.L3.find((x) => x.alpha === a)
          if (!x1 || !x3) return []
          return [
            [
              String(a),
              <Kappa key="a" v={x1.kP_sim} />,
              <Kappa key="b" v={x1.kP_exact_simnorm} />,
              <Kappa key="c" v={x1.kG_12C_ergodic} />,
              <Kappa key="d" v={x1.LS_kinf_worst} digits={3} />,
              <Kappa key="e" v={x3.kP_sim} />,
              <Kappa key="f" v={x3.kP_exact_simnorm} />,
              <Kappa key="g" v={x3.kP_8lam_ergodic} />,
              <Kappa key="h" v={x3.LS_kinf_worst} digits={3} />,
            ],
          ]
        })}
      />
      <p>怎麼讀這張表：</p>
      <ul>
        <li>
          <strong>單線近似</strong>（只看 <Tex>{r`\alpha f_{ref}`}</Tex> 那一點的 <Tex>{r`\mathrm{Re}H`}</Tex>）在近整數時過度悲觀，在 alias 區則完全看不到問題（上表 <Tex>{r`\alpha=0.247`}</Tex>：單線為正，精確值卻落在 dead zone）。所以<strong>不能只用{' '}
          <Tex>{r`\mathrm{Re}H(\alpha f_{ref})`}</Tex> 判斷</strong>。
        </li>
        <li>
          <strong>GOS 的「4 倍」</strong>：sim 的 GOS 正規化參考保留了 regressor 的 DC（<Tex>{r`(1-a)\langle c^2\rangle\approx0.97/3`}</Tex>），理論用 <Tex>{r`\mathrm{var}(\rho)=1/12`}</Tex>。golden 算出 <Tex>{r`12C/\kappa^{sim}_{GOS}`}</Tex> 的中位數：
          {LOOP_KEYS.map((k) => `${k} ${fx(cnt[k].raw.gos_ratio_12C_over_sim_median, 3)}`).join('、')}（L2 的 5–95% 為 {fx(cnt.L2.raw.gos_ratio_5_95?.[0], 2)}–{fx(cnt.L2.raw.gos_ratio_5_95?.[1], 2)}）。這只是約定不同，不是物理差異。
        </li>
      </ul>

      <h3>
        10.3 整個 fine grid（<Tex>{r`\alpha=0.001\dots0.500`}</Tex>，500 點）的反號個數（<Tex>{r`\kappa<-10^{-3}`}</Tex>）
      </h3>
      <DataTable
        className="cs-num"
        head={['迴路', 'regressor', 'PHOS sim／理論', 'GOS sim／理論', <>最小 <Tex>{r`\kappa_{PHOS}`}</Tex> sim／理論</>]}
        rows={LOOP_KEYS.flatMap((k) =>
          COUNT_VARIANTS.filter(([v]) => cnt[k][v]).map(([v, label]) => {
            const c = cnt[k][v]
            const bad = c.sim_phos_inv > 0 || c.th_phos_inv > 0
            return [
              k,
              label,
              bad ? (
                <strong key="p" className="cs-neg">
                  {c.sim_phos_inv}／{c.th_phos_inv}
                </strong>
              ) : (
                `${c.sim_phos_inv}／${c.th_phos_inv}`
              ),
              `${c.sim_gos_inv}／${c.th_gos_inv}`,
              <>
                <Kappa v={c.sim_phos_min} />／<Kappa v={c.th_phos_min} />
              </>,
            ]
          }),
        )}
      />
      <p>
        <strong>
          raw 的 {cnt.L2.raw.sim_phos_inv}／{cnt.L2.raw.th_phos_inv}、{cnt.L3.raw.sim_phos_inv}／{cnt.L3.raw.th_phos_inv} 差在哪裡？
        </strong>{' '}
        用 sim 的 <strong>linear</strong> estimator 時，與理論在 <Tex>{r`\tau=10^{-3}`}</Tex> 的分類 <strong>{cnt.L2.raw['class_disagree_lin_tau0.001']} 個不一致</strong>。多出來的 {cnt.L2.raw['class_disagree_tau0.001']} 個（L2）、
        {cnt.L3.raw['class_disagree_tau0.001']} 個（L3）全部在 <Tex>{r`\alpha\approx\tfrac14`}</Tex> 附近：<Tex>{r`\pm30`}</Tex> fs 探測擾動下，比較器的 erf 非線性把一個 dead-zone 點推過門檻。三個迴路的 <Tex>{r`\lvert\kappa^{sim}_{erf}-\kappa^{th}\rvert\le`}</Tex>{' '}
        {fp(Math.max(...LOOP_KEYS.map((k) => cnt[k].raw.max_abs_diff_phos)), 2)}；在 <Tex>{r`\tau=10^{-2}`}</Tex> 下 sim 與理論 <strong>{cnt.L2.raw['class_disagree_tau0.01'] + cnt.L3.raw['class_disagree_tau0.01']} 個分類不一致</strong>；反號區間 L2 都是 <Tex>{r`\alpha\in`}</Tex>{' '}
        {intervalsText(cnt.L2.raw['sim_intervals_tau0.01'], 3)}、L3 都是 {intervalsText(cnt.L3.raw['sim_intervals_tau0.01'], 3)}。
        <Claim kind="exact" />
      </p>
      <FinePlot />
      <p>
        sim 與理論的差異來源：有限紀錄、累加器的 left/right limit、物理注入模型（<Tex>{'1-a'}</Tex>、<Tex>{r`\varepsilon/\Delta`}</Tex>）、有理數週期性、正規化約定、比較器非線性。另外還有 §13 補上的<strong>第七項：比較器／PD 的 DC 工作點（offset）</strong>。它在硬體上是一階效應，比前六項都大。
      </p>

      <h3>10.4 大訊號：1-bit 比較器看的是「持續時間」而不是「面積」</h3>
      <p>
        前面的分析都假設誤差比比較器的雜訊小很多（<Tex>{r`\lvert e_{PD}\rvert\ll\sigma_v`}</Tex>），這時比較器的平均輸出和 <Tex>{r`e_{PD}`}</Tex> 成正比（§4.2 的 Bussgang 線性化）。當誤差振幅 <Tex>{r`A\gg\sigma_v`}</Tex> 時，比較器幾乎每一拍都飽和，這個線性化就失效了。
      </p>
      <Callout kind="info" title="白話：面積 vs 持續時間">
        <p>
          線性相關看的是 <Tex>{r`y\cdot z`}</Tex> 的「<strong>面積</strong>」；sign 相關看的是 <Tex>{'y'}</Tex> 與 <Tex>{'z'}</Tex> 同號的「<strong>時間比例</strong>」。Type-II 的 <Tex>{r`h_{PD}`}</Tex> 有一條很長的小負尾巴：它的面積很小，持續時間卻很長，所以小訊號是 dead zone
          的地方，大訊號會穩健地反向。
        </p>
      </Callout>
      <Diagram id="large-signal" />
      <p>
        先看菱形之前：只讓某一個方向 <Tex>{'v'}</Tex> 的權重有誤差（振幅 <Tex>{'A'}</Tex>，波形 <Tex>{'d_v[n]'}</Tex>），它通過主迴路之後在 PD 的響應是 <Tex>{'y_v[n]'}</Tex>。再看分岔：小訊號那一路，比較器的平均輸出保留了 <Tex>{'y_v'}</Tex> 的大小，和 regressor{' '}
        <Tex>{'z_v'}</Tex> 相關得到的就是線性分析的 <Tex>{r`C_{vv}`}</Tex>；大訊號那一路（紅色），比較器只留下 <Tex>{'y_v'}</Tex> 的正負號，相關量變成「同號的時間比例」。圖上兩條路的終點，就是下面公式的兩個極限：<Tex>{r`A\to0`}</Tex> 時 <Tex>{r`g_v\to C_{vv}`}</Tex>，<Tex>{r`A\to\infty`}</Tex> 時得到{' '}
        <Tex>{r`\kappa_\infty`}</Tex>。沿方向 <Tex>{'v'}</Tex> 的割線斜率（GMAC 平均除以誤差振幅）是：
      </p>
      <Formula id="F-CS.20" />
      <p>
        其中 <Tex>{r`y_v=h_{PD}*d_v`}</Tex> 是誤差方向 <Tex>{'v'}</Tex> 在 PD 的響應，<Tex>{'z_v'}</Tex> 是對應的 regressor。
      </p>
      <p>
        <Claim kind="exact">極限推導</Claim>／<Claim kind="approx">只沿 6 個方向：GOS、m1c、m1s、m2c、m3c、m4，不是完整的非線性穩定域</Claim>
      </p>
      <DataTable
        className="cs-num"
        head={['迴路', 'regressor', <><Tex>{'A=1'}</Tex> ps periodic／sim</>, <><Tex>{'A=5'}</Tex> ps periodic／sim</>, <Tex key="i">{r`A\to\infty`}</Tex>, '最差 $\\kappa_\\infty$']}
        rows={LOOP_KEYS.flatMap((k) =>
          LS_VARIANTS.filter(([v]) => (ls[k] as Record<string, LsCount | undefined>)[v]).map(([v, label]) => {
            const c = (ls[k] as Record<string, LsCount>)[v]
            const inf = c['A=inf']
            return [
              k,
              label,
              c['A=1ps'] ? `${c['A=1ps'].periodic}／${c['A=1ps'].sim}` : '–',
              c['A=5ps'] ? `${c['A=5ps'].periodic}／${c['A=5ps'].sim}` : '–',
              inf.periodic > 0 ? <strong className="cs-neg">{inf.periodic}</strong> : <span className="cs-pos">0</span>,
              inf.periodic > 0 ? fx(inf.worst, 3) : '—',
            ]
          }),
        )}
        caption="fine grid 500 個 $\alpha$ 中反向的個數。periodic 理論與 sim 的個數完全相同。"
      />
      <p>
        L1 的 {l1dirs?.n} 個反向 <Tex>{r`\alpha`}</Tex> {l1dirs?.all_gos ? <strong>全部是 GOS</strong> : '不全是 GOS'}，在 <Tex>{'k/8'}</Tex> 正下方（<Tex>{r`\alpha=`}</Tex> {intervalsText(ls.L1.raw['A=inf'].intervals, 3)}）；改用 <code>ac</code>（GOS 去平均）後剩 {ls.L1.ac['A=inf'].periodic} 個。原因見 §16
        題 3。
      </p>
      <p>
        在網站的 2000 點 midpoint 網格上，<Tex>{r`A\to\infty`}</Tex>、raw 時的反號區間（<Tex>{r`\min(\alpha,1-\alpha)f_{ref}`}</Tex>，MHz）：
      </p>
      <ul>
        {LOOP_KEYS.map((k) => (
          <li key={k}>
            <strong>{k}</strong>：{intervalsText(web[k].large_signal_inverted_MHz)}，共 {web[k].n_large_signal_inverted} 點（改用 <code>ac</code> 後 {web[k].n_large_signal_inverted_ac} 點）。
          </li>
        ))}
      </ul>
      <p>
        <strong>大訊號的 keep-out 比小訊號寬得多</strong>：它涵蓋近整數的 dead zone、alias 區，以及 near-grid（<Tex>{'k/8'}</Tex>）的 GOS。
      </p>
      <ModeGate min="engineer">
        <ModelCode region="largeSignal" title="大訊號 $\kappa_\infty$ 的計算（實驗 B 的「大訊號 $\kappa_\infty$」指標）" caption="同一個 $y=h_{PD}*d$：線性相關用 $y\cdot z$，1-bit 相關只用 $\mathrm{sgn}(y)\cdot z$。" />
      </ModeGate>

      <h3>10.5 閉迴路 sign-error LMS（真 1-bit 比較器）</h3>
      <p className="small muted">{mathText(LMS_NOTE_ZH)}</p>
      <DataTable
        className="cs-num"
        head={['案例', ...LMS_COLS.map(([, label]) => label)]}
        rows={LMS_CASES.map(([key, label]) => [label, ...LMS_COLS.map(([suf]) => fmtFs(PRED.lms[`${key}|${suf}`]?.final_phos_rms_fs))])}
        caption={`最終的 PHOS 誤差 rms（起始 ${fx(PRED.lms['L2|0.02|raw'].init_phos_rms_fs, 0)} fs）。「–」＝沒有跑這個組合。`}
      />
      <DataTable
        className="cs-num"
        head={['案例', '量', 'raw', '對照']}
        rows={[
          ['L1 $\\alpha=0.122$（GOS near-grid）', '最終 $\\lvert$GOS 誤差$\\rvert$', fmtFs(PRED.lms['L1|0.122|raw'].final_gos_fs), <>ac：{fmtFs(PRED.lms['L1|0.122|ac'].final_gos_fs)}</>],
          ['L2 $\\alpha=0.137$（帶外）', '最終 PHOS rms', fmtFs(PRED.lms['L2|0.137|raw'].final_phos_rms_fs), <>2diff：{fmtFs(PRED.lms['L2|0.137|2diff'].final_phos_rms_fs)}；<Tex>{'D=1'}</Tex>：{fmtFs(PRED.lms['L2|0.137|D:1'].final_phos_rms_fs)}（GOS {fmtFs(PRED.lms['L2|0.137|D:1'].final_gos_fs)}）</>],
        ]}
      />
      <p>
        <Claim kind="approx">隨機模擬</Claim>
      </p>
      <Callout kind="warn" title="ps 級的「發散值」在硬體上不成立">
        <p>
          表中 ps 級的值是在<strong>無界的線性 SSPD 與無限 DTC range</strong> 下得到的。以 {PARAMS.assumptions.f_vco_Hz_illustrative / 1e9} GHz（插圖值）為例，SSPD 只在 <Tex>{`\\pm T_{vco}/4=\\pm${fx(SIM_CFG.deltaPs * 2, 1)}`}</Tex> ps 內單調，DTC range 約{' '}
          <Tex>{r`T_{vco}/8`}</Tex> = {fx(SIM_CFG.deltaPs, 1)} ps。所以實際會看到的是<strong>權重卡在 DTC 上限、SSPLL cycle slip、FLL dead zone 被觸發或失鎖</strong>。應加上 weight clamp 與 lock detector。收斂到 3–25 fs 的那些數字，則假設比較器沒有 offset（
          <Tex>{'E[q]=0'}</Tex>），見 §13。
        </p>
      </Callout>
      <Src>
        <code>pred_vs_sim.json</code>（<code>selected</code>、<code>counts</code>、<code>large_signal_counts</code>、<code>lms</code>）與 <code>params.json</code>（<code>signmap_summary</code>）。想自己跑閉迴路，見 §14 的實驗 C。
      </Src>
    </Section>
  )
}
