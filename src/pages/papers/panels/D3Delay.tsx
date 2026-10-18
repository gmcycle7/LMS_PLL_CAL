import { useMemo } from 'react'
import { Callout, ModeGate, SourceTag, StepDerivation, Tex, ChRef } from '@/components'
import { criticalGain, criticalGainNumeric, criticalOmega, delaySpectralRadius, pmWithDelayDeg } from '../bridge'
import { BridgeCode, ErratumNote, FormulaAnchor, Hand, PrereqPm, PrereqPole, num, r } from '../common'

/** 表格用的固定 loop gain 與「極性正確仍發散」的例子 */
export const D3_G = 0.5
export const D3_EXAMPLE = { g: 0.7, d: 2 } as const

export function d3Table() {
  return Array.from({ length: 7 }, (_, d) => ({
    d,
    gStar: criticalGain(d),
    gNum: criticalGainNumeric(d),
    omega: criticalOmega(d),
    pm: pmWithDelayDeg(D3_G, d),
    radius: delaySpectralRadius(D3_G, d),
  }))
}

/** D3 對應的本站推導：更新延遲下的臨界增益與 PM（Ch08）。 */
export function D3Delay() {
  const rows = useMemo(d3Table, [])
  const ex = useMemo(
    () => ({ radius: delaySpectralRadius(D3_EXAMPLE.g, D3_EXAMPLE.d), gStar: criticalGain(D3_EXAMPLE.d), pm: pmWithDelayDeg(D3_EXAMPLE.g, D3_EXAMPLE.d) }),
    [],
  )
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 本站 <ChRef ch="08">Ch08</ChRef> 的推導：把校正迴路當成開迴路 <Tex>{r`L(z)=g\,z^{-d}/(z-1)`}</Tex>，<Tex>{'d'}</Tex> 是更新延遲（block）。這裡要說明的是：<strong>極性正確只是必要條件</strong>；步子太大，或有延遲，極性正確的迴路照樣發散。這是本站自己的結論，不是對 D3 內容的轉述。
      </p>
      <PrereqPole />
      <PrereqPm />
      <FormulaAnchor id="F-PR.4">
        <StepDerivation
          title={
            <>
              更新延遲 <Tex>{'d'}</Tex> 個 block 時的臨界增益 <Tex>{'g^*(d)'}</Tex>
            </>
          }
          steps={[
            {
              tex: r`\delta_{k+1}=\delta_k-g\,\delta_{k-d}`,
              why: (
                <>
                  第 <Tex>{'k'}</Tex> 個 block 的 GMAC 量到的是 <Tex>{'d'}</Tex> 個 block 前寫入的係數造成的誤差（update latency）；<Tex>{r`g=\mu K_qC`}</Tex>。
                </>
              ),
            },
            {
              tex: r`z^{d+1}-z^{d}+g=0\quad\Longleftrightarrow\quad g=z^{d}(1-z)`,
              why: (
                <>
                  代入 <Tex>{r`\delta_k=z^k`}</Tex> 再同除 <Tex>{r`z^{k-d}`}</Tex>，移項。
                </>
              ),
            },
            {
              tex: r`1-e^{j\omega}=e^{j\omega/2}\big(e^{-j\omega/2}-e^{j\omega/2}\big)=-2j\sin(\omega/2)\,e^{j\omega/2}`,
              why: (
                <>
                  臨界時有 pole 在單位圓上：令 <Tex>{r`z=e^{j\omega}`}</Tex>，提出 <Tex>{r`e^{j\omega/2}`}</Tex>，用{' '}
                  <Tex>{r`e^{j\theta}-e^{-j\theta}=2j\sin\theta`}</Tex>。
                </>
              ),
            },
            {
              tex: r`g=2\sin(\omega/2)\,e^{\,j\left[(d+\frac12)\omega-\frac{\pi}{2}\right]}`,
              why: (
                <>
                  <Tex>{r`-j=e^{-j\pi/2}`}</Tex>，再乘上 <Tex>{r`z^d=e^{jd\omega}`}</Tex>，指數相加。
                </>
              ),
            },
            {
              tex: r`(d+\tfrac12)\,\omega^*=\tfrac{\pi}{2}\quad\Longrightarrow\quad\omega^*=\frac{\pi}{2d+1}`,
              why: (
                <>
                  <Tex>{'g'}</Tex> 是正實數，相位必須為 0；取最小的正 <Tex>{r`\omega`}</Tex>，也就是 <Tex>{'g'}</Tex> 從 0 往上增加時 pole 第一次碰到單位圓。
                </>
              ),
            },
          ]}
          result={r`g^*(d)=2\sin\frac{\pi}{4d+2},\qquad \mathrm{PM}_d(g)=90^\circ-(2d+1)\arcsin\frac g2`}
        />
      </FormulaAnchor>
      <p>
        適用條件：線性平均模型、固定延遲 <Tex>{'d'}</Tex>。PM 公式在 <Tex>{'g=g^*(d)'}</Tex> 時恰為 <Tex>{'0'}</Tex>，兩種推導互相印證。下表的「數值求根」不使用封閉式：從{' '}
        <Tex>{'g=0^+'}</Tex> 往上掃描特徵多項式最大根的模，第一次 <Tex>{r`|z|_{\max}\ge1`}</Tex> 時再二分。
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'d'}</Tex>
              </th>
              <th className="num">
                <Tex>{'g^*(d)'}</Tex> 封閉式
              </th>
              <th className="num">數值求根</th>
              <th className="num">
                <Tex>{r`\omega^*`}</Tex> [rad/block]
              </th>
              <th className="num">
                <Tex>{r`g=${D3_G}`}</Tex> 的 PM
              </th>
              <th className="num">
                <Tex>{r`g=${D3_G}`}</Tex> 的 <Tex>{r`|z|_{\max}`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.d} className={row.radius >= 1 ? 'papers-row-bad' : undefined}>
                <td className="num">{row.d}</td>
                <td className="num mono">{num(row.gStar, 7)}</td>
                <td className="num mono">{num(row.gNum, 7)}</td>
                <td className="num mono">{num(row.omega, 6)}</td>
                <td className="num mono">{num(row.pm, 4)}°</td>
                <td className="num mono">{num(row.radius, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BridgeCode region="delayRecursion" />
      <BridgeCode region="criticalGain" />
      <Callout kind="danger" title="極性完全正確，仍然發散">
        <p>
          取 <Tex>{r`\theta=0^\circ`}</Tex>（<Tex>{'C>0'}</Tex>，「polarity margin」滿分 <Tex>{r`90^\circ`}</Tex>），<Tex>{r`g=${D3_EXAMPLE.g}`}</Tex>、
          <Tex>{r`d=${D3_EXAMPLE.d}`}</Tex>：<Tex>{r`g^*(${D3_EXAMPLE.d})=${num(ex.gStar, 5)}<${D3_EXAMPLE.g}`}</Tex>，最大根的模{' '}
          <Tex>{r`|z|_{\max}=${num(ex.radius, 5)}>1`}</Tex>，PM <Tex>{r`=${num(ex.pm, 4).replace('−', '-')}^\circ`}</Tex>。單頻{' '}
          <Tex>{r`\pm90^\circ`}</Tex> 的判據只回答「方向對不對」，沒有回答「步子多大會翻車」。
        </p>
      </Callout>
      <Hand id="HC-PR.5" />
      <ModeGate min="engineer">
        <Callout kind="info" title="雙迴路也一樣（Ch08，規格 §8.4）">
          主 PLL 與校正迴路耦合時，完整 <Tex>{r`2\times2`}</Tex> 模型的穩定上界恰好是 quasi-static 一階模型的一半，而且與主迴路多快無關；原因是模型裡內建的一個 block 觀測延遲，不只是時間尺度分離不足（
          <ErratumNote id="E19" />
          ）。讀 D3 時，請注意它的「穩定」對應的是哪一個模型。
        </Callout>
      </ModeGate>
    </div>
  )
}
