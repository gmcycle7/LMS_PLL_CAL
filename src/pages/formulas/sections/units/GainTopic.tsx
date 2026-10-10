import { Callout, ClaimTag, CodeBlock, Prereq, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import { refValues, T13_SETUP } from '../../refValues'
import { texNum, texPct } from '../../format'
import { Collapsible, ErratumTag, FormulaLinks, Gate, PageLinks } from '../../common'
import { Topic } from './Topic'

/**
 * 2.3 μ、K_q、C、K、g 的單位與 sum / average；2.4 Code 正規化、LSB 與 0/1 → ±1。
 * 數字由 refValues()（calLoop、comparator.ts 的 meanGmacEncoding …）計算。
 */
export function MuUnitsTopic() {
  const r = refValues()
  const N = T13_SETUP.N
  return (
    <Topic id="muUnits" no="2.3" title="$\mu$、$K_q$、$C$、$K$、$g$ 的單位：學習率到底有沒有單位？">
      <p>
        <strong>一個問題：</strong>規格 §12.1 寫 <Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex>，§8.4 卻寫 <Tex>{String.raw`\mu=1.2`}</Tex>（沒有單位）。兩個都叫學習率，哪一個才對？兩個都對——只是{' '}
        <Tex>{String.raw`\mu`}</Tex> 在這兩處代表不同的東西（<ErratumTag eid="E13" />）。分辨的方法是做一次<strong>因次分析</strong>：把每個量的單位寫出來，等號兩邊的單位必須相同。
      </p>
      <Prereq title="因次分析：把單位當成代數符號一起算">
        <p>
          記號 <Tex>{'[y]'}</Tex> 表示「<Tex>{'y'}</Tex> 的單位」。規則只有三條：（1）相加、相等的兩項單位必須相同；（2）相乘時單位相乘、相除時單位相除；（3）
          <Tex>{String.raw`\exp`}</Tex>、<Tex>{String.raw`\ln`}</Tex>、<Tex>{String.raw`\operatorname{erf}`}</Tex>、<Tex>{String.raw`\cos`}</Tex> 這類函數的引數必須無因次。 例：速度 × 時間 ={' '}
          <Tex>{String.raw`\mathrm{(m/s)\times s=m}`}</Tex>。只要某一步的單位對不上，式子一定寫錯了。
        </p>
      </Prereq>
      <StepDerivation
        title={
          <>
            一步一步：從 <Tex>{String.raw`w_{k+1}=w_k+\mu G_k`}</Tex> 推出每個量的單位（本站約定：code 正規化，<Tex>{'[x]=[u]=1'}</Tex>）
          </>
        }
        steps={[
          {
            tex: String.raw`e[n]=(a-w_k)\,u[n]+v[n]\ \Rightarrow\ [a]=[w]=\frac{[e]}{[u]}=\mathrm{fs}`,
            why: (
              <>
                PD 誤差 <Tex>{'e'}</Tex> 是時間（fs）；<Tex>{'u'}</Tex> 無因次，所以時間單位由係數 <Tex>{'a,w'}</Tex> 承載。
              </>
            ),
          },
          {
            tex: String.raw`G_k=\frac1N\sum_{n\in k}q[n]\,x[n]\ \Rightarrow\ [G]=[q][x]=1`,
            why: (
              <>
                <Tex>{String.raw`q=\pm1`}</Tex> 沒有單位，<Tex>{'x'}</Tex> 是正規化 code；除以 <Tex>{'N'}</Tex>（個數）也不帶單位。
              </>
            ),
          },
          {
            tex: String.raw`w_{k+1}=w_k+\mu\,G_k\ \Rightarrow\ [\mu]=\frac{[w]}{[G]}=\mathrm{fs}`,
            why: <>相加的兩項單位相同（規則 1）：<Tex>{String.raw`\mu G`}</Tex> 必須是 fs。</>,
          },
          {
            tex: String.raw`E[q\mid e_{\det}]=\operatorname{erf}\!\Big(\frac{e_{\det}}{\sqrt2\,\sigma_v}\Big)\approx\underbrace{\frac{\sqrt{2/\pi}}{\sigma_v}}_{K_q}\,e_{\det}\ \Rightarrow\ [K_q]=\frac{1}{[e]}=\mathrm{fs^{-1}}`,
            why: (
              <>
                <Tex>{String.raw`\operatorname{erf}`}</Tex> 的引數無因次（規則 3），所以 <Tex>{String.raw`\sigma_v`}</Tex> 與 <Tex>{'e'}</Tex> 同單位；一階泰勒展開{' '}
                <Tex>{String.raw`\operatorname{erf}(z)\approx\frac{2}{\sqrt\pi}z`}</Tex> 給出 <Tex>{'K_q'}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`E[G_k]\approx K_q\,E[x\,u]\,\delta_k=K_q\,C\,\delta_k\triangleq K\,\delta_k\ \Rightarrow\ [K]=\mathrm{fs^{-1}}\cdot1=\mathrm{fs^{-1}}`,
            why: (
              <>
                代入 <Tex>{String.raw`e_{\det}=\delta_ku`}</Tex> 再對 code 取期望值；<Tex>{'C=E[xu]'}</Tex> 無因次，所以 <Tex>{'K'}</Tex> 與 <Tex>{'K_q'}</Tex> 同單位。
              </>
            ),
          },
          {
            tex: String.raw`\delta_{k+1}=\delta_k-\mu K\delta_k=(1-g)\,\delta_k,\qquad g\triangleq\mu K\ \Rightarrow\ [g]=\mathrm{fs}\times\mathrm{fs^{-1}}=1`,
            why: (
              <>
                兩邊用 <Tex>{'a'}</Tex> 去減並取平均（<Tex>{String.raw`\delta=a-w`}</Tex>）。pole <Tex>{'p=1-g'}</Tex> 要和 1 相減，所以 <Tex>{'g'}</Tex> 一定無因次——這是檢查單位最快的方法。
              </>
            ),
          },
          {
            tex: String.raw`g=${T13_SETUP.mu}\,\mathrm{fs}\times${texNum(r.loop.K, 6)}\,\mathrm{fs^{-1}}=${texNum(r.loop.g, 6)},\qquad p=${texNum(r.loop.p, 6)}`,
            why: (
              <>
                代入 T13：<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{'C=1'}</Tex>（由 calLoop 算出）。
              </>
            ),
          },
        ]}
        result={String.raw`[w]=[\mu]=\mathrm{fs},\qquad [K_q]=[K]=\mathrm{fs^{-1}},\qquad [x]=[u]=[C]=[G]=[g]=[p]=1`}
      />
      <p>
        這不是唯一自洽的寫法。只要 <Tex>{'g'}</Tex> 無因次，時間單位放在係數或放在 regressor 都可以；<strong>不行的是混用</strong>（規格 §0 寫「<Tex>{'u'}</Tex> 和 PD error 單位一致」，§12.1 又用{' '}
        <Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex>，兩者湊在一起 <Tex>{'g'}</Tex> 會帶 <Tex>{String.raw`\mathrm{fs^2}`}</Tex>）：
      </p>
      <div className="table-wrap">
        <table className="fr-table fr-units-table">
          <thead>
            <tr>
              <th>約定</th>
              <th>
                <Tex>{'[x],[u]'}</Tex>
              </th>
              <th>
                <Tex>{'[a],[w]'}</Tex>
              </th>
              <th>
                <Tex>{'[G]'}</Tex>
              </th>
              <th>
                <Tex>{String.raw`[\mu]=[w]/[G]`}</Tex>
              </th>
              <th>
                <Tex>{String.raw`[K]=[K_q][x][u]`}</Tex>
              </th>
              <th>
                <Tex>{String.raw`[g]=[\mu][K]`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="fr-focus">
              <td data-label="約定">
                <strong>本站</strong>：code 正規化，時間由係數承載
              </td>
              <td data-label="[x]">1</td>
              <td data-label="[w]">fs</td>
              <td data-label="[G]">1</td>
              <td data-label="[μ]">fs</td>
              <td data-label="[K]">
                <Tex>{String.raw`\mathrm{fs^{-1}}`}</Tex>
              </td>
              <td data-label="[g]">1 ✓</td>
            </tr>
            <tr>
              <td data-label="約定">code 以 LSB 計（§2.4）</td>
              <td data-label="[x]">LSB</td>
              <td data-label="[w]">fs/LSB</td>
              <td data-label="[G]">LSB</td>
              <td data-label="[μ]">
                <Tex>{String.raw`\mathrm{fs/LSB^2}`}</Tex>
              </td>
              <td data-label="[K]">
                <Tex>{String.raw`\mathrm{LSB^2/fs}`}</Tex>
              </td>
              <td data-label="[g]">1 ✓</td>
            </tr>
            <tr>
              <td data-label="約定">時間由 regressor 承載（係數是無因次 gain）</td>
              <td data-label="[x]">fs</td>
              <td data-label="[w]">1</td>
              <td data-label="[G]">fs</td>
              <td data-label="[μ]">
                <Tex>{String.raw`\mathrm{fs^{-1}}`}</Tex>
              </td>
              <td data-label="[K]">fs</td>
              <td data-label="[g]">1 ✓</td>
            </tr>
            <tr>
              <td data-label="約定">
                <strong>混用</strong>（規格 §0 的 <Tex>{'u'}</Tex> ＋ §12.1 的 <Tex>{String.raw`\mu`}</Tex>）
              </td>
              <td data-label="[x]">fs</td>
              <td data-label="[w]">fs</td>
              <td data-label="[G]">fs</td>
              <td data-label="[μ]">fs</td>
              <td data-label="[K]">fs</td>
              <td data-label="[g]">
                <Tex>{String.raw`\mathrm{fs^2}`}</Tex> ✗
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 className="fr-sub">Sum 與 Average：同一個 <Tex>{String.raw`\mu`}</Tex>，差 <Tex>{'N'}</Tex> 倍的迴路增益</h4>
      <p>
        §0 定義 <Tex>{'G_k'}</Tex> 是<strong>平均</strong>。但硬體的 accumulator 天生輸出<strong>總和</strong>；如果後面沒有右移 <Tex>{String.raw`\log_2N`}</Tex> 位（或沒有把{' '}
        <Tex>{String.raw`\mu`}</Tex> 相應縮小），就等於把增益放大了 <Tex>{'N'}</Tex> 倍（<ErratumTag eid="E18" />）。
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`G_k^{\mathrm{sum}}=\sum_{n\in k}q[n]x[n]=N\,G_k^{\mathrm{avg}}`, why: '總和就是平均乘上個數。' },
          { tex: String.raw`w_{k+1}=w_k+\mu\,G_k^{\mathrm{sum}}=w_k+(\mu N)\,G_k^{\mathrm{avg}}`, why: <>代入更新式：對 average 的定義來說，有效步長變成 <Tex>{String.raw`\mu N`}</Tex>。</> },
          { tex: String.raw`g^{\mathrm{sum}}=\mu\,K\,N=${texNum(r.loop.g, 5)}\times${N}=${texNum(r.loop.gSum, 5)},\qquad p=1-g=${texNum(r.loop.pSum, 5)}`, why: <>T13 的 <Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex> 直接搬到 sum mode：pole 遠在單位圓外。</> },
          {
            tex: String.raw`\mu^{\mathrm{sum}}=\frac{\mu^{\mathrm{avg}}}{N}=\frac{${T13_SETUP.mu}}{${N}}=${texNum(r.units.muSumEquivalent)}\ \mathrm{fs}`,
            why: <>要得到同一個 <Tex>{'g'}</Tex>，sum mode 的步長必須除以 <Tex>{'N'}</Tex>（<Tex>{`N=${N}`}</Tex> 時，硬體上就是多右移 <Tex>{String.raw`\log_2N=${Math.log2(N)}`}</Tex> 位）。</>,
          },
        ]}
      />
      <Callout kind="danger" title="反面例子：線性模型說「發散」，1-bit 硬體卻不會爆掉——反而更難發現">
        <p>
          <Tex>{String.raw`g=${texNum(r.loop.gSum)}`}</Tex> 的線性遞迴每個 block 誤差放大 <Tex>{String.raw`${texNum(Math.abs(r.loop.pSum))}`}</Tex> 倍。但真正的 1-bit GMAC 有界（
          <Tex>{String.raw`|G^{\mathrm{sum}}|\le N`}</Tex>），所以係數不會變成無限大，而是在 <Tex>{String.raw`\pm\mu N`}</Tex> 的量級來回跳（數萬 fs 的 limit cycle）。暫存器看起來「有在動、沒有溢位」，其實完全沒在校正。
          下面的換算器可以直接載入「Sum vs Average」preset 重現。
        </p>
      </Callout>

      <h4 className="fr-sub">
        <Tex>{String.raw`\mu`}</Tex> 在各章代表什麼
      </h4>
      <div className="table-wrap">
        <table className="fr-table fr-mu-table">
          <thead>
            <tr>
              <th>演算法／出處</th>
              <th>更新式</th>
              <th>
                <Tex>{String.raw`[\mu]`}</Tex>
              </th>
              <th>無因次的組合（決定 pole）</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="出處">Conventional LMS（Ch00–03）</td>
              <td data-label="更新式">
                <Tex>{String.raw`w\leftarrow w+\mu\,e\,x`}</Tex>
              </td>
              <td data-label="[μ]">
                <Tex>{String.raw`[w]/([e][x])=1/[x]^2`}</Tex>
              </td>
              <td data-label="無因次">
                <Tex>{String.raw`\mu x^2`}</Tex>：pole <Tex>{String.raw`1-\mu x^2`}</Tex>
              </td>
              <td data-label="備註">
                <Tex>{'x'}</Tex> 放大 10 倍，<Tex>{String.raw`\mu_{\max}=2/x^2`}</Tex> 縮小 100 倍：<Tex>{String.raw`x=${r.units.lmsScale.x1}\Rightarrow${texNum(r.units.lmsScale.muMax1)}`}</Tex>、
                <Tex>{String.raw`x=${r.units.lmsScale.x2}\Rightarrow${texNum(r.units.lmsScale.muMax2)}`}</Tex>
              </td>
            </tr>
            <tr>
              <td data-label="出處">Sign-Error LMS（Ch02）</td>
              <td data-label="更新式">
                <Tex>{String.raw`w\leftarrow w+\mu\operatorname{sign}(e)\,x`}</Tex>
              </td>
              <td data-label="[μ]">
                <Tex>{'[w]/[x]'}</Tex>
              </td>
              <td data-label="無因次">
                <Tex>{String.raw`\mu K_qx^2`}</Tex>（有雜訊時）
              </td>
              <td data-label="備註">
                每一步固定走 <Tex>{String.raw`\mu|x|`}</Tex>（<Tex>{'w'}</Tex> 的單位），與誤差大小無關
              </td>
            </tr>
            <tr>
              <td data-label="出處">Sign-Sign LMS（Ch02）</td>
              <td data-label="更新式">
                <Tex>{String.raw`w\leftarrow w+\mu\operatorname{sign}(e)\operatorname{sign}(x)`}</Tex>
              </td>
              <td data-label="[μ]">
                <Tex>{'[w]'}</Tex>
              </td>
              <td data-label="無因次">—</td>
              <td data-label="備註">
                <Tex>{String.raw`\mu`}</Tex> 本身就是每一步的位移
              </td>
            </tr>
            <tr>
              <td data-label="出處">Block Sign-GMAC，average（Ch04–07、11–14）</td>
              <td data-label="更新式">
                <Tex>{String.raw`w_{k+1}=w_k+\mu G_k`}</Tex>
              </td>
              <td data-label="[μ]">
                <Tex>{String.raw`[w]/[x]=\mathrm{fs}`}</Tex>
              </td>
              <td data-label="無因次">
                <Tex>{String.raw`g=\mu K_qC`}</Tex>
              </td>
              <td data-label="備註">本站預設</td>
            </tr>
            <tr>
              <td data-label="出處">Block Sign-GMAC，sum</td>
              <td data-label="更新式">
                <Tex>{String.raw`w_{k+1}=w_k+\mu\textstyle\sum qx`}</Tex>
              </td>
              <td data-label="[μ]">
                <Tex>{String.raw`\mathrm{fs}`}</Tex>
              </td>
              <td data-label="無因次">
                <Tex>{String.raw`g=\mu K_qC\,N`}</Tex>
              </td>
              <td data-label="備註">
                單位相同、數值差 <Tex>{'N'}</Tex> 倍——最容易漏掉
              </td>
            </tr>
            <tr>
              <td data-label="出處">Ch08 §8.2–8.4、T09</td>
              <td data-label="更新式">
                <Tex>{String.raw`\delta_{k+1}=\delta_k-\mu\,(\cdots)`}</Tex>
              </td>
              <td data-label="[μ]">1</td>
              <td data-label="無因次">
                <Tex>{String.raw`\mu`}</Tex> 本身
              </td>
              <td data-label="備註">
                這裡的「<Tex>{String.raw`\mu`}</Tex>」是 <Tex>{String.raw`K\equiv1`}</Tex> 的正規化步長，也就是 <Tex>{'g'}</Tex>
              </td>
            </tr>
            <tr>
              <td data-label="出處">Ch09–10（MIMO）</td>
              <td data-label="更新式">
                <Tex>{String.raw`\boldsymbol\delta_{k+1}\approx(\mathbf I-\mu K_q\mathbf C)\boldsymbol\delta_k`}</Tex>
              </td>
              <td data-label="[μ]">
                fs（規格的數字假設 <Tex>{String.raw`K_q\equiv1`}</Tex>）
              </td>
              <td data-label="無因次">
                <Tex>{String.raw`\mu K_q\lambda_i`}</Tex>
              </td>
              <td data-label="備註">
                慢 mode 95% 衰減：<Tex>{String.raw`K_q\equiv1`}</Tex> 時 {r.mimo.blocks95} blocks；物理的 <Tex>{String.raw`K_q=${texNum(r.mimo.kqPhysical)}\,\mathrm{fs^{-1}}`}</Tex> 時{' '}
                {r.mimo.physicalBlocks95} blocks（<ErratumTag eid="E05" />）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Collapsible
        title={
          <>
            核心程式碼：網站怎麼算 <Tex>{String.raw`K,\ g,\ p,\ \sigma_w`}</Tex>（calLoop，第 12 章與本頁共用）
          </>
        }
      >
        <CodeBlock
          source={calNoiseSrc}
          region="calLoop"
          path="src/simulation/models/calNoise.ts"
          caption="每一行的註解都寫了單位。注意 sum mode 只多乘一個 $N$；$\sigma_\eta^2$ 的預設值也跟著 gm_mode 改變（average：$1/N$；sum：$N$）。"
        />
      </Collapsible>
      <Callout kind="ok" title="看到任何一個 $\mu$ 的數字，先問三件事">
        <ol className="fr-compact">
          <li>
            係數 <Tex>{'w'}</Tex> 帶什麼單位（fs、LSB、還是無因次）？code <Tex>{'x'}</Tex> 的「1」代表什麼？
          </li>
          <li>
            <Tex>{'G'}</Tex> 是 sum 還是 average？
          </li>
          <li>
            <Tex>{'K_q'}</Tex>（或整個 <Tex>{'K'}</Tex>）有沒有被正規化成 1？
          </li>
        </ol>
        <p className="small">三個都回答之後，把 <Tex>{'g'}</Tex> 算出來：它必須無因次，而且（無延遲時）落在 <Tex>{'0<g<2'}</Tex>。</p>
      </Callout>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch04', 'ch08', 'ch12', 'ch14']} />{' '}
        <FormulaLinks ids={['F-04.5', 'F-06.3', 'F-12.5', 'F-14.15']} />
      </div>
    </Topic>
  )
}

