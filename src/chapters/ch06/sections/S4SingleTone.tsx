import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, StepDerivation, Tex, TexBlock, ChRef, ChapterErratum, JumpTo } from '@/components'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import {
  calPole,
  kqFromSigma,
  polarityMarginDeg,
  toneBlockCorrelation,
  toneCorrelation,
  toneEmpirical,
  toneFir,
  toneRippleBound,
} from '@/simulation/models/polarity'
import { ChapterDiagram, ChapterHandCalc, ChapterSection, f, fx, radOf, StepBox } from '../shared'

const PATH = 'src/simulation/models/polarity.ts'

/** §4 單頻：E[x u] = (A²/2)|H|cosφ 的逐步推導、φ 表、E46 邊界與有限 N、toneFir 的來源 */
export function S4SingleTone() {
  const Kq = kqFromSigma(100)
  const phiRows = useMemo(
    () =>
      [0, 30, 60, 90, 120, 150, 180].map((phi) => {
        const C = toneCorrelation({ A: 1, mag: 1, phiRad: radOf(phi), omega: Math.PI / 6 })
        const emp = toneEmpirical({ A: 1, mag: 1, phiRad: radOf(phi), omega: Math.PI / 6, length: 1200 }).C
        return { phi, C, emp, margin: polarityMarginDeg(phi), p: calPole(10, Kq, C) }
      }),
    [Kq],
  )
  const e46 = useMemo(() => {
    const phi = radOf(-120)
    return {
      a: toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: 0.01, N: 64 }),
      b: toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: Math.PI - 0.01, N: 64 }),
      c: toneBlockCorrelation({ A: 1, mag: 1, phiRad: phi, omega: Math.PI - 0.01, N: 1024 }),
      ba: toneRippleBound({ A: 1, mag: 1, omega: 0.01, N: 64 }),
      bb: toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 64 }),
      bc: toneRippleBound({ A: 1, mag: 1, omega: Math.PI - 0.01, N: 1024 }),
      raw64: 0.5 / (64 * Math.sin(0.01)),
      piEmp: toneEmpirical({ A: 1, mag: 1, phiRad: Math.PI, omega: Math.PI, length: 1000 }).C,
    }
  }, [])
  const h = toneFir(1, radOf(120), Math.PI / 6)
  const c150 = toneCorrelation({ A: 1, mag: 1, phiRad: radOf(150), omega: Math.PI / 6 })

  return (
    <ChapterSection
      id="ch06-s4"
      kicker="§4"
      title={
        <>
          單頻推導：<Tex>{'E[x\\,u]=\\tfrac{A^2}{2}|H|\\cos\\phi'}</Tex>
        </>
      }
    >
      <p>
        最簡單、也最能看清楚機制的情況：code 是單一頻率的正弦 <Tex>{'x[n]=A\\cos(\\Omega n)'}</Tex>，路徑在這個頻率的響應是{' '}
        <Tex>{'H(e^{j\\Omega})=|H|e^{j\\phi}'}</Tex>。這裡 <Tex>{'A'}</Tex> 是 code 的振幅，<Tex>{'\\Omega'}</Tex> 是離散角頻率（每個 sample 相位前進多少，單位{' '}
        <Tex>{'\\mathrm{rad/sample}'}</Tex>），<Tex>{'|H|'}</Tex> 是主 PLL 路徑在這個頻率的增益，<Tex>{'\\phi'}</Tex> 是它加上的相位。我們順便保留 GMAC 的 code delay{' '}
        <Tex>{'D'}</Tex>（<ChRef ch="07">第 07 章</ChRef>要用）。
      </p>

      <Prereq title="積化和差：兩個餘弦相乘">
        <StepDerivation
          steps={[
            { tex: String.raw`\cos(\alpha+\beta)=\cos\alpha\cos\beta-\sin\alpha\sin\beta`, why: '和角公式。' },
            {
              tex: String.raw`\cos(\alpha-\beta)=\cos\alpha\cos\beta+\sin\alpha\sin\beta`,
              why: (
                <>
                  差角公式（把 <Tex>{'\\beta'}</Tex> 換成 <Tex>{'-\\beta'}</Tex>；<Tex>{'\\sin'}</Tex> 是奇函數、<Tex>{'\\cos'}</Tex> 是偶函數）。
                </>
              ),
            },
            {
              tex: String.raw`\cos(\alpha-\beta)+\cos(\alpha+\beta)=2\cos\alpha\cos\beta`,
              why: (
                <>
                  兩式相加，<Tex>{'\\sin'}</Tex> 項抵消。
                </>
              ),
            },
          ]}
          result={String.raw`\cos\alpha\cos\beta=\tfrac12\big[\cos(\alpha-\beta)+\cos(\alpha+\beta)\big]`}
        />
        <p className="small muted">兩個同頻率正弦相乘 = 一個「常數」（差頻 = 0）+ 一個「兩倍頻」的正弦。常數就是相關；兩倍頻的部分平均起來是 0。</p>
      </Prereq>
      <Prereq title="為什麼兩倍頻項的時間平均是 0？（等比數列）">
        <StepDerivation
          steps={[
            {
              tex: String.raw`\sum_{n=0}^{N-1}\cos(2\Omega n+\psi)=\operatorname{Re}\Big\{e^{j\psi}\sum_{n=0}^{N-1}\big(e^{j2\Omega}\big)^n\Big\}`,
              why: (
                <>
                  Euler 公式；把 <Tex>{'n'}</Tex> 次方寫成同一個公比 <Tex>{'r=e^{j2\\Omega}'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\sum_{n=0}^{N-1}r^n=\frac{1-r^N}{1-r},\qquad r\ne1`,
              why: (
                <>
                  等比數列求和（<Tex>{'r=1'}</Tex> 只在 <Tex>{'\\Omega=0'}</Tex> 或 <Tex>{'\\pi'}</Tex> 發生）。
                </>
              ),
            },
            {
              tex: String.raw`\begin{aligned}\Big|\frac{1-e^{j2\Omega N}}{1-e^{j2\Omega}}\Big|&=\frac{|\sin(N\Omega)|}{|\sin\Omega|}\\[2pt]&\le\frac{1}{|\sin\Omega|}\end{aligned}`,
              why: (
                <>
                  <Tex>{'|1-e^{j\\theta}|=2|\\sin(\\theta/2)|'}</Tex>；分子的 <Tex>{'|\\sin|\\le1'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\Big|\frac1N\sum_{n=0}^{N-1}\cos(2\Omega n+\psi)\Big|\le\frac{1}{N|\sin\Omega|}\xrightarrow{N\to\infty}0`,
              why: (
                <>
                  除以 <Tex>{'N'}</Tex>；只要 <Tex>{'0<\\Omega<\\pi'}</Tex>（<Tex>{'\\sin\\Omega\\ne0'}</Tex>），<Tex>{'N'}</Tex> 越大越接近 0。
                </>
              ),
            },
          ]}
        />
      </Prereq>

      <p>
        <strong>白話：正弦進、正弦出。</strong>PD 看到的 <Tex>{'u'}</Tex> 和原始的 <Tex>{'x'}</Tex> 是同一個頻率的兩個正弦，只差了振幅與相位。兩個同頻率的正弦相乘再平均，結果只和它們的<strong>相位差</strong>有關：同相為正、相差 <Tex>{'90^\\circ'}</Tex> 為零、反相為負。
      </p>
      <ChapterDiagram id="D-06.8">
        <p>
          先看從 code 分出去的兩條支路：一條（藍色）是主 PLL 路徑，把 <Tex>{'x'}</Tex> 的振幅乘上 <Tex>{'|H|'}</Tex>、相位加上 <Tex>{'\\phi'}</Tex>，變成{' '}
          <Tex>{'u[n]'}</Tex>；另一條是 GMAC 自己的 code delay，把 <Tex>{'x'}</Tex> 延遲 <Tex>{'D'}</Tex> 個 sample，相位減掉 <Tex>{'\\Omega D'}</Tex>。兩者在「×」相乘之後分成兩項：一個不隨時間變的常數項，和一個兩倍頻項。再看 block 平均：兩倍頻項正負相消被平均掉，只有常數項留下來。
        </p>
        <p>
          圖上兩條支路的相位一個是 <Tex>{'+\\phi'}</Tex>、一個是 <Tex>{'-\\Omega D'}</Tex>，兩者的差 <Tex>{'\\phi-(-\\Omega D)=\\phi+\\Omega D'}</Tex> 就是公式{' '}
          <Tex>{'C_D=\\tfrac{A^2}{2}|H|\\cos(\\phi+\\Omega D)'}</Tex> 裡 <Tex>{'\\cos'}</Tex> 的引數；圖上的「常數項」與「兩倍頻項」就是下面推導第 4 步中括號裡的兩項。
        </p>
      </ChapterDiagram>
      <StepBox
        title={
          <>
            逐步推導 <Tex>{'C_D=E\\big[x[n-D]\\,u[n]\\big]'}</Tex>
          </>
        }
      >
        <StepDerivation
          steps={[
            {
              tex: String.raw`x[n]=A\cos(\Omega n),\qquad x[n-D]=A\cos(\Omega n-\Omega D)`,
              why: (
                <>
                  單頻 code；GMAC 用延遲 <Tex>{'D'}</Tex> 的版本（<Tex>{'D=0'}</Tex> 就是 raw <Tex>{'x'}</Tex>）。
                </>
              ),
            },
            { tex: String.raw`u[n]=A|H|\cos(\Omega n+\phi)`, why: '§2：LTI 系統對正弦的穩態響應（正弦進、正弦出）。' },
            { tex: String.raw`x[n-D]\,u[n]=A^2|H|\cos(\Omega n-\Omega D)\cos(\Omega n+\phi)`, why: '兩式相乘。' },
            {
              tex: String.raw`=\frac{A^2|H|}{2}\Big[\cos(\phi+\Omega D)+\cos(2\Omega n+\phi-\Omega D)\Big]`,
              why: (
                <>
                  積化和差，取 <Tex>{'\\alpha=\\Omega n-\\Omega D,\\;\\beta=\\Omega n+\\phi'}</Tex>：<Tex>{'\\alpha-\\beta=-(\\phi+\\Omega D)'}</Tex>（<Tex>{'\\cos'}</Tex>{' '}
                  是偶函數），<Tex>{'\\alpha+\\beta=2\\Omega n+\\phi-\\Omega D'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\frac1N\sum_n\cos(2\Omega n+\phi-\Omega D)\to0`,
              why: (
                <>
                  上面的先備知識：<Tex>{'0<\\Omega<\\pi'}</Tex> 時兩倍頻項平均為 0。
                </>
              ),
            },
            { tex: String.raw`C_D=\frac{A^2}{2}|H|\cos(\phi+\Omega D)`, why: '只剩下常數項。' },
          ]}
        />
        <TexBlock id="F-06.4">{String.raw`\boxed{C_D=E\big[x[n-D]\,u[n]\big]=\frac{A^2}{2}\,|H(e^{j\Omega})|\,\cos(\phi+\Omega D)}`}</TexBlock>
        <p className="ch06-tags">
          <ClaimTag kind="exact" />
          <span className="small">
            條件：單頻、<Tex>{'0<\\Omega<\\pi'}</Tex>、長時間平均或整數週期平均 <ChapterErratum id="E46" />。<Tex>{'D=0'}</Tex> 就是規格 §6.1 的{' '}
            <Tex>{'E[xu]=\\tfrac{A^2}{2}|H|\\cos\\phi'}</Tex>。
          </span>
        </p>
      </StepBox>

      <p>
        關鍵觀察：
        <strong>
          <Tex>{'|H|'}</Tex> 只影響大小，符號完全由 <Tex>{'\\cos(\\phi+\\Omega D)'}</Tex> 決定
        </strong>
        。把 <Tex>{'D=0,\\;A=|H|=1,\\;\\Omega=\\pi/6'}</Tex> 的幾個相位列出來（「時域」欄是把 <Tex>{'x'}</Tex> 真的送進 2-tap
        濾波器、取 100 個完整週期的平均）：
      </p>
      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\phi'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\cos\\phi'}</Tex>
              </th>
              <th className="num">
                <Tex>{'C'}</Tex>（公式）
              </th>
              <th className="num">
                <Tex>{'C'}</Tex>（時域）
              </th>
              <th className="num">polarity margin</th>
              <th className="num">
                <Tex>{'p'}</Tex>（<Tex>{'\\mu=10\\,\\mathrm{fs},\\;\\sigma_v=100\\,\\mathrm{fs}'}</Tex>）
              </th>
              <th>結論</th>
            </tr>
          </thead>
          <tbody>
            {phiRows.map((r) => (
              <tr key={r.phi}>
                <td className="num">
                  <Tex>{`${r.phi}^\\circ`}</Tex>
                </td>
                <td className="num">{fx(Math.cos(radOf(r.phi)), 4)}</td>
                <td className={`num ${r.C < -1e-9 ? 'neg' : r.C > 1e-9 ? 'pos' : ''}`}>{fx(r.C, 4)}</td>
                <td className="num">{fx(r.emp, 4)}</td>
                <td className="num">
                  <Tex>{`${fx(r.margin, 0)}^\\circ`}</Tex>
                </td>
                <td className="num">{fx(r.p, 5)}</td>
                <td>{r.C > 1e-9 ? (r.phi === 0 ? '正常' : r.phi === 60 ? '有效增益減半' : '變慢') : r.C < -1e-9 ? '變號：平均發散' : '恢復力為 0'}</td>
              </tr>
            ))}
          </tbody>
          <caption>
            polarity margin <Tex>{'M=90^\\circ-|\\mathrm{wrap}_{180}(\\phi+\\Omega D)|'}</Tex>（規格 §8.1 的自訂指標；<ChRef ch="08">第 08 章</ChRef>）。<Tex>{'\\phi=90^\\circ'}</Tex>{' '}
            的「時域」欄只剩捨入誤差。
          </caption>
        </table>
      </div>
      <p className="small">
        入門課第 6 課用的是正規化步長 <Tex>{String.raw`\mu K_q=0.8`}</Tex>：此時 <Tex>{'\\phi=150^\\circ'}</Tex> 的 pole 為{' '}
        <Tex>{String.raw`1-0.8\times(${fx(c150, 4)})=${fx(calPole(0.8, 1, c150), 3)}`}</Tex>，每個 block 誤差放大約{' '}
        {fx((calPole(0.8, 1, c150) - 1) * 100, 1)}%。
      </p>
      <ChapterHandCalc id="HC-06.2">
        {String.raw`上表的每一列都可以自己算。把 $\phi$、週期 $P$、code delay $D$、$\mu$、$\sigma_v$ 換成你的數字，先用計算機按出 $\cos(\phi+\Omega D)$，再算 $C_D$ 與 pole；預設值就是 §1 的例子（測試 T06）。`}
      </ChapterHandCalc>
      <Callout kind="warn" title={String.raw`$\pm90^\circ$ 不是 Bode phase margin`}>
        <p>
          這裡的 <Tex>{'\\pm90^\\circ'}</Tex> 是<strong>單頻相關性的符號界線</strong>：主 PLL 在這個頻率把誤差轉了多少相位。它和主 PLL 自己的 phase margin、也和 LMS 迴路 <Tex>{'L_{\\mathrm{cal}}(z)=g/(z-1)'}</Tex> 的 phase margin 都不是同一件事（<ChRef ch="08">第 08 章</ChRef>）。主 PLL 本身很穩定，GMAC 的更新方向仍然可能是錯的。
        </p>
      </Callout>

      <h3>這個 2-tap 濾波器怎麼來的？</h3>
      <p>
        §1 與 Polarity Explorer 的單頻模式都需要「在頻率 <Tex>{'\\Omega'}</Tex> 剛好給出 <Tex>{'|H|e^{j\\phi}'}</Tex>」的<strong>真實</strong>因果濾波器，這樣時域模擬才能和公式交叉驗證。兩個實係數就夠了：
      </p>
      <StepDerivation
        steps={[
          {
            tex: String.raw`H(e^{j\Omega})=h_0+h_1e^{-j\Omega}=(h_0+h_1\cos\Omega)-j\,h_1\sin\Omega`,
            why: (
              <>
                2-tap FIR 的頻率響應；Euler 公式展開 <Tex>{'e^{-j\\Omega}=\\cos\\Omega-j\\sin\\Omega'}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`-h_1\sin\Omega=|H|\sin\phi\;\Rightarrow\;h_1=-\frac{|H|\sin\phi}{\sin\Omega}`,
            why: (
              <>
                虛部相等（需 <Tex>{'\\sin\\Omega\\ne0'}</Tex>）。
              </>
            ),
          },
          {
            tex: String.raw`h_0+h_1\cos\Omega=|H|\cos\phi\;\Rightarrow\;h_0=|H|\cos\phi-h_1\cos\Omega`,
            why: (
              <>
                實部相等，代入 <Tex>{'h_1'}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`\phi=120^\circ,\;\Omega=\tfrac{\pi}{6}:\;h_1=-\frac{0.866}{0.5}=${fx(h[1], 4)},\;h_0=-0.5+1.732\times0.866=${fx(h[0], 4)}`,
            why: (
              <>
                §1 手算表用的就是這組係數（由 <code>toneFir</code> 計算）。
              </>
            ),
          },
        ]}
      />
      <CodeBlock source={polaritySrc} region="toneFir" path={PATH} title={String.raw`toneFir：在指定頻率給出指定 $|H|$ 與相位的 2-tap FIR`} />
      <ChapterHandCalc id="HC-06.3">
        {String.raw`照上面四步自己設計一個 2-tap 濾波器（任選 $|H|$、$\phi$、週期 $P$），再算 §1 手算表的任一列 $u[n]$ 與 $x[n]\,u[n]$；最後一步用 $|H|\cos(\Omega n+\phi)$ 驗算。`}
      </ChapterHandCalc>

      <h3>
        邊界情況 <ChapterErratum id="E46" />
      </h3>
      <p>
        規格的單頻公式沒寫出條件。
        <strong>
          <Tex>{'\\Omega=0'}</Tex> 或 <Tex>{'\\pi'}</Tex>
        </strong>{' '}
        時 <Tex>{'2\\Omega n'}</Tex> 是 <Tex>{'2\\pi'}</Tex> 的整數倍，
        <Tex>{'\\cos(2\\Omega n+\\psi)=\\cos\\psi'}</Tex> 是常數，不會平均掉；而且實係數 <Tex>{'h'}</Tex> 在這兩個頻率的 <Tex>{'H'}</Tex> 必為實數（<Tex>{'\\phi\\in\\{0^\\circ,180^\\circ\\}'}</Tex>）：
      </p>
      <ChapterDiagram id="D-06.9">
        <p>
          先看最上面：每個 sample 的乘積有一個常數項和一個兩倍頻項。再看菱形的三個出口，差別只在兩倍頻項的下場：一般情況它被平均掉（綠色），F-06.4 成立；
          <Tex>{'\\Omega=0'}</Tex> 或 <Tex>{'\\pi'}</Tex> 時它自己變成常數，併進常數項（棕色），結果是一般式的 2 倍；<Tex>{'\\Omega'}</Tex> 靠近這兩個邊界而{' '}
          <Tex>{'N'}</Tex> 有限時，它在一個 block 內還沒轉完一圈（紅色），單一 block 的相關會帶著 ripple。
        </p>
        <p>
          圖上棕色那一格就是下面 F-06.5 的式子（<Tex>{'H'}</Tex> 在這兩個頻率是實數，可正可負）；紅色那一格的上界{' '}
          <Tex>{'\\tfrac{A^2|H|}{2}\\min\\!\\big(1,\\tfrac{1}{N|\\sin\\Omega|}\\big)'}</Tex> 在後面「有限 <Tex>{'N'}</Tex>」的推導框裡，<Tex>{'N'}</Tex> 是 GMAC 一個 block 的
          sample 數。
        </p>
      </ChapterDiagram>
      <TexBlock id="F-06.5">{String.raw`\Omega\in\{0,\pi\}:\;C_D=A^2\,H(e^{j\Omega})\cos(\Omega D)\quad(\text{一般公式的 2 倍})`}</TexBlock>
      <p>
        例：交替碼 <Tex>{'x=A(-1)^n'}</Tex>、<Tex>{'H(e^{j\\pi})=-1'}</Tex>：公式給 <Tex>{'-A^2'}</Tex>，時域平均 ={' '}
        <Tex>{fx(e46.piEmp, 4)}</Tex>（<Tex>{'A=1'}</Tex>）。一個統一的看法：用 <Tex>{'\\sigma_x^2=E[x^2]'}</Tex> 表示時，
        <Tex>{'C_D=\\sigma_x^2\\operatorname{Re}\\{H e^{j\\Omega D}\\}'}</Tex> 在<strong>所有</strong> <Tex>{'\\Omega'}</Tex> 都成立——「2 倍」只是因為{' '}
        <Tex>{'\\sigma_x^2'}</Tex> 在 <Tex>{'\\Omega=0,\\pi'}</Tex> 是 <Tex>{'A^2'}</Tex> 而不是 <Tex>{'A^2/2'}</Tex>。
      </p>
      <ModeGate min="engineer">
        <StepBox title={String.raw`有限 $N$ 的 block 平均：ripple 的確切公式與上界`}>
          <p>
            GMAC 每個 block 只平均 <Tex>{'N'}</Tex> 個 sample。把等比數列求和做完（<Tex>{'n=n_0,\\dots,n_0+N-1'}</Tex>）可得確切值：
          </p>
          <TexBlock>{String.raw`\hat C_{D,k}=\frac1N\sum_{n=n_0}^{n_0+N-1}x[n-D]\,u[n]=\frac{A^2|H|}{2}\Big[\cos(\phi+\Omega D)+\cos\big(2\Omega n_0+\Omega(N-1)+\phi-\Omega D\big)\frac{\sin(N\Omega)}{N\sin\Omega}\Big]`}</TexBlock>
          <p className="small muted">
            （<Tex>{'\\hat C_{D,k}'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的相關；小訊號下 <Tex>{'E[G_k]\\approx K_q\\,\\delta_k\\,\\hat C_{D,k}'}</Tex>，E46 稱它為
            block 值。）
          </p>
          <p>
            因為 <Tex>{'|\\sin(N\\Omega)|\\le N|\\sin\\Omega|'}</Tex>，ripple 的上界是{' '}
            <Tex>{'\\tfrac{A^2|H|}{2}\\min\\!\\big(1,\\tfrac{1}{N|\\sin\\Omega|}\\big)'}</Tex>（F-06.5）。<Tex>{'\\Omega'}</Tex> 接近 0 或 <Tex>{'\\pi'}</Tex> 時 <Tex>{'N|\\sin\\Omega|'}</Tex> 很小，
            <strong>單一 block 的符號可能翻轉</strong>；多個 block 平均後才回到長時間平均值。E46 的數值（
            <Tex>{'A=|H|=1,\\;\\phi=-120^\\circ'}</Tex>，理想值 <Tex>{'-0.25'}</Tex>），由本站即時計算：
          </p>
          <div className="table-wrap">
            <table className="ch06-table">
              <thead>
                <tr>
                  <th>設定</th>
                  <th className="num">
                    block 值 <Tex>{'\\hat C_{D,k}'}</Tex>（<Tex>{'n_0=0'}</Tex>）
                  </th>
                  <th className="num">ripple 上界</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <Tex>{'N=64,\\;\\Omega=0.01'}</Tex>
                  </td>
                  <td className="num">{fx(e46.a, 5)}</td>
                  <td className="num">
                    {fx(e46.ba, 5)}（未取 min 時 {fx(e46.raw64, 5)}）
                  </td>
                </tr>
                <tr>
                  <td>
                    <Tex>{'N=64,\\;\\Omega=\\pi-0.01'}</Tex>
                  </td>
                  <td className="num">{fx(e46.b, 5)}</td>
                  <td className="num">
                    {fx(e46.bb, 5)}（未取 min 時 {fx(e46.raw64, 5)}）
                  </td>
                </tr>
                <tr>
                  <td>
                    <Tex>{'N=1024,\\;\\Omega=\\pi-0.01'}</Tex>
                  </td>
                  <td className="num">{fx(e46.c, 5)}</td>
                  <td className="num">{fx(e46.bc, 5)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <CodeCompare
            items={[
              { label: '長時間平均', source: polaritySrc, region: 'toneCorrelation', path: PATH, note: String.raw`$N\to\infty$；邊界 $\Omega=0,\pi$ 用 2 倍公式（E46）` },
              { label: '有限長度 block', source: polaritySrc, region: 'toneBlockCorrelation', path: PATH, note: String.raw`只平均 $N$ 個 sample：多出一個 ripple 項，上界 $1/(N|\sin\Omega|)$` },
            ]}
            caption="同一個單頻相關的兩個版本；差異行已標示。"
          />
        </StepBox>
      </ModeGate>
      <p className="small">
        在 <JumpTo target="ch06-s7">§7 Polarity Explorer</JumpTo> 的單頻模式把 <Tex>{'\\phi'}</Tex> 拉到 <Tex>{'120^\\circ'}</Tex>，或把{' '}
        <Tex>{'\\Omega'}</Tex> 設成 <Tex>{'\\pi'}</Tex>（<Tex>{'\\phi'}</Tex> 會被自動吸附到 <Tex>{'0^\\circ/180^\\circ'}</Tex>，並顯示 E46 警告）。GMAC 長度{' '}
        <Tex>{'N'}</Tex> 也會影響 ripple：試試 <Tex>{'N=64'}</Tex>、<Tex>{'\\Omega=0.01'}</Tex>。目前預設 <Tex>{'N=1024'}</Tex> 時，
        <Tex>{'\\Omega=\\pi/6'}</Tex> 的 ripple 上界只有 <Tex>{f(toneRippleBound({ A: 1, mag: 1, omega: Math.PI / 6, N: 1024 }), 3)}</Tex>。
      </p>
    </ChapterSection>
  )
}
