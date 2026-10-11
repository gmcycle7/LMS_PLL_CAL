import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ClaimTag, CodeBlock, ModeGate, ModelLevel, Section, StepDerivation, Tex, TestBadge } from '@/components'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import { presetHref, presetsForExperiment } from '@/app/presets'
import { impulseResponse } from '@/simulation/signal'
import {
  autocorrCorrelation,
  calPole,
  ctHpd,
  designPolarityLoop,
  kqFromSigma,
  sawtoothAutocorr,
  toneCorrelation,
} from '@/simulation/models/polarity'
import { PolarityExplorer } from '../experiments/PolarityExplorer'
import { POLARITY_EXPERIMENT_ID } from '../experiments/explorerModel'
import { ChapterDiagram, ChapterSection, f, fx, JumpTo, radOf, StepBox } from '../shared'

/** §7 動手觀察：Polarity Explorer（規格 §19；Gallery #3）。「你會發現…」裡的數字全部即時計算。 */
export function S7Lab() {
  const presets = presetsForExperiment(POLARITY_EXPERIMENT_ID)
  const n = useMemo(() => {
    const omega = Math.PI / 6
    const Kq = kqFromSigma(100)
    const C120 = toneCorrelation({ A: 1, mag: 1, phiRad: radOf(120), omega })
    const C120d8 = toneCorrelation({ A: 1, mag: 1, phiRad: radOf(120), omega, delay: 8 })
    const p10 = calPole(10, Kq, C120)
    const p1 = calPole(1, Kq, C120)
    const des = designPolarityLoop({ type: 'typeII', zeta: 0.7, bwRatio: 0.01, loopDelay: 0 })
    const h = impulseResponse(des.b, des.a, 8192)
    return {
      C120,
      C120d8,
      p10,
      p1,
      grow1: Math.pow(p1, 400),
      ratio: Math.log(p10) / Math.log(p1),
      ct2: ctHpd('typeII', 0.3, 0.7).re,
      ct1: ctHpd('typeI', 0.3).re,
      saw002: autocorrCorrelation(h, sawtoothAutocorr(0.002)),
      saw002d3: autocorrCorrelation(h, sawtoothAutocorr(0.002), 3),
      delta002: (2 * Math.PI * 0.002) / des.wLTs,
    }
  }, [])
  return (
    <ChapterSection id="ch06-s7" kicker="§7" title="動手：Polarity Explorer">
      <p>
        這個實驗把本章所有的式子接在一起：左邊調參數，右邊同時看到 <strong>x 與 u 的波形</strong>、
        <strong>
          <Tex>{'C_D'}</Tex> vs <Tex>{'D'}</Tex>
        </strong>
        、
        <strong>
          <Tex>{'C'}</Tex> vs <Tex>{'\\phi'}</Tex>
        </strong>
        （單頻）或{' '}
        <strong>
          <Tex>{'\\operatorname{Re}H_{\\mathrm{PD}}'}</Tex> 疊上 code PSD
        </strong>
        （PLL 模式）、
        <strong>
          pole vs <Tex>{'\\mu'}</Tex>
        </strong>
        、一段<strong>逐 sample 的閉迴路 block sign-LMS</strong>（同 seed 跑多條 chain，並與網站共用的 blockLms 參考模型對照），以及不做小訊號近似的{' '}
        <strong>
          mean-field 特性 <Tex>{'E[G](\\delta)'}</Tex>
        </strong>
        （F-06.19）。{' '}
        <ModelLevel level="L2" /> <TestBadge id="T06" />
      </p>
      <p>
        動手之前，先看閉迴路模擬在一個 GMAC block 裡做了哪些事、各以什麼速率發生。前面的公式有兩種時間索引——sample 的 <Tex>{'n'}</Tex> 與 block 的{' '}
        <Tex>{'k'}</Tex>；把兩者混在一起，是讀這一章（和寫模擬）最常見的錯誤。
      </p>
      <ChapterDiagram id="D-06.24">
        <p>
          先看 loop 框裡面（sample rate）：每個 sample <Tex>{'n'}</Tex>，DTC 用這個 block 的 gain <Tex>{'w_k'}</Tex> 產生誤差{' '}
          <Tex>{'\\varepsilon[n]=(a-w_k)\\,x[n]'}</Tex>；它經過主 PLL 的 <Tex>{'H_{\\mathrm{PD}}'}</Tex>、加上雜訊 <Tex>{'v[n]'}</Tex> 成為{' '}
          <Tex>{'e_{\\mathrm{PD}}[n]'}</Tex>；comparator 取出正負號 <Tex>{'q[n]'}</Tex>；GMAC 把 <Tex>{'q[n]\\,x[n-D]'}</Tex> 加進累加器。這四件事重複{' '}
          <Tex>{'N'}</Tex> 次，期間 <Tex>{'w_k'}</Tex> 完全不動。再看 loop 框外面（block rate）：<Tex>{'N'}</Tex> 個 sample 累加完，GMAC 才把結果平均成{' '}
          <Tex>{'G_k'}</Tex>，校正值更新一次，下一個 block 的 DTC 改用 <Tex>{'w_{k+1}'}</Tex>（虛線箭頭）。
        </p>
        <p>
          圖上的每一個箭頭就是 <JumpTo target="ch06-s3">§3 核心程式碼</JumpTo> <code>simulateSignLmsChain</code> 的一行：外層的 <code>for k</code> 是 block、內層的{' '}
          <code>for i</code> 是 sample；loop 框外的兩行就是公式 <Tex>{'G_k=\\tfrac1N\\sum_n q[n]\\,x[n-D]'}</Tex> 與 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>。
          有一件事圖上看不出來、但程式有做到：主 PLL 的濾波器狀態<strong>跨 block 保留</strong>——<Tex>{'w'}</Tex> 在 block 邊界一跳，<Tex>{'H_{\\mathrm{PD}}'}</Tex>{' '}
          的輸出要過幾拍才跟上，所以 F-06.1 的 <Tex>{'e_{\\mathrm{PD}}\\approx(a-w_k)\\,u+v'}</Tex> 只在 <Tex>{'w'}</Tex> 變得比主 PLL 慢時成立。pole{' '}
          <Tex>{'p=1-\\mu K_qC'}</Tex>（圖 6.6）描述的是 loop 框外、block rate 的平均行為。
        </p>
      </ChapterDiagram>
      <Section kind="explore" title="試試看（你會發現…）">
        <ol>
          <li>
            預設就是 Gallery #3：<Tex>{'\\phi=120^\\circ,\\;\\Omega=\\pi/6'}</Tex>。<Tex>{`C=${fx(n.C120, 4)}`}</Tex>、<Tex>{`p=${fx(n.p10, 5)}`}</Tex>，閉迴路的{' '}
            <Tex>{'\\delta'}</Tex> 先指數、再線性地遠離 0。按「新增 Case」複製成 B，把 <Tex>{'\\phi'}</Tex> 改成 <Tex>{'0^\\circ'}</Tex>：同一個 seed 下 B 收斂。
          </li>
          <li>
            <Tex>{'\\phi=90^\\circ'}</Tex>：<Tex>{'C\\approx0'}</Tex>、<Tex>{'p=1'}</Tex>，<Tex>{'\\delta'}</Tex> 只是隨雜訊亂走（random walk）。
          </li>
          <li>
            把 <Tex>{'\\mu'}</Tex> 從 10 降到 1：<Tex>{`p=${fx(n.p1, 5)}`}</Tex>，<Tex>{'\\delta'}</Tex> 仍然在長（400 個 block 約{' '}
            <Tex>{`p^{400}=${f(n.grow1, 3)}`}</Tex> 倍；把 blocks 調到 2000 會看得很清楚），只是慢 {f(n.ratio, 3)} 倍——
            <strong>
              <Tex>{'\\mu'}</Tex> 改不了方向
            </strong>
            。
          </li>
          <li>
            <Tex>{'\\phi=120^\\circ,\\;\\Omega=\\pi/6'}</Tex>，把 <Tex>{'D'}</Tex> 調到 8：<Tex>{'\\phi+\\Omega D=360^\\circ'}</Tex>，<Tex>{'C'}</Tex> 回到{' '}
            <Tex>{`${fx(n.C120d8, 3)}`}</Tex>（delay alignment，第 07 章的主題）。
          </li>
          <li>
            GMAC regressor 改成 filtered-x <Tex>{'u'}</Tex>：<Tex>{'C'}</Tex> 變成 <Tex>{'E[u^2]\\ge0'}</Tex>，任何 <Tex>{'\\phi'}</Tex> 都收斂（前提是{' '}
            <Tex>{'\\hat H=H'}</Tex>）。
          </li>
          <li>
            <Tex>{'\\Omega'}</Tex> 設成 <Tex>{'\\pi'}</Tex>（3.14159265…）：<Tex>{'\\phi'}</Tex> 會被吸附到 <Tex>{'0^\\circ'}</Tex> 或 <Tex>{'180^\\circ'}</Tex>，並出現 E46
            警告；<Tex>{'\\Omega=0.01,\\;N=64'}</Tex> 則看得到單一 block 的 ripple 警告。
          </li>
          <li>
            切到 PLL 模式：Type-II、tone 在 <Tex>{'0.3\\,\\omega_n'}</Tex> ⇒ <Tex>{`C/\\sigma_x^2\\approx${fx(n.ct2, 3)}`}</Tex>（CT 原型值；DT 略有不同，E44）；改成
            Type-I ⇒ <Tex>{`\\approx+${fx(n.ct1, 3)}`}</Tex>（大小碰巧接近、符號相反）。code 改成 iid ⇒ <Tex>{'C=h[0]\\sigma_x^2=\\sigma_x^2'}</Tex>。
          </li>
          <li>
            PLL 模式、一階 DSM、<Tex>{'\\mathrm{frac}=0.002'}</Tex>（<Tex>{`\\Delta=${fx(n.delta002, 3)}`}</Tex>）：近整數時{' '}
            <Tex>{`C/\\sigma_x^2`}</Tex> 只剩約 <Tex>{`${fx(n.saw002, 3)}`}</Tex>（恢復力消失，但小訊號沒有變號；§6.4 的精確鋸齒理論，指標表的「封閉式」列）。再看最下面的{' '}
            <Tex>{'E[G](\\delta)'}</Tex> 圖：曲線在指標表列出的 <Tex>{'\\delta_c'}</Tex> 穿過 0——這個 <Tex>{'C>0'}</Tex> 只是局部穩定。
          </li>
          <li>
            承上，把 <Tex>{'w_0'}</Tex> 設成 <Tex>{'-147'}</Tex>（<Tex>{'\\delta_0=150\\,\\mathrm{fs}>\\delta_c'}</Tex>）、<Tex>{'\\mu'}</Tex> 設成 50 fs：線性 pole 明明小於 1，閉迴路卻遠離{' '}
            <Tex>{'a'}</Tex>，漂移斜率等於指標表的 mean-field 預測 <Tex>{'\\mu|E[G](\\delta)|'}</Tex>。新增一個 <Tex>{'w_0=0'}</Tex> 的 Case 對照：同一個 seed 下留在{' '}
            <Tex>{'a'}</Tex> 附近（preset「近整數 basin」）。
          </li>
          <li>
            同一個設定把 GMAC code delay <Tex>{'D'}</Tex> 調到 3：<Tex>{`C_D/\\sigma_x^2\\approx${fx(n.saw002d3, 3)}`}</Tex>——
            <strong>變號</strong>（F-06.18：<Tex>{'D>\\mathrm{frac}/K_i'}</Tex>）。把 <Tex>{'\\mu'}</Tex> 調到 150 fs、新增一個 <Tex>{'D=0'}</Tex> 的 Case 對照：
            同一個 seed 下 <Tex>{'D=0'}</Tex> 收斂、<Tex>{'D=3'}</Tex> 遠離 <Tex>{'a'}</Tex>。
          </li>
        </ol>
      </Section>
      {presets.length > 0 && (
        <p className="small">
          Preset 連結（可分享）：{' '}
          {presets.map((p, i) => (
            <span key={p.id}>
              {i > 0 && '、'}
              <Link to={presetHref(p)}>
                {p.galleryIndex ? `Gallery #${p.galleryIndex}：` : ''}
                {p.title}
              </Link>
            </span>
          ))}
        </p>
      )}
      <PolarityExplorer />
      <ModeGate min="research">
        <StepBox title="（Research）交叉比對欄的 Monte Carlo 檢查在比什麼？" min="research">
          <p>
            只比「MC 平均 <Tex>{'\\bar\\delta_k'}</Tex> 對 <Tex>{'\\delta_0p^k'}</Tex>」是不夠的：<Tex>{'C<0'}</Tex> 而雜訊主導時，每條 chain 往哪一邊發散由雜訊決定，
            平均值接近 0，怎麼比都會過。所以實驗同時檢查線性隨機模型的<strong>兩個動差</strong>：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`\delta_{k+1}=p_k\,\delta_k-\mu\,\eta_k,\qquad E[\eta_k]=0,\quad\operatorname{Var}(\eta_k)=\sigma_\eta^2=\frac{E[x_{\mathrm{ref}}^2]}{N}`,
                why: (
                  <>
                    <Tex>{'G_k=K_q\\delta_kC+\\eta_k'}</Tex>；<Tex>{'q=\\pm1'}</Tex> 且各 sample 的雜訊獨立，所以 <Tex>{'\\frac1N\\sum q\\,x_{\\mathrm{ref}}'}</Tex> 的變異是{' '}
                    <Tex>{'\\frac{1}{N^2}\\sum x_{\\mathrm{ref}}^2'}</Tex>（小訊號下 <Tex>{'\\operatorname{Var}(q)\\approx1'}</Tex>）。
                  </>
                ),
              },
              {
                tex: String.raw`m_{k+1}=p_k\,m_k,\qquad m_0=\delta_0`,
                why: (
                  <>
                    取期望值（<Tex>{'\\eta_k'}</Tex> 零平均）；<Tex>{'p_k\\equiv p'}</Tex> 時就是 <Tex>{'m_k=\\delta_0p^k'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`v_{k+1}=p_k^2\,v_k+\mu^2\sigma_\eta^2,\qquad v_0=0`,
                why: (
                  <>
                    <Tex>{'\\operatorname{Var}(aX+Y)=a^2\\operatorname{Var}X+\\operatorname{Var}Y'}</Tex>（<Tex>{'\\eta_k'}</Tex> 與 <Tex>{'\\delta_k'}</Tex> 獨立）。
                  </>
                ),
              },
              {
                tex: String.raw`p_k\equiv p:\quad v_k=\mu^2\sigma_\eta^2\,\frac{1-p^{2k}}{1-p^2}\;\xrightarrow{|p|<1}\;\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`,
                why: (
                  <>
                    等比數列求和；<Tex>{'|p|<1'}</Tex> 時收斂到穩態雜訊（第 12 章的 <Tex>{'\\sigma_w'}</Tex>），<Tex>{'|p|>1'}</Tex> 時連變異數也指數成長。
                  </>
                ),
              },
            ]}
          />
          <ul>
            <li>
              只在線性區（<Tex>{'\\sqrt{m_k^2+v_k}\\le0.3\\,\\sigma_v/u_{\\max}'}</Tex>）內比較；<Tex>{'k^*'}</Tex> 是線性區的最後一個 block。用 <Tex>{'u'}</Tex>{' '}
              的<strong>峰值</strong>而不是 RMS：鋸齒經 Type-II 的 <Tex>{'u'}</Tex> 峰值遠大於 RMS（指標與匯出的 JSON 都有 <Tex>{'u_{\\max}'}</Tex>），尖峰先飽和。
            </li>
            <li>
              平均：<Tex>{'|\\bar\\delta_{k^*}-m_{k^*}|\\le4\\sqrt{v_{k^*}/R}+10\\%\\,|m_{k^*}|+2\\%\\,|\\delta_0|'}</Tex>（<Tex>{'R'}</Tex> 條 chain；標準誤用模型的{' '}
              <Tex>{'v'}</Tex>，不是樣本變異）。
            </li>
            <li>
              均方：<Tex>{'\\rho=\\sum_W\\overline{\\delta_k^2}\\big/\\sum_W(m_k^2+v_k)'}</Tex>，視窗 <Tex>{'W'}</Tex> 為線性區的後半；容許區間取{' '}
              <Tex>{'\\chi^2'}</Tex> 分布的 <Tex>{'\\pm3.5\\sigma'}</Tex> 分位數（Wilson–Hilferty 近似）再放寬 25%。這一項在雜訊主導時仍有檢定力。
            </li>
            <li>
              確定性 code 的 <Tex>{'p_k=1-\\mu K_q\\hat C_k'}</Tex> 用逐 block 的 <Tex>{'\\hat C_k'}</Tex>（E46：block 不是整數個 code 週期時會起伏）。
            </li>
            <li>
              起始誤差就在線性區外（或線性區不足 2 個 block）時顯示 <code>n/a</code> 並說明原因，不會顯示 <code>ok</code>。離開線性區之後改和 mean-field 特性比（指標表的「漂移斜率」列）。
            </li>
          </ul>
          <p className="ch06-tags">
            <ClaimTag kind="approx" />
            <span className="small">單元測試：模型正確時 40 組合成資料都不誤報；pole 符號弄反、忘了除以 N、雜訊變異差 10 倍都會被判為 mismatch。</span>
          </p>
          <CodeBlock source={polaritySrc} region="linearMomentCheck" path="src/simulation/models/polarity.ts" title="Monte Carlo 對線性隨機模型的兩個動差檢查" />
        </StepBox>
      </ModeGate>
    </ChapterSection>
  )
}
