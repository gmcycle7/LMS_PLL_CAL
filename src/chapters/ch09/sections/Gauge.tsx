import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Prereq, Section, SourceTag, StepDerivation, TexBlock } from '@/components'
import { gaugeDriftStd, gaugeNullVector, gaugeRegressorsRaw } from '@/simulation/models/pe'
import { DerivBox, Erratum, HandCalcBox, formulaTex, m, num, texNum } from '../shared'

/** 「先算一次」的例子：θ = (b, a₀…a₃) 與 gauge 平移量 c（輸入是例子；輸出由程式計算） */
const HAND_THETA = [1, 2, 3, 4, 5]
const HAND_C = -1

/** §9.2 GOS / PHOS 的 common-mode gauge freedom（含勘誤 E04 的 DC-null 修正）。 */
export function Gauge() {
  const hand = useMemo(() => {
    const P = HAND_THETA.length - 1
    const n = gaugeNullVector(P)
    const shifted = HAND_THETA.map((t, i) => t + HAND_C * n[i]) // θ' = θ + c·n
    const X = gaugeRegressorsRaw([0, 1, 2, 3], P) // 四個 phase 各選一次：x̃ = (1, one-hot)
    const y = (th: number[], t: number) => X.reduce((acc, col, i) => acc + col[t] * th[i], 0)
    const rows = [0, 1, 2, 3].map((ph) => ({ ph, y0: y(HAND_THETA, ph), y1: y(shifted, ph) }))
    return { shifted, rows }
  }, [])
  // w_b 漂移的數字例（與 preset「u-domain ＋ raw x̃ GMAC」相同的設定）；type-I 取 r = 0.95 ⇒ S = 1/(1 − r)
  const drift = useMemo(() => {
    const base = { mu: 0.2, sigmaV: 0.1, N: 16, blocks: 1000, P: 4 }
    const r = 0.95
    const S1 = 1 / (1 - r)
    return { ...base, r, S1, type2: gaugeDriftStd({ ...base, stepSum: 0 }), type1: gaugeDriftStd({ ...base, stepSum: S1 }) }
  }, [])
  return (
    <Section kind="formula" title="§9.2 GOS / PHOS 的 Common-Mode Gauge Freedom" level={2} id="ch09-gauge">
      <Callout kind="info" title="直覺：站在同一個看不見的箱子上">
        四個人（四個 phase）都站在同一個看不見高度的箱子（global offset {m`b`}）上，你只量得到「人＋箱子」的總高度。
        箱子墊高 {m`c`}、每個人「自己的高度」都少算 {m`c`}，所有量測值完全一樣。<strong>不是量得不夠多，是這個組合根本不在資料裡。</strong>
      </Callout>

      <h3>先算一次：兩組不同的參數，四個 phase 的輸出一模一樣</h3>
      <p>
        取 {m`(b,a_0,a_1,a_2,a_3)=(${HAND_THETA.join(',')})`}，再取另一組 {m`(b',a_0',\dots,a_3')=(${hand.shifted.join(',')})`}
        （{m`b`} {HAND_C < 0 ? '少' : '多'} {m`${Math.abs(HAND_C)}`}、每個 {m`a_i`} {HAND_C < 0 ? '多' : '少'} {m`${Math.abs(HAND_C)}`}）。選到第 {m`i`} 相時輸出是 {m`y=b+a_i`}（由 <code>gaugeRegressorsRaw</code> 產生 one-hot regressor 後計算）：
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">選到的 phase</th>
              {hand.rows.map((r) => (
                <th key={r.ph}>{m`i=${r.ph}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ch09-left">{m`y=b+a_i`}（第一組）</td>
              {hand.rows.map((r) => (
                <td key={r.ph}>{num(r.y0)}</td>
              ))}
            </tr>
            <tr>
              <td className="ch09-left">{m`y'=b'+a_i'`}（第二組）</td>
              {hand.rows.map((r) => (
                <td key={r.ph}>{num(r.y1)}</td>
              ))}
            </tr>
            <tr>
              <td className="ch09-left">{m`y-y'`}</td>
              {hand.rows.map((r) => (
                <td key={r.ph} className={r.y0 === r.y1 ? 'ch09-ok' : 'ch09-bad'}>
                  {num(r.y0 - r.y1)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        四種可能的輸入全部試過了，兩組參數<strong>完全分不出來</strong>；再量一百萬筆也還是這四種輸入。這裡的平移量是 {m`c=${texNum(HAND_C)}`}，
        其實任何 {m`c`} 都一樣——下面證明。 <ClaimTag kind="exact" /> <SourceTag />
      </p>

      <p>
        多相位 PMUX 每次只選一個 phase（one-hot）：{m`x_i[n]\in\{0,1\}`}、{m`\sum_ix_i[n]=1`}。第 {m`i`} 相有自己的 phase offset {m`a_i`}（PHOS），
        另外還有所有相位共用的 global offset {m`b`}：
      </p>
      <TexBlock>{String.raw`y[n]=b+\sum_{i=0}^{3}a_i\,x_i[n],\qquad \sum_{i}x_i[n]=1`}</TexBlock>
      <StepDerivation
        title={<>證明 {m`(b+c,\ a_i-c)`} 給出完全相同的輸出</>}
        steps={[
          { tex: String.raw`y'[n]=(b+c)+\sum_i(a_i-c)\,x_i[n]`, why: <>把 {m`b`} 加 {m`c`}、每個 {m`a_i`} 減 {m`c`}。</> },
          { tex: String.raw`=b+c+\sum_ia_ix_i[n]-c\sum_ix_i[n]`, why: '展開求和（求和是線性的）。' },
          { tex: String.raw`=b+c+\sum_ia_ix_i[n]-c\cdot1`, why: <>one-hot：每個 {m`n`} 恰好一個 {m`x_i=1`}，所以 {m`\sum_ix_i[n]=1`}。</> },
          { tex: String.raw`=y[n]`, why: <>{m`c`} 抵消——對每一個 {m`n`} 都成立，與樣本數無關。</> },
        ]}
      />
      <p>
        向量寫法：{m`\tilde{\mathbf x}[n]=(1,x_0,x_1,x_2,x_3)`}、{m`\boldsymbol\theta=(b,a_0,\dots,a_3)`}，{m`y=\tilde{\mathbf x}^T\boldsymbol\theta`}。定義
        {m`\mathbf n=(1,-1,-1,-1,-1)`}，則 {m`\tilde{\mathbf x}[n]^T\mathbf n=1-\sum_ix_i[n]=0`}：
      </p>
      <TexBlock id="F-09.13">{formulaTex('F-09.13')}</TexBlock>
      <p>
        於是 {m`\mathbf R_x\mathbf n=E[\tilde{\mathbf x}\,\tilde{\mathbf x}^T\mathbf n]=\mathbf 0`}：{m`\mathbf n`} 是 eigenvalue 0 的 eigenvector。用前面平均遞迴的語言：
        {m`\lambda_{\min}=0`}，該方向的 pole {m`=1`}，LMS 的更新永遠 {m`\propto\tilde{\mathbf x}`}（與 {m`\mathbf n`} 垂直），所以 {m`\mathbf n^T\mathbf w_k`} 永遠等於初值。
        <ClaimTag kind="exact" />
      </p>
      <HandCalcBox id="HC-09.7">
        換成你自己的 {m`b`}、{m`a_0,\dots,a_3`} 與任意的 {m`c`}（只需要加減法），親手確認四相的輸出一個都沒變；再看「只動 {m`b`}」為什麼不算 gauge。
      </HandCalcBox>

      <DerivBox title={<>iid 均勻 one-hot 時 {m`\mathbf R_x`} 的 eigenvalues</>}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\mathbf R_x=E[\tilde{\mathbf x}\tilde{\mathbf x}^T]=\begin{bmatrix}1&\tfrac14\mathbf 1^T\\\tfrac14\mathbf 1&\tfrac14\mathbf I\end{bmatrix}`,
              why: <>{m`E[1\cdot1]=1`}；{m`E[x_i]=P(\text{第 }i\text{ 相})=\tfrac14`}；one-hot {m`\Rightarrow x_ix_j=0\ (i\ne j)`}、{m`x_i^2=x_i`}。</>,
            },
            {
              tex: String.raw`\mathbf R_x\begin{bmatrix}0\\\mathbf z\end{bmatrix}=\begin{bmatrix}\tfrac14\mathbf 1^T\mathbf z\\\tfrac14\mathbf z\end{bmatrix}=\tfrac14\begin{bmatrix}0\\\mathbf z\end{bmatrix}\quad(\textstyle\sum_iz_i=0)`,
              why: <>取 {m`b`} 分量為 0、{m`a`} 部分 {m`\mathbf z`} 總和為 0 的向量（3 維子空間）：{m`\lambda=\tfrac14`}，重數 3。</>,
            },
            {
              tex: String.raw`\mathbf R_x\begin{bmatrix}s\\t\mathbf 1\end{bmatrix}=\begin{bmatrix}s+t\\\tfrac{s+t}{4}\mathbf 1\end{bmatrix}=\lambda\begin{bmatrix}s\\t\mathbf 1\end{bmatrix}`,
              why: <>剩下的 2 維子空間：{m`b`} 分量 {m`s`}、{m`a_i`} 的共模 {m`t`}。</>,
            },
            { tex: String.raw`s+t=0\ \Rightarrow\ \lambda=0,\ (s,t)=(1,-1)\ \Rightarrow\ \mathbf n`, why: <>第一種解：就是 gauge 方向 {m`\mathbf n`}。</> },
            { tex: String.raw`s+t\ne0:\ s=\tfrac{s+t}{\lambda},\ t=\tfrac{s+t}{4\lambda}\ \Rightarrow\ 1=\tfrac1\lambda+\tfrac1{4\lambda}\ \Rightarrow\ \lambda=\tfrac54`, why: <>由第一列 {m`s=(s+t)/\lambda`}、第二列 {m`t=(s+t)/(4\lambda)`}，兩式相加再除以 {m`s+t\ne0`}。</> },
          ]}
          result={String.raw`\lambda(\mathbf R_x)=\{\tfrac54,\ \tfrac14,\ \tfrac14,\ \tfrac14,\ 0\}`}
        />
      </DerivBox>
      <TexBlock id="F-09.14">{formulaTex('F-09.14')}</TexBlock>

      <h3>
        經過 PLL 之後：{m`H_{\mathrm{PD}}(1)=0`} 讓 {m`b`}「完全」不可觀察（<Erratum id="E04" />）
      </h3>
      <Prereq title={String.raw`卷積、Z transform 與 DC gain $H(1)$`}>
        <p>
          離散時間濾波器的輸出是輸入與 impulse response 的 <strong>卷積</strong>（convolution）：{m`u[n]=(h*x)[n]=\sum_{m\ge0}h[m]\,x[n-m]`}——
          現在的輸出是「過去輸入的加權和」。<strong>Z transform</strong> 把 impulse response 打包成一個函數 {m`H(z)=\sum_{m\ge0}h[m]z^{-m}`}。
          代入 {m`z=1`} 得到 {m`H(1)=\sum_mh[m]`}：輸入是常數 1 時，穩態輸出就是 {m`\sum_mh[m]\cdot1`}，所以 {m`H(1)`} 叫 <strong>DC gain</strong>。
        </p>
        <StepDerivation
          title={<>例：first-order high-pass {m`H(z)=\frac{1-z^{-1}}{1-r z^{-1}}`}（pole {m`r`}，{m`0\le r<1`}）</>}
          steps={[
            { tex: String.raw`H(1)=\frac{1-1}{1-r}=0`, why: <>直接代入 {m`z=1`}（{m`r\ne1`}）。</> },
            {
              tex: String.raw`h[0]=1,\qquad h[m]=(r-1)\,r^{m-1}\ (m\ge1)`,
              why: <>長除法（或差分方程 {m`u[n]=r\,u[n-1]+x[n]-x[n-1]`} 輸入 impulse）。</>,
            },
            {
              tex: String.raw`\sum_mh[m]=1+(r-1)\sum_{m\ge1}r^{m-1}=1+\frac{r-1}{1-r}=0`,
              why: <>等比級數 {m`\sum_{m\ge1}r^{m-1}=1/(1-r)`}（{m`|r|<1`}）。</>,
            },
          ]}
        />
        <p>
          PLL 的 {m`H_{\mathrm{PD}}=1/(1+L)`}：type-I 的 {m`L`} 有一個 {m`1/(1-z^{-1})`}、type-II 有 {m`1/(1-z^{-1})^2`}，在 {m`z=1`} 為無限大，所以
          {m`H_{\mathrm{PD}}(1)=0`}。上面的 high-pass 正是 type-I DPLL（{m`L=Kz^{-1}/(1-z^{-1})`}，{m`r=1-K`}）的 {m`1/(1+L)`}。
        </p>
      </Prereq>
      <p>
        PD／BBPD 看到的不是 {m`\tilde{\mathbf x}`}，而是經 PLL error transfer {m`H_{\mathrm{PD}}=1/(1+L)`} 之後的 {m`\tilde{\mathbf u}=h*\tilde{\mathbf x}`}。
        Type-I / Type-II PLL 的 {m`L(z)`} 至少有一個在 {m`z=1`} 的積分器（DCO/VCO 相位累加），所以 {m`L(1)=\infty`}、{m`H_{\mathrm{PD}}(1)=0`}：
        主迴路會把任何 DC 誤差吸收掉。
      </p>
      <DerivBox title="推導：兩個零 eigenvalue">
        <StepDerivation
          steps={[
            { tex: String.raw`\tilde u_b[n]=(h*1)[n]=\sum_{m=0}^{n}h[m]`, why: <>{m`b`} 的 regressor 是常數 1；卷積 = 從 0 到 {m`n`} 的部分和（step response）。</> },
            { tex: String.raw`\lim_{n\to\infty}\tilde u_b[n]=\sum_{m=0}^{\infty}h[m]=H_{\mathrm{PD}}(z{=}1)=0`, why: <>DC gain 的定義：{m`H(z)=\sum_mh[m]z^{-m}`} 在 {m`z=1`}。</> },
            { tex: String.raw`\sum_i\tilde u_i[n]=\Big(h*\sum_ix_i\Big)[n]=(h*1)[n]=\tilde u_b[n]\ \to\ 0`, why: <>卷積是線性的，且 {m`\sum_ix_i=1`}。</> },
            { tex: String.raw`\tilde{\mathbf u}^T\mathbf e_b\to0,\qquad \tilde{\mathbf u}^T(0,1,1,1,1)\to0`, why: <>兩個方向在穩態都「看不到」：{m`b`} 本身、{m`a_i`} 的共模。</> },
            { tex: String.raw`\mathbf R_u\,\mathbf e_b=\mathbf 0,\qquad \mathbf R_u\,(0,1,1,1,1)^T=\mathbf 0`, why: <>因此 {m`\mathbf R_u`} 有 2 維 null space（{m`\mathbf n=\mathbf e_b-(0,1,1,1,1)`} 只是它們的組合）。</> },
          ]}
        />
        <ModeGate min="engineer">
          <p>iid one-hot 時可以寫出完整的 {m`\mathbf R_u`}（{m`\mathbf m=E[\tilde{\mathbf x}]`}、{m`\|h\|^2=\sum h[n]^2`}）：</p>
          <StepDerivation
            steps={[
              { tex: String.raw`E[\tilde{\mathbf u}\tilde{\mathbf u}^T]=\sum_{m}\sum_{l}h[m]h[l]\,E\big[\tilde{\mathbf x}[n-m]\tilde{\mathbf x}^T[n-l]\big]`, why: <>代入 {m`\tilde{\mathbf u}[n]=\sum_mh[m]\,\tilde{\mathbf x}[n-m]`}。</> },
              { tex: String.raw`E[\tilde{\mathbf x}[n-m]\tilde{\mathbf x}^T[n-l]]=\begin{cases}\mathbf R_x&m=l\\\mathbf m\mathbf m^T&m\ne l\end{cases}`, why: <>時間上 iid：不同時刻獨立 {m`\Rightarrow`} 期望值相乘，{m`\mathbf m=E[\tilde{\mathbf x}]`}。</> },
              { tex: String.raw`=\|h\|^2\mathbf R_x+\big(H(1)^2-\|h\|^2\big)\mathbf m\mathbf m^T`, why: <>{m`\sum_{m\ne l}h[m]h[l]=\big(\sum h\big)^2-\sum h^2=H(1)^2-\|h\|^2`}。</> },
              { tex: String.raw`=\|h\|^2\,\mathrm{Cov}(\tilde{\mathbf x})+H(1)^2\,\mathbf m\mathbf m^T`, why: <>{m`\mathrm{Cov}(\tilde{\mathbf x})=\mathbf R_x-\mathbf m\mathbf m^T`}。</> },
            ]}
          />
        </ModeGate>
      </DerivBox>
      <TexBlock id="F-09.15">{formulaTex('F-09.15')}</TexBlock>
      <p>
        {m`\mathrm{Cov}(\tilde{\mathbf x})`} 的 {m`b`} 列與 {m`b`} 欄全為 0（常數沒有變異），{m`a_i`} 區塊是 {m`\tfrac14\mathbf I-\tfrac1{16}\mathbf 1\mathbf 1^T`}——
        共模方向 {m`\tfrac14-\tfrac4{16}=0`}，其餘三個方向 {m`\tfrac14`}。所以 u-domain 只剩 3 個可辨識的組合：<strong>相位之間的差</strong> {m`a_i-a_j`}。
        <ClaimTag kind="exact" />
      </p>

      <Callout kind="warn" title={<>規格 §9.2 末段的修正版（<Erratum id="E04" />）</>}>
        <p>
          規格原文說「PLL DC Error Suppression 可能使 Common-Mode <strong>更難</strong>觀察」。本站採用修正：
        </p>
        <p>
          若 GOS/PHOS 是經 {m`H_{\mathrm{PD}}(z{=}1)=0`} 的 error transfer（Type-I/II PLL，DC error 被抑制）觀測，global offset {m`b`} 在穩態
          <strong>完全不可觀察</strong>（{m`u_b\to0`}），且 {m`\sum_iu_i=0`}。有效 {m`\mathbf R_u`} 與 {m`\mathbf C=E[\tilde{\mathbf x}\tilde{\mathbf u}^T]`}
          的 null space 從 1 維（{m`(c,-c,-c,-c,-c)`}）變成 <strong>2 維</strong>（{m`b`} 方向、{m`a_i`} common mode）。固定 reference phase 或強制
          {m`\sum_ia_i=0`} 只處理 {m`a_i`} 的 gauge，{m`b`} 仍無法辨識；若仍讓 {m`w_b`} 積分，在 comparator offset 或 noise 下會漂移甚至飽和。
          {m`b`} 必須靠獨立觀測路徑（PLL 外的 TDC／參考比較或 open-loop 量測），或乾脆不在此路徑更新（常數 {m`b`} 在 output 只是固定相位）。
        </p>
      </Callout>

      <h3>
        如果還是讓 {m`w_b`} 積分，它會漂多遠？
      </h3>
      <p>
        硬體最常見的寫法是 GMAC 直接用原始 regressor（{m`b`} 的 regressor 是常數 1）。主迴路把 DC 吃掉之後，{m`e_{\mathrm{PD}}`} 裡與 {m`b`} 有關的部分是 0，
        GMAC 累加到的只剩雜訊：
      </p>
      <DerivBox title={<>推導 {m`w_b`} 的 random walk</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`G_{b,k}=\frac1N\sum_{n\in k}e_{\mathrm{PD}}[n]\cdot1=\frac1N\sum_{n\in k}v[n]=:\eta_k`, why: <>穩態下 {m`e_{\mathrm{PD}}`} 的平均不含 {m`b-w_b`}（{m`H_{\mathrm{PD}}(1)=0`}），block 平均只剩雜訊。</> },
            { tex: String.raw`\mathrm{Var}(\eta_k)=\frac{\sigma_v^2}{N}`, why: <>{m`N`} 筆獨立雜訊的平均（§9.1 的先備知識框：平均 {m`N`} 筆 {m`\Rightarrow`} 變異數除以 {m`N`}）。</> },
            { tex: String.raw`w_{b,K}=w_{b,0}+\mu\sum_{k=0}^{K-1}\eta_k`, why: <>更新式 {m`w_{b,k+1}=w_{b,k}+\mu G_{b,k}`} 連加 {m`K`} 次：沒有任何一項把 {m`w_b`} 拉回真值。</> },
            { tex: String.raw`\mathrm{Var}(w_{b,K}-w_{b,0})=\mu^2K\frac{\sigma_v^2}{N}`, why: <>各 block 的雜訊獨立 {m`\Rightarrow`} 變異數相加（random walk）。</> },
          ]}
          result={String.raw`\mathrm{std}(w_{b,K}-w_{b,0})\approx\mu\sigma_v\sqrt{K/N}\ \propto\sqrt K\quad\text{（沒有上限）}`}
        />
        <ModeGate min="engineer">
          <p>
            更精細一點：令 {m`\bar e_k`} 為第 {m`k`} 個 block 內 {m`e_{\mathrm{PD}}`} 的平均。更新 {m`\Delta w_b=\mu\bar e_k`}，而每個 {m`w_i`} 的 regressor 只有
            {m`\tfrac14`} 的時間是 1，所以 {m`\Delta w_i\approx\mu\bar e_k/4`}。DTC 端誤差 {m`d=\tilde{\mathbf x}^T(\boldsymbol\theta-\mathbf w)`} 的平均因此改變
            {m`-\Delta w_b-\tfrac14\sum_i\Delta w_i=-\tfrac54\mu\bar e_k`}（四相；{m`\tfrac54=1+\tfrac14`}）。這個小 step 經 {m`H_{\mathrm{PD}}`} 後，在之後各 block 的
            {m`e_{\mathrm{PD}}`} 留下總和為 {m`S=\sum_ns[n]`}（{m`s[n]`} 是 step response）的尾巴，等於對「步進」做負回授：
            {m`\sum_k\bar e_k=\sum_k\eta_k\big/\big(1+\tfrac54\mu S/N\big)`}。Type-II 的 {m`H_{\mathrm{PD}}`} 在 {m`z=1`} 有雙重零點 {m`\Rightarrow S=0`}；
            type-I（pole {m`r`}）{m`\Rightarrow S=1/(1-r)`}。
          </p>
        </ModeGate>
      </DerivBox>
      <TexBlock id="F-09.19">{formulaTex('F-09.19')}</TexBlock>
      <p>
        例（由 <code>gaugeDriftStd</code> 計算）：{m`\mu=${texNum(drift.mu)}`}、{m`\sigma_v=${texNum(drift.sigmaV)}\,\mathrm{fs}`}、{m`N=${drift.N}`}、{m`K=${drift.blocks}`} blocks：
        type-II 為 {m`${texNum(drift.type2.std, 4)}\,\mathrm{fs}`}；type-I（{m`r=${texNum(drift.r)}`}，{m`S=${texNum(drift.S1, 3)}`}）為 {m`${texNum(drift.type1.std, 4)}\,\mathrm{fs}`}
        （阻尼 {m`${texNum(drift.type1.damping, 3)}`}）。兩者都隨 {m`\sqrt K`} 無上限地成長——跑得越久漂得越遠，直到暫存器飽和。
        把 GMAC regressor 改成 filtered {m`\tilde{\mathbf u}`}（{m`\tilde u_b\to0`}）則 {m`w_b`} 直接凍結。 <ClaimTag kind="approx" />（長時間、{m`KN\gg`} PLL settling；實驗室與測試以多個 seed 的 Monte Carlo 比對）
      </p>

      <h3>處理方式比較：raw-x vs. u-domain</h3>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">做法</th>
              <th className="ch09-left">raw-x（{m`\mathbf u=\tilde{\mathbf x}`}，DC 不被消除）</th>
              <th className="ch09-left">u-domain（{m`H_{\mathrm{PD}}(1)=0`}）</th>
              <th className="ch09-left">硬體代價／注意</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ch09-left">不處理（{m`\mathbf M=\mu\mathbf I`} 直接更新 5 個參數）</td>
              <td className="ch09-left">收斂到「某一組」等價解；null 分量 {m`\mathbf n^T\mathbf w`} 凍結在初值，{m`b`} 與 {m`a_i`} 的分配取決於初值</td>
              <td className="ch09-left">{m`b`} 與 {m`a_i`} 共模都沒有恢復力：filtered-x 時凍結；raw {m`\tilde{\mathbf x}`} GMAC 時在雜訊下 random walk（{m`\mathrm{std}\approx\mu\sigma_v\sqrt{K/N}`}，{m`K`} = blocks；type-I 迴路會把步進阻尼一些，但同樣沒有恢復力）</td>
              <td className="ch09-left">最便宜；但跨 PVT／重新上電後的分配不可預期</td>
            </tr>
            <tr>
              <td className="ch09-left">固定 reference phase：{m`a_0:=0`}</td>
              <td className="ch09-left">可辨識（4 個參數，{m`\lambda_{\min}>0`}）</td>
              <td className="ch09-left">仍剩 {m`b`} 一個零 eigenvalue</td>
              <td className="ch09-left">少一個暫存器；reference 相位本身的誤差被併入 {m`b`}</td>
            </tr>
            <tr>
              <td className="ch09-left">強制 {m`\sum_ia_i=0`}</td>
              <td className="ch09-left">可辨識</td>
              <td className="ch09-left">仍剩 {m`b`} 一個零 eigenvalue</td>
              <td className="ch09-left">每次更新後要減去平均（或重新參數化）</td>
            </tr>
            <tr>
              <td className="ch09-left">此路徑不更新 {m`b`}（{m`b`} 併入 {m`a_i`}）</td>
              <td className="ch09-left">可辨識（{m`a_i`} 吸收 {m`b`}）</td>
              <td className="ch09-left">仍剩 {m`a_i`} 共模一個零 eigenvalue {m`\rightarrow`} 需再固定 {m`a_0`} 或 {m`\sum_ia_i=0`}</td>
              <td className="ch09-left">常數 {m`b`} 在 output 只是固定相位，常常不需要校正</td>
            </tr>
            <tr>
              <td className="ch09-left">獨立觀測 {m`b`}（PLL 外 TDC／參考比較／open-loop）</td>
              <td className="ch09-left">—</td>
              <td className="ch09-left">唯一能真正得到 {m`b`} 的方法</td>
              <td className="ch09-left">需要額外量測路徑或校正時段</td>
            </tr>
            <tr>
              <td className="ch09-left">Leakage／regularization 拉向先驗值</td>
              <td className="ch09-left">null 分量被拉到先驗值（有 bias）</td>
              <td className="ch09-left">防止 {m`w_b`} 漂移、飽和</td>
              <td className="ch09-left">犧牲一點精度換有界；leak 量要大於雜訊驅動的漂移</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ch09-note">
        表中「可辨識／零 eigenvalue 個數」由下方 Gauge 實驗的約束表即時計算（最小 eigenvalue 與 null 方向數）。
      </p>
    </Section>
  )
}
