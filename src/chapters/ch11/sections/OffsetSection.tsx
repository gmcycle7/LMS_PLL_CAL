import { useMemo } from 'react'
import { Callout, ClaimTag, CodeCompare, ModeGate, ModelLevel, Section, StepDerivation, Tex, TexBlock } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import {
  DSM_BITS,
  buildCodeDistribution,
  codeMoments,
  fixedPoint,
  linearizedFixedPoint,
  meanGmacSign,
  mseFixedPoint,
  perCodeGain,
  signFixedPoint,
  signWeightedMedian,
  sigmaAt,
  type CodeDistKind,
  type ErrorModel,
} from '@/simulation/models/bias'
import { quantizeFcw } from '@/simulation/models/dsm'
import { DcNullExperiment } from '../experiments/DcNullExperiment'
import { F } from '../formulas'
import { Erratum, ModeDetails, chop, num, m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const DSM_FRAC = 0.3
const BIAS_PATH = 'src/simulation/models/bias.ts'
const OFFSET_KINDS: { kind: CodeDistKind; label: string }[] = [
  { kind: 'five_level', label: '5-level $\\{-2,\\dots,2\\}$（已置中）' },
  { kind: 'unipolar4', label: '4-level $\\{0,1,2,3\\}$' },
  { kind: 'uniform_residue', label: 'Uniform $[0,1)$ residue' },
  { kind: 'dsm', label: 'first-order DSM residue' },
]

/** §11.1：comparator offset 的假 gain bias、主迴路 DC null（E03）、code centering 的但書（E17）、無雜訊 dead zone。 */
export function OffsetSection() {
  const b = 0.1
  const table = useMemo(
    () =>
      OFFSET_KINDS.map(({ kind, label }) => {
        const d = buildCodeDistribution({ kind, dsmFrac: DSM_FRAC })
        const mo = codeMoments(d)
        // DSM：frac 量化到 8-bit（K/256），標籤由實際分布算出
        const qf = quantizeFcw(DSM_FRAC, DSM_BITS)
        const lbl = kind === 'dsm' ? `${label}（frac $=${qf.K}/${qf.M}$）` : label
        return { kind, label: lbl, mo, ratio: mo.Ex / mo.Ex2 }
      }),
    [],
  )
  const uniRow = table.find((r) => r.kind === 'uniform_residue') ?? table[0]
  const e03 = useMemo(() => {
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    const md: ErrorModel = { a: 1, b: 0.5, c2: 0, c3: 0, kappa: 0, sigmaV: 1 }
    return (['none', 'shared_bbpd', 'linear_pd'] as const).map((mode) => ({
      mode,
      lin: linearizedFixedPoint(md, u4, mode, false).w,
      mf: signFixedPoint(md, u4, mode).w,
    }))
  }, [])
  const centering = useMemo(() => {
    const five = buildCodeDistribution({ kind: 'five_level' })
    const sat = [0, 1, 2].map((bb) => ({ b: bb, w: signFixedPoint({ a: 1, b: bb, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0.5 }, five).w }))
    const jit: ErrorModel = { a: 1, b: 0.2, c2: 0, c3: 0, kappa: 0, sigmaV: 1, jitterSlope: 0.25, jitterRef: -2 }
    return {
      gAtA: meanGmacSign(1, { a: 1, b: 0.7, c2: 0, c3: 0, kappa: 0, sigmaV: 0.4 }, five),
      sat,
      sigmas: five.values.map((x) => sigmaAt(x, jit)),
      jitSign: signFixedPoint(jit, five).w,
      jitLin: linearizedFixedPoint(jit, five, 'none', true).w,
      jitMse: mseFixedPoint(jit, five),
      jitConst: signFixedPoint({ ...jit, jitterSlope: 0 }, five).w,
      jitCubic: signFixedPoint({ ...jit, c3: 0.1 }, five).w,
      jitCubicConst: signFixedPoint({ ...jit, c3: 0.1, jitterSlope: 0 }, five).w,
      jitNoBias: signFixedPoint({ ...jit, b: 0 }, five).w,
      // 同一個例子，但 jitter 最小的 code 換到最大的那一個（reference 端 DTC：code 越大延遲越短）—— 對稱 code、只有 offset 時固定點左右鏡射
      jitMirror: signFixedPoint({ ...jit, jitterRef: 2 }, five).w,
    }
  }, [])
  const dead = useMemo(() => {
    const u4 = buildCodeDistribution({ kind: 'unipolar4' })
    const md: ErrorModel = { a: 1, b: 1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    const rows = u4.values.filter((x) => x !== 0).map((x) => ({ x, t: perCodeGain(x, md), wt: 0.25 * Math.abs(x) }))
    const totalWt = rows.reduce((acc, r) => acc + r.wt, 0)
    // 置中的 5-level code + offset（σ_v = 0）：一樣是 dead zone（a − b/2, a + b/2）
    const five = buildCodeDistribution({ kind: 'five_level' })
    const cm: ErrorModel = { a: 1, b: 0.1, c2: 0, c3: 0, kappa: 0, sigmaV: 0 }
    return {
      rows,
      totalWt,
      zone: signWeightedMedian(md, u4.values, u4.probs),
      gIn: meanGmacSign(1.4, md, u4),
      w005: fixedPoint('sign', { ...md, sigmaV: 0.05 }, u4).w,
      w1: fixedPoint('sign', { ...md, sigmaV: 1 }, u4).w,
      mse: mseFixedPoint(md, u4),
      centered: signWeightedMedian(cm, five.values, five.probs),
      centeredNoisy: fixedPoint('sign', { ...cm, sigmaV: 0.05 }, five).w,
    }
  }, [])

  return (
    <Section kind="formula" title="11.1 Comparator offset 的假 gain bias" level={2} id="ch11-offset">
      <p>
        <strong>直覺：</strong>offset <Tex>{'b'}</Tex> 永遠是同一個正負號。如果 code 大多是正的（<Tex>{'E[x]>0'}</Tex>），那 <Tex>{'b\\cdot x'}</Tex> 也大多是正的 —— 在
        GMAC 眼裡，這和「gain 太小、誤差跟著 <Tex>{'x'}</Tex> 變大」一模一樣，於是 LMS 把 <Tex>{'w'}</Tex> 調大去「修正」一個根本不存在的 gain 誤差。
      </p>
      <p>
        <FigRef id="offset-path" /> 用數字走一次（code 在 <Tex>{'[0,1)'}</Tex> 均勻分布、<Tex>{'b=0.1'}</Tex> t.u.）。先看左邊：offset 乘上平均為{' '}
        <Tex>{String.raw`\tfrac12`}</Tex> 的 code，取平均後留下 <Tex>{String.raw`b\,E[x]=0.05`}</Tex>；再看右邊：GMAC 分不出這 0.05 來自 offset 還是 gain 誤差，LMS
        只能把 <Tex>{'w'}</Tex> 多調 <Tex>{String.raw`0.05/E[x^2]=0.15`}</Tex> 才能讓平均歸零。圖上的 <Tex>{String.raw`b\,E[x]`}</Tex> 與「除以{' '}
        <Tex>{'E[x^2]'}</Tex>」，就是下面推導第二行的 offset 項與第三行的分母。
      </p>
      <Fig id="offset-path" />
      <StepDerivation
        title="靜態式（主迴路不碰 comparator 的 DC）"
        steps={[
          { tex: String.raw`e_\mathrm{det}=(a-w)x+b`, why: m('只保留 offset：令 $d=0$、$\\varepsilon_{cc}=0$。') },
          { tex: String.raw`E[x\,e]=(a-w)E[x^2]+b\,E[x]`, why: m('乘上 $x$ 取期望值；$b$ 是常數可提出。') },
          { tex: String.raw`0=(a-w^*)E[x^2]+b\,E[x]\;\Rightarrow\;w^*=a+b\,\frac{E[x]}{E[x^2]}`, why: m('GMAC 歸零的條件，移項後除以 $E[x^2]$。') },
        ]}
      />
      <TexBlock id="F-11.5" label="靜態 offset bias（PD 的 DC 未被主迴路消除）">
        {F.offset}
      </TexBlock>
      <p>
        用不同的 code 分布算一次（<Tex>{'b=0.1'}</Tex> t.u.，數字由模型即時計算）：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>code 分布</th>
              <th>
                <Tex>{'E[x]'}</Tex>
              </th>
              <th>
                <Tex>{'E[x^2]'}</Tex>
              </th>
              <th>
                <Tex>{'\\operatorname{Var}(x)'}</Tex>
              </th>
              <th>
                <Tex>{String.raw`w^*-a=b\,E[x]/E[x^2]`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.label}>
                <td>{m(r.label)}</td>
                <td className="num">{num(chop(r.mo.Ex, r.mo.Ex2), 5)}</td>
                <td className="num">{num(r.mo.Ex2, 5)}</td>
                <td className="num">{num(r.mo.varX, 5)}</td>
                <td className="num">{num(chop(b * r.ratio, b), 5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {m(
          `非負的 DTC residue（$x\\in[0,1)$）最糟：$E[x]/E[x^2]=${texNum(uniRow.ratio, 4)}$，$b=${b}$ t.u. 的 offset 就造成 $${texNum(b * uniRow.ratio, 4)}$ t.u. 的 gain 誤差。這就是規格書說的「假 Gain Bias」。`,
        )}
      </p>

      <h3>
        但主迴路會不會把 b 吃掉？三種架構 <Erratum id="E03" />
      </h3>
      <p>
        靜態式偷偷假設了一件事：<Tex>{'b'}</Tex> 以及 <Tex>{'x'}</Tex> 相關項的 DC 分量原封不動地到達 comparator。可是在全站的架構裡（章首的系統地圖），comparator 看的
        PD 輸出就是送進主 PLL loop filter 的同一個節點，而 <Tex>{String.raw`H_\mathrm{PD}=1/(1+L)`}</Tex>（<Tex>{String.raw`H_\mathrm{PD}`}</Tex>：從 PD 的
        reference 輸入端注入的擾動到 PD 輸出的轉移函數，DTC 的殘餘誤差就是從這裡進來；
        <Tex>{'L'}</Tex>：主迴路的開迴路增益）在 DC 的增益是 0。type-II（有積分路徑）的 BBPD-PLL 在 lock 時會強制 <Tex>{'E[q]=0'}</Tex>。結果取決於架構：
      </p>
      <p>
        先看 <FigRef id="dc-null" /> 三個框共同的部分：誤差 → comparator → GMAC。再看藍色的積分路徑接在哪裡：(A) 根本沒有這條路；(B)
        它累加的是 comparator 自己的輸出 <Tex>{'q'}</Tex>，穩態時 <Tex>{'E[q]=0'}</Tex>；(C) 它累加的是線性 PD 的誤差{' '}
        <Tex>{String.raw`e_\mathrm{PD}`}</Tex>，而 comparator 的 offset <Tex>{'b'}</Tex> 落在這個迴路外面。這裡 <Tex>{'\\varphi'}</Tex> 是主迴路經 VCO、divider
        加回 PD 的 static phase offset（feedback edge 再早到 <Tex>{'\\varphi'}</Tex>，等於誤差多一項 <Tex>{'+\\varphi'}</Tex>；單位 t.u.），<Tex>{'k_\\varphi'}</Tex> 是積分路徑每個 sample 的步長。圖上每個框裡「GMAC 的固定點」那一塊，就是下面三張卡片的公式；
        <Tex>{String.raw`\operatorname{Cov}`}</Tex> 與 <Tex>{String.raw`\operatorname{Var}`}</Tex> 是共變異數與變異數（§11.0 的先備知識框）。
      </p>
      <Fig id="dc-null" />
      <div className="grid-3 ch11-arch-grid">
        <div className="card">
          <strong>(A) none：DC 沒被消除</strong>
          <p className="small">{m('校正期間主迴路 frozen、迴路沒有積分路徑、或 $x$ 已零均值。')}</p>
          <TexBlock>{String.raw`w^*=a+\frac{bE[x]+E[xd]+E[x\varepsilon_{cc}]}{E[x^2]}`}</TexBlock>
        </div>
        <div className="card">
          <strong>{m('(B) shared BBPD：$E[q]=0$')}</strong>
          <p className="small">{m('$q$ 就是 type-II 主 PLL 的 BBPD。$b$ 被吸收成 static phase offset $\\varphi$。')}</p>
          <TexBlock id="F-11.6">{F.sharedBbpd}</TexBlock>
        </div>
        <div className="card">
          <strong>(C) linear PD + 獨立 comparator</strong>
          <p className="small">{m('主迴路由線性 PD/TDC 鎖定（$E[e_\\mathrm{PD}]=0$），另一個帶 offset 的 comparator 觀察 $e_\\mathrm{PD}$。')}</p>
          <TexBlock id="F-11.7">{F.linearPd}</TexBlock>
        </div>
      </div>
      <ModeDetails title={m('推導 (B)：共用 BBPD 為什麼讓 $b$ 消失、分母變成 $\\operatorname{Var}(x)$')}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`q[n]=\operatorname{sign}\big(e_\mathrm{det}(x[n];w)+\varphi+v[n]\big),\qquad \varphi[n+1]=\varphi[n]-k_\varphi\,q[n]`,
              why: m('主迴路的積分路徑累加 BBPD 的輸出；累加值經 VCO、divider 讓 feedback edge 再早到 $\\varphi$（static phase offset），在 PD 相減後就是誤差裡的 $+\\varphi$。'),
            },
            { tex: String.raw`E[q]=0`, why: '積分器在穩態不再漂移的唯一可能：輸入的平均為 0（type-II 迴路的 lock 條件）。' },
            { tex: String.raw`E[q]\approx K_q\,E[e_\mathrm{det}+\varphi]=0\;\Rightarrow\;\varphi=-E[e_\mathrm{det}]`, why: m('comparator 線性化（條件同 F-11.3），解出主迴路自動加上的 $\\varphi$。') },
            {
              tex: String.raw`E[q\,x]\approx K_q\,E\big[x\,(e_\mathrm{det}-E[e_\mathrm{det}])\big]=K_q\operatorname{Cov}(x,e_\mathrm{det})`,
              why: m('代回 $\\varphi$；$E[x(y-E[y])]=E[xy]-E[x]E[y]$ 就是共變異數。'),
            },
            {
              tex: String.raw`\operatorname{Cov}(x,e_\mathrm{det})=(a-w)\operatorname{Var}(x)+\underbrace{\operatorname{Cov}(x,b)}_{=0}+\operatorname{Cov}(x,d)+\operatorname{Cov}(x,\varepsilon_{cc})`,
              why: m('共變異數對第二個變數是線性的；常數 $b$ 與任何東西的共變異數都是 0。'),
            },
            { tex: String.raw`w^*\approx a+\frac{\operatorname{Cov}(x,\,d+\varepsilon_{cc})}{\operatorname{Var}(x)}`, why: m('令 $\\operatorname{Cov}(x,e_\\mathrm{det})=0$ 解 $w^*$：offset 不再出現，分母從 $E[x^2]$ 變成 $\\operatorname{Var}(x)$。') },
          ]}
        />
      </ModeDetails>
      <ModeDetails title="推導 (C)：線性 PD 鎖定 + 帶 offset 的 comparator 反而 bias 更大">
        <StepDerivation
          steps={[
            { tex: String.raw`e_\mathrm{PD}=e_\mathrm{det}-b+\varphi`, why: m('線性 PD/TDC 看不到 comparator 自己的 offset $b$。') },
            { tex: String.raw`E[e_\mathrm{PD}]=0\;\Rightarrow\;\varphi=-E[e_\mathrm{det}-b]`, why: '線性主迴路的積分路徑強制 PD 誤差平均為 0（精確，不需線性化）。' },
            { tex: String.raw`q=\operatorname{sign}(e_\mathrm{PD}+b+v)`, why: m('獨立的 comparator 觀察 $e_\\mathrm{PD}$，並加上它自己的 offset。') },
            {
              tex: String.raw`E[q\,x]\approx K_q\,E\big[x\,(e_\mathrm{PD}+b)\big]=K_q\big[\operatorname{Cov}(x,e_\mathrm{det})+b\,E[x]\big]`,
              why: m('$e_\\mathrm{PD}$ 的平均為 0 ⇒ $E[x\\,e_\\mathrm{PD}]=\\operatorname{Cov}(x,e_\\mathrm{det})$；offset 項 $E[xb]=bE[x]$ 原封不動留下。'),
            },
            {
              tex: String.raw`w^*\approx a+\frac{b\,E[x]+\operatorname{Cov}(x,\,d+\varepsilon_{cc})}{\operatorname{Var}(x)}`,
              why: m('令上式為 0：分子保留 $bE[x]$，分母卻變成較小的 $\\operatorname{Var}(x)$ ⇒ 比靜態式更大。'),
            },
          ]}
        />
      </ModeDetails>
      <p>
        勘誤 E03 的例子：<Tex>{String.raw`x\in\{0,1,2,3\}`}</Tex>、<Tex>{'b=0.5'}</Tex>、<Tex>{'\\sigma_v=1'}</Tex>、<Tex>{'a=1'}</Tex>（即時計算）：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>模式</th>
              <th>一階公式</th>
              <th>Sign-LMS mean-field</th>
            </tr>
          </thead>
          <tbody>
            {e03.map((r) => (
              <tr key={r.mode}>
                <td>{r.mode === 'none' ? '(A) none' : r.mode === 'shared_bbpd' ? '(B) shared BBPD' : '(C) linear PD + comparator'}</td>
                <td className="num">{num(r.lin, 5)}</td>
                <td className="num">{num(r.mf, 5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ch11-tags">
        三個公式都是 <ClaimTag kind="approx" />（需 comparator 線性化與時間尺度分離）<ModelLevel level="L2" />。另外注意：DC null 時分母是 <Tex>{'\\operatorname{Var}(x)'}</Tex> 而不是{' '}
        <Tex>{'E[x^2]'}</Tex>，對 <Tex>{'x\\in[0,1)'}</Tex> 是 <Tex>{String.raw`\tfrac1{12}`}</Tex> 對 <Tex>{String.raw`\tfrac13`}</Tex> —— 有效 loop gain <Tex>{'K=K_qC'}</Tex>（
        <Tex>{'C'}</Tex> 是 regressor 與「到達 comparator 的 gain 誤差訊號」的有效相關，§11.4 詳述；此時{' '}
        <Tex>{'C=\\operatorname{Var}(x)'}</Tex>）也小 4 倍，同一個 <Tex>{'\\mu'}</Tex> 下收斂慢 4 倍。
      </p>
      <Hand id="HC-11.3">
        {m('用 4 個你自己的 code 把 (A)(B)(C) 三個一階公式各算一次（預設就是上表的 $x\\in\\{0,1,2,3\\}$、$b=0.5$），最後一步再把 code 置中。')}
      </Hand>

      <h3>
        核心程式碼：三種架構只差「主迴路加了多少 <Tex>{'\\varphi'}</Tex>」
      </h3>
      <p>
        三種模式共用同一個 mean-field GMAC（<Tex>{String.raw`E[x\operatorname{erf}((e_\mathrm{det}+\varphi)/\sqrt2\sigma_v)]`}</Tex>），差別全部在{' '}
        <Tex>{'\\varphi'}</Tex> 怎麼決定。下面第一段是精確（mean-field）版本用的 <Tex>{'\\varphi(w)'}</Tex>，第二段是上面三個一階公式的程式碼（標出的行就是 (A)(B)(C) 的分子與分母）：
      </p>
      <CodeCompare
        items={[
          {
            label: '主迴路 DC null 的偏移（mean-field 用）',
            source: biasSrc,
            region: 'dcOffset',
            path: BIAS_PATH,
            note: '$\\varphi(w)$：(A) $\\varphi=0$；(B) 解 $E[q]=0$；(C) $\\varphi=-E[e_\\mathrm{det}-b]$。',
          },
          {
            label: '一階公式：三種模式的分子／分母',
            source: biasSrc,
            region: 'linearizedFixedPoint',
            path: BIAS_PATH,
            note: '(A) $E[xB]/E[x^2]$；(B) $\\operatorname{Cov}(x,B)/\\operatorname{Var}(x)$；(C) $(\\operatorname{Cov}(x,B)+bE[x])/\\operatorname{Var}(x)$。',
          },
        ]}
        caption="Lab 與下方實驗的「一階公式」「mean-field」兩欄分別由這兩個函式計算（同一份原始碼，?raw 匯入）。"
      />

      <DcNullExperiment />

      <h3>
        主迴路自己的抖動也是 dither：<Tex>{String.raw`\sigma_\mathrm{eff}`}</Tex>
      </h3>
      <p>
        上面的推導把 <Tex>{'\\varphi'}</Tex> 當成一個常數。真實的 servo 不是這樣：BBPD 每個 sample 都把 <Tex>{'\\varphi'}</Tex> 往上或往下推一小步{' '}
        <Tex>{'k_\\varphi'}</Tex>，所以 <Tex>{'\\varphi'}</Tex> 會在平均值附近不停抖動。對 comparator 而言，這個抖動和 <Tex>{'v'}</Tex> 沒有差別 —— 都是加在輸入端、與目前這個 code
        無關的隨機量。
      </p>
      <p>
        先看 <FigRef id="servo-dither" /> 的「實際」那個框：comparator 的輸入除了確定性的部分，還有兩個彼此獨立的隨機量 —— servo 的抖動{' '}
        <Tex>{String.raw`\tilde\varphi[n]`}</Tex>（變異數 <Tex>{String.raw`\sigma_\varphi^2`}</Tex>）與雜訊 <Tex>{'v[n]'}</Tex>（變異數{' '}
        <Tex>{'\\sigma_v^2'}</Tex>）。再看「等效」那個框：獨立的隨機量相加，變異數也相加，所以可以合併成一個標準差為{' '}
        <Tex>{String.raw`\sigma_\mathrm{eff}`}</Tex> 的等效雜訊（<Tex>{String.raw`\sigma_\mathrm{eff}`}</Tex>：comparator 實際感受到的總雜訊）。圖上的{' '}
        <Tex>{String.raw`\bar\varphi`}</Tex>、<Tex>{String.raw`\tilde\varphi`}</Tex>，就是下面推導第一行把 <Tex>{'\\varphi'}</Tex> 拆成的平均值與抖動；等效框裡的式子就是 F-11.17。
      </p>
      <Fig id="servo-dither" />
      <ModeDetails title={m('推導：$\\varphi$ 的抖動為什麼等於把 $\\sigma_v$ 換成 $\\sigma_\\mathrm{eff}$')}>
        <StepDerivation
          steps={[
            { tex: String.raw`\varphi[n]=\bar\varphi+\tilde\varphi[n],\qquad E[\tilde\varphi]=0,\quad \operatorname{Var}(\tilde\varphi)=\sigma_\varphi^2`, why: m('把 servo 的輸出拆成平均值 $\\bar\\varphi$ 與抖動 $\\tilde\\varphi$。') },
            { tex: String.raw`q[n]=\operatorname{sign}\big(e_\mathrm{det}(x[n];w)+\bar\varphi+\underbrace{\tilde\varphi[n]+v[n]}_{\text{總隨機量}}\big)`, why: m('comparator 看到的是兩個隨機量的和。') },
            { tex: String.raw`\tilde\varphi[n]\ \text{只由過去的 }q[n-1],q[n-2],\dots\text{ 決定}\;\Rightarrow\;\tilde\varphi[n]\ \text{與 }x[n],\,v[n]\ \text{獨立}`, why: m('iid code：過去的 sample 不帶有「這一個」code 的資訊。（DSM 的慢 pattern 不滿足這個條件，見下。）') },
            { tex: String.raw`\operatorname{Var}(\tilde\varphi+v)=\sigma_\varphi^2+\sigma_v^2\equiv\sigma_\mathrm{eff}^2`, why: '獨立隨機量相加，變異數相加（先備知識：Var）。' },
            { tex: String.raw`E[q\mid x]\approx\operatorname{erf}\!\Big(\frac{e_\mathrm{det}(x;w)+\bar\varphi}{\sqrt2\,\sigma_\mathrm{eff}}\Big)`, why: m('把 $\\tilde\\varphi+v$ 近似成 Gaussian（$\\tilde\\varphi$ 本身不是 Gaussian，所以這一步是近似），套用 F-11.2。') },
          ]}
          result={String.raw`w^*_\text{servo-aware}=\text{把 }\sigma_v\text{ 換成 }\sigma_\mathrm{eff}\text{ 之後的 mean-field 根}`}
        />
      </ModeDetails>
      <TexBlock id="F-11.17" label="servo-aware 固定點（本站延伸；以 Monte Carlo 驗證）">
        {F.servoAware}
      </TexBlock>
      <p className="ch11-tags">
        <ClaimTag kind="research" /> <ModelLevel level="L2" />
      </p>
      <p>
        影響有多大？看 §11.2 的 <Tex>{'w^*(\\sigma_v)'}</Tex> 曲線就知道：<Tex>{'\\sigma_v'}</Tex> 很大時曲線是平的（多一點 dither 沒差）；但在{' '}
        <Tex>{String.raw`\sigma_v\lesssim\max|e_\mathrm{det}|`}</Tex> 的陡峭區，<Tex>{'\\sigma_v'}</Tex> 多幾個百分點，固定點就明顯移動。上面實驗的「servo-aware」欄與 Lab
        的指標表會顯示 Monte Carlo 量到的 <Tex>{'\\sigma_\\varphi'}</Tex>、對應的 <Tex>{String.raw`\sigma_\mathrm{eff}`}</Tex> 與修正後的固定點。載入上面實驗的
        preset「servo 抖動也是 dither」（5-level、<Tex>{'c_3=0.1'}</Tex>、<Tex>{'b=0.3'}</Tex>、<Tex>{'\\sigma_v=0.1'}</Tex>）試試看：模式 (B) 的 Monte Carlo
        不會落在「理想 DC null」的 mean-field 上，而是落在 servo-aware 那一欄。這是兩難：<Tex>{'k_\\varphi'}</Tex> 大 ⇒ servo 快、但抖動大（dither 多）；
        <Tex>{'k_\\varphi'}</Tex> 小 ⇒ 抖動小、但 servo 跟不上 <Tex>{'w'}</Tex> 每個 block 的跳動（Lab 的指標會顯示 servo 時間常數 <Tex>{'\\tau'}</Tex> 與落後造成的偏移估計）。
      </p>
      <ModeGate min="research">
        <Callout kind="info" title="Research：這個近似什麼時候不成立？">
          <ul>
            <li>
              {m(
                '$\\sigma_v=0$ 時 $\\tilde\\varphi$ 是唯一的 dither，而它的分布不是 Gaussian（bang-bang servo 的 limit cycle）：servo-aware 只能解釋大部分偏移，所以 Lab 的容許量另外加上修正量的 25%。',
              )}
            </li>
            <li>
              {m(
                'DSM residue 接近整數 FCW 時是慢慢爬升的 sawtooth：servo 跟得上 pattern，$\\tilde\\varphi[n]$ 與 $x[n]$ 不再獨立 —— 主迴路把低頻的 $x$ 也消掉了。這就是 §11.4 的 $C=E[x\\,(h*x)]\\neq\\operatorname{Var}(x)$，iid mean-field 不適用（Lab 會發出警告）。',
              )}
            </li>
            <li>{m('$\\mu$ 太大時 $w$ 的變動和 servo 一樣快，兩個迴路互相耦合（Ch08 的 dual-loop）：時間尺度分離的前提就不成立。')}</li>
          </ul>
        </Callout>
      </ModeGate>

      <h3>Code centering：有用，但有四個但書</h3>
      <p>
        Code centering 指的是把 GMAC 用的 code 減去它的平均，讓 <Tex>{'E[x]=0'}</Tex>，offset 項 <Tex>{String.raw`b\,E[x]`}</Tex> 就消失。它什麼時候真的有效？
        <FigRef id="centering-tree" /> 把這一小節整理成一棵判斷樹：由上往下回答四個問題，只有一路答「是／沒有」才走到綠色的 <Tex>{'w^*=a'}</Tex>
        ；每個紅色出口對應下面的一個反例。這棵樹只回答「offset 還會不會變成 gain bias」—— 下面第 1、4 兩個但書（DTC 參數要一起重新定義、有效激勵變小）是即使走到綠色出口也要付的代價。
      </p>
      <Fig id="centering-tree" />
      <ModeDetails title={m('精確結果：$\\sigma_v$ 與 code 無關、$d=\\varepsilon_{cc}=0$、$E[x]=0\\Rightarrow w=a$ 是精確固定點（任意 $b$）')} openFrom="beginner">
        <StepDerivation
          steps={[
            { tex: String.raw`e_\mathrm{det}(x;a)=(a-a)x+b=b`, why: m('在 $w=a$ 時，只剩 offset，而且和 code 無關。') },
            { tex: String.raw`E[G](a)=E\Big[x\operatorname{erf}\!\Big(\frac{b}{\sqrt2\sigma_v}\Big)\Big]=\operatorname{erf}\!\Big(\frac{b}{\sqrt2\sigma_v}\Big)E[x]`, why: m('$\\operatorname{erf}(\\cdot)$ 是常數，可以提到期望值外面 —— 不需要任何線性化。') },
            { tex: String.raw`E[x]=0\;\Rightarrow\;E[G](a)=0`, why: m('code 置中 ⇒ $w=a$ 是精確的根（Sign 與 MSE 皆然）。') },
          ]}
        />
        <p className="small">
          數值例：5-level code、<Tex>{'b=0.7'}</Tex>、<Tex>{'\\sigma_v=0.4'}</Tex>，<Tex>{String.raw`E[G](a)=${texNum(centering.gAtA)}`}</Tex>。 <ClaimTag kind="exact" />
        </p>
      </ModeDetails>
      <ol>
        <li>
          <strong>DTC 參數要重新定義。</strong> 若需要的補償量是 <Tex>{'a\\,x+o'}</Tex>（<Tex>{'o'}</Tex> 是固定的時間 offset，和 DTC 的基準延遲{' '}
          <Tex>{'T_0'}</Tex> 是同一類的常數），改用置中的 <Tex>{'x_c=x-m'}</Tex>（<Tex>{'m=E[x]'}</Tex>）後變成{' '}
          <Tex>{String.raw`a\,x_c+(o+a\,m)`}</Tex>：offset 暫存器必須吸收 <Tex>{'a\\,m'}</Tex>，而且 <Tex>{'a'}</Tex> 一改，offset 也跟著改 —— gain 與 offset 的 parameterization
          必須一起變換，不能只在 GMAC 端減平均。
        </li>
        <li>
          <strong>Comparator 飽和時，offset 仍會經由 erf 的非線性影響其他 bias。</strong> 置中只保證「offset 本身」不產生 gain bias；當 <Tex>{'|b|'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 同量級，comparator
          的工作點移到 S 曲線的彎曲段，{m('INL 的 bias 隨 $b$ 改變。例：5-level、$c_3=0.1$、$\\sigma_v=0.5$：')}
          {centering.sat.map((s) => (
            <span key={s.b}>
              {' '}
              <Tex>{`b=${s.b}`}</Tex> ⇒ <Tex>{`w^*=${texNum(s.w, 5)}`}</Tex>；
            </span>
          ))}{' '}
          若 <Tex>{'|e_\\mathrm{det}|/\\sigma_v'}</Tex> 對所有 code 都很大，<Tex>{'q'}</Tex> 幾乎恆為同號，GMAC 根本沒有資訊（Lab 會發出「Comparator 飽和」警告）。
        </li>
        <li>
          <strong>Code-dependent jitter 讓 centering 失效（Sign-LMS 限定）。</strong>
          <Erratum id="E17" /> DTC 的 random jitter 常隨它的延遲變大，而延遲由 code 決定，所以雜訊的大小是 code 的函數：
          <Tex>{String.raw`\sigma_v=\sigma_v(x)`}</Tex>。Sign-LMS 的局部增益{' '}
          <Tex>{String.raw`K_q(x)=\sqrt{2/\pi}/\sigma_v(x)`}</Tex> 隨 code 改變，固定點變成 <Tex>{'1/\\sigma_v(x)'}</Tex> 加權（推導見下）。
        </li>
        <li>
          <strong>非零均值的 residue 置中後，有效激勵變小。</strong> 分母從 <Tex>{'E[x^2]'}</Tex> 變成 <Tex>{'\\operatorname{Var}(x)'}</Tex>，GMAC 斜率與收斂速度一起下降（上面的 4 倍）。
        </li>
      </ol>
      <p>
        <FigRef id="jitter-weight" /> 用勘誤 E17 的數字（置中的 5-level code、<Tex>{'b=0.2'}</Tex>、<Tex>{String.raw`\sigma_v(x)=\sqrt{1+0.25(x+2)^2}`}</Tex>）走一次。先看最上面的分叉：{' '}
        <Tex>{String.raw`\sigma_v`}</Tex> 是常數時，每個 code 的 <Tex>{'K_q'}</Tex> 一樣大，五個 code 的權重相同；<Tex>{String.raw`\sigma_v(x)`}</Tex> 隨 code 變大時，權重變成{' '}
        <Tex>{String.raw`1/\sigma_v(x)`}</Tex>（藍色）。再看中間那一排：加權後取平均，常數 <Tex>{String.raw`\sigma_v`}</Tex> 的正負兩邊剛好抵銷；<Tex>{'x<0'}</Tex> 的 code 雜訊較小、
        權重較大，抵銷不了。最下面一排就是下面推導的最後兩行。
      </p>
      <Fig id="jitter-weight" />
      <p className="small">
        方向的提醒：這個例子沿用勘誤 E17 的數字，jitter 最小的 code（記作 <Tex>{'x_j'}</Tex>）取在最小的那一個（<Tex>{'x_j=-2'}</Tex>，<Tex>{String.raw`\sigma_v`}</Tex> 隨{' '}
        <Tex>{'x'}</Tex> 變大）。全站的接法是 reference 端的 DTC，延遲是 <Tex>{String.raw`T_0-w\,x`}</Tex>：code 越大延遲越短，jitter 最小的是最大的 code。把{' '}
        <Tex>{'x_j'}</Tex> 換成 <Tex>{'+2'}</Tex>，五個權重左右對調，<Tex>{String.raw`b\,E[x/\sigma_v(x)]`}</Tex> 變號，固定點變成{' '}
        <Tex>{texNum(centering.jitMirror, 5)}</Tex> —— 偏移的大小不變、方向相反（即時計算）。
      </p>
      <ModeDetails title={m('推導：code-dependent $\\sigma_v(x)$ 下的 Sign-LMS 固定點（$1/\\sigma_v$ 加權）')}>
        <StepDerivation
          steps={[
            { tex: String.raw`E[q\mid x]\approx K_q(x)\,e_\mathrm{det}(x),\qquad K_q(x)=\frac{\sqrt{2/\pi}}{\sigma_v(x)}`, why: '每個 code 有自己的雜訊大小，所以線性化的斜率也不同。' },
            { tex: String.raw`E[q\,x]\approx\sqrt{2/\pi}\;E\Big[\frac{x\,e_\mathrm{det}(x)}{\sigma_v(x)}\Big]`, why: m('tower property，再把常數 $\\sqrt{2/\\pi}$ 提出。') },
            { tex: String.raw`e_\mathrm{det}=(a-w)x+B(x),\qquad B(x)=b+d(x)+\varepsilon_{cc}(x)`, why: '把確定性誤差分成 gain 項與其餘 bias 項。' },
            { tex: String.raw`0=(a-w^*)E\Big[\frac{x^2}{\sigma_v(x)}\Big]+E\Big[\frac{x\,B(x)}{\sigma_v(x)}\Big]`, why: '代入並令平均 GMAC 為 0。' },
            { tex: String.raw`w^*\approx a+\frac{E\big[x\,B(x)/\sigma_v(x)\big]}{E\big[x^2/\sigma_v(x)\big]}`, why: m('解出 $w^*$：每個 code 的貢獻以 $1/\\sigma_v(x)$ 加權（F-11.12）。') },
            { tex: String.raw`B\equiv b,\;E[x]=0:\quad E\Big[\frac{x\,b}{\sigma_v(x)}\Big]=b\,E\Big[\frac{x}{\sigma_v(x)}\Big]\neq0`, why: m('$x$ 與 $1/\\sigma_v(x)$ 相關（下面的例子裡大 code 雜訊大、權重小），置中不再讓 offset 項消失。') },
          ]}
        />
        <TexBlock id="F-11.12">{F.jitterWeighted}</TexBlock>
      </ModeDetails>
      <p>
        勘誤 E17 的例子：5-level code、<Tex>{String.raw`\sigma_v(x)=\sqrt{1+0.25(x+2)^2}`}</Tex> ={' '}
        {centering.sigmas.map((s, i) => (
          <span key={i}>{(i ? '、' : '') + num(s, 4)}</span>
        ))}
        ，<Tex>{'b=0.2'}</Tex>、無 INL（即時計算）：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <tbody>
            <tr>
              <td>Sign-LMS mean-field</td>
              <td className="num">{num(centering.jitSign, 5)}</td>
              <td>
                一階加權公式 {num(centering.jitLin, 5)} <ClaimTag kind="approx" />
              </td>
            </tr>
            <tr>
              <td>{m('同一條件但 $\\sigma_v\\equiv1$')}</td>
              <td className="num">{num(centering.jitConst, 5)}</td>
              <td>centering 有效（精確 = a）</td>
            </tr>
            <tr>
              <td>{m('MSE-LMS（任何 $\\sigma_v(x)$）')}</td>
              <td className="num">{num(centering.jitMse, 5)}</td>
              <td>MSE 的 GMAC 不經過 erf，不受影響</td>
            </tr>
            <tr>
              <td>{m('$b=0$（只有 code-dependent jitter）')}</td>
              <td className="num">{num(centering.jitNoBias, 5)}</td>
              <td>零均值 jitter 本身不造成 bias，只重新加權其他 bias</td>
            </tr>
            <tr>
              <td>{m('再加 $c_3=0.1$')}</td>
              <td className="num">{num(centering.jitCubic, 5)}</td>
              <td>{m(`$\\sigma_v$ 為常數時是 $${texNum(centering.jitCubicConst, 5)}$`)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>無雜訊 + offset：dead zone</h3>
      <p>
        <Tex>{'\\sigma_v=0'}</Tex> 時 comparator 只看正負號。把每個 code 的「零誤差 gain」寫成 <Tex>{String.raw`t(x)=a+b/x`}</Tex>（令 <Tex>{'(a-t)x+b=0'}</Tex>），則{' '}
        <Tex>{String.raw`x\operatorname{sign}(e)=|x|\operatorname{sign}(t(x)-w)`}</Tex>，平均 GMAC 是 <Tex>{'t(x)'}</Tex> 的 <Tex>{'|x|'}</Tex> 加權「中位數」條件（§11.2
        會詳細推導）。<Tex>{String.raw`x\in\{0,1,2,3\}`}</Tex>、<Tex>{'b=1'}</Tex>：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>
                <Tex>{'x'}</Tex>
              </th>
              <th>
                <Tex>{'t(x)=a+b/x'}</Tex>
              </th>
              <th>
                權重 <Tex>{'p\\,|x|'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {dead.rows.map((r) => (
              <tr key={r.x}>
                <td className="num">{r.x}</td>
                <td className="num">{num(r.t, 5)}</td>
                <td className="num">{num(r.wt, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <FigRef id="dead-zone" /> 把上表的票數畫成三個區域。先看左邊兩個方塊：<Tex>{'w'}</Tex> 小於 <Tex>{String.raw`t(3)=a+\tfrac13`}</Tex>{' '}
        時三個 code 都投「往上」，<Tex>{'E[G]=+1.5'}</Tex>；<Tex>{'w'}</Tex> 大於 1.5 時至少兩個 code 投「往下」，<Tex>{'E[G]<0'}</Tex>。再看紅色的方塊：
        <Tex>{'w'}</Tex> 落在兩者之間時，code 3 投「往下」的 <Tex>{'-0.75'}</Tex> 剛好抵銷 code 1、2 投「往上」的 <Tex>{'+0.25+0.5'}</Tex>，
        <Tex>{'E[G]=0'}</Tex> —— 沒有任何推力。圖上的 <Tex>{'E[G]'}</Tex> 就是上表的權重乘上 <Tex>{String.raw`\operatorname{sign}(t(x)-w)`}</Tex> 再相加。
      </p>
      <Fig id="dead-zone" />
      <p>
        {m(
          `總權重 $${texNum(dead.totalWt)}$、一半 $${texNum(dead.totalWt / 2)}$；由小到大累加 $t$：$t(3)=a+1/3$ 的權重 $${texNum(dead.rows[dead.rows.length - 1].wt)}$ 剛好等於一半，所以在`,
        )}{' '}
        <Tex>{String.raw`(${texNum(dead.zone.lo, 5)},\,${texNum(dead.zone.hi, 5)})`}</Tex> 整段區間內 <Tex>{'E[G]=0'}</Tex>（例如 <Tex>{String.raw`E[G](1.4)=${texNum(dead.gIn)}`}</Tex>
        ）。這是一個 <strong>dead zone</strong>：
        {m(
          `$w$ 停在哪裡由初值和 $\\mu$ 決定。加入雜訊就像加入 dither，零交越變成唯一：$\\sigma_v=0.05$ 時 $w^*=${texNum(dead.w005, 5)}$，$\\sigma_v=1$ 時 $w^*=${texNum(dead.w1, 5)}$（MSE-LMS 為 $${texNum(dead.mse, 5)}$）。`,
        )}<ClaimTag kind="exact" />
      </p>
      <Callout kind="warn" title="置中的 code 也躲不過：無雜訊時 offset 仍造成 dead zone">
        {m(
          `上面「centering 精確有效」的結果需要 $\\sigma_v>0$。5-level 置中 code、$b=0.1$、$\\sigma_v=0$：$t(\\pm1)=a\\pm b$、$t(\\pm2)=a\\pm b/2$，權重 $p|x|$ 分別為 $0.2$ 與 $0.4$，累積到 $t=a-b/2$ 時剛好是總重的一半 ⇒ $E[G]=0$ 於整段 $(${texNum(dead.centered.lo, 5)},\\,${texNum(dead.centered.hi, 5)})$（即 $(a-b/2,\\,a+b/2)$）。$w=a$ 是解之一，但 LMS 不一定停在那裡。只要 $\\sigma_v=0.05$，唯一根就回到 $w^*=${texNum(dead.centeredNoisy, 6)}$。`,
        )}{' '}
        <ClaimTag kind="exact" />
      </Callout>
      <ModeGate min="research">
        <Callout kind="info" title="Research：dead zone 與 limit cycle 的關係">
          在 dead zone 內，平均 GMAC 為 0 但單一 block 的 <Tex>{'G_k'}</Tex> 仍隨抽到的 code 而波動（例如 <Tex>{'G_k'}</Tex> 的變異數不為 0），所以 <Tex>{'w'}</Tex>{' '}
          做零漂移的隨機漫步，直到碰到區間邊界被推回：有限時間的 MC 平均不會收斂到某個特定值。這和 §11.2 無雜訊 Sign-LMS 的 <Tex>{'O(\\mu)'}</Tex> limit cycle 不同（那裡{' '}
          <Tex>{'E[G]'}</Tex> 在 <Tex>{'w^*'}</Tex> 兩側變號）。
        </Callout>
      </ModeGate>
    </Section>
  )
}
