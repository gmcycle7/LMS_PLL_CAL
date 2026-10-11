import { Link } from 'react-router-dom'
import { Callout, ClaimTag, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, TestBadge, mathText } from '@/components'
import { Deriv, Erratum, Fig, Hand, TagRow, n, texMat, tn } from '../common'
import { NUM } from '../numbers'

/** 點 preset 連結後捲到實驗（HashRouter 不能用 #anchor） */
function scrollToLab() {
  if (typeof document === 'undefined') return
  const el = document.getElementById('ch10-lab')
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function S4Jacobian() {
  const t = NUM.t18
  const fd = NUM.fd
  const r03 = fd.rows.find((r) => r.r === 0.3) ?? fd.rows[1]
  return (
    <>
      <Section
        kind="intuition"
        title={
          <>
            10.5 比理想 <Tex>{String.raw`\mathbf R`}</Tex> 更實際：量測 Jacobian
          </>
        }
        level={2}
        id="ch10-jacobian"
      >
        <TagRow>
          <span className="small muted">規格 §10.2</span>
          <ClaimTag kind="approx" />
        </TagRow>
        <p>
          到目前為止都假設「GMAC 用的 code 就是有效 regressor」（<Tex>{String.raw`\mathbf x=\mathbf u`}</Tex>）、而且我們知道 <Tex>{String.raw`\mathbf R`}</Tex>。真實晶片裡：
        </p>
        <ul>
          <li>
            有效 regressor 經過 PLL 的 <Tex>{String.raw`H_{\mathrm{PD}}`}</Tex>、延遲、相位旋轉（第 6–7 章），GMAC 的 code 卻是原始的 DSM / PHOS code，所以{' '}
            <Tex>{String.raw`\mathbf C=E[\mathbf x\mathbf u^T]`}</Tex>（GMAC code <Tex>{String.raw`\mathbf x`}</Tex> 與有效 regressor <Tex>{String.raw`\mathbf u`}</Tex> 的交叉相關矩陣；匹配時就是{' '}
            <Tex>{String.raw`\mathbf R`}</Tex>）不一定對稱，甚至可能不定號。
          </li>
          <li>
            <Tex>{String.raw`\mathbf R`}</Tex> 隨 FCW、PVT 改變；設計時算的 <Tex>{String.raw`\mathbf R`}</Tex> 到了量產可能不準。
          </li>
        </ul>
        <p>
          所以更實際的做法是<strong>直接量</strong> GMAC 對每個係數的斜率：<Tex>{String.raw`\mathbf J=\partial E[\mathbf G]/\partial\mathbf w`}</Tex>（理想匹配時{' '}
          <Tex>{String.raw`\mathbf J=-K_q\mathbf R`}</Tex>；一般情況 <Tex>{String.raw`\mathbf J=-K_q\mathbf C`}</Tex>）。
        </p>

        <h3 className="ch10-sub">中央差分：Freeze、擾動、各量一次 GMAC</h3>
        <p>
          先 Freeze gain（所有係數停止更新），在相同 operating condition 下分別把第 j 個參數 <Tex>{String.raw`\pm\Delta_j`}</Tex>（<Tex>{String.raw`\Delta_j`}</Tex> 是刻意加上去的小擾動，單位 fs），每次都讓 GMAC 累加{' '}
          <Tex>{'N_J'}</Tex> 個 sample 再讀值（<Tex>{'N_J'}</Tex> 是量測 Jacobian 專用的累加長度，可以和平常更新用的 <Tex>{'N'}</Tex> 不同）。量出來的估計值記成 <Tex>{String.raw`\hat{\mathbf J}`}</Tex>（戴帽子），晶片真正的斜率是{' '}
          <Tex>{String.raw`\mathbf J`}</Tex>。整個流程是一個小狀態機：
        </p>
        <Fig id="jacobian-fsm">
          先由上往下沿著箭頭走：FREEZE 讓所有係數停止更新（否則 <Tex>{String.raw`\mathbf w`}</Tex> 一邊量一邊動，量到的不是同一個點的斜率）→ PLUS 把 <Tex>{'w_j'}</Tex> 加上 <Tex>{String.raw`\Delta_j`}</Tex>，等{' '}
          <Tex>{'N_J'}</Tex> 個 sample，記下所有 GMAC 的平均 <Tex>{String.raw`\mathbf G^{+}`}</Tex> → MINUS 改成減 <Tex>{String.raw`\Delta_j`}</Tex>，記下 <Tex>{String.raw`\mathbf G^{-}`}</Tex> → SLOPE 相減再除以{' '}
          <Tex>{String.raw`2\Delta_j`}</Tex>，得到 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 的第 <Tex>{'j'}</Tex> 欄，並把 <Tex>{'w_j'}</Tex> 放回原值。再看回頭的那條箭頭：對每個參數重複一次，<Tex>{'P'}</Tex> 個參數一共{' '}
          <Tex>{'2P'}</Tex> 次量測。圖上 SLOPE 那一格就是下面的 F-10.9：<Tex>{String.raw`\mathbf G^{+}=\mathbf G(\mathbf w+\Delta_j\mathbf e_j)`}</Tex>、<Tex>{String.raw`\mathbf G^{-}=\mathbf G(\mathbf w-\Delta_j\mathbf e_j)`}</Tex>，其中{' '}
          <Tex>{String.raw`\mathbf e_j`}</Tex> 是第 <Tex>{'j'}</Tex> 個分量為 1、其餘為 0 的單位向量，所以 <Tex>{String.raw`\mathbf w+\Delta_j\mathbf e_j`}</Tex> 就是「只把 <Tex>{'w_j'}</Tex> 加上 <Tex>{String.raw`\Delta_j`}</Tex>」。
        </Fig>
        <TexBlock id="F-10.9" label={mathText('第 $j$ 欄 = 只擾動第 $j$ 個參數時，所有 GMAC 的變化率')}>
          {String.raw`\boxed{J_{ij}\approx\frac{G_i(\mathbf w+\Delta_j\mathbf e_j)-G_i(\mathbf w-\Delta_j\mathbf e_j)}{2\Delta_j}}`}
        </TexBlock>
        <Deriv title="為什麼用中央差分（而不是單邊）">
          <StepDerivation
            steps={[
              { tex: String.raw`G(w+\Delta)=G(w)+G'(w)\Delta+\tfrac12G''(w)\Delta^2+\tfrac16G'''(w)\Delta^3+\cdots`, why: '泰勒展開（微積分）。' },
              {
                tex: String.raw`G(w-\Delta)=G(w)-G'(w)\Delta+\tfrac12G''(w)\Delta^2-\tfrac16G'''(w)\Delta^3+\cdots`,
                why: (
                  <>
                    把 <Tex>{String.raw`\Delta`}</Tex> 換成 <Tex>{String.raw`-\Delta`}</Tex>：奇數次項變號。
                  </>
                ),
              },
              {
                tex: String.raw`\frac{G(w+\Delta)-G(w-\Delta)}{2\Delta}=G'(w)+\tfrac16G'''(w)\Delta^2+\cdots`,
                why: (
                  <>
                    相減：<Tex>{'G(w)'}</Tex> 與 <Tex>{String.raw`\Delta^2`}</Tex> 項相消，誤差從 <Tex>{String.raw`O(\Delta)`}</Tex> 降為 <Tex>{String.raw`O(\Delta^2)`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\frac{G(w+\Delta)-G(w)}{\Delta}=G'(w)+\tfrac12G''(w)\Delta+\cdots`,
                why: (
                  <>
                    對照：單邊差分留下 <Tex>{String.raw`O(\Delta)`}</Tex> 誤差（comparator offset 或 bias 造成 <Tex>{String.raw`G''\ne0`}</Tex> 時更明顯）。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <p>
          <Tex>{String.raw`\Delta`}</Tex> 要選多大？有兩個互相拉扯的誤差來源：太小，兩次讀數的差被 GMAC 雜訊淹沒；太大，comparator 開始飽和，量到的斜率偏小。
        </p>
        <Fig id="fd-tradeoff">
          先看上面一路（<Tex>{String.raw`\Delta`}</Tex> 太小）：<Tex>{String.raw`\mathbf G^{+}-\mathbf G^{-}`}</Tex> 比 GMAC 自己的雜訊還小，<Tex>{String.raw`\hat{\mathbf J}`}</Tex> 的標準差與{' '}
          <Tex>{String.raw`1/\Delta`}</Tex> 成正比。再看下面一路（<Tex>{String.raw`\Delta`}</Tex> 太大）：<Tex>{String.raw`\pm\Delta`}</Tex> 已經把 comparator 推到 erf 變平的地方，量到的斜率絕對值比真實的小。中間一路是折衷。圖上的「截斷係數」就是下面
          F-10.14 的 <Tex>{String.raw`\hat J_{ij}/J_{ij}`}</Tex>（1 代表沒有偏差），「std」就是再下面的雜訊公式 <Tex>{String.raw`\sqrt{2R_{x,ii}/N_J}/(2\Delta)`}</Tex> 除以 <Tex>{'K_q'}</Tex>；三路的數字都在後面的表裡（
          <Tex>{String.raw`\Delta/\sigma_v=0.1,\ 0.3,\ 1`}</Tex> 三列）。
        </Fig>
        <p>
          1-bit comparator 的 GMAC 是 erf 形狀的 S 曲線，在 <Tex>{String.raw`\pm\Delta`}</Tex> 處已經開始飽和（上面的 <Tex>{String.raw`\tfrac16G'''\Delta^2`}</Tex> 項與 <Tex>{String.raw`G'`}</Tex> 反號），所以量到的斜率<strong>絕對值偏小</strong>。在{' '}
          <Tex>{String.raw`\boldsymbol\delta=0`}</Tex> 量測、樣本無限多時，第 j 欄的截斷係數：
        </p>
        <TexBlock id="F-10.14" label="1-bit 中央差分的截斷係數（只看偏差，不含雜訊）">
          {String.raw`\frac{\hat J_{ij}}{J_{ij}}=\begin{cases}\dfrac{1}{\sqrt{1+\Delta^2R_{jj}/\sigma_v^2}} & \text{Gaussian }u\ (\text{由 F-10.13})\\[2ex]\dfrac{\operatorname{erf}\big(\Delta/(\sqrt2\sigma_v)\big)}{K_q\Delta} & \pm1\text{ 碼}\end{cases}`}
        </TexBlock>
        <ModeGate min="engineer">
          <Deriv title={String.raw`$\pm1$ 碼的截斷係數（逐步）`}>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\mathbf w\pm\Delta\mathbf e_j\ \Leftrightarrow\ \boldsymbol\delta=\mp\Delta\mathbf e_j`,
                  why: (
                    <>
                      在 <Tex>{String.raw`\boldsymbol\delta=0`}</Tex> 附近量測；<Tex>{String.raw`\mathbf w`}</Tex> 加 <Tex>{String.raw`\Delta`}</Tex> 等於 <Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex> 減 <Tex>{String.raw`\Delta`}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`G_i(\mp\Delta\mathbf e_j)=E\big[u_i\operatorname{sign}(\mp\Delta u_j+v)\big]`,
                  why: (
                    <>
                      <Tex>{String.raw`e=\mathbf u^T\boldsymbol\delta+v`}</Tex> 只剩第 j 項（引數寫的是 <Tex>{String.raw`\boldsymbol\delta`}</Tex>）。
                    </>
                  ),
                },
                {
                  tex: String.raw`=E\Big[u_i\,u_j\,\operatorname{erf}\!\big(\mp\Delta/(\sqrt2\sigma_v)\big)\Big]`,
                  why: (
                    <>
                      <Tex>{String.raw`u_j=\pm1\Rightarrow E[\operatorname{sign}(\mp\Delta u_j+v)\mid\mathbf u]=u_j\operatorname{erf}\big(\mp\Delta/(\sqrt2\sigma_v)\big)`}</Tex>（erf 為奇函數）。
                    </>
                  ),
                },
                {
                  tex: String.raw`=\mp R_{ij}\operatorname{erf}\!\big(\Delta/(\sqrt2\sigma_v)\big)`,
                  why: (
                    <>
                      <Tex>{String.raw`E[u_iu_j]=R_{ij}`}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\hat J_{ij}=\frac{G_i(-\Delta\mathbf e_j)-G_i(+\Delta\mathbf e_j)}{2\Delta}=-R_{ij}\frac{\operatorname{erf}(\Delta/(\sqrt2\sigma_v))}{\Delta}`,
                  why: (
                    <>
                      代入中央差分（<Tex>{String.raw`\mathbf w+\Delta\mathbf e_j\Leftrightarrow\boldsymbol\delta=-\Delta\mathbf e_j`}</Tex>）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\frac{\hat J_{ij}}{J_{ij}}=\frac{\operatorname{erf}(\Delta/(\sqrt2\sigma_v))}{K_q\Delta}`,
                  why: (
                    <>
                      真實 <Tex>{String.raw`J_{ij}=-K_qR_{ij}`}</Tex>。<Tex>{String.raw`\Delta\to0`}</Tex> 時 <Tex>{String.raw`\operatorname{erf}(z)\approx2z/\sqrt\pi`}</Tex> ⇒ 比值 → 1。
                    </>
                  ),
                },
              ]}
            />
            <p>
              例：<Tex>{String.raw`\Delta=0.3\sigma_v`}</Tex>：<Tex>{String.raw`\operatorname{erf}(0.3/\sqrt2)=${tn(fd.erf03, 5)}`}</Tex>，<Tex>{String.raw`K_q\Delta=0.3\sqrt{2/\pi}=${tn(0.3 * Math.sqrt(2 / Math.PI), 5)}`}</Tex>，
              比值 <Tex>{String.raw`${tn(r03.pm1, 5)}`}</Tex>（−{n(100 * (1 - r03.pm1), 2)}%）。
            </p>
          </Deriv>
        </ModeGate>
        <p>
          反過來，<Tex>{String.raw`\Delta`}</Tex> 太小則雜訊大：兩次獨立的 <Tex>{'N_J'}</Tex>-sample GMAC 相減，
          <Tex>{String.raw`\operatorname{std}(\hat J_{ij})\approx\sqrt{2R_{x,ii}/N_J}/(2\Delta)`}</Tex>（<Tex>{String.raw`R_{x,ii}=E[x_i^2]`}</Tex> 是第 <Tex>{'i'}</Tex> 個 GMAC code 的功率，§10.2；每次量測的變異約{' '}
          <Tex>{String.raw`R_{x,ii}/N_J`}</Tex>，兩次相加）。下表（正規化{' '}
          <Tex>{String.raw`\hat J/K_q`}</Tex>、<Tex>{String.raw`N_J=4096`}</Tex>、<Tex>{String.raw`R_{x,ii}=1`}</Tex>）顯示這個 bias–variance trade-off：
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="ch10-num">
                  <Tex>{String.raw`\Delta/\sigma_v`}</Tex>
                </th>
                <th className="ch10-num">
                  截斷係數（Gaussian <Tex>{'u'}</Tex>）
                </th>
                <th className="ch10-num">
                  截斷係數（<Tex>{String.raw`\pm1`}</Tex> 碼）
                </th>
                <th className="ch10-num">
                  雜訊 <Tex>{String.raw`\operatorname{std}(\hat J_{ij}/K_q)`}</Tex>，<Tex>{String.raw`N_J=4096`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {fd.rows.map((row) => (
                <tr key={row.r} className={row.r === 0.3 ? 'ch10-hl' : undefined}>
                  <td className="ch10-num">{row.r}</td>
                  <td className="ch10-num">
                    {n(row.gaussian, 4)}（{n(100 * (row.gaussian - 1), 3)}%）
                  </td>
                  <td className="ch10-num">
                    {n(row.pm1, 4)}（{n(100 * (row.pm1 - 1), 3)}%）
                  </td>
                  <td className="ch10-num">{n(row.stdNj4096, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout
          kind="warn"
          title={
            <>
              對 <Tex>{String.raw`\rho=0.99`}</Tex> 這種近奇異的 <Tex>{String.raw`\mathbf R`}</Tex>，4096 個 sample 量不出差別
            </>
          }
        >
          <p>
            <Tex>{String.raw`\Delta=0.3\sigma_v,\ N_J=4096`}</Tex> 時每個元素的雜訊 <Tex>{String.raw`\operatorname{std}\approx${tn(r03.stdNj4096, 2)}`}</Tex>，比{' '}
            <Tex>{String.raw`\lambda_{\min}=0.01`}</Tex> 大好幾倍。用這種 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 去求完整反矩陣，等於拿雜訊去除以接近 0 的數。這是 regularization 的第二個理由（下一段，勘誤
            E24）。<ClaimTag kind="approx" />
          </p>
        </Callout>
        <Hand id="HC-10.6">
          假裝你在量產測試機前：把第 <Tex>{'j'}</Tex> 個係數 <Tex>{String.raw`\pm\Delta`}</Tex>，各讀一次 GMAC。預設的兩個讀數（<Tex>{String.raw`\mp${tn(fd.erf03, 4)}`}</Tex>）是 <Tex>{String.raw`\Delta=0.3\sigma_v`}</Tex> 時 ±1 碼的理論值，對應上表{' '}
          <Tex>{String.raw`\Delta/\sigma_v=0.3`}</Tex> 那一列。換成你自己的讀數與 <Tex>{String.raw`\Delta`}</Tex>、<Tex>{'N_J'}</Tex>，先用紙筆算出 <Tex>{String.raw`\hat J_{ij}`}</Tex>、截斷係數與雜訊（<Tex>{String.raw`\operatorname{erf}`}</Tex>{' '}
          要查表或用題目裡的級數近似），再展開步驟對答案。讀數要和 <Tex>{String.raw`\Delta`}</Tex> 相稱：unit-RMS 的 regressor 滿足 <Tex>{String.raw`|J_{ij}|\le K_q`}</Tex>，所以兩個讀數的差不會比{' '}
          <Tex>{String.raw`2K_q\Delta`}</Tex> 大出量測雜訊——差太多時題目會告訴你這組數字為什麼量不到。
        </Hand>

        <h3 className="ch10-sub">
          線性化：<Tex>{String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I+\mathbf M\mathbf J`}</Tex>
        </h3>
        <p>
          量到 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 之後，怎麼知道用它建構出來的 <Tex>{String.raw`\mathbf M`}</Tex> 穩不穩定？答案和 §10.3 一樣：看迴路矩陣的 eigenvalue。差別只有一個，卻很要緊：
          <Tex>{String.raw`\mathbf M`}</Tex> 是用「量到的」<Tex>{String.raw`\hat{\mathbf J}`}</Tex> 算的，晶片上轉的卻是「真正的」<Tex>{String.raw`\mathbf J`}</Tex>。
        </p>
        <Fig id="acal-check">
          先看藍色方塊的兩個輸入：一路從量到的 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 出發，經過「建構 <Tex>{String.raw`\mathbf M(\hat{\mathbf J})`}</Tex>」；另一路直接來自晶片真正的 <Tex>{String.raw`\mathbf J`}</Tex>；兩者相乘再加{' '}
          <Tex>{String.raw`\mathbf I`}</Tex> 才是 <Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex>。再往下：算它的 eigenvalue（poles），最大的絕對值就是 spectral radius{' '}
          <Tex>{String.raw`\rho(\mathbf A_{\mathrm{cal}})`}</Tex>，小於 1 平均誤差才收斂。圖上的 <Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 就是 F-10.2 與下面推導的{' '}
          <Tex>{String.raw`\mathbf I+\mathbf M\mathbf J`}</Tex>；如果把 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 也拿來當成 <Tex>{String.raw`\mathbf J`}</Tex> 代進去，算出來的 pole 只是紙上的值（勘誤
          E24，本節最後的表就是兩者不同時發生的事）。
        </Fig>
        <Deriv title="從 Jacobian 推迴路矩陣">
          <StepDerivation
            steps={[
              {
                tex: String.raw`E[\mathbf G(\mathbf w)]\approx\mathbf J\,(\mathbf w-\mathbf w^*)`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf w^*`}</Tex> 是 <Tex>{String.raw`E[\mathbf G]=0`}</Tex> 的固定點（不一定等於 <Tex>{String.raw`\mathbf a`}</Tex>，見第 11 章 bias）；在{' '}
                    <Tex>{String.raw`\mathbf w^*`}</Tex> 附近一階泰勒展開。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf w_{k+1}-\mathbf w^*=\mathbf w_k-\mathbf w^*+\mathbf M\mathbf J(\mathbf w_k-\mathbf w^*)+\mathbf M\boldsymbol\eta_k`,
                why: (
                  <>
                    更新式兩邊減 <Tex>{String.raw`\mathbf w^*`}</Tex>，代入 <Tex>{String.raw`\mathbf G=\mathbf J(\mathbf w-\mathbf w^*)+\boldsymbol\eta`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\boldsymbol\epsilon_{k+1}=(\mathbf I+\mathbf M\mathbf J)\,\boldsymbol\epsilon_k+\mathbf M\boldsymbol\eta_k,\quad\boldsymbol\epsilon=\mathbf w-\mathbf w^*`,
                why: (
                  <>
                    提出 <Tex>{String.raw`\boldsymbol\epsilon_k`}</Tex>。與 F-10.2 相同（<Tex>{String.raw`\mathbf w^*=\mathbf a`}</Tex> 時 <Tex>{String.raw`\boldsymbol\epsilon=-\boldsymbol\delta`}</Tex>）。
                  </>
                ),
              },
            ]}
            result={String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I+\mathbf M\mathbf J`}
          />
        </Deriv>
        <Prereq title="SVD（singular value decomposition）：任何矩陣都能拆成「旋轉 × 拉伸 × 旋轉」">
          <p>
            任何實矩陣 <Tex>{String.raw`\mathbf J=\mathbf U\boldsymbol\Sigma\mathbf V^T`}</Tex>：<Tex>{String.raw`\mathbf U,\mathbf V`}</Tex> 的欄互相垂直（<Tex>{String.raw`\mathbf U^T\mathbf U=\mathbf V^T\mathbf V=\mathbf I`}</Tex>），
            <Tex>{String.raw`\boldsymbol\Sigma=\operatorname{diag}(\sigma_1\ge\sigma_2\ge\dots\ge0)`}</Tex>。<Tex>{String.raw`\sigma_i`}</Tex> 是 <Tex>{String.raw`\mathbf J`}</Tex> 沿{' '}
            <Tex>{String.raw`\mathbf v_i`}</Tex> 方向的「放大倍率」。和 eigenvalue 的差別：<Tex>{String.raw`\mathbf J`}</Tex> 不對稱時 eigenvalue 可能是負的或複數，singular value 永遠是非負實數。
            實用關係：<Tex>{String.raw`\mathbf J^T\mathbf J=\mathbf V\boldsymbol\Sigma\mathbf U^T\mathbf U\boldsymbol\Sigma\mathbf V^T=\mathbf V\boldsymbol\Sigma^2\mathbf V^T`}</Tex>。對稱正定矩陣的 SVD 就是它的 eigen 分解；對稱負定（例如{' '}
            <Tex>{String.raw`-\mathbf R`}</Tex>）則 <Tex>{String.raw`\sigma_i=|\lambda_i|`}</Tex>。符號提醒：這裡的 <Tex>{String.raw`\mathbf V`}</Tex> 是{' '}
            <Tex>{String.raw`\mathbf J`}</Tex> 的右 singular vectors；匹配模型 <Tex>{String.raw`\mathbf J=-K_q\mathbf R`}</Tex> 時它恰好就是前面{' '}
            <Tex>{String.raw`\mathbf R`}</Tex> 的 eigenvector 矩陣，而且 <Tex>{String.raw`\sigma_i=K_q\lambda_i`}</Tex>。
          </p>
        </Prereq>

        <h3 className="ch10-sub">
          Regularized pseudoinverse：<Tex>{String.raw`\mathbf M=-\gamma(\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T`}</Tex>
        </h3>
        <p>
          <Tex>{String.raw`\mathbf J`}</Tex> 可能不對稱、甚至接近奇異，直接求 <Tex>{String.raw`\mathbf J^{-1}`}</Tex> 很危險。Regularized pseudoinverse 的做法是：沿著 <Tex>{String.raw`\mathbf J`}</Tex> 的每一個 singular
          方向，各做一次「分母加了 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 的除法」。用上面的 SVD 把它畫出來：
        </p>
        <Fig id="pinv-svd">
          先看 ①（晶片）：誤差 <Tex>{String.raw`\boldsymbol\epsilon`}</Tex> 被 <Tex>{String.raw`\mathbf V^T`}</Tex> 拆成模式，每個模式乘上自己的 singular value <Tex>{String.raw`\sigma_i`}</Tex>，再被{' '}
          <Tex>{String.raw`\mathbf U`}</Tex> 轉成 GMAC 看到的方向，得到綠色的 <Tex>{String.raw`E[\mathbf G_k]=\mathbf J\boldsymbol\epsilon_k`}</Tex>。再看 ②（更新矩陣），它從同一個 <Tex>{String.raw`\mathbf G_k`}</Tex>（綠色）接下去：先用{' '}
          <Tex>{String.raw`\mathbf U^T`}</Tex> 轉回來，乘上藍色的 <Tex>{String.raw`\sigma_i/(\sigma_i^2+\lambda_{\mathrm{reg}})`}</Tex>，再用{' '}
          <Tex>{String.raw`\mathbf V`}</Tex> 轉回參數座標並乘 <Tex>{String.raw`-\gamma`}</Tex>。<Tex>{String.raw`\mathbf U`}</Tex> 與 <Tex>{String.raw`\mathbf U^T`}</Tex> 相消（<Tex>{String.raw`\mathbf U^T\mathbf U=\mathbf I`}</Tex>），所以模式{' '}
          <Tex>{'i'}</Tex> 繞一圈只乘了 <Tex>{String.raw`\sigma_i\times\sigma_i/(\sigma_i^2+\lambda_{\mathrm{reg}})\times(-\gamma)`}</Tex>：加上原來的 1 就是下面 F-10.10 的{' '}
          <Tex>{String.raw`p_i=1-\gamma\sigma_i^2/(\sigma_i^2+\lambda_{\mathrm{reg}})`}</Tex>。圖上用的是上一段推導的座標 <Tex>{String.raw`\boldsymbol\epsilon=\mathbf w-\mathbf w^*`}</Tex>（<Tex>{String.raw`\mathbf w^*=\mathbf a`}</Tex> 時{' '}
          <Tex>{String.raw`\boldsymbol\epsilon=-\boldsymbol\delta`}</Tex>，pole 相同）；<Tex>{String.raw`\lambda_{\mathrm{reg}}=0`}</Tex> 時藍色方塊變成 <Tex>{String.raw`1/\sigma_i`}</Tex>，就是完整反矩陣。
        </Fig>
        <Deriv title="用 SVD 推出每個模式的 pole">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf M\mathbf J=-\gamma(\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T\mathbf J`,
                why: (
                  <>
                    代入 <Tex>{String.raw`\mathbf M`}</Tex>（以「與 plant 相同的 <Tex>{String.raw`\mathbf J`}</Tex>」建構）。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf J^T\mathbf J=\mathbf V\boldsymbol\Sigma^2\mathbf V^T,\qquad\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I=\mathbf V(\boldsymbol\Sigma^2+\lambda_{\mathrm{reg}}\mathbf I)\mathbf V^T`,
                why: (
                  <>
                    SVD；加 <Tex>{String.raw`\lambda_{\mathrm{reg}}\mathbf I=\lambda_{\mathrm{reg}}\mathbf V\mathbf V^T`}</Tex> 不改 <Tex>{String.raw`\mathbf V`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf M\mathbf J=-\gamma\,\mathbf V(\boldsymbol\Sigma^2+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\boldsymbol\Sigma^2\mathbf V^T`,
                why: (
                  <>
                    <Tex>{String.raw`(\mathbf V\mathbf D\mathbf V^T)^{-1}=\mathbf V\mathbf D^{-1}\mathbf V^T`}</Tex>；對角矩陣相乘、求逆都逐元素。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf I+\mathbf M\mathbf J=\mathbf V\operatorname{diag}\!\Big(1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}\Big)\mathbf V^T`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf I=\mathbf V\mathbf V^T`}</Tex>（<Tex>{String.raw`\mathbf J`}</Tex> 為方陣）。注意：對任何 <Tex>{String.raw`\mathbf J`}</Tex> 都成立，包括不對稱、不定號的{' '}
                    <Tex>{String.raw`\mathbf J`}</Tex>。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <TexBlock
          id="F-10.10"
          label={
            <>
              只在 <Tex>{String.raw`\mathbf M`}</Tex> 由與 plant 相同的 <Tex>{String.raw`\mathbf J`}</Tex> 建構時（<Tex>{String.raw`\hat{\mathbf J}=\mathbf J`}</Tex>）成立
            </>
          }
        >
          {String.raw`\boxed{\mathbf M=-\gamma(\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\mathbf J^T\ \Rightarrow\ p_i=1-\gamma\,\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}}`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\lambda_{\mathrm{reg}}=0`}</Tex> 時就是 <Tex>{String.raw`\mathbf M=-\gamma\mathbf J^{-1}`}</Tex>（完整反矩陣，所有 <Tex>{String.raw`p_i=1-\gamma`}</Tex>）。
          <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 在這裡與 <Tex>{String.raw`J^2`}</Tex> 同單位（實體 <Tex>{String.raw`\mathrm{fs}^{-2}`}</Tex>）
          <Erratum id="E22" />。
        </p>
        <Callout
          kind="danger"
          title={
            <>
              勘誤 E24：<Tex>{String.raw`\hat{\mathbf J}\ne\mathbf J`}</Tex> 時 pole 公式失效，可能直接發散
            </>
          }
        >
          <p>
            實務上 <Tex>{String.raw`\mathbf M`}</Tex> 是用<strong>量測的</strong> <Tex>{String.raw`\hat{\mathbf J}`}</Tex>（有雜訊、PVT drift）建構的，poles 必須用{' '}
            <Tex>{String.raw`\operatorname{eig}\big(\mathbf I+\mathbf M(\hat{\mathbf J})\,\mathbf J_{\text{true}}\big)`}</Tex> 計算。近奇異的 <Tex>{String.raw`\mathbf J`}</Tex> 對{' '}
            <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差極端敏感。下表的 <Tex>{String.raw`\mathbf J_n=\mathbf J/K_q`}</Tex> 是除掉 <Tex>{'K_q'}</Tex> 的正規化 Jacobian（匹配模型下{' '}
            <Tex>{String.raw`=-\mathbf R`}</Tex>），<Tex>{String.raw`\hat\rho`}</Tex> 是建構 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 時「以為的」相關係數，真實值是 0.99：
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    真實 <Tex>{String.raw`\mathbf J_n=-\mathbf R(0.99)`}</Tex>，<Tex>{String.raw`\hat{\mathbf J}_n=-\mathbf R(\hat\rho)`}</Tex>
                  </th>
                  <th className="ch10-num">
                    <Tex>{String.raw`\gamma`}</Tex>
                  </th>
                  <th className="ch10-num">
                    <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>
                  </th>
                  <th className="ch10-num">
                    poles <Tex>{String.raw`=\operatorname{eig}(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J)`}</Tex>
                  </th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {NUM.e24.map((row, i) => (
                  <tr key={i}>
                    <td className="ch10-num">
                      <Tex>{String.raw`\hat\rho=${row.rhoHat}`}</Tex>
                    </td>
                    <td className="ch10-num">{row.gamma}</td>
                    <td className="ch10-num">{row.lambdaReg === 0 ? '0' : n(row.lambdaReg, 2)}</td>
                    <td className="ch10-num">{row.poles.map((p) => n(p, 4)).join('、')}</td>
                    <td className={row.rho >= 1 - 1e-9 ? 'ch10-bad' : 'ch10-good'}>
                      {row.rho > 1 + 1e-9 ? (
                        '發散'
                      ) : row.rho >= 1 - 1e-9 ? (
                        <>
                          臨界（<Tex>{'p=-1'}</Tex>）
                        </>
                      ) : (
                        '穩定'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Tex>{String.raw`\hat\rho`}</Tex> 只差 0.006（0.996 vs 0.99），<Tex>{String.raw`\lambda_{\mathrm{reg}}=0`}</Tex> 的完整反矩陣就從「全部 pole = 0」（
            <Tex>{String.raw`\gamma=1`}</Tex>）變成 −1.5 而發散；加上很小的 <Tex>{String.raw`\lambda_{\mathrm{reg}}=10^{-4}`}</Tex> 就回到穩定。
            <strong>
              <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 的另一個作用，是提供對 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差的 robustness。
            </strong>
            （理由：<Tex>{String.raw`\hat{\mathbf J}`}</Tex> 與 <Tex>{String.raw`\mathbf J`}</Tex> 共用 eigenvectors，慢模式 pole{' '}
            <Tex>{String.raw`=1-\gamma\lambda_{\min}/\hat\lambda_{\min}=1-(1-\rho)/(1-\hat\rho)=1-0.01/0.004=-1.5`}</Tex>：慢模式被過度修正 2.5 倍。）
            <Erratum id="E24" />
          </p>
        </Callout>
      </Section>

      <Section kind="example" title="10.5.1 反例（T18）：每個 loop 單獨穩定，不代表 MIMO 一起穩定" id="ch10-t18">
        <TagRow>
          <TestBadge id="T18" />
          <ClaimTag kind="exact" />
          <span className="small muted">規格 §10.2、§17 T18、§19.2 Gallery #12</span>
        </TagRow>
        <p>
          兩個 GMAC，量到的 Jacobian 是 <Tex>{String.raw`\mathbf J=\begin{bmatrix}-1&2\\2&-1\end{bmatrix}`}</Tex>（<Tex>{'K_q'}</Tex> 正規化為 1）。對角都是 −1：每個 loop 單獨看，極性正確、斜率正確。用 scalar{' '}
          <Tex>{String.raw`\mathbf M=0.2\mathbf I`}</Tex>。先把這個 <Tex>{String.raw`\mathbf J`}</Tex> 畫成訊號流，再從三個角度看它：
        </p>
        <Fig id="t18-coupling">
          先看輸出是 <Tex>{'G_1'}</Tex> 的那個加法點（上面那一個）：<Tex>{'w_1'}</Tex> 自己偏高 1 fs（<Tex>{String.raw`\epsilon_1=1`}</Tex>）時，<Tex>{String.raw`J_{11}=-1`}</Tex> 讓 <Tex>{'G_1'}</Tex> 變負，更新後把{' '}
          <Tex>{'w_1'}</Tex> 拉回去——單獨看是對的。再看紅色路徑：<Tex>{'w_2'}</Tex> 偏高 1 fs 時，<Tex>{String.raw`J_{12}=+2`}</Tex> 讓 <Tex>{'G_1'}</Tex> 變正 2，把 <Tex>{'w_1'}</Tex> 往外推，力道是自己修正的兩倍。圖上的「
          <Tex>{String.raw`\times J_{ij}`}</Tex>」就是 <Tex>{String.raw`\mathbf J`}</Tex> 的第 <Tex>{'(i,j)'}</Tex> 格，右邊的「<Tex>{String.raw`\times\mu`}</Tex>」與最右邊那一格就是{' '}
          <Tex>{String.raw`\mathbf w\leftarrow\mathbf w+\mu\mathbf G`}</Tex>（更新後的 <Tex>{String.raw`\mathbf w`}</Tex> 就是下一個 block 的誤差，回到最左邊再走一次）；整張圖寫成式子是 <Tex>{String.raw`\boldsymbol\epsilon_{k+1}=(\mathbf I+0.2\mathbf J)\boldsymbol\epsilon_k`}</Tex>。這裡用{' '}
          <Tex>{String.raw`\boldsymbol\epsilon=\mathbf w-\mathbf w^*`}</Tex> 而不是 <Tex>{String.raw`\boldsymbol\delta`}</Tex>，因為 <Tex>{String.raw`\mathbf J`}</Tex> 是對 <Tex>{String.raw`\mathbf w`}</Tex> 的斜率（<Tex>{String.raw`\mathbf w^*=\mathbf a`}</Tex> 時{' '}
          <Tex>{String.raw`\boldsymbol\epsilon=-\boldsymbol\delta`}</Tex>，兩者差一個負號，pole 不變）。
        </Fig>
        <Fig id="t18-modes">
          先看 ①「只開一個 loop」那一框：把 loop 2 凍結（<Tex>{String.raw`\epsilon_2`}</Tex> 不動）時，loop 1 只看得到 <Tex>{String.raw`J_{11}`}</Tex>，pole 是 <Tex>{String.raw`1+0.2\times(-1)=0.8`}</Tex>。再看 ②「兩個 loop 一起更新」那一框：兩個一起動時要看「方向」。兩個係數往同一邊偏（共模）時，自己的{' '}
          <Tex>{'-1'}</Tex> 與耦合的 <Tex>{'+2'}</Tex> 相加成 <Tex>{'+1'}</Tex>，pole 變成 <Tex>{String.raw`${tn(t.poles[0])}`}</Tex>，誤差每個 block 放大 {n(t.poles[0])} 倍（紅色）；往相反方向偏（差模）時耦合項跟著變號，<Tex>{'-1-2'}</Tex> 成為{' '}
          <Tex>{'-3'}</Tex>，pole 是 <Tex>{String.raw`${tn(t.poles[1])}`}</Tex>。圖上的兩個「斜率」就是 <Tex>{String.raw`\mathbf J`}</Tex> 的 eigenvalue（<Tex>{String.raw`${tn(t.eigJ[0])}`}</Tex> 與{' '}
          <Tex>{String.raw`${tn(t.eigJ[1])}`}</Tex>），三個 pole 就是下面 F-10.11 的 <Tex>{String.raw`\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)=1+0.2\operatorname{eig}(\mathbf J)`}</Tex> 與單一 loop 的{' '}
          <Tex>{String.raw`1+0.2J_{ii}`}</Tex>。
        </Fig>
        <Deriv title="一步一步算 poles" min="beginner">
          <StepDerivation
            steps={[
              {
                tex: String.raw`p_{\text{single},i}=1+0.2\,J_{ii}=1+0.2(-1)=0.8`,
                why: (
                  <>
                    只開第 i 個 loop（另一個凍結）：純量遞迴，<Tex>{String.raw`|0.8|<1`}</Tex> ⇒ 單獨穩定。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I+0.2\mathbf J=\begin{bmatrix}1-0.2&0.4\\0.4&1-0.2\end{bmatrix}=${texMat(t.A, 3)}`,
                why: (
                  <>
                    兩個 loop 一起更新：<Tex>{String.raw`\mathbf A=\mathbf I+\mathbf M\mathbf J`}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\det(\mathbf J-s\mathbf I)=(-1-s)^2-4=0\ \Rightarrow\ -1-s=\pm2\ \Rightarrow\ s=${tn(t.eigJ[0])},\ ${tn(t.eigJ[1])}`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf J`}</Tex> 的 eigenvalue：一正一負 ⇒ <Tex>{String.raw`\mathbf J`}</Tex> 不是負定（共模方向的斜率是正的）。
                  </>
                ),
              },
              {
                tex: String.raw`\operatorname{eig}(\mathbf I+0.2\mathbf J)=1+0.2\times\{${tn(t.eigJ[0])},\,${tn(t.eigJ[1])}\}=\{${tn(t.poles[0])},\ ${tn(t.poles[1])}\}`,
                why: (
                  <>
                    <Tex>{String.raw`\mathbf J\mathbf v=s\mathbf v\Rightarrow(\mathbf I+c\mathbf J)\mathbf v=(1+cs)\mathbf v`}</Tex>：同樣的 eigenvector，eigenvalue 是 <Tex>{'1+cs'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`\mathbf v_{1.2}=\tfrac{1}{\sqrt2}[1,\,1]^T:\ \ \mathbf J\mathbf v=(-1+2)\mathbf v=+\mathbf v`,
                why: '發散方向是共模：兩個參數一起偏同一邊時，「別人的誤差」（+2）壓過「自己的修正」（−1）。',
              },
            ]}
            result={String.raw`\rho(\mathbf I+0.2\mathbf J)=${tn(t.rho)}>1\ \Rightarrow\ \text{共模誤差每個 block 放大 }${tn(t.rho)}\text{ 倍}`}
          />
        </Deriv>
        <TexBlock
          id="F-10.11"
          label={
            <>
              T18：<Tex>{String.raw`\operatorname{eig}(\mathbf J)=+1,\,-3`}</Tex>；單一 loop pole 0.8；一起更新 1.2、0.4
            </>
          }
        >
          {String.raw`\mathbf J=\begin{bmatrix}-1&2\\2&-1\end{bmatrix},\ \mathbf M=0.2\mathbf I\ \Rightarrow\ \boxed{\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)=\{${tn(t.poles[0])},\ ${tn(t.poles[1])}\}}`}
        </TexBlock>
        <Hand id="HC-10.7">
          上面用「對稱矩陣的 eigenvalue 是 <Tex>{String.raw`a\pm b`}</Tex>」的捷徑；這一題改用對任何 2×2 都適用的 trace／determinant 公式。預設數字就是 T18，答案應該是{' '}
          <Tex>{String.raw`${tn(t.poles[0])}`}</Tex> 與 <Tex>{String.raw`${tn(t.poles[1])}`}</Tex>。把 <Tex>{'J_{12}'}</Tex>、<Tex>{'J_{21}'}</Tex> 改成 0.5（弱耦合）或把其中一個改成負的（會出現複數 pole），先用紙筆算，再展開步驟對答案。
        </Hand>
        <ul>
          <li>
            <strong>
              縮小 <Tex>{String.raw`\mu`}</Tex> 沒有用
            </strong>
            ：<Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex> 的共模 pole <Tex>{String.raw`=1+\mu\cdot(+1)>1`}</Tex> 對任何 <Tex>{String.raw`\mu>0`}</Tex> 都發散。這是「mismatched correlator、
            <Tex>{String.raw`-\mathbf J`}</Tex> 非正定」的極性問題，不是 loop gain 太大。
          </li>
          <li>
            <strong>完整反矩陣修正極性</strong>：<Tex>{String.raw`\mathbf M=-\gamma\mathbf J^{-1}`}</Tex> ⇒ poles = {t.fullPoles.map((p) => n(p, 4)).join('、')}（<Tex>{String.raw`\gamma=0.5`}</Tex>）。
          </li>
          <li>
            <strong>Regularized pinv</strong>（<Tex>{String.raw`\gamma=0.5,\ \lambda_{\mathrm{reg}}=0.1`}</Tex>）：<Tex>{String.raw`\sigma(\mathbf J)=\{${tn(t.sv[0])},${tn(t.sv[1])}\}`}</Tex> ⇒{' '}
            <Tex>{String.raw`p=1-0.5\cdot\tfrac{9}{9.1},\ 1-0.5\cdot\tfrac{1}{1.1}=${tn(t.regPoles[1], 4)},\ ${tn(t.regPoles[0], 4)}`}</Tex>。
          </li>
        </ul>
        <Callout kind="danger" title="每個 loop 單獨穩定不代表 MIMO 一起穩定">
          <p>
            分別 bring-up 每個 loop 都 pass，整合後卻發散——這正是 Gallery #12「兩個 GMAC 對角斜率正確，但 off-diagonal 耦合造成發散」。在下方實驗載入{' '}
            <Link to="/ch/10?preset=mimo-gallery12-offdiag-diverge" onClick={scrollToLab}>
              Gallery #12 preset
            </Link>：Case A（diagonal，每個 loop 單獨調成 pole 0.8）與 Case B（scalar{' '}
            <Tex>{String.raw`\mu K_q=0.2`}</Tex>，同一個 <Tex>{String.raw`\mathbf M`}</Tex>）都沿共模方向以 {n(t.rho, 3)} 倍 / block 發散，Case C（完整反矩陣{' '}
            <Tex>{String.raw`-\gamma\mathbf J^{-1}`}</Tex>）所有 pole = 0.5 而收斂。
          </p>
        </Callout>
        <ModeGate min="research">
          <p className="small muted">
            Research：「存在某個正 scalar <Tex>{String.raw`\mu`}</Tex> 使 <Tex>{String.raw`\mathbf I+\mu\mathbf J`}</Tex> 穩定」的充要條件是 <Tex>{String.raw`\mathbf J`}</Tex> 的所有 eigenvalue 實部為負（
            <Tex>{String.raw`\mathbf J`}</Tex> Hurwitz）：因為 <Tex>{String.raw`|1+\mu s|^2=1+2\mu\operatorname{Re}s+\mu^2|s|^2<1`}</Tex> 對小 <Tex>{String.raw`\mu`}</Tex> 成立 ⇔{' '}
            <Tex>{String.raw`\operatorname{Re}s<0`}</Tex>。一個充分條件是負對角優勢（<Tex>{String.raw`J_{ii}<0`}</Tex> 且 <Tex>{String.raw`|J_{ii}|>\sum_{j\ne i}|J_{ij}|`}</Tex>，由
            Gershgorin 圓盤定理）；T18 的 <Tex>{String.raw`|-1|<|2|`}</Tex> 不滿足。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
