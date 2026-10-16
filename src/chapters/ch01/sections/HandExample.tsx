import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ClaimTag,
  CodeBlock,
  Derivation,
  ModeGate,
  Prereq,
  Quiz,
  Section,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
  TestBadge,
  ChRef,
} from '@/components'
import { conventionalStep } from '@/simulation/models/lms'
import {
  exactLmsTrace,
  fixedXStability,
  fracToString,
  playgroundClosedForm,
  playgroundTrace,
  playgroundVarWStationary,
} from '@/simulation/models/lossCompare'
import lossSrc from '@/simulation/models/lossCompare.ts?raw'
import { BehaviourLabel, BlockDiagram, ChapterHandCalc, Erratum, f, texNum, useChapterMode } from '../common'
import { LmsPlayground } from '../experiments/LmsPlayground'

const HAND = { a: 3, w0: 1, x: 2, mu: 0.1 }
const MU_TABLE = [0.02, 0.1, 0.25, 0.4, 0.5, 0.6]

export function HandExampleSection() {
  const { atLeast } = useChapterMode()
  const tr = useMemo(() => playgroundTrace({ ...HAND, steps: 6, noiseSigma: 0, seed: 1 }), [])
  const exact = useMemo(() => exactLmsTrace(HAND.a, HAND.w0, HAND.x, HAND.mu, 6), [])
  const st = fixedXStability(HAND.mu, HAND.x)
  const y = HAND.a * HAND.x
  const poleRows = useMemo(
    () =>
      MU_TABLE.map((mu) => {
        const s = fixedXStability(mu, HAND.x)
        const t = playgroundTrace({ ...HAND, mu, steps: 10, noiseSigma: 0, seed: 1 })
        return { mu, s, d10: t.delta[10], d10cf: HAND.a - playgroundClosedForm(HAND.a, HAND.w0, HAND.x, mu, 10) }
      }),
    [],
  )
  const quiz1 = conventionalStep({ w: 2, x: -3, y: -9, mu: 0.1 })
  const quiz1Opts = [1.1, 2.9, 3.0, 2.3]
  const q2 = fixedXStability(0.4, 2)

  const closedForm = (
    <StepDerivation
      title={
        <>
          封閉解：每一步誤差乘上同一個數 <Tex>{'p'}</Tex>
        </>
      }
      steps={[
        {
          tex: String.raw`e_n=ax-w_nx=(a-w_n)\,x=\delta_n x`,
          why: (
            <>
              無雜訊、固定 <Tex>{'x'}</Tex>：<Tex>{'y=ax'}</Tex>；並用全站約定 <Tex>{String.raw`\delta_n=a-w_n`}</Tex>
            </>
          ),
        },
        { tex: String.raw`\delta_{n+1}=a-w_{n+1}=a-\big(w_n+\mu e_nx\big)`, why: '代入 LMS 更新式' },
        {
          tex: String.raw`=\delta_n-\mu x\cdot\delta_nx=(1-\mu x^2)\,\delta_n`,
          why: (
            <>
              <Tex>{String.raw`a-w_n=\delta_n`}</Tex>，且 <Tex>{String.raw`e_n=\delta_nx`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`\delta_n=p^n\,\delta_0,\qquad p:=1-\mu x^2`,
          why: (
            <>
              每一步都乘 <Tex>{'p'}</Tex>，乘 <Tex>{'n'}</Tex> 次（等比數列）
            </>
          ),
        },
        {
          tex: String.raw`w_n=a-(a-w_0)\,p^n`,
          why: (
            <>
              由 <Tex>{String.raw`\delta_n=a-w_n`}</Tex> 解回 <Tex>{'w_n'}</Tex>
            </>
          ),
        },
      ]}
    />
  )

  const noisyStat = playgroundVarWStationary(0.1, 2, 1)
  const noiseVar = (
    <StepDerivation
      title={
        <>
          雜訊下 <Tex>{'w_n'}</Tex> 的平均與變異數
        </>
      }
      steps={[
        {
          tex: String.raw`w_{n+1}=w_n+\mu\,(ax+v_n-w_nx)\,x=p\,w_n+\mu x^2a+\mu x\,v_n`,
          why: (
            <>
              代入 <Tex>{'y_n=ax+v_n'}</Tex>，整理成 <Tex>{String.raw`p\times\text{上一步}+\text{常數}+\text{雜訊}`}</Tex> 的形式，<Tex>{String.raw`p=1-\mu x^2`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`E[w_{n+1}]=p\,E[w_n]+\mu x^2a`,
          why: (
            <>
              取期望值，<Tex>{'E[v_n]=0'}</Tex>：平均值走的路和無雜訊完全一樣（F-01.8）
            </>
          ),
        },
        { tex: String.raw`\tilde w_{n+1}=p\,\tilde w_n+\mu x\,v_n,\qquad \tilde w_n:=w_n-E[w_n]`, why: '兩式相減，只剩「偏離平均」的部分' },
        {
          tex: String.raw`\operatorname{Var}(w_{n+1})=p^2\operatorname{Var}(w_n)+\mu^2x^2\sigma_v^2`,
          why: (
            <>
              <Tex>{String.raw`\tilde w_n`}</Tex> 只由 <Tex>{String.raw`v_0,\dots,v_{n-1}`}</Tex> 決定，與 <Tex>{'v_n'}</Tex> 獨立 ⇒ 變異數直接相加（交叉項期望值為 0）
            </>
          ),
        },
        {
          tex: String.raw`\operatorname{Var}(w_n)=\mu^2x^2\sigma_v^2\sum_{k=0}^{n-1}p^{2k}=\mu^2x^2\sigma_v^2\,\frac{1-p^{2n}}{1-p^2}`,
          why: (
            <>
              從 <Tex>{String.raw`\operatorname{Var}(w_0)=0`}</Tex> 開始展開 <Tex>{'n'}</Tex> 次，是公比 <Tex>{'p^2'}</Tex> 的等比級數
            </>
          ),
        },
        {
          tex: String.raw`1-p^2=(1-p)(1+p)=\mu x^2\,(2-\mu x^2)`,
          why: (
            <>
              <Tex>{String.raw`1-p=\mu x^2`}</Tex>、<Tex>{String.raw`1+p=2-\mu x^2`}</Tex>
            </>
          ),
        },
        {
          tex: String.raw`\lim_{n\to\infty}\operatorname{Var}(w_n)=\frac{\mu^2x^2\sigma_v^2}{\mu x^2(2-\mu x^2)}=\frac{\mu\,\sigma_v^2}{2-\mu x^2}`,
          why: (
            <>
              <Tex>{'|p|<1'}</Tex> 時 <Tex>{String.raw`p^{2n}\to0`}</Tex>
            </>
          ),
        },
      ]}
    />
  )

  return (
    <>
      <Section kind="example" title="1.4 一個手算例子（規格 §1.2）" level={2} id="ch01-s14">
        <p>
          真正 <Tex>{'y=3x'}</Tex>，初始 <Tex>{'w_0=1'}</Tex>，固定 <Tex>{'x=2'}</Tex>（所以 <Tex>{'y=6'}</Tex>），
          <Tex>{String.raw`\mu=0.1`}</Tex>。先手算兩步 <SourceTag /> <TestBadge id="T01" />。每一步都是同樣三個動作，照下圖的順序由左算到右：
        </p>
        <BlockDiagram id="D-01.10">
          先看上面那一列（第 0 筆）：從 <Tex>{'w_0=1'}</Tex> 出發，①預測 <Tex>{String.raw`\hat y_0`}</Tex>、②比較得到 <Tex>{'e_0'}</Tex>、③算修正量{' '}
          <Tex>{String.raw`\Delta w_0`}</Tex>，加回去得到 <Tex>{'w_1'}</Tex>。再看下面那一列：把 <Tex>{'w_1'}</Tex> 當成新的起點，同樣三格再算一次。圖上的三格就是下面逐步推導與表格裡的三個量：
          ①是 <Tex>{String.raw`\hat y_n=w_nx`}</Tex>、②是 <Tex>{String.raw`e_n=y-\hat y_n`}</Tex>、③是 <Tex>{String.raw`\Delta w_n=\mu e_nx`}</Tex>。注意第二列的誤差和修正量都比第一列小——越接近答案，步伐越小。
        </BlockDiagram>
        <StepDerivation
          steps={[
            {
              tex: String.raw`e_0=y-w_0x=${y}-${HAND.w0}\times${HAND.x}=${texNum(tr.e[0], 6)}`,
              why: (
                <>
                  ① 預測 <Tex>{String.raw`\hat y_0=w_0x=${texNum(HAND.w0 * HAND.x)}`}</Tex>，② 比較：差 <Tex>{texNum(tr.e[0], 6)}</Tex>
                </>
              ),
            },
            {
              tex: String.raw`w_1=w_0+\mu e_0x=${HAND.w0}+${HAND.mu}\times${texNum(tr.e[0], 6)}\times${HAND.x}=${texNum(tr.w[1], 10)}`,
              why: (
                <>
                  ③ 修正：誤差為正 ⇒ <Tex>{'w'}</Tex> 太小 ⇒ 往上調（<Tex>{String.raw`\Delta w_0=${texNum(tr.dw[0], 6)}`}</Tex>）
                </>
              ),
            },
            {
              tex: String.raw`e_1=${y}-${texNum(tr.w[1], 10)}\times${HAND.x}=${texNum(tr.e[1], 10)}`,
              why: (
                <>
                  誤差變小了（<Tex>{String.raw`${texNum(tr.e[0], 6)}\to${texNum(tr.e[1], 6)}`}</Tex>）
                </>
              ),
            },
            {
              tex: String.raw`w_2=${texNum(tr.w[1], 10)}+${HAND.mu}\times${texNum(tr.e[1], 10)}\times${HAND.x}=${texNum(tr.w[2], 10)}=\tfrac{${exact[2].n}}{${exact[2].d}}`,
              why: (
                <>
                  修正量也跟著變小（<Tex>{String.raw`${texNum(tr.dw[0], 6)}\to${texNum(tr.dw[1], 6)}`}</Tex>）：誤差越小，更新越小。分數是用精確有理數重算的（IEEE double 會印出 {String(tr.w[2])}）
                </>
              ),
            },
          ]}
        />
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'n'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'w_n'}</Tex>
                </th>
                <th>精確分數</th>
                <th className="num">
                  <Tex>{String.raw`\hat y_n=w_nx`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'e_n'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\Delta w_n=\mu e_nx`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\delta_n=a-w_n`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, n) => (
                <tr key={n}>
                  <td className="num">{n}</td>
                  <td className="num">{f(tr.w[n], 10)}</td>
                  <td className="mono">{fracToString(exact[n])}</td>
                  <td className="num">{f(tr.w[n] * HAND.x, 10)}</td>
                  <td className="num">{f(tr.e[n], 10)}</td>
                  <td className="num">{f(tr.dw[n], 10)}</td>
                  <td className="num">{f(tr.delta[n], 10)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              由 <code>playgroundTrace</code>（每步呼叫 <code>lms.ts</code> 的 <code>conventionalStep</code>）與精確有理數{' '}
              <code>exactLmsTrace</code> 計算。<Tex>{String.raw`\delta=a-w`}</Tex>，所以是{' '}
              <Tex>{String.raw`${[0, 1, 2].map((n) => `+${texNum(tr.delta[n], 6)}`).join(',\\ ')},\dots`}</Tex>（規格 §3 的{' '}
              <Tex>{'w-a'}</Tex> 會給相反正負號）
              <Erratum id="E39" />。
            </caption>
          </table>
        </div>
        <p>
          觀察：<Tex>{'\\delta_n'}</Tex> 每步都乘 <Tex>{texNum(st.pole, 6)}</Tex>（
          <Tex>{String.raw`${texNum(tr.delta[0], 6)}\to${texNum(tr.delta[1], 6)}\to${texNum(tr.delta[2], 6)}`}</Tex>
          ）。這裡的 <Tex>{String.raw`\delta_n=a-w_n`}</Tex> 是剩餘參數誤差：真值減去目前的猜測，也就是「還差多少」。每步乘上同一個數不是巧合，把迴路畫出來就看得到原因：
        </p>
        <BlockDiagram id="D-01.11">
          從最上面的加法點出發：真值 <Tex>{'a'}</Tex> 進「＋」、暫存器（最下面）裡的 <Tex>{'w_n'}</Tex> 沿著旁邊那條長長的回授線繞回來，進「−」，得到 <Tex>{String.raw`\delta_n`}</Tex>。由上往下繞一圈，會先後經過兩個藍色的乘法：
          <Tex>{String.raw`\times x`}</Tex>（參數誤差變成量測誤差 <Tex>{'e_n'}</Tex>）與 <Tex>{String.raw`\times\mu x`}</Tex>（LMS 的修正），乘起來是{' '}
          <Tex>{String.raw`\mu x^2`}</Tex>。也就是說，每一步都修掉 <Tex>{String.raw`\delta_n`}</Tex> 的 <Tex>{String.raw`\mu x^2`}</Tex> 倍，剩下 <Tex>{String.raw`1-\mu x^2`}</Tex> 倍。
          這個「每步剩下的倍數」記作 <Tex>{'p'}</Tex>，稱為這個迴路的 pole（極點）：圖上的 <Tex>{String.raw`\Delta w_n=\mu x^2\delta_n`}</Tex> 就是下面推導第 3 行的{' '}
          <Tex>{String.raw`\delta_{n+1}=(1-\mu x^2)\delta_n`}</Tex>。本例 <Tex>{String.raw`p=1-0.1\times2^2=${texNum(st.pole, 6)}`}</Tex>。
        </BlockDiagram>
        {atLeast('engineer') ? closedForm : <Derivation title="封閉解推導" derivation={closedForm} level="L0" claim="exact" />}
        <TexBlock
          id="F-01.8"
          label={
            <>
              固定 <Tex>{'x'}</Tex>、無雜訊（規格 §3；<Tex>{String.raw`\delta=a-w`}</Tex>）
            </>
          }
        >
          {String.raw`\boxed{\delta_n=p^n\delta_0,\quad p=1-\mu x^2,\quad 0<\mu<\frac{2}{x^2}}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> <TestBadge id="T02" /> 等比數列 <Tex>{'p^n\\to0'}</Tex> 若且唯若 <Tex>{'|p|<1'}</Tex>，即{' '}
          <Tex>{String.raw`-1<1-\mu x^2<1\iff 0<\mu<2/x^2`}</Tex>。<Tex>{'x=2'}</Tex> 時上限是{' '}
          <Tex>{texNum(st.muMax, 6)}</Tex>，而 <Tex>{String.raw`\mu=1/x^2=${texNum(st.muOneStep, 6)}`}</Tex> 時 <Tex>{'p=0'}</Tex>，
          一步就到答案。下表直接用模擬算出第 10 步的 <Tex>{'\\delta_{10}'}</Tex>，和封閉解 <Tex>{'p^{10}\\delta_0'}</Tex> 對照：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'\\mu'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`p=1-4\mu`}</Tex>
                </th>
                <th>行為</th>
                <th className="num">
                  <Tex>{String.raw`\delta_{10}`}</Tex>（模擬）
                </th>
                <th className="num">
                  <Tex>{String.raw`p^{10}\delta_0`}</Tex>（封閉解）
                </th>
              </tr>
            </thead>
            <tbody>
              {poleRows.map((r) => (
                <tr key={r.mu}>
                  <td className="num">{r.mu}</td>
                  <td className="num">{f(r.s.pole, 6)}</td>
                  <td>
                    <BehaviourLabel b={r.s.behaviour} />
                  </td>
                  <td className="num">{f(r.d10, 6)}</td>
                  <td className="num">{f(r.d10cf, 6)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              「穩定」不代表不震盪：<Tex>{String.raw`\mu=0.4`}</Tex> 時 <Tex>{String.raw`p=-0.6`}</Tex>，誤差正負交替但仍收斂。
              <Tex>{String.raw`\mu=0.5`}</Tex> 是邊界（<Tex>{String.raw`|\delta_n|`}</Tex> 不變），<Tex>{String.raw`\mu=0.6`}</Tex>{' '}
              發散。更多（隨機 <Tex>{'x'}</Tex>、mean vs mean-square）見 <Link to="/ch/03">Ch03</Link>。
            </caption>
          </table>
        </div>
        <CodeBlock
          source={lossSrc}
          region="playgroundTrace"
          path="src/simulation/models/lossCompare.ts"
          title="LMS Playground 的核心迴圈（網站實際執行的程式碼）"
          caption="每一步呼叫 lms.ts 的 conventionalStep；雜訊流只由 seed 決定，所以改 $\mu$ 時比較的是同一組雜訊。"
        />
        <ModeGate min="engineer">
          <CodeBlock
            source={lossSrc}
            region="exactLmsTrace"
            path="src/simulation/models/lossCompare.ts"
            title="T01 的精確有理數版本（BigInt 分數；表中「精確分數」欄）"
          />
          <p className="small">
            為什麼要另外算一次？<Tex>{String.raw`\mu=0.1`}</Tex> 在 IEEE double 裡不是剛好 <Tex>{String.raw`\tfrac{1}{10}`}</Tex>，所以 double 版的{' '}
            <Tex>{'w_2'}</Tex> 是 {String(tr.w[2])}；把十進位輸入轉成分數後連乘連加，才得到剛好的 <Tex>{String.raw`w_2=\tfrac{57}{25}`}</Tex>
            。驗收測試因此用容忍度 <Tex>{'10^{-12}'}</Tex> 比對 double，並用分數版確認精確值。
          </p>
        </ModeGate>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            1.4.1 加入雜訊：<Tex>{'w'}</Tex> 不會停在 <Tex>{'a'}</Tex>，而是在 <Tex>{'a'}</Tex> 附近抖動
          </>
        }
        level={3}
        id="ch01-s141"
      >
        <p>
          真實量測有雜訊 <Tex>{String.raw`y_n=ax+v_n`}</Tex>（<Tex>{'v_n'}</Tex> 零均值、彼此獨立、標準差 <Tex>{'\\sigma_v'}</Tex>）。每一步的更新都帶著一點雜訊，
          所以 <Tex>{'w_n'}</Tex> 變成隨機的。它的平均和抖動都可以精確算出來：
        </p>
        <Prereq title={String.raw`變異數 $\operatorname{Var}(\cdot)$ 與高斯分布：抖動有多大`}>
          <p>
            <strong>變異數</strong>是「離平均有多遠」的平方再平均：<Tex>{String.raw`\operatorname{Var}(X)=E\big[(X-E[X])^2\big]`}</Tex>；
            開根號就是<strong>標準差（std）</strong>，單位和 <Tex>{'X'}</Tex> 相同。本節只用三條性質：
          </p>
          <StepDerivation
            steps={[
              {
                tex: String.raw`\operatorname{Var}(cX)=c^2\operatorname{Var}(X)`,
                why: (
                  <>
                    每個偏離都放大 <Tex>{'c'}</Tex> 倍，平方後放大 <Tex>{'c^2'}</Tex> 倍
                  </>
                ),
              },
              { tex: String.raw`\operatorname{Var}(X+c)=\operatorname{Var}(X)`, why: '整體平移不改變離平均的距離' },
              {
                tex: String.raw`\operatorname{Var}(X+Y)=\operatorname{Var}(X)+\operatorname{Var}(Y)\quad(X,Y\text{ 獨立})`,
                why: (
                  <>
                    令 <Tex>{String.raw`\tilde X=X-E[X]`}</Tex>：展開 <Tex>{String.raw`(\tilde X+\tilde Y)^2`}</Tex> 後交叉項{' '}
                    <Tex>{String.raw`2E[\tilde X\tilde Y]=2E[\tilde X]\,E[\tilde Y]=0`}</Tex>
                  </>
                ),
              },
            ]}
          />
          <p className="small">
            Gaussian（常態）分布 <Tex>{String.raw`\mathcal N(m,\sigma^2)`}</Tex>：平均 <Tex>{'m'}</Tex>、變異數 <Tex>{'\\sigma^2'}</Tex> 的鐘形分布，
            機率密度 <Tex>{String.raw`\tfrac{1}{\sqrt{2\pi}\sigma}e^{-(t-m)^2/(2\sigma^2)}`}</Tex>；約 68% 的值落在 <Tex>{String.raw`m\pm\sigma`}</Tex>、95% 落在{' '}
            <Tex>{String.raw`m\pm2\sigma`}</Tex>。Gaussian 的線性組合仍是 Gaussian，所以本節的 <Tex>{'w_n'}</Tex> 也是 Gaussian。
          </p>
        </Prereq>
        <p>
          直覺上，每一步都有一點新的雜訊被「寫進」<Tex>{'w'}</Tex>，而舊的偏離每一步又被迴路修掉一部分。把 <Tex>{'w_n'}</Tex> 偏離自己平均值的部分單獨拿出來看，它走的是一個很簡單的迴路：
        </p>
        <BlockDiagram id="D-01.12">
          先看左邊：雜訊 <Tex>{'v_n'}</Tex> 乘上 <Tex>{String.raw`\mu x`}</Tex> 才進到加法點——步長越小，每步注入的雜訊越少。再看回授那一圈：上一步的偏離量乘上藍色的{' '}
          <Tex>{'p'}</Tex> 後留下來，<Tex>{'|p|'}</Tex> 越接近 1，舊的雜訊忘得越慢。圖上的迴路就是下面推導第 3 行的 <Tex>{String.raw`\tilde w_{n+1}=p\,\tilde w_n+\mu x\,v_n`}</Tex>（
          <Tex>{String.raw`\tilde w_n=w_n-E[w_n]`}</Tex> 是偏離平均的量）；「注入」與「遺忘」平衡時的大小，就是 F-01.9 的穩態變異數。
        </BlockDiagram>
        {atLeast('engineer') ? noiseVar : <Derivation title="雜訊下 $w_n$ 的平均與變異數" derivation={noiseVar} level="L0" claim="exact" />}
        <TexBlock
          id="F-01.9"
          label={
            <>
              固定 <Tex>{'x'}</Tex>、零均值 iid 雜訊（精確）
            </>
          }
        >
          {String.raw`\boxed{\operatorname{Var}(w_n)=\mu^2x^2\sigma_v^2\,\frac{1-p^{2n}}{1-p^2}\ \xrightarrow{n\to\infty}\ \frac{\mu\,\sigma_v^2}{2-\mu x^2}}`}
        </TexBlock>
        <p>
          數字：<Tex>{String.raw`\mu=0.1,\ x=2,\ \sigma_v=1`}</Tex> ⇒ <Tex>{String.raw`\operatorname{Var}(w_\infty)=${texNum(noisyStat, 6)}`}</Tex>
          （std <Tex>{texNum(Math.sqrt(noisyStat), 6)}</Tex>）。
          <strong>
            <Tex>{'\\mu'}</Tex> 越小抖動越小，但收斂越慢
          </strong>
          （<Tex>{'|p|'}</Tex> 越接近 1）——
          這是 LMS 永遠的取捨，<ChRef ch="14">Ch14</ChRef> 會把它變成最佳化問題。<ClaimTag kind="exact" />：
          <Tex>{'v_n'}</Tex> 與 <Tex>{'w_n'}</Tex> 獨立不是假設，而是自動成立（<Tex>{'w_n'}</Tex> 只由 <Tex>{'v_0,\\dots,v_{n-1}'}</Tex> 決定）
          <Erratum id="E38" />。注意區分兩個「均方」量 <Erratum id="E42" />：係數的 MSD{' '}
          <Tex>{String.raw`E[\delta_n^2]=\operatorname{Var}(w_n)+\big(p^n\delta_0\big)^2`}</Tex>（穩態時第二項 → 0，所以{' '}
          <Tex>{String.raw`\operatorname{Var}(w_\infty)`}</Tex> 就是穩態 MSD），以及 §1.2 的 MSE 成本{' '}
          <Tex>{String.raw`E[e_n^2]=x^2E[\delta_n^2]+\sigma_v^2`}</Tex>（因為 <Tex>{String.raw`e_n=\delta_nx+v_n`}</Tex>，且 <Tex>{String.raw`\delta_n`}</Tex>{' '}
          與 <Tex>{'v_n'}</Tex> 獨立）。
        </p>
        <ChapterHandCalc id="HC-01.4">
          把 §1.4 的手算例加上雜訊：第 <Tex>{'n'}</Tex> 步的平均在哪裡、變異數長到多少、最後抖多大？先用計算機的{' '}
          <Tex>{'[x^y]'}</Tex> 與開根號算一次，再到下面的 LMS Playground 載入「有雜訊」preset 對照指標表。
        </ChapterHandCalc>
      </Section>

      <Section kind="explore" title="1.5 動手：LMS Playground" level={2} id="ch01-s15">
        <p>
          下面的實驗預設就是手算例（Gallery preset #1）。「單步」一次走一步，看拋物線上的點怎麼往谷底移動；切線斜率就是{' '}
          <Tex>{String.raw`dJ/dw=-(a-w)x^2`}</Tex>，箭頭是這一步的實際更新 <Tex>{String.raw`\mu e_nx`}</Tex>。
        </p>
        <LmsPlayground />
        <Quiz
          title="思考題 1（入門課）"
          question={
            <>
              <Tex>{String.raw`w=2,\ x=-3,\ y=-9,\ \mu=0.1`}</Tex>。做一次 LMS 更新後 <Tex>{'w'}</Tex> 是多少？
            </>
          }
          options={quiz1Opts.map((v) => ({ label: String(v), correct: Math.abs(v - quiz1.w) < 1e-12 }))}
          answer={
            <StepDerivation
              steps={[
                { tex: String.raw`\hat y=wx=2\times(-3)=-6`, why: '預測' },
                { tex: String.raw`e=y-\hat y=-9-(-6)=${texNum(quiz1.e, 6)}`, why: '比較：誤差為負' },
                {
                  tex: String.raw`\Delta w=\mu ex=0.1\times(${texNum(quiz1.e, 6)})\times(-3)=${texNum(quiz1.dw, 6)}`,
                  why: (
                    <>
                      負負得正：<Tex>{'x'}</Tex> 是負的，所以誤差為負反而要把 <Tex>{'w'}</Tex> 調大——更新方向由 <Tex>{'e'}</Tex> 與 <Tex>{'x'}</Tex> 的乘積決定，不是只看誤差
                    </>
                  ),
                },
                {
                  tex: String.raw`w_{\text{new}}=2+${texNum(quiz1.dw, 6)}=${texNum(quiz1.w, 6)}`,
                  why: (
                    <>
                      真值 <Tex>{'a=3'}</Tex>（因為 <Tex>{String.raw`-9=3\times(-3)`}</Tex>），<Tex>{'w'}</Tex> 從 2 往 3 靠近
                    </>
                  ),
                },
              ]}
            />
          }
        />
        <Quiz
          title={String.raw`思考題 2（$\tfrac12$ 的陷阱，勘誤 E41）`}
          question={
            <>
              某人用沒有 <Tex>{String.raw`\tfrac12`}</Tex> 的 <Tex>{'J_2'}</Tex> 的曲率 <Tex>{'2x^2'}</Tex> 推出「<Tex>{'x=2'}</Tex> 時 LMS 必須{' '}
              <Tex>{String.raw`\mu<0.25`}</Tex>」。那 <Tex>{String.raw`\mu=0.4`}</Tex> 的 LMS 會怎樣？
            </>
          }
          options={[
            {
              label: (
                <>
                  發散（超過 <Tex>{'0.25'}</Tex>）
                </>
              ),
            },
            {
              label: (
                <>
                  收斂，且正負交替（<Tex>{`p=${texNum(q2.pole, 4)}`}</Tex>）
                </>
              ),
              correct: q2.behaviour === 'oscillating',
            },
            { label: '一步到位' },
            { label: '完全不動' },
          ]}
          answer={
            <p>
              LMS 的更新 <Tex>{String.raw`\mu ex`}</Tex> 等於對 <Tex>{String.raw`\tfrac12J_2`}</Tex> 做 GD，曲率是{' '}
              <Tex>{'x^2=4'}</Tex>，所以上限是 <Tex>{'2/x^2=0.5'}</Tex>。<Tex>{String.raw`\mu=0.4`}</Tex> 時{' '}
              <Tex>{String.raw`p=1-0.4\times4=${texNum(q2.pole, 6)}`}</Tex>，<Tex>{'|p|<1'}</Tex> 但為負：正負交替地收斂。在上面的 Playground 把 <Tex>{String.raw`\mu`}</Tex> 設成 0.4（或載入「正負交替收斂」preset）就看得到。
            </p>
          }
        />
      </Section>
    </>
  )
}
