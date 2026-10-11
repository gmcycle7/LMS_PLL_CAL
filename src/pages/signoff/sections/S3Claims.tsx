import { useMemo, useState } from 'react'
import { Callout, ClaimTag, CodeBlock, MathText, ModeGate, Quiz, Section, SelectControl, Tex, TexBlock } from '@/components'
import { gaussianAlmostSureMuMax, gaussianLyapunov, meanSquareFactor, meanSquareMuMax } from '@/simulation/models/lms'
import judgesSrc from '../judges.ts?raw'
import { STABILITY_KIND_LABEL, STABILITY_NOTIONS, STATEMENTS, type ClaimStatement } from '../data'
import { chebyshevBound, failureUpperBound, kestenTailIndex, trialsForZeroFailure } from '../judges'
import { EvidenceLabExperiment } from '../experiments/EvidenceLab'
import { CHART_EVIDENCE } from '../diagrams'
import { Diagram, ErratumNote, HandCalcSlot, RichText, Steps, nf, tx, useMode } from '../shared'

type StmtFilter = 'all' | 'ok' | 'bad'

function StatementCard({ s }: { s: ClaimStatement }) {
  return (
    <div className={`so-stmt ${s.ok ? 'so-stmt-ok' : 'so-stmt-bad'}`} data-statement={s.id}>
      <div className="so-stmt-meta">
        <span className="so-stmt-mark" role="img" aria-label={s.ok ? '可以這樣寫' : '不可以這樣寫'}>
          {s.ok ? '✅' : '❌'}
        </span>
        <span>{STABILITY_KIND_LABEL[s.kind]}</span>
        <span>· {s.source === 'spec' ? '規格 §16.3 原句' : '本站補充'}</span>
        <ClaimTag kind={s.claim} />
      </div>
      <div className="so-stmt-text">
        <RichText text={s.text} />
      </div>
      <dl>
        <dt>{s.ok ? '這句話精確地說了什麼' : '它其實只能說什麼'}</dt>
        <dd>
          <RichText text={s.means} />
        </dd>
        <dt>數學</dt>
        <dd>
          <TexBlock>{s.math}</TexBlock>
        </dd>
        <dt>{s.ok ? '沒有說（不要延伸）' : '為什麼錯'}</dt>
        <dd>
          <RichText text={s.caveat} />
        </dd>
      </dl>
    </div>
  )
}

