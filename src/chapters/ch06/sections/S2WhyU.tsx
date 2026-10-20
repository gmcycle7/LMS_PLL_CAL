import { ClaimTag, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { ChapterDiagram, ChapterSection, StepBox } from '../shared'

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
        這一節要說清楚兩件事：（1）主 PLL 對 DTC 誤差的作用可以用一個<strong>線性非時變（LTI）</strong>系統描述；（2）這個系統的轉移函數是 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>，其中 <Tex>{'L'}</Tex> 是主 PLL 的<strong>開迴路增益</strong>（訊號沿迴路繞一圈被乘上的倍數）。先看一張圖，知道「濾波」在離散時間裡長什麼樣子；圖下面的四個先備知識框再從微積分程度開始講。
      </p>

      <ChapterDiagram id="D-06.2">
        <p>
          先看藍色的 <Tex>{'z^{-1}'}</Tex> 方塊：每一個都把訊號延遲一個 sample，所以沿著延遲鏈依序拿到 <Tex>{'x[n]'}</Tex>、<Tex>{'x[n-1]'}</Tex>、<Tex>{'x[n-2]'}</Tex>。再看每個「乘上 <Tex>{'h[k]'}</Tex>」的方塊：現在與過去的輸入各乘上一個固定的權重，全部加起來就是輸出 <Tex>{'u[n]'}</Tex>。
        </p>
        <p>
          圖上的權重 <Tex>{'h[0],h[1],h[2],\\dots'}</Tex> 就是公式 <Tex>{'u[n]=\\sum_{k\\ge0}h[k]\\,x[n-k]'}</Tex> 裡的<strong>脈衝響應</strong>（這個運算叫卷積，記作{' '}
          <Tex>{'u=h*x'}</Tex>）；圖上的 <Tex>{'z^{-1}'}</Tex> 就是 Z 轉換裡的 <Tex>{'z^{-1}'}</Tex>。§1 的例子只有兩個權重：<Tex>{'h[0]=1'}</Tex>、
          <Tex>{'h[1]=-\\sqrt3'}</Tex>。
        </p>
      </ChapterDiagram>

      <Prereq title="離散時間訊號、系統與 LTI（線性 + 非時變）">
        <p>
          <strong>離散時間訊號</strong>就是一串數字 <Tex>{'x[0],x[1],x[2],\\dots'}</Tex>，相鄰兩個 sample 相隔 <Tex>{'T_s'}</Tex> 秒（本章 <Tex>{'T_s=1/f_s'}</Tex>，<Tex>{'f_s'}</Tex> 是 comparator / PD 的取樣率）。<strong>系統</strong>是把輸入序列變成輸出序列的規則{' '}
          <Tex>{'u=\\mathcal T\\{x\\}'}</Tex>。
        </p>
        <ul>
          <li>
            <strong>線性（linear）</strong>：<Tex>{'\\mathcal T\\{\\alpha x_1+\\beta x_2\\}=\\alpha\\,\\mathcal T\\{x_1\\}+\\beta\\,\\mathcal T\\{x_2\\}'}</Tex>。白話：輸入放大 2 倍，輸出也放大 2 倍；兩個輸入一起來，輸出就是各自輸出的和。
          </li>
          <li>
            <strong>非時變（time-invariant）</strong>：輸入延遲 <Tex>{'m'}</Tex> 個 sample，輸出也只是延遲 <Tex>{'m'}</Tex> 個 sample。白話：系統的個性不隨時間改變。
          </li>
        </ul>
        <p>
          例：<Tex>{'u[n]=x[n]-\\sqrt3\\,x[n-1]'}</Tex>（§1 的濾波器）是 LTI；<Tex>{'u[n]=x[n]^2'}</Tex> 不是線性。線性化後的主 PLL（BBPD 以平均增益近似、迴路參數固定）就是一個 LTI 系統。
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
              tex: String.raw`=\underbrace{\Big(\sum_k h[k]z^{-k}\Big)}_{H(z)}\,X(z)`,
              why: (
                <>
                  內層和就是 <Tex>{'X(z)'}</Tex>（只是索引平移 <Tex>{'m=n-k'}</Tex>）；括號裡的和就是 <Tex>{'H(z)'}</Tex> 的定義。
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
          是 Nyquist（每 2 個 sample 一個週期）。複數的 Euler 公式 <Tex>{'e^{j\\theta}=\\cos\\theta+j\\sin\\theta'}</Tex>，所以 <Tex>{'\\cos\\theta=\\operatorname{Re}\\{e^{j\\theta}\\}'}</Tex>。
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

      <Section id="ch06-hpd"
        kind="diagram"
        title={
          <>
            主 PLL 對 DTC 誤差的反應：<Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>
          </>
        }
      >
        <p>
          先用白話說，誤差從哪裡來。DTC 接在 reference 的輸入端（章首的系統地圖）：reference clock 先經過 DTC 才進 PD，回授路徑上只有 divider。小數除頻讓
          feedback（divider）的 edge 比理想時刻<strong>早到</strong> <Tex>{'a\\,x'}</Tex>（<Tex>{'x'}</Tex> 是 DTC code，<Tex>{'a'}</Tex> 是真實的 DTC
          gain，理想值是一個 VCO 週期），所以 DTC 要讓 reference edge 也提前一段<strong>補償量</strong> <Tex>{'w\\,x'}</Tex> 去對齊。DTC 只能延遲、不能提前，實際的做法是從一個固定的基準延遲{' '}
          <Tex>{'T_0'}</Tex> 往回扣：<Tex>{'\\tau_{\\mathrm{DTC}}=T_0-w\\,x'}</Tex>（code 越大延遲越短；<Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收，下面不再出現）。
        </p>
        <p>
          PD 量的是「DTC 延遲後的 reference edge 減 feedback edge」，也就是 <Tex>{"t_{\\mathrm{ref}}'-t_{\\mathrm{fb}}"}</Tex>。gain 沒校準好（<Tex>{'w\\ne a'}</Tex>
          ）時兩條 edge 對不齊，PD 的 reference 輸入端就多出一個沒補乾淨的時間誤差，記作 <Tex>{'\\varepsilon'}</Tex>（單位 <Tex>{'\\mathrm{fs}'}</Tex>）：需要{' '}
          <Tex>{'a\\,x'}</Tex>、實際只補 <Tex>{'w\\,x'}</Tex>，所以 <Tex>{'\\varepsilon=(a-w)\\,x'}</Tex>；補償不足（<Tex>{'w<a'}</Tex>）時 reference 還是太晚，誤差為正。PD
          一看到誤差，主 PLL 就透過 loop filter、DCO、divider 讓 feedback edge 追上去；這個「已經追上的量」記作回授修正 <Tex>{'\\varphi_{\\mathrm{fb}}'}</Tex>，它從 PD 的
          feedback 輸入端進來。PD 真正量到的<strong>殘差</strong> <Tex>{'e_{\\mathrm{PD}}'}</Tex> 是兩者相減。
        </p>
        <ChapterDiagram id="D-06.3">
          <p>
            先看加法點，它就是 PD：「＋」那一邊是 reference 輸入，進來的是 DTC 誤差 <Tex>{'\\varepsilon'}</Tex>；「−」那一邊是 feedback 輸入，進來的是回授{' '}
            <Tex>{'\\varphi_{\\mathrm{fb}}'}</Tex>，所以出去的是 <Tex>{'e_{\\mathrm{PD}}=\\varepsilon-\\varphi_{\\mathrm{fb}}'}</Tex>。再沿著迴路走一圈：
            <Tex>{'e_{\\mathrm{PD}}'}</Tex> 乘上開迴路增益 <Tex>{'L'}</Tex> 變成 <Tex>{'\\varphi_{\\mathrm{fb}}'}</Tex>，又回到加法點；這一圈經過 loop filter、DCO、divider，
            <strong>沒有 DTC</strong>（DTC 在迴路外面、reference 那一邊）。這個迴路有兩個可以「看」的地方：從加法點後面看到的是 PD 的輸出（輸出 1）——它是送進 loop filter
            的訊號，校正迴路的 comparator 取的也是這同一個訊號；從迴路後面看到的是 PLL 已經追掉的部分（輸出 2）。
          </p>
          <p>
            圖上的 <Tex>{'\\varepsilon,\\ e_{\\mathrm{PD}},\\ \\varphi_{\\mathrm{fb}}'}</Tex> 就是下面推導裡的{' '}
            <Tex>{'\\mathcal E,\\ E_{\\mathrm{PD}},\\ \\Phi_{\\mathrm{fb}}'}</Tex>（大寫是做完 Z 轉換的寫法）；圖上兩條箭頭的標籤就是推導的第 1、2 步。輸出 2 的{' '}
            <Tex>{'T=L/(1+L)'}</Tex> 就是平常說的 PLL closed-loop 轉移函數（低通）；本章要的是輸出 1 的 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>（高通）。誤差從 reference
            那一邊進來，所以兩個輸出都是正號：<Tex>{'e_{\\mathrm{PD}}=H_{\\mathrm{PD}}\\,\\varepsilon'}</Tex>、<Tex>{'\\varphi_{\\mathrm{fb}}=T\\,\\varepsilon'}</Tex>。兩者相加{' '}
            <Tex>{'H_{\\mathrm{PD}}+T=\\tfrac{1}{1+L}+\\tfrac{L}{1+L}=1'}</Tex>：PLL 追掉多少，PD 就少看到多少。
          </p>
        </ChapterDiagram>
        <StepBox
          title={
            <>
              由迴路代數推出 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>
            </>
          }
        >
          <StepDerivation
            steps={[
              {
                tex: String.raw`E_{\mathrm{PD}}=\mathcal E-\Phi_{\mathrm{fb}}`,
                why: 'PD 量的是 reference 輸入減 feedback 輸入：reference 那一邊帶著 DTC 沒補乾淨的時間誤差（正號），feedback 那一邊是主 PLL 已經追上的部分（負號）。這是 Z 域的寫法；DTC 在 reference 輸入端是全站的約定。',
              },
              {
                tex: String.raw`\Phi_{\mathrm{fb}}=L(z)\,E_{\mathrm{PD}}`,
                why: (
                  <>
                    PD 的輸出經 loop filter、DCO 積分、divider 回到 PD 的 feedback 輸入，整條路徑的增益就是開迴路 <Tex>{'L'}</Tex>（回授路徑上只有 divider，沒有 DTC）。
                  </>
                ),
              },
              { tex: String.raw`E_{\mathrm{PD}}=\mathcal E-L\,E_{\mathrm{PD}}\;\Rightarrow\;(1+L)\,E_{\mathrm{PD}}=\mathcal E`, why: '把第 2 式代入第 1 式，移項。' },
              {
                tex: String.raw`E_{\mathrm{PD}}=\frac{1}{1+L}\,\mathcal E=H_{\mathrm{PD}}\,\mathcal E`,
                why: (
                  <>
                    兩邊除以 <Tex>{'(1+L)'}</Tex>；這就是 DTC 誤差（PD 的 reference 輸入）到 PD 輸出的轉移函數，正號。
                  </>
                ),
              },
              {
                tex: String.raw`\Phi_{\mathrm{fb}}=L\,E_{\mathrm{PD}}=\frac{L}{1+L}\,\mathcal E=T\,\mathcal E`,
                why: (
                  <>
                    把結果代回第 2 式：PLL 追掉的部分（也就是輸出相位跟著誤差走的部分）是 <Tex>{'+T\\,\\mathcal E'}</Tex>，同樣是正號；<Tex>{'H_{\\mathrm{PD}}+T=1'}</Tex>。
                  </>
                ),
              },
            ]}
          />
          <TexBlock id="F-06.6">{String.raw`\boxed{H_{\mathrm{PD}}=\frac{1}{1+L}}`}</TexBlock>
          <p>
            <Tex>{'L'}</Tex> 在低頻很大（迴路有積分器），所以 <Tex>{'H_{\\mathrm{PD}}\\to0'}</Tex>：<strong>慢的誤差會被 PLL 追掉</strong>；高頻 <Tex>{'L\\to0'}</Tex>，<Tex>{'H_{\\mathrm{PD}}\\to1'}</Tex>：快的誤差原封不動到 PD。中間（迴路頻寬附近）則有明顯的相位旋轉——問題就出在這裡。
          </p>
        </StepBox>

        <p>
          現在把這個方塊接回校正迴路。DTC 這個 block 用的 gain 是校正值 <Tex>{'w_k'}</Tex>（<Tex>{'k'}</Tex> 是 GMAC block 的編號），真實的 gain 是{' '}
          <Tex>{'a'}</Tex>，所以 DTC 誤差是 <Tex>{'\\varepsilon[n]=(a-w_k)\\,x[n]'}</Tex>（<Tex>{'n'}</Tex> 是 sample 的編號）。它從 PD 的 reference 輸入端進來，經過{' '}
          <Tex>{'H_{\\mathrm{PD}}'}</Tex> 變成 PD 的輸出。校正迴路的 comparator 取的就是 PD 的輸出——送進 loop filter 的同一個訊號——再疊上 comparator 前的雜訊{' '}
          <Tex>{'v[n]'}</Tex>；comparator 只留下正負號 <Tex>{'q[n]=\\pm1'}</Tex>，GMAC 再把它乘上原始 code 並平均。
        </p>
        <ChapterDiagram id="D-06.4">
          <p>
            先看 <Tex>{'a'}</Tex> 與 <Tex>{'w_k'}</Tex> 進去的那個加法點：<Tex>{'a'}</Tex> 接「＋」、<Tex>{'w_k'}</Tex> 接「−」，得到參數誤差{' '}
            <Tex>{'\\delta_k=a-w_k'}</Tex>（全章都用這個極性），乘上 code 就是 DTC 誤差。再看藍色方塊：它是圖 6.3 整個迴路從 PD 的 reference 輸入看到 PD
            輸出的效果。comparator 取的是 PD 的輸出，也就是送進 loop filter 的同一個訊號（不是 DTC 的輸出，也不是 divider 的輸出），所以 comparator 看到的 code 不是{' '}
            <Tex>{'x'}</Tex>，而是被主 PLL 濾過的 <Tex>{'u=h*x'}</Tex>。最後看紅色的乘法器：GMAC 拿的卻是<strong>沒經過藍色方塊</strong>的原始 code——它只經過一個延遲方塊{' '}
            <Tex>{'z^{-D}'}</Tex>，變成 <Tex>{'x[n-D]'}</Tex>（<Tex>{'D'}</Tex> 是 GMAC 把 code 延遲的 sample 數，<Tex>{'D=0'}</Tex> 就是直通）。兩條路徑的差別就是本章的主題。
          </p>
          <p>
            取樣率：從 code 到紅色乘法器，每個 sample <Tex>{'n'}</Tex> 跑一次；GMAC 把 <Tex>{'N'}</Tex> 個 sample 平均成一個 <Tex>{'G_k'}</Tex> 之後，每個 block{' '}
            <Tex>{'k'}</Tex> 才用 learning rate <Tex>{'\\mu'}</Tex> 更新一次 <Tex>{'w'}</Tex>（<Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex> 那一格；回到 <Tex>{'w_k'}</Tex> 的那條線標著「下一個 block
            才生效」，也就是 §3 圖 6.6 裡「等一個 block」的那個 <Tex>{'z^{-1}'}</Tex>；§7 的圖 6.24 把這兩種速率的先後順序畫成時序圖）。圖上「PD 的輸出（約等於 <Tex>{'\\delta_k\\,u[n]'}</Tex>）」再加上雜訊 <Tex>{'v[n]'}</Tex>{' '}
            的那個加法點，就是下面 F-06.1 的 <Tex>{'e_{\\mathrm{PD}}[n]\\approx(a-w_k)\\,u[n]+v[n]'}</Tex>（comparator 的輸入）；「約等於」成立的條件（<Tex>{'w'}</Tex> 變得比主 PLL
            慢很多）在推導的最後一步。
          </p>
        </ChapterDiagram>
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
                    block <Tex>{'k'}</Tex> 內 DTC 用的 gain 是 <Tex>{'w_k'}</Tex>，真實 gain 是 <Tex>{'a'}</Tex>：需要補 <Tex>{'a\\,x[n]'}</Tex>、實際補{' '}
                    <Tex>{'w_k\\,x[n]'}</Tex>，沒補乾淨的殘差 = <Tex>{'(a-w_k)\\times'}</Tex>code（<Tex>{'\\delta=a-w'}</Tex> 極性；PD 量的是 reference edge 減 feedback
                    edge，所以補償不足時為正）。
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

      <Section id="ch06-assumptions" kind="assumptions" title="注意假設">
        <ul>
          <li>
            主 PLL 已線性化（BBPD 用平均增益近似）且穩定；不穩定時 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 沒有意義。
          </li>
          <li>
            本章假設 PLL 迴路與 comparator 同一取樣率（<Tex>{'f_s=f_{\\mathrm{ref}}'}</Tex>）；若不同，需另做 multirate 推導（E44）。
          </li>
          <li>
            注入點與正負號：全站約定 DTC 在 reference 輸入端，它的殘餘誤差從 PD 的 reference 輸入端進來，所以{' '}
            <Tex>{'E_{\\mathrm{PD}}=+H_{\\mathrm{PD}}\\,\\mathcal E'}</Tex>、<Tex>{'\\Phi_{\\mathrm{fb}}=+T\\,\\mathcal E'}</Tex>。換成別的接法（例如把誤差算在 feedback
            那一邊）只會讓這兩式差一個正負號，<Tex>{'|H_{\\mathrm{PD}}|'}</Tex> 與 <Tex>{'|T|'}</Tex> 不變；套用到自己的電路時，請照 PD 的實際極性核對一次（規格 §0：「注入點依架構核對」）。
          </li>
        </ul>
      </Section>
    </ChapterSection>
  )
}
