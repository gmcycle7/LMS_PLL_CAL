import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Prereq, Section, Tex, TexBlock } from '@/components'
import stabilitySrc from '@/simulation/models/scalarStability.ts?raw'
import lmsPySrc from '../../../../golden/lms_pll_golden/lms.py?raw'
import { normCdf, normInv } from '@/simulation/core'
import {
  cltConvergedFraction,
  cltLog10Quantile,
  cltStepsBelowStart,
  fourthPowerFactor,
  logFactorVariance,
  lyapunovExponent,
  stabilityFactors,
  xMoments,
  type XDist,
} from '@/simulation/models/scalarStability'
import { Erratum, FBlock, HC, num, pyDef, StepsBox, T, tnum, tx } from '../common'
import { HeavyTailDemo } from '../experiments/HeavyTailDemo'

const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }

/** CLT 預測表的 (μ, N)：都是 Gaussian N(0,1)、ε = 10⁻³；數字由 logFactorVariance / cltConvergedFraction 即時計算 */
const CLT_ROWS: [number, number][] = [
  [0.8, 200],
  [2, 200],
  [2.3, 200],
  [2.3, 1000],
]

function CltTable() {
  const rows = useMemo(
    () =>
      CLT_ROWS.map(([mu, n]) => {
        const lam = lyapunovExponent(mu, GAUSS)
        const sd = Math.sqrt(logFactorVariance(mu, GAUSS))
        return {
          mu,
          n,
          lam,
          sd,
          frac: cltConvergedFraction(lam, sd, n, 1e-3),
          q10: cltLog10Quantile(lam, sd, n, 0.1),
          q50: cltLog10Quantile(lam, sd, n, 0.5),
          q90: cltLog10Quantile(lam, sd, n, 0.9),
          n90: Math.ceil(cltStepsBelowStart(lam, sd, 0.9)), // λ ≥ 0 時為 NaN
        }
      }),
    [],
  )
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>\mu</Tex>
            </th>
            <th>
              <Tex>n</Tex>
            </th>
            <th>
              <Tex>{T`\lambda`}</Tex>
            </th>
            <th>
              <Tex>{T`s=\sqrt{\operatorname{Var}(\ln|f|)}`}</Tex>
            </th>
            <th>
              <Tex>{T`n\lambda/\ln10`}</Tex>（中位數）
            </th>
            <th>
              10%–90% 分位（<Tex>{T`\log_{10}`}</Tex>）
            </th>
            <th>
              <Tex>{T`P(|\delta_n|<10^{-3}|\delta_0|)`}</Tex>
            </th>
            <th>
              90% 分位開始低於起點的 <Tex>n</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.mu}-${r.n}`}>
              <td>{r.mu}</td>
              <td>{r.n}</td>
              <td>{num(r.lam, 4)}</td>
              <td>{num(r.sd, 4)}</td>
              <td>{num(r.q50, 4)}</td>
              <td>
                {num(r.q10, 4)} ～ {num(r.q90, 4)}
              </td>
              <td>{num(100 * r.frac, 4)}%</td>
              <td>{num(r.n90, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HeavyTailSection() {
  const nums = useMemo(() => {
    const mu = 0.8
    const n = 5
    const M = 4000
    const m = xMoments(GAUSS)
    const g = stabilityFactors(mu, GAUSS).g
    const h = fourthPowerFactor(mu, m)
    const exact = g ** n
    const se = Math.sqrt((h ** n - g ** (2 * n)) / M)
    return { mu, n, M, g, h, exact, se }
  }, [])
  const pyCode = useMemo(() => {
    try {
      return pyDef(lmsPySrc, 'mc_mean_square_factor')
    } catch {
      return ''
    }
  }, [])
  return (
    <>
      <h2 id="heavy-tail">5｜Heavy tail（厚尾）：為什麼 Monte Carlo 的平均會騙人</h2>
      <Section kind="intuition" title={tx`少數路徑決定了 $E[\delta^2]$`}>
        <p>
          無雜訊時 <Tex>{T`\ln|\delta_n|`}</Tex> 是 <Tex>n</Tex> 個 iid 項的總和，所以近似常態（中央極限定理）；<Tex>{T`|\delta_n|`}</Tex> 就近似 <strong>lognormal（對數常態）</strong>：
          大部分路徑擠在中位數附近，但右尾非常長——這種「極端大值雖然罕見、卻大到足以主導平均」的分布叫 <strong>heavy tail（厚尾）</strong>。<Tex>{T`E[\delta_n^2]`}</Tex> 把右尾的巨大值也平均進去，而一次 Monte Carlo 只有 <Tex>M</Tex> 條路徑，
          通常根本抽不到那些「機率極小、數值極大」的路徑——於是樣本平均偏低，而且用同一批樣本算出的樣本 SE 也偏小，<strong>信賴區間既偏又窄</strong>。
          <Erratum id="E14" />
        </p>
        <Prereq title="中央極限定理與 lognormal：為什麼右尾這麼長">
          <p>
            <strong>中央極限定理</strong>（CLT）：<Tex>{T`Y_k`}</Tex> iid、平均 <Tex>m</Tex>、變異數 <Tex>{T`s^2`}</Tex>，則總和 <Tex>{T`\sum_{k=1}^nY_k`}</Tex> 近似常態{' '}
            <Tex>{T`\mathcal N(nm,\,ns^2)`}</Tex>——不論 <Tex>Y</Tex> 本身長什麼樣子（只要變異數 <Tex>{T`s^2`}</Tex> 有限）。這裡 <Tex>{T`Y_k=\ln|1-\mu x_k^2|`}</Tex>、<Tex>{T`m=\lambda`}</Tex>。
          </p>
          <p>
            所以 <Tex>{T`L=\ln|\delta_n/\delta_0|`}</Tex> 近似常態，<Tex>{T`|\delta_n|=|\delta_0|e^{L}`}</Tex> 是 <strong>lognormal</strong>。若 <Tex>{T`L\sim\mathcal N(\nu,\tau^2)`}</Tex>，直接積分可得
          </p>
          <TexBlock>{T`E\big[e^{2L}\big]=\int e^{2\ell}\,\frac{e^{-(\ell-\nu)^2/(2\tau^2)}}{\sqrt{2\pi}\,\tau}\,d\ell=e^{2\nu+2\tau^2}\qquad\text{（配方法）}`}</TexBlock>
          <p>
            中位數是 <Tex>{T`e^{\nu}`}</Tex>，但平方的平均多了 <Tex>{T`e^{2\tau^2}`}</Tex> 倍，而且這個倍數來自 <Tex>L</Tex> 很大的那一小段右尾——正是有限樣本最看不到的地方。
            （CLT 只描述 <Tex>L</Tex> 的中段；精確的 <Tex>{T`E[\delta^2]`}</Tex> 仍以 <Tex>{T`g^n\delta_0^2`}</Tex> 為準。<ClaimTag kind="approx" />）
          </p>
          <p>
            <strong><Tex>\Phi</Tex>（標準常態的累積分布函數，CDF）</strong>：<Tex>{T`\Phi(z)=P(t\le z)=\int_{-\infty}^{z}\varphi(t)\,dt`}</Tex>，<Tex>{T`t\sim\mathcal N(0,1)`}</Tex>——
            鐘形曲線在 <Tex>z</Tex> 左邊的面積。<Tex>{T`\Phi(0)=${tnum(normCdf(0), 4)}`}</Tex>、<Tex>{T`\Phi(1)=${tnum(normCdf(1), 4)}`}</Tex>、<Tex>{T`\Phi(-1)=${tnum(normCdf(-1), 4)}`}</Tex>；
            反過來，「左邊面積是 <Tex>p</Tex> 的位置」記為 <Tex>{T`z_p=\Phi^{-1}(p)`}</Tex>：<Tex>{T`z_{0.9}=${tnum(normInv(0.9), 5)}`}</Tex>、<Tex>{T`z_{0.1}=${tnum(normInv(0.1), 5)}`}</Tex>。
            一般的 <Tex>{T`L\sim\mathcal N(\nu,\tau^2)`}</Tex> 先標準化：<Tex>{T`P(L<\ell)=\Phi\big((\ell-\nu)/\tau\big)`}</Tex>。
          </p>
        </Prereq>
      </Section>
      <Section kind="formula" title="分位帶有多寬？多少比例的路徑已經收斂？">
        <p>
          Stability Lab 畫的 10–90% 分位帶與「收斂比例」不必只靠 Monte Carlo：<Tex>{T`\ln|\delta_n|`}</Tex> 是 iid 項的總和，它的平均與變異數可以<strong>精確</strong>算出，
          再用 CLT 近似分布的形狀，就能預測這兩個量。
        </p>
        <StepsBox
          title={tx`$\ln|\delta_n/\delta_0|\approx\mathcal N(n\lambda,\ ns^2)$ 與它的兩個推論`}
          steps={[
            { tex: T`L_n\equiv\ln\frac{|\delta_n|}{|\delta_0|}=\sum_{k=0}^{n-1}Y_k,\qquad Y_k=\ln|1-\mu x_k^2|`, why: tx`第 4 節的乘積取對數；$Y_k$ 是 iid（無雜訊）。` },
            { tex: T`E[L_n]=n\,E[Y]=n\lambda`, why: tx`期望值的線性；$E[Y]$ 就是 Lyapunov 指數 $\lambda$。這一步是精確的。` },
            { tex: T`\operatorname{Var}(L_n)=n\operatorname{Var}(Y)=n\,s^2,\qquad s^2\equiv E[Y^2]-\lambda^2`, why: tx`獨立項的變異數相加（交叉項 $E[(Y_j-\lambda)(Y_k-\lambda)]=0$）。這一步也是精確的。` },
            { tex: T`L_n\ \approx\ \mathcal N\big(n\lambda,\ n s^2\big)`, why: tx`中央極限定理：只有「形狀是常態」這件事是近似（$n$ 越大越準）。` },
            { tex: T`P\big(|\delta_n|<\varepsilon|\delta_0|\big)=P(L_n<\ln\varepsilon)\approx\Phi\!\Big(\frac{\ln\varepsilon-n\lambda}{s\sqrt n}\Big)`, why: tx`兩邊取 $\ln$（遞增函數），再把常態標準化：減平均 $n\lambda$、除以標準差 $s\sqrt n$。` },
            { tex: T`L_n^{(p)}\approx n\lambda+z_p\,s\sqrt n,\qquad z_{0.1}=${tnum(normInv(0.1), 5)},\ z_{0.9}=${tnum(normInv(0.9), 5)}`, why: tx`$p$ 分位數：解 $\Phi\big((L-n\lambda)/(s\sqrt n)\big)=p$。中位數（$z_{0.5}=0$）就是典型路徑 $n\lambda$。` },
            { tex: T`n\lambda+z_{0.9}\,s\sqrt n<0\iff n>\Big(\frac{z_{0.9}\,s}{\lambda}\Big)^2\qquad(\lambda<0)`, why: tx`中心以 $n$ 下降、帶寬只以 $\sqrt n$ 變寬，所以夠久以後連 90% 分位都低於起點；$|\lambda|$ 越小要等越久。` },
          ]}
        />
        <FBlock id="F-03.18" />
        <CltTable />
        <p>
          <Tex>{T`\mu=2`}</Tex>（mean pole 恰為 <Tex>{T`-1`}</Tex>）、<Tex>{T`n=200`}</Tex> 的預測就是勘誤 E14 的那個數字：驗算文件的 Python Monte Carlo 量到 83.25%，本站單元測試的 Monte Carlo 也落在同一處。
          <Tex>{T`\mu=2.3`}</Tex> 時 <Tex>{T`|\lambda|`}</Tex> 很小而 <Tex>s</Tex> 很大：200 步時只有約一半路徑低於 <Tex>{T`10^{-3}|\delta_0|`}</Tex>，要到上表最右欄那麼多步，
          九成的路徑才「開始」低於起點——這就是「almost-sure 收斂」在界限附近的真實樣貌：<strong>會收斂，但你可能等不到</strong>。
          <ClaimTag kind="approx" /> <Erratum id="E14" />
        </p>
        <HC id="HC-03.7">
          {tx`上表的每一列都可以查表手算：代入該列的 $\lambda$、$s$、$n$（預設就是 $\mu=2$、$n=200$ 那一列），先算 $z$ 再查 $\Phi(z)$，看看是不是 83%。`}
        </HC>
        <ModeGate min="engineer">
          <CodeBlock
            source={stabilitySrc}
            region="cltPrediction"
            path="src/simulation/models/scalarStability.ts"
            title="CLT 預測：收斂比例與分位數"
            caption={T`Stability Lab 的「收斂比例」圖（虛線）與主圖的「CLT 預測 10% / 90%」就是呼叫 cltConvergedFraction 與 cltLog10Quantile；cltZScore 是上面手算題 HC-03.7 的 $z$。$s^2$ 由 logFactorVariance 以數值積分計算。`}
          />
        </ModeGate>
        <ModeGate min="research">
          <p className="small">
            Research：<Tex>{T`Y=\ln|1-\mu x^2|`}</Tex> 的分布左偏（<Tex>{T`1-\mu x^2`}</Tex> 靠近 0 時 <Tex>{T`Y\to-\infty`}</Tex>），CLT 的偏態修正（Edgeworth 展開）約為{' '}
            <Tex>{T`O(1/\sqrt n)`}</Tex>；<Tex>{T`n`}</Tex> 只有十幾步時預測可差幾個百分點。<Tex>{T`E[Y^2]`}</Tex> 在 <Tex>{T`x^2=1/\mu`}</Tex> 有可積的 <Tex>{T`(\ln)^2`}</Tex> 奇點，
            程式以 <Tex>{T`t=t_0\pm L\,w^4`}</Tex> 代換後直接用 <Tex>w</Tex> 表示對數的自變數，避免浮點相消；結果與 Python（scipy）自適應積分的參考值相差約 <Tex>{T`10^{-9}`}</Tex> 以內（單元測試）。
            有限清單若含 <Tex>{T`1-\mu x^2=0`}</Tex> 的值，<Tex>{T`Y=-\infty`}</Tex>，<Tex>{T`s^2`}</Tex> 沒有定義（路徑在有限步內恰好歸零）。
          </p>
        </ModeGate>
      </Section>
      <Section kind="formula" title="天真估計量的真實標準誤（可以精確算出來）">
        <StepsBox
          title={tx`天真估計 $\frac1M\sum_i\delta_{n,i}^2$ 的標準誤（SE）`}
          steps={[
            { tex: T`\hat S=\frac1M\sum_{i=1}^{M}\delta_{n,i}^2`, why: tx`天真估計：$M$ 條獨立路徑的 $\delta_n^2$ 直接平均。` },
            { tex: T`\operatorname{Var}(\hat S)=\frac{\operatorname{Var}(\delta_n^2)}{M}=\frac{E[\delta_n^4]-E[\delta_n^2]^2}{M}`, why: tx`獨立樣本平均的變異數 = 單一樣本變異數 $\div M$；再用 $\operatorname{Var}(Y)=E[Y^2]-E[Y]^2$（$Y=\delta_n^2$）。` },
            { tex: T`E[\delta_n^4]=h(\mu)^n\,\delta_0^4,\qquad h=E\big[(1-\mu x^2)^4\big]`, why: tx`與 MSD 遞迴同樣的獨立性論證，只是換成四次方（需要 $E[x^8]$ 有限）。` },
            { tex: T`h=1-4\mu P_x+6\mu^2M_4-4\mu^3M_6+\mu^4M_8`, why: tx`二項式展開 $(1-\mu x^2)^4$ 再取期望值，$M_6=E[x^6]$、$M_8=E[x^8]$（Gaussian：$M_6=15$、$M_8=105$）。` },
          ]}
        />
        <FBlock id="F-03.16" />
        <p>
          代入 <Tex>{T`\mu=${nums.mu},\ n=${nums.n},\ M=${nums.M}`}</Tex>（Gaussian）：<Tex>{T`g=${tnum(nums.g, 4)}`}</Tex>、<Tex>{T`h=${tnum(nums.h, 5)}`}</Tex>，
          精確 <Tex>{T`E[\delta_5^2]=g^5=${tnum(nums.exact, 5)}`}</Tex>，但天真估計的真實 SE 約 <Tex>{T`${tnum(nums.se, 3)}`}</Tex>——是答案本身的{' '}
          <Tex>{T`${tnum(nums.se / nums.exact, 2)}`}</Tex> 倍。<ClaimTag kind="exact" /> 偏偏每一批用同一批樣本算出的<strong>樣本</strong> SE 通常遠小於這個值（下面的實驗直接量出兩者的比值），
          所以 CI 又窄又偏，看起來卻很「準」。
        </p>
        <Callout kind="danger" title={tx`不要用長時間 $\delta^2$ 的樣本平均驗證 $2/3$ 界限`}>
          規格 §17 寫「隨機統計則使用多 seeds 和信賴界限」。對 <Tex>{T`\delta_n^2`}</Tex> 這種 heavy-tail 量，「樣本平均 <Tex>{T`\pm`}</Tex> 樣本 SE」的 CI 會嚴重失效（下面的實驗可以直接量到覆蓋率）。
          本站 T03 的驗證方式（勘誤 E14）：
          <ol>
            <li>
              封閉式：<Tex>{T`g(\mu)=1-2\mu+3\mu^2`}</Tex>、<Tex>{T`g(2/3)=1`}</Tex>，與 golden vector 逐項比對到 <Tex>{T`10^{-12}`}</Tex>；
            </li>
            <li>
              <strong>單步</strong> Monte Carlo 估計 <Tex>{T`E[(1-\mu x^2)^2]`}</Tex>：只抽一步，變異數 <Tex>{T`h-g^2`}</Tex> 有限且小，<Tex>{T`\pm4`}</Tex> SE 判定可信；
            </li>
            <li>
              用 <Tex>{T`h^n`}</Tex> 算出的<strong>真實</strong> SE（不是樣本 SE）檢查 <Tex>{T`\mu=0.5`}</Tex>（MS 穩定區）的 <Tex>{T`E[\delta_5^2]=0.75^5`}</Tex>；
            </li>
            <li>反面測試：<Tex>{T`\mu=0.8`}</Tex> 時天真 CI 的覆蓋率明顯低於 95%。</li>
          </ol>
        </Callout>
        <CodeBlock source={stabilitySrc} region="oneStepMc" path="src/simulation/models/scalarStability.ts" title="單步 Monte Carlo（T03 驗證核心）" />
        <ModeGate min="engineer">
          {pyCode && (
            <CodeBlock
              source={pyCode}
              lang="python"
              path="golden/lms_pll_golden/lms.py"
              title="Python golden：mc_mean_square_factor"
              caption="golden 端以同樣的「單步」方式估計 MSD 每步因子；TypeScript 與 Python 各自用自己的亂數，彼此以封閉式為共同參考。"
            />
          )}
        </ModeGate>
      </Section>
      <Section kind="explore" title="動手觀察：天真 CI 的實際覆蓋率">
        <p>
          試試看：(1) 預設 <Tex>{T`\mu=0.8`}</Tex>：覆蓋率遠低於 95%；(2) 把 <Tex>\mu</Tex> 降到 <Tex>{T`0.3`}</Tex>（<Tex>{T`h(0.3)<1`}</Tex>：<Tex>{T`\operatorname{Var}(\delta_n^2)=(h^n-g^{2n})\delta_0^4`}</Tex> 隨 <Tex>n</Tex> 衰減）：覆蓋率回到約 95%；
          (3) 分布改成 <Tex>{T`\pm1`}</Tex>：<Tex>{T`\delta_n^2`}</Tex> 是確定值，CI 寬度為 0 且永遠正確；(4) 把每批路徑數加大 10 倍：覆蓋率只會慢慢改善——heavy tail 下「多跑一點」不是解藥。
        </p>
        <HeavyTailDemo />
      </Section>
    </>
  )
}
