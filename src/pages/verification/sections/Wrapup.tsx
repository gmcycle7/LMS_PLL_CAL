import { Quiz, Recap, Section, Tex, TexBlock } from '@/components'
import { ar1SampleVarianceFactor, equivalentZ, falseAlarmRate, falseAlarmRateT, MC_PLAN, SWEEP_SCORE_CRIT } from '@/simulation/models/acceptance'
import { pPlus } from '@/simulation/models/comparator'
import { useAcceptance } from '../common'
import { GOLDEN } from '../golden'
import { fmtFull, fmtNum, texNum } from '../format'

const r = String.raw

/** §V.7 本頁必記、思考題、連結到晶片 sign-off */
export function Wrapup() {
  const st = useAcceptance()
  const w2 = st.byId.T01.comp?.values.w2 as number | undefined
  const g2 = GOLDEN.T01.expected.w2 as number
  const strict = (GOLDEN.T05.expected.p_exact_strict_list as number[])[3]
  const nOdd = GOLDEN.T05.expected.N_exact_odd_95 as number
  const nSplit = GOLDEN.T05.expected.N_exact_even_split_95 as number
  const nStrict = GOLDEN.T05.expected.N_exact_even_strict_95 as number
  const a4 = falseAlarmRate(4)
  const a2 = falseAlarmRate(2)
  const K = MC_PLAN.filter((c) => c.kind === 'z' && c.independent && c.expect === 'agree').length
  const p = pPlus(1, 100)
  const sig = Math.sqrt(p * (1 - p))
  const n4 = ((4 * sig) / (p - 0.5)) ** 2
  const p13 = st.byId.T13.comp?.values.p as number | undefined
  const f500 = p13 === undefined ? Number.NaN : ar1SampleVarianceFactor(p13, 500)
  const tau13 = p13 === undefined ? Number.NaN : (1 + p13) / (1 - p13) // 積分相關時間 [blocks]
  return (
    <Section kind="formula" title="§V.7 本頁必記與思考題" level={2} id="ver-wrapup">
      <h3 id="ver-methods">五種驗證手段比較：各自抓得到什麼、抓不到什麼</h3>
      <div className="table-wrap">
        <table className="ver-table" data-testid="methods-table">
          <thead>
            <tr>
              <th>手段</th>
              <th>拿什麼比</th>
              <th>判定式</th>
              <th>抓得到</th>
              <th>抓不到（盲點）</th>
              <th>位置</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ver-mid">
                <strong>確定性 golden 比對</strong>
              </td>
              <td className="ver-mid">網站的封閉式／精確數值，對 Python golden vector</td>
              <td className="ver-mid">
                <Tex>{r`|a_k-e_k|\le\varepsilon_{\rm abs}+\varepsilon_{\rm rel}|e_k|`}</Tex>
              </td>
              <td className="ver-wide">
                公式寫錯、少一個 scaling、單位錯（差距遠大於 <Tex>{r`10^{-12}`}</Tex>）
              </td>
              <td className="ver-wide">兩邊照同一份有錯的規格寫（靠勘誤與第二條路徑補）；隨機行為</td>
              <td>§V.1–§V.2</td>
            </tr>
            <tr>
              <td className="ver-mid">
                <strong>第二條獨立路徑</strong>
              </td>
              <td className="ver-mid">同一個量的兩種算法（閉式對迭代、遞迴對時域模擬）</td>
              <td className="ver-mid">
                <Tex>{r`|\text{路徑 1}-\text{路徑 2}|\le\text{容許}`}</Tex>
              </td>
              <td className="ver-wide">單一演算法的實作錯誤（不需要 golden 檔）</td>
              <td className="ver-wide">兩條路徑共用的前提（例如都假設 iid）</td>
              <td>§V.2 展開列</td>
            </tr>
            <tr>
              <td className="ver-mid">
                <strong>
                  Monte Carlo <Tex>{'z'}</Tex> 檢定
                </strong>
              </td>
              <td className="ver-mid">模擬器的估計值，對解析期望值</td>
              <td className="ver-mid">
                <Tex>{r`|z|=\dfrac{|\hat\theta-\theta|}{\mathrm{SE}}\le z_{\rm crit}`}</Tex>
              </td>
              <td className="ver-wide">
                模擬器與公式不一致，而且差距超過 <Tex>{r`z_{\rm crit}\,\mathrm{SE}`}</Tex>
              </td>
              <td className="ver-wide">
                比 SE 小的偏差（要加大樣本）；heavy-tail 的量（T03 的長時間 <Tex>{r`\delta_n^2`}</Tex>）
              </td>
              <td>§V.3</td>
            </tr>
            <tr>
              <td className="ver-mid">
                <strong>多 seed 校準</strong>
              </td>
              <td className="ver-mid">
                <Tex>{'K'}</Tex> 個 seed 的 <Tex>{'z'}</Tex>，對 <Tex>{r`\mathcal N(0,1)`}</Tex>
              </td>
              <td className="ver-mid">
                <Tex>{`|Z_{\\rm mean}|,\\ |Z_{\\rm sd}|\\le${SWEEP_SCORE_CRIT}`}</Tex>；KS 檢定
              </td>
              <td className="ver-wide">
                SE 算錯（相關樣本當獨立、<Tex>{'t'}</Tex> 當 <Tex>{'z'}</Tex>）、估計量有 <Tex>{r`O(1/n)`}</Tex> 的偏差
              </td>
              <td className="ver-wide">
                比 <Tex>{r`1/\sqrt K`}</Tex> 小的系統偏移
              </td>
              <td>§V.3</td>
            </tr>
            <tr>
              <td className="ver-mid">
                <strong>Mutation</strong>
              </td>
              <td className="ver-mid">故意寫錯的公式，對同一個 golden key</td>
              <td className="ver-mid">
                <Tex>{r`\Delta>\varepsilon_{\rm abs}+\varepsilon_{\rm rel}|f(x)|`}</Tex> 才算抓到
              </td>
              <td className="ver-wide">「測試太弱」：錯誤公式居然通過</td>
              <td className="ver-wide">
                <Tex>{r`\Delta=0`}</Tex> 的改動（<Tex>{r`\delta`}</Tex> 的極性對 pole）
              </td>
              <td>§V.4</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        沒有任何一種手段是完整的；它們的盲點互相錯開，所以要一起用。自動測試（<code>npm run verify</code>）再把前四種固定成每次改程式都會重跑的回歸測試。
      </p>
      <Recap
        title="驗證這一頁最重要的公式"
        formulas={[
          { label: '確定性比對（F-VF.1；golden/README §5）', tex: r`\boxed{|a_k-e_k|\le\varepsilon_{\rm abs}+\varepsilon_{\rm rel}\,|e_k|}` },
          { label: 'Monte Carlo 的標準誤與 $z$ 檢定（F-VF.3）', tex: r`\boxed{\mathrm{SE}=\frac{\sigma}{\sqrt n},\qquad z=\frac{\hat\theta-\theta}{\mathrm{SE}},\qquad|z|\le z_{\rm crit}}` },
          { label: '誤報率與 $K$ 項的聯集上界（F-VF.4）', tex: r`\boxed{\alpha=2[1-\Phi(z_{\rm crit})],\qquad P(\ge1\text{ 誤報})\le K\alpha}` },
          { label: '相關樣本：樣本變異數偏低（F-VF.6 的大 $n$ 近似）', tex: r`\boxed{\frac{E[s^2]}{\sigma^2}\approx1-\frac{2p}{(1-p)\,n}}` },
          { label: '浮點捨入在穩定遞迴中的累積（F-VF.2）', tex: r`\boxed{|d_n|\lesssim\frac{c\,\varepsilon_{\rm mach}\max|w|}{1-|p|}}` },
        ]}
        points={[
          <>只有 TypeScript 與 Python 兩邊的自動測試都通過（status = pass）才算 verified；即時重算一致只是「本機抽查」。</>,
          <>
            golden 只放確定性的值；隨機項目用自己的 seed 跑，再用 <Tex>{'z'}</Tex> 檢定和期望值比——不能拿長時間樣本平均驗證 heavy-tail 的量（T03、勘誤 E14）。
          </>,
          <>容忍度要卡在「浮點誤差」與「公式錯誤」之間：太鬆抓不到錯，太緊會冤枉正確的程式。</>,
          <>
            <Tex>{'z'}</Tex> 檢定本身也要校準：SE 用錯（相關樣本當獨立、估計的 SE 當已知）或估計量有 <Tex>{r`O(1/n)`}</Tex> 的偏差，單次看不出來，換很多個 seed 才抓得到。
          </>,
          <>
            好的測試要對錯誤敏感：<Tex>{r`\delta`}</Tex> 的極性錯了，pole 測試看不出來；要用 trace 或明確的符號約定（勘誤 E39）。
          </>,
          <>規格本身也會錯：網站採用 docs/validation.md 的修正版本，並在每個不同之處標「勘誤 Exx」連到這裡。</>,
        ]}
      />
      <Quiz
        title="思考題 1：$2.28$ 算不算通過？"
        question={
          <>
            Golden 的 <Tex>{'w_2'}</Tex> 是 <code>{fmtFull(g2)}</code>，容忍度 <Tex>{r`\varepsilon_{\rm abs}=10^{-12}`}</Tex>。假設某個實作用有理數算出精確的 <Tex>{r`57/25`}</Tex>，存成 double 是{' '}
            <code>{fmtFull(57 / 25)}</code>。它通過嗎？
          </>
        }
        options={[{ label: '通過', correct: true }, { label: '不通過：必須逐位元相同' }, { label: '無法判斷' }]}
        answer={
          <>
            <TexBlock>{`|${fmtFull(57 / 25)}-${fmtFull(g2)}|=${texNum(Math.abs(57 / 25 - g2), 3)}\\le10^{-12}\\quad\\Rightarrow\\quad\\text{通過}`}</TexBlock>
            <p>
              網站實際算出的是 <code>{w2 === undefined ? '—' : fmtFull(w2)}</code>
              {w2 === g2 ? '（和 Python 逐位元相同，因為兩邊做了同樣順序的浮點運算）' : '（和 Python 差在最後一位：兩邊的運算順序不同）'}。容忍度存在的目的，就是讓「運算順序不同」造成的{' '}
              <Tex>{r`10^{-16}`}</Tex> 級差異不被誤判。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2：T05 在 $N=42500$ 失敗了嗎？"
        question={
          <>
            照字面「<Tex>{r`P(G_N>0)`}</Tex>」算，<Tex>{'N=42500'}</Tex> 的 exact Binomial 是 <Tex>{`${fmtNum(strict, 7)}`}</Tex>，比 <Tex>{'0.95'}</Tex> 小。規格的 T05 該判為失敗嗎？
          </>
        }
        answer={
          <>
            <p>
              不是模型錯，是規格<strong>沒有定義 tie</strong>（勘誤 E02 / E07）。<Tex>{'N'}</Tex> 為偶數時 <Tex>{r`P(S_N=0)>0`}</Tex>：
            </p>
            <TexBlock>{r`P_{\rm CLT}\approx P(S_N>0)+\tfrac12P(S_N=0)\ \ (\text{tie 平分}),\qquad P_{\rm strict}=P(S_N>0)`}</TexBlock>
            <p>
              所以修正後的 T05 改成分別驗證四種解讀：CLT、tie 平分、strict、奇數 <Tex>{'N+1'}</Tex>；95% 的精確門檻是奇數 <Tex>{`N\\ge${nOdd}`}</Tex>、偶數 tie 平分{' '}
              <Tex>{`N\\ge${nSplit}`}</Tex>、偶數 strict <Tex>{`N\\ge${nStrict}`}</Tex>（取自 golden/vectors/T05.json）。§V.2 的 T05 列把這幾個值全部和網站的即時計算比對。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3：整頁偶發失敗的機率"
        question={
          <>
            §V.3 有 {K} 項互相獨立、經過校準的 <Tex>{'z'}</Tex> 檢查，每項門檻 <Tex>{r`z_{\rm crit}=4`}</Tex>。如果所有模型都正確，按一次「執行」至少有一項失敗的機率大約是多少？
          </>
        }
        options={[{ label: '約 5%' }, { label: `約 ${fmtNum(K * a4 * 100, 2)}%`, correct: true }, { label: '0（模型正確就不會失敗）' }]}
        answer={
          <>
            <TexBlock>{`\\alpha=2[1-\\Phi(4)]=${texNum(a4, 4)},\\qquad1-(1-\\alpha)^{${K}}\\approx${K}\\alpha=${texNum(K * a4, 3)}`}</TexBlock>
            <p>
              不到千分之一，但不是 0：統計檢定永遠有誤報。所以 MC 失敗時的正確反應是「換 seed、加大樣本再跑」——持續失敗才是真的問題。若改成 <Tex>{r`z_{\rm crit}=2`}</Tex>，單項{' '}
              <Tex>{`\\alpha=${fmtNum(a2 * 100, 3)}\\%`}</Tex>，{K} 項中至少一項被冤枉的機率高達 <Tex>{`1-(1-\\alpha)^{${K}}=${fmtNum((1 - Math.pow(1 - a2, K)) * 100, 3)}\\%`}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4：要量多少次？"
        question={
          <>
            T04：<Tex>{`p=P(q=+1)=${fmtNum(p, 6)}`}</Tex>。你想用實測的 <Tex>{r`\hat p`}</Tex> 證明「它不是 <Tex>{r`50\%`}</Tex>」，要求 <Tex>{r`p-\tfrac12`}</Tex> 至少是 4 個標準誤。需要大約多少個
            comparator 決策？
          </>
        }
        options={[{ label: '約 1 萬個' }, { label: `約 ${fmtNum(n4 / 1e4, 3)} 萬個`, correct: true }, { label: '約 1 億個' }]}
        answer={
          <>
            <TexBlock>{`\\frac{p-\\tfrac12}{\\sqrt{p(1-p)/n}}\\ge4\\ \\Rightarrow\\ n\\ge\\Big(\\frac{4\\sqrt{p(1-p)}}{p-\\tfrac12}\\Big)^2=\\Big(\\frac{4\\times${fmtNum(sig, 5)}}{${fmtNum(p - 0.5, 4)}}\\Big)^2\\approx${texNum(n4, 3)}`}</TexBlock>
            <p>
              這和第 5 章的結論一致：<Tex>{r`1\,\mathrm{fs}`}</Tex> 的誤差埋在 <Tex>{r`100\,\mathrm{fs}`}</Tex> 的雜訊裡，資訊還在，但要累積很多次（訊號 <Tex>{r`\propto n`}</Tex>、雜訊{' '}
              <Tex>{r`\propto\sqrt n`}</Tex>）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 5：把 $t$ 直接當 $z$ 會怎樣？"
        question={
          <>
            T13 的 SE 由 24 條 chain 估計（<Tex>{r`\nu=23`}</Tex>）。若直接拿 <Tex>{r`t=(\hat\theta-\theta)/\widehat{\mathrm{SE}}`}</Tex> 和 <Tex>{r`z_{\rm crit}=4`}</Tex> 比，實際的誤報率是多少？另外，若每條
            chain 只取 <Tex>{'n=500'}</Tex> 個 block 而不修正 <Tex>{'s^2'}</Tex> 的偏差，期望值會差多少？
          </>
        }
        answer={
          <>
            <TexBlock>{`P(|t_{23}|>4)=${texNum(falseAlarmRateT(4, 23), 3)}\\approx${fmtNum(falseAlarmRateT(4, 23) / a4, 2)}\\times\\alpha_{\\rm normal},\\qquad t=4\\ \\Rightarrow\\ z_{\\rm eq}=${fmtNum(equivalentZ(4, 23), 4)}`}</TexBlock>
            <p>
              誤報率大約是你以為的 {fmtNum(falseAlarmRateT(4, 23) / a4, 2)} 倍；換成等效 <Tex>{'z'}</Tex> 後才回到同一個標準（F-VF.5）。偏差方面：
            </p>
            <TexBlock>{`\\frac{E[s^2]}{\\sigma_w^2}\\Big|_{n=500}=${fmtNum(f500, 5)}\\quad(\\text{偏低 }${fmtNum((1 - f500) * 100, 3)}\\%)`}</TexBlock>
            <p>
              <Tex>{`p=${fmtNum(p13 ?? Number.NaN, 5)}`}</Tex> 時相關時間約 <Tex>{`(1+p)/(1-p)\\approx${fmtNum(tau13, 3)}`}</Tex> 個 block；視窗只有它的 {fmtNum(500 / tau13, 2)} 倍，
              樣本平均吃掉的變異就不能忽略（F-VF.6）。
            </p>
          </>
        }
      />
      <Section kind="example" title="連結到 PLL 晶片：這就是 sign-off 的回歸測試" level={3}>
        <p>
          本頁的結構和晶片驗證完全相同：<strong>golden model</strong>（Python ↔ 系統工程師的 MATLAB 模型）、<strong>test vectors</strong>（JSON ↔ RTL testbench 的 stimulus/expected）、
          <strong>容忍度</strong>（浮點 ↔ 定點的 LSB 誤差預算）、<strong>Monte Carlo + 信賴區間</strong>（↔ PVT / 雜訊 corner）、<strong>多 seed 校準</strong>（↔ 確認量測腳本自己沒有系統誤差）、
          <strong>mutation</strong>（↔ 故意注入 bug 檢查 testbench 的 coverage）。量測 PLL 的 jitter 或 spur 時也是同一件事：<Tex>{r`\delta w_k`}</Tex> 這種有相關時間的量，
          短視窗量到的 RMS 會偏低（F-VF.6）——量測時間要遠大於校正迴路的時間常數。Part D 的 <a href="#/models">Behavioral Models &amp; RTL</a> 與 <a href="#/signoff">Sign-off Checklist</a>{' '}
          把同一套方法延伸到 bit-true RTL（本頁 Fixed-Point 欄因此誠實標成 Not implemented）。
        </p>
      </Section>
    </Section>
  )
}
