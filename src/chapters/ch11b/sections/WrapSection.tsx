import { useMemo } from 'react'
import { ClaimTag, CodeBlock, ModeGate, Quiz, Recap, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import goldenPy from '../../../../golden/lms_pll_golden/dtc_inl.py?raw'
import { MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4, foldedPsdDc, foldedPsdDcLinearProcess, foldingPrediction, inbandPower, lutApproxRms, lutClosedForm, segmentClosedForm } from '@/simulation/models/dtcInl'
import { m, texNum } from '../common'
import { F } from '../formulas'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

/** 比較表、綜合手算、思考題、本課必記、連結到 PLL。 */
export function WrapSection() {
  const q = useMemo(() => {
    const pred = foldingPrediction(MASH_CODE_AUTOCORR, { d2: 20, d3: 0 }, 0.01)
    const exact = inbandPower(400 * foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), 0.01)
    const exact2 = inbandPower(400 * foldedPsdDcLinearProcess(MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4), 0.02)
    const lut32 = lutClosedForm(32, 2, 10, 64)
    const lut64 = lutClosedForm(64, 2, 10, 64)
    return { pred, exact, exact2, s3: foldedPsdDc(MASH_CODE_AUTOCORR, 3), floor32: lutApproxRms({ d2: 20, d3: 0 }, 32), floor64: lutApproxRms({ d2: 20, d3: 0 }, 64), lut32, lut64, seg: segmentClosedForm(7, 8, 2, 10, 64), segHalf: segmentClosedForm(7, 8, 1, 10, 64) }
  }, [])

  return (
    <>
      <Section kind="assumptions" title="三種結構怎麼選：同一個 INL，三種代價" level={2} id="ch11b-compare">
        <div className="table-wrap">
          <table className="ch11b-table">
            <thead>
              <tr>
                <th>問題</th>
                <th>分段線性</th>
                <th>LUT</th>
                <th>多項式（正交基底）</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>INL 長什麼樣時合適</td>
                <td>segmented DTC：每個 coarse 段各有自己的 fine gain</td>
                <td>任何形狀（含鋸齒、跳變）</td>
                <td>平滑、低階（二次、三次）</td>
              </tr>
              <tr>
                <td>收斂</td>
                <td>{m('每段獨立；慢在 $x\\approx0$ 的段（$\\lambda_k\\propto x^2$）')}</td>
                <td>{m('每格獨立；$\\tau_j=J/(\\mu K_q)$，慢在造訪少的格')}</td>
                <td>{m('模式耦合；monomial $\\kappa=67.6$、Legendre 7、normalized 1')}</td>
              </tr>
              <tr>
                <td>穩態抖動</td>
                <td colSpan={3}>{m('三者相同：$\\operatorname{Var}\\approx\\mu/(2K_qN)$，與 $\\lambda_i$ 無關（F-11B.10）；misadjustment $=\\sum_i\\lambda_i\\operatorname{Var}(\\xi_i)$')}</td>
              </tr>
              <tr>
                <td>近似誤差（floor）</td>
                <td>段內曲率 + 段界跳變</td>
                <td>
                  <Tex>{'\\Delta\\sqrt{E[d\'^2]/12}\\propto1/J'}</Tex>
                </td>
                <td>{m('$M$ 階以上的 INL（$d$ 是多項式時 0）')}</td>
              </tr>
              <tr>
                <td>硬體</td>
                <td>{m('1 乘法器 + mux + $K$ 暫存器')}</td>
                <td>{m('0 乘法器 + $J$ 字 RAM')}</td>
                <td>{m('$M$–$2M$ 乘法器 + $M+1$ 係數')}</td>
              </tr>
              <tr>
                <td>可辨識性</td>
                <td>{m('與 gain 共線；外側段沒樣本')}</td>
                <td>{m('offset 與 $b$ 共線；空格')}</td>
                <td>{m('$x$ 項與 gain 共線')}</td>
              </tr>
              <tr>
                <td>MASH code 下</td>
                <td colSpan={2}>外側段／格幾乎沒有樣本：要等機率分段或訓練序列</td>
                <td>{m('$\\mathbf R$ 要用 MASH 的樣本算，Legendre 只接近對角')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ModeGate min="research">
          <CodeBlock source={goldenPy} lang="python" path="golden/lms_pll_golden/dtc_inl.py" title="Python golden model（NumPy 獨立實作；dtc_inl_*.json 的參考值由它產生）" caption={String.raw`折返位準、分段／LUT 封閉式、Hankel／Legendre／Chebyshev 的 $\mathbf R$ 與 mean-field $k_{95}$；dtcInl.test.ts 讀 golden/vectors/dtc_inl_*.json 與 TypeScript 交叉比對（封閉式 rel $10^{-12}$、特徵值 $10^{-9}$、整數 $k_{95}$ 完全相同）。`} />
        </ModeGate>
        <p>
          <strong>連結到 PLL：</strong>INL 校正做完之後，PD 上剩下的是「floor + misadjustment」的殘餘 INL，它仍然是 code 的函數，仍然會折返（只是小了 <Tex>{'(\\sigma_r/\\sigma_{r,\\infty})^2'}</Tex> 倍）、仍然有 spur pattern。要把它算成輸出的 jitter 與 spur，就是把 §11b.2 的 <Tex>{'P_\\mathrm{in}'}</Tex> 換成校正後的殘餘，再走 <ChRef ch="12">Ch12</ChRef> 的 <Tex>{'T(f)'}</Tex>（F-12.16、F-12.17）；係數暫存器的量化（LUT 的位元數）是 <ChRef ch="13">Ch13</ChRef> 的事。
        </p>
      </Section>

      <Section kind="example" title="綜合手算：一顆 DTC 的 INL 校正預算" level={2} id="ch11b-synthesis">
        <p>
          把整章串起來：給定 <Tex>{'d_2'}</Tex>、<Tex>{'d_3'}</Tex>，(1) 只做 gain 校正剩多少；(2) LUT <Tex>{'J'}</Tex> 格的近似誤差；(3) 要等多久；(4) 穩態抖多大；(5) 校正後剩多少、哪一項主導。<FigRef id="handcalc-flow" /> 是計算順序。
        </p>
        <Fig id="handcalc-flow" />
        <Hand id="HC-11B.5">{m('預設值就是本章的例子（$d_2=20$、$d_3=10$、$J=64$、$\\mu=2$、$\\sigma_v=10$、$N=64$），可以直接和實驗 B（LUT、uniform、$d_3=10$）的指標表對照。')}</Hand>
      </Section>

      <Section kind="explore" title="思考題" level={2} id="ch11b-quiz">
        <Quiz
          title="思考題 1"
          question={<>{m('MASH 1-1-1 的 code，二次 INL $d_2=20$ t.u.，PLL 帶寬從 $f_s/100$ 改成 $f_s/50$。帶內折返功率變成幾倍？')}</>}
          options={[{ label: '不變（折返的雜訊是白色的）' }, { label: '2 倍', correct: true }, { label: '4 倍' }, { label: '16 倍（40 dB/dec）' }]}
          answer={
            <>
              <StepDerivation steps={[{ tex: String.raw`P_\mathrm{in}=d_2^2S_2(0)\cdot2\nu_B\propto\nu_B`, why: m('折返後的 PSD 在帶內是平的（F-11B.6），功率正比於帶寬——不是 $x$ 自己的 40 dB/dec。') }]} result={String.raw`${texNum(q.exact, 4)}\to${texNum(q.exact2, 4)}\ \mathrm{t.u.}^2`} />
              <p>{m('正是因為折返後的頻譜是平的，加寬 PLL 帶寬不會像「線性的 gain 誤差」那樣只多收到一點點（$\\propto\\nu_B^5$）。')}</p>
            </>
          }
        />
        <Quiz
          title="思考題 2"
          question={<>{m('分段 $K=8$、uniform code、$\\mu=2$、$\\sigma_v=10$、$N=64$：最外段的 $k_{95}$ 是 ' + q.seg.k95 + ' blocks。把 $\\mu$ 減半，$k_{95}$ 與穩態 $\\sigma_{w_k}$ 各怎麼變？')}</>}
          options={[{ label: m('$k_{95}$ 加倍、$\\sigma_{w_k}$ 減半') }, { label: m('$k_{95}$ 加倍、$\\sigma_{w_k}$ 變 $1/\\sqrt2$'), correct: true }, { label: m('兩者都加倍') }, { label: m('$k_{95}$ 不變、$\\sigma_{w_k}$ 減半') }]}
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: String.raw`g_k=\mu K_q\lambda_k\propto\mu\ \Rightarrow\ \tau_k\propto\frac1\mu:\quad k_{95}:\ ${q.seg.k95}\to${q.segHalf.k95}`, why: m('小 $g$ 時 $k_{95}\\approx3/g_k$。') },
                  { tex: String.raw`\operatorname{Var}(w_k)\approx\frac{\mu}{2K_qN}\propto\mu\ \Rightarrow\ \sigma_{w_k}\propto\sqrt\mu:\quad ${texNum(q.seg.stdW, 4)}\to${texNum(q.segHalf.stdW, 4)}`, why: m('F-11B.10：變異數與 $\\mu$ 成正比，標準差是開根號。') },
                ]}
              />
              <p>{m('「雜訊 × 時間」的乘積 $\\operatorname{Var}\\cdot\\tau\\approx1/(2K_q^2N\\lambda_k)$ 與 $\\mu$ 無關（HC-11B.3 的註）：$\\mu$ 只在兩者之間換。')}</p>
            </>
          }
        />
        <Quiz
          title="思考題 3"
          question={<>{m('LUT 從 32 格改成 64 格（其他不變，$d_2=20$）。近似誤差 floor、時間常數 $\\tau_j$、每格的穩態抖動各怎麼變？')}</>}
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: String.raw`\text{floor}\propto\frac1J:\quad ${texNum(q.floor32, 4)}\to${texNum(q.floor64, 4)}`, why: 'F-11B.13。' },
                  { tex: String.raw`\tau_j=\frac{J}{\mu K_q}:\quad ${texNum(q.lut32.tau, 4)}\to${texNum(q.lut64.tau, 4)}\ \text{blocks}`, why: 'F-11B.9：格數乘進時間常數。' },
                  { tex: String.raw`\operatorname{Var}(\theta_j)\approx\frac{\mu}{2K_qN}:\quad ${texNum(q.lut32.stdTheta, 4)}\to${texNum(q.lut64.stdTheta, 4)}`, why: m('F-11B.10：與 $J$ 無關（每格看到的樣本數 $N/(\\mu K_q)$ 也與 $J$ 無關）。') },
                ]}
              />
              <p>{m('floor 減半、等待加倍、抖動不變：格數是精度與速度的旋鈕，不是雜訊的旋鈕。')}</p>
            </>
          }
        />
        <Quiz
          title="思考題 4"
          question={<>{m('三次 INL $d_3x^3$ 用多項式校正，基底是 monomial $\\{1,x,x^2,x^3\\}$，同時還開著 Ch11 的 gain LMS（regressor $x$）。會發生什麼事？')}</>}
          options={[{ label: '沒事，多一個參數而已' }, { label: m('$\\mathbf R$ 奇異：$\\theta_1$ 與 $w$ 沿著「和不變」的方向隨機漫步，殘餘 INL 照樣收斂'), correct: true }, { label: '發散' }, { label: m('$\\theta_1$ 收斂到 0，$w$ 收斂到 $a$') }]}
          answer={
            <>
              <p>{m('$\\varphi_1=x$ 與 gain 的 regressor 完全相同，$\\mathbf R$ 有 null vector $[1,\\,0,-1,\\,0,0]$（F-11B.12）：comparator 看不到 $w+\\theta_1$ 以外的分配。殘餘 INL 的收斂只看總和，所以照樣收斂；但兩個參數各自隨機漫步（Ch09 F-09.19），久了可能撞到暫存器範圍。修法：凍結 $w$，或多項式從 $m=2$ 開始。')}</p>
            </>
          }
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { tex: String.raw`S_{\mathrm{He}_p}(0)=p!\sum_mR_x[m]^p,\qquad S_2(0)=2\sum_mR_x[m]^2+\kappa_4\Big(\sum_kh_k^2\Big)^2`, label: m('非線性把整形雜訊折回帶內（Gaussian；線性過程的精確修正）') },
          { tex: F.inband, label: m('帶內折返功率 $\\propto$ 帶寬：$x$ 在帶內幾乎是 0，$x^2$ 不是') },
          { tex: String.raw`\boldsymbol\delta_{b+1}=(\mathbf I-\mu K_q\mathbf M\mathbf R)\boldsymbol\delta_b,\qquad\lambda_k=E[\varphi_k^2]\ (\text{分段：}E[x^2\mathbb 1_k]\text{；LUT：}p_j)`, label: m('每種結構的收斂都由 $\\mathbf R$ 的特徵值決定；one-hot 的 $\\mathbf R$ 天生對角') },
          { tex: String.raw`\operatorname{Var}(\xi_i)\approx\frac{\mu}{2K_qN},\qquad E[r^2]_\infty=\text{floor}^2+\sum_i\lambda_i\operatorname{Var}(\xi_i)`, label: m('穩態抖動與 $\\lambda_i$ 無關；殘餘 = 近似誤差 + misadjustment') },
          { tex: String.raw`\kappa(\text{monomial})=67.6,\quad\kappa(\text{Legendre})=7,\quad\kappa(\sqrt{2m+1}P_m)=1`, label: m('同一個函數空間、不同基底：最慢模式差 $\\kappa$ 倍') },
        ]}
        points={[
          <>{m('gain 校正拿不掉 $d(x)$ 與 $x$ 正交的部分（二次 INL 一點都拿不掉）；留下的殘餘不只是 spur，還會把 MASH 的高頻雜訊折回帶內——這是 INL 校正存在的理由。')}</>,
          <>{m('折返的帶內功率 $P_\\mathrm{in}\\approx S(0)\\cdot2\\nu_B$，$S(0)=2\\sum R_x^2$（Gaussian）再加 $\\kappa_4$ 修正；MASH 的 code 是 sub-Gaussian，Gaussian 式高估 45%。')}</>,
          <>{m('分段／LUT 的 $\\mathbf R$ 對角：每段／每格一個一階迴路，慢的是 regressor 功率小的段（$x\\approx0$、或 MASH 沒去的外側）；時間常數 $\\propto K$ 或 $J$。')}</>,
          <>{m('穩態抖動 $\\approx\\mu/(2K_qN)$ 對三種結構、每個參數都一樣；格數只換精度與速度。')}</>,
          <>{m('多項式用正交基底（或 preconditioner）把 $\\kappa$ 從 67.6 降到 1；同時校正 gain 時要固定 gauge，否則參數沿著 null 方向漂。')}</>,
        ]}
      />
      <p className="small muted">
        下一個值得研究的問題：INL 隨溫度漂移時，MASH 外側段的 <Tex>{'\\tau_k'}</Tex> 跟不上；用 <ChRef ch="14">Ch14</ChRef> 的 tracking schedule（大 <Tex>{'\\mu'}</Tex> 收斂、小 <Tex>{'\\mu'}</Tex> 追蹤）能不能同時滿足外側段的速度與內側段的抖動？（提示：對角 preconditioner 讓所有段同速，但 F-11B.10 的 misadjustment 變成 <Tex>{'\\sum_i\\lambda_i\\cdot\\frac{\\gamma}{K_q^2N\\lambda_i(2-\\gamma)}=\\frac{P\\gamma}{K_q^2N(2-\\gamma)}\\approx\\frac{P\\gamma}{2K_q^2N}'}</Tex>（<Tex>{'\\gamma\\ll1'}</Tex>）——與段數成正比。）
      </p>
      <TexBlock>{String.raw`\text{對角 preconditioner 的 misadjustment}=\sum_{i=1}^{P}\lambda_i\cdot\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)}=\frac{P\,\gamma}{K_q^2N(2-\gamma)}\qquad(\text{Ch10 F-10.6 的對角版})`}</TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="research" /> {m(`本章延伸，未以 Monte Carlo 驗證全部組合；例：$d_3$ 的 Gaussian 折返位準 $6\\sum R^3=${texNum(q.s3, 5)}$ 只對 Gaussian code 成立，MASH 下實驗 A 顯示「量測／Gaussian」約 0.5，封閉式修正留作後續。`)}
      </p>
    </>
  )
}
