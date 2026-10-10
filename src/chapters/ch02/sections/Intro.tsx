import { Callout, ModeGate, SymbolTable, Tex, TestBadge, type SymbolEntry } from '@/components'
import { ChapterLink, ErrataNote, tm } from '../common'

const SYMBOLS: SymbolEntry[] = [
  { symbol: 'a', meaning: '真實（未知）係數；校正時就是理想 DTC gain 等', unit: '[y]/[x]', firstSeen: '§1' },
  { symbol: 'w_n', meaning: tm('第 $n$ 筆資料時的係數估計（我們能改的旋鈕）'), unit: '[a]', firstSeen: '§1' },
  { symbol: 'x_n,\\;y_n', meaning: tm('第 $n$ 筆輸入（regressor）與量測輸出'), unit: '[x],\\ [y]', firstSeen: '§1' },
  { symbol: 'v_n,\\;\\sigma_v', meaning: tm('量測雜訊與它的標準差（形狀可為 Gaussian / Laplacian / impulsive / skewed，四種都正規化成同一個 $\\sigma_v$，見 §3 的雜訊形狀表）'), unit: '[y]', firstSeen: '§2' },
  { symbol: 'e_n=y_n-w_nx_n', meaning: '預測誤差（comparator 之前的訊號）', unit: '[y]', firstSeen: '§1' },
  { symbol: '\\delta_n=a-w_n', meaning: '參數誤差', unit: '[a]', firstSeen: '§1', note: tm('全站極性 $\\delta=a-w$（規格 §3 曾寫 $w-a$，勘誤 E39）') },
  { symbol: 'd=a-w', meaning: tm('同 $\\delta$，但在期望值裡當作固定的數（mean-field 推導用）'), unit: '[a]', firstSeen: '§3', note: tm('與 Ch08 的 update delay $d$ 無關') },
  { symbol: 'J(w)=\\tfrac12E[e^2]', meaning: '平均成本（MSE 的一半）', unit: '[y]^2', firstSeen: '§1', note: <>本章採含 <Tex>{'\\tfrac12'}</Tex> 的定義 <ErrataNote id="E41" /></> },
  { symbol: "J'(w),\\;J''(w)", meaning: tm('成本對 $w$ 的一階、二階導數（切線斜率、彎曲程度）'), firstSeen: '§1' },
  { symbol: 'p=1-\\mu K', meaning: tm("pole：每一步參數誤差縮小的倍率，$\\delta_{n+1}=p\\,\\delta_n$；§1 的 $K=J''$"), unit: '1', firstSeen: '§1', note: tm('收斂需 $|p|<1$（四種行為見 Ch03）') },
  {
    symbol: '\\mu,\\;\\mu_n',
    meaning: tm('步長（learning rate）；$\\mu_n$ 為第 $n$ 步的步長（排程）'),
    firstSeen: '§1',
    note: tm('單位依演算法：LMS $1/[x]^2$；Sign-Error $[w]/[x]$；Sign-Sign $[w]$'),
  },
  { symbol: '\\mu_0,\\;n_0', meaning: tm('遞減步長 $\\mu_n=\\mu_0/(1+n/n_0)$ 的初值與時間常數'), unit: '[\\mu],\\ \\text{samples}', firstSeen: '§3' },
  { symbol: '\\hat g_n', meaning: tm('單筆隨機梯度（stochastic gradient）$-e_nx_n$'), firstSeen: '§2' },
  { symbol: 'N,\\;B', meaning: tm('資料筆數與 mini-batch 大小（每累加 $B$ 筆更新一次）'), unit: '\\text{samples}', firstSeen: '§2', note: tm('GMAC 的 block 長度 $N$ 就是 $B$；Ch11 的 $B$（bias 項）與此無關') },
  { symbol: 'E[\\cdot]', meaning: '期望值：「做很多次再平均」的極限', firstSeen: '§2' },
  { symbol: 'P_x=E[x^2]', meaning: '輸入功率', unit: '[x]^2', firstSeen: '§2' },
  {
    symbol: '\\operatorname{sign}(\\cdot)',
    meaning: tm('正負號；$\\operatorname{sign}(0)$ 的慣例必須明定'),
    firstSeen: '§3',
    note: <>{tm('數學 $0$ 或 comparator $\\pm1$')} <ErrataNote id="E40" /></>,
  },
  { symbol: 'h=\\mu|x|', meaning: 'Sign-Error 每步固定的移動量（limit-cycle 帶寬）', unit: '[a]', firstSeen: '§3', note: tm('與 Part B 的 error-path 脈衝響應 $h[n]$（$u=h*x$）無關') },
  {
    symbol: 'n_c,\\;\\rho',
    meaning: tm('Sign-Error 進入 limit cycle 前走的整步數 $n_c=\\lfloor|\\delta_0|/h\\rfloor$ 與剩下不到一步的距離 $\\rho=|\\delta_0|-n_ch$'),
    unit: '\\text{samples},\\ [a]',
    firstSeen: '§3',
    note: tm('不寫成 $k$、$r$：$k$ 是 GMAC block 索引，$r$ 留給 §4 的比值 $y/x$'),
  },
  { symbol: '\\psi(w)', meaning: tm('平均更新方向 $E[\\Delta w]/\\mu$（mean-field drift）；固定點 $\\psi(w^*)=0$'), firstSeen: '§3' },
  { symbol: 'w^*', meaning: tm('固定點（平均更新為零的 $w$）；不同演算法一般不同'), unit: '[a]', firstSeen: '§3' },
  { symbol: 'F_v,\\;f_v', meaning: '雜訊的累積分布函數（CDF）與機率密度（PDF）', unit: '1,\\ 1/[y]', firstSeen: '§3' },
  { symbol: 'K_q', meaning: tm('1-bit comparator 的統計小訊號增益 $\\sqrt{2/\\pi}/\\sigma_v$（Gaussian 雜訊）'), unit: '1/[y]', firstSeen: '§3', note: 'Ch05 詳細推導' },
  {
    symbol: 'K',
    meaning: tm("線性化斜率 $K=-\\psi'(w^*)$（每單位步長的 loop gain）"),
    firstSeen: '§3',
    note: tm('LMS：$K=E[x^2]$；Gaussian 雜訊的 Sign-Error：$K=K_qE[x^2]$（Ch05）'),
  },
  { symbol: 'g=\\mu K,\\;\\tau', meaning: tm('正規化 loop gain 與時間常數 $\\tau=-1/\\ln|1-\\mu K|\\approx1/g$'), unit: '1,\\ \\text{samples}', firstSeen: '§5' },
  { symbol: '\\sigma_\\eta^2', meaning: tm('梯度雜訊變異（單步更新方向在 $w^*$ 處的變異）'), firstSeen: '§5' },
  { symbol: 'r_n=y_n/x_n', meaning: '單筆「比值」估計；四種演算法的固定點都是它的加權平均／中位數', unit: '[a]', firstSeen: '§4' },
  { symbol: '\\tilde\\mu,\\;\\varepsilon', meaning: 'NLMS 的無因次步長與正規化常數', unit: '1,\\ [x]^2', firstSeen: '§5', note: tm('Ch01 用 $\\varepsilon$ 表示 outlier 機率；本章 $\\varepsilon$ 只給 NLMS') },
  {
    symbol: 'p_{\\rm out},\\;s',
    meaning: tm('單邊 outlier：每筆以機率 $p_{\\rm out}$ 在雜訊上加一個固定的 $s$'),
    unit: '1,\\ [y]',
    firstSeen: '§4',
    note: tm('下標 out 用來與 pole $p$ 區分（Ch01 寫作 $\\varepsilon,\\ s$）'),
  },
  {
    symbol: '\\psi_{\\rm H}(e),\\;\\delta_{\\rm H}',
    meaning: tm('Huber 的截斷函數 $\\psi_{\\rm H}(e)=\\max(-\\delta_{\\rm H},\\min(e,\\delta_{\\rm H}))$ 與門檻'),
    unit: '[y]',
    firstSeen: '§5',
    note: tm('下標 H 用來與漂移函數 $\\psi(w)$、參數誤差 $\\delta_n$ 區分（lms.ts 的程式註解寫作 $\\psi_\\delta$）'),
  },
]

