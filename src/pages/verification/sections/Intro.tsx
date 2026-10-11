import { useMemo } from 'react'
import { Callout, ClaimTag, ModelLevel, Prereq, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import { runScalarLms, fixedXPole } from '@/simulation/models/lms'
import { ACCEPTANCE_INPUTS, MC_PLAN, toleranceBound } from '@/simulation/models/acceptance'
import { Diagram, Expand, FBlock, M, steps, useAcceptance } from '../common'
import { CHART_TOLERANCE } from '../diagrams'
import validationMd from '../../../../docs/validation.md?raw'
import { ERRATA, parseValidationStats } from '../errata'
import { GOLDEN } from '../golden'
import { exactDiffToFraction, fmtFull, fmtNum, texNum } from '../format'

const r = String.raw
const STATS = parseValidationStats(validationMd)

/** 頁首：這一頁要回答的問題、三個獨立證人、先算一次（T01 的浮點誤差）、容忍度規則（符號表在頁尾，見 sections/Symbols.tsx） */
export function Intro() {
  const st = useAcceptance()
  const t01 = useMemo(() => {
    const i = ACCEPTANCE_INPUTS.T01
    const res = runScalarLms({ variant: 'conventional', a: i.a, w0: i.w0, mu: i.mu, steps: i.steps, x: { kind: 'fixed', value: i.x } })
    // 精確解 w_n = a − (a − w₀)pⁿ，p = 3/5 ⇒ w_n = (3·5ⁿ − 2·3ⁿ)/5ⁿ（整數運算）
    return Array.from({ length: 4 }, (_, n) => {
      const den = 5n ** BigInt(n)
      const num = 3n * den - 2n * 3n ** BigInt(n)
      return { n, num, den, w: res.w[n], diff: exactDiffToFraction(res.w[n], num, den) }
    })
  }, [])
  const gw2 = GOLDEN.T01.expected.w2 as number
  const tol01 = GOLDEN.T01.tolerance
  const c90 = (st.byId.T06.comp?.values.C_at_phi_list_deg as number[] | undefined)?.[2] ?? Number.NaN
  const c90golden = (GOLDEN.T06.expected.C_at_phi_list_deg as number[])[2]
  const enbw = st.byId.T14.comp?.values.enbw_one_sided_hz as number | undefined
  const pole = fixedXPole(0.1, 2)
  const p11 = (st.byId.T11.comp?.values.slow_pole as number | undefined) ?? Number.NaN // T11 的慢 pole（即時值）
  const kappa10 = (st.byId.T10.comp?.values.cond as number | undefined) ?? Number.NaN // T10 的條件數（即時值）
  const mach = Number.EPSILON
  const boundT01 = (4 * mach * 3) / (1 - Math.abs(pole))
  const worstT01 = Math.max(...t01.map((x) => x.diff))

  return (
    <>
      <Section kind="intuition" title="這一頁要回答的問題：網站上的數字，怎麼知道是對的？" level={2} id="ver-intro">
        <p>
          前面 15 章（Ch00–Ch14）有上百個互動圖與數字：<Tex>{'w_2=2.28'}</Tex>、<Tex>{r`K_q=0.00797885\,\mathrm{fs^{-1}}`}</Tex>、<Tex>{r`\sigma_w=0.399\,\mathrm{fs}`}</Tex>……
          你是 IC 設計者，最怕的是「模擬器畫得很漂亮，但公式其實寫錯」。這一頁把規格書 §17 列出的 18 個
          <strong>驗收值（Acceptance Reference Values，T01–T18）</strong>當成「出廠測試向量」，用三個<strong>互相獨立的證人</strong>同時作證：
        </p>
        <ol>
          <li>
            <strong>網站本身（TypeScript）</strong>：你打開這一頁時，瀏覽器就呼叫各章<strong>真正執行</strong>的模型函式（<code>lms.ts</code>、
            <code>comparator.ts</code>、<code>calNoise.ts</code>…）把 18 項重算一次。
          </li>
          <li>
            <strong>Python golden model</strong>：<code>golden/</code> 以 NumPy / SciPy 從第一原理<strong>另外寫一份</strong>，輸出{' '}
            <code>golden/vectors/T01.json … T18.json</code>（期望值 + 容忍度）。
          </li>
          <li>
            <strong>手算或封閉式</strong>：每一項另附第二條獨立計算路徑（例如 <Tex>{r`2\times2`}</Tex> 閉式對 Jacobi 迭代、封閉式對數值求根、遞迴對時域模擬）。
          </li>
        </ol>
        <p>
          三者在指定容忍度內一致，才算過關；而且<strong>只有 TypeScript 與 Python 兩邊的自動測試都通過（status = pass）才會顯示 verified</strong>。
          規格書本身也有錯——<code>docs/validation.md</code> 以 Python 重算{STATS.claims !== null ? ` ${STATS.claims} 項` : '每一項'}聲明，確認 {ERRATA.length} 項勘誤；網站一律採用修正後的版本，並在本頁最後列出全部勘誤，
          其中 {Object.keys(st.evidenceByEid).length} 項的數值證據由本頁即時重算（{st.evidencePassed} / {st.evidence.length} 個數字與文件引用的一致）。
        </p>
        <Callout kind="info" title="本頁地圖">
          <ol style={{ margin: 0 }}>
            <li>§V.1 先算一次：為什麼 T01 的 golden 寫成 2.2800000000000002？（浮點與容忍度）</li>
            <li>§V.2 T01–T18 即時驗收表（每一列可展開看所有 key、第二條路徑與實際程式碼）</li>
            <li>
              §V.3 Monte Carlo 驗收（Web Worker；{MC_PLAN.length} 項統計檢查）與多 seed 校準：<Tex>{'z'}</Tex> 檢定本身準不準？
            </li>
            <li>§V.4 反面測試與 Mutation Lab：故意把公式寫錯，看驗收機制抓不抓得到</li>
            <li>§V.5 驗證管線怎麼運作（TS + Python golden + verify 腳本；四種狀態）</li>
            <li>§V.6 勘誤瀏覽器（E01–E49；可篩選、可用 ?e=E05 直接連結；附 KaTeX 公式與即時重算的證據）</li>
            <li>§V.7 五種驗證手段比較、本頁必記與思考題</li>
            <li>§V.8 本頁符號表（在最後；頁首的連結一鍵跳過去）</li>
          </ol>
        </Callout>
        <p className="small muted">
          <ClaimTag kind="exact" /> 確定性比對（§V.1–§V.2）在指定模型下是精確的；<ClaimTag kind="approx" /> Monte Carlo 判定（§V.3）依賴中央極限定理，是近似。
          模型層級：<ModelLevel level="L0" /> 到 <ModelLevel level="L5" />（各列自己標示）。
        </p>
      </Section>

      <Section kind="example" title="§V.1 先算一次：$2.28$ 和 $2.2800000000000002$ 算不算一樣？" level={2} id="ver-handcalc">
        <p>
          T01 是第 0 章的手算例子：<Tex>{r`a=3,\ w_0=1,\ x=2,\ \mu=0.1`}</Tex>，更新 <Tex>{r`w_{n+1}=w_n+\mu(a-w_n)x^2`}</Tex>，所以誤差每步乘上{' '}
          <Tex>{`p=1-\\mu x^2=${fmtNum(pole)}`}</Tex>。精確解是等比數列：
        </p>
        <TexBlock>{r`w_n=a-(a-w_0)\,p^n=3-2\left(\tfrac35\right)^n=\frac{3\cdot5^n-2\cdot3^n}{5^n}`}</TexBlock>
        <p>
          下表左邊是用整數算的<strong>精確分數</strong>，中間是網站 <code>runScalarLms</code> 以 IEEE double 逐步算出的值（顯示全部 17 位），右邊是兩者的
          <strong>精確差</strong>（先以 BigInt 算出有理數差，最後才轉成 double）。
        </p>
        <div className="table-wrap">
          <table className="ver-table ver-handcalc">
            <thead>
              <tr>
                <th>
                  <Tex>{'n'}</Tex>
                </th>
                <th>精確分數</th>
                <th>網站的 double</th>
                <th>
                  <Tex>{r`|d_n|=|\tilde w_n-w_n|`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {t01.map((row) => (
                <tr key={row.n}>
                  <td>{row.n}</td>
                  <td>
                    <Tex>{row.den === 1n ? String(row.num) : `\\tfrac{${row.num}}{${row.den}}`}</Tex>
                  </td>
                  <td className="num">{fmtFull(row.w)}</td>
                  <td className="num">{row.diff === 0 ? '0' : <Tex>{texNum(row.diff, 3)}</Tex>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Prereq title="浮點數（IEEE 754 double）：電腦裡的小數不是「真的」小數">
          <p>
            double 用 64 個位元存一個數：1 個正負號、11 個指數位元、52 個小數位元，表示成 <Tex>{r`\pm1.b_1b_2\ldots b_{52}\times2^{E}`}</Tex>（二進位的科學記號）。
            就像 <Tex>{r`\tfrac13=0.333\ldots`}</Tex> 在十進位寫不完，<Tex>{r`\tfrac15=0.2`}</Tex> 在<strong>二進位</strong>也寫不完（
            <Tex>{r`0.2=0.001100110011\ldots_2`}</Tex>），所以只能存最接近的那個可表示的數。
          </p>
          <ul>
            <li>
              相鄰兩個可表示的數相差約 <Tex>{r`|x|\cdot\varepsilon_{\rm mach}`}</Tex>，<Tex>{r`\varepsilon_{\rm mach}=2^{-52}\approx2.22\times10^{-16}`}</Tex>：大約 16 位有效數字。
            </li>
            <li>
              每做一次加減乘除，結果被捨入到最近的可表示數，相對誤差不超過 <Tex>{r`\tfrac12\varepsilon_{\rm mach}`}</Tex>。
            </li>
            <li>
              整數（絕對值 <Tex>{r`<2^{53}`}</Tex>）與 <Tex>{r`2`}</Tex> 的冪次分數（<Tex>{r`\tfrac12,\tfrac14,\ldots`}</Tex>）可以精確表示——所以表中 <Tex>{'w_0=1'}</Tex> 的差是 0。
            </li>
          </ul>
          <p className="small">
            對 IC 設計者的類比：double 像一個 52-bit mantissa 的浮點 ADC，每次運算都加一點量化雜訊；本節要估計這些雜訊在 LMS 遞迴裡累積到多大。
          </p>
        </Prereq>
        <p>
          Golden 檔裡 <Tex>{'w_2'}</Tex> 寫成 <code>{fmtFull(gw2)}</code>——這不是 Python 算錯，而是 <Tex>{r`57/25=2.28`}</Tex> 在二進位裡是無窮小數。容忍度{' '}
          <Tex>{`\\varepsilon_{\\rm abs}=${texNum(tol01.abs ?? 0, 2)}`}</Tex> 比這種捨入誤差（<Tex>{r`\sim10^{-16}`}</Tex>）大四個數量級，又比任何「公式寫錯」的誤差（至少{' '}
          <Tex>{r`10^{-3}`}</Tex>）小九個數量級——它就卡在兩者中間。
        </p>
        <Expand title="捨入誤差怎麼在 LMS 遞迴裡累積（為什麼 $10^{-12}$ 對 T01 是安全的）" badge="推導">
          <p>把每一步的捨入當成一個小擾動，看它被遞迴放大或衰減多少：</p>
          <StepDerivation
            steps={steps([
              { tex: r`\tilde w_{n+1}=\tilde w_n+\mu(a-\tilde w_n)x^2+\eta_n,\qquad|\eta_n|\le c\,\varepsilon_{\rm mach}\max|w|`, why: r`電腦實際算的是帶擾動的遞迴：$\eta_n$ 是這一步所有浮點運算的捨入誤差總和（$c$ 是運算次數等級的小常數，約 3–4）。` },
              { tex: r`w_{n+1}=w_n+\mu(a-w_n)x^2`, why: r`這是沒有捨入的精確遞迴。` },
              { tex: r`d_{n+1}=d_n-\mu x^2d_n+\eta_n=p\,d_n+\eta_n,\qquad d_n:=\tilde w_n-w_n`, why: r`兩式相減：$a$ 消掉，剩下 $d_n$ 的線性遞迴，係數正是 pole $p=1-\mu x^2$。` },
              { tex: r`d_n=\sum_{k=0}^{n-1}p^{\,n-1-k}\,\eta_k`, why: r`把遞迴一路展開（$d_0=0$：初值 $1$ 可精確表示）。每個舊的捨入誤差被 $p$ 乘了很多次。` },
              { tex: r`|d_n|\le\max_k|\eta_k|\sum_{j=0}^{\infty}|p|^{j}=\frac{\max|\eta|}{1-|p|}`, why: r`三角不等式，再用等比級數 $\sum|p|^j=1/(1-|p|)$（需要 $|p|<1$）。` },
              { tex: `\\frac{4\\times${texNum(mach, 3)}\\times3}{1-${fmtNum(Math.abs(pole))}}=${texNum(boundT01, 3)}\\ \\ll\\ 10^{-12}`, why: r`代入 $c\approx4$、$\max|w|=3$、$|p|=0.6$：上界比容忍度小兩個數量級以上。` },
            ])}
          />
          <FBlock id="F-VF.2" />
          <p className="small">
            實測：上表四列中最大的 <Tex>{`|d_n|=${texNum(worstT01, 3)}`}</Tex>，{worstT01 <= boundT01 ? '確實在' : '超出了'}上界 <Tex>{texNum(boundT01, 3)}</Tex>
            {worstT01 <= boundT01 ? ' 之內' : '（估計的常數 c 太小）'}。注意分母 <Tex>{'1-|p|'}</Tex>：pole 越接近 1（收斂越慢），
            捨入誤差累積得越多。例如 T11 的慢模式 <Tex>{`p=${fmtNum(p11, 4)}`}</Tex>：<Tex>{`1/(1-|p|)=${fmtNum(1 / (1 - Math.abs(p11)), 4)}`}</Tex>，同一個 <Tex>{r`\eta`}</Tex> 會被放大兩百倍（它的{' '}
            <Tex>{r`\mathbf R`}</Tex> 條件數 <Tex>{`\\kappa=${fmtNum(kappa10, 4)}`}</Tex> 也是同一個量級）；golden 檔對 T11 設的容忍度是 <Tex>{`\\varepsilon_{\\rm abs}=${texNum(GOLDEN.T11.tolerance.abs ?? 0, 2)}`}</Tex>，比 T01 寬。{' '}
            <ClaimTag kind="approx" />
          </p>
        </Expand>
        <p>
          反過來，為什麼不全部用相對容忍度？看 T06 的 <Tex>{r`\phi=90^\circ`}</Tex>：<Tex>{r`C=\tfrac12\cos90^\circ`}</Tex> 數學上是 0，double 卻算出{' '}
          <code>{fmtFull(c90)}</code>（golden：<code>{fmtFull(c90golden)}</code>）。若只用 <Tex>{r`\varepsilon_{\rm rel}=10^{-12}`}</Tex>，容許誤差只有{' '}
          <Tex>{`10^{-12}\\times${texNum(Math.abs(c90golden), 3)}`}</Tex>，兩邊必須逐位元相同才過——這不合理。所以接近 0 的量用絕對項；而 T14 的頻寬是{' '}
          <Tex>{`\\mathrm{ENBW}\\approx${fmtNum(enbw ?? Number.NaN, 6)}\\,\\mathrm{Hz}`}</Tex>，絕對 <Tex>{r`10^{-12}\,\mathrm{Hz}`}</Tex> 又太嚴苛，所以用相對項{' '}
          <Tex>{r`10^{-10}`}</Tex>（容許 <Tex>{`${texNum(toleranceBound(enbw ?? 0, { rel: 1e-10 }), 3)}\\,\\mathrm{Hz}`}</Tex>）。
        </p>
        <Diagram
          chart={CHART_TOLERANCE}
          caption="一個元素的判定：一條路算誤差 $|a_k-e_k|$，另一條路算容許量 $b_k$（藍色），最後比大小。"
          ariaLabel="容忍度判定的方塊圖：網站的值減去 golden 的期望值取絕對值，與絕對項加上相對項乘期望值絕對值所得的容許量比較，不大於容許量即通過"
        >
          <p>
            <strong>先看</strong>誤差這條路：
            {M(r`網站即時算出的 $a_k$ 進加法點取正、golden 的期望值 $e_k$ 取負，得到誤差 $\Delta=a_k-e_k$，再取絕對值 $|\Delta|$；這就是表格裡 $|\Delta|$ 那一欄。`)}
          </p>
          <p>
            <strong>再看</strong>容許量這條路（終點是藍色的加法點）：
            {M(r`容許量 $b_k$ 是兩項相加——固定的絕對項 $\varepsilon_{\rm abs}$，以及跟著 $|e_k|$ 變大的相對項 $\varepsilon_{\rm rel}|e_k|$。$e_k$ 同時走進誤差與容許量兩條路，所以 $e_k\approx0$ 時 $b_k\approx\varepsilon_{\rm abs}$，$|e_k|$ 很大時由相對項主導。最後的菱形比 $|\Delta|\le b_k$：是就通過，否就是不一致。`)}
            圖上每個方塊就是下面推導的一行。
          </p>
        </Diagram>
        <StepDerivation
          title="容忍度規則：一個式子同時處理「接近 0」與「很大」的量"
          steps={steps([
            { tex: r`\text{通過}\iff|a_k-e_k|\le b_k`, why: r`每個元素各自判定（陣列逐元素、矩陣逐元素）。` },
            { tex: r`b_k=\varepsilon_{\rm abs}+\varepsilon_{\rm rel}\,|e_k|`, why: r`兩種容忍度相加：$e_k\approx0$ 時由 $\varepsilon_{\rm abs}$ 主導，$|e_k|$ 很大時由 $\varepsilon_{\rm rel}|e_k|$ 主導。` },
            { tex: r`|e_k|\ll\frac{\varepsilon_{\rm abs}}{\varepsilon_{\rm rel}}\ \Rightarrow\ b_k\approx\varepsilon_{\rm abs}`, why: r`分界點是 $\varepsilon_{\rm abs}/\varepsilon_{\rm rel}$；在它之下就是「絕對誤差」判定。` },
            { tex: r`|e_k|\gg\frac{\varepsilon_{\rm abs}}{\varepsilon_{\rm rel}}\ \Rightarrow\ \frac{|a_k-e_k|}{|e_k|}\lesssim\varepsilon_{\rm rel}`, why: r`兩邊同除 $|e_k|$：在它之上就是「相對誤差」判定。` },
            { tex: r`\varepsilon_{\rm abs}=\varepsilon_{\rm rel}=0\ \Rightarrow\ a_k=e_k`, why: r`整數門檻（598 blocks、$N=42499$、週期 5）用 tolerance_overrides 設成 abs $=0$：必須完全相等。` },
          ])}
        />
        <FBlock id="F-VF.1" />
        <p className="small muted">
          這和 <code>numpy.isclose(a, e, rtol, atol)</code> 是同一條規則；實際執行的程式碼見 §V.5。 <ClaimTag kind="exact" /> <SourceTag kind="simulation" />
        </p>
      </Section>
    </>
  )
}
