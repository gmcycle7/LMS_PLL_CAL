import { Callout, ModeGate, SystemMap, Tex, TestBadge, type SystemBlock } from '@/components'
import { ChapterLink, Diagram, ErrataNote, tm } from '../common'
import { TOP_ID } from './Symbols'

/**
 * 系統地圖上標成藍色的方塊：regressor x[n]、1-bit comparator、GMAC、÷N × μ、gain accumulator。
 * 這五格合起來就是「更新式」：誤差（或它的正負號）與 regressor 怎麼變成 w 的下一步。
 */
export const SYSTEM_FOCUS: SystemBlock[] = ['res', 'cmp', 'gmac', 'scale', 'acc']

export function Intro() {
  return (
    <section>
      <div className="ch02-question" id={TOP_ID} tabIndex={-1}>
        <strong>這一課要回答的問題：</strong>你被矇住眼睛站在山坡上，只能用腳感覺「腳下的坡度」。要怎麼一步一步走到谷底？如果每一步只能看<strong>一筆</strong>資料、甚至只能知道誤差的<strong>正負號</strong>（硬體只有一顆 1-bit comparator），還走得到嗎？會停在哪裡？
      </div>
      <SystemMap focus={SYSTEM_FOCUS} />
      <p data-system-map-note className="c-map-note">
        上面是全站共用的系統地圖，<strong>藍色的方塊</strong>是這一章的主角：校正用的 code <Tex>{'x[n]'}</Tex>（regressor）、只輸出誤差正負號的 1-bit comparator、把正負號與 code 相乘後累加的 GMAC、
        <Tex>{'\\div N,\\ \\times\\mu'}</Tex>（取平均、乘上步長）與存放係數 <Tex>{'w'}</Tex> 的 gain accumulator。前兩章先用黑盒子介紹了「預測、比較、修正」，以及誤差好壞的兩種算法；這一章加上的是<strong>更新式</strong>的來歷——這五個方塊合起來，每一步為什麼要把 <Tex>{'w'}</Tex> 往那個方向推、推多少——從使用完整坡度的 gradient descent，一路簡化到只用兩個正負號的 Sign-Sign。地圖上 comparator 的輸入是從 <strong>PD 的輸出</strong>分接出來的：PD 與 loop filter 之間那條線上有一個分接點，標著「PD 輸出 <Tex>{'e[n]'}</Tex>」；comparator 左上方同名的標籤「<Tex>{'e[n]'}</Tex>（PD 輸出）」就是同一條線。它取的是送進 loop filter 的同一個誤差，不是從 DTC 或 divider 拉出來的。
      </p>
      <p>
        上一章（<ChapterLink ch="01">Ch01</ChapterLink>）說明了「平方誤差」與「絕對誤差」是兩種不同的目標。這一章把它們變成可以一步一步執行的演算法。先把三個記號講好：<Tex>{'w'}</Tex> 是我們能調的係數（旋鈕）；<Tex>{'J(w)'}</Tex> 是成本（cost）——把旋鈕放在 <Tex>{'w'}</Tex> 時預測有多不準，也就是「山的高度」；
        <Tex>{"J'(w)"}</Tex> 是它對 <Tex>{'w'}</Tex> 的導數，也就是「腳下的坡度」。本章回答三個工程問題：(1) 為什麼往 <Tex>{"-J'(w)"}</Tex> 走會下降、步長能多大；(2) 為什麼只用一筆資料的梯度也行（LMS = SGD）；(3) 只有 sign 的 Sign-Error 與 Sign-Sign 會收斂到<strong>哪裡</strong>、會不會停下來。
      </p>
      <ol className="ch02-roadmap">
        <li>§1 從切線斜率到 Gradient Descent（泰勒展開、步長上限、Newton 步）</li>
        <li>§2 Batch GD vs Stochastic GD：單筆梯度是不偏估計 ⇒ LMS 就是 SGD</li>
        <li>§3 MAE ⇒ Sign-Error LMS：次梯度、<Tex>{'\\operatorname{sign}(0)'}</Tex> 慣例、limit cycle、遞減步長</li>
        <li>§4 Sign-Sign LMS 是另一個演算法：固定點條件不同、偏斜雜訊反例</li>
        <li>§5 大比較表、四種演算法的核心程式碼、精度效率、NLMS 預告、主實驗</li>
        <li>§6 連到 PLL：comparator、GMAC 與 conditional negation；思考題與本課必記</li>
      </ol>
      <Diagram id="roadmap">
        <p>
          {tm(
            String.raw`先看最上面：§1 的 gradient descent 需要知道真正的平均坡度。再由上往下看每個箭頭上的字——每一步都把一樣東西換成更便宜的：平均換成單筆資料、誤差 $e$ 換成它的正負號 $\operatorname{sign}(e)$、輸入 $x$ 也換成正負號。圖上每一格的 $\Delta w$ 是「這一步要把 $w$ 加上多少」（更新量），$\mu$ 是步長；它們就是後面每一個更新式 $w_{n+1}=w_n+\Delta w_n$ 裡的那一項，各節會逐一定義。`,
          )}
        </p>
        <p>
          <strong>讀圖的約定：</strong>
          {tm(
            String.raw`方塊圖用工程慣用的方括號寫時間索引，圖上的 $w[n]$、$e[n]$、$x[n]$ 就是公式裡的 $w_n$、$e_n$、$x_n$（第 $n$ 筆 sample）；每個 block 才更新一次的量寫成 $G_k$、$w_k$。圓形的加法點旁邊，每條進來的線都標了 $+$ 或 $-$；$z^{-1}$ 表示「延遲一步」。上了顏色的方塊是那張圖要你先看的地方。`,
          )}
        </p>
      </Diagram>
      <Callout kind="info" title="本章套用的勘誤">
        <ul className="ch02-try">
          <li>
            <ErrataNote id="E41" /> 成本一律寫成 <Tex>{'J(w)=\\tfrac12E[(y-wx)^2]'}</Tex>（<Tex>{'E[\\cdot]'}</Tex> 是「很多筆的平均」，§2 會正式介紹；<Tex>{'y-wx'}</Tex> 是量到的輸出減掉預測）。沒有 <Tex>{'\\tfrac12'}</Tex> 時梯度大 2 倍，LMS 等於對 <Tex>{'J_2'}</Tex> 用步長 <Tex>{'\\mu/2'}</Tex>。
          </li>
          <li>
            <ErrataNote id="E40" /> <Tex>{'\\operatorname{sign}(0)'}</Tex> 必須明定：數學次梯度模式 <Tex>{'\\operatorname{sign}(0)=0'}</Tex>；comparator 模式 tie 映射到 <Tex>{'\\pm1'}</Tex>。模擬不可依賴 <code>Math.sign(0) = 0</code>，也要注意浮點誤差。
          </li>
          <li>
            <ErrataNote id="E43" /> 規格 §2.3 表格 Sign-Sign 列改為「連 Regressor 幅度也丟掉，別和 Sign-Error 混淆」——本章 §4 進一步證明它的固定點不同。
          </li>
        </ul>
      </Callout>
      <ModeGate min="engineer">
        <p className="ch02-note">
          本章驗證：<TestBadge id="T01" />（對 <Tex>{'\\tfrac12e^2'}</Tex> 做 GD 與 LMS 逐位元相同，並與 golden vector 比對）。其餘數字（limit cycle、固定點、效率比）由 <code>src/simulation/models/sgd.ts</code> 的單元測試把關。
        </p>
      </ModeGate>
    </section>
  )
}