export function Intro() {
  return (
    <section>
      <div className="ch02-question">
        <strong>這一課要回答的問題：</strong>你被矇住眼睛站在山坡上，只能用腳感覺「腳下的坡度」。要怎麼一步一步走到谷底？
        如果每一步只能看<strong>一筆</strong>資料、甚至只能知道誤差的<strong>正負號</strong>（硬體只有一顆 1-bit comparator），還走得到嗎？會停在哪裡？
      </div>
      <p>
        上一章（<ChapterLink ch="01">Ch01</ChapterLink>）說明了「平方誤差」與「絕對誤差」是兩種不同的目標。這一章把它們變成可以一步一步執行的演算法，
        並回答三個工程問題：(1) 為什麼往 <Tex>{"-J'(w)"}</Tex> 走會下降、步長能多大；(2) 為什麼只用一筆資料的梯度也行（LMS = SGD）；
        (3) 只有 sign 的 Sign-Error 與 Sign-Sign 會收斂到<strong>哪裡</strong>、會不會停下來。
      </p>
      <ol className="ch02-roadmap">
        <li>§1 從切線斜率到 Gradient Descent（泰勒展開、步長上限、Newton 步）</li>
        <li>§2 Batch GD vs Stochastic GD：單筆梯度是不偏估計 ⇒ LMS 就是 SGD</li>
        <li>§3 MAE ⇒ Sign-Error LMS：次梯度、<Tex>{'\\operatorname{sign}(0)'}</Tex> 慣例、limit cycle、遞減步長</li>
        <li>§4 Sign-Sign LMS 是另一個演算法：固定點條件不同、偏斜雜訊反例</li>
        <li>§5 大比較表、四種演算法的核心程式碼、精度效率、NLMS 預告、主實驗</li>
        <li>§6 連到 PLL：comparator、GMAC 與 conditional negation；思考題與本課必記</li>
      </ol>
      <SymbolTable rows={SYMBOLS} caption={tm('時間索引 $n$ 為 sample（comparator 取樣）；Part B 的 GMAC block 用 $k$。單位欄的 $[x]$、$[y]$、$[a]=[y]/[x]$ 表示「與該量同單位」：校正時 $[y]$ 是時間誤差（fs），$[x]$ 是正規化 code（無因次）。')} />
      <Callout kind="info" title="本章套用的勘誤">
        <ul className="ch02-try">
          <li>
            <ErrataNote id="E41" /> 成本一律寫成 <Tex>{'J(w)=\\tfrac12E[(y-wx)^2]'}</Tex>。沒有 <Tex>{'\\tfrac12'}</Tex> 時梯度大 2 倍，LMS 等於對 <Tex>{'J_2'}</Tex> 用步長 <Tex>{'\\mu/2'}</Tex>。
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
