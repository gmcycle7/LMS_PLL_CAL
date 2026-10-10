import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Plot, Section, Tex, TexBlock, useThemeTokens } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import stabilitySrc from '@/simulation/models/scalarStability.ts?raw'
import lmsPySrc from '../../../../golden/lms_pll_golden/lms.py?raw'
import { meanPole, meanSquareFactor } from '@/simulation/models/lms'
import { blockMeanSquareBound, stabilityBounds, xMoments } from '@/simulation/models/scalarStability'
import { FBlock, logGrid, pyDef, StepsBox, T, tnum, tx } from '../common'
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
    }).concat([{ x: [1, 4096], y: [2, 2], mode: 'lines', name: 'mean 界 2/P_x（×P_x = 2）', line: { color: tokens.textMuted, dash: 'dash', width: 1.5 } }])
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: 'block 長度 N（GMAC 累加筆數）' }, type: 'log' }, yaxis: { title: { text: 'μ_MS · P_x（正規化 MS 界）' }, range: [0, 2.2] } }),
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
      <Section kind="diagram" title="比較表">
        <SummaryTable />
        <p>
          規格 §0.1 的要求：<strong>不得寫「LMS 一定穩定」</strong>，必須說明是平均收斂、均方穩定、還是樣本路徑（機率 1）收斂。三者都是 <strong>[精確｜指定模型]</strong>——
          模型是「iid 純量 <Tex>x</Tex>、無量化、量測雜訊零均值且與 <Tex>x</Tex> 獨立」；超出這個模型（相關 regressor、1-bit comparator、更新延遲、PLL 動態）就要回到各自的章節重新推導。
        </p>
      </Section>

      <Section kind="formula" title={tx`同一批 $f=1-\mu x^2$，三種平均法`}>
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
      <Section kind="diagram" title="本章的符號在硬體裡是什麼">
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
                <td>Part B 中真正進 PD 的是 <Tex>{T`u=h*x`}</Tex>，有時間相關，本章公式降為近似（勘誤 E38）</td>
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
                <td>1-bit comparator 的非線性在第 5 章用 <Tex>{T`K_q`}</Tex> 線性化</td>
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
          <Tex>{T`x_n`}</Tex> 是送進 DTC 的 code；<strong>PHOS</strong>（每一相各一個 phase offset）則是多參數問題，要到第 9–10 章。本章回答的是最理想的版本——「步長多大以內會收斂、是哪一種收斂」；
          為什麼實際迴路的 LMS 還可能<strong>變號</strong>（極性由 <Tex>{T`u=h*x`}</Tex> 與 <Tex>x</Tex> 的相關決定），見{' '}
          <a href="#/case/sspll">案例：SSPLL 的 GOS / PHOS 極性</a>與第 6–7 章。
        </p>
      </Section>
      <Section kind="formula" title={tx`GMAC 先累加 $N$ 筆再更新：隨機性被平均掉`}>
        <p>
          實際硬體不是每個 sample 更新，而是 GMAC 累加 <Tex>N</Tex> 筆後才更新一次（block LMS）。以 conventional LMS 的 block 平均梯度為例，每個 block 的乘法因子是{' '}
          <Tex>{T`1-\mu S_k`}</Tex>，<Tex>{T`S_k=\frac1N\sum_{i=1}^Nx_i^2`}</Tex>：
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
          這是 conventional（多 bit 誤差）block LMS 的精確結果。1-bit Sign-LMS 的 GMAC 輸出還要經過 comparator 統計（第 5 章 <Tex>{T`K_q`}</Tex> 線性化，
          <ClaimTag kind="approx" />），而且 PLL error path 讓 regressor 變成相關的 <Tex>{T`u=h*x`}</Tex>（第 6–7 章）。本章給的是「理想情況下最好也只能到這裡」的基準。
        </Callout>
      </Section>
      <Section kind="assumptions" title="Sign-off 的寫法">
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
