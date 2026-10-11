import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, ModelLevel, Prereq, Section, SourceTag, Tex, TexBlock } from '@/components'
import { ChLink, Diagram, ErratumNote, md, sig, Steps, texHz, texNum } from '../common'
import { CHART_OUTPUT_SPLIT, CHART_TWO_PATHS, CHART_UPDATE_LOOP } from '../diagrams'
import { anchorNumbers, delayTable, dsmHandExample, pllNumbers, spurNumbers } from '../numbers'

const T = String.raw

/** §3：先用數字走一遍（全部由模型函式即時計算，見 numbers.ts）。 */
function HandCalc() {
  const ex = useMemo(() => dsmHandExample(), [])
  const an = useMemo(() => anchorNumbers(), [])
  return (
    <section aria-labelledby="lab-s3">
      <h2 id="lab-s3">3｜先算一次：用最小的例子把數字走一遍</h2>
      <p>
        在看任何推導之前，先用手算得出來的數字把整條鏈走一次。下面兩個例子的數字都是頁面載入時由模擬程式算出來的 <SourceTag kind="simulation" />，不是打字打上去的。
      </p>

      <Section kind="example" title="例 A：DSM 的 residue 是一把鋸齒">
        <p>
          取 FCW 小數 <Tex>{'\\alpha=1/4'}</Tex>、4-bit 的一階 DSM（<Tex>{`K=${ex.st.K},\\ M=${ex.st.M}`}</Tex>）。DSM 每個 reference 週期輸出 <Tex>{'y[n]\\in\\{0,1\\}'}</Tex>，平均值要等於{' '}
          <Tex>{'1/4'}</Tex>。「目前為止多給（或少給）了多少」就是 residue：
        </p>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <thead>
              <tr>
                <th>
                  <Tex>n</Tex>
                </th>
                {ex.rows.map((r) => (
                  <td key={r.n}>{r.n}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  <Tex>{'y[n]'}</Tex>
                </th>
                {ex.rows.map((r) => (
                  <td key={r.n}>{r.y}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'r[n]=\\sum(y-\\tfrac14)\\ [T_{\\mathrm{vco}}]'}</Tex>
                </th>
                {ex.rows.map((r) => (
                  <td key={r.n}>{sig(r.r, 4)}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'x[n]=r\\,s'}</Tex>（unit_rms）
                </th>
                {ex.rows.map((r) => (
                  <td key={r.n}>{sig(r.x, 4)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <Prereq title="期望值、均方與變異數（先當成「一個週期的平均」就夠了）">
          <p>
            {md(
              `本頁到處都是 $E[\\cdot]$（期望值，expectation）。現在先把它讀成「很長一段時間的平均」；對週期序列就是一個週期的平均：$E[r]=\\frac1P\\sum_{n=0}^{P-1}r[n]$。**均方** $E[r^2]$ 是「先平方再平均」，量訊號的功率，它的平方根叫 RMS。**變異數** $\\operatorname{Var}(r)=E\\bigl[(r-E[r])^2\\bigr]=E[r^2]-E[r]^2$ 量「扣掉平均值之後還晃多大」，它的平方根叫標準差 $\\sigma$。上表一個週期的四個值是 $0,-\\tfrac14,-\\tfrac12,-\\tfrac34$：$E[r]=${texNum(ex.st.mean, 4)}$、$E[r^2]=${texNum(ex.st.meanSquare, 5)}$、$\\operatorname{Var}(r)=${texNum(ex.st.variance, 5)}$。之後遇到隨機的雜訊時，$E[\\cdot]$ 改成「重複很多次實驗的平均」，算術規則完全一樣（§4.5）。`,
            )}
          </p>
        </Prereq>
        <p>
          你會發現：(1) <Tex>{'r[n]'}</Tex> 每 <Tex>{`P=${ex.st.P}`}</Tex> 個樣本重複一次，是一把往下走、然後跳回 0 的鋸齒；(2) 它永遠 <Tex>{'\\le0'}</Tex>，平均是{' '}
          <Tex>{`E[r]=${texNum(ex.st.mean, 4)}`}</Tex>，不是 0；(3) 均方是 <Tex>{`E[r^2]=${texNum(ex.st.meanSquare, 5)}`}</Tex>，所以 unit_rms 正規化的倍率是{' '}
          <Tex>{`s=1/\\sqrt{E[r^2]}=${texNum(ex.scale, 5)}`}</Tex>，正規化後 <Tex>{`E[x]=${texNum(ex.xMean, 4)}`}</Tex>、<Tex>{'E[x^2]=1'}</Tex>。
        </p>
        <p className="small">
          這三件事分別對應後面的三個問題：週期 <Tex>{'\\Rightarrow'}</Tex> 譜線與 spur；DC <Tex>{'\\Rightarrow'}</Tex> offset 造成的假 gain bias；變化的快慢 <Tex>{'\\Rightarrow'}</Tex> PD 看不看得到（PE）。
        </p>
      </Section>

      <Section kind="example" title="例 B：一個 block 的校正（規格的 T13 錨點）">
        <p>
          先把主 PLL 拿掉（<Tex>{'H_{\\mathrm{PD}}=1'}</Tex>），code 用 <Tex>{'\\pm1'}</Tex> 的隨機序列（<Tex>{'E[x^2]=1'}</Tex>）。參數：
          <Tex>{`a=${an.a}\\,\\mathrm{fs}`}</Tex>、<Tex>{`w_0=${an.w0}`}</Tex>、<Tex>{`\\sigma_v=${an.sigmaV}\\,\\mathrm{fs}`}</Tex>、<Tex>{`N=${an.N}`}</Tex>、<Tex>{`\\mu=${an.mu}\\,\\mathrm{fs}`}</Tex>、
          <Tex>{`f_s=${texHz(an.fs)}`}</Tex>。
        </p>
        <div className="table-wrap">
          <table className="lab-table">
            <thead>
              <tr>
                <th>步驟</th>
                <th>算式</th>
                <th className="lab-num">數值</th>
                <th>白話</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">1. 誤差有多大</th>
                <td>
                  <Tex>{'|e_{\\det}|=|\\delta_0\\,x|=|a-w_0|'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.delta0, 4)} fs</td>
                <td>
                  只有雜訊（{an.sigmaV} fs）的 {sig((100 * an.delta0) / an.sigmaV, 2)}%
                </td>
              </tr>
              <tr>
                <th scope="row">2. 一筆 comparator 輸出的平均</th>
                <td>
                  <Tex>{'E[q\\,x]=\\operatorname{erf}\\bigl(\\delta_0/(\\sqrt2\\sigma_v)\\bigr)'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.meanG0, 5)}</td>
                <td>
                  比 0 只偏一點點；線性近似 <Tex>{`K_q\\delta_0=${texNum(an.meanG0Lin, 5)}`}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  3. 累加 <Tex>N</Tex> 筆後的雜訊
                </th>
                <td>
                  <Tex>{'\\sigma_\\eta=1/\\sqrt N'}</Tex>
                </td>
                <td className="mono lab-num">{sig(Math.sqrt(an.sigmaEta2), 5)}</td>
                <td>
                  訊號 / 雜訊 = {sig(an.snrBlock, 3)}：一個 block 就勉強看得出方向
                </td>
              </tr>
              <tr>
                <th scope="row">4. 第一次更新（平均）</th>
                <td>
                  <Tex>{'w_1=w_0+\\mu\\,E[G_0]'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.w1, 4)} fs</td>
                <td>
                  往 <Tex>{`a=${an.a}`}</Tex> 走了 {sig((100 * an.w1) / an.a, 3)}%
                </td>
              </tr>
              <tr>
                <th scope="row">5. 每個 block 修掉的比例</th>
                <td>
                  <Tex>{'g=\\mu K_q C'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.g, 5)}</td>
                <td>
                  pole <Tex>{`p=1-g=${texNum(an.p, 5)}`}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">6. 多久收斂</th>
                <td>
                  <Tex>{'\\tau=-1/\\ln p'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.tau, 4)} blocks</td>
                <td>
                  約 <Tex>{`${texNum((an.tau * an.N) / an.fs / 1e-6, 3)}\\,\\mu\\mathrm{s}`}</Tex>（每個 block <Tex>{`${texNum(an.N / an.fs / 1e-6, 3)}\\,\\mu\\mathrm{s}`}</Tex>）
                </td>
              </tr>
              <tr>
                <th scope="row">7. 收斂後抖多大</th>
                <td>
                  <Tex>{'\\sigma_w=\\mu\\sqrt{\\sigma_\\eta^2/(1-p^2)}'}</Tex>
                </td>
                <td className="mono lab-num">{sig(an.sigmaW, 4)} fs</td>
                <td>這是 gain 的抖動，還不是輸出 jitter</td>
              </tr>
              <tr>
                <th scope="row">8. 校正迴路的頻寬</th>
                <td>
                  <Tex>{'f_u=f_s/N'}</Tex>；exact <Tex>{'-3\\,\\mathrm{dB}'}</Tex>；ENBW
                </td>
                <td className="mono lab-num">
                  {sig(an.fu / 1e3, 6)} kHz；{sig(an.bw.exact / 1e3, 4)} kHz；{sig(an.bw.enbw / 1e3, 4)} kHz
                </td>
                <td>
                  積分雜訊要用 ENBW（<ErratumNote id="E06" />）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          第 5–8 列就是規格 T13 / T14 的參考值（<Tex>{'p\\approx0.92021'}</Tex>、<Tex>{'\\sigma_w\\approx0.399\\,\\mathrm{fs}'}</Tex>、<Tex>{'f_u=976.5625\\,\\mathrm{kHz}'}</Tex>）。在 Lab 的 Pipeline 分頁載入 preset「T13
          錨點」，模擬值會落在這些數字附近。前提是 unit-RMS 的 <Tex>{'\\pm1'}</Tex> code、identity path、average GMAC（<ErratumNote id="E30" />）。
        </p>
      </Section>
    </section>
  )
}

/** §4：九級的逐步推導。 */
function Derivations() {
  const an = useMemo(() => anchorNumbers(), [])
  const pll = useMemo(() => pllNumbers(), [])
  const sp = useMemo(() => spurNumbers(), [])
  const dly = useMemo(() => delayTable(an.g), [an.g])
  return (
    <section aria-labelledby="lab-s4">
      <h2 id="lab-s4">4｜一步一步推導：每一級的公式從哪裡來</h2>
      <p>每個等號一行、每一行一個理由。Beginner 模式下推導預設收合，點一下就展開；所有結論都標了適用範圍。</p>

      {/* ---------- 4.1 ---------- */}
      <Section kind="formula" title="4.1　DSM residue 的平均、均方與譜線" id="lab-s41">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> 一階 DSM 就是一個會進位的累加器。它的 residue 有完整的封閉式，這讓 Lab 可以拿它當「對答案」的基準。
        </p>
        <Steps
          title="residue 的封閉式與統計量"
          steps={[
            { tex: T`\mathrm{acc}[n+1]=(\mathrm{acc}[n]+K)\bmod M,\qquad y[n]=\text{這一步有沒有進位}`, why: '一階 DSM 的定義：每個週期把 $K$ 加進 $B$-bit 累加器，溢位就輸出 1。' },
            { tex: T`\sum_{m=0}^{n}y[m]=\Bigl\lfloor\frac{(n+1)K}{M}\Bigr\rfloor`, why: '從 0 開始加了 $n+1$ 次 $K$，總共進位的次數就是商的整數部分。' },
            { tex: T`r[n]=\Bigl\lfloor\frac{(n+1)K}{M}\Bigr\rfloor-\frac{(n+1)K}{M}=-\Bigl\{\frac{(n+1)K}{M}\Bigr\}`, why: '代入 residue 的定義 $r[n]=\\sum(y-K/M)$；$\\{\\cdot\\}$ 是小數部分，所以 $-1<r\\le0$。' },
            { tex: T`r[n]=-\frac{j_n}{P},\qquad j_n=(n+1)K'\bmod P,\quad K'=\frac{K}{\gcd(K,M)},\ P=\frac{M}{\gcd(K,M)}`, why: '分子分母同除以最大公因數；$K\'$ 與 $P$ 互質。' },
            { tex: T`\{j_0,j_1,\dots,j_{P-1}\}=\{0,1,\dots,P-1\}`, why: '$K\'$ 與 $P$ 互質 $\\Rightarrow$ 乘以 $K\'$ 再取餘數是一對一的：一個週期內每個值恰好出現一次。' },
            { tex: T`E[r]=-\frac1P\sum_{j=0}^{P-1}\frac jP=-\frac{P-1}{2P}`, why: '用等差級數 $\\sum_{j=0}^{P-1}j=P(P-1)/2$。' },
            { tex: T`E[r^2]=\frac1P\sum_{j=0}^{P-1}\frac{j^2}{P^2}=\frac{(P-1)(2P-1)}{6P^2}`, why: '用平方和公式 $\\sum_{j=0}^{P-1}j^2=(P-1)P(2P-1)/6$。' },
            { tex: T`\operatorname{Var}(r)=E[r^2]-E[r]^2=\frac{(P-1)\bigl[2(2P-1)-3(P-1)\bigr]}{12P^2}=\frac{P^2-1}{12P^2}`, why: '通分後化簡；$P\\to\\infty$ 時趨近均勻分布的 $1/12$。' },
          ]}
        />
        <TexBlock id="F-LAB.2" label={md('一階 DSM residue 的統計量（$P\\to\\infty$：$E[r]\\to-\\tfrac12$、$E[r^2]\\to\\tfrac13$、$\\mathrm{Var}\\to\\tfrac1{12}$）。')}>
          {T`\boxed{E[r]=-\frac{P-1}{2P},\qquad E[r^2]=\frac{(P-1)(2P-1)}{6P^2},\qquad \operatorname{Var}(r)=\frac{P^2-1}{12P^2}}`}
        </TexBlock>
        <Prereq title="週期序列的傅立葉係數：把鋸齒拆成弦波">
          <p>
            {md(
              '任何週期 $P$ 的序列都可以寫成 $P$ 個複數弦波的和：$r[n]=\\sum_{m=0}^{P-1}X_m\\,e^{j2\\pi mn/P}$，其中 $e^{j\\theta}=\\cos\\theta+j\\sin\\theta$（尤拉公式）。係數 $X_m=\\frac1P\\sum_{n=0}^{P-1}r[n]\\,e^{-j2\\pi mn/P}$ 就是「$r$ 與第 $m$ 個弦波逐點相乘再平均」；$X_0$ 是平均值 $E[r]$。第 $m$ 個弦波的頻率是 $m\\,f_s/P$——頻譜上的一根**譜線**。實數序列的 $X_{P-m}$ 是 $X_m$ 的共軛，兩項合起來是一個實弦波 $2|X_m|\\cos(2\\pi mn/P+\\angle X_m)$，所以它的 peak 振幅是 $2|X_m|$。',
            )}
          </p>
        </Prereq>
        <Steps
          title="基頻譜線的振幅 $A_1$（為什麼近整數的 spur 這麼大）"
          steps={[
            { tex: T`X_1=\frac1P\sum_{n=0}^{P-1}r[n]\,e^{-j2\pi K'n/P}`, why: '基頻 $f_1=\\alpha_{\\mathrm{eff}}f_s$ 對應週期 $P$ 的第 $K\'$ 根譜線；$X_1$ 是它的傅立葉係數。' },
            { tex: T`X_1=-\frac{e^{\,j2\pi K'/P}}{P^2}\sum_{m=0}^{P-1}m\,\omega^m,\qquad \omega=e^{-j2\pi/P}`, why: '把求和變數換成 $m=j_n$（一對一）：$K\'n\\equiv m-K\'\\pmod P$，所以 $e^{-j2\\pi K\'n/P}=\\omega^{m}e^{j2\\pi K\'/P}$。' },
            { tex: T`S=\sum_{m=0}^{P-1}m\,\omega^m,\qquad (1-\omega)S=\sum_{m=1}^{P-1}\omega^m-(P-1)\,\omega^P=-1-(P-1)=-P`, why: '錯位相減；用到 $\\omega^P=1$ 與 $\\sum_{m=0}^{P-1}\\omega^m=0$（單位根的和）。' },
            { tex: T`|X_1|=\frac{1}{P^2}\cdot\frac{P}{|1-\omega|}=\frac{1}{2P\sin(\pi/P)}`, why: '$|1-e^{-j\\theta}|=2\\sin(\\theta/2)$，$\\theta=2\\pi/P$。' },
            { tex: T`A_1=2|X_1|=\frac{1}{P\sin(\pi/P)}`, why: '實數訊號的正、負頻率各有一根：peak 振幅是 $2|X_1|$（$P\\ge3$）。' },
          ]}
          result={T`A_1=\dfrac{1}{P\sin(\pi/P)}\;\xrightarrow{\;P\to\infty\;}\;\dfrac1\pi\approx0.3183\ T_{\mathrm{vco}}`}
        />
        <TexBlock id="F-LAB.3" label={md('基頻譜線的 peak 振幅；頻率是 $\\alpha_{\\mathrm{eff}}f_{\\mathrm{ref}}$ 折回 $[0,f_s/2]$。')}>
          {T`A_1=\frac{1}{P\sin(\pi/P)},\qquad f_1=\alpha_{\mathrm{eff}}\,f_{\mathrm{ref}}`}
        </TexBlock>
        <p className="small">
          白話：鋸齒的基頻振幅永遠是 peak-to-peak 的 <Tex>{'1/\\pi'}</Tex>（約三分之一），不會因為 FCW 靠近整數而變小；變的只是它的<strong>頻率</strong> <Tex>{'f_1=\\alpha f_{\\mathrm{ref}}'}</Tex>{' '}
          越來越低，低到掉進 PLL 頻寬內就濾不掉了。MASH 1-1-1 沒有這種單一的大譜線（能量被推到高頻），代價是 residue 範圍變成約 <Tex>{'\\pm2\\,T_{\\mathrm{vco}}'}</Tex>。
        </p>
      </Section>

      {/* ---------- 4.2 ---------- */}
      <Section kind="formula" title="4.2　正規化：$x=(r-o)\,s$ 的四種選法" id="lab-s42">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> GMAC 用的 regressor 是無因次的 <Tex>x</Tex>。怎麼把 <Tex>{'r\\,[T_{\\mathrm{vco}}]'}</Tex> 變成 <Tex>x</Tex>，決定了 <Tex>a</Tex>、<Tex>w</Tex>、
          <Tex>{'\\mu'}</Tex> 的單位，也決定 code 有沒有 DC。
        </p>
        <div className="table-wrap">
          <table className="lab-table">
            <thead>
              <tr>
                <th>模式</th>
                <th>
                  <Tex>o</Tex>
                </th>
                <th>
                  <Tex>s</Tex>
                </th>
                <th>
                  <Tex>{'E[x]'}</Tex>
                </th>
                <th>
                  <Tex>{'E[x^2]'}</Tex>
                </th>
                <th>
                  一階 DSM（<Tex>{'P\\to\\infty'}</Tex>）
                </th>
                <th>後果</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">none</th>
                <td>
                  <Tex>0</Tex>
                </td>
                <td>
                  <Tex>1</Tex>
                </td>
                <td>
                  <Tex>{'E[r]'}</Tex>
                </td>
                <td>
                  <Tex>{'E[r^2]'}</Tex>
                </td>
                <td>
                  <Tex>{'-\\tfrac12,\\ \\tfrac13'}</Tex>
                </td>
                <td>
                  <Tex>a</Tex> 的單位是 fs per <Tex>{'T_{\\mathrm{vco}}'}</Tex>；有效增益只有 <Tex>{'\\tfrac13'}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">zero_mean</th>
                <td>
                  <Tex>{'E[r]'}</Tex>
                </td>
                <td>
                  <Tex>1</Tex>
                </td>
                <td>
                  <Tex>0</Tex>
                </td>
                <td>
                  <Tex>{'\\mathrm{Var}(r)'}</Tex>
                </td>
                <td>
                  <Tex>{'0,\\ \\tfrac1{12}'}</Tex>
                </td>
                <td>去掉 DC；增益更小</td>
              </tr>
              <tr>
                <th scope="row">unit_rms（預設）</th>
                <td>
                  <Tex>0</Tex>
                </td>
                <td>
                  <Tex>{'1/\\sqrt{E[r^2]}'}</Tex>
                </td>
                <td>
                  <Tex>{'E[r]/\\sqrt{E[r^2]}'}</Tex>
                </td>
                <td>
                  <Tex>1</Tex>
                </td>
                <td>
                  <Tex>{'-\\tfrac{\\sqrt3}{2}\\approx-0.866,\\ 1'}</Tex>
                </td>
                <td>
                  <Tex>{'E[x^2]=1'}</Tex>（規格 §15.3），但<strong>保留 DC</strong>
                </td>
              </tr>
              <tr>
                <th scope="row">standardize</th>
                <td>
                  <Tex>{'E[r]'}</Tex>
                </td>
                <td>
                  <Tex>{'1/\\sqrt{\\mathrm{Var}(r)}'}</Tex>
                </td>
                <td>
                  <Tex>0</Tex>
                </td>
                <td>
                  <Tex>1</Tex>
                </td>
                <td>
                  <Tex>{'0,\\ 1'}</Tex>
                </td>
                <td>零均值、單位變異：最乾淨</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout kind="warn" title="code 的 DC 不是無害的">
          <p>
            {md(
              '$E[x]\\ne0$ 有兩個後果。(1) comparator offset $b$ 會與 $E[x_{\\mathrm{ref}}]$ 相乘，變成假的 gain bias $bE[x_{\\mathrm{ref}}]/C$（第 11 章）。(2) gain 的抖動 $\\delta w$ 乘上 $\\bar x$ 是一個**低頻**的時間誤差，$T$ 完全不濾它，直接出現在輸出（§4.9）。一階 DSM 配 unit_rms 時 $\\bar x\\approx-0.87$，兩個效應都很大；Lab 裡把正規化改成 standardize 就能看到差別。',
            )}
          </p>
        </Callout>
      </Section>

      {/* ---------- 4.3 ---------- */}
      <Section kind="formula" title="4.3　DTC：沒抵銷乾淨的時間誤差" id="lab-s43">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> DTC 應該產生 <Tex>{'a\\,x'}</Tex> 的延遲來抵銷 residue，實際上它用的是目前的係數 <Tex>w</Tex>，而且本身不完美：
        </p>
        <TexBlock>{T`e_{\mathrm{DTC}}[n]=\underbrace{(a-w_{\mathrm{app}})\,x[n]}_{\text{gain 誤差：校正要消掉的}}+\underbrace{o_{\mathrm{DTC}}+c_2x^2[n]+c_3x^3[n]}_{d(x)\text{：一個係數消不掉的}}`}</TexBlock>
        <p className="small">
          單位：<Tex>x</Tex> 無因次，所以 <Tex>{'a,\\ w'}</Tex> 是 fs per unit code、<Tex>{'e_{\\mathrm{DTC}}'}</Tex> 是 fs（<ErratumNote id="E13" />）。極性採全站約定 <Tex>{'\\delta=a-w'}</Tex>（<ErratumNote id="E32" />）。
          <Tex>{'w_{\\mathrm{app}}'}</Tex> 是「這個 block 實際作用在 DTC 上」的值：比最新的 <Tex>{'w_k'}</Tex> 晚 <Tex>d</Tex> 個 block，開定點時還要先量化成實體 code。<Tex>{'d(x)'}</Tex>{' '}
          的影響在 <ChLink to="/ch/11">第 11 章</ChLink>。
        </p>
      </Section>

      {/* ---------- 4.4 ---------- */}
      <Section kind="formula" title="4.4　主 PLL：同一個誤差的兩條路 $H_{\mathrm{PD}}$ 與 $T$" id="lab-s44">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> PLL 是負回授：phase detector 看到誤差，迴路就去移動輸出相位把它補掉。
        </p>
        <p>
          所以同一個 DTC 誤差 <Tex>{'e_{\\mathrm{DTC}}'}</Tex> 會在兩個地方留下痕跡：phase detector 上「還沒被補掉的部分」（記作 <Tex>{'u_{\\mathrm{pd}}'}</Tex>，comparator 看到的就是它），以及輸出端「已經被迴路搬過去的部分」（記作{' '}
          <Tex>{'\\theta_{\\mathrm{fb}}'}</Tex>，也就是輸出的 timing error <Tex>{'t_{\\mathrm{out}}'}</Tex>）。先看圖，再看推導。
        </p>
        <Diagram
          chart={CHART_TWO_PATHS}
          caption="主 PLL 的負回授：加法點的輸出送到 comparator（藍色，high-pass），回授量本身就是輸出端被移動的量（棕色，low-pass）。兩條路的轉移函數相加等於 1。"
          ariaLabel="主 PLL 負回授的方塊圖：DTC 誤差減去回授相位得到 PD residual，PD residual 經 open loop 變成回授相位；PD residual 送到 comparator，回授相位就是輸出 timing error"
        >
          <p>
            先看加法點：<Tex>{'e_{\\mathrm{DTC}}'}</Tex> 進來是「＋」，迴路已經補掉的 <Tex>{'\\theta_{\\mathrm{fb}}'}</Tex> 是「−」，所以加法點的輸出是 <Tex>{'u_{\\mathrm{pd}}=e_{\\mathrm{DTC}}-\\theta_{\\mathrm{fb}}'}</Tex>
            ——下面推導的第一行。
          </p>
          <p>
            圖上的 <Tex>{'L(z)'}</Tex> 是 open-loop transfer（loop filter 加 VCO 合起來）。藍色那條路從加法點<strong>之後</strong>拉出去，除以 <Tex>{'1+L'}</Tex>；棕色那條路是 <Tex>{'L(z)'}</Tex> 的輸出，乘上{' '}
            <Tex>{'L/(1+L)'}</Tex>。PD 沒看到的，全部到了輸出。
          </p>
        </Diagram>
        <Prereq title="Z transform 與頻率響應（只需要兩件事）">
          <p>
            {md(
              '(1) $z^{-1}$ 代表「延遲一個 sample」：序列 $x[n]$ 延遲一拍寫成 $z^{-1}X(z)$。所以「累加器」$y[n]=y[n-1]+x[n]$ 是 $Y=X/(1-z^{-1})$。(2) 把 $z=e^{j\\Omega}$ 代入，得到這個系統對頻率 $\\Omega$（rad/sample，$\\Omega=2\\pi f/f_s$）的弦波的增益與相位：$|H(e^{j\\Omega})|$ 是振幅倍率。$\\Omega=0$（$z=1$）就是 DC。',
            )}
          </p>
        </Prereq>
        <Steps
          title="$H_{\mathrm{PD}}=1/(1+L)$ 與 $T=1-H_{\mathrm{PD}}$"
          steps={[
            { tex: T`u_{\mathrm{pd}}=e_{\mathrm{DTC}}-\theta_{\mathrm{fb}}`, why: 'PD 看到的是「DTC 誤差」減去「迴路已經補掉的部分」。' },
            { tex: T`\theta_{\mathrm{fb}}=L(z)\,u_{\mathrm{pd}}`, why: '迴路把 PD 看到的誤差經 loop filter 與 VCO（合稱 open-loop $L$）變成回授相位。' },
            { tex: T`u_{\mathrm{pd}}\,(1+L)=e_{\mathrm{DTC}}\ \Rightarrow\ u_{\mathrm{pd}}=\frac{1}{1+L}\,e_{\mathrm{DTC}}=H_{\mathrm{PD}}\,e_{\mathrm{DTC}}`, why: '把第二式代入第一式，解出 $u_{\\mathrm{pd}}$。' },
            { tex: T`t_{\mathrm{out}}=\theta_{\mathrm{fb}}=\frac{L}{1+L}\,e_{\mathrm{DTC}}=T\,e_{\mathrm{DTC}}`, why: '輸出端被移動的量就是回授相位。' },
            { tex: T`H_{\mathrm{PD}}+T=\frac{1}{1+L}+\frac{L}{1+L}=1`, why: '所以 $T=1-H_{\\mathrm{PD}}$：PD 沒看到的，全部到了輸出。' },
          ]}
        />
        <Steps
          title="Type-I：由 $-3\,\mathrm{dB}$ 頻寬反解 pole（Lab 的設計公式）"
          steps={[
            { tex: T`L(z)=\frac{k\,z^{-1}}{1-z^{-1}}\ \Rightarrow\ 1+L=\frac{1-\rho_T z^{-1}}{1-z^{-1}},\qquad \rho_T=1-k`, why: '一個積分器（VCO）加一拍延遲；通分。' },
            { tex: T`H_{\mathrm{PD}}=\frac{1-z^{-1}}{1-\rho_T z^{-1}},\qquad T=\frac{k\,z^{-1}}{1-\rho_T z^{-1}}`, why: '代入上面兩個定義。$H_{\\mathrm{PD}}$ 在 $z=1$ 有零點（擋 DC），$T$ 是一階 low-pass。' },
            { tex: T`|T(e^{j\Omega})|^2=\frac{(1-\rho_T)^2}{1-2\rho_T\cos\Omega+\rho_T^2}=\frac{(1-\rho_T)^2}{(1-\rho_T)^2+4\rho_T\sin^2(\Omega/2)}`, why: '$|1-\\rho e^{-j\\Omega}|^2=1-2\\rho\\cos\\Omega+\\rho^2$，再用 $\\cos\\Omega=1-2\\sin^2(\\Omega/2)$。' },
            { tex: T`|T|^2=\tfrac12\ \Rightarrow\ 4\rho_T\sin^2\frac{\Omega_3}{2}=(1-\rho_T)^2\ \Rightarrow\ \sin\frac{\Omega_3}{2}=\frac{1-\rho_T}{2\sqrt{\rho_T}}`, why: '$-3\\,\\mathrm{dB}$ 的定義：功率降到 DC 的一半。' },
            { tex: T`r=\sqrt{\rho_T},\ s=\sin\frac{\pi f_{\mathrm{BW}}}{f_s}:\qquad 1-r^2=2sr\ \Rightarrow\ r=\sqrt{1+s^2}-s`, why: '令 $\\Omega_3/2=\\pi f_{\\mathrm{BW}}/f_s$，變成 $r$ 的二次方程，取正根。' },
          ]}
          result={T`\rho_T=\bigl(\sqrt{1+s^2}-s\bigr)^2,\qquad s=\sin\frac{\pi f_{\mathrm{BW}}}{f_s}`}
        />
        <TexBlock id="F-LAB.4" label="兩條路徑的定義，與 Type-I 的設計公式。">
          {T`H_{\mathrm{PD}}(z)=\frac{1}{1+L(z)},\qquad T(z)=1-H_{\mathrm{PD}}(z),\qquad \rho_T=\Bigl(\sqrt{1+s^2}-s\Bigr)^2`}
        </TexBlock>
        <p>
          數字：<Tex>{`f_{\\mathrm{BW}}=${texHz(pll.fBw)},\\ f_s=${texHz(pll.fs)}`}</Tex> 時 <Tex>{`s=${texNum(pll.s, 6)}`}</Tex>、<Tex>{`\\rho_T=${texNum(pll.rho, 7)}`}</Tex>、
          <Tex>{`k=${texNum(pll.k, 5)}`}</Tex>。Type-II（<ErratumNote id="E44" /> 的直接差分方程，<Tex>{'K_p=2\\zeta\\omega_nT_s'}</Tex>、<Tex>{'K_i=(\\omega_nT_s)^2'}</Tex>）在同樣頻寬、
          <Tex>{`\\zeta=${pll.zeta}`}</Tex> 下是 <Tex>{`\\omega_nT_s=${texNum(pll.t2.wnTs ?? NaN, 5)}`}</Tex>、<Tex>{`K_p=${texNum(pll.t2.Kp ?? NaN, 5)}`}</Tex>、<Tex>{`K_i=${texNum(pll.t2.Ki ?? NaN, 5)}`}</Tex>
          ，實際的 DT <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 是 <Tex>{texHz(pll.t2.f3dbTHz, 5)}</Tex>。
        </p>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <caption>兩種迴路在幾個頻率的振幅響應（由 pllDesign 的係數算出）</caption>
            <thead>
              <tr>
                <th>
                  <Tex>f</Tex>
                </th>
                <th>
                  Type-I <Tex>{'|H_{\\mathrm{PD}}|'}</Tex>
                </th>
                <th>
                  Type-I <Tex>{'|T|'}</Tex>
                </th>
                <th>
                  Type-II <Tex>{'|H_{\\mathrm{PD}}|'}</Tex>
                </th>
                <th>
                  Type-II <Tex>{'|T|'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {pll.rows.map((r) => (
                <tr key={r.f}>
                  <th scope="row">
                    <Tex>{texHz(r.f, 3)}</Tex>
                  </th>
                  <td>{sig(r.h1, 3)}</td>
                  <td>{sig(r.t1, 3)}</td>
                  <td>{sig(r.h2, 3)}</td>
                  <td>{sig(r.t2, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          你會發現：頻寬以下，Type-II 的 <Tex>{'|H_{\\mathrm{PD}}|'}</Tex> 以每十倍頻 <Tex>{'40\\,\\mathrm{dB}'}</Tex> 的速度變小（兩個積分器），Type-I 只有 <Tex>{'20\\,\\mathrm{dB}'}</Tex>。code 裡比 PLL
          頻寬慢的成分，PD 幾乎看不到——<strong>但輸出端全部看得到</strong>（<Tex>{'|T|\\approx1'}</Tex>）。兩者在 <Tex>{'z=1'}</Tex> 都是 <Tex>{'H_{\\mathrm{PD}}(1)=0'}</Tex>：code 的 DC 與 DTC offset
          到不了 comparator（<ErratumNote id="E03" />、<ErratumNote id="E04" />）。
        </p>
      </Section>

      {/* ---------- 4.5 ---------- */}
      <Section kind="formula" title="4.5　Comparator：1 bit 裡還剩多少資訊" id="lab-s45">
        <p>
          <ModelLevel level="L1" /> <ClaimTag kind="approx" /> comparator 的輸入是 <Tex>{'e=e_{\\det}+v'}</Tex>，其中 <Tex>{'e_{\\det}=u_{\\mathrm{pd}}+b'}</Tex> 是確定的部分、<Tex>v</Tex> 是雜訊。
        </p>
        <Prereq title="期望值、Gaussian 與 erf">
          <p>
            {md(
              '期望值 $E[\\cdot]$ 就是「重複很多次的平均」。Gaussian 雜訊 $v\\sim\\mathcal N(0,\\sigma_v^2)$ 小於某個門檻 $t$ 的機率寫成 $\\Phi(t/\\sigma_v)$，$\\Phi$ 是標準常態的累積分布（S 形曲線，$\\Phi(0)=\\tfrac12$）。$\\operatorname{erf}(z)=2\\Phi(\\sqrt2 z)-1$ 只是同一條曲線換個刻度；在 $z$ 很小時 $\\operatorname{erf}(z)\\approx2z/\\sqrt\\pi$（泰勒一階）。詳見第 5 章。',
            )}
          </p>
        </Prereq>
        <Steps
          title="$E[q]$ 與小訊號增益 $K_q$"
          steps={[
            { tex: T`P(q=+1)=P(e_{\det}+v\ge0)=P(v\ge-e_{\det})=\Phi\!\Bigl(\frac{e_{\det}}{\sigma_v}\Bigr)`, why: '$q=+1$ 的條件是 $e\\ge0$；Gaussian 對稱，所以 $P(v\\ge-t)=\\Phi(t/\\sigma_v)$。' },
            { tex: T`E[q]=(+1)\,P(q=+1)+(-1)\,P(q=-1)=2\Phi\!\Bigl(\frac{e_{\det}}{\sigma_v}\Bigr)-1=\operatorname{erf}\!\Bigl(\frac{e_{\det}}{\sqrt2\,\sigma_v}\Bigr)`, why: '期望值的定義，加上 $P(q=-1)=1-P(q=+1)$。' },
            { tex: T`E[q]\approx\frac{2}{\sqrt\pi}\cdot\frac{e_{\det}}{\sqrt2\,\sigma_v}=\sqrt{\frac2\pi}\,\frac{e_{\det}}{\sigma_v}`, why: '泰勒一階：$|e_{\\det}|\\ll\\sigma_v$ 時 erf 幾乎是直線。' },
          ]}
          result={T`E[q\mid e_{\det}]\approx K_q\,e_{\det},\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`}
        />
        <TexBlock id="F-LAB.5" label={md(`$\\sigma_v=${an.sigmaV}\\,\\mathrm{fs}$ 時 $K_q=${texNum(an.Kq, 6)}\\,\\mathrm{fs}^{-1}$（T04）。`)}>
          {T`E\bigl[q\mid e_{\det}\bigr]=\operatorname{erf}\!\Bigl(\frac{e_{\det}}{\sqrt2\,\sigma_v}\Bigr)\approx K_q\,e_{\det},\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`}
        </TexBlock>
        <p className="small">
          「小誤差」指的是<strong>整個</strong> <Tex>{'e_{\\det}'}</Tex>（含 INL、offset 經 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 的部分）都遠小於 <Tex>{'\\sigma_v'}</Tex>，不只是 <Tex>{'|a-w|'}</Tex> 小（
          <ErratumNote id="E01" />）。Lab 的 comparator 卡片會顯示穩態的 <Tex>{'\\max|e_{\\det}|/\\sigma_v'}</Tex>，超過 0.5 就警告。tie 規則：<Tex>{'e=0'}</Tex> 取 <Tex>{'+1'}</Tex>（<ErratumNote id="E07" />）。
        </p>
      </Section>

      {/* ---------- 4.6 ---------- */}
      <Section kind="formula" title="4.6　GMAC：把 1-bit 與 code 相關起來，得到 $C$" id="lab-s46">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="approx" /> GMAC 做的事只有一件：把每一筆 <Tex>q</Tex> 乘上 regressor <Tex>{'x_{\\mathrm{ref}}'}</Tex>，在一個 block 內平均。
        </p>
        <Prereq title="相關（correlation）、自相關與 impulse response">
          <p>
            {md(
              '兩個序列的**相關** $E[x\\,y]$ 是「逐點相乘再平均」：兩者同步起伏時為正，反相時為負，彼此無關時接近 0。GMAC 做的就是這件事（$q$ 對 $x_{\\mathrm{ref}}$）。**自相關** $R_x[k]=E\\bigl[x[n]\\,x[n-k]\\bigr]$ 是「序列與延遲 $k$ 拍的自己」的相關：$R_x[0]=E[x^2]$；白色（每一拍都獨立、零均值）的序列只有 $R_x[0]\\ne0$；變化很慢的序列 $R_x[k]$ 衰減得很慢。線性濾波器的輸出是輸入的加權和 $u_x[n]=\\sum_{k\\ge0}h[k]\\,x[n-k]$（這個運算叫**卷積**），權重 $h[k]$ 叫 **impulse response**（輸入只有一拍是 1 時的輸出）。把它代進相關，期望值可以逐項拿進求和裡：$E[x\\,u_x]=\\sum_k h[k]\\,E\\bigl[x[n]\\,x[n-k]\\bigr]$，也就是 $\\sum_k h[k]\\,R_x[k]$——下面表格裡 $C$ 的式子就是這樣來的。',
            )}
          </p>
        </Prereq>
        <Steps
          title="平均的 GMAC 輸出：$E[G]\approx K_q(C\delta+B)$"
          steps={[
            { tex: T`e_{\det}[n]=H_{\mathrm{PD}}\{(a-w)\,x+d(x)\}[n]+b`, why: 'PD residual（§4.4）加上 comparator offset。' },
            { tex: T`e_{\det}[n]\approx\delta\,u_x[n]+u_d[n]+b,\qquad u_x=H_{\mathrm{PD}}\{x\},\ u_d=H_{\mathrm{PD}}\{d(x)\}`, why: '濾波器是線性的；$w$ 每個 block 才動一點，在 $H_{\\mathrm{PD}}$ 的記憶長度內近似常數，可以提到外面。' },
            { tex: T`E[G]=E\bigl[q\,x_{\mathrm{ref}}\bigr]\approx K_q\,E\bigl[x_{\mathrm{ref}}\,e_{\det}\bigr]`, why: '先對雜訊 $v$ 取期望值（§4.5），$x_{\\mathrm{ref}}$ 與 $v$ 獨立。' },
            { tex: T`E[G]\approx K_q\Bigl(\delta\,\underbrace{E[x_{\mathrm{ref}}u_x]}_{C}+\underbrace{E[x_{\mathrm{ref}}u_d]+b\,E[x_{\mathrm{ref}}]}_{B}\Bigr)`, why: '把 $e_{\\det}$ 的三項代進去，期望值是線性的。' },
            { tex: T`E[G]=0\ \Rightarrow\ \delta^*=-\frac BC\ \Rightarrow\ w^*=a+\frac BC`, why: '迴路停在 $E[G]=0$ 的地方；那裡 $w$ 不一定等於 $a$（第 11 章：GMAC 歸零不代表 DTC 誤差為零）。' },
          ]}
        />
        <TexBlock id="F-LAB.6" label={md('$C$ 是「GMAC 用的 regressor」與「PD 實際看到的 code」的相關。$C>0$ 才是負回授。')}>
          {T`\boxed{E[G_k]\approx K_q\,C\,\delta_k,\qquad C=E\bigl[x_{\mathrm{ref}}[n]\,u_x[n]\bigr],\qquad u_x=H_{\mathrm{PD}}\{x\}}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="lab-table">
            <caption>
              三種 regressor 的 <Tex>C</Tex>（<ChLink to="/ch/07">第 7 章</ChLink>）
            </caption>
            <thead>
              <tr>
                <th>regressor</th>
                <th>
                  <Tex>{'x_{\\mathrm{ref}}[n]'}</Tex>
                </th>
                <th>
                  <Tex>C</Tex>
                </th>
                <th>什麼時候會出事</th>
                <th>硬體成本</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">raw</th>
                <td>
                  <Tex>{'x[n]'}</Tex>
                </td>
                <td>
                  <Tex>{'E[x\\,u_x]=\\sum_k h[k]R_x[k]'}</Tex>
                </td>
                <td>
                  code 很慢（近整數）時 <Tex>{'C\\to0^+'}</Tex>：學得到但極慢
                </td>
                <td>0</td>
              </tr>
              <tr>
                <th scope="row">delayed</th>
                <td>
                  <Tex>{'x[n-D]'}</Tex>
                </td>
                <td>
                  <Tex>{'C_D=\\sum_k h[k]R_x[k-D]'}</Tex>
                </td>
                <td>
                  <Tex>D</Tex> 對某個 FCW 是對的，換一個 FCW 就可能 <Tex>{'C_D<0'}</Tex>
                </td>
                <td>
                  <Tex>D</Tex> 個暫存器
                </td>
              </tr>
              <tr>
                <th scope="row">filtered-x</th>
                <td>
                  <Tex>{'\\hat H\\{x\\}[n-D]'}</Tex>
                </td>
                <td>
                  <Tex>{'E[\\hat u\\,u_x]'}</Tex>；<Tex>{'\\hat H=H'}</Tex> 時 <Tex>{'=E[u_x^2]\\ge0'}</Tex>
                </td>
                <td>
                  模型 <Tex>{'\\hat H'}</Tex> 的增益符號或延遲錯了（<ErratumNote id="E45" />）
                </td>
                <td>一個數位濾波器</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          <Tex>{'h[k]'}</Tex> 是 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 的 impulse response、<Tex>{'R_x[k]'}</Tex> 是 code 的自相關。因為 <Tex>{'L(z)'}</Tex> 至少延遲一拍，<Tex>{'h[0]=1'}</Tex>：白色的 code（
          <Tex>{'R_x[k]=0,\\ k\\ne0'}</Tex>）恆有 <Tex>{'C=\\sigma_x^2>0'}</Tex>。這就是為什麼 MASH / 隨機 code 的極性很穩，而慢速的鋸齒 code 會出問題。
        </p>
      </Section>

      {/* ---------- 4.7 ---------- */}
      <Section kind="formula" title="4.7　更新迴路：pole、延遲與 $\sigma_w$" id="lab-s47">
        <p>
          <ModelLevel level="L1" /> <ClaimTag kind="exact" />（平均模型本身）／<ClaimTag kind="approx" />（它對 sign-LMS 的適用性）
        </p>
        <p>
          前六級都在 sample rate（索引 <Tex>n</Tex>）運作；從這裡開始換成 block rate（索引 <Tex>k</Tex>）：每 <Tex>N</Tex> 個 sample，GMAC 交出一個數字 <Tex>{'G_k'}</Tex>，係數才動一次。把 §4.6 的結果（GMAC 的平均輸出正比於係數誤差）當成一個方塊{' '}
          <Tex>{'\\times K'}</Tex>，整個校正迴路就是下面這一圈。
        </p>
        <Diagram
          chart={CHART_UPDATE_LOOP}
          caption="block rate 的校正迴路：係數誤差乘上 GMAC 斜率、加上雜訊、乘 learning rate、進累加器，再晚 d 個 block 才作用到 DTC。藍色兩塊相乘就是迴路增益，棕色是更新延遲。"
          ariaLabel="block rate 校正迴路的方塊圖：真值減去延遲後的係數得到係數誤差，乘 K 加雜訊得到 GMAC 輸出，乘 learning rate 後進累加器，經 d 個 block 的延遲回授"
        >
          <p>
            先看 <Tex>a</Tex> 進去的那個加法點：真值 <Tex>a</Tex> 進來是「＋」，實際作用在 DTC 上的係數是「−」，輸出就是係數誤差 <Tex>{'\\delta=a-w'}</Tex>（全站極性）。順著箭頭走一圈：乘 <Tex>K</Tex>、加上這個 block 的雜訊{' '}
            <Tex>{'\\eta_k'}</Tex>、乘 <Tex>{'\\mu'}</Tex>、進累加器。
          </p>
          <p>
            圖上藍色的 <Tex>{'\\times K'}</Tex> 與 <Tex>{'\\times\\mu'}</Tex> 相乘就是無因次的迴路增益 <Tex>{'g=\\mu K'}</Tex>。棕色的 <Tex>{'z^{-d}'}</Tex> 不改變 <Tex>g</Tex>，但迴路多繞了 <Tex>d</Tex> 個 block 才看到自己的修正，可以用的{' '}
            <Tex>g</Tex> 範圍因此變小（下面的表）。
          </p>
        </Diagram>
        <Prereq title="差分方程、pole 與單位圓">
          <p>
            {md(
              '一階遞迴 $\\delta_{k+1}=p\\,\\delta_k$ 的解是等比數列 $\\delta_k=p^k\\delta_0$：$|p|<1$ 才會趨近 0（第 3 章）。階數比較高的遞迴（例如有延遲）沒有這麼直接，但可以「猜」解的形式 $\\delta_k=z^k$ 代進去，得到一個 $z$ 的多項式方程（**特徵方程**）。它的每個根 $z_i$（可以是複數）對應一個模態 $z_i^k$，而 $|z_i^k|=|z_i|^k$——所以「每個根的絕對值都小於 1」，也就是所有根都落在複數平面上半徑 1 的圓（**單位圓**）內，才會收斂。這些根叫 **pole**。最大的 $|z_i|$ 記作 $\\rho$，它決定最慢的衰減：$\\rho^k=e^{-k/\\tau}$，$\\tau=-1/\\ln\\rho$。根是複數時，衰減的同時還會來回振盪（振鈴）。',
            )}
          </p>
        </Prereq>
        <Steps
          title="平均模型與特徵方程"
          steps={[
            { tex: T`w_{k+1}=w_k+\mu\,G_k`, why: '更新式（average 模式）。' },
            { tex: T`G_k=K\,\delta_{k-d}+\eta_k,\qquad K=K_qC`, why: '§4.6 的平均值加上零均值的 GMAC 雜訊 $\\eta_k$；這個 block 作用在 DTC 上的是 $d$ 個 block 以前的 $w$。' },
            { tex: T`\delta_{k+1}=a-w_{k+1}=\delta_k-\mu K\,\delta_{k-d}-\mu\eta_k`, why: '兩邊用 $a$ 去減。' },
            { tex: T`\delta_{k+1}=\delta_k-g\,\delta_{k-d}-\mu\eta_k,\qquad g=\mu K`, why: '$g$ 是無因次的迴路增益（sum 模式要再乘 $N$）。' },
            { tex: T`z^{d+1}-z^{d}+g=0`, why: '令 $\\eta=0$、試 $\\delta_k=z^k$：兩邊除以 $z^{k-d}$。所有根都在單位圓內才（平均）收斂。' },
            { tex: T`d=0:\ z=p=1-g\ \Rightarrow\ 0<g<2;\qquad \text{一般 }d:\ 0<g<2\sin\frac{\pi}{4d+2}`, why: '$d=0$ 是等比數列；有延遲時臨界根落在單位圓上角度 $\\pi/(2d+1)$ 處（第 8 章）。' },
          ]}
        />
        <TexBlock id="F-LAB.7" label={md('$\\rho$ 是特徵方程最大的根的模；$\\tau=-1/\\ln\\rho$。')}>
          {T`\delta_{k+1}=\delta_k-g\,\delta_{k-d},\quad g=\mu K_qC;\qquad z^{d+1}-z^{d}+g=0,\quad \rho=\max|z|,\quad g_{\mathrm{crit}}=2\sin\frac{\pi}{4d+2}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <caption>
              更新延遲 <Tex>d</Tex> 的影響（<Tex>{`g=${texNum(an.g, 5)}`}</Tex>，即例 B 的設定；<Tex>{'\\rho'}</Tex> 由數值求根）
            </caption>
            <thead>
              <tr>
                <th>
                  <Tex>d</Tex> [blocks]
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{r.d}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  <Tex>{'g_{\\mathrm{crit}}=2\\sin\\frac{\\pi}{4d+2}'}</Tex>
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{sig(r.gCrit, 5)}</td>
                ))}
              </tr>
              <tr>
                <th>
                  開始振鈴的 <Tex>{'g_{\\mathrm{break}}=\\frac{d^d}{(d+1)^{d+1}}'}</Tex>
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{Number.isFinite(r.gBreak) ? sig(r.gBreak, 4) : '—'}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'\\rho'}</Tex>（這個 <Tex>g</Tex>）
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{sig(r.rho, 5)}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'\\mathrm{PM}=90^\\circ-(2d+1)\\arcsin\\frac g2'}</Tex>
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{sig(r.pmDeg, 4)}°</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'\\rho'}</Tex>（若 <Tex>{'g=\\tfrac12g_{\\mathrm{crit}}'}</Tex>）
                </th>
                {dly.map((r) => (
                  <td key={r.d}>{sig(r.rhoHalfCrit, 4)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          這張表有一個容易讀錯的地方：<Tex>g</Tex> 很小時，延遲越長 <Tex>{'\\rho'}</Tex> 反而<strong>越小</strong>（收斂略快）。這不代表延遲是好事。用微積分看：實數根滿足 <Tex>{'z^d(1-z)=g'}</Tex>，左邊在{' '}
          <Tex>{'z=\\tfrac{d}{d+1}'}</Tex> 有最大值 <Tex>{'g_{\\mathrm{break}}=d^d/(d+1)^{d+1}'}</Tex>（對 <Tex>z</Tex> 微分等於 0）。<Tex>{'g<g_{\\mathrm{break}}'}</Tex> 時有兩個實根，延遲把主導的那個往內推；
          <Tex>{'g>g_{\\mathrm{break}}'}</Tex> 時兩根合併成一對共軛複根，<Tex>{'\\delta_k'}</Tex> 開始振鈴（overshoot），再大到 <Tex>{'g_{\\mathrm{crit}}'}</Tex> 就碰到單位圓。延遲真正的代價是<strong>可用的 <Tex>g</Tex>{' '}
          範圍被壓縮</strong>：<Tex>{'d=0'}</Tex> 可以到 2，<Tex>{`d=4`}</Tex> 只剩 <Tex>{`${texNum(dly[4].gCrit, 3)}`}</Tex>，而且例 B 的 <Tex>{`g=${texNum(an.g, 3)}`}</Tex> 在 <Tex>{'d=4'}</Tex> 時已經貼著{' '}
          <Tex>{`g_{\\mathrm{break}}=${texNum(dly[4].gBreak, 3)}`}</Tex>；PM 每多一個 block 的延遲少 <Tex>{`${texNum((2 * Math.asin(an.g / 2) * 180) / Math.PI, 3)}^\\circ`}</Tex>（<Tex>{'2\\arcsin(g/2)'}</Tex>）。PVT 讓 <Tex>g</Tex>{' '}
          漂移時，延遲越長越容易跨過邊界（<ChLink to="/ch/08">第 8 章</ChLink>）。
        </p>
        <Steps
          title="穩態變異數 $\sigma_w^2$（$d=0$）"
          steps={[
            { tex: T`\delta w_{k+1}=p\,\delta w_k+\mu\,\eta_k`, why: '相對固定點的擾動 $\\delta w=w-w^*$ 滿足同一個遞迴（極性與 $\\delta$ 相反，變異數不受影響）。' },
            { tex: T`\operatorname{Var}(\delta w_{k+1})=p^2\operatorname{Var}(\delta w_k)+\mu^2\sigma_\eta^2`, why: '$\\eta_k$ 與過去的 $\\delta w_k$ 獨立，兩項的變異數相加。' },
            { tex: T`\sigma_w^2=p^2\sigma_w^2+\mu^2\sigma_\eta^2\ \Rightarrow\ \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`, why: '穩態時變異數不再改變。' },
            { tex: T`\sigma_\eta^2=\operatorname{Var}(G_k)=\frac1N\operatorname{Var}(q\,x_{\mathrm{ref}})\approx\frac{E[x_{\mathrm{ref}}^2]}{N}`, why: '$N$ 筆獨立樣本平均；$q^2=1$，且近平衡時 $E[q\\,x_{\\mathrm{ref}}]\\approx0$。' },
          ]}
        />
        <TexBlock id="F-LAB.8" label={md(`例 B：$\\sigma_w=${texNum(an.sigmaW, 4)}\\,\\mathrm{fs}$（T13）。`)}>
          {T`\boxed{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2},\qquad \sigma_\eta^2\approx\frac{E[x_{\mathrm{ref}}^2]}{N}}`}
        </TexBlock>
        <Callout kind="warn" title="「穩定」說的是哪一種">
          <p>
            {md(
              '$\\rho<1$ 只保證**線性化平均模型**在固定點附近收斂。它沒有說：(1) 每一條軌跡都收斂（雜訊讓 $w$ 永遠在 $w^*$ 附近抖動）；(2) 從很遠的初值出發也收斂（sign-LMS 的 $G$ 有界，遠處是線性漂移，不是指數）；(3) $w^*$ 等於 $a$。反過來，$\\rho\\ge1$ 時 sign-LMS 也不會數值爆炸，而是進入大振幅的 limit cycle。',
            )}
          </p>
        </Callout>
      </Section>

      {/* ---------- 4.8 ---------- */}
      <Section kind="formula" title="4.8　Gain register：定點之後多了什麼" id="lab-s48">
        <p>
          <ModelLevel level="L5" /> <ClaimTag kind="exact" />（bit-true 的 rounding / 飽和） 開啟「定點 gain register」後，<Tex>{'w_k'}</Tex> 存在 <Tex>{'B_{\\mathrm{int}}'}</Tex>-bit 的內部暫存器，送到 DTC 的只有高位的{' '}
          <Tex>{'B_{\\mathrm{phys}}'}</Tex> bits（一個 LSB 是 <Tex>{'\\Delta'}</Tex> fs）。多出來的現象：
        </p>
        <ul>
          <li>
            {md('**靜態誤差**：$w^*$ 不在格點上時，實體 code 只能停在最近的格點或在兩格之間跳，平均誤差最多 $\\Delta/2$。')}
          </li>
          <li>{md('**dead zone / limit cycle**：$\\sigma_w\\ll\\Delta$ 時雜訊不夠把 code 推過門檻（第 13 章）。Lab 在 $\\Delta>2\\sigma_{w,\\mathrm{pred}}$ 時警告，並把線性的 $\\sigma_w$ 檢查標成不適用。')}</li>
          <li>{md('**飽和與 wrap**：unsigned 的 6-bit、$\\Delta=0.125\\,\\mathrm{fs}$ 只能表示 $[0,\\,7.875]\\,\\mathrm{fs}$；$a$ 超出範圍時會卡在端點（saturate）或跳到另一端（wrap，RTL bug）。')}</li>
        </ul>
        <p className="small">
          閉迴路內只模擬 rounding（nearest / truncate / stochastic）。<Tex>{'\\Delta\\Sigma'}</Tex>、toggle 等策略在 <ChLink to="/ch/13">第 13 章</ChLink> 是開迴路比較；Lab 的 register 卡片下方有一張用第 13
          章函式算的「what-if」表。交叉比對的 Fixed-Point 欄是「定點 vs 同一個 seed 的浮點」。
        </p>
      </Section>

      {/* ---------- 4.9 ---------- */}
      <Section kind="formula" title="4.9　輸出端：jitter、PSD 與 spur" id="lab-s49">
        <p>
          <ModelLevel level="L4" /> <ClaimTag kind="approx" /> 最後回到使用者在乎的量。把 <Tex>{'w_{\\mathrm{app}}'}</Tex> 拆成「視窗內的平均 <Tex>{'\\bar w'}</Tex>」加「抖動 <Tex>{'\\delta w'}</Tex>」：
        </p>
        <Diagram
          chart={CHART_OUTPUT_SPLIT}
          caption="輸出端的兩個成分：靜態的 gain 殘差（藍色）留下固定的 fractional spur；gain 抖動（棕色）乘上 code 之後才是隨機 jitter。兩者都經過 output transfer，不是 PD 的 error path。"
          ariaLabel="輸出 timing error 的方塊圖：code 分別乘上靜態 gain 殘差、經過 INL、乘上 gain 抖動，三項相加（抖動為負）得到 DTC 誤差，經 output transfer 後分成 fractional spur 與隨機 jitter"
        >
          <p>
            先看加法點的三條輸入：靜態殘差 <Tex>{'(a-\\bar w)\\,x'}</Tex> 與 <Tex>{'d(x)'}</Tex> 是「＋」，gain 抖動 <Tex>{'\\delta w\\,x'}</Tex> 是「−」——因為 DTC 誤差裡的係數是 <Tex>{'a-w_{\\mathrm{app}}'}</Tex>，而{' '}
            <Tex>{'w_{\\mathrm{app}}=\\bar w+\\delta w'}</Tex>。三項相加之後才經過 <Tex>T</Tex>。
          </p>
          <p>
            圖上的 <Tex>{'\\bar x'}</Tex> 是 code 的平均（DC），<Tex>{'\\tilde x=x-\\bar x'}</Tex> 是扣掉平均之後的部分；<Tex>s</Tex>、<Tex>{'A_1'}</Tex>、<Tex>{'f_1'}</Tex> 是 §4.1–§4.2 的正規化倍率、鋸齒基頻的振幅與頻率。藍色的結果是
            F-LAB.12，棕色的結果是 F-LAB.10。
          </p>
        </Diagram>
        <Steps
          title="輸出 timing error 的兩個成分"
          steps={[
            { tex: T`e_{\mathrm{DTC}}=(a-\bar w-\delta w)\,x+d(x)=\underbrace{(a-\bar w)\,x+d(x)}_{\text{靜態殘差}}-\underbrace{\delta w\,x}_{\text{gain noise}}`, why: '代入 $w_{\\mathrm{app}}=\\bar w+\\delta w$。注意是**乘**上 code，不是加（第 12 章）。' },
            { tex: T`t_{\mathrm{out}}=T\{(a-\bar w)x+d(x)\}-T\{\delta w\,x\}`, why: '$T$ 是線性的，兩部分可以分開算（Lab 真的分開濾了兩次）。' },
            { tex: T`\delta w\,x=\bar x\,\delta w+\delta w\,\tilde x,\qquad \tilde x=x-\bar x`, why: '把 code 拆成 DC 與交流部分。' },
            { tex: T`T\{\bar x\,\delta w\}\approx\bar x\,\delta w`, why: '$\\delta w$ 的頻寬（校正迴路，kHz 等級）遠小於 PLL 頻寬（MHz 等級），$|T|\\approx1$：完全不被濾掉。' },
            { tex: T`T\{\delta w\,\tilde x\}\approx\delta w\cdot T\{\tilde x\}`, why: '在 $T$ 的記憶長度內 $\\delta w$ 幾乎不變，可以提到濾波器外面。' },
            { tex: T`\operatorname{Var}\bigl(T\{\delta w\,x\}\bigr)\approx\sigma_w^2\,\bar x^{\,2}+\sigma_w^2\operatorname{Var}\bigl(T\{\tilde x\}\bigr)`, why: '兩項不相關（$T\\{\\tilde x\\}$ 零均值、與 $\\delta w$ 獨立），變異數相加。' },
          ]}
        />
        <TexBlock id="F-LAB.10" label={md('第一項是 code 的 DC 把 gain 抖動原封不動送到輸出；第二項是 gain 抖動調變 code 的交流部分後，被 $T$ 濾過。')}>
          {T`\boxed{t_{\mathrm{out}}=T\bigl\{(a-\bar w)\,x+d(x)\bigr\}-T\bigl\{\delta w\,x\bigr\},\qquad \operatorname{Var}\bigl(T\{\delta w\,x\}\bigr)\approx\sigma_w^2\Bigl(\bar x^{\,2}+\operatorname{Var}\bigl(T\{\tilde x\}\bigr)\Bigr)}`}
        </TexBlock>
        <Prereq title="PSD、one-sided 與 dBc/Hz">
          <p>
            {md(
              'PSD（功率頻譜密度）$S^{(1)}(f)$ 告訴你「變異數在每 1 Hz 頻寬裡有多少」：對頻率積分就是變異數，$\\sigma^2=\\int_0^{f_s/2}S^{(1)}(f)\\,df$（one-sided：只畫正頻率，值是 two-sided 的兩倍）。相位雜訊 $\\mathcal L(f)$ 是「偏移 $f$ 處 1 Hz 內的單邊帶功率 ÷ 載波功率」，小相位時 $\\mathcal L=S_\\varphi^{(1)}/2$，取 $10\\log_{10}$ 就是 dBc/Hz。時間誤差換成相位要乘 $2\\pi f_{\\mathrm{out}}$。',
            )}
          </p>
        </Prereq>
        <TexBlock id="F-LAB.11" label={md('$S_w^{\\mathrm{ZOH}}$：block-rate 的 $\\delta w$ 用 zero-order hold 拉到 sample rate 後的 PSD（E09、E29）；$\\mathcal L$ 的換算見 E28。')}>
          {T`S_{t,\mathrm{noise}}^{(1)}(f)\approx|T|^2\Bigl[\bar x^{\,2}\,S_w^{\mathrm{ZOH}}(f)+\sigma_w^2\,S_{\tilde x}^{(1)}(f)\Bigr],\qquad \mathcal L(f)=10\log_{10}\frac{(2\pi f_{\mathrm{out}})^2\,S_t^{(1)}(f)}{2}`}
        </TexBlock>
        <ModeGate min="engineer">
          <p className="small">
            ZOH 的 PSD（<Tex>{'\\theta=2\\pi f/f_s'}</Tex>；<Tex>{'S_w(e^{j\\Omega})'}</Tex> 是 block-rate 的 DTFT PSD）：
          </p>
          <TexBlock>{T`S_w^{\mathrm{ZOH}}(f)=\frac{2}{f_s}\cdot\frac1N\Bigl[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\Bigr]^2 S_w(e^{jN\theta}),\qquad S_w(e^{j\Omega})=\frac{\mu^2\sigma_\eta^2}{\bigl|1-e^{-j\Omega}+g\,e^{-j(d+1)\Omega}\bigr|^2}`}</TexBlock>
          <p className="small">
            不能把 block-rate 的 <Tex>{'S_w'}</Tex> 直接畫在 sample-rate 的頻率軸上（位準會差約 <Tex>N</Tex> 倍）。（<ErratumNote id="E09" />、<ErratumNote id="E29" />、<ErratumNote id="E28" />）
          </p>
        </ModeGate>
        <Steps
          title="fractional spur 的封閉式（一階 DSM）"
          steps={[
            { tex: T`x[n]\ \text{含一根基頻：}\quad s\,A_1\cos(2\pi f_1 n/f_s+\varphi)`, why: '§4.1：residue 的基頻 peak 是 $A_1$，正規化後乘 $s$。' },
            { tex: T`(a-\bar w)\,x\ \Rightarrow\ \text{DTC timing tone 的 peak}=|a-\bar w|\,s\,A_1`, why: '靜態的 gain 殘差乘上 code：同頻率的時間誤差 tone。' },
            { tex: T`A_{\mathrm{spur}}=|a-\bar w|\,s\,A_1\,|T(e^{j2\pi f_1/f_s})|`, why: '經過 PLL 的 output transfer：頻寬內 $|T|\\approx1$，頻寬外被壓低。' },
            { tex: T`\beta=2\pi f_{\mathrm{out}}A_{\mathrm{spur}}\ \Rightarrow\ \mathrm{SSB}=20\log_{10}\frac{J_1(\beta)}{J_0(\beta)}\approx20\log_{10}\frac\beta2`, why: '時間 tone 換成相位調變指數；小角度時每一邊的 sideband 是 $\\beta/2$。' },
          ]}
        />
        <Steps
          title="為什麼每一邊的 sideband 是 $\beta/2$（小角度的相位調變）"
          open={false}
          steps={[
            { tex: T`v(t)=\cos\bigl(\omega_0t+\varphi(t)\bigr),\qquad \varphi(t)=\beta\sin\omega_mt,\quad \beta=2\pi f_{\mathrm{out}}A_{\mathrm{spur}}`, why: '輸出載波（$\\omega_0=2\\pi f_{\\mathrm{out}}$）的時間誤差是一個弦波 $A_{\\mathrm{spur}}\\sin\\omega_mt$；時間換成相位要乘 $2\\pi f_{\\mathrm{out}}$（$A_{\\mathrm{spur}}$ 以**秒**計：$1\\,\\mathrm{fs}=10^{-15}\\,\\mathrm{s}$）。' },
            { tex: T`v(t)=\cos\omega_0t\,\cos\varphi-\sin\omega_0t\,\sin\varphi`, why: '和角公式 $\\cos(A+B)=\\cos A\\cos B-\\sin A\\sin B$。' },
            { tex: T`v(t)\approx\cos\omega_0t-\varphi(t)\,\sin\omega_0t`, why: '$|\\varphi|\\le\\beta\\ll1$：泰勒一階 $\\cos\\varphi\\approx1$、$\\sin\\varphi\\approx\\varphi$。' },
            { tex: T`=\cos\omega_0t-\beta\,\sin\omega_mt\,\sin\omega_0t`, why: '代入 $\\varphi(t)$。' },
            { tex: T`=\cos\omega_0t-\frac\beta2\cos(\omega_0-\omega_m)t+\frac\beta2\cos(\omega_0+\omega_m)t`, why: '積化和差 $\\sin A\\sin B=\\tfrac12[\\cos(A-B)-\\cos(A+B)]$：載波兩側各出現一根，振幅是載波的 $\\beta/2$。' },
            { tex: T`\frac{P_{\mathrm{sideband}}}{P_{\mathrm{carrier}}}=\Bigl(\frac\beta2\Bigr)^2\ \Rightarrow\ \mathrm{SSB}=10\log_{10}\Bigl(\frac\beta2\Bigr)^2=20\log_{10}\frac\beta2\ [\mathrm{dBc}]`, why: '功率正比於振幅平方；dBc 是「相對載波的 dB」。$\\beta$ 不夠小時要用精確的 Bessel 函數比值 $J_1(\\beta)/J_0(\\beta)$（Lab 兩個都列）。' },
          ]}
        />
        <TexBlock id="F-LAB.12" label={md('只含線性的 gain 殘差；有 INL 時還有諧波（Lab 用 toneFit / findTones 直接量）。代數字時 $A_{\\mathrm{spur}}$ 要先從 fs 換成秒。')}>
          {T`\boxed{A_{\mathrm{spur}}=|a-\bar w|\;s\;A_1\;\bigl|T(e^{j2\pi f_1/f_s})\bigr|,\qquad \mathrm{SSB}\approx20\log_{10}\bigl(\pi f_{\mathrm{out}}A_{\mathrm{spur}}\bigr)\ [\mathrm{dBc}]}`}
        </TexBlock>
        <p>
          數字（規格 T15）：<Tex>{'0.5\\,\\mathrm{fs}'}</Tex> peak 的時間 tone、<Tex>{'f_{\\mathrm{out}}=13\\,\\mathrm{GHz}'}</Tex> <Tex>{'\\Rightarrow'}</Tex>{' '}
          <Tex>{`${texNum(sp.t15.dbc, 5)}\\,\\mathrm{dBc}`}</Tex>（Bessel 精確值 <Tex>{texNum(sp.t15.dbcBessel, 5)}</Tex>）。
        </p>
        <p>
          再算一個近整數的例子：一階 DSM、<Tex>{`\\alpha=${texNum(sp.frac)}`}</Tex>（<Tex>{`f_1=${texHz(sp.f1, 5)}`}</Tex>，在 <Tex>{'2\\,\\mathrm{MHz}'}</Tex> 的 PLL 頻寬內，
          <Tex>{`|T(f_1)|=${texNum(sp.tMag, 4)}`}</Tex>），unit_rms（<Tex>{`s=${texNum(sp.scale, 5)}`}</Tex>），校正後只剩 <Tex>{`|a-\\bar w|=${sp.deltaA}\\,\\mathrm{fs}`}</Tex>：
        </p>
        <TexBlock>{T`A_{\mathrm{spur}}=${sp.deltaA}\times${texNum(sp.scale, 5)}\times${texNum(sp.st.line1, 5)}\times${texNum(sp.tMag, 4)}=${texNum(sp.amp, 4)}\ \mathrm{fs}\quad\Rightarrow\quad${texNum(sp.tone.dbc, 4)}\ \mathrm{dBc}\ \ (f_{\mathrm{out}}=${texHz(sp.fOut, 6)})`}</TexBlock>
        <Callout kind="info" title="這個數字的意義">
          <p>
            {md(
              `$${sp.deltaA}\\,\\mathrm{fs}$ 只有例 B 的 $\\sigma_w=${texNum(an.sigmaW, 3)}\\,\\mathrm{fs}$ 的四分之一：也就是說，就算校正「收斂」了，光是係數的**抖動**就讓 fractional tone 的瞬時振幅常常超過 $${texNum(sp.tone.dbc, 3)}\\,\\mathrm{dBc}$ 這個水準，而且隨時間起伏（頻譜上是 $f_1$ 兩側的雜訊裙擺，不是一根固定高度的譜線）。更糟的是，近整數時 $C$ 會崩塌（§5.3），$\\sigma_w\\propto1/\\sqrt{C}$ 跟著變大，殘餘誤差通常遠大於 $${sp.deltaA}\\,\\mathrm{fs}$——spur 與它成正比（每大 10 倍高 $20\\,\\mathrm{dB}$）。Lab 的 preset「近整數 FCW」就是這個情況。這些都是行為模型的估計（示意），不是任何晶片的量測值；實際電路還有 INL、mismatch 等其他來源。`,
            )}
          </p>
        </Callout>
      </Section>
    </section>
  )
}

/** §3–§4：數字先行的手算例，與九級的逐步推導。 */
export function S2Chain() {
  return (
    <>
      <HandCalc />
      <Derivations />
    </>
  )
}
