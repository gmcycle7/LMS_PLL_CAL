import { Callout, ClaimTag, ModeGate, Section, SourceTag, SymbolTable, Tex, type SymbolEntry } from '@/components'
import { CONCEPT_SYSTEM } from '../diagrams'
import { Erratum, MermaidFig, mt } from '../common'

const R = String.raw

export const CH04_SYMBOLS: SymbolEntry[] = [
  { symbol: 'n', meaning: mt(R`comparator sample 索引（本章假設一個 reference cycle 一個 sample，$f_s=f_\mathrm{ref}$）`), firstSeen: '§1', note: mt(R`全站約定：$n$ = sample、$k$ = block`) },
  { symbol: 'k', meaning: mt(R`GMAC block 索引（第 $k$ 個 block 含 sample $n=kN,\dots,kN+N-1$）`), firstSeen: '§1' },
  { symbol: 'N', meaning: '每個 block 累加的 sample 數（GMAC 累加長度）', unit: R`\text{samples}`, firstSeen: '§1' },
  { symbol: R`f_s,\;f_u=f_s/N`, meaning: 'comparator 取樣率、校正更新率（block rate）', unit: R`\mathrm{Hz}`, firstSeen: '§3' },
  { symbol: R`\mathrm{frac},\;K_\mathrm{F}`, meaning: mt(R`FCW 的小數部分；累加器每拍加入的整數字 $K_\mathrm{F}$，$\mathrm{frac}=K_\mathrm{F}/M$`), firstSeen: '§2' },
  { symbol: R`M=2^{B_\mathrm{dsm}}`, meaning: mt(R`DSM 累加器的模數（$B_\mathrm{dsm}$ 位元）`), firstSeen: '§2' },
  { symbol: R`s[n],\;t[n]`, meaning: mt(R`DSM 累加器內容（整數 $0,\dots,M-1$）＝ DTC 要用的 code；$t[n]=s[n-1]+K_\mathrm{F}$ 是取模前的加法器輸出`), unit: R`\text{LSB}`, firstSeen: '§2' },
  { symbol: 'y[n]', meaning: '累加器 carry（divider 這一拍多除 1 個 VCO 週期）', unit: R`\{0,1\}`, firstSeen: '§2' },
  { symbol: 'r[n]', meaning: 'divider edge 的累積時間誤差（fractional residue），正 = 晚到', unit: R`T_\mathrm{vco}`, firstSeen: '§2', note: '與 dsm.ts 的 residue 相同' },
  { symbol: R`T_\mathrm{vco}`, meaning: mt(R`VCO 週期 $1/f_\mathrm{vco}$`), unit: R`\mathrm{fs}`, firstSeen: '§2' },
  { symbol: R`\varepsilon`, meaning: mt(R`DTC gain 的相對誤差 $(a-w)/a$（residue 實驗的控制項）`), unit: R`\%`, firstSeen: '§2' },
  { symbol: 'x[n]', meaning: mt(R`正規化後的 code / regressor（本章多用 $s[n]/M$ 或 $x_\mathrm{int}/2^{B_x-1}$）`), unit: R`\text{無因次}`, firstSeen: '§2', note: <><Erratum id="E13" />{mt(R`：$x$、$u$ 無因次，時間單位由 $a$、$w$ 承載`)}</> },
  { symbol: R`a,\;w_k`, meaning: mt(R`真實需要的 DTC gain、第 $k$ 個 block 使用的校正 gain`), unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§2', note: <Erratum id="E13" /> },
  { symbol: R`\delta_k=a-w_k`, meaning: '剩餘 gain 誤差', unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§2', note: <>{mt(R`全站約定 $\delta=a-w$ `)}<Erratum id="E32" /> <Erratum id="E39" /></> },
  { symbol: R`H_\mathrm{PD},\;u[n]=(h*x)[n]`, meaning: 'DTC 誤差到 PD 的轉移函數、有效 regressor', unit: R`\text{同 }x`, firstSeen: '§3', note: <Erratum id="E13" /> },
  { symbol: R`v[n],\;\sigma_v`, meaning: 'comparator 前雜訊與其 RMS', unit: R`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: R`b_\mathrm{off}`, meaning: 'comparator offset（只在系統圖 C 與一圈推導出現；Ch11 詳述）', unit: R`\mathrm{fs}`, firstSeen: '§3', note: <>{mt(R`規格 §11 寫 $b$；本章改名 $b_\mathrm{off}$，避免與 comparator 位元 $b[n]$ 衝突（同 `)}<Erratum id="E34" />{mt(R` 的符號去衝突原則）`)}</> },
  { symbol: 'e[n]', meaning: mt(R`comparator 前的 PD 誤差 $e=\delta\,u+b_\mathrm{off}+v$`), unit: R`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: 'b[n]', meaning: mt(R`comparator 原始輸出位元，$b=1\Leftrightarrow e\ge0$`), unit: R`\{0,1\}`, firstSeen: '§4', note: <><Erratum id="E07" />{mt(R`：tie（$e=0$）判 $+1$`)}</> },
  { symbol: 'q[n]=2b[n]-1', meaning: '雙極性 comparator 輸出', unit: R`\{-1,+1\}`, firstSeen: '§4' },
  { symbol: R`x_\mathrm{ref}[n]`, meaning: mt(R`GMAC 實際相乘的對齊 code：$x[n-D]$ 或 filtered-x $u_f[n-D]$`), firstSeen: '§3' },
  { symbol: 'D', meaning: 'code 對齊延遲', unit: R`\text{samples}`, firstSeen: '§3', note: <><Erratum id="E34" />{mt(R`：§16.1 原寫 $d$，與更新延遲 $d$ 衝突`)}</> },
  { symbol: R`d,\;d_\mathrm{f}`, meaning: mt(R`更新延遲（block 結束到新 gain 生效）的整數部分與分數部分；commit 在 block 中途生效時 $d_\mathrm{f}=(P_c\bmod N)/N$`), unit: R`\text{blocks}`, firstSeen: '§3', note: mt(R`分數延遲不寫 $\varphi$：$\varphi(z)$ 保留給 Gaussian 密度`) },
  { symbol: R`P_c`, meaning: 'commit pipeline：block 結束到新 gain 寫入 register 的 sample 數', unit: R`\text{samples}`, firstSeen: '§3' },
  { symbol: R`g_\mathrm{crit}`, meaning: mt(R`平均模型由穩定變成不穩定的臨界 loop gain（$d=0$ 時為 2）`), firstSeen: '§3' },
  { symbol: R`\Phi(z),\;\varphi(z)`, meaning: '標準 Gaussian 的累積分布函數與機率密度', firstSeen: '§3' },
  { symbol: 'S_k', meaning: mt(R`GMAC 總和 $\sum q\,x_\mathrm{ref}$（sum）`), firstSeen: '§4', note: <><Erratum id="E07" /> <Erratum id="E18" />：總和用 <Tex>S</Tex></> },
  { symbol: R`G_k=S_k/N`, meaning: 'GMAC 平均（average，§0 定義）', firstSeen: '§4' },
  { symbol: R`m_q=E[q]`, meaning: mt(R`comparator 雙極性輸出的平均（$x\equiv1$ 時 $E[G]=m_q$）`), firstSeen: '§4', note: <><Erratum id="E34" />{mt(R`：規格 §5 寫 $m$`)}</> },
  { symbol: R`\mu`, meaning: '學習率（每個 block 的更新係數）', unit: R`\mathrm{fs}`, firstSeen: '§4', note: <><Erratum id="E13" />：average 模式下單位為 fs</> },
  { symbol: R`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號增益', unit: R`\mathrm{fs}^{-1}`, firstSeen: '§4' },
  { symbol: R`C=E[x_\mathrm{ref}u]`, meaning: 'regressor 與有效 regressor 的相關', unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`K=K_qC`, meaning: mt(R`GMAC 對 $\delta$ 的平均斜率 $-\partial E[G]/\partial w$`), unit: R`\mathrm{fs}^{-1}`, firstSeen: '§4', note: <Erratum id="E13" /> },
  { symbol: R`g,\;p=1-g`, meaning: mt(R`無因次 loop gain（average：$\mu K$；sum：$N\mu K$）與平均 pole`), firstSeen: '§4' },
  { symbol: R`m_x,\;\sigma_x`, meaning: mt(R`code 的平均 $E[x]$ 與標準差（$E[x^2]=m_x^2+\sigma_x^2$）`), unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`\xi=\delta/\sigma_v`, meaning: mt(R`正規化的 gain 誤差（忘了映射時的固定點 $\xi^*$ 只和 code 分布有關，F-04.16）`), unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`B_x,\;x_\mathrm{int}`, meaning: 'code 位元數、有號整數 code', unit: R`\text{bits},\;\text{LSB}`, firstSeen: '§5' },
  { symbol: R`B_\mathrm{acc},\;M_x`, meaning: mt(R`GMAC 累加器（有號）位元數；單筆乘積的最大絕對值 $M_x=\max|q\,x_\mathrm{int}|$`), unit: R`\text{bits},\;\text{LSB}`, firstSeen: '§5' },
  { symbol: R`F_G,\;\ell=\log_2N-F_G`, meaning: '右移後保留的小數位元、實際右移量', unit: R`\text{bits}`, firstSeen: '§5' },
  { symbol: R`\Delta_G`, meaning: mt(R`正規化 $G$ 的 LSB $=2^{-F_G}/2^{B_x-1}$`), firstSeen: '§5' },
  { symbol: R`\rho,\;\bar\varepsilon`, meaning: mt(R`右移丟掉的餘數 $\rho=S\bmod2^\ell$；rounding 的平均誤差 $\bar\varepsilon$（單位：輸出 LSB）`), firstSeen: '§5' },
  { symbol: R`\chi(s)`, meaning: mt(R`floor 取整的平衡點附近的回復斜率（$s$ = 取整前雜訊的標準差除以取整後的 LSB；1 = 和沒有取整一樣，0 = dead zone）`), firstSeen: '§5' },
  { symbol: R`\Delta_W,\;R,\;\bar\varepsilon_W`, meaning: mt(R`$W$ 的 LSB；$R=\Delta_W/(\mu\Delta_G)$：$W$ 的格點比更新量的格點粗幾倍；更新量取整到 $\Delta_W$ 的平均誤差`), unit: R`\mathrm{fs}/\text{unit code},\;\text{—},\;\Delta_W`, firstSeen: '§5' },
  { symbol: R`p_\mathrm{min}`, meaning: mt(R`最負 code $-2^{B_x-1}$ 出現的機率（條件取負 bug 的偏差來源）`), firstSeen: '§5' },
  { symbol: R`W,\;w_\mathrm{min},\;w_\mathrm{max}`, meaning: '高解析 gain accumulator、DTC 可實現的 gain 範圍（rail）', unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§5' },
]

export function IntroSection() {
  return (
    <>
      <Section kind="intuition" title="這一課要回答的問題" level={2} id="ch04-question">
        <p>
          前三章我們把 LMS 當成黑盒子：給 <Tex>x</Tex>、看誤差、修正 <Tex>w</Tex>。真正的 Fractional-N PLL 裡，這三個動作分散在好幾個硬體方塊、
          好幾個 clock domain 裡。這一課回答：
        </p>
        <ol>
          <li>
            DTC 到底要補償什麼？為什麼那個量剛好是 DSM 累加器裡的數字？（§2）
          </li>
          <li>PD 那邊只有一串 0/1，怎麼一路變成「DTC gain 該加還是該減」？（§3、§4）</li>
          <li>
            GMAC 是「總和」還是「平均」？差在哪裡？為什麼 RTL 少了一個右移，loop gain 就放大 <Tex>N</Tex> 倍？（§4）
          </li>
          <li>真的做成 RTL 時，累加器要幾個 bit？右移時要怎麼取整？碰到 rail 怎麼辦？（§5、§6）</li>
        </ol>
        <p>
          入門課的三個動作在這裡對應到硬體：<strong>預測</strong> = DTC 用目前的 gain <Tex>{R`w_k`}</Tex> 插入延遲；
          <strong>比較</strong> = PD / comparator 看殘差的正負號；<strong>修正</strong> = GMAC 把 <Tex>{R`q\cdot x`}</Tex> 累加 <Tex>N</Tex> 次後更新{' '}
          <Tex>{R`w_{k+1}=w_k+\mu G_k`}</Tex>。
        </p>
        <nav className="ch04-toc" aria-label="本章段落">
          <a href="#ch04-system">§1 系統全貌</a>
          <a href="#ch04-residue">§2 Fractional residue</a>
          <a href="#ch04-hardware">§3 硬體對應與時序</a>
          <a href="#ch04-gmac">§4 GMAC 數學</a>
          <a href="#ch04-fixed">§5 定點 GMAC</a>
          <a href="#ch04-notes">§6 RTL 檢查清單</a>
          <a href="#ch04-wrap">§7 思考題與本課必記</a>
        </nav>
      </Section>

      <SymbolTable
        rows={CH04_SYMBOLS}
        caption={
          <>
            本章採用全站約定（規格 §0）與 docs/validation.md 的勘誤版本：<Erratum id="E07" /> <Erratum id="E13" /> <Erratum id="E18" />。
          </>
        }
      />

      <Section kind="diagram" title="§1 完整概念系統：DSM → DTC → PD → GMAC → Gain Update" level={2} id="ch04-system">
        <p>
          下圖是規格 §4 的架構參考（教學與 behavioral modeling 用，<strong>不是</strong>特定晶片的 netlist） <SourceTag kind="illustrative" />。
          上半部是每個 reference cycle 都在動的<strong>主 PLL 迴路</strong>；下半部是每 <Tex>N</Tex> 個 sample 才更新一次的<strong>LMS 慢迴路</strong>。
          兩者共用同一個 PD：PD 的輸出一方面推動 loop filter，一方面被 1-bit comparator 取正負號送進 GMAC。
        </p>
        <MermaidFig
          chart={CONCEPT_SYSTEM}
          caption={R`規格 §4 概念系統（標籤依勘誤修正：$S_k$ 為總和、$G_k$ 為平均、$q=2b-1$、code 對齊延遲為 $D$）`}
          ariaLabel="DSM、DTC、PD、GMAC、gain update 的方塊圖"
        />
        <Callout kind="info" title="圖上和規格書原圖不同的地方">
          <ul>
            <li>
              原圖 GMAC 方塊寫「sum q times aligned code」、下一格寫「Average + Learning Rate」，但 §0 又把 <Tex>{R`G_k`}</Tex> 定義成平均。
              本站把總和寫成 <Tex>{R`S_k`}</Tex>、平均寫成 <Tex>{R`G_k=S_k/N`}</Tex> <Erratum id="E07" /> <Erratum id="E18" />，因為兩者差 <Tex>N</Tex> 倍 loop gain（§4）。
            </li>
            <li>
              comparator 方塊明確寫出 <Tex>{R`b[n]=(e\ge0)`}</Tex> 與 <Tex>{R`q=2b-1`}</Tex>：硬體輸出 0/1，GMAC 需要 <Tex>{R`\pm1`}</Tex> <Erratum id="E07" />。
            </li>
            <li>
              DTC 方塊寫成 <Tex>{R`w_k\,x[n]+d(x)`}</Tex>：<Tex>x</Tex> 是無因次 code，時間單位（fs）由 gain <Tex>w</Tex> 承載 <Erratum id="E13" />；<Tex>d(x)</Tex> 是可開關的 DTC 非線性（Ch11）。
            </li>
            <li>加上 noise 注入點 <Tex>{R`v[n]`}</Tex>（規格 §4 要求）。</li>
          </ul>
        </Callout>
        <ModeGate min="engineer">
          <p className="small">
            <ClaimTag kind="approx" /> 「<Tex>{R`e_\mathrm{PD}=e_\mathrm{PLL}+\delta\,x`}</Tex>」（主迴路殘差加上 DTC gain 誤差乘 code）這個線性疊加只在 PD 線性範圍內成立；BBPD 本身就是 1-bit
            comparator 時，主 PLL 的 integral path 會強制 <Tex>{R`E[q]=0`}</Tex>，offset 與 code 的 DC 會被吸收（勘誤 E03，見 Ch11）。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
