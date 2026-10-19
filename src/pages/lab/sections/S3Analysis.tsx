import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, ModelLevel, Prereq, Section, Tex, TexBlock, ErratumLink } from '@/components'
import { erf } from '@/simulation/core'
import { tQuantile95 } from '@/simulation/models/unifiedLab'
import { ChLink, md, sig, Steps, texNum } from '../common'
import { anchorNumbers, blockFixedPointExample, seNumbers } from '../numbers'

const T = String.raw

/** 中央差分量到的 comparator 斜率相對 K_q 的偏差：erf(d/√2)/(d·√(2/π)) − 1，d = Δw·|u_x|/σ_v */
function slopeBias(d: number): number {
  return erf(d / Math.SQRT2) / (d * Math.sqrt(2 / Math.PI)) - 1
}

/** §5：Lab 用來「判讀」結果的工具——每一個檢查背後的數學。 */
export function S3Analysis() {
  const se = useMemo(() => seNumbers(), [])
  const an = useMemo(() => anchorNumbers(), [])
  const fp = useMemo(() => blockFixedPointExample(), [])
  const tTable = useMemo(() => [4, 8, 16, 32, 64].map((R) => ({ R, t: tQuantile95(R), half: tQuantile95(R) / Math.sqrt(R) })), [])
  return (
    <section aria-labelledby="lab-s5" id="lab-sec-5">
      <h2 id="lab-s5">5｜怎麼判斷「模擬與理論一致」：Lab 的檢查工具</h2>
      <p>
        整合模擬最危險的不是算錯，而是<strong>算錯了卻顯示成功</strong>。所以 Lab 的每個「一致 / 不一致」都有明確的判據與容差。這一節把它們推導出來；看完你就知道每個綠色標籤到底保證了什麼。
      </p>

      {/* ---------- 5.1 ---------- */}
      <Section kind="formula" title="5.1　跨級一致性：把每個 sample 重播一次" id="lab-s51">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="exact" /> 迴路由 <code>runBlockLms</code> 執行，但它只回傳 <Tex>{'w_k'}</Tex>、<Tex>{'G_k'}</Tex>。要顯示每一級的中間訊號（<Tex>{'x,\\ e_{\\mathrm{DTC}},\\ u_{\\mathrm{pd}},\\ q,\\ t_{\\mathrm{out}}'}</Tex>
          ），Lab 另外寫了一個逐 sample 的重播迴圈：用同一個 seed、同樣的亂數分流標籤、同樣的運算順序，讀入 <code>runBlockLms</code> 算出的 <Tex>{'w_{\\mathrm{phys}}'}</Tex>，自己重算每個 <Tex>{'G_k'}</Tex>。
        </p>
        <TexBlock id="F-LAB.14" label="浮點運算是確定的：同樣的運算順序必須得到逐位元相同的結果，所以容差是 0。">
          {T`\max_{0\le k<K_B}\bigl|G_k^{\mathrm{replay}}-G_k^{\mathrm{runBlockLms}}\bigr|=0`}
        </TexBlock>
        <div className="grid-2">
          <Callout kind="ok" title="它保證了什麼">
            <p className="small">
              {md(
                '你在圖上看到的 $x[n]$、$e_{\\mathrm{DTC}}[n]$、$u_{\\mathrm{pd}}[n]$、$q[n]$ 就是迴路實際用的那些數字：DSM 的相位、正規化的 offset / scale、$H_{\\mathrm{PD}}$ 的濾波器狀態（跨 block 持續）、regressor 的延遲、comparator 的編碼，任何一級錯位一個 sample，$G_k$ 就會不同。輸出端的 $t_{\\mathrm{out}}$ 也因此確實來自同一個 $e_{\\mathrm{DTC}}$。',
              )}
            </p>
          </Callout>
          <Callout kind="warn" title="它沒有保證什麼">
            <p className="small">
              {md(
                '它是「兩份程式一致」，不是「模型符合真實電路」。重播迴圈與 `runBlockLms` 用的是同一組方程式；如果方程式本身漏了一個物理效應（例如 DTC 的 settling），兩邊會一起漏。模型對不對，要靠解析公式（下面幾節）、golden vectors（T13–T15）與最終的電路模擬 / 量測。',
              )}
            </p>
          </Callout>
        </div>
      </Section>

      {/* ---------- 5.2 ---------- */}
      <Section kind="formula" title="5.2　單一 seed 的平均有多準：AR(1) 的有效樣本數，以及該和誰比" id="lab-s52">
        <p>
          <ModelLevel level="L1" /> <ClaimTag kind="approx" /> 你跑了 2000 個 block，取後半段 1000 個 <Tex>{'w_k'}</Tex> 的平均，得到 3.05 fs；理論說 3.00 fs。這算一致嗎？直覺的算法是標準誤差{' '}
          <Tex>{'\\sigma_w/\\sqrt{1000}'}</Tex>——但這是<strong>錯的</strong>，因為相鄰的 <Tex>{'w_k'}</Tex> 幾乎一樣（pole <Tex>{texNum(se.rho, 3)}</Tex>），1000 個樣本裡沒有 1000 份獨立的資訊。
        </p>
        <Prereq title="變異數、共變異數與相關">
          <p>
            {md(
              '變異數 $\\operatorname{Var}(X)=E[(X-E[X])^2]$ 量「抖多大」（標準差 $\\sigma$ 是它的平方根）。共變異數 $\\operatorname{Cov}(X,Y)=E[(X-E[X])(Y-E[Y])]$ 量「兩個量會不會一起偏」；兩者獨立時為 0。和的變異數是 $\\operatorname{Var}(X+Y)=\\operatorname{Var}(X)+\\operatorname{Var}(Y)+2\\operatorname{Cov}(X,Y)$——多出來的那一項就是這一節的主角。AR(1) 序列 $w_{k+1}=\\rho w_k+\\text{雜訊}$ 的共變異數是 $\\operatorname{Cov}(w_i,w_j)=\\sigma_w^2\\rho^{|i-j|}$：隔越遠越不相關。',
            )}
          </p>
        </Prereq>
        <Steps
          title="$m$ 個相關樣本的平均，變異數是多少"
          steps={[
            { tex: T`\bar w_m=\frac1m\sum_{i=1}^{m}w_i`, why: '後半段的時間平均（$m$ 個 block）。' },
            { tex: T`\operatorname{Var}(\bar w_m)=\frac{1}{m^2}\sum_{i=1}^{m}\sum_{j=1}^{m}\operatorname{Cov}(w_i,w_j)`, why: '和的變異數 = 所有配對的共變異數相加（上面的先備知識推廣到 $m$ 項）。' },
            { tex: T`=\frac{\sigma_w^2}{m^2}\sum_{i=1}^{m}\sum_{j=1}^{m}\rho^{|i-j|}`, why: '代入 AR(1) 的共變異數。' },
            { tex: T`=\frac{\sigma_w^2}{m^2}\Bigl[m+2\sum_{j=1}^{m-1}(m-j)\,\rho^{\,j}\Bigr]`, why: '對角線有 $m$ 項（$\\rho^0$）；相距 $j$ 的配對有 $2(m-j)$ 個。' },
            { tex: T`\approx\frac{\sigma_w^2}{m}\Bigl[1+2\sum_{j=1}^{\infty}\rho^{\,j}\Bigr]=\frac{\sigma_w^2}{m}\Bigl[1+\frac{2\rho}{1-\rho}\Bigr]`, why: '$m\\gg\\tau$ 時 $(m-j)/m\\approx1$；等比級數 $\\sum_{j\\ge1}\\rho^j=\\rho/(1-\\rho)$。' },
          ]}
          result={T`\operatorname{Var}(\bar w_m)\approx\frac{\sigma_w^2}{m}\cdot\frac{1+\rho}{1-\rho}\qquad\Longleftrightarrow\qquad m_{\mathrm{eff}}=m\,\frac{1-\rho}{1+\rho}`}
        />
        <TexBlock id="F-LAB.9" label={md('Lab 用左邊的精確式（有限的 $m$ 也成立）；右邊是 $m\\gg\\tau$ 的近似。')}>
          {T`\operatorname{Var}(\bar w_m)=\frac{\sigma_w^2}{m^2}\Bigl[m+2\sum_{j=1}^{m-1}(m-j)\rho^{\,j}\Bigr]\;\approx\;\frac{\sigma_w^2}{m}\cdot\frac{1+\rho}{1-\rho}`}
        </TexBlock>
        <p>
          數字（例 B）：<Tex>{`\\sigma_w=${texNum(se.sigmaW, 4)}\\,\\mathrm{fs},\\ \\rho=${texNum(se.rho, 4)},\\ m=${se.m}`}</Tex>。天真的標準誤差是 <Tex>{`${texNum(se.naive, 3)}\\,\\mathrm{fs}`}</Tex>；正確的是{' '}
          <Tex>{`${texNum(se.se, 3)}\\,\\mathrm{fs}`}</Tex>，大了 <Tex>{`${texNum(se.ratio, 3)}`}</Tex> 倍——1000 個 block 只相當於 <Tex>{`${texNum(se.nEffMean, 3)}`}</Tex> 個獨立樣本。所以單一 seed 的 mean{' '}
          <Tex>w</Tex> 偏 <Tex>{'0.05\\,\\mathrm{fs}'}</Tex> 完全正常，不是 bias。
        </p>
        <h4 className="lab-subhead">和誰比：mean-field 平均軌跡</h4>
        <p>
          知道了「平均有多準」，還要決定拿它和<strong>哪個預測</strong>比。最直覺的是 §4.6 的固定點 <Tex>{'w^*=a+B/C'}</Tex>。但 <Tex>C</Tex>、<Tex>B</Tex> 是對 code 取的平均——如果 code 的統計自己會隨時間慢慢變，「單一個{' '}
          <Tex>{'w^*'}</Tex>」就不存在。先看數字：一階 DSM、<Tex>{`\\alpha=${fp.frac}`}</Tex>、<Tex>{`B=${fp.bits}`}</Tex> bit（<Tex>{`K=${fp.st.K}`}</Tex>，週期 <Tex>{`P=${fp.st.P}`}</Tex> 個 sample，等於{' '}
          <Tex>{`${texNum(fp.superPeriodBlocks, 4)}`}</Tex> 個 block）、unit_rms、無 PLL、comparator offset <Tex>{`b=${fp.b}\\,\\mathrm{fs}`}</Tex>、<Tex>{`a=${fp.a}\\,\\mathrm{fs}`}</Tex>。每個 block 用自己的 <Tex>{`N=${fp.N}`}</Tex> 個樣本算{' '}
          <Tex>{'w^*_k=a+b\\,E_k[x]/E_k[x^2]'}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <caption>同一個 FCW，不同 block 看到的 code 統計與準靜態固定點（由 residue 的封閉式逐 sample 計算）</caption>
            <thead>
              <tr>
                <th>
                  block <Tex>k</Tex>
                </th>
                {fp.rows.map((r) => (
                  <td key={r.k}>{r.k}</td>
                ))}
                <td>整個週期</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  <Tex>{'E_k[x]'}</Tex>
                </th>
                {fp.rows.map((r) => (
                  <td key={r.k}>{sig(r.xMean, 4)}</td>
                ))}
                <td>{sig(fp.st.mean * fp.s, 4)}</td>
              </tr>
              <tr>
                <th>
                  <Tex>{'E_k[x^2]'}</Tex>
                </th>
                {fp.rows.map((r) => (
                  <td key={r.k}>{sig(r.x2Mean, 4)}</td>
                ))}
                <td>1</td>
              </tr>
              <tr>
                <th>
                  <Tex>{'w^*_k\\ [\\mathrm{fs}]'}</Tex>
                </th>
                {fp.rows.map((r) => (
                  <td key={r.k}>{sig(r.wStar, 5)}</td>
                ))}
                <td>{sig(fp.wFull, 5)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          你會發現：<Tex>{`\\alpha=${fp.frac}`}</Tex> 的鋸齒大約每 10 個 sample 重複一次，但 <Tex>{'K/2^{20}'}</Tex> 不是剛好 <Tex>{'3/10'}</Tex>，所以那 10 個 level 會整組慢慢平移；一個 block 看到的平均值因此隨{' '}
          <Tex>k</Tex> 改變（每 128 個 block 繞一圈：第 127 與第 128 個 block 之間跳回起點），固定點跟著擺動約 <Tex>{`${texNum(Math.max(...fp.rows.map((r) => r.wStar)) - Math.min(...fp.rows.map((r) => r.wStar)), 2)}\\,\\mathrm{fs}`}</Tex>——比例 B 的 <Tex>{`\\sigma_w\\approx${texNum(an.sigmaW, 2)}\\,\\mathrm{fs}`}</Tex>{' '}
          大好幾倍。迴路（<Tex>{`\\tau\\approx${texNum(an.tau, 2)}`}</Tex> 個 block，遠短於擺動的週期）跟得上這個擺動，所以 <Tex>{'w_k'}</Tex> 的起伏大部分不是雜訊。這時拿「前幾萬個 sample 估出來的 <Tex>{'w^*'}</Tex>」去比，一定對不上。
        </p>
        <Steps
          title="mean-field：只把雜訊平均掉，其他照算"
          steps={[
            { tex: T`G_k=\frac1N\sum_{n\in\text{block }k}q[n]\,x_{\mathrm{ref}}[n]`, why: 'GMAC 的定義（§4.6）。$x_{\\mathrm{ref}}$ 是你自己產生的 code，完全已知；唯一的隨機來源是 $q$ 裡的 comparator 雜訊。' },
            { tex: T`E_v\bigl[G_k\bigm|w\bigr]=\frac1N\sum_{n}x_{\mathrm{ref}}[n]\;E\bigl[q[n]\bigm|e_{\det}[n]\bigr]`, why: '只對雜訊 $v$ 取期望值：期望值是線性的，已知的 $x_{\\mathrm{ref}}$ 可以提到外面。' },
            { tex: T`=\frac1N\sum_{n}x_{\mathrm{ref}}[n]\,\operatorname{erf}\!\Bigl(\frac{e_{\det}[n]}{\sqrt2\,\sigma_v}\Bigr)\;=:\;\hat G_k(w)`, why: '代入 §4.5 的第二步（還沒做泰勒展開的那一步）：不需要「小訊號」。' },
            { tex: T`e_{\det}[n]=(a-w)\,u_x[n]+u_d[n]+b`, why: '§4.6：$u_x=H_{\\mathrm{PD}}\\{x\\}$、$u_d=H_{\\mathrm{PD}}\\{d(x)\\}$；$w$ 在 $H_{\\mathrm{PD}}$ 的記憶長度內近似不變，可以提到濾波器外面。' },
            { tex: T`\hat w_{k+1}=\hat w_k+\mu\,\hat G_k(\hat w_{k-d})`, why: '把更新式裡的 $G_k$ 換成它的期望值，從同一個 $w_0$ 出發逐 block 往下算。這一步是近似：真正的 $E[\\operatorname{erf}(\\cdot)]\\ne\\operatorname{erf}(E[\\cdot])$，但 $w$ 的抖動造成的輸入變化遠小於 $\\sigma_v$ 時差別可以忽略。' },
            { tex: T`\hat G_k(w)\approx K_q\bigl(C_k\,(a-w)+B_k\bigr),\qquad C_k=E_k[x_{\mathrm{ref}}u_x],\ \ B_k=E_k\bigl[x_{\mathrm{ref}}(u_d+b)\bigr]`, why: '如果再做小訊號展開 $\\operatorname{erf}(z)\\approx2z/\\sqrt\\pi$：每個 block 有自己的 $C_k$、$B_k$，準靜態固定點是 $w^*_k=a+B_k/C_k$。$C_k$、$B_k$ 不隨 $k$ 變時，就回到 §4.7 的線性時不變模型。' },
          ]}
        />
        <TexBlock id="F-LAB.18" label={md('mean-field 平均軌跡：與迴路同一串 code、同一個 $H_{\\mathrm{PD}}$、同一個更新式，只把 $q$ 換成 $E[q\\mid e_{\\det}]$。Lab 在重播每個 sample 時順便把它算出來。')}>
          {T`\boxed{\hat w_{k+1}=\hat w_k+\mu\,\hat G_k(\hat w_{k-d}),\qquad \hat G_k(w)=\frac1N\sum_{n\in\text{block }k}x_{\mathrm{ref}}[n]\,\operatorname{erf}\!\Bigl(\frac{(a-w)\,u_x[n]+u_d[n]+b}{\sqrt2\,\sigma_v}\Bigr)}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="lab-table">
            <caption>三種「平均模型」的比較（Lab 的交叉比對用第三種；第二種畫成對照線）</caption>
            <thead>
              <tr>
                <th>模型</th>
                <th>怎麼算</th>
                <th>多做的假設</th>
                <th>什麼時候會錯</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  固定點 <Tex>{'w^*=a+B/C'}</Tex>
                </th>
                <td>一個數字</td>
                <td>已經收斂；小訊號；code 統計平穩</td>
                <td>
                  還在 transient（近整數時 <Tex>{'\\tau'}</Tex> 上千個 block）
                </td>
              </tr>
              <tr>
                <th scope="row">
                  線性時不變 <Tex>{'\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}'}</Tex>
                </th>
                <td>
                  常數 <Tex>g</Tex>、<Tex>{'w^*'}</Tex> 的遞迴（<Tex>{'F\\text{-}LAB.7'}</Tex>）
                </td>
                <td>小訊號；code 統計平穩</td>
                <td>
                  <Tex>{'C_k'}</Tex>、<Tex>{'B_k'}</Tex> 隨 block 變（上表）；<Tex>{'|e_{\\det}|'}</Tex> 不遠小於 <Tex>{'\\sigma_v'}</Tex>
                </td>
              </tr>
              <tr>
                <th scope="row">mean-field 平均軌跡</th>
                <td>
                  逐 sample 的 <Tex>{'\\operatorname{erf}'}</Tex>、逐 block 遞迴（<Tex>{'F\\text{-}LAB.18'}</Tex>）
                </td>
                <td>
                  只有 <Tex>{'E[\\operatorname{erf}]\\approx\\operatorname{erf}(E)'}</Tex>
                </td>
                <td>
                  <Tex>{'\\sigma_w|u_x|'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 同量級；定點暫存器的飽和 / dead zone（它是浮點）；平均模型本身不穩定
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="Lab 的做法">
          <ul className="small">
            <li>
              {md(
                'mean $w$ 的容差是 $4\\,\\mathrm{SE}$，SE 用上式；而且 $\\sigma_w$、$\\rho$ 用**預測值**，不用這次模擬的資料去估——$\\tau$ 與視窗同量級時，從資料估的有效樣本數會嚴重偏大，容差就會緊到假警報。',
              )}
            </li>
            <li>{md('比較的對象不是 $w^*$，而是 mean-field 平均軌跡在**同一段時間**的預測：還沒衰減完的 transient、隨 code 擺動的固定點都已經算在裡面。近整數時 $\\tau$ 可以到上千個 block，直接比 $w^*$ 一定不準。')}</li>
            <li>{md('$\\sigma_w$ 比的是「$w_k$ 減掉 mean-field 軌跡之後的殘差」：固定點的擺動是確定的、可預測的，不應該算進雜訊。$w^*_k$ 的擺動幅度超過 $\\sigma_{w,\\mathrm{pred}}$ 時，更新迴路的卡片會警告。')}</li>
            <li>
              {md(`$\\sigma_w$ 的檢驗需要更多獨立樣本：變異數估計的有效樣本數是 $m\\frac{1-\\rho^2}{1+\\rho^2}$（本例 $${texNum(se.nEffVar, 3)}$）。少於 8 個時單一 seed 根本無法檢驗，Lab 會標「不適用」並請你改用 Monte Carlo 分頁。`)}
            </li>
          </ul>
        </Callout>
        <Steps
          title="Run-to-Convergence 要跑多少個 block"
          open={false}
          steps={[
            { tex: T`|\delta_k|\approx|\delta_0|\,\rho^{\,k}\le\frac{\sigma_w}{4}\ \Rightarrow\ k\ge n_s=\tau\ln\frac{4|\delta_0|}{\sigma_w},\qquad \tau=-\frac{1}{\ln\rho}`, why: '要 transient 小到比穩態抖動的四分之一還小；兩邊取對數。$d=0$ 時第一個關係是等號；$d\\ge1$ 時 $\\rho$ 只是漸近的衰減率（$\\rho^k$ 不是包絡），所以這裡是估計，不是保證。' },
            { tex: T`\text{後半段長度}\ \tfrac{K_B}{2}\ \ge\ 10\,\tau`, why: '統計只用後半段：至少要有 10 個時間常數的穩態資料，平均才有意義（上面的 $m_{\\mathrm{eff}}$）。' },
            { tex: T`K_B=2\max\bigl(n_s,\ 10\tau\bigr)`, why: '前半段給 transient，後半段給統計；兩個條件取較嚴的。' },
          ]}
        />
        <TexBlock id="F-LAB.17" label={md(`例 B：$\\tau=${texNum(an.tau, 4)}$、$|\\delta_0|=${an.delta0}\\,\\mathrm{fs}$、$\\sigma_w=${texNum(an.sigmaW, 4)}\\,\\mathrm{fs}$ $\\Rightarrow$ $K_B=${Math.ceil(2 * Math.max(an.tau * Math.log((4 * an.delta0) / an.sigmaW), 10 * an.tau))}$。極性錯誤或 $g$ 太大時沒有這個數字，按鈕會直接告訴你原因。`)}>
          {T`K_B=2\max\Bigl(\tau\ln\frac{4|\delta_0|}{\sigma_w},\ 10\,\tau\Bigr),\qquad \tau=-\frac{1}{\ln\rho}`}
        </TexBlock>
      </Section>

      {/* ---------- 5.3 ---------- */}
      <Section kind="formula" title="5.3　FCW sweep：$C$、PE 與「freeze $\pm\Delta w$」的斜率量測" id="lab-s53">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="approx" /> 同一顆晶片要支援很多 FCW，而 code 的頻譜隨 FCW 改變，所以 <Tex>C</Tex> 也跟著變。FCW sweep 對每個 <Tex>{'\\alpha'}</Tex> 回答三個問題。
        </p>
        <ol>
          <li>
            <strong>極性對不對？</strong> 看 <Tex>{'C=E[x_{\\mathrm{ref}}u_x]'}</Tex> 的正負（§4.6）。Lab 用整段 code record 平均（一階 DSM 取整數個週期），並把 record 切成前後兩半各算一次：兩半差超過 10% 就警告「只涵蓋部分週期」。
          </li>
          <li>
            <strong>學不學得到？</strong> 就算 <Tex>{'C>0'}</Tex>，如果某些 block 完全沒有激勵，那些 block 的 <Tex>{'G_k'}</Tex> 只有雜訊。這就是 Persistent Excitation：
          </li>
        </ol>
        <TexBlock id="F-LAB.13" label={md('每一個 GMAC block 裡，PD 看到的 code 能量都要大於 0。$\\lambda_{\\min}=0$ $\\Rightarrow$ 有 block 不可辨識。')}>
          {T`\lambda_{\min}=\min_{k}\ \frac1N\sum_{n\in\text{block }k}u_x^2[n]\;>\;0`}
        </TexBlock>
        <p className="small">
          這是規格 §9.1 有限窗口定義的單參數版本，視窗取 GMAC 實際的 block 邊界（<ErratumLink id="E35" />）。近整數時，鋸齒的斜坡段變化太慢，被 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 濾得一乾二淨，只有每{' '}
          <Tex>{'1/\\alpha'}</Tex> 個 sample 一次的 reset 瞬間有訊號；如果一個 block（<Tex>N</Tex> 個 sample）比 <Tex>{'1/\\alpha'}</Tex> 短，就會出現「整個 block 沒有 reset」的情況，<Tex>{'\\lambda_{\\min}\\to0'}</Tex>。
        </p>
        <ol start={3}>
          <li>
            <strong>模型的斜率對不對？</strong> 這是 sign-off 矩陣的第一列（§16.2「freeze + <Tex>{'\\pm\\Delta w'}</Tex> perturbation」）：把 <Tex>w</Tex> 凍結在 <Tex>{'w^*+\\Delta w'}</Tex> 與{' '}
            <Tex>{'w^*-\\Delta w'}</Tex>，各量一段 GMAC 的平均，差值除以 <Tex>{'2\\Delta w'}</Tex> 就是斜率。
          </li>
        </ol>
        <Steps
          title="為什麼兩邊要用同一串雜訊（common random numbers）"
          steps={[
            { tex: T`S=-\frac{\partial E[G]}{\partial w}\approx-\frac{\bar G_+-\bar G_-}{2\Delta w}`, why: '中央差分；負號是因為 $E[G]=K(a-w)$ 隨 $w$ 增加而減少。' },
            { tex: T`\operatorname{Var}(\bar G_+-\bar G_-)=\operatorname{Var}(\bar G_+)+\operatorname{Var}(\bar G_-)-2\operatorname{Cov}(\bar G_+,\bar G_-)`, why: '差的變異數（§5.2 的先備知識）。' },
            { tex: T`\text{獨立雜訊：}\operatorname{Cov}=0\ \Rightarrow\ \operatorname{Var}\approx\frac{2}{N_{\mathrm{tot}}}`, why: '每一邊的 $G$ 幾乎是純雜訊（$q=\\pm1$），兩邊獨立時變異數直接相加。' },
            { tex: T`\text{同一串雜訊：只有 }|v+e_{\det}|<\Delta w\,|u_x|\text{ 的樣本 }q_+\ne q_-`, why: '同一個 $v$ 下，兩邊的 comparator 判斷只在「落在兩個門檻之間」時才不同；其他樣本完全抵銷。' },
            { tex: T`P(q_+\ne q_-)\approx\frac{2\,\Delta w\,|u_x|}{\sqrt{2\pi}\,\sigma_v}\ll1\ \Rightarrow\ \operatorname{Var}\ \text{小了約}\ \frac{\sqrt{2\pi}\,\sigma_v}{4\,\Delta w\,|u_x|}\ \text{倍}`, why: 'Gaussian 在原點附近的機率密度 $1/(\\sqrt{2\\pi}\\sigma_v)$ 乘上區間寬度 $2\\Delta w|u_x|$。' },
          ]}
        />
        <TexBlock id="F-LAB.16" label="硬體上做不到「同一串雜訊」，只能拉長量測時間；模型裡可以，所以斜率的信賴區間很窄。">
          {T`S_{\mathrm{GMAC}}=-\frac{\overline{G(w^*+\Delta w)}-\overline{G(w^*-\Delta w)}}{2\,\Delta w}\;\approx\;K_qC`}
        </TexBlock>
        <p className="small">
          注意 <Tex>{'\\Delta w'}</Tex> 不能太大：<Tex>{'\\Delta w\\,|u_x|'}</Tex> 要遠小於 <Tex>{'\\sigma_v'}</Tex> 才在 comparator 的線性區，否則量到的斜率會偏小（erf 飽和）：
          <Tex>{'\\Delta w|u_x|=0.3\\sigma_v'}</Tex> 時偏 <Tex>{`${texNum(100 * slopeBias(0.3), 3)}\\%`}</Tex>，<Tex>{'=\\sigma_v'}</Tex> 時偏 <Tex>{`${texNum(100 * slopeBias(1), 3)}\\%`}</Tex>。Lab 同時算「同一段樣本、對雜訊取期望」的
          mean-field 斜率當對照。
        </p>
      </Section>

      {/* ---------- 5.4 ---------- */}
      <Section kind="formula" title="5.4　Monte Carlo：信賴區間怎麼算、怎麼讀" id="lab-s54">
        <p>
          <ModelLevel level="L2" /> <ClaimTag kind="approx" /> §5.2 靠預測的 <Tex>{'\\rho'}</Tex> 修正單一 seed 的不確定度；更直接的方法是跑很多個 seed。不同 seed 之間完全獨立，所以統計很單純。
        </p>
        <Prereq title="信賴區間（confidence interval）">
          <p>
            {md(
              '跑 $R$ 個獨立的 seed，得到 $R$ 個「後半段平均」$\\bar w_1,\\dots,\\bar w_R$。它們的平均 $\\hat m$ 是真值的估計，樣本標準差 $s$ 量它們之間散得多開。95% 信賴區間是 $\\hat m\\pm t_{0.975,R-1}\\,s/\\sqrt R$：如果把整個實驗重做很多次，大約 95% 的區間會包住真值。$t$ 是 Student-$t$ 分布的分位數——因為 $s$ 自己也是估出來的，$R$ 小時要放寬一點（$R\\to\\infty$ 時 $t\\to1.96$）。',
            )}
          </p>
        </Prereq>
        <div className="table-wrap">
          <table className="lab-table lab-table-num">
            <caption>
              runs 數與 CI 半寬的關係（半寬 <Tex>{'=t_{0.975,R-1}\\,s/\\sqrt R'}</Tex>，以 <Tex>s</Tex> 為單位；由 studentTInv 計算）
            </caption>
            <thead>
              <tr>
                <th>
                  runs <Tex>R</Tex>
                </th>
                {tTable.map((r) => (
                  <td key={r.R}>{r.R}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  <Tex>{'t_{0.975,R-1}'}</Tex>
                </th>
                {tTable.map((r) => (
                  <td key={r.R}>{sig(r.t, 4)}</td>
                ))}
              </tr>
              <tr>
                <th>
                  半寬 <Tex>{'/\\,s'}</Tex>
                </th>
                {tTable.map((r) => (
                  <td key={r.R}>{sig(r.half, 3)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <ul>
          <li>
            {md('**mean $w$**：各 seed 的後半段平均，取 $t$ 區間。檢查的是「線性平均模型的預測在不在區間內」。')}
          </li>
          <li>{md('**$\\sigma_w$**：先算每個 seed 自己的後半段樣本變異數 $s_r^2$，再對 $r$ 平均、開根號（pooled）。不能把所有 seed 的 $w$ 混在一起算一個標準差——那會把「各 seed 平均值的差異」也算進去。')}</li>
          <li>
            {md('**發散比例**：$k$ 個發散、$R$ 個 runs，用 Wilson 區間（比例是 0 或 1 時，常見的 $\\hat p\\pm1.96\\sqrt{\\hat p(1-\\hat p)/R}$ 會給出寬度 0 的荒謬結果）。')}
          </li>
        </ul>
        <ModeGate min="research">
          <Callout kind="info" title="Research：這個 Monte Carlo 抽樣的是什麼">
            <p className="small">
              {md(
                '一階 DSM 與 MASH（無 dither）的 code 是 deterministic 的：換 seed 只換 comparator 雜訊（與 stochastic rounding）。所以這裡的信賴區間是「給定這串 code、這組硬體參數」下，對雜訊實現的不確定度。它**不是**對 FCW、初始相位、PVT 或 mismatch 的不確定度；那些要用 FCW sweep、corner（第 14 章）與 sign-off 矩陣（§16.2）處理。另外，名目 95% 的區間本來就有 5% 的機率不含真值：一次 mismatch 先換 seed 再下結論。',
              )}
            </p>
          </Callout>
        </ModeGate>
      </Section>

      {/* ---------- 5.5 ---------- */}
      <Section kind="formula" title="5.5　Training Sequence：多參數的 Jacobian 與秩" id="lab-s55">
        <p>
          <ModelLevel level="L3" /> <ClaimTag kind="approx" /> 如果要同時校正的不只 gain（還有 offset、INL 的二階 / 三階項），每個參數 <Tex>{'\\theta_j'}</Tex> 透過一個「基底」
          <Tex>{'\\phi_j(x)\\in\\{x,\\ x^2,\\ x^3,\\ 1\\}'}</Tex> 進入 DTC 誤差。問題變成：這串 code 分得出這幾個參數嗎？
        </p>
        <Prereq title="矩陣、秩、奇異值與特徵值（最少需要知道的）">
          <p>
            {md(
              '把「第 $i$ 個相關器對第 $j$ 個參數的靈敏度」排成一張表，就是矩陣 $J$。如果其中一欄可以用其他欄的組合湊出來，代表有一個參數方向「怎麼動，所有相關器都看不出差別」——這個方向不可辨識，矩陣的**秩**（rank）小於參數個數。奇異值（singular values）$\\sigma_1\\ge\\sigma_2\\ge\\dots\\ge0$ 量每個方向的靈敏度有多大：最小的那個是 0，就是秩不足；很小但不是 0，是「理論上可辨識，但要非常久或對雜訊非常敏感」（第 9、10 章）。**特徵值**（eigenvalue）$\\lambda$ 是另一個問題的答案：方陣 $J$ 作用在某個特別的方向 $\\mathbf v$ 上，只是把它伸縮 $\\lambda$ 倍（$J\\mathbf v=\\lambda\\mathbf v$）。多參數的更新式 $\\delta\\boldsymbol\\theta_{k+1}=(I-\\mu J)\\,\\delta\\boldsymbol\\theta_k$ 在這個方向上就退化成純量的 $p=1-\\mu\\lambda$（§4.7），所以每個特徵值的實部都要是正的，才是負回授。',
            )}
          </p>
        </Prereq>
        <Steps
          title="$J$ 的定義"
          steps={[
            { tex: T`e_{\mathrm{DTC}}[n]=\sum_j\delta\theta_j\,\phi_j(x[n])`, why: '每個參數的誤差 $\\delta\\theta_j$ 乘上自己的基底。' },
            {
              tex: T`u_{\mathrm{pd}}[n]\approx\sum_j\delta\theta_j\,\phi_{u,j}[n],\qquad \phi_{u,j}=H_{\mathrm{PD}}\{\phi_j(x)\}`,
              why: '主 PLL 是線性的：每個基底各自被 $H_{\\mathrm{PD}}$ 濾過。$\\delta\\theta_j$ 每個 block 才動一點，在 $H_{\\mathrm{PD}}$ 的記憶長度內近似常數，才能提到濾波器外面（與 §4.6 的單參數版本同一個前提；$\\delta\\theta_j$ 凍結不動時是等號）。',
            },
            { tex: T`E[G_i]=E[q\,\psi_i]\approx K_q\sum_j E[\psi_i\,\phi_{u,j}]\,\delta\theta_j`, why: '第 $i$ 個相關器用 regressor $\\psi_i$；comparator 的小訊號增益 $K_q$（§4.5）。' },
          ]}
          result={T`E[\mathbf G]\approx J\,\delta\boldsymbol\theta,\qquad J_{ij}=K_q\,E\bigl[\psi_i\,\phi_{u,j}\bigr]`}
        />
        <TexBlock id="F-LAB.15" label={md('「scaled」= 每個基底先除以自己的 RMS，避免單位不同造成假的秩判斷。$M=\\mu I$ 的更新還要求 $J$ 的特徵值實部全為正。')}>
          {T`J_{ij}=K_q\,E\bigl[\psi_i[n]\;\phi_{u,j}[n]\bigr],\qquad \phi_{u,j}=H_{\mathrm{PD}}\{\phi_j(x)\},\qquad \operatorname{rank}\bigl(J_{\mathrm{scaled}}\bigr)=\text{參數個數}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="lab-table">
            <caption>三個常見的秩不足（都可以在 Training 分頁重現）</caption>
            <thead>
              <tr>
                <th>情況</th>
                <th>為什麼</th>
                <th>加資料有用嗎</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  offset 基底 + Type-I / II PLL（<ErratumLink id="E04" />）
                </th>
                <td>{md('常數 1 經過 $H_{\\mathrm{PD}}$（$H_{\\mathrm{PD}}(1)=0$）在穩態變成 0：$\\phi_{u,\\mathrm{offset}}\\to0$，$J$ 的那一欄全是 0')}</td>
                <td>沒用：結構性的不可辨識。要換觀測路徑，或不要在這條路徑更新 offset</td>
              </tr>
              <tr>
                <th scope="row">
                  <Tex>{'\\pm1'}</Tex> 的 code + INL 二階 + offset
                </th>
                <td>{md('$x^2\\equiv1$：$x^2$ 與常數是同一個基底')}</td>
                <td>沒用：code 只有兩個值，看不出任何非線性。要更多 code level</td>
              </tr>
              <tr>
                <th scope="row">近整數的一階 DSM</th>
                <td>{md('$u_x$ 幾乎只在 reset 瞬間不為 0，而那個瞬間 $x$ 永遠是同一個值：各基底在 PD 端幾乎成比例')}</td>
                <td>幾乎沒用：最小奇異值很小（條件數很大）。要換 code（MASH，或疊上振幅夠大的已知隨機化；只開 LSB dither 沒有用，鋸齒還在）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          code randomization（在 residue 上疊一個<strong>已知</strong>的亂數，由數位端補償）是增加激勵的一種想法，標為 <ClaimTag kind="research" />：它讓 <Tex>C</Tex> 與秩變好（多了一層與 residue 無關的白色激勵），代價是 DTC 範圍變大、INL 暴露更多、輸出多一層寬頻雜訊。它<strong>不會</strong>消除 fractional 譜線：overlay 是加上去的，residue
          的鋸齒還在，以 <Tex>{'T_{\\mathrm{vco}}'}</Tex> 計的 <Tex>{'A_1'}</Tex> 不變；Training 分頁裡 tone 看起來變小，是正規化的 <Tex>s</Tex> 變小造成的（同樣的 <Tex>{'\\Delta a'}</Tex> 對應較小的實體 gain 誤差）。真正的好處是間接的：激勵變好之後，同樣的{' '}
          <Tex>{'\\mu'}</Tex> 下實體 gain 的抖動 <Tex>{'\\sigma_w\\,s'}</Tex> 變小。Lab 只給行為模型的趨勢，不宣稱任何晶片的數字。相關章節：<ChLink to="/ch/09">第 9 章</ChLink>、<ChLink to="/ch/10">第 10 章</ChLink>。
        </p>
      </Section>
    </section>
  )
}
