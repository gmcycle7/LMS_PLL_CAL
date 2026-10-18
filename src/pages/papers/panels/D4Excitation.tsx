import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, SourceTag, StepDerivation, Tex, ChRef } from '@/components'
import { eigenExample, weakExcitation } from '../bridge'
import { BridgeCode, ErratumNote, FormulaAnchor, Num, PrereqEigen, num, r } from '../common'

/** illustrative：與 T13 相同的 comparator / GMAC，加上一個固定的 code-correlated 干擾 B */
export const D4_PARAMS = { B: 0.05, mu: 10, sigmaV: 100, N: 4096 } as const
export const D4_C_LIST = [1, 0.3, 0.1, 0.03, 0.01] as const
export const D4_RHO_LIST = [0, 0.5, 0.9, 0.99, 0.999, 1] as const
/** PE 表的正規化 loop gain μK_q（K_q 正規化為 1，勘誤 E05） */
export const D4_G = 0.5

/** D4 對應的本站推導：激勵（C、λ_min）變弱時 bias、速度、雜訊一起變差（Ch09、Ch11 §11.4）。 */
export function D4Excitation() {
  const weak = useMemo(() => D4_C_LIST.map((C) => weakExcitation({ ...D4_PARAMS, C })), [])
  const pe = useMemo(() => D4_RHO_LIST.map((rho) => ({ rho, ...eigenExample(rho, D4_G, 0.5) })), [])
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 規格書把 D4 列為 DTC code randomization 與 near-integer 校正的參考。本站<strong>沒有</strong>轉述 D4
        的做法；這裡只推導本站自己的結論：為什麼「激勵」（excitation）變弱時，校正會在 bias、速度、雜訊三方面一起變差（<ChRef ch="11">Ch11</ChRef> §11.4、<ChRef ch="09">Ch09</ChRef>）。
      </p>
      <FormulaAnchor id="F-PR.10">
        <StepDerivation
          title={
            <>
              有效相關 <Tex>{'C'}</Tex> 變小（例如 near-integer FCW）時的三個 <Tex>{'1/C'}</Tex> 定律
            </>
          }
          steps={[
            {
              tex: r`E[G_k]\approx K_q\big[C\,(a-w_k)+B\big]`,
              why: (
                <>
                  小訊號線性化；<Tex>{'B'}</Tex> 是與 code 相關的干擾（offset、INL 等）經 GMAC 平均後剩下的部分（規格 §11.4 的記號，
                  <ErratumNote id="E12" />
                  ）。
                </>
              ),
            },
            {
              tex: r`E[G]=0\quad\Longrightarrow\quad w^*=a+\frac{B}{C}`,
              why: (
                <>
                  平均更新量為 0 的點就是固定點；偏差 <Tex>{'B/C'}</Tex> 在 <Tex>{r`C\to0`}</Tex> 時被放大。這是上一步線性化的結果：<Tex>{'B/C'}</Tex> 大到讓 comparator 飽和（把{' '}
                  <Tex>{'w^*'}</Tex> 代回去後，comparator 前的確定性殘差超過約 <Tex>{r`0.3\,\sigma_v`}</Tex>）時，<Tex>{'a+B/C'}</Tex> 只是線性外推，不再是 Sign-LMS 的固定點（<ChRef ch="11">Ch11</ChRef> §11.4）。
                </>
              ),
            },
            {
              tex: r`p=1-\mu K_qC,\qquad \tau=-\frac{1}{\ln p}\approx\frac{1}{\mu K_qC}`,
              why: (
                <>
                  一階泰勒 <Tex>{r`\ln(1-g)\approx-g`}</Tex>（<Tex>{r`g\ll1`}</Tex>）：時間常數也與 <Tex>{'C'}</Tex> 成反比。
                </>
              ),
            },
            {
              tex: r`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu^2\sigma_\eta^2}{g(2-g)}\approx\frac{\mu\,\sigma_\eta^2}{2K_qC}`,
              why: (
                <>
                  <Tex>{r`1-p^2=(1-p)(1+p)=g(2-g)`}</Tex>；<Tex>{r`g\ll1`}</Tex> 時 <Tex>{r`2-g\approx2`}</Tex>（假設 code 功率不變、
                  <Tex>{r`\sigma_\eta^2\approx1/N`}</Tex>）。
                </>
              ),
            },
          ]}
          result={r`\text{bias}\propto\frac1C,\qquad \tau\propto\frac1C,\qquad \sigma_w^2\propto\frac1C`}
        />
      </FormulaAnchor>
      <p>
        以 <Tex>{r`B=${D4_PARAMS.B}\ \mathrm{fs}`}</Tex>、<Tex>{r`\mu=${D4_PARAMS.mu}\ \mathrm{fs}`}</Tex>、
        <Tex>{r`\sigma_v=${D4_PARAMS.sigmaV}\ \mathrm{fs}`}</Tex>、<Tex>{r`N=${D4_PARAMS.N}`}</Tex> 計算（
        <ClaimTag kind="approx" />
        ：小訊號、iid block 雜訊）：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'C'}</Tex>
              </th>
              <th className="num">
                bias <Tex>{'B/C'}</Tex> [fs]
              </th>
              <th className="num">
                <Tex>{r`g=\mu K_qC`}</Tex>
              </th>
              <th className="num">
                <Tex>{r`\tau`}</Tex> [blocks]
              </th>
              <th className="num">95% 衰減 [blocks]</th>
              <th className="num">
                <Tex>{r`\sigma_w`}</Tex> [fs]
              </th>
            </tr>
          </thead>
          <tbody>
            {weak.map((w) => (
              <tr key={w.C}>
                <td className="num">{w.C}</td>
                <td className="num mono">{num(w.bias, 4)}</td>
                <td className="num mono">{num(w.g, 4)}</td>
                <td className="num mono">{num(w.tau, 4)}</td>
                <td className="num mono">
                  <Num x={w.steps5} digits={6} />
                </td>
                <td className="num mono">{num(w.sigmaW, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BridgeCode region="weakExcitation" />
      <PrereqEigen />
      <h4 className="papers-subhead">多參數：code 之間越像，最慢的方向越慢（persistent excitation）</h4>
      <p>
        兩個參數的 regressor 相關係數為 <Tex>{r`\rho`}</Tex> 時，<Tex>{r`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex>，
        <Tex>{r`\lambda_{\min}=1-|\rho|`}</Tex>。以正規化 loop gain <Tex>{r`\mu K_q=${D4_G}`}</Tex>（<Tex>{'K_q'}</Tex> 正規化為 1，
        <ErratumNote id="E05" />
        ）計算慢模式：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{r`\rho`}</Tex>
              </th>
              <th className="num">
                <Tex>{r`\lambda_{\min}`}</Tex>
              </th>
              <th className="num">慢模式 pole</th>
              <th className="num">95% 衰減 [blocks]</th>
            </tr>
          </thead>
          <tbody>
            {pe.map((row) => (
              <tr key={row.rho} className={row.lmin === 0 ? 'papers-row-bad' : undefined}>
                <td className="num">{row.rho}</td>
                <td className="num mono">{num(row.lmin, 4)}</td>
                <td className="num mono">{num(row.pSlow, 6)}</td>
                <td className="num mono">
                  {row.lmin === 0 ? (
                    <>
                      <Tex>{r`\infty`}</Tex>（不可辨識）
                    </>
                  ) : (
                    num(row.stepsSlow, 6)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <ClaimTag kind="exact" />
        （mean recursion，
        <ErratumNote id="E23" />
        ）。<Tex>{r`\rho=1`}</Tex> 時 <Tex>{r`\lambda_{\min}=0`}</Tex>：那個方向的誤差完全不會被 GMAC 看到。
      </p>
      <ModeGate min="engineer">
        <Callout kind="info" title="連到晶片設計（研究假說）">
          <p>
            <ClaimTag kind="research" /> 讓 code 更「隨機」（降低不同參數 regressor 之間的相關、避開 <Tex>{'C'}</Tex> 很小的 FCW）在上面的模型裡會同時改善
            bias、速度與雜訊；但真實晶片中 code randomization 也會改變 DTC 的使用範圍、spur 與 jitter。是否值得，要用 behavioral simulation
            與量測決定（<ChRef ch="09">Ch09</ChRef>、<ChRef ch="11">Ch11</ChRef>、Lab）。D4 的具體做法與量測結果請直接讀原文。
          </p>
        </Callout>
      </ModeGate>
    </div>
  )
}
