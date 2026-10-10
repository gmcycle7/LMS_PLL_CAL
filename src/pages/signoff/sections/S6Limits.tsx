import { useMemo, type ReactNode } from 'react'
import { Section, Tex, TexBlock } from '@/components'
import { eigSym } from '@/simulation/core'
import { LIMITATIONS } from '../data'
import { efbSequence, errorPower, failureUpperBound, inlMseFixedPoint, inlSignFixedPoint, kq, sCurve } from '../judges'
import { ErratumTag, RichText, SiteLink, nf, tx } from '../shared'

/** 每一項限制的「即時計算」小例子（沒有任何手寫結果）。 */
function useIllustrations(): Record<number, ReactNode> {
  return useMemo(() => {
    const rows = [0.25, 0.5, 1, 2, 3].map((r) => ({ r, ...sCurve(r) }))
    const x5 = [-2, -1, 0, 1, 2]
    const wMse = inlMseFixedPoint(x5, 1, 0.1)
    const wSign = inlSignFixedPoint(x5, 1, 0.1)
    const ev = eigSym([
      [1, 0.99],
      [0.99, 1],
    ]).values
    const pus = [30, 100, 1000].map((n) => ({ n, p: failureUpperBound(0, n) }))
    const g = 10 * kq(100)
    const efb = efbSequence(162, 5, 5, 'round').y
    return {
      3: (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'s/\\sigma_v'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\mathrm{erf}\\big(s/(\\sqrt2\\sigma_v)\\big)'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'K_qs'}</Tex>
                </th>
                <th className="num">線性化誤差</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.r}>
                  <td className="num">{r.r}</td>
                  <td className="num">{nf(r.exact, 5)}</td>
                  <td className="num">{nf(r.linear, 5)}</td>
                  <td className="num">{nf((100 * (r.linear - r.exact)) / r.exact, 3)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      6: (
        <p>
          <Tex>{'x\\in\\{-2,\\dots,2\\}'}</Tex> 等機率、<Tex>{'a=1'}</Tex>、<Tex>{'c_3=0.1'}</Tex>：MSE-LMS 固定點 <Tex>{tx(wMse, 6)}</Tex>，無雜訊 Sign-Error 固定點 <Tex>{tx(wSign, 6)}</Tex>（<Tex>{'|x|'}</Tex> 加權中位數）。
          同一個 INL、兩種演算法、兩個答案。<ErratumTag id="E01" />
        </p>
      ),
      7: (
        <p>
          <Tex>{'\\mathbf R=\\begin{bmatrix}1&0.99\\\\0.99&1\\end{bmatrix}'}</Tex>：<Tex>{`\\lambda=${tx(ev[0], 5)},\\ ${tx(ev[1], 5)}`}</Tex>，PE 成立（<Tex>{'\\lambda_{\\min}>0'}</Tex>），
          但完整 preconditioning 時慢模式的雜訊是快模式的 <Tex>{tx(ev[0] / ev[1], 5)}</Tex> 倍。
        </p>
      ),
      8: (
        <p>
          0 次失效、95% 信心：
          {pus.map((u, i) => (
            <span key={u.n}>
              {i > 0 ? '；' : ''}
              <Tex>{`n=${u.n}\\Rightarrow p\\le${tx(u.p, 4)}`}</Tex>
            </span>
          ))}
          。再多 seeds 也只是把上界壓低，永遠不會變成「證明」。
        </p>
      ),
      9: (
        <p>
          同一個「<Tex>{'\\mu=10'}</Tex>」：average GMAC、<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex> 時 <Tex>{`g=${tx(g, 5)}`}</Tex>；若 RTL 是 sum 模式（<Tex>{'N=4096'}</Tex>）則 <Tex>{`g=${tx(4096 * g, 5)}`}</Tex>。數字一樣、意義差 4096 倍。
        </p>
      ),
      10: (
        <p>
          常數 32.4 經一階 EFB：輸出 <Tex>{`[${efb.join(',')}]`}</Tex>、週期 5，誤差功率 <Tex>{`${tx(errorPower(efb, 32.4), 5)}\\,\\mathrm{LSB}^2`}</Tex>，白雜訊 NTF 模型預測 <Tex>{`${tx(2 / 12, 4)}\\,\\mathrm{LSB}^2`}</Tex>，而且能量集中在兩條譜線，不是平坦的 noise floor。
        </p>
      ),
    }
  }, [])
}

/** §10：附錄 B 十項限制 */
export function S6Limits() {
  const ill = useIllustrations()
  return (
    <Section kind="assumptions" level={2} title="10. 附錄 B：數學與工程上的十項關鍵限制" id="so-limits">
      <p>
        這十項是 sign-off 報告的「假設與限制」章節範本：每一項寫出它在數學上是什麼、在簽核時要怎麼處理、本站哪裡有對應的實驗。
        報告中若某一項沒有處理，就應該在對應的 Matrix 項目寫明「豁免」與理由。
      </p>
      <div className="so-limits">
        {LIMITATIONS.map((l) => (
          <div className="so-limit" key={l.no} data-limit={l.no}>
            <h3>
              <span className="so-limit-no">{l.no}.</span>
              <RichText text={l.title} />
            </h3>
            <p>
              <RichText text={l.body} />
            </p>
            <TexBlock>{l.math}</TexBlock>
            {ill[l.no]}
            <div className="so-limit-action">
              <strong>Sign-off 時：</strong>
              <RichText text={l.action} />
            </div>
            <div className="so-links small">
              {l.links.map((k) => (
                <SiteLink key={k.to + k.label} link={k} />
              ))}
              {l.errata?.map((e) => <ErratumTag key={e} id={e} />)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
