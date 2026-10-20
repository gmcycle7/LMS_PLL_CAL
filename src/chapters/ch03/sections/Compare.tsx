import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Plot, Section, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import stabilitySrc from '@/simulation/models/scalarStability.ts?raw'
import lmsPySrc from '../../../../golden/lms_pll_golden/lms.py?raw'
import { meanPole, meanSquareFactor } from '@/simulation/models/lms'
import { blockMeanSquareBound, stabilityBounds, xMoments } from '@/simulation/models/scalarStability'
import { FBlock, Fig, logGrid, pyDef, StepsBox, T, tnum, tx } from '../common'
import { CHART_BLOCK_GMAC, CHART_PLL_MAPPING, CHART_WHICH_BOUND, figRef } from '../diagrams'
import { EXAMPLE_DISTS } from './RandomMean'

function SummaryTable() {
  const gb = useMemo(() => stabilityBounds({ kind: 'gaussian', sigma: 1 }), [])
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>收斂的意義</th>
            <th>看什麼量</th>
            <th>每步判據</th>
            <th>{tx`Gaussian 界（$\sigma=1$）`}</th>
            <th>告訴工程師什麼</th>
            <th>標籤</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Mean</strong>（平均）
            </td>
            <td>
              <Tex>{T`E[\delta_n]`}</Tex>
            </td>
            <td>
              <Tex>{T`|1-\mu P_x|<1`}</Tex>
            </td>
            <td>
              <Tex>{T`0<\mu<${tnum(gb.meanMax)}`}</Tex>
            </td>
            <td>偏差（bias）會不會消失；正負可互相抵消，最弱</td>
            <td>
              <ClaimTag kind="exact" />
            </td>
          </tr>
          <tr>
            <td>
              <strong>Mean-square</strong>（MSD）
            </td>
            <td>
              <Tex>{T`E[\delta_n^2]`}</Tex>
            </td>
            <td>
              <Tex>{T`g=1-2\mu P_x+\mu^2M_4<1`}</Tex>
            </td>
            <td>
              <Tex>{T`0<\mu<2/3`}</Tex>
            </td>
            <td>有雜訊時穩態 MSD 是否有限；可做 RMS 預算（第 12、14 章）</td>
            <td>
              <ClaimTag kind="exact" />
            </td>
          </tr>
          <tr>
            <td>
              <strong>Almost-sure</strong>（樣本路徑）
            </td>
            <td>
              <Tex>{T`|\delta_n|`}</Tex> 的典型值
            </td>
            <td>
              <Tex>{T`\lambda=E\ln|1-\mu x^2|<0`}</Tex>
            </td>
            <td>
              <Tex>{T`0<\mu<${tnum(gb.asMax, 5)}`}</Tex>
            </td>
            <td>你在一次模擬 / 一顆晶片上看到的軌跡會不會收斂；不保證 RMS 有限</td>
            <td>
              <ClaimTag kind="exact" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function BlockBoundPlot() {
  const tokens = useThemeTokens()
  const data = useMemo<Data[]>(() => {
    const Ns = logGrid(1, 4096, 120)
    return EXAMPLE_DISTS.map(({ label, dist }, i) => {
      const m = xMoments(dist)
      return {
        x: Ns,
        y: Ns.map((N) => blockMeanSquareBound(m, N) * m.Px),
        name: label,
        mode: 'lines',
        line: { color: tokens.series[i], width: 2 },
      } as Data
    }).concat([{ x: [1, 4096], y: [2, 2], mode: 'lines', name: T`mean 界 $2/P_x$（$\times P_x = 2$）`, line: { color: tokens.textMuted, dash: 'dash', width: 1.5 } }])
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: 'block 長度 $N$（GMAC 累加筆數）' }, type: 'log' }, yaxis: { title: { text: T`$\mu_{\mathrm{MS}} \cdot P_x$（正規化 MS 界）` }, range: [0, 2.2] } }),
    [],
  )
  return (
    <Plot
      title={T`平均 $N$ 筆後，mean-square 界逼近 mean 界`}
      ariaLabel="block 平均筆數對 mean-square 界：逼近 mean 界"
      data={data}
      layout={layout}
      height={300}
      csvName="ch03-block-ms-bound"
      caption={tx`由 F-03.14 計算。$\pm1$ code 的 $x^2$ 恆為常數，任何 $N$ 都已經等於 mean 界；稀疏 code（$\kappa=10$）需要很大的 $N$ 才把隨機性平均掉。`}
    />
  )
}