export function CodeUnitsTopic() {
  const r = refValues()
  const u = r.units
  const s = u.scale
  const enc = r.encoding
  return (
    <Topic id="codeUnits" no="2.4" title="Code 正規化、LSB 與 $0/1\to\pm1$：一個「1」可以有很多種意思">
      <p>
        <strong>一個問題：</strong>數學裡的 regressor 是「unit-RMS」的 <Tex>{'x'}</Tex>，RTL 裡的 code 卻是整數（例如滿刻度 ±16）。兩者只差一個倍率 <Tex>{'k_x'}</Tex>：
        <Tex>{String.raw`x'=k_x\,x`}</Tex>。把同一個 <Tex>{String.raw`\mu`}</Tex> 的數字直接搬過去會怎樣？（規格附錄 B 第 9 點；<ErratumTag eid="E13" />）
      </p>
      <StepDerivation
        title={
          <>
            一步一步：code 放大 <Tex>{'k_x'}</Tex> 倍時，哪些量要跟著改
          </>
        }
        steps={[
          {
            tex: String.raw`e=(a-w)\,x=\frac{a-w}{k_x}\,(k_x\,x)=(a'-w')\,x',\qquad a'=\frac{a}{k_x},\ \ w'=\frac{w}{k_x}`,
            why: <>物理上的 DTC 誤差 <Tex>{'e'}</Tex> 不能因為記帳方式改變：code 數字變大，係數的數字就要等比例變小。</>,
          },
          { tex: String.raw`G'_k=\frac1N\sum q\,x'=k_x\,G_k`, why: <>GMAC 累加的是放大後的 code；<Tex>{'q'}</Tex> 只看 <Tex>{'e'}</Tex> 的正負，不受影響。</> },
          {
            tex: String.raw`w'_{k+1}=w'_k+\mu'G'_k\ \xrightarrow{\ \times k_x\ }\ w_{k+1}=w_k+\mu'k_x^2\,G_k`,
            why: <>把新變數的更新式兩邊乘上 <Tex>{'k_x'}</Tex>，換回原本的 <Tex>{'w'}</Tex> 與 <Tex>{'G'}</Tex>。</>,
          },
          { tex: String.raw`\mu=\mu'k_x^2\ \Longleftrightarrow\ \mu'=\frac{\mu}{k_x^2}`, why: <>與原本的 <Tex>{String.raw`w_{k+1}=w_k+\mu G_k`}</Tex> 逐項比較。</> },
          {
            tex: String.raw`C'=E[x'u']=k_x^2\,C\ \Rightarrow\ g'=\mu'K_qC'=\frac{\mu}{k_x^2}\,K_q\,k_x^2C=g`,
            why: <>驗算：<Tex>{'g'}</Tex>（以及 pole、收斂速度）是物理量，與 code 的記帳尺度無關。</>,
          },
          {
            tex: String.raw`k_x=${s.kx}:\quad \mu'=\frac{${T13_SETUP.mu}}{${s.kx * s.kx}}=${texNum(s.muScaled)},\quad C'=${s.cScaled},\quad g'=${texNum(s.gScaled, 6)}\ (=g)`,
            why: <>代入數字（calLoop 計算）。若忘了改 <Tex>{String.raw`\mu`}</Tex>：<Tex>{String.raw`g=${texNum(s.gIfMuNotRescaled)}>2`}</Tex>，不穩定。</>,
          },
        ]}
        result={String.raw`x\to k_xx:\qquad w\to\frac{w}{k_x},\quad G\to k_xG,\quad C\to k_x^2C,\quad \mu\to\frac{\mu}{k_x^2},\quad g\to g`}
      />
      <h4 className="fr-sub">Gain register 的 LSB：fs ↔ LSB</h4>
      <p>
        係數最後存在 gain register 裡，以 LSB 計。要把 §12 的雜訊（fs）和 §13 的量化（LSB）放在一起比，需要 LSB 的尺寸 <Tex>{String.raw`\Delta_{\mathrm{LSB}}`}</Tex>（fs/LSB；規格原文沒有給，
        <ErratumTag eid="E13" /> 補上 JSON 欄位 <span className="mono">gain_lsb_fs</span>）：
      </p>
      <TexBlock>{String.raw`w_{\mathrm{code}}=\frac{w}{\Delta_{\mathrm{LSB}}}\qquad\text{例：}\Delta_{\mathrm{LSB}}=${u.lsbFs}\,\mathrm{fs/LSB}\ \Rightarrow\ \sigma_w=${texNum(r.loop.sigmaW)}\,\mathrm{fs}=${texNum(u.sigmaWLsb)}\,\mathrm{LSB}`}</TexBlock>
      <p className="small">
        這個例子裡係數雜訊約 <Tex>{texNum(u.sigmaWLsb, 2)}</Tex> 個 LSB，量化誤差（<Tex>{String.raw`\le0.5`}</Tex> LSB）被雜訊淹沒；反過來若 <Tex>{String.raw`\Delta_{\mathrm{LSB}}\gg\sigma_w`}</Tex>，係數會卡在量化階上形成 limit cycle（第 13 章）。
        <Tex>{String.raw`\Delta_{\mathrm{LSB}}`}</Tex> 的數值是示例。
      </p>

      <h4 className="fr-sub">0/1 位元必須先映射成 ±1</h4>
      <p>
        Comparator 在硬體裡輸出一個位元 <Tex>{String.raw`b\in\{0,1\}`}</Tex>；數學裡的 <Tex>{'q'}</Tex> 是 <Tex>{String.raw`\pm1`}</Tex>。兩者的關係是{' '}
        <Tex>{'q=2b-1'}</Tex>。如果 RTL 直接把 <Tex>{'b'}</Tex> 當成 <Tex>{'q'}</Tex> 去乘 code：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`b=\frac{q+1}{2}`, why: <>把 <Tex>{'q=2b-1'}</Tex> 反過來寫。</> },
          {
            tex: String.raw`G_k^{(b)}=\frac1N\sum b\,x=\frac12\cdot\frac1N\sum q\,x+\frac12\cdot\frac1N\sum x=\frac{G_k}{2}+\frac{\bar x_k}{2}`,
            why: <>代入後拆成兩項：正確的 GMAC 只剩一半，另外多出「code 的 block 平均」的一半。</>,
          },
          {
            tex: String.raw`E[G^{(b)}]\approx\frac{K}{2}\,\delta+\frac{E[x]}{2}`,
            why: (
              <>
                取期望值（<Tex>{String.raw`E[G]\approx K\delta`}</Tex>）。第一項：迴路增益減半；第二項：一個與 <Tex>{String.raw`\delta`}</Tex> 無關的常數推力。
              </>
            ),
          },
          {
            tex: String.raw`E[G^{(b)}]=0\ \Rightarrow\ \delta^*=-\frac{E[x]}{K}\ \Rightarrow\ w^*=a+\frac{E[x]}{K_q\,E[x^2]}`,
            why: (
              <>
                固定點是平均更新為零的地方：<Tex>{'E[x]\\ne0'}</Tex> 時係數收斂到<strong>錯的值</strong>，而且 GMAC 輸出一樣歸零，看起來一切正常（identity path：<Tex>{String.raw`C=E[x^2]`}</Tex>）。
              </>
            ),
          },
          {
            tex: String.raw`E[x]=${texNum(enc.meanX)},\ E[x^2]=${texNum(enc.ex2)}:\quad E[G^{(b)}]\big|_{w=a}=${texNum(enc.meanUpdateAtTruth)},\qquad w^*-a\approx${texNum(enc.shiftLinear)}\ \mathrm{fs}\ \ (\text{精確 }${texNum(enc.shiftFs)}\ \mathrm{fs})`,
            why: (
              <>
                T04 反面測試：code 取 <Tex>{String.raw`\{${enc.values.join(',')}\}`}</Tex> 等機率、<Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>。線性化估計比精確值（解{' '}
                <Tex>{String.raw`\sum p_xx\,\Phi((a-w)x/\sigma_v)=0`}</Tex>）小 <Tex>{texPct(1 - enc.shiftLinear / enc.shiftFs, 2)}</Tex>，因為偏移已達{' '}
                <Tex>{String.raw`${texNum(enc.shiftFs / 100, 2)}\,\sigma_v`}</Tex>，S 曲線開始彎。
              </>
            ),
          },
        ]}
      />
      <p className="small">
        零均值的 code（<Tex>{'E[x]=0'}</Tex>）不會偏：在 <Tex>{'w=a'}</Tex> 的平均更新是 <Tex>{texNum(enc.zeroMeanUpdate)}</Tex>，只有增益減半——所以這個 bug 在 ±1 PRBS 測試下看不出來，換成有 DC 的 DSM residue 才出現。
      </p>
      <Collapsible title="核心程式碼：正確與錯誤的位元編碼只差一行（comparator.ts，第 5 章與本頁共用）">
        <CodeBlock
          source={comparatorSrc}
          region="bitEncoding"
          path="src/simulation/models/comparator.ts"
          caption="bipolar：$E[q\mid x]=\operatorname{erf}(e/\sqrt2\sigma_v)$，在 $e=0$ 時為 0；unipolar：$E[b\mid x]=\Phi(e/\sigma_v)$，在 $e=0$ 時為 $\tfrac12$。"
        />
      </Collapsible>
      <Gate min="engineer">
        <p className="small">
          <strong>硬體對應：</strong>code 的正規化通常藏在兩個地方——DSM residue 送進 GMAC 前的位元寬度／小數點位置，以及 accumulator 輸出的右移量。兩者合起來就是這一節的 <Tex>{'k_x'}</Tex> 與{' '}
          sum／average；RTL review 時要把「<Tex>{String.raw`\mu`}</Tex> 暫存器的 1 LSB 對應多少 fs」寫成一條明確的換算式（Sign-off 頁）。
        </p>
      </Gate>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <ErratumTag eid="E07" /> <PageLinks ids={['ch04', 'ch05', 'ch13', 'signoff']} />{' '}
        <FormulaLinks ids={['F-04.7', 'F-04.16', 'F-13.1']} />
      </div>
    </Topic>
  )
}
