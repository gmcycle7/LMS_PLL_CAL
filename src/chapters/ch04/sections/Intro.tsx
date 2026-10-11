import { Callout, ClaimTag, ModeGate, Section, SourceTag, SystemMap, Tex, type SystemBlock } from '@/components'
import { CONCEPT_FAST_LOOP, CONCEPT_LMS_LOOP } from '../diagrams'
import { Erratum, FigRef, JumpTo, MermaidFig } from '../common'
import { SymbolsLink } from './Symbols'

const R = String.raw

/**
 * 章首系統地圖要標成藍色的方塊：本章從 FCW 一路走到 gain accumulator 的整條訊號路徑。
 * divider 也標示，因為 §2 的 fractional residue 就是 divider edge 的時間誤差。
 * （模組層級常數：SystemMap 以 focus 的參考當 useMemo 依賴，不要在 render 內重建陣列。）
 */
export const CH04_SYSTEM_FOCUS: SystemBlock[] = ['fcw', 'dsm', 'div', 'res', 'gc', 'dtc', 'pd', 'cmp', 'align', 'gmac', 'scale', 'acc']

/**
 * 系統地圖的圖說。SystemMap 預設的圖說把方塊名稱原樣列出（含 Unicode 拼的 x[n]、Σ q·x、w_k）；
 * 圖說支援 `$...$`，所以這裡改寫成 LaTeX，並說明要從哪裡開始看（docs/teaching-style.md §3、§8）。
 */
export const CH04_SYSTEM_CAPTION = R`系統地圖：藍色是這一課從頭走到尾的訊號路徑（${CH04_SYSTEM_FOCUS.length} 個方塊）。先找到「小數除頻與補償」框裡的 FCW，順著箭頭走：DSM → fractional residue $x[n]$ → gain correction（$\times w$）→ DTC → PD，再沿虛線到「LMS 校正迴路」框：1-bit comparator → GMAC（$\sum q\,x$）→「$\div N$、$\times\mu$」→ gain accumulator $w_k$，最後回到 gain correction。教學用概念架構，不是特定晶片的 netlist。`

