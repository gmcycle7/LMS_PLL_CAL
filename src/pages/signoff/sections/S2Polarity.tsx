import { CodeBlock, CodeCompare, Callout, ClaimTag, MathText, ModeGate, Quiz, Section, Tex, TexBlock } from '@/components'
import { erf } from '@/simulation/core'
import judgesSrc from '../judges.ts?raw'
import { kq, requiredBlocks, secantRatio, slopeStdErr } from '../judges'
import { PolarityPerturbExperiment } from '../experiments/PolarityPerturb'
import { SspllJacobianExperiment } from '../experiments/SspllJacobian'
import { ErratumNote, HandCalcSlot, Steps, nf, tx } from '../shared'

const PATH = 'src/pages/signoff/judges.ts'

/** §2：基本正確性——freeze + ±Δw 量 S_GMAC；§2.5 SSPLL GOS／PHOS 兩參數 Jacobian（註解可用 Unicode；頁面文字一律 LaTeX） */
export function S2Polarity() {
  // 手算例子：全部即時計算
  const sigma = 100
  const K = kq(sigma)
  const delta = 20
  const N = 4096
  const M = 8
  const gLinPlus = -K * 1 * delta
  const gExactPlus = erf(-delta / (Math.SQRT2 * sigma))
  // 對稱（Ḡ₋ = −Ḡ₊）⇒ Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ) = Ḡ₊/Δ；用精確 erf 的 Ḡ₊ 算，才是「真的會量到」的斜率
  const sExact = gExactPlus / delta
  const sigmaEta = 1 / Math.sqrt(N)
  const se = slopeStdErr(delta, N, M)
  const z1 = K / se
  const c85 = Math.cos((85 * Math.PI) / 180)
  const z85 = (K * c85) / se
  const m85 = requiredBlocks(K * c85, delta, N, 3)
  const r03 = secantRatio(0.3 * sigma, sigma)
  const r1 = secantRatio(sigma, sigma)

  return (
    <>
      <Section kind="intuition" level={2} title={String.raw`2. 基本正確性：用 freeze + $\pm\Delta w$ 量出「更新方向」`} id="so-polarity">
        <p>
          <strong>問題</strong>：晶片裡看不到 <Tex>{'a-w'}</Tex> 的正負，只看得到 GMAC 的輸出 <Tex>{'G_k'}</Tex>。你怎麼確定「GMAC 說往上調」時，真的應該往上調？
        </p>
        <p>
          <strong>想法</strong>：把校正<strong>凍結</strong>（不讓 <Tex>{'w'}</Tex> 自己跑），人為把 <Tex>{'w'}</Tex> 往上推 <Tex>{'\\Delta'}</Tex>、量一陣子 GMAC；再往下推 <Tex>{'\\Delta'}</Tex>、再量。
          如果 GMAC 的平均隨 <Tex>{'w'}</Tex> 增加而<strong>下降</strong>（斜率 <Tex>{'S<0'}</Tex>），代表 <Tex>{'w'}</Tex> 太大時 GMAC 會把它拉回來——這就是「恢復力」<Tex>{'K=-S>0'}</Tex>。
          這是規格 §16.2 第一列的判斷方式，也是 §6 的 <Tex>{'S_\\mathrm{GMAC}=(G_+-G_-)/(2\\Delta w)'}</Tex>。
        </p>
        <Callout kind="info" title="為什麼一定要 freeze？">
          若量測期間 <Tex>{'w'}</Tex> 還在更新，<Tex>{'w'}</Tex> 會被 LMS 自己拉回固定點，「<Tex>{'+\\Delta'}</Tex>」與「<Tex>{'-\\Delta'}</Tex>」兩個工作點就混在一起，量到的斜率被稀釋（甚至看起來為 0）。
          另外每次改變 <Tex>{'w'}</Tex> 後要丟掉主 PLL settling 期間的 block，並<strong>交錯</strong>量測 <Tex>{'+\\Delta'}</Tex>／<Tex>{'-\\Delta'}</Tex>，讓慢漂移（PVT、<Tex>{'1/f'}</Tex>）在兩側相同而被差分抵消。
        </Callout>
      </Section>

      <Section kind="example" title={String.raw`2.1 先算一次（$\sigma_v=100$ fs、$C=1$、$\Delta=20$ fs、$N=4096$、$M=8$）`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>步驟</th>
                <th>算式</th>
                <th className="num">數值</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>comparator 小訊號增益</td>
                <td>
                  <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>
                </td>
                <td className="num">
                  {nf(K, 6)} <Tex>{'\\mathrm{fs}^{-1}'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'w=a+\\Delta'}</Tex> 時的 GMAC 平均（線性）
                </td>
                <td>
                  <Tex>{'\\bar G_+\\approx K_qC\\,(a-w)=-K_qC\\Delta'}</Tex>
                </td>
                <td className="num">{nf(gLinPlus, 5)}</td>
              </tr>
              <tr>
                <td>
                  同上（精確 erf，<Tex>{'\\pm1'}</Tex> code、identity path）
                </td>
                <td>
                  <Tex>{'\\bar G_+=\\mathrm{erf}\\big(-\\Delta/(\\sqrt2\\sigma_v)\\big)'}</Tex>
                </td>
                <td className="num">{nf(gExactPlus, 5)}</td>
              </tr>
              <tr>
                <td>斜率的期望值（對稱 ⇒ <Tex>{'\\bar G_-=-\\bar G_+'}</Tex>；用精確的 <Tex>{'\\bar G_+'}</Tex>）</td>
                <td>
                  <Tex>{'\\hat S=(\\bar G_+-\\bar G_-)/(2\\Delta)=\\bar G_+/\\Delta'}</Tex>
                </td>
                <td className="num">
                  {nf(sExact, 6)} <Tex>{'\\mathrm{fs}^{-1}'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  恢復力 <Tex>{'\\hat K=-\\hat S'}</Tex>，以及它和小訊號 <Tex>{'K_qC'}</Tex> 的比
                </td>
                <td>
                  <Tex>{'\\hat K/(K_qC)=\\mathrm{erf}\\big(\\Delta/(\\sqrt2\\sigma_v)\\big)/(K_q\\Delta)'}</Tex>
                </td>
                <td className="num">
                  {nf(-sExact, 6)} <Tex>{'\\mathrm{fs}^{-1}'}</Tex>（比值 {nf(-sExact / K, 5)}）
                </td>
              </tr>
              <tr>
                <td>一個 block 的雜訊</td>
                <td>
                  <Tex>{'\\sigma_\\eta\\approx1/\\sqrt N'}</Tex>
                </td>
                <td className="num">{nf(sigmaEta, 5)}</td>
              </tr>
              <tr>
                <td>斜率的標準誤</td>
                <td>
                  <Tex>{'\\mathrm{se}(\\hat S)=\\sigma_\\eta/(\\Delta\\sqrt{2M})'}</Tex>
                </td>
                <td className="num">
                  {nf(se, 4)} <Tex>{'\\mathrm{fs}^{-1}'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  信心倍數（<Tex>{'C=1'}</Tex>）
                </td>
                <td>
                  <Tex>{'z=K_qC/\\mathrm{se}'}</Tex>
                </td>
                <td className="num">{nf(z1, 4)}</td>
              </tr>
              <tr>
                <td>
                  同樣量測，但 <Tex>{'C=\\cos85^\\circ'}</Tex>
                </td>
                <td>
                  <Tex>{'z=K_qC/\\mathrm{se}'}</Tex>
                </td>
                <td className="num">{nf(z85, 4)}</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'C=\\cos85^\\circ'}</Tex> 要 <Tex>{'z\\ge3'}</Tex> 需要的 <Tex>{'M'}</Tex>
                </td>
                <td>
                  <Tex>{'M\\ge z^2/(2N\\Delta^2K^2)'}</Tex>
                </td>
                <td className="num">{nf(m85, 6)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          結論：<Tex>{'C=1'}</Tex> 時 8 個 block 就以 <Tex>{`z\\approx${tx(z1, 3)}`}</Tex> 的壓倒性信心判定極性；但有效相位接近 <Tex>{'90^\\circ'}</Tex>（<Tex>{'C\\approx0.087'}</Tex>）時同樣的量測只剩 <Tex>{`z\\approx${tx(z85, 3)}`}</Tex>，
          而且這種「快要變號」的 FCW／corner 才是 sign-off 最需要量的地方。
          表中 <Tex>{'z'}</Tex> 與所需 <Tex>{'M'}</Tex> 用小訊號 <Tex>{'K_qC'}</Tex> 估計；實際量到的 <Tex>{'\\hat K'}</Tex> 因 erf 截斷略小（本例比值 {nf(-sExact / K, 5)}，下一段推導）。
        </p>
      </Section>

      <Section kind="formula" title={String.raw`2.2 一步一步推導：中央差分為什麼比單邊差分好、$\Delta$ 該取多大`}>
        <Steps
          title="中央差分的截斷誤差"
          steps={[
            { tex: String.raw`\bar G(w+\Delta)=\bar G(w)+\bar G'(w)\Delta+\tfrac12\bar G''(w)\Delta^2+\tfrac16\bar G'''(w)\Delta^3+O(\Delta^4)`, why: '在 $w$ 做泰勒展開（微積分）。' },
            { tex: String.raw`\bar G(w-\Delta)=\bar G(w)-\bar G'(w)\Delta+\tfrac12\bar G''(w)\Delta^2-\tfrac16\bar G'''(w)\Delta^3+O(\Delta^4)`, why: String.raw`把 $\Delta$ 換成 $-\Delta$：奇數次項變號、偶數次項不變。` },
            { tex: String.raw`\bar G(w+\Delta)-\bar G(w-\Delta)=2\bar G'(w)\Delta+\tfrac13\bar G'''(w)\Delta^3+O(\Delta^5)`, why: String.raw`兩式相減：常數項（例如 comparator offset 造成的 $\bar G$ 偏移）與二次項（偶對稱 INL）全部抵消。` },
            { tex: String.raw`\hat S_\text{CD}\equiv\frac{\bar G(w+\Delta)-\bar G(w-\Delta)}{2\Delta}=\bar G'(w)+\frac{\bar G'''(w)}{6}\Delta^2+O(\Delta^4)`, why: String.raw`除以 $2\Delta$。單邊差分 $(\bar G(w+\Delta)-\bar G(w))/\Delta$ 的誤差是 $O(\Delta)$，中央差分是 $O(\Delta^2)$。` },
            { tex: String.raw`\bar G(w)=\mathrm{erf}\Big(\frac{a-w}{\sqrt2\sigma_v}\Big)\ \Rightarrow\ \bar G'(a)=-K_q,\quad \bar G'''(a)=+\frac{K_q}{\sigma_v^2}`, why: String.raw`$\pm1$ code、identity path：$E[q\,x]$ 就是 erf；在 $w=a$ 對 $w$ 微分（erf 的三階導數在 0 為負，乘上 $\mathrm d(a-w)/\mathrm dw=-1$ 的三次方後變正）。` },
            { tex: String.raw`\frac{\hat S_\text{CD}}{\bar G'(a)}=1-\frac{\Delta^2}{6\sigma_v^2}+O\Big(\frac{\Delta^4}{\sigma_v^4}\Big)`, why: String.raw`代入上一步：相對截斷偏差是負的——$\Delta$ 越大，量到的 $|\hat S|$ 越小（erf 的飽和）。` },
          ]}
          result={String.raw`\frac{\hat S_\text{CD}}{\bar G'(a)}=\frac{\mathrm{erf}\big(\Delta/(\sqrt2\sigma_v)\big)}{K_q\Delta}`}
        />
        <TexBlock id="F-SO.2" label={<MathText>{String.raw`中央差分截斷比（identity path、$\pm1$ code）`}</MathText>}>{String.raw`r_\text{CD}(\Delta)\equiv\frac{\hat S_\text{CD}}{\bar G'(a)}=\frac{\mathrm{erf}\big(\Delta/(\sqrt2\sigma_v)\big)}{K_q\Delta}:\quad r_\text{CD}(0.3\sigma_v)=${tx(r03, 6)},\qquad r_\text{CD}(\sigma_v)=${tx(r1, 6)}`}</TexBlock>
        <p>
          所以 <Tex>{'\\Delta\\le0.3\\sigma_v'}</Tex> 時截斷偏差約 {nf(100 * (1 - r03), 2)}%，可以忽略；<Tex>{'\\Delta=\\sigma_v'}</Tex> 時低估 {nf(100 * (1 - r1), 3)}%。
          <strong>判定極性</strong>不怕截斷（符號不變），但若要拿 <Tex>{'\\hat K'}</Tex> 去<strong>設計 <Tex>{'\\mu'}</Tex></strong>（Corner 區間），就要用小 <Tex>{'\\Delta'}</Tex> 或做截斷修正。
          <ClaimTag kind="exact" />（在 erf 模型內）
        </p>

        <Steps
          title="量測雜訊：要幾個 block 才判得出來"
          steps={[
            { tex: String.raw`\hat G_\pm=\frac1M\sum_{m=1}^{M}G^{\pm}_m,\qquad \mathrm{Var}(G_m^\pm)=\sigma_\eta^2`, why: String.raw`每側平均 $M$ 個 block；每個 block 的 GMAC 雜訊變異數 $\sigma_\eta^2$。` },
            { tex: String.raw`\mathrm{Var}(\hat G_\pm)=\frac{\sigma_\eta^2}{M}`, why: '獨立樣本平均：變異數除以 $M$（先備知識框）。' },
            { tex: String.raw`\mathrm{Var}(\hat S)=\frac{\mathrm{Var}(\hat G_+)+\mathrm{Var}(\hat G_-)}{(2\Delta)^2}=\frac{\sigma_\eta^2}{2M\Delta^2}`, why: String.raw`兩側在不同時間量、comparator 雜訊獨立 ⇒ 相減時變異數相加；常數 $1/(2\Delta)$ 提出來要平方。` },
            { tex: String.raw`\sigma_\eta^2=\frac{1-m^2}{N}\approx\frac1N\qquad(m=E[q\,x]\ \text{很小})`, why: String.raw`$\pm1$ code 時 $q\,x$ 是 $\pm1$ 的隨機變數，$N$ 個平均的變異數是 $(1-m^2)/N$；近平衡時 $m\approx0$。` },
            { tex: String.raw`z=\frac{K}{\mathrm{se}(\hat S)}=K\Delta\sqrt{2MN}`, why: '信心倍數 = 真實恢復力 ÷ 標準誤。' },
          ]}
          result={String.raw`M\ \ge\ \frac{z^2}{2N\Delta^2K^2},\qquad K=K_qC`}
        />
        <TexBlock id="F-SO.1" label={<MathText>{String.raw`Freeze $\pm\Delta$ 的斜率估計與判決`}</MathText>}>{String.raw`\hat K=-\frac{\bar G(w+\Delta)-\bar G(w-\Delta)}{2\Delta},\qquad \text{極性正確}\iff\hat K-z\,\mathrm{se}(\hat S)>0`}</TexBlock>
        <TexBlock id="F-SO.3" label="所需 block 數">{String.raw`\mathrm{se}(\hat S)=\frac{\sigma_\eta}{\Delta\sqrt{2M}},\qquad M\ge\frac{z^2}{2N\Delta^2K_q^2C^2}`}</TexBlock>
        <TexBlock id="F-SO.4" label={<MathText>{'解析對照：有效相關 $C_D$'}</MathText>}>{String.raw`C_D=E\big[x[n-D]\,u[n]\big]=\begin{cases}|H|\cos(\phi+\Omega D)&\text{單頻 }x=\sqrt2\cos(\Omega n+\theta_0),\ 0<\Omega<\pi\\ \sum_kh[k]R_{xx}[k-D]=h[D]&\text{iid }\pm1\text{ code}\end{cases}`}</TexBlock>
        <ErratumNote id="E46">
          單頻公式只在 <Tex>{'0<\\Omega<\\pi'}</Tex>、長時間（或整數週期）平均時成立；<Tex>{'\\Omega'}</Tex> 接近 0 或 <Tex>{'\\pi'}</Tex> 時有限 <Tex>{'N'}</Tex> 的 block 有 ripple，單一 block 可能翻號。
        </ErratumNote>
        <ErratumNote id="E07">
          tie 規則：<Tex>{'e=0'}</Tex> 時 <Tex>{'b=1'}</Tex>（§15.2）；<Tex>{'N'}</Tex> 為偶數時 <Tex>{'G=0'}</Tex> 的機率不為零，模擬與硬體必須用同一條規則。
        </ErratumNote>
        <HandCalcSlot id="HC-SO.1">
          預設值就是 §2.1 的例子（<Tex>{'\\theta=85^\\circ'}</Tex>）。把 <Tex>{'\\theta'}</Tex> 改成 <Tex>{'60^\\circ'}</Tex>、<Tex>{'95^\\circ'}</Tex>，或把 <Tex>{'M'}</Tex> 減半，看 <Tex>{'z'}</Tex> 怎麼變。
        </HandCalcSlot>
      </Section>

      <Section kind="explore" title="2.3 動手量：A／B／C 三組同 seed 對照">
        <p>
          預設三組：<strong>A</strong> 單頻 code、<Tex>{'\\phi=-120^\\circ'}</Tex>、<Tex>{'\\Omega=\\pi/6'}</Tex>、<Tex>{'D=4'}</Tex>（有效相位 <Tex>{'0^\\circ'}</Tex>，T07）；
          <strong>B</strong> 同樣路徑但 <Tex>{'D=0'}</Tex>（有效相位 <Tex>{'-120^\\circ'}</Tex>，<Tex>{'C<0'}</Tex>）；<strong>C</strong> 對齊但 comparator 接反（<Tex>{'q=1-2b'}</Tex>）。
          試試看：把 B 的 <Tex>{'D'}</Tex> 從 0 調到 2、4、6，看 <Tex>{'\\hat K'}</Tex> 何時變號；把 <Tex>{'\\Delta'}</Tex> 拉到 <Tex>{'\\sigma_v'}</Tex>，看 mean-field 與小訊號 <Tex>{'K_qC'}</Tex> 分開。
        </p>
        <PolarityPerturbExperiment />
      </Section>

      <Section kind="formula" title="2.4 核心程式碼：頁面上執行的就是這幾段">
        <p>
          下面的程式碼直接從本頁的 <code>{PATH}</code> 擷取（<code>?raw</code> + <code>#region core:*</code>），不是另外手寫的示意版。先看凍結 <Tex>{'w'}</Tex> 的一個 GMAC block，再看中央差分與判決：
        </p>
        <CodeBlock source={judgesSrc} region="gmacFrozenBlock" path={PATH} title="一個凍結 $w$ 的 GMAC block" />
        <CodeBlock source={judgesSrc} region="centralDiff" path={PATH} title="中央差分 + 標準誤" />
        <CodeBlock source={judgesSrc} region="polarityVerdict" path={PATH} title="三分法判決" />
        <ModeGate min="engineer">
          <CodeBlock source={judgesSrc} region="meanField" path={PATH} title="精確 mean-field（Analytic 對照）" caption={String.raw`$\pm1$ code 用有限列舉、單頻 code 用週期函數的梯形積分；兩者都沒有 Monte Carlo 誤差。`} />
        </ModeGate>
        <p>位元映射的三種寫法（§16.1-1 與 §17「錯誤位元符號」）——差異只在一行：</p>
        <CodeCompare
          items={[
            { label: '正確 $q=2b-1$', source: judgesSrc, region: 'mapBipolar', path: PATH, note: String.raw`$b\in\{0,1\}\to q\in\{-1,+1\}$` },
            { label: '接反 $q=1-2b$', source: judgesSrc, region: 'mapReversed', path: PATH, note: String.raw`$K$ 變號：正 $\mu$ 平均發散` },
            { label: '未映射 $q=b$', source: judgesSrc, region: 'mapUnipolar', path: PATH, note: String.raw`斜率減半，$E[x]\ne0$ 時固定點偏移` },
          ]}
          caption={String.raw`$E[q\mid e_\text{det}]$ 對三種映射分別是 $\mathrm{erf}(\cdot)$、$-\mathrm{erf}(\cdot)$、$\Phi(\cdot)=\tfrac12\big(1+\mathrm{erf}(\cdot)\big)$。`}
        />
        <Quiz
          title="思考題 2-1"
          question={
            <>
              <Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{'N=4096'}</Tex>、<Tex>{'\\Delta=20\\,\\mathrm{fs}'}</Tex>、<Tex>{'z=3'}</Tex>。某個 near-integer FCW 的有效相關 <Tex>{'C=\\cos85^\\circ'}</Tex>。每側只量 <Tex>{'M=8'}</Tex> 個 block，結果是？
            </>
          }
          options={[
            { label: '一定判為「極性正確」' },
            { label: <MathText>{`期望 $z\\approx${tx(z85, 3)}$，只略高於 3：有相當機率判為「無法判定」`}</MathText>, correct: true },
            { label: '一定判為「極性錯誤」' },
            { label: <MathText>{'$C>0$ 就不需要量測'}</MathText> },
          ]}
          answer={
            <>
              <p>
                <Tex>{`z=K_qC\\Delta\\sqrt{2MN}=${tx(K, 4)}\\times${tx(c85, 4)}\\times20\\times\\sqrt{2\\cdot8\\cdot4096}=${tx(z85, 4)}`}</Tex>。
                <Tex>{'\\hat K'}</Tex> 本身也有雜訊（標準差 <Tex>{'=\\mathrm{se}'}</Tex>），所以實際的 <Tex>{'\\hat K/\\mathrm{se}'}</Tex> 以 {nf(z85, 3)} 為中心、標準差 1 散布，落在 3 以下的機率約 {nf(100 * (1 - 0.5 * (1 + erf((z85 - 3) / Math.SQRT2))), 3)}%。
              </p>
              <p>
                要讓「期望 <Tex>{'z'}</Tex>」有裕度（例如 6），需要 <Tex>{`M\\ge 36/(2N\\Delta^2K^2)=${tx(requiredBlocks(K * c85, delta, N, 6), 4)}`}</Tex>。
                <Tex>{'C'}</Tex> 接近 0 的 FCW 本來就是 keep-out 的候選：恢復力弱、固定點 bias 被 <Tex>{'B/C'}</Tex> 放大。
              </p>
            </>
          }
        />
      </Section>

      <Section kind="formula" level={2} title="2.5 SSPLL GOS／PHOS：每個參數都要自己的極性檢查" id="so-sspll">
        <p>
          Subsampling PLL 的 GOS（DTC gain）與 PHOS（8 相 PMUX 的 phase offset）經過<strong>不同的有效路徑</strong>到達 sub-sampling PD，兩者的有效相關 <Tex>{'c_G'}</Tex>、<Tex>{'c_P'}</Tex>
          可以有不同的符號（物理機制見<a href="#/case/sspll">案例頁</a>）。只量 GOS 的極性不代表 PHOS 也對；兩個 loop 各自對也不代表一起更新會穩定。
        </p>
        <Steps
          title="兩參數模型的 Jacobian（小訊號）"
          steps={[
            { tex: String.raw`e_\text{det}=\delta_Gc_Gx_G+\delta_Pc_Px_P,\qquad \delta_i=a_i-w_i`, why: '兩個參數的殘差各自乘上自己的 regressor 與有效路徑相關（靜態近似）。' },
            { tex: String.raw`E[q\,x_G\mid x]\approx K_q\,e_\text{det}\,x_G`, why: String.raw`comparator 小訊號線性化（$|e_\text{det}|\ll\sigma_v$），再乘上 GOS 的 code。` },
            { tex: String.raw`E[G_G]\approx K_q\big(c_G\delta_GE[x_G^2]+c_P\delta_PE[x_Gx_P]\big)=K_q\big(c_G\delta_G+\rho_{GP}c_P\delta_P\big)`, why: String.raw`取期望：$\pm1$ code 時 $E[x_G^2]=1$，$E[x_Gx_P]=\rho_{GP}$。` },
            { tex: String.raw`E[G_P]\approx K_q\big(\rho_{GP}c_G\delta_G+c_P\delta_P\big)`, why: '同理（對 PHOS 的 GMAC）。' },
            { tex: String.raw`\mathbf J=\frac{\partial E[\mathbf G]}{\partial\mathbf w}=-K_q\begin{bmatrix}c_G&\rho_{GP}c_P\\\rho_{GP}c_G&c_P\end{bmatrix}=-K_q\,\mathbf R\,\mathrm{diag}(c_G,c_P)`, why: String.raw`對 $\mathbf w$ 微分：$\partial\delta_i/\partial w_i=-1$。` },
            { tex: String.raw`\det\big(\mathbf R\,\mathrm{diag}(\mathbf c)\big)=c_Gc_P(1-\rho_{GP}^2)`, why: String.raw`$2\times2$ 行列式；$|\rho_{GP}|<1$ 時符號只由 $c_Gc_P$ 決定。` },
          ]}
        />
        <ul>
          <li>
            <Tex>{'c_G,c_P>0'}</Tex>：<Tex>{'\\mathbf R\\,\\mathrm{diag}(\\mathbf c)'}</Tex> 與對稱正定矩陣相似，eigenvalue 全為正——只有<strong>步長太大</strong>才會不穩（<Tex>{'1-\\mu K_q\\lambda_{\\max}<-1'}</Tex>）。以 <Tex>{'c_G=c_P=c'}</Tex>、<Tex>{'\\mu_G=\\mu_P=\\mu'}</Tex> 為例，<Tex>{'\\mathbf R'}</Tex> 的 eigenvalue 是 <Tex>{'1\\pm\\rho_{GP}'}</Tex>，所以 <Tex>{'\\lambda_{\\max}=c\\,(1+|\\rho_{GP}|)'}</Tex> 比對角元素 <Tex>{'c'}</Tex> 大：
            單獨更新只要 <Tex>{'\\mu K_qc<2'}</Tex>，一起更新卻要 <Tex>{'\\mu K_qc\\,(1+|\\rho_{GP}|)<2'}</Tex>——所以「各自穩定、一起發散」是可能的。
          </li>
          <li>
            <Tex>{'c_Gc_P<0'}</Tex>：行列式為負 ⇒ 一個 eigenvalue 為負 ⇒ 對<strong>任何</strong> <Tex>{'\\mu>0'}</Tex> 都有一個發散模式。這就是「某個 SSPLL mode 下 PHOS 極性相反」的數學樣貌。
          </li>
          <li>
            <Tex>{'|\\rho_{GP}|\\to1'}</Tex>：行列式 <Tex>{'\\to0'}</Tex>，<Tex>{'\\sigma_{\\min}(\\mathbf J)\\to0'}</Tex>，兩個參數不可同時辨識。
          </li>
        </ul>
        <p className="small muted">
          想親手算「各自的 pole」與「一起更新的 pole」：<a href="#/ch/10">Ch10</a> 的手算題（T18：用 trace 與 determinant 求 <Tex>{'\\mathrm{eig}(\\mathbf I+\\mu\\mathbf J)'}</Tex>）與 <a href="#/ch/09">Ch09</a> 的手算題（<Tex>{'\\lambda=1\\pm\\rho'}</Tex> 與兩個 pole）用的就是這裡的矩陣，本頁不重複出題；
          全站題目彙整在<a href="#/workbook">手算練習簿</a>。
        </p>
        <TexBlock id="F-SO.6" label="兩參數 Jacobian 的中央差分量測">{String.raw`\hat J_{ij}=\frac{\bar G_i(\mathbf w+\Delta_j\mathbf e_j)-\bar G_i(\mathbf w-\Delta_j\mathbf e_j)}{2\Delta_j},\qquad \text{各 loop 極性}\iff-\hat J_{ii}>z\,\mathrm{se}`}</TexBlock>
        <Steps
          title={String.raw`可辨識性：量到的 $\sigma_{\min}$ 要多大，才算「顯著不是 0」？`}
          steps={[
            { tex: String.raw`\hat{\mathbf J}=\mathbf J+\mathbf E,\qquad E[E_{ij}]=0,\quad \mathrm{Var}(E_{ij})=\mathrm{se}_{ij}^2`, why: String.raw`量測值 = 真值 + 量測雜訊；每個元素的標準誤 $\mathrm{se}_{ij}$ 就是 §2.2 的 $\mathrm{se}(\hat S)$（中央差分的截斷偏差在 $\Delta\le0.3\sigma_v$ 時可忽略）。` },
            { tex: String.raw`|\sigma_i(\hat{\mathbf J})-\sigma_i(\mathbf J)|\le\|\mathbf E\|_2\le\|\mathbf E\|_F=\sqrt{\textstyle\sum_{ij}E_{ij}^2}`, why: String.raw`Weyl 不等式：矩陣被擾動 $\mathbf E$ 之後，每個奇異值最多移動 $\|\mathbf E\|_2$（最大奇異值）；而 $\|\mathbf E\|_2\le\|\mathbf E\|_F$（$\|\mathbf E\|_F^2$ 是所有奇異值平方的和）。` },
            { tex: String.raw`E\big[\|\mathbf E\|_F^2\big]=\sum_{ij}\mathrm{se}_{ij}^2\equiv\|\mathrm{se}\|_F^2`, why: '期望值是線性的：平方和的期望值 = 各元素變異數的和（不需要各元素互相獨立）。' },
            { tex: String.raw`P\big(\|\mathbf E\|_F\ge z\,\|\mathrm{se}\|_F\big)=P\big(\|\mathbf E\|_F^2\ge z^2E[\|\mathbf E\|_F^2]\big)\le\frac1{z^2}`, why: String.raw`Markov 不等式（非負隨機變數超過平均值 $z^2$ 倍的機率 $\le1/z^2$）；不需要分布假設。` },
            { tex: String.raw`\sigma_{\min}(\mathbf J)=0\ \Rightarrow\ \sigma_{\min}(\hat{\mathbf J})\le\|\mathbf E\|_F\ \Rightarrow\ P\big(\sigma_{\min}(\hat{\mathbf J})>z\,\|\mathrm{se}\|_F\big)\le\frac1{z^2}`, why: String.raw`把前兩步接起來：如果真實的 $\mathbf J$ 奇異（某個參數組合不可辨識），量到的 $\sigma_{\min}$ 超過門檻的機率很小。` },
          ]}
          result={String.raw`\sigma_{\min}(\hat{\mathbf J})>z\,\|\mathrm{se}\|_F\ \Longrightarrow\ \text{可以排除「}\mathbf J\text{ 奇異」（誤判機率}\le1/z^2\text{）}`}
        />
        <TexBlock id="F-SO.12" label="量測 Jacobian 的可辨識性門檻">{String.raw`|\sigma_i(\hat{\mathbf J})-\sigma_i(\mathbf J)|\le\|\hat{\mathbf J}-\mathbf J\|_F,\qquad \text{可辨識}\iff\sigma_{\min}(\hat{\mathbf J})>z\,\|\mathrm{se}\|_F`}</TexBlock>
        <p>
          <Tex>{'1/z^2'}</Tex> 是<strong>不需要分布假設</strong>的保守上界（<Tex>{`z=3`}</Tex> 時 <Tex>{`\\le${tx(100 / 9, 3)}\\%`}</Tex>）；量測雜訊近似高斯時實際的誤判機率小得多。
          反過來，沒過門檻<strong>不代表</strong> <Tex>{'\\mathbf J'}</Tex> 真的奇異——只代表這次量測分辨不出來：加大 <Tex>{'M'}</Tex>、<Tex>{'N'}</Tex> 讓 <Tex>{'\\|\\mathrm{se}\\|_F\\propto1/\\sqrt{MN}'}</Tex> 變小再量一次。
          <ClaimTag kind="exact" />（Weyl 與 Markov 不等式；前提是 <Tex>{'\\hat{\\mathbf J}'}</Tex> 不偏、<Tex>{'\\mathrm{se}_{ij}'}</Tex> 為真實標準誤——實作以樣本估計值代入，<Tex>{'M'}</Tex> 很小時要再保守一些 <ClaimTag kind="approx" />）
        </p>
        <HandCalcSlot id="HC-SO.2">
          預設值就是下面實驗的預設（<Tex>{'\\rho_{GP}=0.3'}</Tex>、<Tex>{'c_G=1'}</Tex>、<Tex>{'c_P=0.8'}</Tex>）。把 <Tex>{'\\rho_{GP}'}</Tex> 改成 <Tex>{'0.995'}</Tex>、<Tex>{'c_P'}</Tex> 改成 <Tex>{'1'}</Tex>，或把 <Tex>{'c_P'}</Tex> 改成 <Tex>{'-0.8'}</Tex>，看行列式與門檻怎麼變。
        </HandCalcSlot>
        <SspllJacobianExperiment />
        <CodeBlock source={judgesSrc} region="jacobianTwoParam" path={PATH} title="兩參數 freeze + 逐一擾動" />
      </Section>
    </>
  )
}
