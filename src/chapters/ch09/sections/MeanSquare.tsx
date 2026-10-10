import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Prereq, Section, StepDerivation, TexBlock } from '@/components'
import { corr2, eigenModes, meanSquareRadius } from '@/simulation/models/pe'
import { DerivBox, Erratum, HandCalcBox, formulaTex, m, num, texNum } from '../shared'

/** 勘誤 E23：598 是 mean recursion 的結論；mean-square 可能完全不同。 */
export function MeanSquare() {
  const table = useMemo(
    () =>
      [1, 2, 4, 16, 256].map((N) => ({
        N,
        gauss: meanSquareRadius('gaussian', 0.99, 0.5, N),
        pm1: meanSquareRadius('pm1', 0.99, 0.5, N),
      })),
    [],
  )
  const zs = [0, 0.5, 1, 1.5, 2, 3]
  const meanRadius = useMemo(() => Math.max(...eigenModes(corr2(0.99), 0.5).poles.map(Math.abs)), [])
  const signN1 = useMemo(() => meanSquareRadius('gaussian', 0.99, 0.5, 1, 'sign'), [])

  return (
    <Section kind="assumptions" title="注意：598 是「平均」的敘述，不是每一條軌跡（mean vs mean-square）" level={2} id="ch09-ms">
      <Callout kind="warn" title={<>T11 的標籤是 [精確｜mean recursion]（<Erratum id="E23" />）</>}>
        「慢 pole 0.995、約 598 blocks」描述的是 <strong>許多次實驗的平均</strong> {m`E[\boldsymbol\delta_k]`}。GMAC 的 {m`N`} 足夠大時，單一軌跡也大致照這個走；
        但若 conventional（linear detector）LMS 以 per-sample（{m`N=1`}）更新、regressor 為 Gaussian，{m`g=0.5`} 在 <strong>mean-square</strong>
        意義下是發散的（{m`\rho_{\mathrm{MS}}\approx${texNum(table[0].gauss, 3)}`}）；{m`\pm1`} sparse-flip code 的個別軌跡則呈<strong>階梯式</strong>歸零，只有 ensemble 平均依
        {m`0.995^k`} 衰減。
      </Callout>

      <h3>先算一次：{m`N=1`} 時共模分量每一步乘上什麼？</h3>
      <p>
        {m`\rho\to1`} 時 {m`\mathbf u\approx(z,z)`}、{m`z\sim\mathcal N(0,1)`}。一步更新 {m`\boldsymbol\delta\leftarrow(\mathbf I-0.5\,\mathbf u\mathbf u^T)\boldsymbol\delta`}
        在共模方向上乘的是 {m`1-0.5\cdot\|\mathbf u\|^2=1-0.5\cdot2z^2=1-z^2`}——一個<strong>隨機</strong>的倍數：
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th>{m`z`}</th>
              {zs.map((z) => (
                <th key={z}>{num(z)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{m`1-z^2`}</td>
              {zs.map((z) => (
                <td key={z}>{num(1 - z * z)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <StepDerivation
        steps={[
          { tex: String.raw`E[1-z^2]=1-E[z^2]=1-1=0`, why: <>平均倍數為 0：平均意義下共模一步就消失（對應 {m`p_{\text{fast}}\approx0.005`}）。</> },
          { tex: String.raw`E[(1-z^2)^2]=1-2E[z^2]+E[z^4]`, why: '展開平方，期望值是線性的。' },
          { tex: String.raw`=1-2\cdot1+3=2`, why: <>Gaussian 的 {m`E[z^2]=1`}、{m`E[z^4]=3`}（下方先備知識框用分部積分推導）。</> },
        ]}
        result={String.raw`E[(1-z^2)^2]=2>1`}
      />
      <p>
        平均倍數是 0，但<strong>平方的平均</strong>是 2：偶爾抽到 {m`|z|=3`}，誤差被乘上 {m`1-9=-8`}。這些少數大樣本讓 {m`E\|\boldsymbol\delta_k\|^2`}
        每步約翻倍，而「大部分軌跡」其實在收斂（中位數變小）。均方與平均的結論完全不同。 <ClaimTag kind="exact" />
      </p>
      <Prereq title={String.raw`Gaussian 的四階動差 $E[z^4]=3$（分部積分）`}>
        <StepDerivation
          steps={[
            { tex: String.raw`\varphi(z)=\tfrac1{\sqrt{2\pi}}e^{-z^2/2},\qquad \varphi'(z)=-z\,\varphi(z)`, why: <>標準高斯 {m`\mathcal N(0,1)`} 的 pdf（鐘形曲線，平均 0、變異數 1）及其導數（連鎖律）。</> },
            { tex: String.raw`E[z^4]=\int_{-\infty}^{\infty}z^3\cdot z\varphi(z)\,dz=-\int z^3\,\varphi'(z)\,dz`, why: <>把 {m`z^4`} 拆成 {m`z^3\cdot z`}，並用 {m`z\varphi=-\varphi'`}。</> },
            { tex: String.raw`=-\big[z^3\varphi(z)\big]_{-\infty}^{\infty}+\int3z^2\varphi(z)\,dz`, why: <>分部積分 {m`\int fg'=[fg]-\int f'g`}，取 {m`f=z^3`}、{m`g=\varphi`}。</> },
            { tex: String.raw`=0+3E[z^2]=3`, why: <>{m`e^{-z^2/2}`} 比任何多項式衰減得快，邊界項為 0；{m`E[z^2]=1`}。</> },
          ]}
        />
        <p>
          向量版本（Isserlis / Wick 定理）：零均值高斯 {m`E[u_au_bu_cu_d]=R_{ab}R_{cd}+R_{ac}R_{bd}+R_{ad}R_{bc}`}，由此得
          {m`E[\mathbf u\mathbf u^T\mathbf P\mathbf u\mathbf u^T]=2\mathbf R\mathbf P\mathbf R+\mathbf R\,\mathrm{tr}(\mathbf R\mathbf P)`}（對稱 {m`\mathbf P`}）。
        </p>
      </Prereq>

      <h3>一般式：block 長度 {m`N`} 的 mean-square 遞迴</h3>
      <DerivBox title={<>推導 {m`\mathbf P_{k+1}`}（linear detector、無雜訊、{m`\mathbf u`} 跨 sample 獨立）</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\boldsymbol\delta_{k+1}=(\mathbf I-g\hat{\mathbf R}_k)\boldsymbol\delta_k,\qquad \hat{\mathbf R}_k=\frac1N\sum_{n\in k}\mathbf u[n]\mathbf u^T[n]`, why: <>linear 時 {m`\mathbf G_k=\hat{\mathbf R}_k\boldsymbol\delta_k`}（無雜訊）。</> },
            { tex: String.raw`\mathbf P_{k+1}=E\big[(\mathbf I-g\hat{\mathbf R}_k)\,\boldsymbol\delta_k\boldsymbol\delta_k^T\,(\mathbf I-g\hat{\mathbf R}_k)\big]`, why: <>定義 {m`\mathbf P=E[\boldsymbol\delta\boldsymbol\delta^T]`}，代入並注意 {m`\hat{\mathbf R}`} 對稱。</> },
            { tex: String.raw`=\mathbf P_k-g(\mathbf R\mathbf P_k+\mathbf P_k\mathbf R)+g^2E[\hat{\mathbf R}_k\mathbf P_k\hat{\mathbf R}_k]`, why: <>{m`\boldsymbol\delta_k`} 與本 block 的 {m`\hat{\mathbf R}_k`} 獨立，可先對 {m`\hat{\mathbf R}`} 取期望；{m`E[\hat{\mathbf R}]=\mathbf R`}。</> },
            {
              tex: String.raw`E[\hat{\mathbf R}\mathbf P\hat{\mathbf R}]=\frac1{N^2}\Big[\sum_{n}E[\mathbf u_n\mathbf u_n^T\mathbf P\mathbf u_n\mathbf u_n^T]+\sum_{n\ne m}\mathbf R\mathbf P\mathbf R\Big]`,
              why: <>展開雙重和：{m`n=m`} 是四階動差，{m`n\ne m`} 時兩個 sample 獨立。</>,
            },
            { tex: String.raw`=\Big(1-\frac1N\Big)\mathbf R\mathbf P\mathbf R+\frac1N\,\mathcal K(\mathbf P),\qquad \mathcal K(\mathbf P)=E[\mathbf u\mathbf u^T\mathbf P\mathbf u\mathbf u^T]`, why: <>{m`N`} 項對角、{m`N(N-1)`} 項非對角，除以 {m`N^2`}。</> },
            { tex: String.raw`\mathcal K_{\text{Gauss}}(\mathbf P)=2\mathbf R\mathbf P\mathbf R+\mathbf R\,\mathrm{tr}(\mathbf R\mathbf P)`, why: 'Isserlis 定理（上方先備知識框）。' },
          ]}
        />
      </DerivBox>
      <TexBlock id="F-09.8">{formulaTex('F-09.8')}</TexBlock>
      <p>
        在 eigen 座標中，{m`d_i=E[c_i^2]`} 滿足 {m`\mathbf d_{k+1}=\mathbf A\mathbf d_k`}：
      </p>
      <TexBlock>{String.raw`A_{ii}=1-2g\lambda_i+g^2\lambda_i^2\Big(1+\frac2N\Big),\qquad A_{ij}=\frac{g^2\lambda_i\lambda_j}{N}\ (i\ne j),\qquad \rho_{\mathrm{MS}}=\max|\mathrm{eig}(\mathbf A)|`}</TexBlock>
      <p>
        {m`N\to\infty`} 時 {m`A_{ii}\to(1-g\lambda_i)^2=p_i^2`}：block 平均越長，均方行為越接近「平均行為的平方」。下表由 <code>meanSquareRadius()</code>
        （{m`3\times3`} 均方算子的 spectral radius）計算，{m`\rho=0.99`}、{m`g=0.5`}：
      </p>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th>GMAC {m`N`}</th>
              <th>{m`\rho_{\mathrm{MS}}`}（Gaussian）</th>
              <th>{m`\rho_{\mathrm{MS}}`}（{m`\pm1`} sparse-flip）</th>
              <th>mean 半徑 {m`\max|p_i|`}</th>
              <th>{m`\max|p_i|^2`}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.N}>
                <td>{r.N}</td>
                <td className={r.gauss >= 1 ? 'ch09-bad' : undefined}>
                  {num(r.gauss, 6)}
                  {r.gauss >= 1 ? '（發散）' : ''}
                </td>
                <td>{num(r.pm1, 6)}</td>
                <td>{num(meanRadius, 6)}</td>
                <td>{num(meanRadius * meanRadius, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        變異數不可能是負的：{m`\mathrm{Var}(c)=E[c^2]-(E[c])^2\ge0`}（Jensen 不等式的特例），所以
        {m`E[c_{i,k}^2]\ge(E[c_{i,k}])^2=p_i^{2k}c_{i,0}^2`}，也就是 {m`\rho_{\mathrm{MS}}\ge\max|p_i|^2`}——均方永遠不會比「平均的平方」收斂得快；
        Gaussian {m`N=1`} 時差距大到變成發散。
        <ClaimTag kind="exact" />
      </p>

      <h3>{m`\pm1`} code：階梯式歸零</h3>
      <p>
        {m`\pm1`} sparse-flip code（{m`u_2=s\,u_1`}，{m`P(s=-1)=(1-\rho)/2=0.005`}）每個 sample 的 {m`\mathbf u\mathbf u^T`} 只有兩種：
        {m`\begin{bmatrix}1&1\\1&1\end{bmatrix}`} 或 {m`\begin{bmatrix}1&-1\\-1&1\end{bmatrix}`}，{m`\mathbf I-0.5\,\mathbf u\mathbf u^T`} 剛好是把共模或差模
        <strong>整個投影掉</strong>（{m`\boldsymbol\Pi_\pm=\tfrac12\begin{bmatrix}1&\pm1\\\pm1&1\end{bmatrix}`} 是投影矩陣：{m`\boldsymbol\Pi^2=\boldsymbol\Pi`}，
        它把向量在 {m`(1,\pm1)`} 方向的分量原封不動留下、垂直的分量變成 0；{m`\mathbf I-\boldsymbol\Pi_\pm`} 則反過來）。所以 {m`N=1`} 時差模座標要嘛還是初值、
        要嘛（第一次 flip 之後）精確為 0：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`c_{2,k}=c_{2,0}\cdot\mathbf 1\{\text{前 }k\text{ 個 sample 都沒有 flip}\}`, why: <>{m`g=0.5`} 時只有 flip（{m`s=-1`}）的 sample 會把差模一次消掉，其餘 sample 完全不動它。</> },
          { tex: String.raw`P(\text{沒有 flip})=0.995^k`, why: <>每個 sample 獨立，{m`P(s=+1)=0.995`}，機率相乘。</> },
          { tex: String.raw`E[c_{2,k}]=0.995^k\,c_{2,0},\qquad E[c_{2,k}^2]=0.995^k\,c_{2,0}^2`, why: <>指示函數的平方仍是自己 {m`\Rightarrow`} 均方也是 {m`0.995^k`}（不是 {m`0.995^{2k}`}）。</> },
        ]}
      />
      <p>
        平均照 {m`0.995^k`} 走，但<strong>沒有任何一條軌跡</strong>長得像平均：每一條都是「平台 → 突然歸零」。實驗室的「{m`\pm1`} code」preset 可以直接看到。
        <ClaimTag kind="exact" />
      </p>

      <h3>1-bit comparator（Sign-LMS）為什麼沒有這種乘法式發散？</h3>
      <p>
        上面的 {m`\mathcal K(\mathbf P)`} 來自 linear detector 的 {m`t=e=\mathbf u^T\boldsymbol\delta+v`}：同一個 sample 的 {m`\mathbf u`} 出現四次。
        1-bit 時 {m`t=q=\mathrm{sign}(e)`}，而 {m`q^2\equiv1`}，同一 sample 的二次項變成與 {m`\boldsymbol\delta`} 無關的常數：
      </p>
      <DerivBox title={<>推導 1-bit 的均方遞迴（小訊號線性化）</>}>
        <StepDerivation
          steps={[
            { tex: String.raw`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mu\mathbf G_k,\qquad \mathbf G_k=\frac1N\sum_{n\in k}q[n]\,\mathbf u[n]`, why: <>更新式；{m`q=\mathrm{sign}(e)\in\{\pm1\}`}。</> },
            {
              tex: String.raw`\mathbf P_{k+1}=\mathbf P_k-\mu\big(E[\mathbf G_k\boldsymbol\delta_k^T]+E[\boldsymbol\delta_k\mathbf G_k^T]\big)+\mu^2E[\mathbf G_k\mathbf G_k^T]`,
              why: <>展開 {m`(\boldsymbol\delta-\mu\mathbf G)(\boldsymbol\delta-\mu\mathbf G)^T`} 再取期望值。</>,
            },
            {
              tex: String.raw`E[\mathbf G\mathbf G^T\mid\boldsymbol\delta]=\frac1{N^2}\Big[\sum_nE[q_n^2\,\mathbf u_n\mathbf u_n^T]+\sum_{n\ne m}E[q_n\mathbf u_n]\,E[q_m\mathbf u_m]^T\Big]`,
              why: <>雙重和拆成 {m`n=m`} 與 {m`n\ne m`}；不同 sample 在給定 {m`\boldsymbol\delta`} 時獨立。</>,
            },
            {
              tex: String.raw`=\frac1N\mathbf R+\Big(1-\frac1N\Big)E[q\mathbf u]\,E[q\mathbf u]^T`,
              why: <>{m`q^2=1\ \Rightarrow\ E[q^2\mathbf u\mathbf u^T]=E[\mathbf u\mathbf u^T]=\mathbf R`}：<strong>沒有四階動差</strong>。</>,
            },
            {
              tex: String.raw`E[q\mathbf u\mid\boldsymbol\delta]\approx K_q\mathbf R\boldsymbol\delta\ \Rightarrow\ \mathbf P_{k+1}\approx\mathbf P_k-g(\mathbf R\mathbf P_k+\mathbf P_k\mathbf R)+g^2\Big(1-\frac1N\Big)\mathbf R\mathbf P_k\mathbf R+\frac{\mu^2}{N}\mathbf R`,
              why: <>小訊號 {m`K_q`}（F-09.16 的極限），{m`g=\mu K_q`}；{m`\mu^2\mathbf R/N`} 是 1-bit 量化本身造成的雜訊注入。</>,
            },
          ]}
        />
      </DerivBox>
      <TexBlock id="F-09.18">{formulaTex('F-09.18')}</TexBlock>
      <p>
        在 eigen 座標中齊次部分是對角的：{m`E[c_i^2]`} 每步乘上 {m`(1-g\lambda_i)^2-g^2\lambda_i^2/N`}。{m`\rho=0.99`}、{m`g=0.5`}、{m`N=1`} 時為
        {m`|1-2g\lambda_i|`}，最大 {m`${texNum(signN1, 6)}<1`}——同樣的參數，linear 是 {m`${texNum(table[0].gauss, 5)}`}（發散）。直覺：sign-LMS 每步增量最多 {m`\mu\|\mathbf u\|`}，
        不會被「某個大樣本 {m`\times`} 目前誤差」乘上去。代價是 {m`\mu^2\mathbf R/N`} 的雜訊地板與小訊號假設（{m`|\mathbf u^T\boldsymbol\delta|\ll\sigma_v`}）。 <ClaimTag kind="approx" />
      </p>
      <HandCalcBox id="HC-09.5">
        上面那張表的每一格都可以手算：選一組 {m`\rho`}、{m`g`}、{m`N`}，算出 {m`2\times2`} 的 {m`\mathbf A`} 與它最大的 eigenvalue
        {m`\rho_{\mathrm{MS}}`}，再和 1-bit 的倍數比較。先用範例的 {m`N=1`}（發散），再把 {m`N`} 改成 2，看它怎麼掉回 1 以下。
      </HandCalcBox>

      <ModeGate min="engineer">
        <Callout kind="info" title="工程上的讀法">
          <ul>
            <li>
              規格 §9 / T11 的 0.995 與 598 是 <strong>mean recursion</strong> 的結論（[精確｜mean recursion]）。
            </li>
            <li>要把它當成「單一晶片的收斂時間」，需要 GMAC block 夠長（本例 {m`N\ge2`} 時 {m`\rho_{\mathrm{MS}}<1`}，{m`N\ge16`} 時已接近 {m`0.995^2`}），
              或用 Monte Carlo 的分位數（10/50/90%）來描述。</li>
            <li>有雜訊時 {m`\mathbf P_k`} 還會多一個注入項（linear：{m`\mu^2\sigma_v^2\mathbf R/N`}），收斂到非零的穩態——那是第 12 章的主題。</li>
          </ul>
        </Callout>
      </ModeGate>
    </Section>
  )
}
