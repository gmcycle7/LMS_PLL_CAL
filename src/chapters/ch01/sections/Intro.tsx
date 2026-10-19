import { useMemo, type ReactNode } from 'react'
import { ClaimTag, Prereq, Section, SourceTag, StepDerivation, SystemMap, Tex, TexBlock, ChRef } from '@/components'
import { mean } from '@/simulation/core'
import { batchL1, batchL2 } from '@/simulation/models/lossCompare'
import { BlockDiagram, Erratum, PllLink, f, texNum } from '../common'
import { SYSTEM_MAP_CAPTION, SYSTEM_MAP_FOCUS } from '../diagrams'

/** 黑盒子：乾淨資料與含雜訊資料（規格 §1、入門課 Lesson 1） */
const CLEAN = { x: [1, 2, 4], y: [3, 6, 12] }
const NOISY = { x: [1, 2, 4], y: [3.2, 5.7, 12.5] }
/** 入門課 Lesson 2：兩個模型的誤差 */
const MODEL_A = [10, -10, 10, -10]
const MODEL_B = [1, -1, 1, -1]

/** @param afterMap 接在系統地圖的「你在這裡」之後的內容（index.tsx 把標籤列與勘誤說明框放在這裡） */
export function IntroSection({ afterMap }: { afterMap?: ReactNode } = {}) {
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
      <Section kind="intuition" title="1.0 這一課要回答的問題" level={2} id="ch01-s10">
        <p className="ch01-lead">
          你面前有一個黑盒子：放進 <Tex>{'x'}</Tex>，出來 <Tex>{'y'}</Tex>。你知道它大概是{' '}
          <Tex>{'y=ax'}</Tex>，但不知道 <Tex>{'a'}</Tex>。<strong>LMS（Least Mean Squares）就是「一邊看資料、一邊修正猜測」的方法</strong>
          。這一課回答兩個問題：(1) 名字裡的 Least、Mean、Squares 各是什麼意思、數學上怎麼來的？(2) 一定要用平方嗎？用絕對值會怎樣？
        </p>
        <SystemMap focus={SYSTEM_MAP_FOCUS} caption={SYSTEM_MAP_CAPTION} />
        <p className="c-map-note">
          <strong>你在這裡</strong>：上圖是整個 PLL 加上 LMS 校正迴路，每一章開頭都是同一張。主迴路是 reference clock 先經過 DTC、再進 phase detector（PD）、loop filter、VCO；回授路徑上只有 divider（或 PMUX）。LMS 校正迴路的輸入是 PD 的輸出——送進 loop filter 的同一個訊號，1-bit comparator 取的就是它的正負號。藍色方塊是本章的主角——GMAC（gain multiply-accumulate：把誤差乘上輸入再累加）、步長（<Tex>{String.raw`\div N`}</Tex>、<Tex>{String.raw`\times\mu`}</Tex>）與 gain accumulator（存係數 <Tex>{'w'}</Tex> 的暫存器）合起來就是「修正猜測」這個動作，1-bit comparator 則決定修正時用的是誤差本身，還是只有它的正負號。本章把這四塊從 PLL 裡拿出來，放進一個沒有 PLL 動態的最簡單模型（一個輸入、一個係數），回答一件事：這條修正規則到底在最小化什麼？§1 用誤差本身，§2 換成只有正負號（comparator 的情況）。
        </p>
        {afterMap}
        <TexBlock id="F-01.1" label="黑盒子模型（規格 §1）">
          {String.raw`y=ax+v,\qquad \hat y=wx,\qquad e=y-\hat y=y-wx`}
        </TexBlock>
        <p>
          式中 <Tex>{'x'}</Tex> 是輸入、<Tex>{'y'}</Tex> 是量測到的輸出、<Tex>{'a'}</Tex> 是黑盒子裡真正的係數（未知）；<Tex>{'v'}</Tex>{' '}
          是量測雜訊（每次量測多出來、我們控制不了的隨機誤差）；<Tex>{'w'}</Tex> 是我們可以調的參數，也就是對 <Tex>{'a'}</Tex> 的目前猜測；
          <Tex>{String.raw`\hat y=wx`}</Tex>（讀作 y hat）是用目前的 <Tex>{'w'}</Tex> 做的預測；<Tex>{String.raw`e=y-\hat y`}</Tex>{' '}
          是誤差（error）＝量測減預測，全站都用這個正負號。先看兩組資料：
        </p>
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
          那要相信哪一個？「最小平方」的答案是把三筆合起來，使平方誤差總和最小（§1.2 會推導；<Tex>{String.raw`\sum_i`}</Tex> 表示把每一筆加起來，下標{' '}
          <Tex>{'i'}</Tex> 是第幾筆，<Tex>{String.raw`\hat a_{\text{LS}}`}</Tex> 是用最小平方（least squares）得到的 <Tex>{'a'}</Tex> 的估計）：
        </p>
        <TexBlock>
          {String.raw`\hat a_{\text{LS}}=\frac{\sum_i x_iy_i}{\sum_i x_i^2}=\frac{${texNum(est.sxy, 6)}}{${texNum(est.sxx, 6)}}=${texNum(est.ls, 6)}`}
        </TexBlock>
        <p className="small">
          （若改成「最小絕對值」，答案是以 <Tex>{'|x_i|'}</Tex> 為權重的加權中位數{' '}
          <Tex>{texNum(est.l1.lo, 6)}</Tex>——§2 會解釋為什麼。兩個數都由 <code>lossCompare.ts</code> 的 <code>batchL2</code> /{' '}
          <code>batchL1</code> 即時計算。）
        </p>
        <p>
          上面的做法要先把資料全部收齊（批次，batch）。LMS 走另一條路：不存資料、不一次解完，而是每來一筆就把手上的猜測修一點（線上，online）。硬體喜歡後者——只要一個暫存器記住 <Tex>{'w'}</Tex>。
        </p>
        <BlockDiagram id="D-01.1">
          先看上面那一列：<Tex>{'N'}</Tex> 筆資料（<Tex>{'N'}</Tex> 是資料筆數，下標 <Tex>{'i'}</Tex> 是第幾筆）全部進記憶體，算出兩個總和再相除一次，就是剛才的{' '}
          <Tex>{String.raw`\hat a_{\text{LS}}`}</Tex>。再看下面那一列：每來一筆就繞一圈 ①→②→③，繞完只留下新的 <Tex>{'w'}</Tex>。圖上的{' '}
          <Tex>{String.raw`\Sigma x_iy_i/\Sigma x_i^2`}</Tex> 就是上式的 <Tex>{String.raw`\sum_i x_iy_i\big/\sum_i x_i^2`}</Tex>；下面一列的 ③ 就是 §1.3 要推導的 LMS 更新式。
        </BlockDiagram>
        <p>LMS 每來一筆做的三個動作，寫成式子是：</p>
        <div className="ch01-flow" aria-label="LMS 三個動作">
          <span className="ch01-flow-box">① 預測 <Tex>{String.raw`\hat y_n=w_nx_n`}</Tex></span>
          <span className="ch01-flow-arrow">→</span>
          <span className="ch01-flow-box">② 比較 <Tex>{String.raw`e_n=y_n-\hat y_n`}</Tex></span>
          <span className="ch01-flow-arrow">→</span>
          <span className="ch01-flow-box">③ 修正 <Tex>{String.raw`w_{n+1}=w_n+\mu e_nx_n`}</Tex></span>
          <span className="ch01-flow-arrow">↺</span>
        </div>
        <p className="small">
          下標 <Tex>{'n'}</Tex> 是 sample 索引：第 <Tex>{'n'}</Tex> 筆資料，也是第 <Tex>{'n'}</Tex> 次更新（<Tex>{'w_n'}</Tex> 是第 <Tex>{'n'}</Tex>{' '}
          次更新前的值）。<Tex>{'\\mu'}</Tex>（mu）是學習率（step size）：一個正的小數，決定每次修正走多大步。修正量{' '}
          <Tex>{String.raw`\Delta w_n=\mu e_nx_n`}</Tex> 同時正比於誤差 <Tex>{'e_n'}</Tex> 與輸入 <Tex>{'x_n'}</Tex>——為什麼是這個形式，§1.3 會從微分推出來。
        </p>
      </Section>

      <Section kind="diagram" title="1.0.1 資料流：LMS 迴圈長什麼樣子" level={3} id="ch01-s101">
        <p>
          把三個動作和黑盒子畫在同一張圖上。上半部是我們看不到內部的「真實世界」，下半部是我們自己做的「模型」；兩者吃同一個輸入，輸出相減就是誤差。
        </p>
        <BlockDiagram id="D-01.2">
          先看上面那條路：<Tex>{'x_n'}</Tex> 進黑盒子變成 <Tex>{'ax_n'}</Tex>，加上雜訊 <Tex>{'v_n'}</Tex> 得到量測 <Tex>{'y_n'}</Tex>。再看下面那條路：同一個{' '}
          <Tex>{'x_n'}</Tex> 乘上 <Tex>{'w_n'}</Tex> 得到預測 <Tex>{String.raw`\hat y_n`}</Tex>。兩條路在右邊的加法點相遇，量測進「＋」、預測進「−」：圖上的這個加法點就是 F-01.1 的{' '}
          <Tex>{String.raw`e_n=y_n-\hat y_n`}</Tex>。最後看藍色方塊：它拿 <Tex>{'e_n'}</Tex> 和 <Tex>{'x_n'}</Tex> 算出新的 <Tex>{'w_{n+1}'}</Tex>，沿著「下一筆」那條線送回乘法器——這條回授線讓它成為一個迴路。
        </BlockDiagram>
        <PllLink>
          把這張圖放回 PLL（之後各章都用這個物理圖像）：
          <ul>
            <li>
              輸入 <Tex>{'x_n'}</Tex> 是 DTC 的 code：小數除頻累加器的餘數，正規化後介於 0 與 1 之間。它先乘上 <Tex>{'w_n'}</Tex>（gain correction），才去控制 reference 端的 DTC。
            </li>
            <li>
              黑盒子的 <Tex>{'ax_n'}</Tex> 是 feedback（divider）edge 比理想時刻早到的時間。<Tex>{'a'}</Tex> 是 DTC 的真實 gain：要把這段時間完全補掉，
              <Tex>{'w'}</Tex> 必須等於它。
            </li>
            <li>
              預測 <Tex>{String.raw`\hat y_n=w_nx_n`}</Tex> 是 DTC 的補償量。reference 端的 DTC 只能延遲、不能提前，所以它從一個固定的基準延遲 <Tex>{'T_0'}</Tex>{' '}
              往回扣：<Tex>{String.raw`\tau_{\mathrm{DTC}}=T_0-w_nx_n`}</Tex>。code 越大延遲越短，reference edge 等於被提前（少延遲）了 <Tex>{'w_nx_n'}</Tex>。
              <Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收，不影響 LMS。
            </li>
            <li>
              圖上相減的加法點就是 PD：它量的是（延遲後的）reference edge 減 feedback edge。以理想時刻當零點（
              <Tex>{'T_0'}</Tex> 已被吸收），feedback edge 在 <Tex>{String.raw`t_{\mathrm{fb}}=-ax_n`}</Tex>、reference edge 在{' '}
              <Tex>{String.raw`t_{\mathrm{ref}}'=-w_nx_n`}</Tex>，再加上量測雜訊 <Tex>{'v_n'}</Tex>，所以{' '}
              <Tex>{String.raw`e_n=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_n)\,x_n+v_n`}</Tex>——和圖上的 <Tex>{String.raw`y_n-\hat y_n`}</Tex>{' '}
              是同一個式子。補償不足（<Tex>{'w_n<a'}</Tex>）時 reference 還是太晚，扣掉雜訊後誤差為正。這個 PD 輸出同時送進 loop filter 與 LMS 的 1-bit comparator，所以 LMS 看到的就是 PD 的輸出。
            </li>
          </ul>
        </PllLink>
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
        <p>
          表裡出現三個新記號。<Tex>{'J(w)'}</Tex> 叫成本（cost）：把「模型有多不準」濃縮成一個只跟 <Tex>{'w'}</Tex> 有關的數，越小越好。
          <Tex>{String.raw`\arg\min_w J(w)`}</Tex> 讀作「讓 <Tex>{'J(w)'}</Tex> 最小的那個 <Tex>{'w'}</Tex>」——它是谷底的位置，不是谷底的高度；這個位置記作{' '}
          <Tex>{'w^*'}</Tex>（最佳解）。<Tex>{String.raw`E[\cdot]`}</Tex> 是期望值，可以先當成「<Tex>{'N'}</Tex> 筆資料的平均」，其中 <Tex>{'N'}</Tex>{' '}
          是拿來平均的資料筆數（下面的先備知識框有完整說明）。把三個字照計算順序串起來：
        </p>
        <BlockDiagram id="D-01.3">
          先看上面那一列：輸入 <Tex>{'x'}</Tex> 乘上你選的 <Tex>{'w'}</Tex> 得到預測，量測 <Tex>{'y'}</Tex> 減掉它就是這一筆資料的誤差 <Tex>{'e'}</Tex>。再看下面那一列，沿著三個藍色方塊往右：平方（Squares）→ 很多筆取平均（Mean）→ 換不同的 <Tex>{'w'}</Tex> 找最小（Least）。注意名字的順序和計算的順序剛好相反。圖上「成本」那一格就是下面公式的{' '}
          <Tex>{String.raw`J_2(w)=E[(y-wx)^2]`}</Tex>，最右邊的 <Tex>{'w^*'}</Tex> 就是 <Tex>{String.raw`\arg\min_wJ_2(w)`}</Tex>。
        </BlockDiagram>
        <TexBlock>{String.raw`\boxed{J_2(w)=E\big[(y-wx)^2\big],\qquad w^*=\arg\min_w J_2(w)}`}</TexBlock>
        <p className="small">
          規格 §1 原式（下標 2 表示「平方」、沒有 <Tex>{String.raw`\tfrac12`}</Tex>）。本站從 §1.3 起改用 <Tex>{String.raw`J=\tfrac12J_2`}</Tex>，最小值位置不變{' '}
          <Erratum id="E41" />。
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
            越大越準（誤差大約以 <Tex>{String.raw`1/\sqrt N`}</Tex> 下降，<ChRef ch="05">Ch05</ChRef> 會用中央極限定理說明）。
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
        <BlockDiagram id="D-01.4">
          先看左邊兩個方塊：同樣四筆誤差，A 是 <Tex>{String.raw`\pm10`}</Tex>、B 是 <Tex>{String.raw`\pm1`}</Tex>。再看中間三種計分方式各自吐出什麼：直接平均的那一條，兩個模型都得到 0（紅色，分不出來）；先取絕對值或先平方的兩條才分得出 B 比較好。圖上的 <Tex>{String.raw`\text{mean}(e^2)`}</Tex>{' '}
          就是 §1.1 的「Mean Squares」<Tex>{'E[e^2]'}</Tex>；<Tex>{String.raw`\text{mean}(|e|)`}</Tex> 是 §2 才會用到的 <Tex>{'E|e|'}</Tex>。
        </BlockDiagram>
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
