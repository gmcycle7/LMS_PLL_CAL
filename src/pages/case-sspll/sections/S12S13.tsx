import { Callout, ModeGate, Section, StepDerivation, Tex } from '@/components'
import { eqOffset } from '@/simulation/models/sspll'
import { LOOP_KEYS, PARAMS, PRED, SIM_CFG, offsetPoint, type LoopKey } from '../data'
import { Claim, DataTable, Diagram, Formula, Hand, ModelCode, Sci, Src, fmtFs, fx, r, tx, txs } from '../common'

/** pole = 1 − 1/N_τ 的精確 e-folding 時間 [blocks]：−1/ln|1 − 1/N_τ|（N_τ 只是它在小步長時的近似，所以叫「名義」值） */
const eFold = (n: number): number => -1 / Math.log(Math.abs(1 - 1 / n))

/** §12 有限步長 */
export function S12FiniteStep() {
  const fm = PARAMS.remedy_kernels.finite_mu
  const taus = [25, 10, 5]
  const exTxt = (k: LoopKey, tau: number) => {
    const e = fm[`${k}|tau${tau}`]
    return e ? `${e.n}` : '–'
  }
  const ex2 = fm['L2|tau25'].examples
  const ex3 = fm['L3|tau25'].examples
  // L2 帶緣的例子：整個複數代進判據，和「只代實部」的差別
  const [exRe, exIm] = ex2[0][1]
  const exTau = 25
  return (
    <Section kind="formula" level={2} title="12. 有限步長：$\mathrm{Re}\,\kappa>0$ 還不夠" id="cs-12">
      <p>
        §4 的結論「<Tex>{r`\mathrm{Re}\,\mathrm{eig}(C)>0`}</Tex> 就收斂」只在步長很小時成立。原因是 <Tex>{'C'}</Tex> 的特徵值可以是複數：實部把誤差拉回來，虛部讓誤差旋轉；步長一大，旋轉造成的 overshoot 可能比拉回來的量還多。§8 的表格與上下界列的是實部 <Tex>{r`\mathrm{Re}\,\kappa_m`}</Tex>；這一節要用整個複數{' '}
        <Tex>{r`\kappa_m=8\lambda_m`}</Tex>。
      </p>
      <Diagram id="finite-step" />
      <p>
        先看迴圈：這是 §4 <Tex>{r`\delta_{k+1}=\delta_k-\mu K_qC\delta_k`}</Tex> 沿著一個特徵方向的版本，<Tex>{r`\theta_k`}</Tex> 是誤差在那個方向上的分量（一個複數），每個 block 被扣掉 <Tex>{r`\kappa/N_\tau`}</Tex> 倍的自己。這裡把步長換成比較好懂的量 <Tex>{r`N_\tau`}</Tex>（單位是 block）：沒有迴路（<Tex>{r`H\equiv1`}</Tex>、<Tex>{r`\kappa=1`}</Tex>）時，LMS 每個 block 修掉誤差的{' '}
        <Tex>{r`1/N_\tau`}</Tex>，也就是誤差乘上 <Tex>{r`1-1/N_\tau`}</Tex>；<Tex>{r`N_\tau`}</Tex> 越小，步長越大。<Tex>{r`N_\tau`}</Tex> 習慣上叫做開迴路的名義時間常數，這是小步長時的近似說法：誤差降到 <Tex>{'1/e'}</Tex> 實際要{' '}
        <Tex>{r`-1/\ln\lvert1-1/N_\tau\rvert`}</Tex> 個 block——<Tex>{r`N_\tau=25`}</Tex> 時是 {fx(eFold(25), 2)}，<Tex>{r`N_\tau=5`}</Tex> 時是 {fx(eFold(5), 2)} 而不是 5（<Tex>{`0.8^5=${tx(0.8 ** 5, 3)}<1/e=${tx(Math.exp(-1), 3)}`}</Tex>）。再看菱形：迴圈每轉一圈，誤差的大小乘上 <Tex>{r`\lvert1-\kappa/N_\tau\rvert`}</Tex>，它要小於 1 才會縮小。走到「否」有兩種情況：<Tex>{r`\mathrm{Re}\,\kappa\le0`}</Tex>（§4 說的反號），或者 <Tex>{r`\mathrm{Re}\,\kappa>0`}</Tex> 但 <Tex>{r`\lvert\kappa\rvert^2`}</Tex> 太大（這一節要講的新情況）。圖上的迴圈就是下面推導的第 1 步，菱形裡的不等式是第 3 步的結論。
      </p>
      <p>
        寫成式子：block 更新 <Tex>{r`\theta_{k+1}=(I-\mu K_qC)\theta_k`}</Tex>。以 sim 的正規化（<Tex>{r`\mu K_q=8/N_\tau`}</Tex>、<Tex>{r`\kappa=8\lambda`}</Tex>，所以沿特徵方向 <Tex>{r`\mu K_q\lambda=\kappa/N_\tau`}</Tex>）；下面只用到每個 block 的乘數，沒有用到「
        <Tex>{r`N_\tau`}</Tex> 個 block 降到 <Tex>{'1/e'}</Tex>」的近似，所以對任何步長都成立：
      </p>
      <StepDerivation
        steps={[
          { tex: r`\theta_{k+1}=\Big(1-\frac{\kappa}{N_\tau}\Big)\theta_k`, why: <>沿一個特徵方向（<Tex>{r`\kappa`}</Tex> 可以是複數）。</> },
          { tex: r`\Big\lvert1-\frac{\kappa}{N_\tau}\Big\rvert^2=1-\frac{2\,\mathrm{Re}\,\kappa}{N_\tau}+\frac{\lvert\kappa\rvert^2}{N_\tau^2}<1`, why: '複數的模平方展開；每個 block 誤差的大小乘上這個因子的平方根。' },
          { tex: r`\iff\mathrm{Re}\,\kappa>\frac{\lvert\kappa\rvert^2}{2N_\tau}`, why: <>移項，乘以 <Tex>{r`N_\tau/2`}</Tex>。</> },
        ]}
      />
      <Formula id="F-CS.18" />
      <p>
        在帶緣附近 <Tex>{r`\mathrm{Re}\,\kappa\to0^+`}</Tex>，而 <Tex>{r`\mathrm{Im}\,\kappa`}</Tex> 約 {fx(ex3[0][1][1], 2)}–{fx(ex2[0][1][1], 2)}，所以有限步長會把有效的反號帶稍微加寬。golden 在 <Tex>{r`j/4096`}</Tex> 上統計「小 <Tex>{r`\mu`}</Tex> 判為穩定（
        <Tex>{r`\mathrm{Re}\kappa>10^{-6}`}</Tex>）、但有限步長不穩定」的 <Tex>{r`\alpha`}</Tex> 個數：
      </p>
      <DataTable className="cs-num" head={['', ...taus.map((t) => <Tex key={t}>{`N_\\tau=${t}`}</Tex>)]} rows={(['L2', 'L3'] as LoopKey[]).map((k) => [k, ...taus.map((t) => exTxt(k, t))])} />
      <p>
        例：L2 在 {fx(ex2[0][0], 1)} MHz 的 <Tex>{`\\kappa=${tx(ex2[0][1][0], 4)}+${tx(ex2[0][1][1], 4)}j`}</Tex>；L3 在 {fx(ex3[0][0], 1)} MHz 的 <Tex>{`\\kappa=${tx(ex3[0][1][0], 4)}+${tx(ex3[0][1][1], 4)}j`}</Tex>。
        <Claim kind="approx">同 F-CS.18：小訊號線性化平均模型內的判斷</Claim>
        以 L2 這一點為例：<Tex>{`\\lvert\\kappa\\rvert^2/(2N_\\tau)=${tx((exRe * exRe + exIm * exIm) / (2 * exTau), 4)}`}</Tex> 比 <Tex>{`\\mathrm{Re}\\,\\kappa=${tx(exRe, 4)}`}</Tex> 大，所以 <Tex>{`N_\\tau=${exTau}`}</Tex> 時不穩定。如果只把 §8 的實部代進去，會算成{' '}
        <Tex>{`(\\mathrm{Re}\\,\\kappa)^2/(2N_\\tau)\\approx${txs((exRe * exRe) / (2 * exTau), 2)}`}</Tex>，誤判成穩定。一階差分有 disc constant（§11.1），所以不會有這個問題。另外要記得 §4.2 的推導就用到的兩個前提：Bussgang 小訊號（<Tex>{r`\lvert e\rvert\ll\sigma_v`}</Tex>），以及 LMS
        適應與迴路暫態的時間尺度分離（§4.2 把 <Tex>{r`\delta_j`}</Tex> 提到卷積外面的那一步）。
      </p>
      <ModeGate min="engineer">
        <ModelCode region="blockMeanStable" title="有限步長的平均穩定判據（實驗 B 的「有限步長」指標）" />
      </ModeGate>
      <Src>
        <code>params.json</code> 的 <code>remedy_kernels.finite_mu</code>；TS 的 <code>kappaRational</code> 與 <code>blockMeanStable</code> 在測試中重現 L2 的例子。
      </Src>
    </Section>
  )
}