/** §3：何時可以宣稱穩定（規格 §16.3）＋ §3.5 證據強度 */
export function S3Claims() {
  const [filter, setFilter] = useState<StmtFilter>('all')
  const shown = STATEMENTS.filter((s) => filter === 'all' || (filter === 'ok') === s.ok)
  const muMs = meanSquareMuMax(1, 3)
  const muAs = useMemo(() => gaussianAlmostSureMuMax(), [])
  const lam08 = useMemo(() => gaussianLyapunov(0.8), [])
  const g08 = meanSquareFactor(0.8, 1, 3)
  const pu100 = failureUpperBound(0, 100)
  const pu1000 = failureUpperBound(0, 1000)
  const n1pct = trialsForZeroFailure(0.01)
  const cheb = chebyshevBound(0.4 ** 2, 4 * 0.4)
  // Kesten 尾指數只在 Research 模式顯示；數值積分 + 二分法較重（數十 ms），其他模式不計算
  const research = useMode() === 'research'
  const kesten = useMemo(() => (research ? [0.3, 0.5, 2 / 3, 0.8, 1.5, 2.3].map((mu) => ({ mu, kappa: kestenTailIndex(mu) })) : []), [research])

  return (
    <>
      <Section kind="assumptions" level={2} title="3. 何時可以宣稱穩定：每一種措辭的數學意義（規格 §16.3）" id="so-claims">
        <p>
          規格 §0.1：不要寫「LMS 一定穩定」；必須說明是<strong>平均收斂</strong>、<strong>均方穩定</strong>、<strong>機率性有界</strong>、<strong>局部線性穩定</strong>還是<strong>全域非線性</strong>。
          這些不是同義詞——同一個系統可以滿足其中一種而不滿足另一種。下表把每種措辭翻成數學定義，並寫出「要拿什麼證明」。
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>措辭</th>
                <th>數學定義</th>
                <th>證明的對象</th>
                <th>可接受的證據</th>
              </tr>
            </thead>
            <tbody>
              {STABILITY_NOTIONS.map((n) => (
                <tr key={n.kind}>
                  <td className="nowrap">{STABILITY_KIND_LABEL[n.kind]}</td>
                  <td>
                    <Tex>{n.definition}</Tex>
                  </td>
                  <td>
                    <RichText text={n.proofObject} />
                  </td>
                  <td>
                    <RichText text={n.evidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="全域非線性穩定">
          「對所有初值、所有允許的輸入都收斂」需要 Lyapunov 函數或窮舉論證；本站的任何模擬與 Monte Carlo 都<strong>不能</strong>證明它（附錄 B 第 8 點）。sign-off 報告一般不宣稱這一級。
        </Callout>

        <h3>語句範例：✅ 可以寫、❌ 不可以寫</h3>
        <SelectControl
          label="顯示"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `全部（${STATEMENTS.length}）` },
            { value: 'ok', label: '只看 ✅' },
            { value: 'bad', label: '只看 ❌' },
          ]}
        />
        <div className="so-stmts">
          {shown.map((s) => (
            <StatementCard key={s.id} s={s} />
          ))}
        </div>
      </Section>

      <Section kind="formula" title="3.1 一步一步：為什麼這些「穩定」不一樣">
        <p>
          用最簡單的模型就能看出差別：純量、iid Gaussian regressor <Tex>{'x_n\\sim\\mathcal N(0,1)'}</Tex>、沒有外加雜訊，<Tex>{'\\delta_n=a-w_n'}</Tex>。
        </p>
        <Steps
          title="平均（mean）遞迴"
          steps={[
            { tex: String.raw`w_{n+1}=w_n+\mu e_nx_n,\qquad e_n=(a-w_n)x_n=\delta_nx_n`, why: 'conventional LMS；沒有雜訊時誤差只來自係數偏差。' },
            { tex: String.raw`\delta_{n+1}=a-w_{n+1}=\delta_n-\mu x_n^2\delta_n=(1-\mu x_n^2)\,\delta_n`, why: String.raw`代入並整理（極性 $\delta=a-w$，E32）。` },
            { tex: String.raw`E[\delta_{n+1}]=E[1-\mu x_n^2]\,E[\delta_n]=(1-\mu P_x)\,E[\delta_n]`, why: String.raw`$\delta_n$ 只由 $x_0,\dots,x_{n-1}$ 決定，與 $x_n$ 獨立 ⇒ 期望值可以拆開（E38：這裡是精確的）。` },
          ]}
          result={String.raw`E[\delta_n]\to0\iff|1-\mu P_x|<1\iff0<\mu<\frac{2}{P_x}=2`}
        />
        <Steps
          title="均方（mean-square）遞迴"
          steps={[
            { tex: String.raw`\delta_{n+1}^2=(1-\mu x_n^2)^2\,\delta_n^2`, why: '把上面的遞迴平方。' },
            { tex: String.raw`E[\delta_{n+1}^2]=E\big[(1-\mu x_n^2)^2\big]\,E[\delta_n^2]`, why: '同樣的獨立性。' },
            { tex: String.raw`E[(1-\mu x^2)^2]=1-2\mu E[x^2]+\mu^2E[x^4]=1-2\mu+3\mu^2\equiv g_2(\mu)`, why: '展開平方、期望值是線性的；Gaussian 的 $E[x^2]=1$、$E[x^4]=3$。' },
            { tex: String.raw`g_2(\mu)<1\iff3\mu^2-2\mu<0\iff0<\mu<\tfrac23`, why: '解一元二次不等式。' },
          ]}
          result={String.raw`0<\mu<\frac{2P_x}{E[x^4]}=${tx(muMs, 6)}`}
        />
        <Steps
          title="幾乎必然（almost-sure）收斂"
          steps={[
            { tex: String.raw`\log|\delta_n|=\log|\delta_0|+\sum_{i=0}^{n-1}\log|1-\mu x_i^2|`, why: '乘積取對數變成和。' },
            { tex: String.raw`\frac1n\sum_{i=0}^{n-1}\log|1-\mu x_i^2|\ \xrightarrow{\ n\to\infty\ }\ \lambda(\mu)\equiv E\big[\log|1-\mu x^2|\big]\quad\text{(a.s.)}`, why: '大數法則：iid 隨機變數的平均幾乎必然收斂到期望值。' },
            { tex: String.raw`|\delta_n|\approx|\delta_0|\,e^{n\lambda(\mu)}\ \Rightarrow\ \lambda(\mu)<0\text{ 時 }\delta_n\to0\text{ (a.s.)}`, why: String.raw`指數成長率就是 $\lambda(\mu)$。` },
            { tex: String.raw`\lambda(\mu)=\tfrac12E\big[\log(1-\mu x^2)^2\big]\le\tfrac12\log E\big[(1-\mu x^2)^2\big]=\tfrac12\log g_2(\mu)`, why: String.raw`Jensen 不等式（$\log$ 是凹函數：先平均再取 $\log$ 比較大）。` },
          ]}
          result={String.raw`g_2(\mu)<1\ \Rightarrow\ \lambda(\mu)<0,\quad\text{但反過來不成立}`}
        />
        <p>
          數值（即時計算）：mean 界 <Tex>{'2'}</Tex>、mean-square 界 <Tex>{tx(muMs, 6)}</Tex>、almost-sure 界 <Tex>{`\\mu_\\text{as}=${tx(muAs, 6)}`}</Tex>（數值積分 + 二分法）。
          在 <Tex>{'\\mu=0.8'}</Tex>：<Tex>{`g_2=${tx(g08, 4)}>1`}</Tex>（均方發散）但 <Tex>{`\\lambda=${tx(lam08, 4)}<0`}</Tex>（幾乎每條路徑都收斂）。
          這正是「200 個 seeds 都收斂，所以均方穩定」為什麼是錯的。<ClaimTag kind="exact" />
        </p>
        <ModeGate min="research">
          <Steps
            title="Research：有外加雜訊時的 heavy tail（Kesten 尾指數）"
            steps={[
              { tex: String.raw`\delta_{n+1}=A_n\delta_n+B_n,\qquad A_n=1-\mu x_n^2,\ \ B_n=\mu x_nv_n`, why: '加入量測雜訊 $v_n$ 後，遞迴變成隨機係數的仿射遞迴（random coefficient AR(1)）。' },
              { tex: String.raw`\lambda(\mu)=E[\log|A|]<0\ \Rightarrow\ \delta_n\ \text{收斂到唯一的 stationary 分布}`, why: '與 almost-sure 判準相同的條件。' },
              { tex: String.raw`P(|\delta_\infty|>t)\sim c\,t^{-\kappa},\qquad E\big[|A|^{\kappa}\big]=1,\ \kappa>0`, why: String.raw`Kesten–Goldie 定理：尾巴是冪次律，指數 $\kappa$ 由 $|A|$ 的矩決定。` },
              { tex: String.raw`E[\delta_\infty^2]<\infty\iff\kappa>2\iff E[A^2]=g_2(\mu)<1`, why: String.raw`冪次尾巴 $t^{-\kappa}$ 的二階矩有限 ⇔ $\kappa>2$；而 $m(s)=E|A|^s$ 是凸函數、$m(0)=1$，所以 $\kappa>2$ ⇔ $m(2)<1$。` },
            ]}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">
                    <Tex>{'\\mu'}</Tex>
                  </th>
                  {kesten.map((k) => (
                    <th key={k.mu} className="num">
                      {nf(k.mu, 4)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <Tex>{'\\kappa'}</Tex>（數值積分 + 二分法）
                  </td>
                  {kesten.map((k) => (
                    <td key={k.mu} className="num">
                      {nf(k.kappa, 4)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">
            <Tex>{'\\mu=2/3'}</Tex> 時 <Tex>{'\\kappa=2'}</Tex>（均方邊界）；<Tex>{'\\mu=0.8'}</Tex> 時 <Tex>{'\\kappa<2'}</Tex>：分布存在但變異數無限大——這就是「樣本 <Tex>{'\\delta^2'}</Tex> 平均」不收斂、sample SE 嚴重低估的根源。
          </p>
        </ModeGate>
        <ErratumNote id="E14">
          規格只區分 mean 與 mean-square；本站加入 almost-sure 界（<Tex>{`\\mu_\\text{as}\\approx${tx(muAs, 4)}`}</Tex>），並禁止以長時間 <Tex>{'\\delta^2'}</Tex> 樣本平均驗證 <Tex>{'2/3'}</Tex> 界（heavy tail 使 sample SE 嚴重低估）。
        </ErratumNote>
        <Steps
          title="機率性有界：從均方界到尾機率（Chebyshev）"
          steps={[
            { tex: String.raw`E[\delta^2]\ge E\big[\delta^2\,\mathbf 1\{|\delta|\ge b\}\big]\ge b^2\,P(|\delta|\ge b)`, why: String.raw`把積分範圍縮小只會變小；在 $|\delta|\ge b$ 的區域 $\delta^2\ge b^2$。` },
            { tex: String.raw`P(|\delta_k|\ge b)\le\frac{E[\delta_k^2]}{b^2}`, why: '移項（Markov／Chebyshev 不等式）。' },
            { tex: String.raw`\sup_kE[\delta_k^2]\le\sigma_w^2\ \Rightarrow\ \sup_kP(|\delta_k|\ge b)\le\frac{\sigma_w^2}{b^2}`, why: String.raw`若已證明均方有界（例如穩態 $\sigma_w^2$），就得到「機率性有界」的定量版本。` },
          ]}
          result={String.raw`\text{例：}\sigma_w=0.4\,\mathrm{fs},\ b=4\sigma_w\ \Rightarrow\ P\le${tx(cheb, 4)}`}
        />
        <p className="small muted">
          Chebyshev 對任何分布都成立，所以很鬆（Gaussian 時真實值遠小於上界）；它的價值是<strong>不需要分布假設</strong>。
        </p>
      </Section>

      <Section kind="explore" level={2} title="3.5 證據強度：「指定 sweep／seeds 未觀察到失效」能推出什麼" id="so-evidence">
        <p>
          <strong>問題</strong>：regression 掃了 <Tex>{'n'}</Tex> 個隨機條件（FCW、corner、mode…），一個都沒失效——報告上到底能寫什麼？先看圖，再看數學：圖上的 <Tex>{'k_f'}</Tex> 是觀察到的失效次數，<Tex>{'\\alpha'}</Tex> 是可以接受的錯判機率（信心 <Tex>{'1-\\alpha'}</Tex>），<Tex>{'p_U'}</Tex> 是失效機率 <Tex>{'p'}</Tex> 的上界。
        </p>
        <Diagram
          chart={CHART_EVIDENCE}
          caption="從「掃了 n 個點、全部沒失效」到報告裡那一句話：先數失效次數，換算成失效機率的上界，再寫清楚這個上界只對與 sweep 同分布的條件成立。"
          ariaLabel="證據強度流程圖：指定 sweep 共 n 次獨立試驗，數失效次數；零次失效用 rule of three 得失效機率上界，有失效用 Clopper-Pearson；結論只對與 sweep 同分布的條件成立，不能寫成所有條件都穩定"
        >
          <p>
            先看藍色的兩個方塊，它們是兩種算法：沒有失效時有封閉解 <Tex>{'p_U=1-\\alpha^{1/n}\\approx-\\ln\\alpha/n'}</Tex>（<Tex>{'\\alpha=0.05'}</Tex> 時約 <Tex>{'3/n'}</Tex>）；有失效時用二項分布的 CDF 數值求解。綠色是可以寫進報告的句子，
            紅色是常見的過度宣稱。
          </p>
        </Diagram>
        <Steps
          title="0 次失效 ⇒ 失效機率上界（rule of three）"
          steps={[
            { tex: String.raw`P(n\text{ 次全部成功}\mid p)=(1-p)^n`, why: '每次獨立、失效機率 $p$。' },
            { tex: String.raw`(1-p)^n\le\alpha\iff n\ln(1-p)\le\ln\alpha\iff p\ge1-\alpha^{1/n}`, why: String.raw`「若 $p$ 這麼大，全部成功的機率 $\le\alpha$」——這樣的 $p$ 被排除（信心 $1-\alpha$）。` },
            { tex: String.raw`p_U=1-\alpha^{1/n}=1-e^{\ln\alpha/n}\approx\frac{-\ln\alpha}{n}`, why: String.raw`$n$ 大時用 $e^{-t}\approx1-t$（泰勒一階）；$\alpha=0.05$ 時 $-\ln\alpha\approx3$，所以叫 rule of three。` },
            { tex: String.raw`k_f>0:\ \ p_U=\max\{p:\ P(X\le k_f\mid n,p)\ge\alpha\},\ \ X\sim\mathrm{Bin}(n,p)`, why: '有失效時的一般版本（Clopper–Pearson），用二項 CDF 數值求解。' },
          ]}
          result={String.raw`n=100\Rightarrow p_U=${tx(pu100, 4)},\qquad n=1000\Rightarrow p_U=${tx(pu1000, 4)},\qquad p_U\le1\%\text{ 需 }n\ge${n1pct}`}
        />
        <TexBlock id="F-SO.8" label="失效機率的單邊上界">{String.raw`p_U(k_f=0)=1-\alpha^{1/n}\approx\frac{-\ln\alpha}{n},\qquad n_\text{need}=\Big\lceil\frac{\ln\alpha}{\ln(1-p_\text{max})}\Big\rceil`}</TexBlock>
        <TexBlock id="F-SO.9" label="純量 iid Gaussian LMS 的三種穩定判準">{String.raw`|1-\mu P_x|<1,\qquad g_2(\mu)=1-2\mu P_x+\mu^2E[x^4]<1,\qquad \lambda(\mu)=E\big[\log|1-\mu x^2|\big]<0`}</TexBlock>
        <Callout kind="warn" title="$p_U$ 的前提">
          它只對「與試驗同分布的隨機條件」成立：你掃的是均勻隨機 FCW，就不能推論到某個特定的 near-integer FCW；seeds 若共用同一段雜訊（不獨立），有效的 <Tex>{'n'}</Tex> 更小。
        </Callout>
        <HandCalcSlot id="HC-SO.3">
          你的 regression 跑了幾個 seeds？把 <Tex>{'n'}</Tex> 換成那個數字，算出你最多能宣稱的失效率上界。
        </HandCalcSlot>
        <EvidenceLabExperiment />
        <CodeBlock source={judgesSrc} region="failureUpperBound" path="src/pages/signoff/judges.ts" title="Clopper–Pearson 上界（本頁執行的程式碼）" />
        <Quiz
          title="思考題 3-1"
          question="下列哪一句可以直接寫進 sign-off 報告？"
          options={[
            { label: 'LMS 在所有 corner 都穩定。' },
            { label: <MathText>{`在一階平均模型、$d=0$、$0<g<2$ 的條件下，局部平均誤差漸近收斂；FCW sweep 的 ${n1pct} 個隨機點未觀察到發散（95% 信心下失效率 $\\le1\\%$）。`}</MathText>, correct: true },
            { label: 'GMAC 輸出已歸零，因此校正正確。' },
            { label: <MathText>{String.raw`Phase margin $75^\circ$，因此所有 FCW 都穩定。`}</MathText> },
          ]}
          answer={
            <>
              <p>
                B 同時寫清楚了<strong>模型</strong>（一階平均、無延遲）、<strong>穩定的種類</strong>（平均收斂、局部）、<strong>經驗證據的範圍</strong>（隨機 FCW 點數與信心水準）。
                <Tex>{`n=${n1pct}`}</Tex> 是由 <Tex>{'\\lceil\\ln0.05/\\ln0.99\\rceil'}</Tex> 算出的。
              </p>
              <p>A 沒有說是哪一種穩定；C 把固定點當成真值（bias）；D 把一個 operating point 的 PM 推廣到所有 FCW（<Tex>{'C(\\mathrm{FCW})'}</Tex> 可能變號）。</p>
            </>
          }
        />
      </Section>
    </>
  )
}
