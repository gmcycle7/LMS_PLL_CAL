import { useMemo } from 'react'
import { ClaimTag, Mermaid, Prereq, Section, SourceTag, StepDerivation, SymbolTable, Tex, TexBlock, type SymbolEntry } from '@/components'
import { mean } from '@/simulation/core'
import { batchL1, batchL2 } from '@/simulation/models/lossCompare'
import { Erratum, f, texNum } from '../common'

export const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'a',
    meaning: '黑盒子裡真正的係數（未知）',
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.0',
    note: 'PLL 中例如 DTC gain（fs / code）',
  },
  {
    symbol: 'x,\\ x_n',
    meaning: (
      <>
        輸入／regressor（第 <Tex>{'n'}</Tex> 筆）
      </>
    ),
    unit: String.raw`[x]`,
    firstSeen: '§1.0',
    note: 'PLL 中為正規化 DSM code，通常無因次',
  },
  { symbol: 'y,\\ y_n', meaning: '量測到的輸出', unit: String.raw`[y]`, firstSeen: '§1.0' },
  { symbol: 'v,\\ v_n', meaning: '量測雜訊', unit: String.raw`[y]`, firstSeen: '§1.0', note: <>本章（除思考題 4 的反例）假設零均值、與 <Tex>{'x'}</Tex> 獨立</> },
  {
    symbol: 'w,\\ w_n',
    meaning: (
      <>
        我們可以調的參數（第 <Tex>{'n'}</Tex> 次更新前）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.0',
    note: 'PLL 中為 gain register 的內容',
  },
  {
    symbol: '\\hat y=wx',
    meaning: (
      <>
        用目前的 <Tex>{'w'}</Tex> 做的預測
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§1.0',
  },
  {
    symbol: 'e=y-wx',
    meaning: '誤差（error）＝量測 − 預測',
    unit: String.raw`[y]`,
    firstSeen: '§1.0',
    note: (
      <>
        全站約定 <Tex>{String.raw`e=y-\hat y`}</Tex>（規格 §0）
      </>
    ),
  },
  {
    symbol: 'n',
    meaning: 'sample 索引（第幾筆資料／第幾次更新）',
    firstSeen: '§1.0',
    note: (
      <>
        <Tex>{'k'}</Tex> 保留給 GMAC block（Part B）；§1.3 的 GD 迭代也用 <Tex>{'k'}</Tex>
      </>
    ),
  },
  { symbol: 'N', meaning: '資料筆數／更新次數', firstSeen: '§1.1', note: <>GMAC 的累加長度也記作 <Tex>{'N'}</Tex>（Part B）</> },
  { symbol: 'E[\\cdot]', meaning: '期望值（很多次的平均）', firstSeen: '§1.1', note: '見先備知識框' },
  {
    symbol: String.raw`\arg\min_w J(w)`,
    meaning: (
      <>
        「讓 <Tex>{'J(w)'}</Tex> 最小的那個 <Tex>{'w'}</Tex>」（不是最小值本身）
      </>
    ),
    firstSeen: '§1.1',
  },
  {
    symbol: 'J(w)=\\tfrac12E[(y-wx)^2]',
    meaning: (
      <>
        MSE 成本（本站含 <Tex>{String.raw`\tfrac12`}</Tex>）
      </>
    ),
    unit: String.raw`[y]^2`,
    firstSeen: '§1.2',
    note: (
      <>
        規格寫 <Tex>{'J_2=E[(y-wx)^2]'}</Tex>，argmin 相同；<Erratum id="E41" />
      </>
    ),
  },
  { symbol: 'j_n=\\tfrac12e_n^2', meaning: '單筆成本', unit: String.raw`[y]^2`, firstSeen: '§1.3', note: <Tex>{'E[j_n]=J(w)'}</Tex> },
  {
    symbol: String.raw`J_{\text{MSE}},\ J_{\text{MAE}},\ J_{\text{Huber}}`,
    meaning: (
      <>
        三種損失的平均成本 <Tex>{String.raw`E[\rho_2(e)]`}</Tex>、<Tex>{String.raw`E[\rho_1(e)]`}</Tex>、<Tex>{String.raw`E[\rho_H(e)]`}</Tex>
      </>
    ),
    firstSeen: '§2.3',
    note: (
      <>
        <Tex>{String.raw`J_{\text{MSE}}=J=\tfrac12J_2`}</Tex>（含 <Tex>{String.raw`\tfrac12`}</Tex>）；<Tex>{'J_2'}</Tex> 專指規格沒有{' '}
        <Tex>{String.raw`\tfrac12`}</Tex> 的版本
      </>
    ),
  },
  {
    symbol: 'w^*',
    meaning: (
      <>
        讓成本最小的 <Tex>{'w'}</Tex>（最佳解）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.2',
    note: (
      <>
        MSE：<Tex>{'E[xy]/E[x^2]'}</Tex>；MAE：（加權）中位數
      </>
    ),
  },
  { symbol: 'P_x=E[x^2]', meaning: '輸入功率', unit: String.raw`[x]^2`, firstSeen: '§1.2', note: '拋物線的曲率' },
  {
    symbol: '\\mu',
    meaning: '學習率（step size）',
    unit: String.raw`1/[x]^2`,
    firstSeen: '§1.3',
    note: (
      <>
        Conventional／Huber LMS 的單位；Sign-Error 是 <Tex>{String.raw`[y]/[x]^2`}</Tex>、Sign-Sign 是 <Tex>{String.raw`[y]/[x]`}</Tex>（
        <Tex>{String.raw`\operatorname{sign}(\cdot)`}</Tex> 無因次）。本章例題的 <Tex>{'x'}</Tex>、<Tex>{'y'}</Tex> 都是純數字；硬體暫存器{' '}
        <code>REG_LMS_MU</code>
      </>
    ),
  },
  {
    symbol: '\\delta_n=a-w_n',
    meaning: '剩餘參數誤差',
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.4',
    note: (
      <>
        本章採 <Tex>{'a-w'}</Tex>（規格 §3 寫 <Tex>{'w-a'}</Tex>）；<Erratum id="E39" />
      </>
    ),
  },
  {
    symbol: 'p=1-\\mu x^2',
    meaning: (
      <>
        固定 <Tex>{'x'}</Tex> 時的離散 pole（每步誤差乘上的倍數）
      </>
    ),
    firstSeen: '§1.4',
    note: (
      <>
        <Tex>{'|p|<1'}</Tex> ⇔ 收斂
      </>
    ),
  },
  { symbol: '\\sigma_v', meaning: 'Gaussian 雜訊標準差', unit: String.raw`[y]`, firstSeen: '§1.4.1' },
  {
    symbol: '\\rho(e),\\ \\psi(e)',
    meaning: (
      <>
        損失函數與其導數 <Tex>{String.raw`\psi=d\rho/de`}</Tex>（influence function）
      </>
    ),
    firstSeen: '§2.1',
    note: (
      <>
        下標 <Tex>{'2,1,H'}</Tex> = MSE、MAE、Huber
      </>
    ),
  },
  {
    symbol: '\\delta_H',
    meaning: 'Huber 門檻',
    unit: String.raw`[y]`,
    firstSeen: '§2.1',
    note: (
      <>
        下標 H：與參數誤差 <Tex>{String.raw`\delta_n`}</Tex> 不同
      </>
    ),
  },
  {
    symbol: '\\operatorname{sign}(\\cdot)',
    meaning: (
      <>
        取正負號；<Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 的慣例必須明定
      </>
    ),
    firstSeen: '§2.2',
    note: (
      <>
        <Tex>{String.raw`0\ /\ {+1}\ /\ {-1}`}</Tex>；<Erratum id="E40" />
      </>
    ),
  },
  { symbol: '\\partial f(e_0)', meaning: '次梯度（subgradient）集合', firstSeen: '§2.2', note: '見先備知識框' },
  {
    symbol: String.raw`\operatorname{clip}(e,-\delta_H,\delta_H)`,
    meaning: (
      <>
        把 <Tex>{'e'}</Tex> 截在 <Tex>{String.raw`[-\delta_H,\delta_H]`}</Tex> 之內（超出就取端點）
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§2.1',
    note: (
      <>
        Huber 的 <Tex>{'\\psi_H'}</Tex>
      </>
    ),
  },
  { symbol: String.raw`\#\{\cdot\}`, meaning: '滿足括號內條件的資料筆數', firstSeen: '§2.3', note: 'MAE 的導數 = 計數差' },
  {
    symbol: 'P(\\cdot)',
    meaning: '事件的機率（重複很多次時，該事件發生的比例）',
    firstSeen: '§2.3.1',
    note: (
      <>
        例：從 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 等機率抽，<Tex>{String.raw`P(y=0)=\tfrac34`}</Tex>
      </>
    ),
  },
  {
    symbol: '\\overline w',
    meaning: (
      <>
        <Tex>{'w_n'}</Tex> 的長時間平均（穩態時間平均）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§2.3.1',
  },
  {
    symbol: '\\pi_k,\\ u_k,\\ d_k',
    meaning: '格點 Markov 鏈的穩態機率、往上／往下的機率',
    firstSeen: '§2.3.1',
    note: 'Research 模式',
  },
  {
    symbol: String.raw`\tilde v=y-ax`,
    meaning: (
      <>
        §2 的總雜訊：Gaussian 雜訊 <Tex>{'v'}</Tex> 加上 outlier <Tex>{'o'}</Tex>（沒有 outlier 時就是 <Tex>{'v'}</Tex>）
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        程式碼中的變數名是 <code>n</code>（noise）
      </>
    ),
  },
  {
    symbol: 'F(t),\\ f(t)',
    meaning: '累積分布函數（CDF）與機率密度（PDF）',
    unit: String.raw`-,\ 1/[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        <Tex>{"f=F'"}</Tex>；<Tex>{String.raw`f_{\tilde v}`}</Tex> 是總雜訊 <Tex>{String.raw`\tilde v`}</Tex> 的密度；見先備知識框
      </>
    ),
  },
  {
    symbol: String.raw`K_q=2f_{\tilde v}(t^*)`,
    meaning: 'Sign-Error 在連續雜訊下的等效小訊號增益',
    unit: String.raw`1/[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        Gaussian：<Tex>{String.raw`\sqrt{2/\pi}/\sigma_v`}</Tex>，即規格 §0、§5.1 的 comparator 增益（Ch05）
      </>
    ),
  },
  { symbol: '\\varepsilon,\\ s', meaning: 'outlier 機率與大小', unit: String.raw`-,\ [y]`, firstSeen: '§2.4', note: 'MSE vs MAE Lab 的控制項' },
  { symbol: '\\Phi(\\cdot)', meaning: '標準常態 CDF', firstSeen: '§2.4', note: 'Research 模式；見先備知識框' },
]

// Mermaid 標籤無法排 KaTeX：用 Unicode 下標（wₙ₊₁），避免「w_n+1」被誤讀成 wₙ + 1
const LMS_FLOW = `flowchart LR
  X["xₙ（輸入 / DSM code）"] --> BOX["黑盒子：a·xₙ"]
  BOX --> ADD(("+"))
  V["vₙ（雜訊）"] --> ADD
  ADD --> Y["yₙ"]
  X --> MUL["× wₙ（預測）"]
  MUL --> YH["ŷₙ = wₙ·xₙ"]
  Y --> SUB(("−"))
  YH --> SUB
  SUB --> E["eₙ = yₙ − ŷₙ"]
  E --> UPD["wₙ₊₁ = wₙ + μ·eₙ·xₙ"]
  X --> UPD
  UPD -->|"下一筆"| MUL`

/** 黑盒子：乾淨資料與含雜訊資料（規格 §1、入門課 Lesson 1） */
const CLEAN = { x: [1, 2, 4], y: [3, 6, 12] }
const NOISY = { x: [1, 2, 4], y: [3.2, 5.7, 12.5] }
/** 入門課 Lesson 2：兩個模型的誤差 */
const MODEL_A = [10, -10, 10, -10]
const MODEL_B = [1, -1, 1, -1]

export function IntroSection() {
  const est = useMemo(() => {
    const ratios = NOISY.y.map((y, i) => y / NOISY.x[i])
    const ls = batchL2(NOISY.x, NOISY.y)
    const l1 = batchL1(NOISY.x, NOISY.y)
    const sxy = NOISY.x.reduce((s, x, i) => s + x * NOISY.y[i], 0)
    const sxx = NOISY.x.reduce((s, x) => s + x * x, 0)
    return { ratios, ls, l1, sxy, sxx }
  }, [])
  const ab = useMemo(
    () =>
      [MODEL_A, MODEL_B].map((e) => ({
        mean: mean(e),
        abs: mean(e.map(Math.abs)),
        sq: mean(e.map((v) => v * v)),
      })),
    [],
  )

  return (
    <>
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            首次出現的段落編號對應本頁的小節。<Tex>{'\\delta'}</Tex> 的極性、<Tex>{'J'}</Tex> 的 <Tex>{String.raw`\tfrac12`}</Tex>、
            <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 皆依 docs/validation.md 勘誤。
          </>
        }
      />

      <Section kind="intuition" title="1.0 這一課要回答的問題" level={2} id="ch01-s10">
        <p className="ch01-lead">
          你面前有一個黑盒子：放進 <Tex>{'x'}</Tex>，出來 <Tex>{'y'}</Tex>。你知道它大概是{' '}
          <Tex>{'y=ax'}</Tex>，但不知道 <Tex>{'a'}</Tex>。<strong>LMS（Least Mean Squares）就是「一邊看資料、一邊修正猜測」的方法</strong>
          。這一課回答兩個問題：(1) 名字裡的 Least、Mean、Squares 各是什麼意思、數學上怎麼來的？(2) 一定要用平方嗎？用絕對值會怎樣？
        </p>
        <TexBlock id="F-01.1" label="黑盒子模型（規格 §1）">
          {String.raw`y=ax+v,\qquad \hat y=wx,\qquad e=y-\hat y=y-wx`}
        </TexBlock>
        <div className="ch01-two">
          <div>
            <p>
              <strong>乾淨資料</strong> <SourceTag />
            </p>
            <div className="table-wrap">
              <table className="ch01-table">
                <thead>
                  <tr>
                    <th className="num">
                      <Tex>{'x'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'y'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'y/x'}</Tex>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CLEAN.x.map((x, i) => (
                    <tr key={x}>
                      <td className="num">{x}</td>
                      <td className="num">{CLEAN.y[i]}</td>
                      <td className="num">{f(CLEAN.y[i] / x)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">每一筆都告訴你 <Tex>{'a=3'}</Tex>，一眼看完。</p>
          </div>
          <div>
            <p>
              <strong>含雜訊資料</strong> <SourceTag />
            </p>
            <div className="table-wrap">
              <table className="ch01-table">
                <thead>
                  <tr>
                    <th className="num">
                      <Tex>{'x'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'y'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{'y/x'}</Tex>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NOISY.x.map((x, i) => (
                    <tr key={x}>
                      <td className="num">{x}</td>
                      <td className="num">{NOISY.y[i]}</td>
                      <td className="num">{f(est.ratios[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">
              三筆給出三個不同的比值：<strong>
                沒有任何一筆能直接告訴你 <Tex>{'a'}</Tex>
              </strong>
              。
            </p>
          </div>
        </div>
        <p>
          那要相信哪一個？「最小平方」的答案是把三筆合起來，使平方誤差總和最小（§1.2 會推導）：
        </p>
        <TexBlock>
          {String.raw`\hat a_{\text{LS}}=\frac{\sum_i x_iy_i}{\sum_i x_i^2}=\frac{${texNum(est.sxy, 6)}}{${texNum(est.sxx, 6)}}=${texNum(est.ls, 6)}`}
        </TexBlock>
        <p className="small">
          （若改成「最小絕對值」，答案是以 <Tex>{'|x_i|'}</Tex> 為權重的加權中位數{' '}
          <Tex>{texNum(est.l1.lo, 6)}</Tex>——§2 會解釋為什麼。兩個數都由 <code>lossCompare.ts</code> 的 <code>batchL2</code> /{' '}
          <code>batchL1</code> 即時計算。）
        </p>
        <p>LMS 不一次解完，而是每來一筆就做三個動作：</p>
        <div className="ch01-flow" aria-label="LMS 三個動作">
          <span className="ch01-flow-box">① 預測 <Tex>{String.raw`\hat y_n=w_nx_n`}</Tex></span>
          <span className="ch01-flow-arrow">→</span>
          <span className="ch01-flow-box">② 比較 <Tex>{String.raw`e_n=y_n-\hat y_n`}</Tex></span>
          <span className="ch01-flow-arrow">→</span>
          <span className="ch01-flow-box">③ 修正 <Tex>{String.raw`w_{n+1}=w_n+\mu e_nx_n`}</Tex></span>
          <span className="ch01-flow-arrow">↺</span>
        </div>
      </Section>

      <Section kind="diagram" title="1.0.1 資料流：LMS 迴圈長什麼樣子" level={3} id="ch01-s101">
        <Mermaid
          chart={LMS_FLOW}
          caption="純量 LMS 的訊號流（L0 模型）。PLL 對應：輸入是 DSM code、黑盒子的係數是 DTC gain 所在的誤差路徑、相減的是 PD／comparator、更新的是 GMAC + gain register。"
          ariaLabel="LMS 迴圈方塊圖：x 進入黑盒子與預測器，誤差 e 回授更新 w"
        />
      </Section>

      <Section kind="intuition" title="1.1 Least／Mean／Squares 逐字拆解" level={2} id="ch01-s11">
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>字</th>
                <th>白話</th>
                <th>數學</th>
                <th>如果拿掉會怎樣？</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Least</strong>
                </td>
                <td>找出讓誤差指標「最小」的係數</td>
                <td>
                  <Tex>{String.raw`w^*=\arg\min_w J(w)`}</Tex>
                </td>
                <td>沒有目標就不知道往哪改；LMS 的每一步都是往 <Tex>{'J'}</Tex> 變小的方向走一小步</td>
              </tr>
              <tr>
                <td>
                  <strong>Mean</strong>
                </td>
                <td>看「很多次的平均」，不是只看一次量測</td>
                <td>
                  <Tex>{String.raw`E[\cdot]\approx\frac1N\sum_{n}(\cdot)`}</Tex>
                </td>
                <td>只看單筆會被雜訊牽著走（上面三個比值各不相同）</td>
              </tr>
              <tr>
                <td>
                  <strong>Squares</strong>
                </td>
                <td>誤差先平方，正負就不會互相抵消</td>
                <td>
                  <Tex>{'e^2'}</Tex>
                </td>
                <td>平均誤差可以是 0 但每次都錯很大（下面的模型 A）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <TexBlock>{String.raw`\boxed{J_2(w)=E\big[(y-wx)^2\big],\qquad w^*=\arg\min_w J_2(w)}`}</TexBlock>
        <p className="small">
          規格 §1 原式。本站從 §1.3 起改用 <Tex>{String.raw`J=\tfrac12J_2`}</Tex>，最小值位置不變 <Erratum id="E41" />。
        </p>

        <Prereq title="期望值 $E[\cdot]$：「很多次的平均」">
          <p>
            一個隨機量 <Tex>{'X'}</Tex>（例如擲骰子的點數）每次結果不同。<strong>期望值</strong>
            <Tex>{'E[X]'}</Tex> 是「重複非常多次後的平均」。若 <Tex>{'X'}</Tex> 只取有限個值 <Tex>{'x_i'}</Tex>、機率{' '}
            <Tex>{'p_i'}</Tex>：
          </p>
          <TexBlock>{String.raw`E[X]=\sum_i x_i\,p_i\qquad\text{例：骰子 }E[X]=\tfrac16(1+2+\dots+6)=3.5`}</TexBlock>
          <p>本章只會用到三條規則（都可以從「平均」的定義直接看出來）：</p>
          <StepDerivation
            steps={[
              { tex: String.raw`E[X+Y]=E[X]+E[Y]`, why: '平均的加總 = 加總的平均（每次相加後再平均，與分開平均再相加一樣）' },
              {
                tex: String.raw`E[cX]=c\,E[X]\quad(c\text{ 為確定的常數})`,
                why: (
                  <>
                    每次都乘同一個 <Tex>{'c'}</Tex>，平均也乘 <Tex>{'c'}</Tex>；本章的 <Tex>{'w'}</Tex> 在「求成本」時是確定數，所以能提出來
                  </>
                ),
              },
              { tex: String.raw`E[c]=c`, why: '一個不隨機的數，平均起來還是它自己' },
            ]}
          />
          <p className="small">
            實務上用樣本平均 <Tex>{String.raw`\frac1N\sum_{n=1}^N X_n`}</Tex> 估計 <Tex>{'E[X]'}</Tex>；<Tex>{'N'}</Tex>{' '}
            越大越準（誤差大約以 <Tex>{String.raw`1/\sqrt N`}</Tex> 下降，Ch05 會用中央極限定理說明）。
          </p>
        </Prereq>
      </Section>

      <Section kind="example" title="1.1.1 為什麼要平方？模型 A（$\pm10$）vs 模型 B（$\pm1$）" level={3} id="ch01-s111">
        <p>
          兩個模型對四筆資料的誤差如下。哪個比較好？顯然是 B——但「平均誤差」卻說它們一樣好：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>
                  誤差 <Tex>{'e'}</Tex>
                </th>
                <th className="num">
                  平均 <Tex>{'e'}</Tex>
                </th>
                <th className="num">
                  平均 <Tex>{'|e|'}</Tex>
                </th>
                <th className="num">
                  平均 <Tex>{'e^2'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ['A', MODEL_A],
                ['B', MODEL_B],
              ].map(([name, e], i) => (
                <tr key={name as string}>
                  <td>模型 {name as string}</td>
                  <td className="mono">[{(e as number[]).join(', ')}]</td>
                  <td className="num">{f(ab[i].mean)}</td>
                  <td className="num">{f(ab[i].abs)}</td>
                  <td className="num">{f(ab[i].sq)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              由陣列即時計算。平均 <Tex>{'e'}</Tex> 都是 <Tex>{texNum(ab[0].mean)}</Tex>（正負抵消），平方後 A ={' '}
              <Tex>{texNum(ab[0].sq)}</Tex>、B = <Tex>{texNum(ab[1].sq)}</Tex>，差 <Tex>{texNum(ab[0].sq / ab[1].sq)}</Tex> 倍。
            </caption>
          </table>
        </div>
        <StepDerivation
          title="用數學說同一件事"
          steps={[
            { tex: String.raw`\tfrac14(10-10+10-10)=0=\tfrac14(1-1+1-1)`, why: '正負誤差互相抵消，平均誤差分不出好壞' },
            {
              tex: String.raw`\tfrac14(10^2+10^2+10^2+10^2)=100,\qquad \tfrac14(1^2+1^2+1^2+1^2)=1`,
              why: (
                <>
                  平方後全部變成正數，大誤差被放大（<Tex>{String.raw`10\to10^2=100`}</Tex>）
                </>
              ),
            },
            { tex: String.raw`\tfrac14(|10|+|{-10}|+\dots)=10,\qquad \tfrac14(|1|+|{-1}|+\dots)=1`, why: '絕對值也能避免抵消——這就是 §2 的 MAE；兩者差在「怎麼懲罰大誤差」' },
          ]}
        />
        <p>
          結論 <ClaimTag kind="exact" />：誤差指標一定要「不分正負都算壞」。平方（L2）與絕對值（L1）都可以；選平方的好處是
          <strong>對線性模型會得到平滑的拋物線</strong>，可以用微積分直接求最小值、分析收斂、設計硬體——這就是下一節。
        </p>
      </Section>
    </>
  )
}
