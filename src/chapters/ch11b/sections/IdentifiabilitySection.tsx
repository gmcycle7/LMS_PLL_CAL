import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { DEFAULT_STRUCTURE, analyzeInlStructure, generateInlCode, visitProbabilities } from '@/simulation/models/dtcInl'
import { m, num } from '../common'
import { F } from '../formulas'
import { Fig, FigRef } from '../Fig'

const SHAPE = { d2: 20, d3: 0, sawAmp: 0, sawSegments: 8 }

/** §11b.4 可辨識性：每段要有樣本（MASH 的分布）、gauge（gain 共線、LUT offset）。 */
export function IdentifiabilitySection() {
  const t = useMemo(() => {
    const cfg = { ...DEFAULT_STRUCTURE, structure: 'piecewise' as const, K: 8 }
    const uni = visitProbabilities(generateInlCode({ kind: 'uniform', length: 1 << 15, seed: 1 }).x, cfg)
    const mash = visitProbabilities(generateInlCode({ kind: 'mash111', frac: 0.618, length: 1 << 15, seed: 1 }).x, cfg)
    const pwGain = analyzeInlStructure({ config: { ...cfg, gainMode: 'adapt' }, shape: SHAPE, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64, length: 1 << 14 })
    const lutGain = analyzeInlStructure({ config: { ...DEFAULT_STRUCTURE, structure: 'lut', J: 16, gainMode: 'adapt' }, shape: SHAPE, code: { kind: 'uniform' }, a: 1.2, w0: 1, b: 0, sigmaV: 10, mu: 2, N: 64, length: 1 << 14 })
    return { uni, mash, pwSingular: pwGain.mode.singular, lutCond: lutGain.mode.cond, lutSingular: lutGain.mode.singular }
  }, [])

  return (
    <Section kind="assumptions" title="11b.4 可辨識性：哪些參數 comparator 看不到" level={2} id="ch11b-identifiability">
      <p>
        <ChRef ch="09">Ch09</ChRef> 的結論：LMS 穩定不代表學得到，<Tex>{'\\lambda_{\\min}=0'}</Tex> 的方向永遠不動。INL 校正有三種方式撞上它。<FigRef id="gauge" /> 先看最上面：comparator 只看得到總補償量 <Tex>{'w\\,x+c(x)'}</Tex> 與 <Tex>{'b'}</Tex> 的和，所以任何「不改變總和」的參數搬移它都看不到。三個紅色方塊各是一種，綠色是修法。
      </p>
      <Fig id="gauge" />
      <h3 id="ch11b-pe">(1) 每段要有足夠樣本：MASH 的 code 分布</h3>
      <p>
        分段與 LUT 的 <Tex>{'\\lambda_k'}</Tex> 正比於段內的 regressor 功率；沒有樣本的段 <Tex>{'\\lambda_k=0'}</Tex>。uniform 的 code 每段都有 <Tex>{'1/K'}</Tex>，但 MASH 1-1-1 的餘數是三個累加器內容的組合，分布像三角形、集中在中間，正規化後 <Tex>{'|x|\\gtrsim0.6'}</Tex> 的外側段幾乎沒有樣本：
      </p>
      <div className="table-wrap">
        <table className="ch11b-table">
          <caption className="small muted">{m('$K=8$ 段的造訪機率 $p_k$（32768 個樣本；由 visitProbabilities 算出）。MASH：frac $=0.618$、20-bit。')}</caption>
          <thead>
            <tr>
              <th>段</th>
              {t.uni.map((_, k) => (
                <th key={k}>{k + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>uniform</td>
              {t.uni.map((v, k) => (
                <td className="num" key={k}>
                  {num(v, 3)}
                </td>
              ))}
            </tr>
            <tr>
              <td>MASH 1-1-1</td>
              {t.mash.map((v, k) => (
                <td className="num" key={k}>
                  {num(v, 3)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        外側段 <Tex>{'p_k'}</Tex> 只有千分之幾：時間常數 <Tex>{'\\tau_k=1/(\\mu K_q\\lambda_k)'}</Tex> 是中間段的幾百倍，等於沒在校正；更糟的是 frac 接近有理數（例如 0.3）時 code 落在格點上，LUT 有些格<strong>永遠</strong>沒有樣本。兩個修法：把段界對準 code 的分布（等機率分段，而不是等寬），或接受「只校正有樣本的範圍」——反正那些 code 也不會出現。這和 <ChRef ch="09">Ch09</ChRef> 的 persistent excitation（F-09.9）是同一件事：有限窗口內每個方向都要有能量。
      </p>
      <h3 id="ch11b-gauge">(2) Gauge：和 gain、和 PD offset 共線</h3>
      <StepDerivation
        steps={[
          { tex: String.raw`\sum_{k=1}^K\mathbb 1_k(x)\,x=x\quad\Rightarrow\quad w\,x+\sum_kw_k\mathbb 1_k(x)\,x=(w+\epsilon)\,x+\sum_k(w_k-\epsilon)\mathbb 1_k(x)\,x`, why: m('分段的 regressor 加起來就是 gain 的 regressor：把 $\\epsilon$ 從 $w$ 搬到每個 $w_k$，$e$ 一個 sample 都不變。') },
          { tex: String.raw`\mathbf R_{[x,\varphi]}\begin{bmatrix}1\\-\mathbf 1\end{bmatrix}=E\Big[\boldsymbol\psi\big(x-\textstyle\sum_k\mathbb 1_kx\big)\Big]=\mathbf 0\quad\Rightarrow\quad\lambda_{\min}=0`, why: m('null vector：$\\mathbf R$ 奇異（Ch09 F-09.13 的 gauge freedom）。多項式含 $x$ 項時同理（$\\varphi_1=x$ 與 gain 的 regressor 完全相同）。') },
          { tex: String.raw`\text{LUT：}\sum_j\mathbb 1_j(x)=1\quad\Rightarrow\quad b+\sum_j\theta_j\mathbb 1_j=(b-\epsilon)+\sum_j(\theta_j+\epsilon)\mathbb 1_j`, why: m('LUT 的整體 offset 與 PD offset $b$ 不可分（Ch11 §11.1 的 offset 一節：comparator 看不出 offset 從哪裡來）。LUT 與 gain 的 $x$ 方向則只是「幾乎」共線：$x\\ne\\sum_j\\bar x_j\\mathbb 1_j$，差格內的斜坡，條件數 $\\propto J^2$。') },
        ]}
      />
      <TexBlock id="F-11B.12" label={m('Gauge：不可辨識的方向')}>
        {F.gauge}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m(`模型數字：分段 $K=8$ + gain 同時校正 ⇒ $\\mathbf R$ 奇異（${t.pwSingular ? '是' : '否'}）；LUT $J=16$ + gain ⇒ 不奇異但 $\\kappa=${num(t.lutCond, 4)}$。`)}
      </p>
      <Callout kind="warn" title="Gauge 無害，但只對「總補償量」無害">
        <p>
          沿著 null 方向搬移不改變 <Tex>{'e'}</Tex>，所以殘餘 INL 照樣收斂（實驗 B 開 gain 同時校正可以看到）。但個別參數會隨機漫步（<ChRef ch="09">Ch09</ChRef> F-09.19）：暫存器可能慢慢爬到飽和；如果你之後要把 <Tex>{'w'}</Tex> 拿去當別的用途（例如 PVT 追蹤、或當成 DTC gain 的量測值），它已經不是 DTC 的 gain 了。修法是<strong>固定 gauge</strong>：gain 校正收斂後凍結 <Tex>{'w'}</Tex> 再開 INL 校正；LUT 每次更新後減掉平均（或固定一格為 0）；多項式從 <Tex>{'m=2'}</Tex> 開始。
        </p>
      </Callout>
      <ModeGate min="research">
        <p className="small muted">
          Research：主迴路的 DC null（Ch11 §11.1 的 shared BBPD）把 <Tex>{'E[q]=0'}</Tex> 強制成立，等於再加一個 gauge——LUT／多項式的常數項與 <Tex>{'\\varphi'}</Tex> 都不可分；本章的模擬用靜態模型（comparator 看得到 DC），所以常數項是可辨識的。時變的 INL（溫度漂移）要在 tracking 模式下靠 <Tex>{'\\mu'}</Tex> 跟上，對 MASH 外側段來說幾乎不可能——實務上多用訓練序列（<ChRef ch="09">Ch09</ChRef> 的 training sequence lab）把 code 掃過整個範圍。
        </p>
      </ModeGate>
    </Section>
  )
}
