import { useMemo, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { ClaimTag, CodeBlock, Derivation, Plot, Section, SourceTag, StepDerivation, Tex, TexBlock, useThemeTokens } from '@/components'
import { useSettings } from '@/app/settings'
import { correlatedNoiseBias } from '../model'
import { num, signed, texNum, texRes } from '../format'
import { ChapterHandCalc, ErratumRef, Observe, PageLink } from '../common'
import modelSrc from '../model.ts?raw'

/** 反例的設定：±1 碼、μ = 0.02、獨立雜訊 σ_v = 0.5；只改與 code 相關的干擾 ε_cc = κ·x 的係數 κ（全站符號，勘誤 E12）。 */
export const BIAS_DEMO = { a: 3, w0: 1, mu: 0.02, sigmaV: 0.5, steps: 20000, seed: 20261010, stride: 20 }
export const BIAS_KAPPA_LIST = [0, 0.1, 0.2, -0.3]
/** 固定的版面物件（模組層級，避免每次 render 產生新參照而讓 Plot 重畫） */
const BIAS_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'n' } }, yaxis: { title: { text: 'w_n' } } }

interface AssumptionRow {
  key: string
  conclusion: ReactNode
  needs: ReactNode
  breaks: ReactNode
  where: ReactNode
}

/** 結論 ↔ 假設 ↔ 不成立時會怎樣 ↔ 哪一章處理。 */
const ROWS: AssumptionRow[] = [
  {
    key: 'update',
    conclusion: (
      <>
        更新式 <Tex>{'w_{n+1}=w_n+\\mu e_nx_n'}</Tex>（F-00.2）
      </>
    ),
    needs: '沒有——這是演算法的定義',
    breaks: '—',
    where: '—',
  },
  {
    key: 'gradient',
    conclusion: (
      <>
        <Tex>{'e\\,x'}</Tex> 是下坡方向：<Tex>{'\\tfrac{d}{dw}\\tfrac12e^2=-e\\,x'}</Tex>（F-00.3）
      </>
    ),
    needs: (
      <>
        預測對 <Tex>{'w'}</Tex> 是線性的（<Tex>{'\\hat y=wx'}</Tex>），而且量得到 <Tex>{'e'}</Tex> 的<strong>大小</strong>
      </>
    ),
    breaks: (
      <>
        只量得到 <Tex>{'\\mathrm{sign}(e)'}</Tex>（1-bit 比較器）：變成 Sign-Error LMS，下坡的對象換成 <Tex>{'E|e|'}</Tex>，步伐不再隨誤差縮小
      </>
    ),
    where: (
      <>
        <PageLink id="ch02" />、<PageLink id="ch05" />
      </>
    ),
  },
  {
    key: 'pole',
    conclusion: (
      <>
        每一步誤差乘上 <Tex>{'p=1-\\mu x^2'}</Tex>，收斂 <Tex>{'\\iff0<\\mu<2/x^2'}</Tex>（F-00.4、F-00.5）
      </>
    ),
    needs: (
      <>
        <Tex>{'x'}</Tex> 每一步都相同、沒有雜訊（<Tex>{'v=0'}</Tex>）、每筆資料來了立刻更新
      </>
    ),
    breaks: (
      <>
        <Tex>{'x'}</Tex> 隨機：要分「平均收斂／均方收斂／單一路徑收斂」三種不同的界限（<ErratumRef eid="E14" />）；更新有延遲：穩定範圍縮小
      </>
    ),
    where: (
      <>
        <PageLink id="ch03" />、<PageLink id="ch08" />
      </>
    ),
  },
  {
    key: 'mean',
    conclusion: (
      <>
        平均更新指向 <Tex>{'a'}</Tex>：<Tex>{'E[e\\,x]=(a-w)E[x^2]'}</Tex>（F-00.7）
      </>
    ),
    needs: (
      <>
        <Tex>{'E[v\\,x]=0'}</Tex>（雜訊零均值、與輸入不相關）；取平均的期間 <Tex>{'w'}</Tex> 幾乎不動
      </>
    ),
    breaks: (
      <>
        <Tex>{'E[v\\,x]\\ne0'}</Tex>：平均收斂到 <Tex>{'w^*=a+E[v\\,x]/E[x^2]\\ne a'}</Tex>（下面的反例，F-00.11）
      </>
    ),
    where: <PageLink id="ch11" />,
  },
  {
    key: 'sqrtN',
    conclusion: (
      <>
        平均 <Tex>{'N'}</Tex> 筆，雜訊降 <Tex>{'\\sqrt N'}</Tex> 倍（F-00.8）
      </>
    ),
    needs: (
      <>
        各筆 <Tex>{'e_ix_i'}</Tex> 互相獨立、同分布（iid）
      </>
    ),
    breaks: (
      <>
        相鄰樣本正相關（colored noise）時降得比較慢：相鄰相關係數為 <Tex>{'\\rho'}</Tex> 的 AR(1) 序列，<Tex>{'N'}</Tex> 很大時只相當於{' '}
        <Tex>{'N\\,\\dfrac{1-\\rho}{1+\\rho}'}</Tex> 筆獨立樣本 <ClaimTag kind="approx" />
      </>
    ),
    where: <PageLink id="ch12" />,
  },
  {
    key: 'identifiable',
    conclusion: (
      <>
        學得到 <Tex>{'a'}</Tex>
      </>
    ),
    needs: (
      <>
        <Tex>{'E[x^2]>0'}</Tex>：輸入要「有在動」
      </>
    ),
    breaks: (
      <>
        <Tex>{'x\\equiv0'}</Tex>：更新量永遠是 0，不可辨識（Playground 把 <Tex>{'x'}</Tex> 設成 0 就看得到）；多個參數時推廣成 persistent excitation
      </>
    ),
    where: <PageLink id="ch09" />,
  },
  {
    key: 'path',
    conclusion: (
      <>
        誤差裡的 <Tex>{'x'}</Tex>，就是我們拿來相乘的那個 <Tex>{'x'}</Tex>
      </>
    ),
    needs: '從係數到誤差之間沒有濾波、沒有延遲',
    breaks: (
      <>
        PLL 裡比較器看到的是經過迴路濾波的 <Tex>{'u=h*x'}</Tex>，更新量變成 <Tex>{'\\propto(a-w)\\,E[x\\,u]'}</Tex>；<Tex>{'E[x\\,u]'}</Tex>{' '}
        可能變小、變 0、甚至變負號——正的 <Tex>{'\\mu'}</Tex> 也會發散（和 Playground 的 <Tex>{'\\mu<0'}</Tex> 是同一種病）
      </>
    ),
    where: (
      <>
        <PageLink id="ch06" />、<PageLink id="ch07" />
      </>
    ),
  },
  {
    key: 'precision',
    conclusion: (
      <>
        <Tex>{'w'}</Tex> 可以停在任何實數
      </>
    ),
    needs: '係數有無限的解析度',
    breaks: (
      <>
        gain register 只有幾個 bit：<Tex>{'w'}</Tex> 只能在相鄰兩個 code 之間跳（limit cycle），要用 dither 或 <Tex>{'\\Delta\\Sigma'}</Tex> 處理
      </>
    ),
    where: <PageLink id="ch13" />,
  },
]

