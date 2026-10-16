import { useMemo } from 'react'
import { Callout, ClaimTag, MetricTable, ModeGate, SourceTag, StepDerivation, Tex, type MetricRow, ChRef } from '@/components'
import { meanPole, meanSquareFactor, meanSquareMuMax } from '@/simulation/models/lms'
import { comparatorKq, eigenExample } from '../bridge'
import { BridgeCode, ErratumNote, FormulaAnchor, PrereqEigen, PrereqExpectation, num, r } from '../common'

/** 規格 §9 / §10.1 的例子（K_q 正規化為 1，勘誤 E05/E08）與 E05 的物理單位對照 */
export const D7_EX = { rho: 0.99, g: 0.5, gamma: 0.5, muFs: 0.5, sigmaV: 100 } as const

export function d7Data() {
  const norm = eigenExample(D7_EX.rho, D7_EX.g, D7_EX.gamma)
  const phys = eigenExample(D7_EX.rho, D7_EX.muFs * comparatorKq(D7_EX.sigmaV), D7_EX.gamma)
  // 純量 Gaussian x：P_x = E[x²] = 1、E[x⁴] = 3
  const meanMax = 2 / 1
  const msMax = meanSquareMuMax(1, 3)
  const atOne = { mean: meanPole(1, 1), ms: meanSquareFactor(1, 1, 3) }
  return { norm, phys, meanMax, msMax, atOne }
}