export function CompareSection() {
  const gauss = xMoments({ kind: 'gaussian', sigma: 1 })
  const g03 = meanSquareFactor(0.3, gauss.Px, gauss.M4)
  const g15 = meanSquareFactor(1.5, gauss.Px, gauss.M4)
  const pole08 = meanPole(0.8, gauss.Px)
  const pyMs = useMemo(() => {
    try {
      return pyDef(lmsPySrc, 'mean_square_factor')
    } catch {
      return ''
    }
  }, [])
  return (
    <>
      <h2 id="compare">7｜三種穩定性總整理與核心程式碼</h2>
      <Section id="ch03-compare-table" kind="diagram" title="比較表">
        <SummaryTable />
        <p>
          規格 §0.1 的要求：<strong>不得寫「LMS 一定穩定」</strong>，必須說明是平均收斂、均方穩定、還是樣本路徑（機率 1）收斂。三者都是 <strong>[精確｜指定模型]</strong>——模型是「iid 純量 <Tex>x</Tex>、無量化、量測雜訊零均值且與 <Tex>x</Tex> 獨立」；超出這個模型（相關 regressor、1-bit comparator、更新延遲、PLL 動態）就要回到各自的章節重新推導。
        </p>
        <p>實際設計時該看哪一個？照下圖由上往下問：</p>
        <Fig
          chart={CHART_WHICH_BOUND}
          caption={T`設計者的決策流程。看藍色那一支：sign-off 用 mean-square（最嚴，成立時另外兩種自動成立）；紅色提醒 sum mode 的界限要再除以 $N$。`}
          ariaLabel="決策流程：要保證偏差消失用 mean 判據；要做 RMS 預算或有雜訊時穩態有限用 mean-square 判據；要單次軌跡收斂用 almost-sure 判據。mean-square 成立時另外兩種自動成立；GMAC 平均 N 筆時 mean-square 界放寬，sum mode 要再除以 N"
        />
        <p>
          先看最上面的菱形：你要保證的是「偏差會消失」、「RMS 有限」還是「單次軌跡會收斂」，三個答案各對應上表的一列。再看中間藍色那一支：mean-square 最嚴，成立時另外兩種自動成立（第 4 節的 F-03.10），所以
          sign-off 寫它。最後看藍色下方那條路：GMAC 每個 block 先平均 <Tex>N</Tex> 筆（<Tex>N</Tex> 是每個 block 累加的筆數）時，MS 界會放寬到接近 mean 界（第 8 節 F-03.14）；但硬體若輸出總和（sum
          mode），所有界限都要再除以 <Tex>N</Tex>。
        </p>
      </Section>

      <Section id="ch03-three-means" kind="formula" title={tx`同一批 $f=1-\mu x^2$，三種平均法`}>
        <p>
          三種判據的差別可以濃縮成一行程式：對同一批單步因子 <Tex>{T`f_k=1-\mu x_k^2`}</Tex>，mean 平均 <Tex>f</Tex>、mean-square 平均 <Tex>{T`f^2`}</Tex>、almost-sure 平均{' '}
          <Tex>{T`\ln|f|`}</Tex>。下面是網站實際執行的程式碼（Stability Lab 的單步 MC 就是呼叫這三個函式），差異行已標出：
        </p>
        <CodeCompare
          items={[
            { label: 'Mean', source: stabilitySrc, region: 'meanCriterion', path: 'src/simulation/models/scalarStability.ts', note: T`平均 $f$ 本身；$|\overline{f}|<1$ 才收斂` },
            { label: 'Mean-square', source: stabilitySrc, region: 'meanSquareCriterion', path: 'src/simulation/models/scalarStability.ts', note: T`平均 $f^2$；$\overline{f^2}<1$ 才收斂` },
            { label: 'Almost-sure', source: stabilitySrc, region: 'almostSureCriterion', path: 'src/simulation/models/scalarStability.ts', note: T`平均 $\ln|f|$；$\overline{\ln|f|}<0$ 才收斂` },
          ]}
          caption="三段程式只有標出「差異」的那一行不同：累加的是因子本身、因子的平方、還是因子絕對值的對數。"
        />
        <TexBlock>{T`\underbrace{\overline{\ln|f|}}_{\text{a.s.}}\ \le\ \tfrac12\ln\underbrace{\overline{f^2}}_{\text{MS}},\qquad \overline{f^2}\ \ge\ \big(\underbrace{\overline{f}}_{\text{mean}}\big)^2\qquad\text{（對同一組樣本也成立：Jensen 與變異數}\ge0\text{）}`}</TexBlock>
        <p>解析公式（全站共用的 lms.ts；第 0–2 章也用同一個檔案）：</p>
        <div className="ch03-plots">
          <CodeBlock source={lmsSrc} region="fixedXPole" path="src/simulation/models/lms.ts" title={T`固定 $x$ 的 pole（T02）`} />
          <CodeBlock source={lmsSrc} region="meanSquareFactors" path="src/simulation/models/lms.ts" title="mean / mean-square 因子與界限（T03）" />
        </div>
        <p>Monte Carlo 核心（Stability Lab 在 Web Worker 中執行的就是這兩段）：</p>
        <div className="ch03-plots">
          <CodeBlock source={stabilitySrc} region="drawX" path="src/simulation/models/scalarStability.ts" title={T`iid 抽樣 $x_n$`} />
          <CodeBlock source={stabilitySrc} region="pathStep" path="src/simulation/models/scalarStability.ts" title="一條路徑走一步（log 域 / 線性域）" />
        </div>
        <CodeBlock
          source={stabilitySrc}
          region="runPaths"
          path="src/simulation/models/scalarStability.ts"
          title={T`$P$ 條獨立路徑（每條自己的亂數串流）`}
          caption={T`fork('x:i') 讓第 $i$ 條路徑的 $x$ 序列只由 seed 與路徑編號決定：改路徑數、開關雜訊都不會改變其他路徑（paired comparison）。`}
        />
        <ModeGate min="engineer">
          <div className="ch03-plots">
            <CodeBlock source={stabilitySrc} region="uniformLyapunov" path="src/simulation/models/scalarStability.ts" title={T`Uniform 的 $\lambda(\mu)$ 封閉式（F-03.12）`} />
            {pyMs && (
              <CodeBlock source={pyMs} lang="python" path="golden/lms_pll_golden/lms.py" title="Python golden：mean_square_factor" caption="與 lms.ts 的 meanSquareFactor 同式；T03 golden vector 由它產生。" />
            )}
          </div>
        </ModeGate>
        <ModeGate min="engineer">
          <p>「帶入手算」HC-03.2、HC-03.4、HC-03.5 的答案，就是下面這幾個封閉式函式算出來的（每一行都對應手算的一個步驟）：</p>
          <div className="ch03-plots">
            <CodeBlock source={stabilitySrc} region="timeConstant" path="src/simulation/models/scalarStability.ts" title={T`時間常數 $\tau$ 與收斂步數 $n_\varepsilon$（F-03.4）`} />
            <CodeBlock source={stabilitySrc} region="msdClosedForm" path="src/simulation/models/scalarStability.ts" title={T`$E[\delta_n^2]$ 與穩態 $\text{MSD}_\infty$ 的封閉式（F-03.6／F-03.11）`} />
          </div>
        </ModeGate>
        <ModeGate min="research">
          <CodeBlock source={stabilitySrc} region="gaussianLyapunovDawson" path="src/simulation/models/scalarStability.ts" title={T`Gaussian 的 $\lambda(\mu)$：Dawson 形式（F-03.15）`} />
        </ModeGate>
      </Section>

      <h2 id="pll">8｜連到 PLL：code 分布、GMAC 累加與 sign-off 用語</h2>
      <Section id="ch03-hw-symbols" kind="diagram" title="本章的符號在硬體裡是什麼">
        <p>
          前七節的黑盒子 <Tex>{T`y=ax`}</Tex> 在 DTC-based fractional-N PLL 裡是什麼？把章首系統地圖裡和本章有關的方塊拉出來，並把本章「拿掉」的部分標成褐色，就是下面這張圖。接法和系統地圖相同：DTC 在 reference 的輸入端（reference clock → DTC → PD），回授路徑上只有 divider／PMUX，而 LMS 校正迴路的輸入是 PD 的輸出：
        </p>
        <Fig
          chart={CHART_PLL_MAPPING}
          caption={T`本章的理想模型（L0）畫回 PLL 硬體。看藍色三格（code $x$、$\div N\times\mu$、gain accumulator）就是章首系統地圖的主角；DTC 在 reference 輸入端，PD 的輸出 $e$ 同時送進 loop filter 與 LMS；褐色那一格列出本章先拿掉、後面章節才放回來的東西。`}
          ariaLabel="DSM 的 code x 走兩條路：一條控制 divider，讓 feedback edge 早到 a 乘 x；另一條乘上校正值 w，控制 reference 端的 DTC，讓 reference edge 比基準延遲 T 0 少延遲 w 乘 x。reference clock 經過 DTC 後與 divider 的 feedback edge 一起進 phase detector，phase detector 量 reference edge 減 feedback edge 的時間差並加上雜訊 v，輸出誤差 e 等於 delta 乘 x 加 v；這個輸出同時送進 loop filter，也是 LMS 的輸入，loop filter 與 VCO 的輸出再經 divider 回到 phase detector。本章把 error path 當成 1、沒有延遲、comparator 當成線性。誤差與同一個 x 相乘後由 GMAC 累加 N 筆，每個 block 除以 N 乘 mu，加到 gain accumulator 的 w 上，再回到 gain correction"
        />
        <p>
          先看最上面的藍色方塊：同一個 code <Tex>{T`x[i]`}</Tex>（<Tex>i</Tex> 是 sample 索引）走兩條路。左邊那條長線一路往下，通到 divider／PMUX（回授路徑）：DSM 的 carry 控制除數，但除數只能是整數，留下來的餘數讓
          feedback edge 比理想時刻<strong>早到</strong> <Tex>{T`a\,x[i]`}</Tex>，<Tex>a</Tex> 就是能把它完全抵消的理想校正 gain（未知）。右邊那條先經過 gain correction 乘上校正值{' '}
          <Tex>{T`w[k]`}</Tex>（<Tex>k</Tex> 是 block 索引，block 內 <Tex>w</Tex> 不變），再去控制 <strong>reference 端</strong>的 DTC：reference clock 先經過 DTC 才進 PD。DTC 只能延遲、不能提前，所以它從一個固定的基準延遲 <Tex>{T`T_0`}</Tex> 往回扣，<Tex>{T`\tau_{\text{DTC}}=T_0-w[k]\,x[i]`}</Tex>（數位端送進 DTC 的 code 是 <Tex>{T`C_0-w[k]\,x[i]`}</Tex>，<Tex>{T`C_0`}</Tex>{' '}
          是固定的中心值）。被扣掉的 <Tex>{T`w[k]\,x[i]`}</Tex> 就是 DTC 的<strong>補償量</strong>：reference edge 被提前（少延遲）的時間。
        </p>
        <p>
          接著看中間的 PD：它量的是「經過 DTC 的 reference edge 減 feedback edge」，<Tex>{T`e[i]=t'_{\text{ref}}[i]-t_{\text{fb}}[i]`}</Tex>。feedback 早到 <Tex>{T`a\,x[i]`}</Tex>，<Tex>e</Tex> 就多了{' '}
          <Tex>{T`+a\,x[i]`}</Tex>；reference 被提前 <Tex>{T`w[k]\,x[i]`}</Tex>，<Tex>e</Tex> 就少了 <Tex>{T`w[k]\,x[i]`}</Tex>（線上的正負號就是對 <Tex>e</Tex> 的貢獻）；再加上右邊紅色那格 PD／reference 的雜訊{' '}
          <Tex>{T`v[i]`}</Tex>，就是 <Tex>{T`e[i]=(a-w[k])\,x[i]+v[i]=\delta[k]\,x[i]+v[i]`}</Tex>——和第 3 節的 <Tex>{T`e_n=\delta_nx_n+v_n`}</Tex> 是同一條式子。補償不足（<Tex>{T`w<a`}</Tex>）時 reference
          還是太晚，<Tex>e</Tex> 為正。<Tex>{T`T_0`}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收，不影響任何會動的量，所以本章的數學一個字都不用改。
        </p>
        <p>
          再看 PD 的輸出：<Tex>{T`e[i]`}</Tex> 分成兩路。往左下那一路進 loop filter 與 VCO／DCO，VCO 的輸出再經 divider 回到 PD——這一圈就是 PLL 的主迴路（本章不展開），回授路徑上只有 divider，沒有 DTC。往右下那一路就是 <strong>LMS 校正迴路的輸入</strong>——comparator 取的是 PD 的輸出 <Tex>{T`e[i]`}</Tex>，也就是送進 loop filter 的同一個訊號，不是從 DTC 或 divider 拉出來的。接著看褐色那一格，它列的是本章先拿掉的東西：真實硬體裡主迴路是閉合的，feedback edge 會跟著動，所以 PD 輸出裡的不是 <Tex>{T`\delta\,x`}</Tex>，而是 <Tex>{T`\delta\,u`}</Tex>——
          <Tex>{T`u=h*x`}</Tex> 是被 PLL 的 error path 濾過的 code（第 6–7 章）；<Tex>w</Tex> 的更新有延遲（<ChRef ch="08">第 8 章</ChRef>）；comparator 只留下 1 bit 的正負號（<ChRef ch="05">第 5 章</ChRef>）；accumulator 的輸出還有位元數限制（<ChRef ch="13">第 13 章</ChRef>）。本章把它們全部理想化，才得到乾淨的{' '}
          <Tex>{T`1-\mu x^2`}</Tex>。最後往下看藍色方塊：
          <Tex>{T`e[i]\,x[i]`}</Tex> 由 GMAC 累加 <Tex>N</Tex> 筆，每個 block 做一次「<Tex>{T`\div N`}</Tex>、<Tex>{T`\times\mu`}</Tex>」，加進 gain accumulator：
          <Tex>{T`w[k+1]=w[k]+\mu\cdot\tfrac1N\sum_i e[i]\,x[i]`}</Tex>，新的 <Tex>{T`w[k]`}</Tex> 再沿著右邊那條長線回到 gain correction，由它去控制 reference 端的 DTC。<Tex>{T`N=1`}</Tex> 時 <Tex>{T`k=n`}</Tex>，這就是第 1–7 節的{' '}
          <Tex>{T`w_{n+1}=w_n+\mu e_nx_n`}</Tex>；<Tex>{T`N>1`}</Tex> 的情況在本節後半（F-03.14）。下表把每個符號逐一對回硬體：
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>本章</th>
                <th>PLL / DTC 校正中的對應</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{T`x_n`}</Tex>
                </td>
                <td>DSM / DTC code（正規化 regressor）</td>
                <td>Part B 中 PD 輸出看到的是被主迴路濾過的 <Tex>{T`u=h*x`}</Tex>，有時間相關，本章公式降為近似（勘誤 E38）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{T`\delta_n=a-w_n`}</Tex>
                </td>
                <td>DTC gain 的剩餘誤差</td>
                <td>極性與第 6、8 章一致</td>
              </tr>
              <tr>
                <td>
                  <Tex>\mu</Tex>
                </td>
                <td>LMS step（硬體常是 2 的冪次 shift）</td>
                <td>單位依 scaling；本章正規化為 <Tex>{T`1/[x]^2`}</Tex></td>
              </tr>
              <tr>
                <td>
                  <Tex>{T`v_n`}</Tex>
                </td>
                <td>Comparator 前的 PD / reference / thermal noise</td>
                <td>1-bit comparator 的非線性在<ChRef ch="05">第 5 章</ChRef>用 <Tex>{T`K_q`}</Tex> 線性化</td>
              </tr>
              <tr>
                <td>
                  <Tex>{T`P_x,\ \kappa`}</Tex>
                </td>
                <td>code 的功率與分布形狀</td>
                <td>{tx`$\pm1$ code：$\kappa=1$；均勻 residue：$\kappa=9/5$；稀疏 code：$\kappa$ 很大（例 $\{0\times9,3\}$ 為 10）`}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          對照案例頁的 subsampling PLL（8 相 PMUX + input DTC）：<strong>GOS</strong> 迴路要學的 DTC gain error 就是本章這種「單一純量 <Tex>w</Tex> 追 <Tex>a</Tex>」的問題，
          <Tex>{T`x_n`}</Tex> 是送進 DTC 的 code；<strong>PHOS</strong>（每一相各一個 phase offset）則是多參數問題，要到第 9–10 章。本章回答的是最理想的版本——「步長多大以內會收斂、是哪一種收斂」；為什麼實際迴路的 LMS 還可能<strong>變號</strong>（極性由 <Tex>{T`u=h*x`}</Tex> 與 <Tex>x</Tex> 的相關決定），見{' '}
          <a href="#/case/sspll">案例：SSPLL 的 GOS / PHOS 極性</a>與第 6–7 章。
        </p>
      </Section>
      <Section id="ch03-gmac-average" kind="formula" title={tx`GMAC 先累加 $N$ 筆再更新：隨機性被平均掉`}>
        <p>
          實際硬體不是每個 sample 更新，而是 GMAC 累加 <Tex>N</Tex> 筆後才更新一次（block LMS）。以 conventional LMS 的 block 平均梯度為例，每個 block 的乘法因子是{' '}
          <Tex>{T`1-\mu S_k`}</Tex>，<Tex>{T`S_k=\frac1N\sum_{i=1}^Nx_i^2`}</Tex>（<Tex>k</Tex> 是 block 索引，<Tex>i</Tex> 是 block 內的 sample 索引，<Tex>{T`S_k`}</Tex> 是第 <Tex>k</Tex> 個 block 內{' '}
          <Tex>{T`x^2`}</Tex> 的平均）。下圖是{figRef(CHART_PLL_MAPPING)} 下半那一段（GMAC → <Tex>{T`\div N`}</Tex>、<Tex>{T`\times\mu`}</Tex> → accumulator），改用「還差多少」<Tex>{T`\delta[k]=a-w[k]`}</Tex>{' '}
          來畫——和第 1 節把 LMS 迴圈改畫成誤差遞迴是同一招，所以修正量進加法點時是<strong>減號</strong>：
        </p>
        <Fig
          chart={CHART_BLOCK_GMAC}
          caption={T`GMAC 先累加 $N$ 筆再更新。「sample rate」那一框每一筆（$i$）做一次，「block rate」那一框每 $N$ 筆（$k$）才做一次；看藍色的累加與 $\div N$，以及紅色的 sum mode。`}
          ariaLabel="sample rate 框：每一筆 x i 與 block 內不變的 delta k 得到 e i 乘 x i，由 GMAC 累加 N 筆。block rate 框：除以 N 再乘 mu，從 delta k 減掉得到 delta k 加 1，延遲一個 block。省掉除以 N 時等效步長變成 N 倍"
        />
        <p>
          先看「sample rate」那一框（block 內的第 <Tex>i</Tex> 筆）：block 內 <Tex>w</Tex> 不變，所以 <Tex>{T`\delta[k]`}</Tex> 是常數；每一筆的 <Tex>{T`e[i]\,x[i]=\delta[k]\,x[i]^2`}</Tex> 送進 GMAC 累加，
          <Tex>N</Tex> 筆加完是 <Tex>{T`\delta[k]\sum x[i]^2`}</Tex>。再看「block rate」那一框：累加結果除以 <Tex>N</Tex>、乘 <Tex>\mu</Tex>（就是系統地圖的「<Tex>{T`\div N`}</Tex>、<Tex>{T`\times\mu`}</Tex>」那一格），得到 <Tex>{T`\mu\,S[k]\,\delta[k]`}</Tex>，再從 <Tex>{T`\delta[k]`}</Tex> 裡減掉——這個迴圈每個 block 才繞一圈，增益是 <Tex>{T`1-\mu S[k]`}</Tex>。圖上的 <Tex>{T`S[k]`}</Tex> 就是上式的{' '}
          <Tex>{T`S_k`}</Tex>，block rate 的迴圈就是下面推導的第 1 步；紅色那一格是後面「Sum 還是 average」的警告：少了 <Tex>{T`\div N`}</Tex>，等效步長變成 <Tex>{T`N\mu`}</Tex>。
        </p>
        <StepsBox
          title="block 版本的 mean-square 界"
          steps={[
            { tex: T`\delta_{k+1}=\delta_k-\mu\cdot\frac1N\sum_{i=1}^{N}e_ix_i=(1-\mu S_k)\,\delta_k`, why: tx`block 內 $w$ 不變（$\delta$ 固定為 $\delta_k$），無雜訊時 $e_i=\delta_kx_i$；GMAC 取平均後更新一次。` },
            { tex: T`E[S_k]=P_x`, why: tx`$N$ 個 $x^2$ 的平均，期望值仍是 $P_x$（線性）。` },
            { tex: T`\operatorname{Var}(S_k)=\frac{\operatorname{Var}(x^2)}{N}=\frac{M_4-P_x^2}{N}`, why: tx`獨立項平均的變異數縮小 $N$ 倍。` },
            { tex: T`E[S_k^2]=\operatorname{Var}(S_k)+E[S_k]^2=P_x^2+\frac{M_4-P_x^2}{N}`, why: '變異數公式。' },
            { tex: T`g_N(\mu)=1-2\mu P_x+\mu^2E[S_k^2]<1\iff 0<\mu<\frac{2P_x}{E[S_k^2]}`, why: tx`與第 3 節完全相同的代數，只是 $M_4$ 換成 $E[S_k^2]$（block 之間 iid，獨立性仍自動成立）。` },
          ]}
        />
        <FBlock id="F-03.14" />
        <p>
          Gaussian、<Tex>{T`N=4096`}</Tex>：<Tex>{T`\mu_\text{MS}=${tnum(blockMeanSquareBound(gauss, 4096), 6)}`}</Tex>，幾乎等於 mean 界 2——這就是為什麼後面章節的 block GMAC 分析常常只看 mean pole{' '}
          <Tex>{T`1-\mu K`}</Tex>：<strong><Tex>N</Tex> 大時 mean 與 mean-square 幾乎一致</strong>。但 <Tex>{T`N=1`}</Tex>（每個 sample 更新）時差 <Tex>{T`\kappa=3`}</Tex> 倍。
        </p>
        <BlockBoundPlot />
        <Callout kind="danger" title={tx`Sum 還是 average？差 $N$ 倍`}>
          <p>
            上面假設 GMAC 輸出的是<strong>平均</strong> <Tex>{T`\frac1N\sum e_ix_i`}</Tex>。如果硬體直接用<strong>總和</strong> <Tex>{T`\sum e_ix_i`}</Tex>（省掉除法或 shift），每個 block 的因子變成{' '}
            <Tex>{T`1-\mu N S_k`}</Tex>：等效步長是 <Tex>{T`N\mu`}</Tex>，所有界限都要<strong>除以 <Tex>N</Tex></strong>：
          </p>
          <TexBlock>{T`\text{sum mode：}\quad 0<\mu<\frac{1}{N}\cdot\frac{2P_x}{P_x^2+(M_4-P_x^2)/N}\qquad\Big(\text{Gaussian、}N=4096\text{ 時 }\mu<${tnum(blockMeanSquareBound(gauss, 4096) / 4096, 4)}\Big)`}</TexBlock>
          <p>
            「改了 <Tex>N</Tex> 卻忘了重新調整 <Tex>\mu</Tex>」是實務上最常見的失穩原因之一：<Tex>N</Tex> 加倍，sum mode 的迴路增益也加倍。第 12、14 章會用 <Tex>{T`g=\mu K`}</Tex> 把這件事正規化。
            <ClaimTag kind="exact" />
          </p>
        </Callout>
        <Callout kind="warn" title="適用範圍">
          這是 conventional（多 bit 誤差）block LMS 的精確結果。1-bit Sign-LMS 的 GMAC 輸出還要經過 comparator 統計（<ChRef ch="05">第 5 章</ChRef> <Tex>{T`K_q`}</Tex> 線性化，
          <ClaimTag kind="approx" />），而且 PLL error path 讓 regressor 變成相關的 <Tex>{T`u=h*x`}</Tex>（第 6–7 章）。本章給的是「理想情況下最好也只能到這裡」的基準。
        </Callout>
      </Section>
      <Section id="ch03-signoff" kind="assumptions" title="Sign-off 的寫法">
        <blockquote className="ch03-quote">
          ✓「在 iid 純量模型、<Tex>{T`P_x=${tnum(gauss.Px)},\ M_4=${tnum(gauss.M4)}`}</Tex> 下，<Tex>{T`\mu=0.3`}</Tex> 滿足 mean-square 穩定（
          <Tex>{T`g=${tnum(g03)}<1`}</Tex>），[精確｜指定模型]。」
        </blockquote>
        <ul>
          <li>✗「LMS 穩定」——沒說是哪一種，也沒說模型。</li>
          <li>
            ✗「平均 pole <Tex>{T`${tnum(pole08)}`}</Tex> 在單位圓內，所以雜訊下穩定」——那只是 mean；<Tex>{T`\mu=0.8`}</Tex> 時 MSD 已經發散（
            <Tex>{T`g=${tnum(meanSquareFactor(0.8, gauss.Px, gauss.M4))}`}</Tex>）。
          </li>
          <li>
            ✗「跑了 5 個 seed 都收斂，所以 <Tex>{T`\mu=1.5`}</Tex> 沒問題」——那是 almost-sure；<Tex>{T`E[\delta^2]`}</Tex> 以 <Tex>{T`g^n=${tnum(g15)}^n`}</Tex> 發散，有雜訊時穩態 RMS
            無限大。
          </li>
          <li>✓ 同時列出三個數字（<Tex>{T`1-\mu P_x`}</Tex>、<Tex>g</Tex>、<Tex>\lambda</Tex>）與模型層級，再交給 Part B / C 處理 comparator、延遲與量化。</li>
        </ul>
        <p className="small muted">
          數字由 <code>meanSquareFactor</code> 即時計算（<Tex>{T`P_x=1,\ M_4=3`}</Tex>）：<Tex>{T`g(1.5)=1-3+3\cdot2.25=${tnum(g15)}`}</Tex>、<Tex>{T`g(0.3)=${tnum(g03)}`}</Tex>。
        </p>
      </Section>
    </>
  )
}
