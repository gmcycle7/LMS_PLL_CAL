import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Section, Tex, TexBlock, ChRef } from '@/components'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import { comparatorKq, cornerInterval, gmacMeanField, gmacModel, slopeTruncationBias } from '@/simulation/models/optimizer'
import { CornerIntervalExperiment } from '../experiments/CornerInterval'
import { Diagram } from '../Diagram'
import { CHART_CORNER_FLOW, CHART_SLOPE_MEASURE } from '../diagrams'
import { Hand } from '../Hand'
import { ErratumNote, md, nf, Steps, tx } from '../shared'

/** §14.5：Corner-based 可行區間（勘誤 E16）＋ Jacobian 量測 */
export function S6Corner() {
  const ex = useMemo(() => cornerInterval([0.004, 0.008, 0.012], 0.01, 12), [])
  const ex11 = useMemo(() => cornerInterval([0.004, 0.012], 0.01, 11), [])
  const ex2 = useMemo(() => cornerInterval([0.005, 0.01], 0.001, 10), [])
  const root = Math.pow(0.01, 1 / 12)
  const kq = comparatorKq(100)
  const dStar = 100 * Math.pow((9 * Math.PI * (1 / 4096)) / (2 * 64), 1 / 6)
  // 截斷偏差的數值例（Δ = 20 fs、σ_v = 100 fs）：θ = 0 與 θ = 55°（同一個 2-tap 相位模型）
  const bias0 = slopeTruncationBias(gmacModel(4096, 100, 0), 20)
  const bias55 = slopeTruncationBias(gmacModel(4096, 100, 55), 20)
  // Δ = 0.3σ_v 與 Δ = σ_v（θ = 0）：三階近似 vs mean-field 中央差分的精確值（全部由模型計算，不手寫）
  const gm0 = gmacModel(4096, 100, 0)
  const bias03 = slopeTruncationBias(gm0, 30)
  const bias1 = slopeTruncationBias(gm0, 100)
  const exact1 = (gmacMeanField(100, gm0) - gmacMeanField(-100, gm0)) / (2 * 100) / kq - 1
  return (
    <Section kind="formula" level={2} title={md(String.raw`14.5 Corner-based 可行區間：一個 $\mu$ 要通過所有 PVT／FCW corner`)} id="ch14-corner">
      <p>
        晶片上 <Tex>{'K=K_qC'}</Tex> 不是一個數：<Tex>{'\\sigma_v'}</Tex> 隨溫度、製程變；<Tex>{'C=|H|\\cos\\theta'}</Tex> 隨 FCW、loop bandwidth 變。固定一個 <Tex>{'\\mu'}</Tex>（一個暫存器值），
        它必須在<strong>最慢</strong>的 corner 收斂得夠快，又在<strong>最快</strong>的 corner 保持足夠 PM。以下 <Tex>{'K_i=K^{(i)}=-\\partial E[G]/\\partial w\\,\\big|_{\\text{corner }i}'}</Tex>，<Tex>{'i'}</Tex> 是 corner 編號（勘誤 E13）。
      </p>
      <ErratumNote id="E16">
        規格寫「要求 <Tex>{'B'}</Tex> 次更新將平均誤差降至 <Tex>{'\\epsilon'}</Tex>」，容易被讀成絕對誤差（fs）：若輸入 <Tex>{'\\epsilon=1\\,\\mathrm{fs}'}</Tex>，<Tex>{'\\mu_{\\min}'}</Tex> 會算成 0；<Tex>{'\\epsilon>1'}</Tex> 甚至為負。本站定義
        <Tex>{'|E[\\delta_B]|\\le\\epsilon|\\delta_0|'}</Tex>，<Tex>{'\\epsilon'}</Tex> 是<strong>無因次相對縮減比</strong>（<Tex>{'0<\\epsilon<1'}</Tex>；絕對規格請換算 <Tex>{'\\epsilon=e_\\text{abs}/|\\delta_0|'}</Tex>），輸入欄拒絕 <Tex>{'\\epsilon\\ge1'}</Tex>；
        並補上非空條件與「只約束平均、不約束 RMS」的提醒。
      </ErratumNote>
      <p>
        記號：<Tex>{'K_{\\min}'}</Tex>、<Tex>{'K_{\\max}'}</Tex> 是所有 corner 中最小、最大的 <Tex>{'K_i'}</Tex>；<Tex>{'\\epsilon'}</Tex> 是收斂要求的相對縮減比（<Tex>{'B'}</Tex> 次更新後平均誤差要縮到初始值的 <Tex>{'\\epsilon'}</Tex> 倍以內）。整個判斷流程如下圖，推導緊接在後。
      </p>
      <Diagram chart={CHART_CORNER_FLOW} caption="Corner 區間的判斷流程：一條路由最慢的 corner 給下限，另一條由最快的 corner 給上限，下面的菱形比較兩者；紅色是「不是換一個步長就能解決」的情況。">
        <p>
          <strong>先看</strong>最上面的菱形：只要有一個 corner 的斜率不是正的，就是極性錯誤，後面都不用算。<strong>再看</strong>兩條平行的路：一條取最小的斜率 <Tex>{'K_{\\min}'}</Tex>（最慢的 corner），它決定 <Tex>{'\\mu'}</Tex>{' '}
          至少要多大才來得及收斂；另一條取最大的斜率 <Tex>{'K_{\\max}'}</Tex>（最快的 corner），它決定 <Tex>{'\\mu'}</Tex> 最多能多大才保得住 phase margin。<strong>最後看</strong>下面的菱形：下限不超過上限，區間才存在；否則要回頭改規格或架構（紅色方塊），再重算一次。
        </p>
        <p>
          圖上兩個藍色方塊就是公式 F-14.15 的左右兩端（<Tex>{'\\mu_{\\min}=(1-\\epsilon^{1/B})/K_{\\min}'}</Tex>、<Tex>{'\\mu_{\\max}=1/K_{\\max}'}</Tex>），下面菱形裡的條件就是 F-14.16；綠色方塊提醒的是 F-14.15 只管平均誤差，RMS 要另外用 F-14.3 檢查。
        </p>
      </Diagram>
      <Steps
        title="下限：最慢的 corner 決定"
        steps={[
          { tex: String.raw`E[\delta_B]_i=(1-\mu K_i)^B\delta_0`, why: <>每個 corner 套 F-14.2（把 <Tex>{'K'}</Tex> 換成 <Tex>{'K_i'}</Tex>）。</> },
          { tex: String.raw`\begin{aligned}|E[\delta_B]_i|&\le\epsilon|\delta_0|\\ &\iff|1-\mu K_i|^B\le\epsilon\end{aligned}`, why: <>兩邊除以 <Tex>{'|\\delta_0|>0'}</Tex>。</> },
          {
            tex: String.raw`0<\mu K_i\le1:\quad(1-\mu K_i)^B\le\epsilon\iff1-\mu K_i\le\epsilon^{1/B}`,
            why: <>在 <Tex>{'PM\\ge60^\\circ'}</Tex> 的範圍內 <Tex>{'1-\\mu K_i\\ge0'}</Tex>；非負數取 <Tex>{'B'}</Tex> 次方根是遞增函數，不等號方向不變。</>,
          },
          { tex: String.raw`\iff\mu\ge\frac{1-\epsilon^{1/B}}{K_i}`, why: <>移項並除以 <Tex>{'K_i>0'}</Tex>。</> },
          { tex: String.raw`\forall i:\ \mu\ge\max_i\frac{1-\epsilon^{1/B}}{K_i}=\frac{1-\epsilon^{1/B}}{K_{\min}}`, why: '要對所有 corner 成立，取最嚴的一個——分母最小者。' },
        ]}
      />
      <Steps
        title="上限：最快的 corner 決定"
        steps={[
          { tex: String.raw`PM_i=90^\circ-\arcsin\frac{\mu K_i}{2}\ge60^\circ\iff\mu K_i\le1`, why: <>F-14.14（<Tex>{'PM_t=60^\\circ\\Rightarrow g_{\\max}=1'}</Tex>）。</> },
          { tex: String.raw`\forall i:\ \mu\le\min_i\frac1{K_i}=\frac1{K_{\max}}`, why: <>最嚴的是 <Tex>{'K'}</Tex> 最大的 corner。</> },
        ]}
      />
      <TexBlock id="F-14.15" label={md(String.raw`Corner-based 可行區間（$\epsilon$ 為相對比例）`)}>
        {String.raw`\boxed{\frac{1-\epsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}}},\qquad |E[\delta_B]|\le\epsilon|\delta_0|,\ 0<\epsilon<1`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 線性、一階、無額外延遲模型（規格 §14.1 的區間，本站標為 [精確｜線性一階無延遲模型]）。PM 下限改為 <Tex>{'PM_t\\ (\\ge60^\\circ)'}</Tex> 時，把上限的 1 換成 <Tex>{'g_{\\max}=2\\cos PM_t\\le1'}</Tex>（仍有 <Tex>{'1-\\mu K_i\\ge0'}</Tex>，上面的推導不變）。
      </p>
      <Steps
        title="什麼時候區間是空的？"
        steps={[
          {
            tex: String.raw`\frac{1-\epsilon^{1/B}}{K_{\min}}\le\frac1{K_{\max}}\iff1-\epsilon^{1/B}\le\frac{K_{\min}}{K_{\max}}\equiv r`,
            why: <>非空的意思是下限不超過上限；兩邊乘 <Tex>{'K_{\\min}>0'}</Tex>。<Tex>{'r=K_{\\min}/K_{\\max}'}</Tex> 稱為 corner 散佈比（<Tex>{'0<r\\le1'}</Tex>，越小表示各 corner 差越多）。</>,
          },
          { tex: String.raw`\iff\epsilon^{1/B}\ge1-r`, why: '移項。' },
          { tex: String.raw`\iff\frac{\ln\epsilon}{B}\ge\ln(1-r)`, why: <>兩邊都是正數（<Tex>{'0<r<1'}</Tex>），<Tex>{'\\ln'}</Tex> 是遞增函數。</> },
          { tex: String.raw`\iff\ln\epsilon\ge B\ln(1-r)`, why: <>乘以 <Tex>{'B>0'}</Tex>。</> },
          {
            tex: String.raw`\iff B\ge\frac{\ln\epsilon}{\ln(1-r)}`,
            why: <><Tex>{'\\ln(1-r)<0'}</Tex>：除以負數，不等號反向。（兩個 <Tex>{'\\ln'}</Tex> 都是負的，比值為正。）<Tex>{'r=1'}</Tex>（沒有散佈）時 <Tex>{'\\ln(1-r)\\to-\\infty'}</Tex>，任何 <Tex>{'B\\ge1'}</Tex> 都可以。</>,
          },
        ]}
      />
      <TexBlock id="F-14.16" label="非空條件">
        {String.raw`\boxed{\text{非空}\iff B\ge\frac{\ln\epsilon}{\ln(1-K_{\min}/K_{\max})}}\qquad\Big(\text{一般 }PM_t:\ B\ge\frac{\ln\epsilon}{\ln(1-g_{\max}r)}\Big)`}
      </TexBlock>
      <h3>先算一次</h3>
      <TexBlock>{String.raw`\begin{aligned}
K_{\min}=0.004,\ K_{\max}=0.012\ \mathrm{fs^{-1}}&\Rightarrow r=\tfrac13,\quad \epsilon=0.01\\
B_{\min}&=\frac{\ln0.01}{\ln(2/3)}=\frac{${tx(Math.log(0.01), 5)}}{${tx(Math.log(2 / 3), 4)}}=${tx(ex.bMinExact, 5)}\ \Rightarrow\ B\ge${ex.bMin}\\
B=12:\ \epsilon^{1/12}&=0.01^{1/12}=${tx(root, 5)}\\
\mu_{\min}&=\frac{1-${tx(root, 5)}}{0.004}=${tx(ex.muLo, 5)}\ \mathrm{fs},\qquad \mu_{\max}=\frac{1}{0.012}=${tx(ex.muHi, 5)}\ \mathrm{fs}
\end{aligned}`}</TexBlock>
      <p>
        區間 <Tex>{`[${tx(ex.muLo, 4)},\\ ${tx(ex.muHi, 4)}]\\ \\mathrm{fs}`}</Tex> 只有上限的約 {nf((100 * (ex.muHi - ex.muLo)) / ex.muHi, 2)}% 寬——<Tex>{'K'}</Tex> 只要量錯幾個百分比就掉出去。<Tex>{'B=11'}</Tex> 時{' '}
        <Tex>{`\\mu_{\\min}=${tx(ex11.muLo, 4)}>\\mu_{\\max}`}</Tex>，區間為空。另一例：<Tex>{`r=0.5,\\ \\epsilon=0.001\\ \\Rightarrow\\ B\\ge${tx(ex2.bMinExact, 4)}\\to${ex2.bMin}`}</Tex>。
      </p>
      <Hand id="HC-14.6">
        同一組數字再親手算一次（一次 <Tex>{'\\ln'}</Tex>、一次開 <Tex>{'B'}</Tex> 次方根），然後把 <Tex>{'B'}</Tex> 改成 11 看區間怎麼消失；再把 <Tex>{'\\epsilon'}</Tex> 輸入成 1（把它當成「1 fs」），看看題目為什麼拒絕（勘誤 E16）。
      </Hand>
      <Callout kind="warn" title="兩個常見誤用">
        <ol>
          <li>
            把 <Tex>{'\\epsilon'}</Tex> 當絕對誤差：規格「殘差不超過 1 fs」、<Tex>{'\\delta_0=50\\,\\mathrm{fs}'}</Tex> 時應用 <Tex>{'\\epsilon=1/50=0.02'}</Tex>，不是 1。
          </li>
          <li>
            以為區間內 RMS 就達標：F-14.15 只管<strong>平均</strong>誤差。若 <Tex>{'\\epsilon|\\delta_0|'}</Tex> 比雜訊底 <Tex>{'\\sigma_w'}</Tex> 還小，RMS 根本達不到——要用 F-14.3 檢查每個 corner 的噪聲項{' '}
            <Tex>{'\\mu^2\\sigma_\\eta^2(1-p_i^{2B})/(1-p_i^2)'}</Tex>。
          </li>
        </ol>
      </Callout>
      <h3>區間是空的怎麼辦？</h3>
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>手段</th>
              <th>改變了哪個量</th>
              <th>代價</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                延長校正（<Tex>{'B\\ge B_{\\min}'}</Tex>）
              </td>
              <td>
                <Tex>{'B'}</Tex>
              </td>
              <td>
                開機時間；<Tex>{'r'}</Tex> 小時 <Tex>{'B_{\\min}\\approx\\ln(1/\\epsilon)/r'}</Tex> 增長很快（<Tex>{'\\ln(1-r)\\approx-r'}</Tex>）
              </td>
            </tr>
            <tr>
              <td>
                量測 <Tex>{'\\hat K_i'}</Tex> 後做 per-corner 正規化 <Tex>{'\\mu_i=g/\\hat K_i'}</Tex>（NLMS 精神）
              </td>
              <td>
                有效 <Tex>{'r\\to1'}</Tex>
              </td>
              <td>要有量測流程（下方 6 步）與 LUT／除法器</td>
            </tr>
            <tr>
              <td>改善 PE／C（delay alignment、filtered-x、換 regressor）</td>
              <td>
                <Tex>{'K_{\\min}\\uparrow'}</Tex>
              </td>
              <td>硬體（<ChRef ch="07">Ch07</ChRef>、<ChRef ch="09">Ch09</ChRef>）</td>
            </tr>
            <tr>
              <td>{md(String.raw`放寬 $\epsilon$ 或 PM`)}</td>
              <td>
                <Tex>{'\\epsilon\\uparrow'}</Tex>、<Tex>{'g_{\\max}\\uparrow'}</Tex>
              </td>
              <td>殘差變大、振鈴</td>
            </tr>
            <tr>
              <td>變動步長（先 coarse 再 fine，§14.6）</td>
              <td>
                不同階段用不同 <Tex>{'\\mu'}</Tex>
              </td>
              <td>狀態機與驗證邏輯（§14.7）</td>
            </tr>
            <tr>
              <td>降低更新延遲</td>
              <td>
                <Tex>{'d\\to0'}</Tex> 時 PM 公式才成立
              </td>
              <td>pipeline 設計（<ChRef ch="08">Ch08</ChRef> §8.3）</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>{md('$K_i$ 從哪裡來？量測 GMAC 斜率的 6 步流程')}</h3>
      <p>
        斜率不必靠猜，可以在晶片上直接量：把係數刻意往上、往下各推一小步，看 GMAC 的平均輸出變了多少。下面用到三個新符號：<Tex>{'\\Delta'}</Tex> 是刻意加上的擾動大小（fs），<Tex>{'M'}</Tex> 是每一側累積的 block 數，<Tex>{'\\hat K'}</Tex>{' '}
        是量出來的斜率估計值（帽號代表「估計」）；<Tex>{'\\bar w'}</Tex> 是凍結時暫存器的值，<Tex>{'\\bar G_\\pm'}</Tex> 是兩側各自的 GMAC 平均。
      </p>
      <ol className="ch14-steps-ol">
        <li>
          鎖定 PLL、固定 FCW 與 PVT corner，凍結 LMS（<Tex>{'\\mu=0'}</Tex>），暫存器停在 <Tex>{'w=\\bar w'}</Tex>。
        </li>
        <li>
          把 <Tex>{'w'}</Tex> 設為 <Tex>{'\\bar w+\\Delta'}</Tex>，累積 <Tex>{'M'}</Tex> 個 block 得 <Tex>{'\\bar G_+'}</Tex>。
        </li>
        <li>
          把 <Tex>{'w'}</Tex> 設為 <Tex>{'\\bar w-\\Delta'}</Tex>，累積 <Tex>{'M'}</Tex> 個 block 得 <Tex>{'\\bar G_-'}</Tex>。
        </li>
        <li>
          <Tex>{'\\hat K=(\\bar G_--\\bar G_+)/(2\\Delta)'}</Tex>（<Tex>{'=-\\partial E[G]/\\partial w'}</Tex> 的中央差分；<Tex>{'w\\uparrow\\Rightarrow\\delta=a-w\\downarrow\\Rightarrow G\\downarrow'}</Tex>）。
        </li>
        <li>
          檢查 <Tex>{'\\hat K>z\\cdot\\mathrm{se}'}</Tex>（極性正確、可觀測）與截斷偏差；換 seed／溫度重複。
        </li>
        <li>
          對所有 corner 重複，用 <Tex>{'\\min_i(\\hat K_i-z\\,\\mathrm{se}_i)'}</Tex>、<Tex>{'\\max_i(\\hat K_i+z\\,\\mathrm{se}_i)'}</Tex> 當保守的 <Tex>{'K_{\\min}'}</Tex>、<Tex>{'K_{\\max}'}</Tex> 代入 F-14.15。
        </li>
      </ol>
      <Diagram chart={CHART_SLOPE_MEASURE} caption="量測斜率的流程：先凍結，再往兩邊各推一步，相減得到斜率；通過顯著性檢查（菱形）才能拿去算區間。">
        <p>
          <strong>先看</strong>①到③：凍結更新後，DTC 先用偏大的係數、再用偏小的係數，各平均 <Tex>{'M'}</Tex> 個 block。<strong>再看</strong>藍色的④：兩個平均值相減、除以 <Tex>{'2\\Delta'}</Tex> 就是斜率。注意相減的順序——係數往上推，誤差{' '}
          <Tex>{'\\delta=a-w'}</Tex> 變小，GMAC 輸出跟著變小，所以要用「減號那一側減加號那一側」，斜率才是正的。<strong>最後看</strong>菱形⑤：估計值要明顯大於自己的標準誤 se（<Tex>{'z'}</Tex> 是要求的倍數，例如 4），否則代表極性錯誤或根本看不到訊號。
        </p>
        <p>
          圖上的 <Tex>{'\\bar G(+\\Delta)'}</Tex>、<Tex>{'\\bar G(-\\Delta)'}</Tex> 就是公式裡的 <Tex>{'\\bar G_+'}</Tex>、<Tex>{'\\bar G_-'}</Tex>；④裡的兩個式子就是下面 F-14.21 的前兩項，接下來的推導說明 se 與截斷偏差從哪裡來。
        </p>
      </Diagram>
      <Steps
        title="量測誤差：變異數與截斷偏差"
        steps={[
          { tex: String.raw`\mathrm{Var}(\bar G_\pm)=\frac{\sigma_\eta^2}{M}`, why: <><Tex>{'M'}</Tex> 個獨立 block 的平均：變異數除以 <Tex>{'M'}</Tex>。</> },
          {
            tex: String.raw`\mathrm{Var}(\hat K)=\frac{\mathrm{Var}(\bar G_-)+\mathrm{Var}(\bar G_+)}{4\Delta^2}=\frac{\sigma_\eta^2}{2M\Delta^2}`,
            why: <>兩側獨立，變異數相加；常數 <Tex>{'1/(2\\Delta)'}</Tex> 平方後提出。</>,
          },
          {
            tex: String.raw`E[G\,|\,\delta]=E\Big[x\,\mathrm{erf}\Big(\frac{\delta u}{\sqrt2\sigma_v}\Big)\Big]`,
            why: <>mean-field：<Tex>{'q=\\mathrm{sign}(\\delta u+v)'}</Tex>，對高斯 <Tex>{'v'}</Tex> 取平均得 <Tex>{'E[q\\,|\\,u]=\\mathrm{erf}(\\delta u/(\\sqrt2\\sigma_v))'}</Tex>，再乘 <Tex>{'x'}</Tex> 對 code 平均。</>,
          },
          {
            tex: String.raw`\mathrm{erf}(z)\approx\frac{2}{\sqrt\pi}\Big(z-\frac{z^3}{3}\Big)\Rightarrow E[G\,|\,\delta]\approx K_q\Big(\delta\,E[xu]-\frac{\delta^3E[xu^3]}{6\sigma_v^2}\Big)`,
            why: <>erf 泰勒展開到三階，代入 <Tex>{'z=\\delta u/(\\sqrt2\\sigma_v)'}</Tex>：<Tex>{'\\tfrac{2}{\\sqrt\\pi}\\cdot\\tfrac{1}{\\sqrt2\\sigma_v}=K_q'}</Tex>，<Tex>{'z^3/3=\\delta^3u^3/(6\\sqrt2\\sigma_v^3)'}</Tex>。</>,
          },
          {
            tex: String.raw`E[\hat K]=\frac{E[G|\Delta]-E[G|-\Delta]}{2\Delta}\approx K_q\Big(C-\frac{\Delta^2E[xu^3]}{6\sigma_v^2}\Big)`,
            why: <>中央差分（<Tex>{'\\bar\\delta=0'}</Tex>）：一次項給 <Tex>{'E[xu]=C'}</Tex>，三次項 <Tex>{'(\\Delta^3-(-\\Delta)^3)/(2\\Delta)=\\Delta^2'}</Tex> 留下偏差。</>,
          },
          {
            tex: String.raw`u=c\,x[n]+s\,x[n-1]:\quad E[xu^3]=c^3+3cs^2\ \Rightarrow\ \frac{E[\hat K]}{K_qc}\approx1-\frac{\Delta^2(c^2+3s^2)}{6\sigma_v^2}`,
            why: <>本站 2-tap 相位模型（<Tex>{'c=|H|\\cos\\theta,\\ s=|H|\\sin\\theta'}</Tex>，<Tex>{'x=\\pm1'}</Tex> iid）：展開 <Tex>{'(cx+sx\')^3'}</Tex> 乘 <Tex>{'x'}</Tex>，只有 <Tex>{'x^4=1'}</Tex> 與 <Tex>{'x^2x\'^2=1'}</Tex> 兩項期望不為 0。</>,
          },
        ]}
      />
      <TexBlock id="F-14.21" label="斜率量測">
        {String.raw`\hat K=\frac{\bar G_--\bar G_+}{2\Delta},\qquad \mathrm{se}(\hat K)=\frac{\sigma_\eta}{\Delta\sqrt{2M}},\qquad \frac{E[\hat K]}{K_qC}\approx1-\frac{\Delta^2E[x\,u^3]}{6\sigma_v^2C}\ \xrightarrow{\ \theta=0\ }\ 1-\frac{(\Delta C)^2}{6\sigma_v^2}`}
      </TexBlock>
      <p>
        <ClaimTag kind="approx" /> 數值：<Tex>{'\\Delta=20\\,\\mathrm{fs},\\ \\sigma_v=100\\,\\mathrm{fs}'}</Tex> 時，<Tex>{'\\theta=0'}</Tex> 低估 <Tex>{`${tx(-100 * bias0, 3)}\\%`}</Tex>；
        <Tex>{'\\theta=55^\\circ'}</Tex>（<Tex>{'c^2+3s^2=1+2\\sin^2\\theta'}</Tex>）低估 <Tex>{`${tx(-100 * bias55, 3)}\\%`}</Tex>——正交分量雖然不提供平均梯度，卻會加大 erf 的非線性。
        <Tex>{'\\Delta=0.3\\sigma_v,\\ \\theta=0'}</Tex> 時約 <Tex>{`${tx(100 * bias03, 3)}\\%`}</Tex>；<Tex>{'\\Delta=\\sigma_v'}</Tex> 時精確值{' '}
        <Tex>{`\\mathrm{erf}(1/\\sqrt2)/(\\Delta K_q)-1=${tx(100 * exact1, 3)}\\%`}</Tex>（三階近似只給 <Tex>{`${tx(100 * bias1, 3)}\\%`}</Tex>，高階項不可忽略）。
      </p>
      <ModeGate min="research">
        <Steps
          title={
            <>
              最佳擾動 <Tex>{'\\Delta^*'}</Tex>：偏差平方與變異數的取捨（又一個 bias–variance；<Tex>{'\\theta=0,\\ u=|H|x'}</Tex>）
            </>
          }
          steps={[
            { tex: String.raw`\mathrm{MSE}(\hat K)\approx\Big(K\frac{\Delta^2C^2}{6\sigma_v^2}\Big)^2+\frac{\sigma_\eta^2}{2M\Delta^2}`, why: <>截斷偏差的平方加上量測變異數（<Tex>{'\\theta=0'}</Tex> 時 <Tex>{'E[xu^3]/C=C^2'}</Tex>）。</> },
            {
              tex: String.raw`\frac{d}{d\Delta}:\ \frac{4K^2C^4\Delta^3}{36\sigma_v^4}-\frac{\sigma_\eta^2}{M\Delta^3}=0\Rightarrow\Delta^{*6}=\frac{9\sigma_v^4\sigma_\eta^2}{MK^2C^4}`,
              why: <>對 <Tex>{'\\Delta'}</Tex> 微分令為 0，兩邊乘 <Tex>{'\\Delta^3'}</Tex> 再整理。</>,
            },
            {
              tex: String.raw`K=K_qC=\sqrt{\tfrac2\pi}\frac{C}{\sigma_v}\Rightarrow\Delta^*=\frac{\sigma_v}{C}\Big(\frac{9\pi\sigma_\eta^2}{2M}\Big)^{1/6}`,
              why: (
                <>
                  代入 <Tex>{'K_q'}</Tex>；例 <Tex>{'\\sigma_v=100\\,\\mathrm{fs},\\ C=1,\\ N=4096,\\ M=64'}</Tex> 得 <Tex>{`\\Delta^*\\approx${tx(dStar, 3)}\\,\\mathrm{fs}`}</Tex>（<Tex>{`K_q=${tx(kq, 4)}\\,\\mathrm{fs^{-1}}`}</Tex>）。<Tex>{'\\theta\\ne0'}</Tex> 時把 <Tex>{'C^2'}</Tex> 換成 <Tex>{'c^2+3s^2'}</Tex> 重做即可。
                </>
              ),
            },
          ]}
        />
      </ModeGate>
      <Callout kind="info" title="連結到 PLL">
        量測時 DTC 的 gain 被刻意偏移 <Tex>{'\\pm\\Delta'}</Tex>：補償量從 <Tex>{'\\bar w\\,x[n]'}</Tex> 變成 <Tex>{'(\\bar w\\pm\\Delta)\\,x[n]'}</Tex>，reference 端 DTC 的延遲 <Tex>{'T_0-(\\bar w\\pm\\Delta)\\,x[n]'}</Tex> 跟著少了（或多了）<Tex>{'\\Delta\\cdot x[n]'}</Tex>。PD 量到的 <Tex>{'e[n]=(a-\\bar w\\mp\\Delta)\\,x[n]+v[n]'}</Tex> 因此多了 <Tex>{'\\mp\\Delta\\cdot x[n]'}</Tex> 的 deterministic timing error，量測期間它會經過 PLL 出現在輸出——<Tex>{'\\Delta'}</Tex> 不能為了降低 se 無限加大，量測最好在 PLL 的非關鍵時段（例如開機、或 §14.7 的 VERIFY 狀態）。
      </Callout>
      <ModeGate min="engineer">
        <CodeBlock source={optimizerSrc} region="cornerInterval" path="src/simulation/models/optimizer.ts" />
        <CodeBlock source={optimizerSrc} region="measureSlope" path="src/simulation/models/optimizer.ts" />
      </ModeGate>
      <Callout kind="info" title="試試看">
        <ul>
          <li>
            載入「勘誤 E16 例子」，把 <Tex>{'B'}</Tex> 從 12 改成 11：綠色區間消失，警告列出 <Tex>{'B_{\\min}=12'}</Tex> 與可行的解法。
          </li>
          <li>
            把 <Tex>{'\\epsilon'}</Tex> 改成 1（想成「1 fs」）：輸入被拒絕——<Tex>{'\\epsilon'}</Tex> 是相對比例。
          </li>
          <li>
            把 near-grid FCW 的 <Tex>{'\\theta'}</Tex> 調到 <Tex>{'95^\\circ'}</Tex>：極性錯誤，區間無定義。
          </li>
          <li>
            開啟「量測 <Tex>{'\\hat K'}</Tex>」並把 <Tex>{'M'}</Tex> 調小到 4：se 變大、保守區間縮小甚至變空——量測精度也是設計的一部分。
          </li>
          <li>
            把 PM 下限拉到 <Tex>{'75^\\circ'}</Tex>：上限變成 <Tex>{'2\\cos75^\\circ/K_{\\max}'}</Tex>，<Tex>{'B_{\\min}'}</Tex> 增加。
          </li>
        </ul>
      </Callout>
      <CornerIntervalExperiment />
    </Section>
  )
}