/** D7 對應的本站推導：mean recursion 的 eigen-mode 分解與 mean / mean-square 的差別（Ch03、Ch09、Ch10）。 */
export function D7Eigen() {
  const d = useMemo(d7Data, [])
  const rows: MetricRow[] = [
    { name: r`$\lambda_{\max}=1+\rho$`, value: d.norm.lmax, claim: 'exact' },
    { name: r`$\lambda_{\min}=1-\rho$`, value: d.norm.lmin, claim: 'exact' },
    { name: r`快模式 pole $1-\mu K_q\lambda_{\max}$`, value: d.norm.pFast, claim: 'exact' },
    { name: r`慢模式 pole $1-\mu K_q\lambda_{\min}$`, value: d.norm.pSlow, claim: 'exact' },
    { name: '慢模式 95% 衰減', value: d.norm.stepsSlow, unit: 'blocks', claim: 'exact', note: 'mean recursion（勘誤 E23）' },
    { name: r`$\mathbf M=\gamma\mathbf R^{-1}$ 後所有 mode 的 pole $1-\gamma$`, value: d.norm.pPrecond, claim: 'exact', note: r`$\gamma=0.5$` },
    { name: r`$\mathbf M=\gamma\mathbf R^{-1}$ 後 95% 衰減`, value: d.norm.stepsPrecond, unit: 'blocks', claim: 'exact' },
    { name: r`$\mathbf M$ 的對角元素`, value: d.norm.mDiag, claim: 'exact', note: '非對角約為負的同量級：弱方向的雜訊會被放大' },
    { name: r`$\mathbf M$ 的非對角元素`, value: d.norm.mOff, claim: 'exact' },
  ]
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 本站 <ChRef ch="03">Ch03</ChRef>、<ChRef ch="09">Ch09</ChRef>、<ChRef ch="10">Ch10</ChRef> 的推導。講義（D7）的 eigenvalue 分析是同一套數學；以下數字由本站程式計算，用來和講義的結論對照，
        不是講義上的數字。
      </p>
      <PrereqExpectation />
      <PrereqEigen />
      <FormulaAnchor id="F-PR.11">
        <StepDerivation
          title={
            <>
              多參數 mean recursion 與 eigen-mode（<Tex>{r`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>，<ErratumNote id="E32" />）
            </>
          }
          steps={[
            {
              tex: r`e_k=\mathbf u_k^T\boldsymbol\delta_k+v_k,\qquad \boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mu\,\mathbf u_k e_k=(\mathbf I-\mu\,\mathbf u_k\mathbf u_k^T)\boldsymbol\delta_k-\mu\,\mathbf u_kv_k`,
              why: (
                <>
                  代入 <Tex>{r`\mathbf w_{k+1}=\mathbf w_k+\mu\,\mathbf u_ke_k`}</Tex>，兩邊用 <Tex>{r`\mathbf a`}</Tex> 去減。
                </>
              ),
            },
            {
              tex: r`E[\boldsymbol\delta_{k+1}]=(\mathbf I-\mu\mathbf R)\,E[\boldsymbol\delta_k],\qquad \mathbf R=E[\mathbf u\mathbf u^T]`,
              why: (
                <>
                  取期望值：<Tex>{r`E[\mathbf u v]=0`}</Tex>，並假設 <Tex>{r`\mathbf u_k`}</Tex> 與 <Tex>{r`\boldsymbol\delta_k`}</Tex> 獨立（iid
                  純量時自動成立、是精確式； 有時間相關的 regressor 時是近似，
                  <ErratumNote id="E38" />
                  ）。
                </>
              ),
            },
            {
              tex: r`\mathbf R=\mathbf Q\boldsymbol\Lambda\mathbf Q^T,\quad \mathbf c_k=\mathbf Q^TE[\boldsymbol\delta_k]\ \Longrightarrow\ c_{i,k+1}=(1-\mu\lambda_i)\,c_{i,k}`,
              why: '對稱矩陣可以用正交的特徵向量對角化；每個方向變成一條獨立的等比數列。',
            },
            {
              tex: r`|1-\mu\lambda_i|<1\ \ \forall i\quad\Longleftrightarrow\quad 0<\mu<\frac{2}{\lambda_{\max}}`,
              why: (
                <>
                  最嚴格的是最大的 <Tex>{r`\lambda`}</Tex>；步長不太大（<Tex>{r`\mu\le2/(\lambda_{\max}+\lambda_{\min})`}</Tex>）時最慢的是最小的{' '}
                  <Tex>{r`\lambda`}</Tex>，更大時最大的 <Tex>{r`\lambda`}</Tex> 那個 mode 會因為過衝（pole 是負的，而且 <Tex>{r`|1-\mu\lambda_{\max}|>|1-\mu\lambda_{\min}|`}</Tex>
                  ）而變成最慢的：兩者的比值（eigenvalue spread）決定「穩定」與「夠快」能不能同時做到。下面的 <Tex>{r`p_{\mathrm{slow}}`}</Tex> 指絕對值最大的那個 pole。
                </>
              ),
            },
          ]}
          result={r`p_i=1-\mu\lambda_i,\qquad N_{95\%}=\left\lceil\frac{\ln 0.05}{\ln|p_{\mathrm{slow}}|}\right\rceil`}
        />
      </FormulaAnchor>
      <p>
        規格 §9 的例子：<Tex>{r`\rho=${D7_EX.rho}`}</Tex>、正規化 loop gain <Tex>{r`\mu K_q=${D7_EX.g}`}</Tex>（<Tex>{'K_q'}</Tex> 正規化為 1）、preconditioner{' '}
        <Tex>{r`\mathbf M=\gamma\mathbf R^{-1}`}</Tex>、<Tex>{r`\gamma=${D7_EX.gamma}`}</Tex>：
      </p>
      <MetricTable rows={rows} caption="由 bridge.ts 的 eigenExample() 計算；測試對照 golden/vectors/T11.json" />
      <BridgeCode region="eigenExample" />
      <Callout kind="warn" title={r`單位陷阱：$K_q$ 是否已正規化`}>
        <p>
          上表的 {D7_EX.g} 是 <Tex>{r`\mu K_q`}</Tex>（無因次）。若把同樣的 <Tex>{r`\mu=${D7_EX.muFs}\ \mathrm{fs}`}</Tex> 配上物理的{' '}
          <Tex>{r`K_q=${num(comparatorKq(D7_EX.sigmaV), 6)}\ \mathrm{fs^{-1}}`}</Tex>（<Tex>{r`\sigma_v=${D7_EX.sigmaV}\ \mathrm{fs}`}</Tex>），慢模式 pole 變成{' '}
          <Tex>{r`${num(d.phys.pSlow, 9)}`}</Tex>，95% 衰減要 <Tex>{r`${d.phys.stepsSlow}`}</Tex> 個 block（
          <ErratumNote id="E05" /> <ErratumNote id="E08" />
          ）。 讀講義時也要確認它的 <Tex>{r`\mu`}</Tex> 是否已吸收了 regressor 的尺度。
        </p>
      </Callout>
      <h4 className="papers-subhead">Mean 收斂不等於 Mean-square 收斂</h4>
      <p>
        純量、iid Gaussian <Tex>{'x'}</Tex>（<Tex>{r`E[x^2]=1`}</Tex>、<Tex>{r`E[x^4]=3`}</Tex>），無外加雜訊：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th>種類</th>
              <th>遞迴</th>
              <th className="num">
                <Tex>{r`\mu`}</Tex> 上限
              </th>
              <th className="num">
                <Tex>{r`\mu=1`}</Tex> 時每步乘上
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>mean</td>
              <td>
                <Tex>{r`E[\delta_{n+1}]=(1-\mu E[x^2])\,E[\delta_n]`}</Tex>
              </td>
              <td className="num mono">{num(d.meanMax, 4)}</td>
              <td className="num mono">{num(d.atOne.mean, 4)}</td>
            </tr>
            <tr>
              <td>mean-square</td>
              <td>
                <Tex>{r`E[\delta_{n+1}^2]=(1-2\mu E[x^2]+\mu^2E[x^4])\,E[\delta_n^2]`}</Tex>
              </td>
              <td className="num mono">{num(d.msMax, 4)}</td>
              <td className="num mono">{num(d.atOne.ms, 4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <ClaimTag kind="exact" />
        （iid 純量 <Tex>{'x'}</Tex>）。<Tex>{r`\mu=1`}</Tex> 時平均誤差每步乘 {num(d.atOne.mean, 4)}（一步歸零），但均方誤差每步乘 {num(d.atOne.ms, 4)}：只看
        mean 的「收斂」會誤判。數值由 <code>src/simulation/models/lms.ts</code> 的 <code>meanPole</code>、<code>meanSquareFactor</code>、
        <code>meanSquareMuMax</code> 計算（與 <ChRef ch="03">Ch03</ChRef> 同一份程式）。
      </p>
      <ModeGate min="research">
        <Callout kind="info" title="Research：第三種收斂">
          單一樣本路徑的 almost-sure 收斂由 <Tex>{r`E[\ln|1-\mu x^2|]<0`}</Tex> 決定，界限比 mean-square 寬得多；在兩者之間，<Tex>{r`E[\delta_n^2]`}</Tex>{' '}
          發散但幾乎每條路徑收斂 （<ErratumNote id="E14" />
          ，數值見 <ChRef ch="03">Ch03</ChRef>）。講義或論文只寫「收斂」時，要確認是哪一種。
        </Callout>
      </ModeGate>
    </div>
  )
}