/** params.json 的 offset.illustrative 以英文鍵值存放；這裡只翻譯標籤，數字仍由 JSON 讀取 */
const OFFSET_SOURCE_ZH: Record<string, string> = {
  '1 mV comparator offset, A = 0.4 V, f_vco 16 GHz': '比較器 offset 1 mV（$A=0.4$ V、16 GHz）',
  '5 mV': '比較器 offset 5 mV',
  'CPPLL 5% UP/DN mismatch x 50 ps reset': 'CPPLL：5% UP/DN mismatch $\\times$ 50 ps reset',
  'Type-I SSPLL static phase error at 100 ppm': 'Type-I SSPLL，殘餘頻差 100 ppm 的 static phase error',
  'Type-I SSPLL static phase error at 1000 ppm': 'Type-I SSPLL，殘餘頻差 1000 ppm 的 static phase error',
}

/** §13 比較器 DC offset：線性分析裡看不到的一階效應 */
export function S13Offset() {
  const sig = SIM_CFG.sigmaPs * 1000
  const a137 = offsetPoint('L2|137/1000|u=25')
  const a123 = offsetPoint('L2|123/1000|u=25')
  const mapU = PARAMS.offset.points['L2|map_u25'] as { raw_median_fs: number; raw_frac_gt_1ps: number; ac_median_fs: number }
  const ol = PRED.offset_lms
  const ng = PRED.offset_neargrid_u100
  const row = (alpha: string, u: number) => [
    <>
      <Tex>{`\\alpha=${alpha}`}</Tex>、<Tex>{`u_{os}=${u}`}</Tex> fs
    </>,
    ...(['raw', 'zm', '1diff'] as const).map((v) => {
      const x = ol[`L2|${alpha}|u=${u}|${v}`]
      return (
        <>
          GOS {fmtFs(x.gos_fs)}；共模 {x.phos_cm_fs < 1e-6 ? '0' : fmtFs(x.phos_cm_fs)}
        </>
      )
    }),
  ]
  return (
    <Section kind="assumptions" level={2} title="13. 比較器 DC offset：線性分析裡看不到的一階效應" id="cs-13">
      <p>
        前面所有特徵值分析都假設 <Tex>{'E[q]=0'}</Tex>。實際上比較器一定看到 DC，來源包括：比較器 offset、SSCP／gm offset、CPPLL 的 UP/DN mismatch 與 bleeder、Type-I 在殘餘頻差下的 static phase error。把這些 DC 全部折算到比較器輸入端，記為等效 offset <Tex>{r`u_{os}`}</Tex>（單位
        fs）。它造成的問題和「反號」是兩回事：它不改變恢復力的方向，而是多出一股一直往同一邊推的力。
      </p>
      <Diagram id="offset" />
      <p>
        先看紅色的路徑：<Tex>{r`u_{os}`}</Tex> 和殘差、雜訊一起進比較器，使 <Tex>{'q[n]'}</Tex> 的 +1 比 −1 多一點，平均值 <Tex>{'E[q]'}</Tex> 不再是 0。這個平均值在乘法點遇到 regressor 的平均值 <Tex>{r`\langle r_i\rangle`}</Tex>：raw 的 GOS regressor 平均是 1/2、one-hot 平均是 1/8，都不是 0，所以乘積的平均多出一項{' '}
        <Tex>{r`E[q]\,\langle r_i\rangle`}</Tex>。它和權重誤差 <Tex>{r`\delta`}</Tex> 無關，權重對了它也還在，這就是 forcing。再看綠色那一格：regressor 若是 zero-mean（一階差分天生如此；或把平均減掉），<Tex>{r`\langle r_i\rangle=0`}</Tex>，這條路就斷了。圖上 block 平均之後分出的兩格，就是下面推導第 2 步的兩項。
      </p>
      <StepDerivation
        title="一步一步：offset 是 forcing 項"
        steps={[
          {
            tex: r`E[q\mid e]\approx\underbrace{\mathrm{erf}\!\Big(\frac{u_{os}}{\sqrt2\sigma_v}\Big)}_{E[q]}+K_q(u_{os})\,e,\qquad K_q(u)=\sqrt{\tfrac2\pi}\frac{e^{-u^2/2\sigma_v^2}}{\sigma_v}`,
            why: <>在 <Tex>{r`u_{os}`}</Tex> 附近做泰勒展開，而不是在 0 附近；斜率是 erf 在該點的導數。</>,
          },
          { tex: r`E[G_i]\approx E[q]\,\langle r_i\rangle+K_q(u_{os})\,(C\delta)_i`, why: <>第一項是 <strong>forcing 項</strong>，與誤差無關，所以不會出現在 <Tex>{r`\mathrm{eig}(C)`}</Tex> 裡。</> },
          { tex: r`\delta_{GOS}^{\star}=-\frac{E[q]\,\langle\rho\rangle}{K_q(u_{os})\,C_{GOS}}\quad(\text{raw})`, why: <>令上式為 0 解出穩態偏差。<Tex>{r`\langle\rho\rangle\approx\tfrac12`}</Tex> 不為 0，所以 raw GOS 一定偏。</> },
          {
            tex: r`\textstyle\sum_k E[G_{1+k}]=E[q]\cdot\textstyle\sum_k\langle\mathbf 1\{p=k\}\rangle=E[q]`,
            why: <>PHOS 共模（全 1 方向）的更新只受 forcing 推動，而共模的恢復力 <Tex>{r`\lambda_0=0`}</Tex>，所以<strong>一直漂移</strong>，直到 DTC range 溢位。</>,
          },
        ]}
      />
      <Formula id="F-CS.19" />
      <p>
        <strong>
          數字（<Tex>{`\\sigma_v=${fx(sig, 0)}`}</Tex> fs）
        </strong>
        ：
      </p>
      <ul>
        <li>
          <Tex>{r`u_{os}=25`}</Tex> fs（約 1 mV @ <Tex>{'A=0.4'}</Tex> V、16 GHz，插圖值）時 <Tex>{`E[q]=${tx(eqOffset(25, sig), 4)}`}</Tex>。
        </li>
        <li>
          L2 <Tex>{r`\alpha=0.137`}</Tex>：raw 的 GOS 偏差 <strong>{fx(a137.gos_bias_raw_fs, 1)} fs</strong>，<code>ac</code> 剩 {fx(a137.gos_bias_ac_fs, 2)} fs。
        </li>
        <li>
          L2 <Tex>{r`\alpha=0.123`}</Tex>（near-grid，<Tex>{`12C=${tx(a123.twelveC, 4)}`}</Tex>）：raw <strong>{fx(a123.gos_bias_raw_fs, 0)} fs</strong>，<code>ac</code> {fx(a123.gos_bias_ac_fs, 1)} fs。
        </li>
        <li>
          全部 2047 個 <Tex>{r`j/4096`}</Tex> 頻道（L2）：raw 偏差中位數 {fx(mapU.raw_median_fs, 1)} fs，其中 {fx(mapU.raw_frac_gt_1ps * 100, 1)}% 超過 1 ps；<code>ac</code> 中位數 {fx(mapU.ac_median_fs, 2)} fs。
        </li>
      </ul>
      <Hand id="HC-CS.7">{r`預設值就是上面第二點（L2、$\alpha=0.137$、$u_{os}=25$ fs）。換成你的比較器 offset 與 $\sigma_v$，先查表算 $E[q]$，再算偏差；也試試把 $\langle\rho\rangle$ 改成 0。`}</Hand>
      <DataTable head={['閉迴路 LMS（L2，4000 blocks）', 'raw', 'zm', '1diff']} rows={[row('0.137', 0), row('0.137', 25), row('0.137', 100), row('0.123', 25)]} />
      <p>
        <strong>near-grid 的細節</strong>：<Tex>{r`\alpha=0.123`}</Tex>、<Tex>{r`u_{os}=100`}</Tex> fs 時，zero-mean regressor 是否夠用，取決於有理 <Tex>{r`\alpha`}</Tex> 的哪一側（殘差平均的符號）與雜訊 seed：
      </p>
      <DataTable
        className="cs-num"
        head={['序列', 'zm 的 GOS（3 個 seed）', '1diff 的 GOS（3 個 seed）']}
        rows={(
          [
            ['right', 'exact rational，right limit'],
            ['left', 'exact rational，left limit'],
            ['acc32', 'sim 的 32-bit 累加器'],
          ] as [string, string][]
        ).map(([k, label]) => [label, <>{ng[`${k}|zm`].map((v, i) => <span key={i}>{i ? '、' : ''}{fmtFs(v)}</span>)}</>, <>{ng[`${k}|1diff`].map((v, i) => <span key={i}>{i ? '、' : ''}{fmtFs(v)}</span>)}</>])}
      />
      <p>
        <Claim kind="approx" />
        機制是：offset 把小剛性的 near-grid GOS 推到大振幅，進入大訊號反向區（§10）。所以 <strong>zero-mean 是必要條件但不保證</strong>；Type-II near-grid 應優先用 1diff。
      </p>
      <p>
        <strong>量級（插圖值）</strong>：
      </p>
      <DataTable
        className="cs-num"
        head={['來源', <Tex key="u">{'u'}</Tex>, <Tex key="e">{'E[q]'}</Tex>, <Tex key="k">{r`K_q/K_{q0}`}</Tex>]}
        rows={Object.entries(PARAMS.offset.illustrative).map(([name, v]) => [OFFSET_SOURCE_ZH[name] ?? name, v.u_fs >= 1000 ? `${fx(v.u_fs / 1000, 1)} ps` : `${fx(v.u_fs, 1)} fs`, fx(v.Eq, 3), v.Kq_ratio < 1e-3 ? <Sci key="k" v={v.Kq_ratio} sig={2} /> : fx(v.Kq_ratio, 3)])}
      />
      <Callout kind="danger" title="CPPLL 的 static offset 會讓 1-bit 比較器失明">
        <p>
          CPPLL 的 static offset 遠大於 <Tex>{r`\sigma_v`}</Tex>，1-bit 比較器會完全飽和（<Tex>{r`K_q\to0`}</Tex>），LMS 等於失明。必須先把比較器門檻 trim 到 PD 的 static 工作點，或讓門檻追蹤 SSPD 的平均值。
        </p>
      </Callout>
      <p>
        <strong>結論</strong>：<strong>所有對策都要搭配 zero-mean regressor</strong>（1diff 天生滿足；<code>zm</code> 要減掉實際平均，PHOS 也要減 1/8），並對比較器做 offset trim。{LOOP_KEYS.length} 個迴路在 <Tex>{r`u_{os}=25`}</Tex> fs 時 raw 偏差的中位數都在{' '}
        {fx(Math.min(...LOOP_KEYS.map((k) => (PARAMS.offset.points[`${k}|map_u25`] as { raw_median_fs: number }).raw_median_fs)), 0)}–{fx(Math.max(...LOOP_KEYS.map((k) => (PARAMS.offset.points[`${k}|map_u25`] as { raw_median_fs: number }).raw_median_fs)), 0)} fs——與迴路型態無關。
      </p>
      <Src>
        <code>params.json</code> 的 <code>offset</code>（公式值）與 <code>pred_vs_sim.json</code> 的 <code>offset_lms</code>、<code>offset_neargrid_u100</code>（golden 的閉迴路 LMS）；TS 的 <code>gosOffsetBias</code> 在測試中重現 {fx(a137.gos_bias_raw_fs, 1)} fs。實驗 C 可以自己加 offset 重跑。
      </Src>
    </Section>
  )
}
