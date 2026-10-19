import { useMemo, type ReactNode } from 'react'
import blockLmsSrc from '@/simulation/models/blockLms.ts?raw'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  ModeGate,
  ModelLevel,
  Prereq,
  Section,
  Tex,
  TexBlock,
} from '@/components'
import { runBlockLms } from '@/simulation/models/blockLms'
import { ChLink, Diagram, ErratumNote, HandCalcPointer, Steps, fx, md, sig, texNum } from '../common'
import { CHART_BLOCK_SIGN_LMS } from '../diagrams'
import { SPEC_NUMBERS, gCritical } from '../refNumbers'
import { SPEC_PSEUDO, SPEC_PSEUDO_ANNOTATED } from '../specPseudo'

const BLOCK_LMS_PATH = 'src/simulation/models/blockLms.ts'

/** 手算用的極小設定：N = 4、3 個 block，其餘為 §15.3 範例值（同一份 runBlockLms 程式） */
const HAND_CONFIG = {
  gm_accum_samples: 4,
  num_blocks: 3,
  record: { sample_trace_blocks: 3, decimate: 1 },
} as const

interface HandRow {
  k: number
  n: number
  wApp: number
  x: number
  v: number
  e: number
  q: number
  qx: number
  acc: number
}

function useHandRun() {
  return useMemo(() => {
    const r = runBlockLms(HAND_CONFIG)
    const N = r.config.gm_accum_samples
    const a = r.config.gain_true
    const rows: HandRow[] = []
    let acc = 0
    for (let i = 0; i < r.trace.n.length; i++) {
      const k = Math.floor(r.trace.n[i] / N)
      if (i % N === 0) acc = 0
      const wApp = r.blocks.wPhys[k]
      const x = r.trace.x[i]
      const e = r.trace.e[i]
      const q = r.trace.q[i]
      acc += q * r.trace.xRef[i]
      rows.push({ k, n: r.trace.n[i], wApp, x, v: e - (a - wApp) * x, e, q, qx: q * r.trace.xRef[i], acc })
    }
    return { rows, res: r }
  }, [])
}

const MAPPING: { pseudo: string; site: string; math: string; note?: ReactNode }[] = [
  { pseudo: 'for k in range(num_updates)', site: 'core:blockLmsBlockLoop：for (let k = 0; k < K; k++)', math: String.raw`k=0,\dots,K-1` },
  {
    pseudo: '（偽程式沒有）',
    site: 'wApp = wPhys[k - dUp]',
    math: String.raw`w_\mathrm{app}=Q_\mathrm{phys}(w_{k-d})`,
    note: md('更新延遲 $d$（規格 §8.3）與實體 code 量化（規格 §13）'),
  },
  { pseudo: 'x = code_generator.next()', site: 'src.fill(xext, D, N)；再 (x - o) * s 正規化', math: String.raw`x[n]=(x_\mathrm{raw}[n]-o)\,s`, note: md('$o$、$s$ 由整段 record 預先掃描（非因果）') },
  {
    pseudo: 'u = pll_pd_error_path.filter(x)',
    site: 'dt = coef * x + nl(x)；u = pathF.step(dt)',
    math: String.raw`u_e[n]=H_\mathrm{PD}\{(a-w_\mathrm{app})x+\mathrm{nl}(x)\}[n]`,
    note: '本站濾波的是 DTC 誤差；StreamFilter 狀態跨 block 持續',
  },
  { pseudo: 'e = (a_true - w) * u + noise', site: 'e = u + bOff + sigma * gauss()', math: String.raw`e[n]=u_e[n]+b+v[n]`, note: md('Ziggurat 產生 $\\mathcal N(0,1)$，seed 可重現') },
  {
    pseudo: 'q = +1 if e >= 0 else -1',
    site: 'q = e >= 0 ? 1 : qLo（qLo = -1；0/1 編碼先映射）',
    math: String.raw`q[n]=\operatorname{sgn}_{+}(e[n])`,
    note: <>{md('tie 規則 $e=0\\Rightarrow q=+1$；0/1 編碼用 $q=2b-1$')} <ErratumNote id="E07" /></>,
  },
  { pseudo: 'x_ref = aligned_or_filtered_regressor(x, u)', site: 'xr[n]：xext（raw / delayed）或 rext（filtered-x）', math: String.raw`x_\mathrm{ref}[n]\in\{x[n],\,x[n-D],\,(\hat h*x)[n-D]\}` },
  { pseudo: 'gm += q * x_ref', site: 'acc += q * xrn', math: String.raw`S_k=\sum_{n\in k}q[n]x_\mathrm{ref}[n]` },
  { pseudo: 'G = gm / N', site: 'Gk = avg ? acc / N : acc', math: String.raw`G_k=S_k/N\;(\text{或 }S_k)`, note: <>sum vs average <ErratumNote id="E18" /></> },
  {
    pseudo: 'w = saturate_or_update_high_precision(w + mu·G)',
    site: 'core:blockLmsGmacUpdate：wCur + mu·Gk；qz 時 roundWith + clampOrWrap',
    math: String.raw`w_{k+1}=w_k+\mu G_k`,
    note: md('L5：內部有 $F=\\text{internal\\_bits}-\\text{physical\\_bits}$ 個小數 bit'),
  },
  { pseudo: 'record(k, w, G)', site: 'w[k+1]、wPhys[k+1]、G[k]（Float64Array）', math: String.raw`\{w_k,\,G_k\}` },
]