/** §0.10 注意假設：每個結論需要什麼條件；條件不成立時會怎樣（含一個可重現的反例）。 */
export function AssumptionsSection() {
  const { atLeast } = useSettings()
  const tokens = useThemeTokens()
  const runs = useMemo(() => BIAS_KAPPA_LIST.map((kappa) => ({ kappa, r: correlatedNoiseBias({ ...BIAS_DEMO, kappa }) })), [])
  const biased = runs.find((x) => x.kappa === 0.2) ?? runs[runs.length - 1]

  const plotData: Data[] = useMemo(() => {
    const out: Data[] = []
    runs.forEach(({ kappa, r }, i) => {
      const color = tokens.series[i % tokens.series.length]
      out.push({ x: r.traceN, y: r.traceW, name: `κ = ${num(kappa)}：w_n`, mode: 'lines', line: { color, width: 1.2 } })
      out.push({
        x: [0, BIAS_DEMO.steps],
        y: [r.wStar, r.wStar],
        name: `w* = a + κ = ${num(r.wStar)}`,
        mode: 'lines',
        line: { color, dash: 'dash', width: 1 },
        showlegend: false,
      })
    })
    return out
  }, [runs, tokens])

  return (
    <Section kind="assumptions" level={2} id="ch00-assumptions" title="§0.10 注意假設：這一課的結論什麼時候成立？">
      <p>
        前面每一個漂亮的結論，背後都有條件。真實的 PLL 校正之所以難，幾乎都是因為下表某一列的假設不成立——這也是後面每一章存在的理由。
      </p>
      <div className="table-wrap">
        <table className="ch00-assume">
          <thead>
            <tr>
              <th>這一課的結論</th>
              <th>需要的假設</th>
              <th>假設不成立時會怎樣</th>
              <th>哪一章處理</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <td>{r.conclusion}</td>
                <td>{r.needs}</td>
                <td>{r.breaks}</td>
                <td>{r.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>
        反例：雜訊「跟著 <Tex>{'x'}</Tex> 走」時，LMS 會很有信心地收斂到錯的答案
      </h3>
      <p>
        §0.7 的關鍵一步是 <Tex>{'E[v\\,x]=0'}</Tex>。如果干擾和輸入<strong>相關</strong>（例如和 code 同步的電源／基板耦合，或 DTC 非線性裡「可以被一條直線擬合掉」的那部分），這一步就不成立。
        最簡單的情況是干擾有一部分直接和輸入成正比。
        先用數字看：把這種「與 code 相關的干擾」記為 <Tex>{'\\varepsilon_{cc}=\\kappa\\,x'}</Tex>（全站符號；規格 §11.3 原寫 <Tex>{'u=cx'}</Tex>，
        <ErratumRef eid="E12" />），於是 <Tex>{"v=\\kappa\\,x+v'"}</Tex>，其中 <Tex>{"v'"}</Tex>{' '}
        才是和 <Tex>{'x'}</Tex> 無關的雜訊。取 <Tex>{`a=${texNum(BIAS_DEMO.a)}`}</Tex>、<Tex>{`\\kappa=${texNum(biased.kappa)}`}</Tex>，用 <code>conventionalStep</code> 跑{' '}
        <Tex>{String(BIAS_DEMO.steps)}</Tex> 步（<Tex>{`\\mu=${texNum(BIAS_DEMO.mu)}`}</Tex>、<Tex>{'x=\\pm1'}</Tex>），後半段 <Tex>{'w'}</Tex> 的平均是{' '}
        <Tex>{texRes(biased.r.wMean, 5)}</Tex>——不是 <Tex>{texNum(BIAS_DEMO.a)}</Tex>，而是 <Tex>{`a+\\kappa=${texRes(biased.r.wStar)}`}</Tex>。為什麼？
      </p>
      <StepDerivation
        title={
          <>
            <Tex>{'E[v\\,x]\\ne0'}</Tex> 時，平均更新量在哪裡歸零？
          </>
        }
        steps={[
          {
            tex: String.raw`e=y-wx=(a-w)\,x+v`,
            why: (
              <>
                和 §0.7 相同：代入 <Tex>{'y=ax+v'}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`E[e\,x]=(a-w)\,E[x^2]+E[v\,x]`,
            why: (
              <>
                乘上 <Tex>{'x'}</Tex> 取期望值（線性）。這次<strong>不能</strong>把 <Tex>{'E[v\\,x]'}</Tex> 丟掉。
              </>
            ),
          },
          {
            tex: String.raw`E[e\,x]=0\;\Longrightarrow\;(a-w^*)\,E[x^2]=-E[v\,x]`,
            why: (
              <>
                LMS 平均來說停在「平均更新量為 0」的地方，記為 <Tex>{'w^*'}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`w^*=a+\frac{E[v\,x]}{E[x^2]}`,
            why: (
              <>
                兩邊除以 <Tex>{'E[x^2]>0'}</Tex> 再移項。
              </>
            ),
          },
          {
            tex: String.raw`v=\kappa\,x+v'\;\Rightarrow\;E[v\,x]=\kappa\,E[x^2]+\underbrace{E[v'x]}_{=\,0}\;\Rightarrow\;w^*=a+\kappa`,
            why: (
              <>
                代入這個例子：<Tex>{"v'"}</Tex> 與 <Tex>{'x'}</Tex> 不相關。其實 <Tex>{"y=ax+\\kappa x+v'=(a+\\kappa)\\,x+v'"}</Tex>——從資料看，黑盒子的係數「就是」{' '}
                <Tex>{'a+\\kappa'}</Tex>，LMS 沒有做錯事，是我們想量的 <Tex>{'a'}</Tex> 和資料呈現的不一樣。
              </>
            ),
          },
        ]}
      />
      <TexBlock
        id="F-00.11"
        label={
          <>
            雜訊與輸入相關時，Conventional LMS 平均收斂到的位置（<Tex>{'E[v\\,x]=0'}</Tex> 時退回 <Tex>{'w^*=a'}</Tex>）
          </>
        }
      >
        {String.raw`\boxed{w^*=a+\frac{E[v\,x]}{E[x^2]}}`}
      </TexBlock>
      <div className="table-wrap">
        <table className="ch00-num-table">
          <caption className="small muted">
            <Tex>{`a=${texNum(BIAS_DEMO.a)},\\ \\mu=${texNum(BIAS_DEMO.mu)},\\ \\sigma_{v'}=${texNum(BIAS_DEMO.sigmaV)},\\ x=\\pm1`}</Tex>，{BIAS_DEMO.steps} 步，同一個
            seed；時間平均取後半段（<Tex>{`n=${biased.r.used}`}</Tex> 筆）
          </caption>
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\kappa=E[v\\,x]/E[x^2]'}</Tex>
              </th>
              <th className="num">
                理論 <Tex>{'w^*=a+\\kappa'}</Tex>
              </th>
              <th className="num">
                模擬的時間平均 <Tex>{'\\bar w'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\bar w-w^*'}</Tex>
              </th>
              <th className="num">
                容忍 <Tex>{"4\\,\\sigma_{v'}/\\sqrt n"}</Tex>
              </th>
              <th>與理論一致？</th>
              <th className="num">
                離真正的 <Tex>{'a'}</Tex> 多遠
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map(({ kappa, r }) => {
              const diff = r.wMean - r.wStar
              const ok = Math.abs(diff) <= 4 * r.se
              return (
                <tr key={kappa} data-testid={`ch00-bias-row-${kappa}`} data-ok={String(ok)}>
                  <td className="num">{signed(kappa)}</td>
                  <td className="num">{num(r.wStar)}</td>
                  <td className="num">{num(r.wMean, 5)}</td>
                  <td className="num">{signed(diff, 2)}</td>
                  <td className="num">{num(4 * r.se, 2)}</td>
                  <td>{ok ? '✓' : '✗'}</td>
                  <td className="num">{signed(r.wMean - BIAS_DEMO.a, 3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Plot
        title={String.raw`同一組亂數、不同的 $\kappa$：$w_n$ 各自收斂到 $a+\kappa$`}
        ariaLabel="同一組亂數、不同的 κ：w_n 各自收斂到 a + κ"
        csvName="ch00-correlated-noise-bias"
        data={plotData}
        layout={BIAS_LAYOUT}
        height={280}
        caption={
          <>
            實線：<code>correlatedNoiseBias</code>（每一步呼叫 <code>conventionalStep</code>）模擬的 <Tex>{'w_n'}</Tex>（每 {BIAS_DEMO.stride} 步畫一點）；同色虛線：理論{' '}
            <Tex>{'w^*=a+\\kappa'}</Tex>。四條線用同一個 seed，差別只在 <Tex>{'\\kappa'}</Tex>。
          </>
        }
      />
      <Observe>
        平均更新量歸零（在 PLL 裡就是「GMAC 輸出平均為 0」）只保證 <Tex>{'E[e\\,x]=0'}</Tex>，<strong>不保證 <Tex>{'w=a'}</Tex></strong>。而且再怎麼平均也沒用：
        <Tex>{'1/\\sqrt N'}</Tex> 只會把 <Tex>{'\\bar w'}</Tex> 的抖動壓小，壓不掉 <Tex>{'\\kappa'}</Tex> 這個偏移——抖動是 variance，偏移是 bias，兩件不同的事。
      </Observe>
      <p className="small">
        <ClaimTag kind="exact" /> 在「<Tex>{'x_n,v_n'}</Tex> 為 iid、<Tex>{'0<\\mu<2/E[x^2]'}</Tex>」的模型下，
        <Tex>{'E[w_n]\\to w^*'}</Tex>（平均收斂；每一條路徑仍會在 <Tex>{'w^*'}</Tex> 附近抖動）。<SourceTag kind="simulation" /> 表與圖由固定 seed 的模擬產生。
        只用 <Tex>{'\\mathrm{sign}(e)'}</Tex> 的 Sign-LMS，固定點由 <Tex>{'E[\\mathrm{sign}(e)\\,x]=0'}</Tex> 決定，一般和上式不同（<ErratumRef eid="E01" />）；
        offset、DTC 非線性、code-correlated jitter 各自造成多少 bias，見 <PageLink id="ch11" />。
      </p>
      <Derivation
        title={
          <>
            （Engineer）為什麼表中的容忍度是 <Tex>{"4\\,\\sigma_{v'}/\\sqrt n"}</Tex>？——相關樣本的時間平均
          </>
        }
        formulaId="F-00.11"
        level="L0"
        claim="approx"
        defaultOpen={atLeast('engineer')}
        derivation={
          <>
            <p>
              表裡的 <Tex>{'\\bar w'}</Tex> 是同一條路徑上 <Tex>{'n'}</Tex> 個<strong>彼此相關</strong>的 <Tex>{'w'}</Tex> 的平均，不能直接套{' '}
              <Tex>{'\\operatorname{std}(w)/\\sqrt n'}</Tex>。令 <Tex>{"\\delta'_n=w^*-w_n"}</Tex>：
            </p>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`e_nx_n=(a+\kappa-w_n)\,x_n^2+v'_nx_n=\delta'_n+v'_nx_n`,
                  why: (
                    <>
                      代入 <Tex>{"v=\\kappa x+v'"}</Tex> 與 <Tex>{'w^*=a+\\kappa'}</Tex>，並用 <Tex>{'x_n^2=1'}</Tex>（<Tex>{'\\pm1'}</Tex> 碼）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\delta'_{n+1}=\delta'_n-\mu\,e_nx_n=(1-\mu)\,\delta'_n-\mu\,v'_nx_n`,
                  why: (
                    <>
                      代入更新式：和 §0.7 的穩態推導一樣，只是 pole 變成 <Tex>{'p=1-\\mu'}</Tex>，雜訊項 <Tex>{"v'_nx_n"}</Tex> 的變異數仍是{' '}
                      <Tex>{"\\sigma_{v'}^2"}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(w_\infty)=\frac{\mu\,\sigma_{v'}^2}{2-\mu},\qquad \operatorname{Corr}(w_n,w_{n+k})=p^{|k|}`,
                  why: (
                    <>
                      F-00.9 取 <Tex>{'x^2=1'}</Tex>；一階遞迴（AR(1)）相隔 <Tex>{'k'}</Tex> 步的相關係數是 <Tex>{'p^{|k|}'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(\bar w)\approx\frac{\operatorname{Var}(w_\infty)}{n}\sum_{k=-\infty}^{\infty}p^{|k|}=\frac{\operatorname{Var}(w_\infty)}{n}\cdot\frac{1+p}{1-p}`,
                  why: (
                    <>
                      <Tex>{'n'}</Tex> 遠大於相關長度時，平均值的變異數 = 單筆變異數 × 所有延遲的相關係數總和 ÷ <Tex>{'n'}</Tex>；等比級數{' '}
                      <Tex>{'1+2\\sum_{k\\ge1}p^k=\\frac{1+p}{1-p}'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(\bar w)\approx\frac{\mu\,\sigma_{v'}^2}{2-\mu}\cdot\frac{2-\mu}{\mu}\cdot\frac1n=\frac{\sigma_{v'}^2}{n}`,
                  why: (
                    <>
                      代入 <Tex>{'1+p=2-\\mu'}</Tex>、<Tex>{'1-p=\\mu'}</Tex>：<Tex>{'\\mu'}</Tex> 完全約掉。把 LMS 的輸出再做時間平均，效果和直接平均 <Tex>{'n'}</Tex>{' '}
                      筆獨立量測一樣——資訊量由資料筆數決定，不由 <Tex>{'\\mu'}</Tex> 決定。
                    </>
                  ),
                },
              ]}
              result={String.raw`\operatorname{std}(\bar w)\approx\frac{\sigma_{v'}}{\sqrt n}=\frac{${texNum(BIAS_DEMO.sigmaV)}}{\sqrt{${biased.r.used}}}=${texNum(biased.r.se, 3)}`}
            />
            <CodeBlock
              source={modelSrc}
              region="correlatedNoiseBias"
              path="src/chapters/ch00/model.ts"
              caption={String.raw`反例的模擬程式：和一般的 LMS 模擬只差標「← 差異」的那一行（雜訊裡多了一項 $\kappa\,x$）。`}
            />
          </>
        }
        assumptions={
          <ul>
            <li>
              <Tex>{'x_n=\\pm1'}</Tex> 等機率、iid；<Tex>{"v'_n"}</Tex> iid 零均值、與 <Tex>{'x'}</Tex> 獨立
            </li>
            <li>
              <Tex>{'0<\\mu<2'}</Tex>，且 <Tex>{'n\\gg1/\\mu'}</Tex>（平均長度遠大於相關長度）
            </li>
          </ul>
        }
      />

      <h3>綜合手算：把這個反例從頭到尾算一次</h3>
      <p>
        進入思考題之前，用一題把本章的四條公式串起來：<Tex>{'w^*'}</Tex> 停在哪（F-00.11）、pole 與收斂步數（F-00.4）、收斂後抖多大（F-00.9）、再做時間平均後多準（
        <Tex>{'1/\\sqrt N'}</Tex>，F-00.8）。
      </p>
      <ChapterHandCalc id="HC-00.8">
        預設的數字就是上面表格 <Tex>{`\\kappa=${texNum(biased.kappa)}`}</Tex> 那一列（<Tex>{`n=${biased.r.used}`}</Tex>）。先用紙筆和計算機（要用到{' '}
        <Tex>{'\\ln'}</Tex> 與 <Tex>{'\\sqrt{\\ }'}</Tex>）算完五個答案，再對照表格的 <Tex>{'w^*'}</Tex> 與容忍度；接著把 <Tex>{'\\kappa'}</Tex>、<Tex>{'\\mu'}</Tex>{' '}
        換成你自己的數字，看看哪些量會變、哪些不會。
      </ChapterHandCalc>
    </Section>
  )
}
