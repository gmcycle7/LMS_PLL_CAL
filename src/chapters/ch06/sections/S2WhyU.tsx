import { ClaimTag, Mermaid, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { ChapterSection, StepBox } from '../shared'

const LOOP_CHART = `flowchart LR
  X["原始 code x[n]"] --> DTC["DTC 誤差 ε = (a−w)·x"]
  DTC --> SUM(("Σ"))
  SUM --> PD["PD 誤差 e_PD"]
  PD --> LF["Loop filter + DCO + divider：L"]
  LF -->|"回授修正 φ_fb = L·e_PD"| SUM
  PD --> CMP["comparator q = sign(e_PD + v)"]
  CMP --> GMAC["GMAC：(1/N)Σ q·x[n−D]"]
  X --> GMAC
  GMAC --> W["w ← w + μ·G"]
  W --> DTC`

/** §2 為什麼 PD 看到 u = h * x（LTI、卷積、Z 轉換、頻率響應的先備知識 + 1/(1+L) 推導） */
export function S2WhyU() {
  return (
    <ChapterSection
      id="ch06-s2"
      kicker="§2"
      title={
        <>
          為什麼 PD 看到的是 <Tex>{'u=h*x'}</Tex>？
        </>
      }
    >
      <p>
        這一節要說清楚兩件事：（1）主 PLL 對 DTC 誤差的作用可以用一個<strong>線性非時變（LTI）</strong>系統描述；
        （2）這個系統的轉移函數是 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>。以下四個先備知識框從微積分程度開始講。
      </p>

      <Prereq title="離散時間訊號、系統與 LTI（線性 + 非時變）">
        <p>
          <strong>離散時間訊號</strong>就是一串數字 <Tex>{'x[0],x[1],x[2],\\dots'}</Tex>，相鄰兩個 sample 相隔 <Tex>{'T_s'}</Tex> 秒
          （本章 <Tex>{'T_s=1/f_s'}</Tex>，<Tex>{'f_s'}</Tex> 是 comparator / PD 的取樣率）。<strong>系統</strong>是把輸入序列變成輸出序列的規則{' '}
          <Tex>{'u=\\mathcal T\\{x\\}'}</Tex>。
        </p>
        <ul>
          <li>
            <strong>線性（linear）</strong>：<Tex>{'\\mathcal T\\{\\alpha x_1+\\beta x_2\\}=\\alpha\\,\\mathcal T\\{x_1\\}+\\beta\\,\\mathcal T\\{x_2\\}'}</Tex>。
            白話：輸入放大 2 倍，輸出也放大 2 倍；兩個輸入一起來，輸出就是各自輸出的和。
          </li>
          <li>
            <strong>非時變（time-invariant）</strong>：輸入延遲 <Tex>{'m'}</Tex> 個 sample，輸出也只是延遲 <Tex>{'m'}</Tex> 個 sample。白話：系統的個性不隨時間改變。
          </li>
        </ul>
        <p>
          例：<Tex>{'u[n]=x[n]-\\sqrt3\\,x[n-1]'}</Tex>（§1 的濾波器）是 LTI；<Tex>{'u[n]=x[n]^2'}</Tex> 不是線性。
          線性化後的主 PLL（BBPD 以平均增益近似、迴路參數固定）就是一個 LTI 系統。
        </p>
      </Prereq>

      <Prereq title={String.raw`脈衝響應 $h[n]$ 與卷積（convolution）`}>
        <p>
          <strong>單位脈衝</strong> <Tex>{'\\delta[n]'}</Tex>：只有 <Tex>{'n=0'}</Tex> 時等於 1，其他都是 0。系統對它的反應叫做<strong>脈衝響應</strong>{' '}
          <Tex>{'h[n]=\\mathcal T\\{\\delta\\}[n]'}</Tex>。下面證明：知道 <Tex>{'h'}</Tex> 就知道系統對任何輸入的反應。
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`x[n]=\sum_{m}x[m]\,\delta[n-m]`,
              why: (
                <>
                  任何序列都是「平移過的脈衝」乘上各自的高度再加起來（只有 <Tex>{'m=n'}</Tex> 那一項不是 0）。
                </>
              ),
            },
            {
              tex: String.raw`\mathcal T\{\delta[\cdot-m]\}[n]=h[n-m]`,
              why: (
                <>
                  非時變：脈衝晚 <Tex>{'m'}</Tex> 個 sample 出現，反應也晚 <Tex>{'m'}</Tex> 個 sample。
                </>
              ),
            },
            { tex: String.raw`u[n]=\mathcal T\{x\}[n]=\sum_m x[m]\,h[n-m]`, why: '線性：加權和的反應 = 各自反應的加權和。' },
            {
              tex: String.raw`u[n]=\sum_{k}h[k]\,x[n-k]`,
              why: (
                <>
                  換變數 <Tex>{'k=n-m'}</Tex>（只是把求和索引重新命名）。
                </>
              ),
            },
          ]}
          result={String.raw`u=h*x,\qquad u[n]=\sum_{k\ge0}h[k]\,x[n-k]\;(\text{因果：}h[k<0]=0)`}
        />
        <p className="small muted">
          白話：輸出是「目前與過去輸入的加權平均」，權重就是脈衝響應。§1 的例子 <Tex>{'h=[1,-\\sqrt3]'}</Tex> 只有兩個權重。
        </p>
      </Prereq>

      <Prereq title="Z 轉換：把卷積變成乘法">
        <p>
          定義 <Tex>{'X(z)=\\sum_n x[n]\\,z^{-n}'}</Tex>。可以把 <Tex>{'z^{-1}'}</Tex> 當成「延遲一個 sample」的記號：
          <Tex>{'x[n-1]'}</Tex> 的 Z 轉換是 <Tex>{'z^{-1}X(z)'}</Tex>。它是連續時間 Laplace 轉換（<Tex>{'s'}</Tex>）的離散版，對應關係{' '}
          <Tex>{'z=e^{sT_s}'}</Tex>。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`U(z)=\sum_n u[n]z^{-n}=\sum_n\sum_k h[k]\,x[n-k]\,z^{-n}`, why: '把卷積代入 Z 轉換的定義。' },
            {
              tex: String.raw`=\sum_k h[k]\,z^{-k}\sum_n x[n-k]\,z^{-(n-k)}`,
              why: (
                <>
                  交換求和順序，並把 <Tex>{'z^{-n}'}</Tex> 拆成 <Tex>{'z^{-k}\\cdot z^{-(n-k)}'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\Big(\sum_k h[k]z^{-k}\Big)X(z)=H(z)\,X(z)`,
              why: (
                <>
                  內層和就是 <Tex>{'X(z)'}</Tex>（只是索引平移 <Tex>{'m=n-k'}</Tex>）。
                </>
              ),
            },
          ]}
          result={String.raw`U(z)=H(z)\,X(z)`}
        />
        <p className="small muted">
          所以串接、回授的系統可以用代數（乘、除）處理——下面推導 <Tex>{'1/(1+L)'}</Tex> 就是用這個。
        </p>
      </Prereq>

      <Prereq title="離散角頻率與頻率響應">
        <p>
          <strong>離散角頻率</strong> <Tex>{'\\Omega=\\omega T_s=2\\pi f/f_s'}</Tex>，單位 <Tex>{'\\mathrm{rad/sample}'}</Tex>；<Tex>{'\\Omega=\\pi'}</Tex>{' '}
          是 Nyquist（每 2 個 sample 一個週期）。
          複數的 Euler 公式 <Tex>{'e^{j\\theta}=\\cos\\theta+j\\sin\\theta'}</Tex>，所以 <Tex>{'\\cos\\theta=\\operatorname{Re}\\{e^{j\\theta}\\}'}</Tex>。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`x[n]=A\cos(\Omega n)=A\operatorname{Re}\{e^{j\Omega n}\}`, why: 'Euler 公式：餘弦是複指數的實部。' },
            {
              tex: String.raw`u[n]=\sum_k h[k]\,A\operatorname{Re}\{e^{j\Omega(n-k)}\}=A\operatorname{Re}\Big\{e^{j\Omega n}\sum_k h[k]e^{-j\Omega k}\Big\}`,
              why: (
                <>
                  <Tex>{'h[k]'}</Tex> 是實數，可以搬進 <Tex>{'\\operatorname{Re}\\{\\cdot\\}'}</Tex>；<Tex>{'e^{j\\Omega(n-k)}=e^{j\\Omega n}e^{-j\\Omega k}'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=A\operatorname{Re}\{e^{j\Omega n}H(e^{j\Omega})\},\qquad H(e^{j\Omega})=\sum_k h[k]e^{-j\Omega k}=|H|e^{j\phi}`,
              why: (
                <>
                  求和就是 <Tex>{'H(z)'}</Tex> 在單位圓 <Tex>{'z=e^{j\\Omega}'}</Tex> 上的值，寫成極座標 <Tex>{'|H|e^{j\\phi}'}</Tex>。
                </>
              ),
            },
            { tex: String.raw`=A|H|\operatorname{Re}\{e^{j(\Omega n+\phi)}\}=A|H|\cos(\Omega n+\phi)`, why: '複數相乘：大小相乘、角度相加。' },
          ]}
          result={String.raw`x=A\cos\Omega n\;\xrightarrow{\;H\;}\;u=A|H|\cos(\Omega n+\phi)`}
        />
        <p className="small muted">
          白話：正弦進、正弦出；頻率不變，振幅乘上 <Tex>{'|H|'}</Tex>，相位加上 <Tex>{'\\phi'}</Tex>。§4 的單頻公式完全建立在這一行上。
        </p>
      </Prereq>

      <Section
        kind="diagram"
        title={
          <>
            主 PLL 對 DTC 誤差的反應：<Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>
          </>
        }
      >
        <Mermaid chart={LOOP_CHART} caption="DTC 誤差注入主 PLL，PD 看到的是被迴路修正後的殘差；GMAC 卻乘上原始 code x（示意，不是特定晶片 netlist）" />
        <StepBox
          title={
            <>
              由迴路代數推出 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>
            </>
          }
        >
          <StepDerivation
            steps={[
              { tex: String.raw`E_{\mathrm{PD}}=\mathcal E-\Phi_{\mathrm{fb}}`, why: 'PD 比較的是「DTC 加進來的時間誤差」減去「PLL 回授已經修掉的部分」（Z 域；正負號依注入點而定，規格 §0）。' },
              {
                tex: String.raw`\Phi_{\mathrm{fb}}=L(z)\,E_{\mathrm{PD}}`,
                why: (
                  <>
                    PD 輸出經 loop filter、DCO 積分、divider 回到 PD 輸入，整條路徑的增益就是開迴路 <Tex>{'L'}</Tex>。
                  </>
                ),
              },
              { tex: String.raw`E_{\mathrm{PD}}=\mathcal E-L\,E_{\mathrm{PD}}\;\Rightarrow\;(1+L)\,E_{\mathrm{PD}}=\mathcal E`, why: '把第 2 式代入第 1 式，移項。' },
              {
                tex: String.raw`E_{\mathrm{PD}}=\frac{1}{1+L}\,\mathcal E=H_{\mathrm{PD}}\,\mathcal E`,
                why: (
                  <>
                    兩邊除以 <Tex>{'(1+L)'}</Tex>；這就是 DTC 誤差到 PD 殘差的轉移函數。
                  </>
                ),
              },
            ]}
          />
          <TexBlock id="F-06.6">{String.raw`\boxed{H_{\mathrm{PD}}=\frac{1}{1+L}}`}</TexBlock>
          <p>
            <Tex>{'L'}</Tex> 在低頻很大（迴路有積分器），所以 <Tex>{'H_{\\mathrm{PD}}\\to0'}</Tex>：<strong>慢的誤差會被 PLL 追掉</strong>；
            高頻 <Tex>{'L\\to0'}</Tex>，<Tex>{'H_{\\mathrm{PD}}\\to1'}</Tex>：快的誤差原封不動到 PD。中間（迴路頻寬附近）則有明顯的相位旋轉——問題就出在這裡。
          </p>
        </StepBox>

        <StepBox
          title={
            <>
              從 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 到 <Tex>{'e_{\\mathrm{PD}}=(a-w)\\,u+v'}</Tex>
            </>
          }
        >
          <StepDerivation
            steps={[
              {
                tex: String.raw`\varepsilon[n]=(a-w_k)\,x[n]`,
                why: (
                  <>
                    block <Tex>{'k'}</Tex> 內 DTC 用的 gain 是 <Tex>{'w_k'}</Tex>，真實 gain 是 <Tex>{'a'}</Tex>，殘差 = <Tex>{'(a-w_k)\\times'}</Tex>code（
                    <Tex>{'\\delta=a-w'}</Tex> 極性）。
                  </>
                ),
              },
              {
                tex: String.raw`e_{\mathrm{PD}}[n]=(h*\varepsilon)[n]+v[n]`,
                why: (
                  <>
                    時域版的 <Tex>{'E_{\\mathrm{PD}}=H_{\\mathrm{PD}}\\,\\mathcal E'}</Tex>，再加上 comparator 前的雜訊 <Tex>{'v'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`=\sum_m h[m]\,(a-w_{k(n-m)})\,x[n-m]+v[n]`,
                why: (
                  <>
                    卷積定義；<Tex>{'k(n-m)'}</Tex> 是 sample <Tex>{'n-m'}</Tex> 所屬的 block——過去的 sample 可能屬於前一個 block（<Tex>{'w'}</Tex> 不同）。
                  </>
                ),
              },
              {
                tex: String.raw`\approx(a-w_k)\sum_m h[m]\,x[n-m]+v[n]=(a-w_k)\,u[n]+v[n]`,
                why: (
                  <>
                    若 <Tex>{'w'}</Tex> 在 <Tex>{'h'}</Tex> 的有效長度內幾乎不變（LMS 很慢），常數可以提出卷積——這是線性。
                  </>
                ),
              },
            ]}
          />
          <TexBlock id="F-06.1">{String.raw`\boxed{e_{\mathrm{PD}}[n]\approx(a-w_k)\,u[n]+v[n],\qquad u=h*x}`}</TexBlock>
          <p className="ch06-tags">
            <ClaimTag kind="approx" />
            <span className="small">條件：時間尺度分離（LMS 比主 PLL 慢）。本章的閉迴路模擬<strong>不</strong>用這個近似：它把 <Tex>{'\\delta_k x[n]'}</Tex> 直接送進狀態跨 block 保留的濾波器。</span>
          </p>
        </StepBox>

      </Section>

      <Section kind="assumptions" title="注意假設">
        <ul>
          <li>
            主 PLL 已線性化（BBPD 用平均增益近似）且穩定；不穩定時 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 沒有意義。
          </li>
          <li>
            本章假設 PLL 迴路與 comparator 同一取樣率（<Tex>{'f_s=f_{\\mathrm{ref}}'}</Tex>）；若不同，需另做 multirate 推導（E44）。
          </li>
          <li>DTC 誤差注入點與正負號依架構核對（規格 §0：「注入點依架構核對」）。</li>
        </ul>
      </Section>
    </ChapterSection>
  )
}
