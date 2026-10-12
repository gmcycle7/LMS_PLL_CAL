import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { HandCalc, Quiz, Recap, StepDerivation, Tex } from '@/components'
import { handcalc } from '../handcalcs'
import { DEFAULT_PARAMS, blocksTo95, evaluateThesis, polarityOf } from '../thesisModel'
import { Rich } from '../ui'

const f = (x: number, d = 5) => Number(x.toPrecision(d)).toString()

/** 思考題（附解析）與「本頁必記」 */
export const Wrapup = memo(function Wrapup() {
  const nums = useMemo(() => {
    const base = evaluateThesis(DEFAULT_PARAMS)
    // 思考題 2：φ = 120°、Ω = π/6，掃 D = 0..12
    const sweep = Array.from({ length: 13 }, (_, D) => ({ D, ...polarityOf({ Px: 0.5, Hmag: 1, phiDeg: 120, omega: Math.PI / 6, D }) }))
    const firstPositive = sweep.find((s) => s.C > 0)
    const best = sweep.reduce((a, b) => (b.C > a.C ? b : a))
    // 思考題 3：ρ = 0.99，強方向 gλ̃_max = 1
    const rho = 0.99
    const g = 1 / (1 + rho)
    const weakPole = 1 - g * (1 - rho)
    return { base, sweep, firstPositive, best, rho, g, weakPole, weakBlocks: blocksTo95(weakPole) }
  }, [])
  const { base, sweep, firstPositive, best } = nums

  return (
    <section id="dash-recap" aria-labelledby="dash-recap-h">
      <h2 id="dash-recap-h" className="dash-h2">
        綜合手算、思考題與本頁必記
      </h2>

      <div className="dash-handcalc" data-handcalc="HC-DB.6">
        <p className="dash-handcalc-lead">
          <strong>綜合手算：</strong>把前面幾題串起來——給一組晶片數字，用紙筆和計算機把六個條件的關鍵數字一次算完，再和上面的「動手體檢」對答案。 需要更多練習題，到{' '}
          <Link to="/workbook">手算練習簿</Link>。
        </p>
        <HandCalc def={handcalc('HC-DB.6')} />
      </div>

      <Quiz
        title="思考題 1"
        question={
          <Rich text="校正跑完，GMAC 的平均輸出已經是 $E[G]=0$。這代表 DTC gain 已經等於真值 $a$ 嗎？" />
        }
        options={[
          { label: <Rich text="是：GMAC 歸零就是 $w=a$" /> },
          { label: <Rich text="不一定：停在 $w^*=a+B/C$，只要有與 code 相關的干擾 $B\ne0$ 就有 bias" />, correct: true },
          { label: <Rich text="只有 $N$ 很大時才是" /> },
        ]}
        answer={
          <>
            <StepDerivation
              steps={[
                { tex: String.raw`E[G]=K_q\,(C\,\delta^*+B)=0`, why: <Rich text="線性化 GMAC 的平均（推導 1），停下來代表平均為 0。" /> },
                { tex: String.raw`\delta^*=-B/C\;\Rightarrow\;w^*=a+B/C`, why: <Rich text="解出固定點；$N$ 只影響雜訊，不影響 $B/C$。" /> },
              ]}
            />
            <p>
              預設參數（<Tex>{`B=${DEFAULT_PARAMS.B}\\,\\mathrm{fs},\\ C=${f(base.polarity.C)}`}</Tex>）下 <Tex>{`\\Delta w=${f(base.deltaW)}\\,\\mathrm{fs}`}</Tex>。
              這就是條件 5 必須另外檢查的原因。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 2"
        question={
          <Rich text="單頻 code，error path 在 code 頻率的相位 $\phi=120^\circ$、$\Omega=\pi/6$。最少要加幾個 sample 的 GMAC code delay $D$，才能讓 $C_D>0$？" />
        }
        options={[2, 4, 6, 8].map((D) => ({ label: <Tex>{`D=${D}`}</Tex>, correct: D === firstPositive?.D }))}
        answer={
          <>
            <p>
              <Tex>{'\\theta=\\phi+\\Omega D=120^\\circ+30^\\circ D'}</Tex>，需要 <Tex>{'\\cos\\theta>0'}</Tex>。<Tex>{'D=5'}</Tex> 時 <Tex>{'\\theta=270^\\circ'}</Tex>，
              <Tex>{'C_D=0'}</Tex>（沒有恢復力，不算）；所以最少 <Tex>{`D=${firstPositive?.D ?? '—'}`}</Tex>（<Tex>{`\\theta\\equiv${f(firstPositive?.thetaDeg ?? NaN)}^\\circ`}</Tex>）。
              最佳是 <Tex>{`D=${best.D}`}</Tex>（<Tex>{`\\theta\\equiv${f(best.thetaDeg)}^\\circ`}</Tex>，<Tex>{`C_D=${f(best.C)}`}</Tex> 最大）。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <Tex>{'D'}</Tex>
                    </th>
                    {sweep.map((s) => (
                      <th key={s.D} className="num">
                        {s.D}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Tex>{'C_D\\ (A=1)'}</Tex>
                    </td>
                    {sweep.map((s) => (
                      <td key={s.D} className="num">
                        {f(s.C, 3)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">
              只對這一個頻率成立；換一個 <Tex>{'\\Omega'}</Tex>，同一個 <Tex>{'D'}</Tex> 可能又翻號——這是 Ch07 要 filtered-x 的原因。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 3（計算題）"
        question={
          <Rich text="兩參數校正、$\rho=0.99$、一般 LMS（$\mathbf M=\mu\mathbf I$）。把 $\mu$ 調到強方向剛好 $g\tilde\lambda_{\max}=1$（一步到位、PM $=60^\circ$）。弱方向的 pole 是多少？衰減 95% 要幾個 block？" />
        }
        answer={
          <StepDerivation
            steps={[
              { tex: String.raw`g=\frac{1}{\tilde\lambda_{\max}}=\frac{1}{1+\rho}=${f(nums.g)}`, why: <Rich text="令強方向 $g\tilde\lambda_{\max}=1$。" /> },
              { tex: String.raw`p_{\mathrm{weak}}=1-g\,\tilde\lambda_{\min}=1-${f(nums.g)}\times${f(1 - nums.rho)}=${f(nums.weakPole, 7)}`, why: <Rich text="弱方向的 loop gain 只有 $g\tilde\lambda_{\min}$。" /> },
              { tex: String.raw`k_{95}=\Big\lceil\frac{\ln0.05}{\ln p_{\mathrm{weak}}}\Big\rceil=${nums.weakBlocks}`, why: <Rich text="解 $p^k=0.05$。" /> },
            ]}
            result={String.raw`k_{95}=${nums.weakBlocks}\ \text{blocks}`}
          />
        }
      />

      <Recap
        title="本頁必記：六個條件的判據"
        formulas={[
          { label: '1. 資訊足夠', tex: String.raw`\lambda_{\min}(\mathbf R)>0` },
          { label: '2. 更新方向正確（單頻）', tex: String.raw`C_D=P_x|H|\cos(\phi+\Omega D)>0` },
          { label: '3. 動態穩定', tex: String.raw`p=1-\mu K_qC,\qquad 0<g<2\sin\frac{\pi}{4d+2}` },
          { label: '4. 統計精度', tex: String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}` },
          { label: '5. 正確的固定點', tex: String.raw`w^*=a+\frac{B}{C}` },
          {
            label: String.raw`6. 殘餘誤差在預算內（DTC-referred $\sigma_{\delta t}$、單 tone spur）`,
            tex: String.raw`\begin{gathered}\sigma_{\delta t}=\sqrt{P_x\,(\Delta w^2+\sigma_w^2)}\le\sigma_{\delta t,\max}\\[2pt]\mathrm{Spur}\approx20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)\le\mathrm{Spur}_{\max}\end{gathered}`,
          },
        ]}
        points={[
          <Rich
            key="1"
            text="六個條件要逐一檢查：只看 $E[G]=0$、PM 夠大或 $\sigma_w$ 夠小，都不能取代完整的檢查（三者都成立時，bias 與 system-level 仍可能不過）。它們也不是互相獨立的：$\mu>0$、$K_q>0$ 時，穩定條件 $0<g=\mu K_qC<g^*(d)$ 已經包含極性的 $C>0$。"
          />,
          <Rich key="2" text="極性 $C$ 同時出現在 pole（$p=1-\mu K_qC$）與 bias（$B/C$）：$C$ 變小，收斂變慢、bias 變大、$\sigma_w$ 也變大。" />,
          <Rich key="3" text="更新晚 $d$ 個 block，可用 loop gain 從 2 縮到 $2\sin\frac{\pi}{4d+2}$；GMAC 用 sum 卻沒除以 $N$，等於 $g$ 乘上 $N$。" />,
          <Rich
            key="4"
            text="Preconditioner 讓弱方向變快，代價是弱方向的雜訊 RMS 比強方向大 $\sqrt{\kappa}$ 倍；小步長（$g\ll1$）時每個係數的 $\sigma_w$ 也比一般 LMS 大，快與安靜要取捨（沒有 commit 延遲時分界在 $g=1$，更大反而比較小）。"
          />,
          <Rich
            key="5"
            text="$\sigma_w$ 是 gain-equivalent 的係數雜訊，要乘上 code 並經過 output transfer $T$，才是 PLL 輸出的 jitter / spur。本頁的條件 6 只算到 DTC-referred 的 $\sigma_{\delta t}$ 與單 tone spur，而且只和預算比、不和校正前比。"
          />,
        ]}
      />
    </section>
  )
})
