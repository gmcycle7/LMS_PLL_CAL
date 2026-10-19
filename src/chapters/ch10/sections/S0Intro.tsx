import { Callout, ClaimTag, ModelLevel, Prereq, Section, SourceTag, SystemMap, Tex, TexBlock, TestBadge, ChRef } from '@/components'
import { Fig, TagRow, tn } from '../common'
import { SYSTEM_MAP_FOCUS } from '../diagrams'
import { NUM } from '../numbers'

export function S0Intro() {
  const c = NUM.coupling
  return (
    <>
      <Section kind="intuition" title="這一課要回答的問題：多個 LMS loop 同時跑，會互相干擾嗎？" level={2} id="ch10-question">
        <p>
          真實的 Fractional-N PLL 不會只校正一個參數。GOS（DTC gain offset）、PHOS（多相位 offset）、DTC gain 這些 loop 常常<strong>同時</strong>
          在背景更新，而且它們全部看<strong>同一個 1-bit comparator</strong> 的輸出 <Tex>{'q[n]'}</Tex>（<Tex>{'n'}</Tex> 是 comparator 的 sample 編號）。每個 loop 單獨調都很穩，放在一起卻可能：
        </p>
        <ol>
          <li>
            <strong>變得非常慢</strong>：單一 loop 把無因次的 loop gain 設成 <Tex>{String.raw`\mu K_q=0.5`}</Tex>（learning rate <Tex>{String.raw`\mu`}</Tex> 乘上 comparator 的小訊號增益{' '}
            <Tex>{'K_q'}</Tex>，<ChRef ch="05">第 5 章</ChRef>）時，{NUM.rho099.blocksFull} 個 block 就收斂（一個 block = GMAC 累加 <Tex>{'N'}</Tex> 個 sample、更新一次係數）；兩個高度相關的 loop（regressor 的相關係數{' '}
            <Tex>{String.raw`\rho=0.99`}</Tex>）合在一起卻要 {NUM.rho099.blocksScalar} 個 block；
          </li>
          <li>
            <strong>係數雜訊變得很大</strong>：為了加速而使用反矩陣，GMAC noise 被放大幾十倍；
          </li>
          <li>
            <strong>直接發散</strong>：每個 loop 的對角斜率都是對的，卻因為 off-diagonal 耦合而一起發散（T18）。
          </li>
        </ol>
        <p>
          先認識幾個會一路用到的記號（其餘的在第一次出現時說明，完整的表在章末）：<Tex>{'w_i'}</Tex> 是第 <Tex>{'i'}</Tex> 個校正係數、<Tex>{'a_i'}</Tex> 是它的正確值，
          <Tex>{String.raw`\delta_i=a_i-w_i`}</Tex> 是「還差多少」（fs；<Tex>{String.raw`\delta_i>0`}</Tex> 代表 <Tex>{'w_i'}</Tex> 太小），把 <Tex>{'P'}</Tex> 個參數排成向量就是{' '}
          <Tex>{String.raw`\mathbf w`}</Tex>、<Tex>{String.raw`\mathbf a`}</Tex>、<Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>。<Tex>{'G_i'}</Tex> 是第 <Tex>{'i'}</Tex> 個 GMAC 的輸出（把{' '}
          <Tex>{'q[n]'}</Tex> 乘上自己的 code 再平均），排成向量 <Tex>{String.raw`\mathbf G`}</Tex>。<Tex>{String.raw`\mathbf R`}</Tex> 是 regressor 之間的相關矩陣（對角 = 各自的功率，非對角 = 兩兩之間的相關，例如{' '}
          <Tex>{String.raw`\rho`}</Tex>）。<Tex>{String.raw`\mathbf M`}</Tex> 是<strong>更新矩陣</strong>：每個 block 做一次 <Tex>{String.raw`\mathbf w\leftarrow\mathbf w+\mathbf M\mathbf G`}</Tex>，它決定每個 GMAC
          的輸出要乘多少、加到哪個係數。
        </p>
        <p>
          這一課先用<strong>數字</strong>看到耦合，再一步一步推出 <Tex>{String.raw`\mathbf G\approx K_q\mathbf R\boldsymbol\delta`}</Tex>、更新矩陣{' '}
          <Tex>{String.raw`\mathbf M`}</Tex> 的五種選擇（scalar / diagonal / NLMS / 完整反矩陣 / regularized）與 sequential calibration，最後用
          Jacobian（GMAC 對係數的斜率矩陣）的觀點處理「模型不準」與「每個 loop 單獨穩定，不代表 MIMO 一起穩定」。
        </p>
        <Callout kind="info" title="一句話直覺">
          <p>
            一個 comparator 只會說「總誤差是正還是負」。如果兩個參數的 regressor 長得很像（相關係數 <Tex>{String.raw`\rho`}</Tex> 接近 1），GMAC 就很難分辨「是誰錯」；它只看得清楚「兩個一起錯」的方向，看不清楚「一個多、一個少」的方向。
          </p>
        </Callout>
      </Section>

      <SystemMap focus={SYSTEM_MAP_FOCUS} />
      <p className="ch10-map-note c-map-note">
        藍色的三塊（GMAC、「<Tex>{String.raw`\div N,\ \times\mu`}</Tex>」、gain accumulator）是本章的主角：前面幾章它們各只有一個，這一章把 GMAC 變成 <Tex>{'P'}</Tex> 個（全部共用同一個 comparator）、把「
        <Tex>{String.raw`\times\mu`}</Tex>」換成{' '}
        <Tex>{String.raw`P\times P`}</Tex> 的更新矩陣 <Tex>{String.raw`\mathbf M`}</Tex>、把每個 block 更新一次的係數 <Tex>{'w_k'}</Tex>（<Tex>{'k'}</Tex> 是 block 編號）變成向量{' '}
        <Tex>{String.raw`\mathbf w_k`}</Tex>，並回答它們放在一起會不會互相干擾。
      </p>
      {/* 章首骨架（本章資訊、先備自檢）由 PageFrame 放在上面的系統地圖之後（docs/teaching-style.md §9） */}
      <TagRow>
        <ModelLevel level="L3" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T18" />
        <TestBadge id="T10" />
      </TagRow>

      <Section
        kind="diagram"
        title={
          <>
            系統圖：<Tex>{'P'}</Tex> 個 GMAC 共用一個 comparator
          </>
        }
        id="ch10-system"
      >
        <p>
          把系統地圖下半部的校正迴路放大，並把一個 GMAC 換成三個（<Tex>{'P=3'}</Tex>：GOS、PHOS、DTC gain）。校正迴路的輸入是 PD 的輸出 <Tex>{'e[n]'}</Tex>——就是送進 loop filter 的同一個訊號（地圖上 PD 輸出旁的標籤，接到 comparator 輸入旁的同名標籤），comparator 只取它的正負號。
        </p>
        <p>
          這個 <Tex>{'e[n]'}</Tex> 是怎麼來的：PD 量的是（經 DTC 延遲後的）reference edge 減 feedback edge。feedback（divider／PMUX）edge 比理想時刻早到；reference 端的 DTC 只能延遲、不能提前，所以它從一個固定的基準延遲{' '}
          <Tex>{'T_0'}</Tex> 往回扣——扣掉的量就是 DTC 的<strong>補償量</strong>（reference edge 被提前了多少；<Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收）。補償得不夠的部分，也就是還差多少的 <Tex>{String.raw`\delta_i=a_i-w_i`}</Tex>，留在 <Tex>{'e[n]'}</Tex> 裡：<Tex>{'w_i'}</Tex> 太小（<Tex>{String.raw`\delta_i>0`}</Tex>）時 reference edge 還是太晚。前幾章只有一個 DTC gain 時，這就是{' '}
          <Tex>{String.raw`e[n]=(a-w)\,x[n]+v[n]`}</Tex>（code <Tex>{String.raw`x[n]\ge0`}</Tex>，所以補償不足時誤差為正）；本章有 <Tex>{'P'}</Tex> 個參數，每個參數各留下自己的一項，就是下圖最上面那一格。DTC 不在回授路徑上，回授路徑上只有 divider／PMUX。接下來每一節都有自己的方塊圖，編號從這一張開始：
        </p>
        <Fig id="system">
          先看最上面：<Tex>{'e[n]'}</Tex> 是 PD 的輸出（同一個訊號一路進 loop filter、一路進 comparator），也是<strong>所有</strong>參數誤差的加總——第 <Tex>{'i'}</Tex> 個參數的誤差 <Tex>{String.raw`\delta_i`}</Tex> 乘上它的<strong>有效 regressor</strong>{' '}
          <Tex>{'u_i[n]'}</Tex>（這個參數的誤差經 PLL 路徑到 PD 輸出的權重，已正規化成 unit RMS），全部相加後再加上 comparator 前（也就是 PD 輸出端）的雜訊 <Tex>{'v[n]'}</Tex>（RMS 為{' '}
          <Tex>{String.raw`\sigma_v`}</Tex>）。再往下看：comparator 取 <Tex>{'e[n]'}</Tex> 的正負號 <Tex>{'q[n]'}</Tex>，下面並排的三個 GMAC 各自拿自己的 code <Tex>{'x_i[n]'}</Tex>（理想匹配時{' '}
          <Tex>{'x_i=u_i'}</Tex>）去乘<strong>同一個</strong> <Tex>{'q[n]'}</Tex>，每 <Tex>{'N'}</Tex> 個 sample 平均一次，得到第 <Tex>{'k'}</Tex> 個 block 的輸出（<Tex>{'k'}</Tex> 是 block 編號）。最後看下面兩格：更新矩陣{' '}
          <Tex>{String.raw`\mathbf M`}</Tex> 決定每個 GMAC 的輸出加到哪些係數，再經 reference 端 DTC 的補償、<Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>（圖右側往上的那條線）回到最上面 PD 的輸出 <Tex>{'e[n]'}</Tex>。重點：GMAC<sub>1</sub> 看到的是{' '}
          <Tex>{String.raw`E[q\,x_1]`}</Tex>（<Tex>{String.raw`E[\cdot]`}</Tex> 是長期平均），只要 <Tex>{String.raw`x_1`}</Tex> 與 <Tex>{String.raw`u_2`}</Tex> 相關，<Tex>{String.raw`\delta_2`}</Tex> 就會漏進{' '}
          <Tex>{String.raw`G_1`}</Tex>。圖上最上面那一格的 <Tex>{String.raw`e[n]=u_1[n]\delta_1+u_2[n]\delta_2+u_3[n]\delta_3+v[n]`}</Tex> 就是 §10.2 推導第 1 步的{' '}
          <Tex>{String.raw`e[n]=\mathbf u^T[n]\boldsymbol\delta_k+v[n]`}</Tex>（把內積攤開寫），最下面那一格就是 §10.3 的更新式 <Tex>{String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\mathbf G_k`}</Tex>；帶{' '}
          <Tex>{'[n]'}</Tex> 的訊號每個 sample 一個值，<Tex>{String.raw`\mathbf G_k`}</Tex>、<Tex>{String.raw`\mathbf w_k`}</Tex> 每個 block 才有一個值。
        </Fig>
      </Section>

      <Prereq title="向量與矩陣乘向量（本章所有公式的基本動作）">
        <p>
          一個 <Tex>{String.raw`2\times2`}</Tex> 矩陣乘一個向量，就是「每一列和向量做內積」。以本章第一個例子的 <Tex>{String.raw`\mathbf R`}</Tex> 為例：
        </p>
        <TexBlock>
          {String.raw`\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}\begin{bmatrix}\delta_1\\\delta_2\end{bmatrix}=\begin{bmatrix}1\cdot\delta_1+0.8\,\delta_2\\0.8\,\delta_1+1\cdot\delta_2\end{bmatrix}`}
        </TexBlock>
        <p>
          第一列告訴你：第 1 個分量不只看 <Tex>{String.raw`\delta_1`}</Tex>，還混進了 <Tex>{String.raw`0.8\,\delta_2`}</Tex>。這就是「耦合」的數學樣子。單位矩陣 <Tex>{String.raw`\mathbf I`}</Tex> 對角是 1、其他是 0，乘任何向量都不變。
        </p>
      </Prereq>

      <Prereq title={String.raw`轉置、行列式、反矩陣與 trace（$2\times2$ 就夠用）`}>
        <p>本章只需要 <Tex>{String.raw`2\times2`}</Tex> 矩陣的四個小工具（<Tex>{String.raw`3\times3`}</Tex> 的概念完全一樣，只是算式較長，交給實驗的 Matrix Inspector）：</p>
        <ul>
          <li>
            <strong>轉置（transpose）</strong> <Tex>{String.raw`\mathbf A^T`}</Tex>：把列與行對調。欄向量 <Tex>{String.raw`\mathbf u`}</Tex> 的轉置是列向量，所以{' '}
            <Tex>{String.raw`\mathbf u^T\boldsymbol\delta=u_1\delta_1+u_2\delta_2`}</Tex> 是一個數（內積），而 <Tex>{String.raw`\mathbf u\mathbf u^T`}</Tex> 是一個矩陣（外積，第{' '}
            <Tex>{'(i,j)'}</Tex> 格是 <Tex>{String.raw`u_iu_j`}</Tex>）。<Tex>{String.raw`\mathbf A^T=\mathbf A`}</Tex> 的矩陣叫<strong>對稱</strong>。
          </li>
          <li>
            <strong>行列式（determinant）</strong>：<Tex>{String.raw`\det\begin{bmatrix}a&b\\c&d\end{bmatrix}=ad-bc`}</Tex>。<Tex>{String.raw`\det=0`}</Tex>{' '}
            代表兩列（或兩行）成比例，矩陣把某個方向「壓扁」成 0，稱為<strong>奇異（singular）</strong>。
          </li>
          <li>
            <strong>反矩陣（inverse）</strong> <Tex>{String.raw`\mathbf A^{-1}`}</Tex>：滿足 <Tex>{String.raw`\mathbf A^{-1}\mathbf A=\mathbf I`}</Tex> 的矩陣，等於「把{' '}
            <Tex>{String.raw`\mathbf A`}</Tex> 做的事還原」。<Tex>{String.raw`2\times2`}</Tex> 的公式：
            <TexBlock>{String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}^{-1}=\frac{1}{ad-bc}\begin{bmatrix}d&-b\\-c&a\end{bmatrix}\qquad\Rightarrow\qquad\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}^{-1}=\frac{1}{1-\rho^2}\begin{bmatrix}1&-\rho\\-\rho&1\end{bmatrix}`}</TexBlock>
            分母就是行列式：<Tex>{String.raw`\rho\to1`}</Tex> 時 <Tex>{String.raw`1-\rho^2\to0`}</Tex>，反矩陣的元素變得非常大；<Tex>{String.raw`\rho=1`}</Tex> 時反矩陣不存在。驗算（
            <Tex>{String.raw`\rho=0.8`}</Tex>）：<Tex>{String.raw`\tfrac{1}{0.36}\begin{bmatrix}1&-0.8\\-0.8&1\end{bmatrix}\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}=\tfrac{1}{0.36}\begin{bmatrix}0.36&0\\0&0.36\end{bmatrix}=\mathbf I`}</Tex>。
          </li>
          <li>
            <strong>Trace</strong>：<Tex>{String.raw`\operatorname{tr}\mathbf A=a+d`}</Tex>（對角線的和）。
          </li>
        </ul>
        <p className="small muted">
          注意矩陣乘法<strong>不可交換</strong>（<Tex>{String.raw`\mathbf A\mathbf B\ne\mathbf B\mathbf A`}</Tex>），所以推導中 <Tex>{String.raw`\mathbf M`}</Tex> 一律寫在{' '}
          <Tex>{String.raw`\mathbf G`}</Tex> 的左邊，順序不能換。
        </p>
      </Prereq>

      <Prereq title="期望值、相關與自相關矩陣（correlation matrix）">
        <p>
          <Tex>{'E[\\cdot]'}</Tex>（期望值）可以想成「做非常多次再平均」。兩個 regressor 的相關 <Tex>{String.raw`E[u_1u_2]`}</Tex> 是乘積的長期平均：如果 <Tex>{String.raw`u_1`}</Tex>、<Tex>{String.raw`u_2`}</Tex> 常常同號，平均是正的；兩者無關、而且平均都是 0（本章模型裡的 regressor 都是零均值）時則是 0。把所有配對排成矩陣：
        </p>
        <TexBlock>
          {String.raw`\mathbf R=E[\mathbf u\mathbf u^T]=\begin{bmatrix}E[u_1^2]&E[u_1u_2]\\E[u_2u_1]&E[u_2^2]\end{bmatrix}=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}\quad(\text{unit RMS regressors})`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\mathbf R`}</Tex> 一定<strong>對稱</strong>（<Tex>{String.raw`E[u_1u_2]=E[u_2u_1]`}</Tex>），而且<strong>半正定</strong>：對任何向量{' '}
          <Tex>{String.raw`\mathbf c`}</Tex>，<Tex>{String.raw`\mathbf c^T\mathbf R\mathbf c=E[(\mathbf c^T\mathbf u)^2]\ge0`}</Tex>（平方的平均不會是負的）。所以 <Tex>{String.raw`|\rho|\le1`}</Tex>；<Tex>{String.raw`|\rho|>1`}</Tex> 的「<Tex>{String.raw`\mathbf R`}</Tex>」在物理上不存在，實驗會拒絕並說明。
        </p>
      </Prereq>

      <Prereq title="Eigenvalue 與 eigenvector：把耦合的系統拆成互不干擾的「模式」">
        <p>
          若 <Tex>{String.raw`\mathbf R\mathbf v=\lambda\mathbf v`}</Tex>，代表沿著方向 <Tex>{String.raw`\mathbf v`}</Tex>，乘上 <Tex>{String.raw`\mathbf R`}</Tex>{' '}
          只是放大 <Tex>{String.raw`\lambda`}</Tex> 倍、方向不變。求法：<Tex>{String.raw`\det(\mathbf R-\lambda\mathbf I)=0`}</Tex>。對{' '}
          <Tex>{String.raw`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex>：
        </p>
        <TexBlock>
          {String.raw`\begin{aligned}\det\begin{bmatrix}1-\lambda&\rho\\\rho&1-\lambda\end{bmatrix}&=(1-\lambda)^2-\rho^2=0\\&\Rightarrow\ 1-\lambda=\pm\rho\\&\Rightarrow\ \lambda_1=1+\rho,\ \ \mathbf v_1=\tfrac{1}{\sqrt2}\begin{bmatrix}1\\1\end{bmatrix};\qquad\lambda_2=1-\rho,\ \ \mathbf v_2=\tfrac{1}{\sqrt2}\begin{bmatrix}1\\-1\end{bmatrix}\end{aligned}`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\mathbf v_1`}</Tex> 是「兩個參數一起錯同一方向」（共模），<Tex>{String.raw`\mathbf v_2`}</Tex> 是「一個多、一個少」（差模）。這個配對對任何{' '}
          <Tex>{String.raw`\rho`}</Tex> 都成立；哪一個 eigenvalue 比較大要看正負號：<Tex>{String.raw`\rho\ge0`}</Tex> 時 <Tex>{String.raw`\lambda_{\max}=\lambda_1`}</Tex>，<Tex>{String.raw`\rho<0`}</Tex> 時{' '}
          <Tex>{String.raw`\lambda_{\max}=\lambda_2`}</Tex>，合起來是 <Tex>{String.raw`\lambda_{\max,\min}=1\pm|\rho|`}</Tex>。本章正文的例子都取 <Tex>{String.raw`\rho\ge0`}</Tex>，所以共模是 <Tex>{String.raw`\lambda_{\max}`}</Tex>、差模是{' '}
          <Tex>{String.raw`\lambda_{\min}`}</Tex>。例如 <Tex>{String.raw`\rho=0.8`}</Tex> 時 <Tex>{String.raw`\lambda=${tn(c.eig[0])},\ ${tn(c.eig[1])}`}</Tex>；<Tex>{String.raw`\rho=0.99`}</Tex>{' '}
          時 <Tex>{String.raw`\lambda=${tn(NUM.rho099.eig[0])},\ ${tn(NUM.rho099.eig[1])}`}</Tex>，兩者的比值 <Tex>{String.raw`\kappa=\lambda_{\max}/\lambda_{\min}=${tn(NUM.rho099.cond, 5)}`}</Tex>（condition number，也叫
          eigenvalue spread；越大代表兩個方向「看得清楚的程度」差越多）。對稱矩陣的 eigenvalue 都是實數、eigenvector 互相垂直，可以寫成 <Tex>{String.raw`\mathbf R=\mathbf V\boldsymbol\Lambda\mathbf V^T`}</Tex>（
          <Tex>{String.raw`\mathbf V`}</Tex> 的欄是 eigenvector、<Tex>{String.raw`\boldsymbol\Lambda=\operatorname{diag}(\lambda_i)`}</Tex>、
          <Tex>{String.raw`\mathbf V^T\mathbf V=\mathbf I`}</Tex>）。這是本章最常用的工具。兩個名詞：所有 eigenvalue 都{' '}
          <Tex>{String.raw`>0`}</Tex> 的對稱矩陣叫<strong>正定（positive definite）</strong>，此時反矩陣存在，而且{' '}
          <Tex>{String.raw`\mathbf R^{-1}=\mathbf V\boldsymbol\Lambda^{-1}\mathbf V^T`}</Tex>（eigenvector 不變、每個 eigenvalue 取倒數）；有 eigenvalue 等於 0 時{' '}
          <Tex>{String.raw`\det\mathbf R=\lambda_1\lambda_2=0`}</Tex>，矩陣奇異。另外 <Tex>{String.raw`\operatorname{tr}\mathbf R=\lambda_1+\lambda_2`}</Tex>（本例{' '}
          <Tex>{String.raw`(1+\rho)+(1-\rho)=2`}</Tex>）。
        </p>
      </Prereq>

      <Prereq title="等比數列與 pole：誤差每個 block 乘一個數">
        <p>
          若 <Tex>{String.raw`x_{k+1}=p\,x_k`}</Tex>，則 <Tex>{String.raw`x_k=p^kx_0`}</Tex>。<Tex>{String.raw`|p|<1`}</Tex> 時趨近 0，越接近 1 越慢；
          <Tex>{String.raw`|p|>1`}</Tex> 時發散；<Tex>{String.raw`p<0`}</Tex> 時正負交替。這個 <Tex>{'p'}</Tex> 就叫 pole。矩陣版本{' '}
          <Tex>{String.raw`\boldsymbol\delta_{k+1}=\mathbf A\boldsymbol\delta_k`}</Tex> 在 eigenvector 座標下拆成好幾個獨立的等比數列，每個模式一個 pole{' '}
          <Tex>{String.raw`p_i=\operatorname{eig}_i(\mathbf A)`}</Tex>；最大的 <Tex>{String.raw`|p_i|`}</Tex> 叫 spectral radius，記成{' '}
          <Tex>{String.raw`\rho(\mathbf A)=\max_i|p_i|`}</Tex>，它小於 1 才收斂。注意 <Tex>{String.raw`\rho(\mathbf A)`}</Tex>（帶括號與矩陣）和相關係數 <Tex>{String.raw`\rho`}</Tex>（一個數）是兩回事，只是剛好用同一個希臘字母。
        </p>
      </Prereq>
    </>
  )
}