/** §3 參考 Block Sign-LMS：偽程式 vs 本站實作、手算、推導 */
export function S3Reference() {
  const hand = useHandRun()
  const n = SPEC_NUMBERS
  const N = hand.res.config.gm_accum_samples
  const mu = hand.res.config.gain_step
  const blocks = [0, 1, 2]
  return (
    <section aria-labelledby="models-s3">
      <h2 id="models-s3">3｜參考 Block Sign-LMS：規格偽程式 vs 本站實際執行的程式（§15.2）</h2>
      <p>
        規格 §15.2 給了一段十幾行的 Python 偽程式（12 行程式加 2 行註解）。它把整個校正迴路濃縮成兩層迴圈：外層每個 GMAC block 更新一次 gain，內層每個 comparator sample 累加一次 <Tex>{'q\\cdot x_\\mathrm{ref}'}</Tex>。本站的 <code>runBlockLms</code> 就是這段偽程式的「可執行版」，但多處理了幾件偽程式略過、而 RTL 一定會遇到的事。
      </p>
      <p>
        先看圖，再看程式。圖裡的每一個方塊，在 §3.1 的程式裡都找得到對應的那一行；符號的意思：<Tex>{'x[n]'}</Tex> 是正規化後的 code，<Tex>{'a'}</Tex> 是真實的 DTC gain、<Tex>{'w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的校正係數，
        <Tex>{'e[n]'}</Tex> 是 comparator 的輸入（取自 PD 的輸出）、<Tex>{'q[n]=\\pm1'}</Tex> 是它的輸出，<Tex>{'G_k'}</Tex> 是一個 block 內 <Tex>{'q\\,x_\\mathrm{ref}'}</Tex> 的平均，<Tex>{'\\mu'}</Tex> 是 learning rate。
      </p>
      <Diagram
        chart={CHART_BLOCK_SIGN_LMS}
        caption="參考 Block Sign-LMS 的兩層迴圈：內層每個 comparator sample 做一次，外層每個 block 做一次。DTC 在 reference 的輸入端，它補償之後剩下的誤差經 $H_\mathrm{PD}$ 到 PD 的輸出，comparator 取的就是這個輸出。虛線是新的係數回到 DTC 的路，整個 block 內它不變。"
        ariaLabel="Block Sign-LMS 兩層迴圈的方塊圖：內層由 code 得到 reference 端 DTC 的殘餘誤差，經 PLL error path 到 PD 的輸出，加上 offset 與雜訊後進 1-bit comparator，再乘上 regressor；外層是 GMAC 平均、係數更新與 gain register，更新後的係數回到 DTC"
      >
        <p>
          先看上面的內層。Feedback（divider）edge 比理想時刻早到 <Tex>{'a\\,x[n]'}</Tex>；reference 端的 DTC 從基準延遲 <Tex>{'T_0'}</Tex> 往回扣 <Tex>{'w_\\mathrm{app}\\,x[n]'}</Tex>（補償量），等於讓 reference edge
          也提前這麼多去對齊。PD 量的是 <Tex>{"t_\\mathrm{ref}'-t_\\mathrm{fb}"}</Tex>，所以沒補掉的部分是 code 乘上 gain 誤差 <Tex>{'a-w_\\mathrm{app}'}</Tex>，再加上 DTC 在這個 code 多出來的延遲 <Tex>{'c_2x^2+c_3x^3+o'}</Tex>（它讓 reference edge
          更晚，所以是正號）——這就是第一個方塊的時間誤差，它在 PD 的 reference 輸入端進入主 PLL。經過 <Tex>{'H_\\mathrm{PD}'}</Tex> 之後是 PD 的輸出；comparator 取的是 PD 的輸出，也就是送進 loop filter 的同一個訊號。comparator 的 offset <Tex>{'b'}</Tex> 與 comparator 前的雜訊{' '}
          <Tex>{'v[n]'}</Tex> 在模型裡都折算到同一個節點（PD 的輸出，也就是 comparator 的輸入），在加法點加進來，得到 comparator 實際比較的 <Tex>{'e[n]'}</Tex>（F-15.2）。comparator 只留下正負號，再乘上 regressor <Tex>{'x_\\mathrm{ref}[n]'}</Tex>。
        </p>
        <p>
          再看外層：<Tex>{'N'}</Tex> 個乘積平均成 <Tex>{'G_k'}</Tex>，係數走一步 <Tex>{'\\mu G_k'}</Tex>（F-15.1）。圖上的 <Tex>{'w_\\mathrm{app}'}</Tex> 是「實際作用在 DTC 上」的係數：比 <Tex>{'w_k'}</Tex> 晚 <Tex>{'d'}</Tex> 個 block，開定點時還先量化成實體 code（
          <Tex>{'\\mathrm{phys}'}</Tex>）。這三件事——濾波的是誤差、更新有延遲、係數會量化——就是偽程式沒寫的部分。
        </p>
      </Diagram>

      <Section kind="formula" title="3.1 規格原文與本站程式（並排）" level={3}>
        <CodeBlock source={SPEC_PSEUDO} lang="python" title="規格 §15.2 偽程式（原文）" caption="原文逐字照錄；pll_pd_error_path.filter() 只是示意，規格本身也提醒不可每個 block 重置濾波器。" />
        <CodeCompare
          items={[
            {
              label: '偽程式（加註差異）',
              source: SPEC_PSEUDO_ANNOTATED,
              lang: 'python',
              note: '同一段偽程式，用「← 差異」標出本站實作不同的地方（這是規格文字，不是執行碼）',
            },
            {
              label: 'core:blockLmsBlockSetup',
              source: blockLmsSrc,
              region: 'blockLmsBlockSetup',
              path: BLOCK_LMS_PATH,
              note: '每個 block 開頭：取延遲 $d$ 之後的實體 gain、移動 code 延遲線 $D$、正規化、filtered-x 的 $\\hat H$',
            },
            {
              label: 'core:blockLmsInnerLoop',
              source: blockLmsSrc,
              region: 'blockLmsInnerLoop',
              path: BLOCK_LMS_PATH,
              note: '內層 sample 迴圈：DTC 誤差 → $H_\\mathrm{PD}$（有狀態）→ 加 offset 與雜訊 → comparator → 累加 $q\\,x_\\mathrm{ref}$',
              highlight: [4, 6, 7, 13, 19],
            },
            {
              label: 'core:blockLmsGmacUpdate',
              source: blockLmsSrc,
              region: 'blockLmsGmacUpdate',
              path: BLOCK_LMS_PATH,
              note: 'GMAC 平均（或總和）與 gain 更新；quantize_physical 時走整數暫存器',
              highlight: [1, 4, 9],
            },
          ]}
          caption="右側三段就是網站執行的 TypeScript（?raw 匯入 + #region 擷取）；在 worker 裡跑的也是同一份。"
        />
      </Section>

      <Section kind="diagram" title="3.2 逐行對照：偽程式 ↔ 程式 ↔ 數學" level={3}>
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>偽程式</th>
                <th>本站程式</th>
                <th>數學</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {MAPPING.map((m) => (
                <tr key={m.pseudo + m.site}>
                  <td>
                    <code>{m.pseudo}</code>
                  </td>
                  <td>
                    <code>{m.site}</code>
                  </td>
                  <td className="nowrap">
                    <Tex>{m.math}</Tex>
                  </td>
                  <td className="small">{m.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="warn" title="三個偽程式沒寫、但會改變數字的地方">
          <ol className="models-tight">
            <li>
              <strong>濾波的是誤差，不是 code</strong>：PD 看到的是 <Tex>{'H_\\mathrm{PD}\\{(a-w)x\\}'}</Tex>。block 內 <Tex>{'w'}</Tex> 不變時它等於 <Tex>{'(a-w)H_\\mathrm{PD}\\{x\\}'}</Tex>，但在 block
              邊界 <Tex>{'w'}</Tex> 跳動，濾波器記憶裡還留著舊 <Tex>{'w'}</Tex> 的誤差——所以兩種寫法只在 <Tex>{'w'}</Tex> 收斂後才一致。
            </li>
            <li>
              <strong>
                更新延遲 <Tex>{'d'}</Tex>
              </strong>
              ：硬體的 commit 需要時間，第 <Tex>{'k'}</Tex> 個 block 實際用的是 <Tex>{'w_{k-d}'}</Tex>，穩定界由 <Tex>{'0<g<2'}</Tex> 縮成{' '}
              <Tex>{'0<g<2\\sin\\frac{\\pi}{4d+2}'}</Tex>（§3.4）。
            </li>
            <li>
              <strong>正規化是非因果的</strong>：<code>code_normalization</code> 用<strong>整段 record</strong> 的平均與 RMS（模擬方便，硬體做不到）。硬體通常用固定 scaling；兩者只差一個常數，會改變 <Tex>{'C'}</Tex> 與{' '}
              <Tex>{'g'}</Tex> 的數值，但不改變推導。
            </li>
          </ol>
        </Callout>
      </Section>

      <Section kind="example" title="3.3 先算一次：用真正的程式跑 $N=4$、3 個 block" level={3}>
        <p>
          把 §15.3 範例的 <Tex>{'N'}</Tex> 從 4096 改成 4（其餘不變：<Tex>{'a=3\\,\\mathrm{fs},\\;w_0=0,\\;\\mu=10\\,\\mathrm{fs},\\;\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{'\\pm1'}</Tex> code、seed
          20261010），呼叫同一個 <code>runBlockLms</code>，把它的 trace 攤開。雜訊欄 <Tex>{'v[n]=e[n]-(a-w_\\mathrm{app})x[n]'}</Tex> 是從輸出反推的。
        </p>
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>
                  <Tex>{'k'}</Tex>
                </th>
                <th>
                  <Tex>{'n'}</Tex>
                </th>
                <th>
                  <Tex>{'w_\\mathrm{app}'}</Tex>
                </th>
                <th>
                  <Tex>{'x[n]'}</Tex>
                </th>
                <th>
                  <Tex>{'v[n]'}</Tex> [fs]
                </th>
                <th>
                  <Tex>{'e[n]'}</Tex> [fs]
                </th>
                <th>
                  <Tex>{'q[n]'}</Tex>
                </th>
                <th>
                  <Tex>{'q\\,x_\\mathrm{ref}'}</Tex>
                </th>
                <th>累加 <Tex>{'S'}</Tex></th>
              </tr>
            </thead>
            <tbody>
              {hand.rows.map((r) => (
                <tr key={r.n}>
                  <td>{r.k}</td>
                  <td>{r.n}</td>
                  <td>{fx(r.wApp, 2)}</td>
                  <td>{fx(r.x, 0)}</td>
                  <td>{fx(r.v, 2)}</td>
                  <td>{fx(r.e, 2)}</td>
                  <td>{r.q > 0 ? '+1' : r.q < 0 ? '−1' : '0'}</td>
                  <td>{r.qx > 0 ? `+${fx(r.qx, 0)}` : fx(r.qx, 0)}</td>
                  <td>{fx(r.acc, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="models-hand-blocks">
          {blocks.map((k) => {
            const S = hand.res.blocks.G[k] * N
            return (
              <TexBlock key={k}>
                {String.raw`G_{${k}}=\frac{S_{${k}}}{N}=\frac{${fx(S, 0)}}{${N}}=${fx(hand.res.blocks.G[k], 2)},\qquad w_{${k + 1}}=w_{${k}}+\mu G_{${k}}=${fx(hand.res.blocks.w[k], 2)}+${mu}\times(${fx(hand.res.blocks.G[k], 2)})=${fx(hand.res.blocks.w[k + 1], 2)}\,\mathrm{fs}`}
              </TexBlock>
            )
          })}
        </div>
        <p className="small">
          你會發現：<Tex>{'e'}</Tex> 幾乎完全由雜訊決定（<Tex>{'|v|\\sim100\\,\\mathrm{fs}'}</Tex>，而 <Tex>{'(a-w)x=\\pm3\\,\\mathrm{fs}'}</Tex>），所以 4 個樣本的多數決常常「投錯」。<Tex>{'N=4096'}</Tex>
          時 GMAC 把 4096 票平均，訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>，方向才可靠（<ChLink to="/ch/05">Ch05</ChLink>）。另外，<Tex>{'\\pm1'}</Tex> code 時 <Tex>{'S_k'}</Tex> 與 <Tex>{'N'}</Tex> 同奇偶（<Tex>{'N'}</Tex> 個 <Tex>{'\\pm1'}</Tex> 相加），所以 <Tex>{'w'}</Tex> 每次只會跳{' '}
          <Tex>{`2\\mu/N=${sig((2 * mu) / N, 3)}\\,\\mathrm{fs}`}</Tex> 的整數倍——上面三個 block 的 <Tex>{'\\mu G_k'}</Tex> 正是這個格點上的值。
        </p>
      </Section>

      <Section kind="formula" title="3.4 一步一步：從兩層迴圈推到 pole、$\sigma_w$ 與穩定界" level={3}>
        <Prereq title="期望值 $E[\cdot]$ 與變異數 $\mathrm{Var}(\cdot)$">
          <p>
            <Tex>{'E[X]'}</Tex> 是「做很多次實驗後 <Tex>{'X'}</Tex> 的平均」。若 <Tex>{'X'}</Tex> 只取 <Tex>{'+1'}</Tex>（機率 <Tex>{'P'}</Tex>）與 <Tex>{'-1'}</Tex>（機率{' '}
            <Tex>{'1-P'}</Tex>），則 <Tex>{'E[X]=P\\cdot1+(1-P)\\cdot(-1)=2P-1'}</Tex>。變異數衡量「偏離平均多少」：<Tex>{'\\mathrm{Var}(X)=E[X^2]-E[X]^2'}</Tex>。兩條常用規則：
            <Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>（永遠成立）；若 <Tex>{'X,Y'}</Tex> 獨立，<Tex>{'\\mathrm{Var}(aX+bY)=a^2\\mathrm{Var}(X)+b^2\\mathrm{Var}(Y)'}</Tex>。<Tex>{'N'}</Tex> 個獨立同分布樣本的平均，變異數是單一樣本的 <Tex>{'1/N'}</Tex>。
          </p>
        </Prereq>
        <Prereq title="Gaussian 分布、$\Phi$ 與 $\operatorname{erf}$">
          <p>
            <Tex>{'v\\sim\\mathcal N(0,\\sigma^2)'}</Tex> 表示 <Tex>{'v'}</Tex> 的機率密度是鐘形曲線 <Tex>{'\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-v^2/2\\sigma^2}'}</Tex>。<Tex>{'\\Phi(z)=P(Z\\le z)'}</Tex> 是標準常態（<Tex>{'\\sigma=1'}</Tex>）的累積機率；
            <Tex>{'\\operatorname{erf}(y)=\\frac{2}{\\sqrt\\pi}\\int_0^y e^{-t^2}dt'}</Tex>，兩者關係 <Tex>{'2\\Phi(z)-1=\\operatorname{erf}(z/\\sqrt2)'}</Tex>。在 0 附近做泰勒展開：
            <Tex>{'\\operatorname{erf}(y)=\\frac{2}{\\sqrt\\pi}\\bigl(y-\\frac{y^3}{3}+\\cdots\\bigr)'}</Tex>，所以 <Tex>{'2\\Phi(z)-1\\approx\\sqrt{2/\\pi}\\,z'}</Tex>（<Tex>{'|z|\\ll1'}</Tex>）。
          </p>
        </Prereq>
        <Prereq title="相關（correlation）$C=E[x_\mathrm{ref}\,u]$">
          <p>
            兩個序列逐點相乘再平均：<Tex>{'C=\\frac1{N_s}\\sum_n x_\\mathrm{ref}[n]u[n]'}</Tex>。若兩者「同進同退」，<Tex>{'C>0'}</Tex>；若一個是另一個反相（例如 PLL error path 的相位接近 <Tex>{'180^\\circ'}</Tex>），<Tex>{'C<0'}</Tex>。identity path、unit-RMS code 時 <Tex>{'u=x,\\;C=E[x^2]=1'}</Tex>。單頻 <Tex>{'x=A\\cos\\Omega n'}</Tex> 經相位 <Tex>{'\\varphi'}</Tex> 的 path 時 <Tex>{'C=\\tfrac{A^2}{2}|H|\\cos\\varphi'}</Tex>（
            <ChLink to="/ch/06">Ch06</ChLink>）。
          </p>
        </Prereq>
        <Steps
          title="平均更新：comparator 的 S 曲線線性化（identity path、無 offset）"
          steps={[
            { tex: String.raw`e[n]=(a-w_k)\,u[n]+v[n]=\delta_k\,u[n]+v[n]`, why: '代入誤差模型 F-15.2（$H$ 為 identity、$b=0$、無非線性），並用 $\\delta=a-w$ 的極性。' },
            {
              tex: String.raw`E\bigl[q[n]\,\big|\,u[n]\bigr]=P(v>-\delta_ku)\cdot(+1)+P(v<-\delta_ku)\cdot(-1)=2\Phi\!\Bigl(\frac{\delta_k u[n]}{\sigma_v}\Bigr)-1`,
              why: '$q$ 只取 $\\pm1$；$v$ 對 0 對稱，所以 $P(v>-s)=\\Phi(s/\\sigma_v)$。',
            },
            { tex: String.raw`=\operatorname{erf}\!\Bigl(\frac{\delta_k u[n]}{\sqrt2\,\sigma_v}\Bigr)\approx\sqrt{\frac{2}{\pi}}\,\frac{\delta_k u[n]}{\sigma_v}=K_q\,\delta_k\,u[n]`, why: '用 $2\\Phi(z)-1=\\operatorname{erf}(z/\\sqrt2)$，再取 $\\operatorname{erf}$ 的一階泰勒展開（需 $|\\delta u|\\ll\\sigma_v$）。' },
            {
              tex: String.raw`E[G_k]=\frac1N\sum_{n\in k}E\bigl[q[n]\bigr]x_\mathrm{ref}[n]\approx K_q\,\delta_k\,\frac1N\sum_{n\in k}x_\mathrm{ref}[n]u[n]\approx K_q\,C\,\delta_k`,
              why: '期望值是線性的，逐項代入；block 內的平均以長時間平均 $C$ 近似。',
            },
            { tex: String.raw`\delta_{k+1}=a-w_{k+1}=a-w_k-\mu G_k=\delta_k-\mu G_k`, why: '把更新式 $w_{k+1}=w_k+\\mu G_k$ 代入 $\\delta$ 的定義。' },
            {
              tex: String.raw`G_k=K\delta_k+\eta_k\;\Rightarrow\;\delta_{k+1}=(1-\mu K)\,\delta_k-\mu\eta_k=p\,\delta_k-\mu\eta_k`,
              why: '把 $G_k$ 拆成平均 $K\\delta_k$ 與零均值的 GMAC 雜訊 $\\eta_k$；令 $K=K_qC$、$p=1-\\mu K$。',
            },
          ]}
          result={String.raw`\delta_{k+1}=p\,\delta_k-\mu\eta_k,\qquad p=1-\mu K_qC`}
        />
        <TexBlock id="F-15.1" label={md('參考 Block Sign-LMS（本站 tie 規則：$e\\ge0\\Rightarrow q=+1$）')}>
          {String.raw`q[n]=\begin{cases}+1,&e[n]\ge 0\\-1,&e[n]<0\end{cases},\quad G_k=\frac1N\sum_{n\in k}q[n]\,x_\mathrm{ref}[n],\quad w_{k+1}=w_k+\mu G_k`}
        </TexBlock>
        <TexBlock id="F-15.2" label="Comparator 前的誤差模型">
          {String.raw`e[n]=H_\mathrm{PD}\bigl\{(a-w_{k-d})\,x+c_2x^2+c_3x^3+o\bigr\}[n]+b+v[n],\quad v\sim\mathcal N(0,\sigma_v^2)`}
        </TexBlock>
        <TexBlock id="F-15.3" label="平均 GMAC（小訊號）">
          {String.raw`E[G_k]\approx K_q\,C\,\delta_k=K\delta_k,\quad K_q=\frac{\sqrt{2/\pi}}{\sigma_v},\;C=E[x_\mathrm{ref}\,u],\;\delta_k=a-w_k`}
        </TexBlock>
        <p>
          <ClaimTag kind="approx" /> 小訊號、Gaussian、長時間平均。<ModelLevel level="L1" /> 數字代入（§15.3 範例，<Tex>{'C=1'}</Tex>）：
        </p>
        <Steps
          title="代入數字：§15.3 範例的 $K_q$、$g$、$p$"
          steps={[
            { tex: String.raw`K_q=\frac{\sqrt{2/\pi}}{100\,\mathrm{fs}}=${texNum(n.Kq, 6)}\,\mathrm{fs}^{-1}`, why: '$\\sqrt{2/\\pi}=0.797885$。' },
            { tex: String.raw`g=\mu K_qC=10\,\mathrm{fs}\times${texNum(n.Kq, 6)}\,\mathrm{fs}^{-1}\times1=${texNum(n.g, 6)}`, why: '單位 $\\mathrm{fs}\\times\\mathrm{fs}^{-1}$ 抵消，$g$ 無因次（E13）。' },
            { tex: String.raw`p=1-g=${texNum(n.p, 8)},\qquad \tau=-\frac{1}{\ln p}=${texNum(n.tau, 4)}\ \text{blocks}`, why: '一階遞迴 $\\delta_k\\propto p^k=e^{-k/\\tau}$。' },
          ]}
        />
        <Steps
          title="穩態雜訊 $\sigma_w$：把遞迴兩邊取變異數"
          steps={[
            { tex: String.raw`\mathrm{Var}(\delta_{k+1})=p^2\,\mathrm{Var}(\delta_k)+\mu^2\sigma_\eta^2`, why: '$\\eta_k$ 只依賴第 $k$ 個 block 的新雜訊，與 $\\delta_k$ 獨立，所以變異數相加。' },
            { tex: String.raw`\sigma_w^2=p^2\sigma_w^2+\mu^2\sigma_\eta^2\;\Rightarrow\;\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`, why: '穩態時 $\\mathrm{Var}(\\delta_{k+1})=\\mathrm{Var}(\\delta_k)=\\sigma_w^2$（需 $|p|<1$）；也等於等比級數 $\\mu^2\\sigma_\\eta^2\\sum_{i\\ge0}p^{2i}$。' },
            {
              tex: String.raw`\sigma_\eta^2=\mathrm{Var}(G_k)=\frac{1}{N}\mathrm{Var}(q\,x_\mathrm{ref})\approx\frac{E[x_\mathrm{ref}^2]}{N}=\frac{1}{${n.N}}`,
              why: '$N$ 個獨立樣本的平均；$q^2=1$，所以 $\\mathrm{Var}(q\\,x_\\mathrm{ref})=E[x_\\mathrm{ref}^2]-m^2$，其中 $m=E[q\\,x_\\mathrm{ref}]=E[G]$。近平衡時 $m\\approx0$（例如 $\\delta=1\\,\\mathrm{fs}$ 時 $m=K\\delta\\approx0.008$，$m^2$ 只有 $6\\times10^{-5}$），差異可忽略。',
            },
            {
              tex: String.raw`\sigma_w=\frac{10\,\mathrm{fs}}{\sqrt{${n.N}\times(1-${fx(n.p, 6)}^2)}}=${texNum(n.sigmaW, 5)}\,\mathrm{fs}`,
              why: '代入；這是 gain-equivalent 雜訊（fs per unit code），不是 output jitter（E30）。',
            },
          ]}
        />
        <TexBlock id="F-15.5" label="穩態係數雜訊">
          {String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2},\quad \sigma_\eta^2\approx\frac{E[x_\mathrm{ref}^2]}{N}`}
        </TexBlock>
        <HandCalcPointer>
          <Tex>{'K_q\\to g\\to p\\to\\tau'}</Tex> 與 <Tex>{'\\sigma_w'}</Tex> 的帶入手算題在 <ChLink to="/ch/12">Ch12</ChLink>（預設就是這組 §15.3 的數字，可以換成你晶片的 <Tex>{'\\sigma_v,\\ \\mu,\\ N'}</Tex>），這裡不重複出題；<Tex>{'C<0'}</Tex> 時 pole 變成多少在{' '}
          <ChLink to="/ch/06">Ch06</ChLink>。本頁把它們和 RTL 的截斷偏差接起來的綜合題在 §11。
        </HandCalcPointer>
        <p>
          頻寬要分清楚兩個量 <ErratumNote id="E06" />：<Tex>{'|\\mu/(e^{j\\Omega}-p)|^2'}</Tex> 降到一半的 <strong><Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻率</strong>，和讓白雜訊積分正確的 <strong>ENBW</strong>。
        </p>
        <Prereq title="Z transform、pole 與單位圓（只用到等比數列）">
          <p>
            一個序列 <Tex>{'\\delta_k'}</Tex> 的 Z transform 是 <Tex>{'\\Delta(z)=\\sum_k\\delta_kz^{-k}'}</Tex>；「延遲一格」等於乘上 <Tex>{'z^{-1}'}</Tex>。遞迴{' '}
            <Tex>{'\\delta_{k+1}=\\delta_k-g\\delta_{k-d}'}</Tex> 的解是 <Tex>{'\\delta_k=\\sum_i c_iz_i^k'}</Tex>，其中 <Tex>{'z_i'}</Tex> 是特徵方程 <Tex>{'z^{d+1}-z^d+g=0'}</Tex> 的根（pole）。
            <Tex>{'z^k\\to0\\iff|z|<1'}</Tex>，所以「所有 pole 在單位圓內」就是「平均誤差收斂」——跟 <Tex>{'r^n\\to0\\iff|r|<1'}</Tex> 是同一件事。把狀態 <Tex>{'(\\delta_k,\\dots,\\delta_{k-d})'}</Tex> 排成向量時遞迴變成 <Tex>{'\\mathbf s_{k+1}=\\mathbf A\\mathbf s_k'}</Tex>，這些 pole 就是矩陣 <Tex>{'\\mathbf A'}</Tex> 的
            eigenvalue（滿足 <Tex>{'\\mathbf A\\mathbf v=\\lambda\\mathbf v'}</Tex> 的 <Tex>{'\\lambda'}</Tex>）；spectral radius <Tex>{'\\rho=\\max|\\lambda|<1'}</Tex> 等價於收斂。
          </p>
        </Prereq>
        <Prereq title="離散時間頻率 $\Omega$、頻率響應與 PSD">
          <p>
            對一個每 block 更新一次的序列，「頻率」用每個 block 轉過的角度 <Tex>{'\\Omega'}</Tex>（rad/block）描述，<Tex>{'\\Omega=2\\pi f/f_u'}</Tex>，最高到 <Tex>{'\\Omega=\\pi'}</Tex>（<Tex>{'f=f_u/2'}</Tex>）。把 <Tex>{'z=e^{j\\Omega}=\\cos\\Omega+j\\sin\\Omega'}</Tex>（Euler 公式）代入轉移函數 <Tex>{'H(z)'}</Tex>，得到的複數 <Tex>{'H(e^{j\\Omega})'}</Tex> 就是「頻率 <Tex>{'\\Omega'}</Tex> 的弦波通過系統後，振幅乘上
            <Tex>{'|H|'}</Tex>、相位加上 <Tex>{'\\angle H'}</Tex>」。功率譜密度（PSD）<Tex>{'S(f)'}</Tex> 是「每 Hz 有多少功率」，總功率（變異數）是它的積分；白雜訊的 PSD 是平的，通過系統後 PSD 乘上{' '}
            <Tex>{'|H|^2'}</Tex>。
          </p>
        </Prereq>
        <Steps
          title="頻寬：從 pole $p$ 推出 $-3\,\mathrm{dB}$ 頻率與 ENBW"
          steps={[
            {
              tex: String.raw`z\,\Delta(z)=p\,\Delta(z)-\mu\,\mathcal E(z)\;\Rightarrow\;H_w(z)=\frac{\Delta(z)}{\mathcal E(z)}=\frac{-\mu}{z-p}`,
              why: '對 $\\delta_{k+1}=p\\delta_k-\\mu\\eta_k$ 取 Z transform：「往前一格」等於乘上 $z$；$\\mathcal E(z)$ 是 $\\eta_k$ 的 Z transform。',
            },
            {
              tex: String.raw`\bigl|H_w(e^{j\Omega})\bigr|^2=\frac{\mu^2}{(\cos\Omega-p)^2+\sin^2\Omega}=\frac{\mu^2}{1-2p\cos\Omega+p^2}`,
              why: '代入 $z=\\cos\\Omega+j\\sin\\Omega$，分母取絕對值平方，再用 $\\cos^2\\Omega+\\sin^2\\Omega=1$。',
            },
            { tex: String.raw`\bigl|H_w(e^{j0})\bigr|^2=\frac{\mu^2}{(1-p)^2}`, why: '$\\Omega=0$（DC）時 $\\cos\\Omega=1$，分母 $1-2p+p^2=(1-p)^2$；$0<p<1$ 時這是最大值（低通）。' },
            {
              tex: String.raw`1-2p\cos\Omega_\mathrm{3dB}+p^2=2(1-p)^2\;\Rightarrow\;\cos\Omega_\mathrm{3dB}=1-\frac{(1-p)^2}{2p}`,
              why: '半功率就是分母變成 DC 值的兩倍；移項得 $2p\\cos\\Omega=1+p^2-2(1-p)^2=2p-(1-p)^2$，再除以 $2p$。',
            },
            {
              tex: String.raw`f_\mathrm{3dB}=\frac{f_u}{2\pi}\arccos\!\Bigl(1-\frac{(1-p)^2}{2p}\Bigr)=\frac{${texNum(n.fu / 1e3, 7)}}{2\pi}\arccos(${texNum(1 - ((1 - n.p) * (1 - n.p)) / (2 * n.p), 7)})=${texNum(n.f3db / 1e3, 5)}\ \mathrm{kHz}`,
              why: '$\\Omega=2\\pi f/f_u$。$\\arccos$ 的引數要 $\\ge-1$，也就是 $p\\ge3-2\\sqrt2\\approx0.1716$；$p$ 更小時響應太平，沒有 $-3\\,\\mathrm{dB}$ 點（E27）。',
            },
            {
              tex: String.raw`\cos\Omega\approx1-\tfrac12\Omega^2\;\Rightarrow\;\Omega_\mathrm{3dB}\approx\frac{1-p}{\sqrt p}=(1-p)\Bigl(1+\tfrac12(1-p)+\cdots\Bigr)`,
              why: '$p\\to1$ 時的泰勒近似。$-\\ln p=(1-p)+\\tfrac12(1-p)^2+\\cdots$ 與它到二階相同，所以 $-\\ln p$ 近似比 $1-p$ 準（E26）。',
            },
            {
              tex: String.raw`S_w^{(1)}(f)=\frac{2\sigma_\eta^2}{f_u}\,\bigl|H_w(e^{j2\pi f/f_u})\bigr|^2,\qquad 0\le f\le\tfrac{f_u}{2}`,
              why: '$\\eta_k$ 是 block-rate 白雜訊：變異數 $\\sigma_\\eta^2$ 平均攤在 $[0,f_u/2]$，所以 one-sided PSD 為 $2\\sigma_\\eta^2/f_u$；通過 $H_w$ 後乘上 $|H_w|^2$。',
            },
            {
              tex: String.raw`\mathrm{ENBW}\equiv\frac{\sigma_w^2}{S_w^{(1)}(0)}=\frac{\mu^2\sigma_\eta^2/(1-p^2)}{2\sigma_\eta^2\mu^2/\bigl(f_u(1-p)^2\bigr)}=\frac{f_u(1-p)^2}{2(1-p)(1+p)}=\frac{f_u(1-p)}{2(1+p)}`,
              why: 'ENBW 的定義：一個高度為 DC 值、寬度為 ENBW 的矩形，面積等於真正的總功率 $\\sigma_w^2$（F-15.5）；再用 $1-p^2=(1-p)(1+p)$ 約分。',
            },
            {
              tex: String.raw`\frac{\mathrm{ENBW}}{f_\mathrm{3dB}}=\frac{${texNum(n.enbw / 1e3, 5)}}{${texNum(n.f3db / 1e3, 5)}}=${texNum(n.enbw / n.f3db, 4)}\;\xrightarrow{\;p\to1\;}\;\frac{(1-p)/4}{(1-p)/2\pi}=\frac{\pi}{2}`,
              why: `跟一階 RC 低通一樣：雜訊頻寬比 $-3\\,\\mathrm{dB}$ 頻寬大 $\\pi/2$ 倍。把 $${sig(n.f3db / 1e3, 3)}\\,\\mathrm{kHz}$ 當 Noise BW 會低估 $\\sigma_w^2$ 約 ${sig(100 * (1 - n.f3db / n.enbw), 2)}%（E06）。`,
            },
          ]}
        />
        <TexBlock id="F-15.6" label={md('Block rate、exact $-3\\,\\mathrm{dB}$ 與 ENBW')}>
          {String.raw`f_u=\frac{f_s}{N},\quad f_\mathrm{3dB}=\frac{f_u}{2\pi}\arccos\!\Bigl(1-\frac{(1-p)^2}{2p}\Bigr),\quad \mathrm{ENBW}=\frac{f_u(1-p)}{2(1+p)}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>量（§15.3 範例）</th>
                <th>值</th>
                <th>標籤</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'f_u=f_s/N'}</Tex>
                </td>
                <td>{sig(n.fu / 1e3, 7)} kHz</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
              </tr>
              <tr>
                <td>
                  exact <Tex>{'-3\\,\\mathrm{dB}'}</Tex>
                </td>
                <td>{sig(n.f3db / 1e3, 5)} kHz</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'-\\ln p\\cdot f_u/2\\pi'}</Tex> 近似
                </td>
                <td>
                  {sig(n.f3dbNegLn / 1e3, 5)} kHz（{sig(100 * (n.f3dbNegLn / n.f3db - 1), 2)}%）
                </td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'(1-p)\\cdot f_u/2\\pi'}</Tex> 近似 <ErratumNote id="E26" />
                </td>
                <td>
                  {sig(n.f3dbOneMinusP / 1e3, 5)} kHz（{sig(100 * (n.f3dbOneMinusP / n.f3db - 1), 2)}%）
                </td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
              </tr>
              <tr>
                <td>one-sided ENBW（白雜訊積分用）</td>
                <td>{sig(n.enbw / 1e3, 5)} kHz</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <HandCalcPointer>
          <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻率的三種算法與 ENBW 的手算題也在 <ChLink to="/ch/12">Ch12</ChLink>（試 <Tex>{'p=0.15'}</Tex> 會看到沒有 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 點的情況，勘誤 E27）。
        </HandCalcPointer>
        <TexBlock id="F-15.4" label="一階平均遞迴與更新延遲的穩定界">
          {String.raw`\delta_{k+1}=\delta_k-g\,\delta_{k-d},\;g=\mu K\,(\times N\text{ if sum});\quad d=0:\,p=1-g,\;0<g<2;\quad g_\mathrm{crit}(d)=2\sin\frac{\pi}{4d+2}`}
        </TexBlock>
        <Steps
          title="更新延遲 $d$ 的臨界增益 $g_\mathrm{crit}$ 與 phase margin"
          steps={[
            { tex: String.raw`\delta_k=z^k:\quad z^{k+1}=z^k-g\,z^{k-d}\;\Rightarrow\;z^{d+1}-z^{d}+g=0`, why: '把試探解 $\\delta_k=z^k$ 代入 $\\delta_{k+1}=\\delta_k-g\\delta_{k-d}$，兩邊除以 $z^{k-d}$，得到特徵方程。' },
            { tex: String.raw`z=e^{j\theta}:\quad g=z^{d}(1-z)=e^{jd\theta}\bigl(1-e^{j\theta}\bigr)`, why: '$g$ 從 0 加大時，根由單位圓內往外移；恰好在穩定邊界時有一個根落在單位圓上。' },
            {
              tex: String.raw`1-e^{j\theta}=e^{j\theta/2}\bigl(e^{-j\theta/2}-e^{j\theta/2}\bigr)=-2j\sin\tfrac\theta2\,e^{j\theta/2}=2\sin\tfrac\theta2\;e^{j(\theta/2-\pi/2)}`,
              why: '提出 $e^{j\\theta/2}$，用 Euler 公式 $e^{jx}-e^{-jx}=2j\\sin x$，再把 $-j$ 寫成 $e^{-j\\pi/2}$。',
            },
            {
              tex: String.raw`g=2\sin\tfrac\theta2\;e^{\,j[(d+\frac12)\theta-\frac\pi2]}\in\mathbb R^+\;\Rightarrow\;\bigl(d+\tfrac12\bigr)\theta^*-\tfrac\pi2=0\;\Rightarrow\;\theta^*=\frac{\pi}{2d+1}`,
              why: '$g$ 是正實數，所以右邊的相位必須是 0；最小的正角 $\\theta^*$ 對應最先碰到單位圓的那對根。',
            },
            {
              tex: String.raw`g_\mathrm{crit}(d)=2\sin\frac{\theta^*}{2}=2\sin\frac{\pi}{4d+2}:\qquad 2,\;1,\;${fx(gCritical(2), 4)},\;${fx(gCritical(3), 4)}\;(d=0,1,2,3)`,
              why: '代回振幅。$d=0$ 時回到熟悉的 $0<g<2$；只要延遲 1 個 block，上限就砍半。',
            },
            {
              tex: String.raw`L(z)=\frac{g\,z^{-d}}{z-1},\qquad \bigl|L(e^{j\omega_c})\bigr|=1\;\Rightarrow\;\bigl|e^{j\omega_c}-1\bigr|=2\sin\tfrac{\omega_c}{2}=g\;\Rightarrow\;\omega_c=2\arcsin\tfrac g2`,
              why: '迴路增益：積分器 $1/(z-1)$、增益 $g$、延遲 $z^{-d}$。crossover 頻率 $\\omega_c$ 是 $|L|=1$ 的地方；$|e^{j\\omega}-1|$ 用上面第 3 步。',
            },
            {
              tex: String.raw`\angle L(e^{j\omega_c})=-d\,\omega_c-\Bigl(\tfrac{\omega_c}{2}+\tfrac\pi2\Bigr)\;\Rightarrow\;\mathrm{PM}=\pi+\angle L=\tfrac\pi2-\bigl(d+\tfrac12\bigr)\omega_c=90^\circ-(2d+1)\arcsin\tfrac g2`,
              why: '$z^{-d}$ 貢獻 $-d\\omega_c$；$e^{j\\omega}-1=2\\sin\\tfrac\\omega2\\,e^{j(\\omega/2+\\pi/2)}$ 在分母，貢獻 $-(\\omega_c/2+\\pi/2)$。令 $\\mathrm{PM}=0$ 正好回到 $g_\\mathrm{crit}$。',
            },
          ]}
          result={String.raw`g_\mathrm{crit}(d)=2\sin\frac{\pi}{4d+2},\qquad \mathrm{PM}=90^\circ-(2d+1)\arcsin\frac g2`}
        />
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>
                  更新延遲 <Tex>{'d'}</Tex> [blocks]
                </th>
                {[0, 1, 2, 3, 4].map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'g_\\mathrm{crit}=2\\sin\\frac{\\pi}{4d+2}'}</Tex>
                </td>
                {[0, 1, 2, 3, 4].map((d) => (
                  <td key={d}>{fx(gCritical(d), 6)}</td>
                ))}
              </tr>
              <tr>
                <td>
                  §15.3 範例 <Tex>{`g=${fx(n.g, 4)}`}</Tex> 的 PM
                </td>
                {[0, 1, 2, 3, 4].map((d) => (
                  <td key={d}>{fx(90 - (2 * d + 1) * ((Math.asin(n.g / 2) * 180) / Math.PI), 2)}°</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          <ClaimTag kind="exact" /> 臨界根位於角度 <Tex>{'\\pi/(2d+1)'}</Tex>；PM 公式 <Tex>{'90^\\circ-(2d+1)\\arcsin(g/2)'}</Tex>（<ChLink to="/ch/08">Ch08</ChLink>）。sum 模式沿用 average 的{' '}
          <Tex>{'\\mu'}</Tex>：<Tex>{`g_\\mathrm{sum}=Ng=${texNum(n.gSum, 6)}`}</Tex>、pole <Tex>{`${texNum(n.poleSum, 6)}`}</Tex>，遠超過 2——這正是 §16.1 第 4 項要抓的 bug。
        </p>
        <HandCalcPointer>
          含延遲 <Tex>{'d'}</Tex> 的臨界增益、gain margin 與 PM 的手算題在 <ChLink to="/ch/08">Ch08</ChLink>；§11 的思考題 5 用 <Tex>{'d=1'}</Tex> 再算一次 <Tex>{'\\mu'}</Tex> 的上限。
        </HandCalcPointer>
        <ModeGate min="engineer" summary="解析量（$K_q$、$g$、pole…）的程式碼：blockLmsAnalyticGain">
          <p>解析量也是同一份程式算的（<code>prepare()</code> 內），JSON Lab 的「解析區塊」直接顯示它們：</p>
          <CodeBlock source={blockLmsSrc} region="blockLmsAnalyticGain" path={BLOCK_LMS_PATH} title="core:blockLmsAnalyticGain" caption="$K_q$、$K$、$g$、pole、延遲特徵方程、PM、$f_u$、exact $-3\,\mathrm{dB}$ 與 ENBW；sigma = 0 時 $K_q$ 為 NaN（不是 0）。" />
        </ModeGate>
      </Section>

      <Section kind="assumptions" title="3.5 固定點不一定是 $a$：mean-field 與 bias" level={3}>
        <p>
          上面的推導假設 <Tex>{'e'}</Tex> 只有 <Tex>{'\\delta u'}</Tex>。實際上還有 offset <Tex>{'b'}</Tex>、DTC 非線性、以及 path 對 DC 的抑制。這時 GMAC 歸零的點 <Tex>{'w^*'}</Tex> 由下式決定（本站以 Illinois 法求根）：
        </p>
        <TexBlock id="F-15.7" label="Mean-field 固定點">
          {String.raw`\frac1{N_s}\sum_{n}x_\mathrm{ref}[n]\Bigl(2\Phi\bigl(e_n(w^*)/\sigma_v\bigr)-1\Bigr)=0,\quad e_n(w)=(a-w)u[n]+H\{\mathrm{nl}\}[n]+b`}
        </TexBlock>
        <p>
          <ClaimTag kind="approx" /> 它對 Gaussian <Tex>{'v'}</Tex> 是精確的平均，但把 <Tex>{'w'}</Tex> 當成凍結（忽略 <Tex>{'w'}</Tex> 自己 <Tex>{'\\pm\\sigma_w'}</Tex> 的抖動）。<Tex>{'\\sigma_v'}</Tex> 很小時 sign-LMS 的固定點會偏向 MAE 解（例如三階 INL 例子由 1.34 移到 1.40）
          <ErratumNote id="E01" />；若 comparator 就是主 PLL 的 BBPD（DC 被迴路歸零），offset 不會變成 gain bias <ErratumNote id="E03" />。詳見 <ChLink to="/ch/11">Ch11</ChLink>。
        </p>
      </Section>
      <ModeGate min="research" summary={String.raw`本模擬刻意沒有建模的東西（亂數產生、$f_s=f_\mathrm{ref}$ 假設…）`}>
        <Callout kind="info" title="Research：本模擬刻意沒有建模的東西">
          <ul className="models-tight">
            <li>comparator 雜訊以 Ziggurat 產生（比 Box–Muller 快約 2 倍），由 <code>createRng(seed).fork('comparator-noise')</code> 決定，可重現；分布正確性由 KS 與尾端測試驗證。</li>
            <li>雜訊永遠抽樣（<Tex>{'\\sigma_v=0'}</Tex> 也抽），所以只改 <Tex>{'\\sigma_v'}</Tex> 的兩次模擬使用同一組 <Tex>{'z[n]'}</Tex>（common random numbers）。</li>
            <li>
              <Tex>{'f_s=f_\\mathrm{ref}'}</Tex>：一個 code 對一個 comparator decision；多速率（<Tex>{'f_s\\ne f_\\mathrm{ref}'}</Tex>）需另做推導（E44）。
            </li>
            <li>沒有 colored／code-dependent 雜訊（E17）、沒有 comparator metastability、沒有 PVT 漂移（R1、R6）。</li>
          </ul>
        </Callout>
      </ModeGate>
    </section>
  )
}