const TOC: { id: string; label: string }[] = [
  { id: 'ch04-system', label: '§1 系統全貌' },
  { id: 'ch04-residue', label: '§2 Fractional residue' },
  { id: 'ch04-hardware', label: '§3 硬體對應與時序' },
  { id: 'ch04-gmac', label: '§4 GMAC 數學' },
  { id: 'ch04-fixed', label: '§5 定點 GMAC' },
  { id: 'ch04-notes', label: '§6 RTL 檢查清單' },
  { id: 'ch04-wrap', label: '§7 思考題與本課必記' },
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
            GMAC 是「總和」還是「平均」？差在哪裡？為什麼 RTL 少了一個右移，loop gain 就放大 <Tex>N</Tex> 倍（<Tex>N</Tex> 是每次更新前累加的 sample 數）？（§4）
          </li>
          <li>真的做成 RTL 時，累加器要幾個 bit？右移時要怎麼取整？碰到 rail 怎麼辦？（§5、§6）</li>
        </ol>
        <p>
          入門課的三個動作在這裡對應到硬體：<strong>預測</strong> = DTC 用目前的 gain <Tex>{R`w_k`}</Tex> 插入延遲；
          <strong>比較</strong> = PD / comparator 看殘差的正負號；<strong>修正</strong> = GMAC 把 <Tex>{R`q\cdot x`}</Tex> 累加 <Tex>N</Tex> 次後更新{' '}
          <Tex>{R`w_{k+1}=w_k+\mu G_k`}</Tex>。
        </p>
        <p>
          先把這條式子裡的符號講清楚（後面每一張圖都用同一套）：<Tex>x</Tex> 是送給 DTC 的數位 code（regressor，無因次）；<Tex>w</Tex> 是校正出來的 DTC gain（單位 fs per unit code）；
          <Tex>q</Tex> 是 comparator 的輸出，只有 <Tex>{R`+1`}</Tex> 或 <Tex>{R`-1`}</Tex>；<Tex>{R`G_k`}</Tex> 是一個 block 內 <Tex>{R`q\cdot x`}</Tex> 的平均；<Tex>{R`\mu`}</Tex> 是學習率（每個 block 的更新係數，單位
          fs）。時間索引有兩種：<Tex>n</Tex> 數 comparator 的 <strong>sample</strong>（本章假設一個 reference cycle 一個 sample）；<Tex>k</Tex> 數 GMAC 的 <strong>block</strong>，一個 block 是連續{' '}
          <Tex>N</Tex> 個 sample（<Tex>{R`n=kN,\dots,kN+N-1`}</Tex>）。所以寫成 <Tex>{R`x[n]`}</Tex>、<Tex>{R`q[n]`}</Tex> 的量每個 sample 變一次，帶下標 <Tex>k</Tex> 的量（<Tex>{R`G_k`}</Tex>、<Tex>{R`w_k`}</Tex>）每{' '}
          <Tex>N</Tex> 個 sample 才變一次。
        </p>
        <p>
          下面是全站共用的<strong>系統地圖</strong>。<strong>藍色方塊</strong>就是這一課要從頭走到尾的訊號路徑：FCW → DSM 累加器 → divider 與 fractional residue <Tex>{R`x[n]`}</Tex> → gain correction → DTC → PD →
          1-bit comparator → code alignment → GMAC → 「<Tex>{R`\div N`}</Tex>、<Tex>{R`\times\mu`}</Tex>」→ gain accumulator；沒上色的 reference、loop filter、VCO、quantizer 與雜訊源留給 Ch06、Ch08、Ch12、Ch13。
          這一課新增的是：把每個藍色方塊拆開成 RTL 級的方塊圖，標出每條線上的訊號名稱、位元寬度，以及它是每個 sample 動一次還是每個 block 動一次。
        </p>
        <SystemMap focus={CH04_SYSTEM_FOCUS} caption={CH04_SYSTEM_CAPTION} />
        <nav className="ch04-toc" aria-label="本章段落">
          {TOC.map((t) => (
            <JumpTo key={t.id} target={t.id}>
              {t.label}
            </JumpTo>
          ))}
        </nav>
        <SymbolsLink />
      </Section>

      <Section kind="diagram" title="§1 完整概念系統：DSM → DTC → PD → GMAC → Gain Update" level={2} id="ch04-system">
        <p>
          系統地圖只告訴你「有哪些方塊」。下面兩張圖是同一個架構、但在每個方塊上寫出它算的式子、每條線上寫出訊號名稱——這是規格 §4 的架構參考（教學與 behavioral modeling 用，<strong>不是</strong>特定晶片的 netlist）{' '}
          <SourceTag kind="illustrative" />。 整個架構有 17 個方塊，一張圖放不下還要寫式子，所以拆成兩張：<FigRef chart={CONCEPT_FAST_LOOP} /> 是<strong>快</strong>的部分（主 PLL 迴路 + 小數除頻與 DTC 補償，每個 reference cycle 動一次），
          <FigRef chart={CONCEPT_LMS_LOOP} /> 是<strong>慢</strong>的部分（LMS 校正迴路，每 <Tex>N</Tex> 拍才更新一次）。兩者共用同一個 PD：PD 的輸出一方面推動 loop filter，一方面被 1-bit comparator 取正負號送進 GMAC。
        </p>
        <p>
          <strong>先看 <FigRef chart={CONCEPT_FAST_LOOP} />（怎麼讀這張圖）：</strong>先找到 FCW → DSM：DSM 每一拍吐出兩個東西，進位 <Tex>{R`y[n]`}</Tex>（carry，告訴 divider 這一拍要不要多除 1）和餘數 <Tex>{R`s[n]/M`}</Tex>（<Tex>{R`s[n]`}</Tex> 是留在累加器裡的數字，<Tex>M</Tex> 是累加器的模數；相除之後就是無因次的 code{' '}
          <Tex>{R`x[n]`}</Tex>，§2 詳述）。再看 <Tex>{R`x[n]`}</Tex> 的兩條去路：一條乘上 gain <Tex>{R`w_k`}</Tex> 去控制 DTC（預測），另一條交給藍色的「LMS 校正迴路」方塊；PD 的輸出（虛線）也送進同一個藍色方塊，它回送的只有一個量——gain <Tex>{R`w_k`}</Tex>。
          另外兩個縮寫：BBPD 是 bang-bang PD（輸出只有 1 bit 的相位檢測器）；DTC 方塊裡的 <Tex>{R`d(x)`}</Tex> 是 DTC 的非線性誤差（積分非線性 INL），本章先當作 0，Ch11 才處理。
        </p>
        <MermaidFig
          chart={CONCEPT_FAST_LOOP}
          caption={R`規格 §4 概念系統（一）：快的部分。先看 FCW → DSM 吐出的兩條線（carry $y[n]$ 去 divider、餘數變成 code $x[n]$），再看藍色方塊和快迴路之間只有三條線：進去的是 PD 輸出與 $x[n]$，出來的是 gain $w_k$。`}
          ariaLabel="主 PLL 迴路與小數除頻、DTC 補償的方塊圖，LMS 校正迴路收成一個方塊"
        />
        <p>
          <strong>再看 <FigRef chart={CONCEPT_LMS_LOOP} />（把藍色方塊展開）：</strong>先看 comparator 前的加法點：PD 輸出（相位誤差，單位 fs）加上雜訊 <Tex>{R`v[n]`}</Tex>（RMS 為 <Tex>{R`\sigma_v`}</Tex>）就是 comparator 的輸入 <Tex>{R`e[n]`}</Tex>，被切成一個 bit <Tex>{R`b[n]`}</Tex>、變成 <Tex>{R`q[n]=2b[n]-1`}</Tex>。
          再看 code：<Tex>{R`x[n]`}</Tex> 經過 code alignment 延遲 <Tex>D</Tex> 個 sample 變成 <Tex>{R`x_\mathrm{ref}[n]`}</Tex>（GMAC 實際拿來相乘的、和誤差對齊的 code；圖上的 filtered-x 是進階做法，先把 code 通過一個估計出來的 PLL 誤差路徑再拿來相乘，Ch07 詳述，這一課先看 <Tex>{R`x[n-D]`}</Tex>）。兩者相乘累加成 <Tex>{R`S_k`}</Tex>，除以 <Tex>N</Tex>、乘 <Tex>{R`\mu`}</Tex>，加進 gain accumulator，再回到 gain correction 與 DTC——迴路在這裡閉合。
        </p>
        <MermaidFig
          chart={CONCEPT_LMS_LOOP}
          caption={R`規格 §4 概念系統（二）：慢的部分（標籤依勘誤修正：$S_k$ 為總和、$G_k$ 為平均、$q=2b-1$、code 對齊延遲為 $D$）。先看 comparator 前的加法點（PD 輸出 $+\,v[n]$），再看 $q[n]$ 與 $x_\mathrm{ref}[n]$ 在 GMAC 相遇，最後順著 $\div N$、$\times\mu$ 走回 $w_k$。`}
          ariaLabel="LMS 校正迴路的方塊圖：雜訊注入、comparator、GMAC、正規化與學習率、gain accumulator"
        />
        <p>
          圖上的對應：<FigRef chart={CONCEPT_LMS_LOOP} /> 最後一格「Gain accumulator」寫的 <Tex>{R`w_{k+1}=w_k+\mu G_k`}</Tex> 就是入門課的更新式；「GMAC」那一格的 <Tex>{R`S_k=\sum q[n]\,x_\mathrm{ref}[n]`}</Tex> 與下一格的{' '}
          <Tex>{R`G_k=S_k/N`}</Tex> 是 §4 的 F-04.3；兩張圖裡 DTC 那一格的 <Tex>{R`w_k\,x[n]`}</Tex> 是 §2 的主題。後面每一節都是把這兩張圖的某一塊放大來看。
        </p>
        <Callout kind="info" title="圖上和規格書原圖不同的地方">
          <ul>
            <li>
              原圖 GMAC 方塊寫「sum q times aligned code」、下一格寫「Average + Learning Rate」，但 §0 又把 <Tex>{R`G_k`}</Tex> 定義成平均。
              本站把總和寫成 <Tex>{R`S_k`}</Tex>、平均寫成 <Tex>{R`G_k=S_k/N`}</Tex> <Erratum id="E07" /> <Erratum id="E18" />，因為兩者差 <Tex>N</Tex> 倍 loop gain（§4）。
            </li>
            <li>
              comparator 方塊明確寫出 <Tex>{R`b[n]=(e\ge0)`}</Tex> 與 <Tex>{R`q=2b-1`}</Tex>：硬體輸出的位元 <Tex>b</Tex> 是 0/1，GMAC 需要的 <Tex>q</Tex> 是 <Tex>{R`\pm1`}</Tex> <Erratum id="E07" />。
            </li>
            <li>
              DTC 方塊寫成 <Tex>{R`w_k\,x[n]+d(x)`}</Tex>：<Tex>x</Tex> 是無因次 code，時間單位（fs）由 gain <Tex>w</Tex> 承載 <Erratum id="E13" />；<Tex>d(x)</Tex> 是可開關的 DTC 非線性（Ch11）。
            </li>
            <li>加上 noise 注入點 <Tex>{R`v[n]`}</Tex>（規格 §4 要求）。</li>
          </ul>
        </Callout>
        <ModeGate min="engineer">
          <p className="small">
            <ClaimTag kind="approx" /> 「<Tex>{R`e_\mathrm{PD}=e_\mathrm{PLL}+\delta\,x`}</Tex>」（主迴路殘差，加上 DTC gain 誤差 <Tex>{R`\delta=a-w`}</Tex> 乘 code；<Tex>a</Tex> 是真正需要的 gain，§2）這個線性疊加只在 PD 線性範圍內成立；BBPD 本身就是 1-bit
            comparator 時，主 PLL 的 integral path 會強制 <Tex>{R`E[q]=0`}</Tex>（<Tex>q</Tex> 的長期平均為 0；期望值 <Tex>{R`E[\cdot]`}</Tex> 的說明框在 §3），offset 與 code 的 DC 會被吸收（勘誤 E03，見 Ch11）。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
