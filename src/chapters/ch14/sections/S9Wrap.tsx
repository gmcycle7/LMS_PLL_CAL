import { useMemo } from 'react'
import { ClaimTag, Quiz, Recap, Section, Tex, TexBlock } from '@/components'
import { cornerInterval, loopGainK, msdAfterBlocks, optimizeMu } from '@/simulation/models/optimizer'
import { Hand } from '../Hand'
import { BIAS2, md, nf, tx } from '../shared'

/** §14.8：演算法比較表、思考題、本課必記、連結到 PLL */
export function S9Wrap() {
  const q1 = msdAfterBlocks(2, 0.5, 0.1, 1, 2) // δ0 = 2、p = 0.5、μ²σ_η² = 0.01、B = 2
  const q2 = useMemo(() => cornerInterval([0.005, 0.01], 0.01, 7), [])
  const q4 = useMemo(() => {
    const K = loopGainK(100, 0)
    const o4 = optimizeMu('final', { K, delta0: 3, sigmaEta2: 1 / 4096, B: 32 })
    const o8 = optimizeMu('final', { K, delta0: 3, sigmaEta2: 1 / 8192, B: 16 })
    return { mu4096: o4.mu, rms4096: Math.sqrt(o4.cost), mu8192: o8.mu, rms8192: Math.sqrt(o8.cost) }
  }, [])
  return (
    <>
      <Section kind="assumptions" level={2} title="14.8 策略比較" id="ch14-compare">
        <div className="table-wrap">
          <table className="ch14-table">
            <thead>
              <tr>
                <th>策略</th>
                <th>初期收斂</th>
                <th>終點雜訊</th>
                <th>PVT 追蹤</th>
                <th>{md('對 $K$ 誤差的穩健性')}</th>
                <th>硬體成本</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  固定小 <Tex>{'\\mu'}</Tex>
                </td>
                <td>慢（slew-limited 時更慢）</td>
                <td>
                  低（<Tex>{'\\sigma_w^2\\propto\\mu'}</Tex>）
                </td>
                <td>
                  頻寬低，lag <Tex>{'=r/(\\mu K)'}</Tex> 大
                </td>
                <td>
                  好（<Tex>{'g'}</Tex> 遠離 1）
                </td>
                <td>最低</td>
              </tr>
              <tr>
                <td>
                  固定大 <Tex>{'\\mu'}</Tex>
                </td>
                <td>快</td>
                <td>高</td>
                <td>好</td>
                <td>
                  差（<Tex>{'g'}</Tex> 接近上限，真實 <Tex>{'K'}</Tex> 比設計值大就振盪）
                </td>
                <td>最低</td>
              </tr>
              <tr>
                <td>
                  固定最佳 <Tex>{'\\mu^*'}</Tex>（F-14.7）
                </td>
                <td>中</td>
                <td>
                  下界的 <Tex>{'(1+\\ln A)/4'}</Tex> 倍
                </td>
                <td>只針對一個目標</td>
                <td>中</td>
                <td>低</td>
              </tr>
              <tr className="is-best">
                <td>兩段式：先 coarse 再 fine（之後 track）</td>
                <td>快</td>
                <td>接近下界</td>
                <td>track 階段獨立設計</td>
                <td>
                  中（VERIFY 可量 <Tex>{'\\hat K'}</Tex>）
                </td>
                <td>2–3 個 shift 值 + 計數器 + FSM</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'1/k'}</Tex>（Kalman）
                </td>
                <td>最快</td>
                <td>
                  下界 <Tex>{'P_B'}</Tex>
                </td>
                <td>
                  差（<Tex>{'\\mu_k\\to0'}</Tex>）；需要地板
                </td>
                <td>
                  差（<Tex>{'\\kappa<\\tfrac12'}</Tex> 時變慢）
                </td>
                <td>
                  乘法器／LUT、需知 <Tex>{'K'}</Tex> 與 <Tex>{'\\delta_0'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  Corner 正規化 <Tex>{'\\mu_i=g/\\hat K_i'}</Tex>
                </td>
                <td>各 corner 一致</td>
                <td>各 corner 一致</td>
                <td>—</td>
                <td>
                  好（<Tex>{'r\\to1'}</Tex>）
                </td>
                <td>{md(String.raw`量測流程，外加每個 corner 一個 $\mu$`)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section kind="example" level={2} title="綜合手算：重現第 10 課的設計計算器" id="ch14-synthesis">
        <p>
          做思考題之前，先把整章串起來算一次：從規格（<Tex>{'\\sigma_v,\\ N,\\ T,\\ \\delta_0,\\ \\epsilon'}</Tex>）一路算到 <Tex>{'\\mu'}</Tex>、pole、PM 與 RMS，會用到 §14.1 的 F-14.3、§14.2 的 F-14.10／F-14.14 與 §14.5 的 F-14.15。
        </p>
        <Hand id="HC-14.8">
          預設值就是 §14.4 的第 10 課條件：先不要看詳解，用紙筆和計算機算出課程宣稱的四個數字，再換成你自己的規格（也試試把 <Tex>{'\\theta'}</Tex> 改成 <Tex>{'60^\\circ'}</Tex> 或 <Tex>{'95^\\circ'}</Tex>）。
        </Hand>
      </Section>

      <Section kind="example" level={2} title="思考題" id="ch14-quiz">
        <Quiz
          title="思考題 1（計算）"
          question={
            <>
              <Tex>{'\\delta_0=2\\,\\mathrm{fs}'}</Tex>、<Tex>{'p=0.5'}</Tex>、<Tex>{'\\mu^2\\sigma_\\eta^2=0.01\\,\\mathrm{fs^2}'}</Tex>，<Tex>{'B=2'}</Tex> 次更新後 <Tex>{'E[\\delta_B^2]'}</Tex> 是多少？
            </>
          }
          options={[{ label: '0.25' }, { label: nf(q1, 4), correct: true }, { label: '0.27' }, { label: '1.01' }]}
          answer={
            <>
              <TexBlock>{String.raw`\begin{aligned}E[\delta_2^2]&=\delta_0^2p^{4}+\mu^2\sigma_\eta^2\frac{1-p^{4}}{1-p^2}\\&=4\times0.0625+0.01\times\frac{1-0.0625}{1-0.25}\\&=0.25+0.01\times1.25=${tx(q1, 5)}\ \mathrm{fs^2}\end{aligned}`}</TexBlock>
              <p>也可以逐步算：<Tex>{'m_1=0.25\\times4+0.01=1.01'}</Tex>，<Tex>{'m_2=0.25\\times1.01+0.01=0.2625'}</Tex>。0.25 是忘了 variance、1.01 是只做了一步。</p>
            </>
          }
        />
        <Quiz
          title="思考題 2（corner 區間）"
          question={
            <>
              兩個 corner 的 <Tex>{'K_{\\min}/K_{\\max}=0.5'}</Tex>，要求 <Tex>{'\\epsilon=0.01'}</Tex>、<Tex>{'PM\\ge60^\\circ'}</Tex>。至少要幾次更新區間才非空？
            </>
          }
          options={[{ label: '5' }, { label: String(q2.bMin), correct: true }, { label: '10' }, { label: '14' }]}
          answer={
            <>
              <TexBlock>{String.raw`B\ge\frac{\ln0.01}{\ln(1-0.5)}=\frac{${tx(Math.log(0.01), 5)}}{${tx(Math.log(0.5), 4)}}=${tx(q2.bMinExact, 5)}\Rightarrow B\ge${q2.bMin}`}</TexBlock>
              <p>
                <Tex>{`B=${q2.bMin}`}</Tex> 時區間為 <Tex>{`[${tx(q2.muLo, 4)},\\ ${tx(q2.muHi, 4)}]\\,\\mathrm{fs}`}</Tex>（以 <Tex>{'K_{\\min}=0.005,\\ K_{\\max}=0.01'}</Tex> 計）。注意除以 <Tex>{'\\ln(1-r)<0'}</Tex> 時不等號要反向。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 3（觀念）"
          question={
            <>
              某個 FCW 讓 <Tex>{'\\theta=90^\\circ'}</Tex>（<Tex>{'C=0'}</Tex>）。若繼續用 <Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex> 更新 B 次，<Tex>{'E[\\delta_B^2]'}</Tex> 會怎樣？
            </>
          }
          options={[
            { label: '照樣收斂，只是比較慢' },
            { label: <>收斂到 <Tex>{'\\sigma_w^2=\\mu\\sigma_\\eta^2/(2K)'}</Tex></> },
            { label: <><Tex>{'=\\delta_0^2+B\\mu^2\\sigma_\\eta^2'}</Tex>，隨 <Tex>{'B'}</Tex> 線性增加（random walk）</>, correct: true },
            { label: '指數發散' },
          ]}
          answer={
            <p>
              <Tex>{'C=0\\Rightarrow K=0\\Rightarrow g=0\\Rightarrow p=1'}</Tex>。F-14.3 的分母 <Tex>{'1-p^2=0'}</Tex>，要回到等比數列：每項都是 1，和為 <Tex>{'B'}</Tex>（F-14.4）。平均誤差不動（<Tex>{'E[\\delta_B]=\\delta_0'}</Tex>），變異數每個 block 增加
              <Tex>{'\\mu^2\\sigma_\\eta^2'}</Tex>。這就是 bad-FCW policy 要 freeze 的原因；穩態公式 <Tex>{'\\mu\\sigma_\\eta^2/(K(2-\\mu K))'}</Tex> 在 <Tex>{'K\\to0'}</Tex> 時發散，正好反映「沒有穩態」。
            </p>
          }
        />
        <Quiz
          title="思考題 4（預算）"
          question={
            <>
              固定總比較次數 <Tex>{'T'}</Tex>。把 <Tex>{'N'}</Tex> 從 4096 改成 8192（<Tex>{'B'}</Tex> 減半）並重新最佳化 <Tex>{'\\mu'}</Tex>，終點 RMS 大約怎麼變？
            </>
          }
          options={[
            { label: <>變成 <Tex>{'1/\\sqrt2'}</Tex> 倍</> },
            { label: <>幾乎不變（<Tex>{'\\mu^*'}</Tex> 約加倍）</>, correct: true },
            { label: <>變成 <Tex>{'\\sqrt2'}</Tex> 倍</> },
            { label: '變成 2 倍' },
          ]}
          answer={
            <p>
              F-14.17：<Tex>{'E[\\delta_B^2]^*\\approx(1+\\ln(4TK^2\\delta_0^2))/(4TK^2)'}</Tex> 只依賴 <Tex>{'T'}</Tex>。<Tex>{'N'}</Tex> 加倍讓每次更新的雜訊減半，但更新次數也減半；最佳{' '}
              <Tex>{'\\mu^*\\approx\\ln A/(2BK)'}</Tex>（<Tex>{'A'}</Tex> 不變）隨 <Tex>{'1/B'}</Tex> 約加倍。第 10 課條件下精確值：<Tex>{`N=4096`}</Tex> 時 RMS {nf(q4.rms4096, 4)} fs、<Tex>{`N=8192`}</Tex> 時 {nf(q4.rms8192, 4)} fs（<Tex>{'\\mu^*'}</Tex>{' '}
              {nf(q4.mu4096, 4)} → {nf(q4.mu8192, 4)} fs）。若忘了把 <Tex>{'\\mu'}</Tex> 加倍（<Tex>{'N'}</Tex> 改了、<Tex>{'\\mu'}</Tex> 沒改），等效 <Tex>{'g'}</Tex> 減半，{BIAS2} 可能沒收完——這是規格 §17「<Tex>{'N'}</Tex> 改變卻忘記 scaling」反面測試的另一面。
            </p>
          }
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { label: md(String.raw`$B$ 次更新後的均方誤差（$\text{bias}^2+\text{variance}$；勘誤 E48 的適用範圍）`), tex: String.raw`E[\delta_B^2]=\delta_0^2p^{2B}+\mu^2\sigma_\eta^2\frac{1-p^{2B}}{1-p^2},\quad p=1-\mu K` },
          { label: md(String.raw`大 $B$ 的最佳 $\mu$`), tex: String.raw`\mu^*\approx\frac{\ln A}{2BK},\quad E[\delta_B^2]^*\approx\frac{\sigma_\eta^2(1+\ln A)}{4BK^2},\quad A=\frac{4BK^2\delta_0^2}{\sigma_\eta^2}` },
          { label: md(String.raw`Corner 區間（$\epsilon$ 為相對比例；勘誤 E16）`), tex: String.raw`\frac{1-\epsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}},\qquad B\ge\frac{\ln\epsilon}{\ln(1-K_{\min}/K_{\max})}` },
          { label: '最佳排程（下界）', tex: String.raw`\mu_k=\frac{1}{K(k+1+k_0)},\quad P_B=\frac{\delta_0^2}{1+B\delta_0^2K^2/\sigma_\eta^2}` },
          { label: md('固定總預算只看 $T$'), tex: String.raw`E[\delta_B^2]^*\approx\frac{1+\ln(4TK^2\delta_0^2)}{4TK^2}` },
        ]}
        points={[
          <>
            均方誤差等於「平均還沒收完」（<Tex>{'\\text{bias}^2\\propto p^{2B}'}</Tex>）加上「雜訊累積」（<Tex>{'\\text{variance}\\propto\\mu'}</Tex>）；最佳 <Tex>{'\\mu'}</Tex> 就是兩者的平衡點，且隨 <Tex>{'\\ln\\delta_0'}</Tex> 緩慢變化。
          </>,
          <>
            「最佳 <Tex>{'\\mu'}</Tex>」要先說目標：最快收斂（<Tex>{'\\mu=1/K'}</Tex>）、終點 RMS、全程誤差、spur（受限於收斂下限）、PVT 追蹤（<Tex>{'\\mu^*\\approx\\sigma_\\zeta/\\sigma_\\eta'}</Tex>）答案各不相同。
          </>,
          <>
            F-14.3 對線性模型精確，對 1-bit Sign-LMS 只在 <Tex>{'|\\delta_0|\\ll\\sigma_v'}</Tex> 成立；coarse 階段是 slew-limited（E48）。<ClaimTag kind="approx" />
          </>,
          <>
            Corner 區間的 <Tex>{'\\epsilon'}</Tex> 是相對比例；區間為空時要改 <Tex>{'B'}</Tex>、<Tex>{'K'}</Tex> 散佈、<Tex>{'\\epsilon'}</Tex>、PM 或架構，不是再找一個 <Tex>{'\\mu'}</Tex>（E16）。
          </>,
          <>
            固定 <Tex>{'T'}</Tex> 時 <Tex>{'N'}</Tex> 本身幾乎不影響最佳 RMS；<Tex>{'N'}</Tex> 由延遲、位元數、追蹤頻寬與對 <Tex>{'K'}</Tex> 誤差的穩健性決定。步長「先大後小」接近 <Tex>{'1/k'}</Tex> 下界，並由狀態機與 guards 實作。
          </>,
        ]}
      />

      <Section kind="intuition" level={2} title="連結到 PLL 硬體" id="ch14-pll">
        <div className="table-wrap">
          <table className="ch14-table">
            <thead>
              <tr>
                <th>本章的量</th>
                <th>硬體</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'\\mu'}</Tex>（<Tex>{'\\mu_\\text{coarse}/\\mu_\\text{fine}/\\mu_\\text{track}'}</Tex>）
                </td>
                <td>GMAC 輸出到 gain register 的 shift 量（通常取 2 的冪）；每個狀態一組暫存器</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'N'}</Tex>
                </td>
                <td>
                  GMAC accumulator 的 block 長度（決定 <Tex>{'f_u=f_s/N'}</Tex>、累加位元數、更新延遲 <Tex>{'d'}</Tex>）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'B,\\ T'}</Tex>
                </td>
                <td>開機校正計時器（CAL_TIMER）乘上 comparator rate</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'K=K_qC'}</Tex>
                </td>
                <td>
                  BBPD 前的雜訊（<Tex>{'\\sigma_v'}</Tex>：VCO／ref jitter、comparator noise）與 PLL error path 的相位（<Tex>{'C'}</Tex>）；隨 PVT／FCW 改變
                </td>
              </tr>
              <tr>
                <td>狀態機與 guards</td>
                <td>數位 FSM：lock detector、clip flag、FCW 查表（bad-FCW list）、LKG 暫存器、FW 介面</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\delta_B'}</Tex> 的 RMS
                </td>
                <td>gain-equivalent 殘差；要經 code 乘法與 PLL transfer 才變成 output jitter／spur（Ch12）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted">
          下一個值得研究的問題（Roadmap R8）：有更新延遲 <Tex>{'d>0'}</Tex> 時的 corner 區間（PM 公式變成 <Tex>{'90^\\circ-(2d+1)\\arcsin(g/2)'}</Tex>，平均誤差不再是 <Tex>{'(1-g)^B'}</Tex>）；colored GMAC noise 下的最佳排程；NLMS／RLS／Kalman 與量測 Jacobian 的整合。
        </p>
      </Section>
    </>
  )
}
