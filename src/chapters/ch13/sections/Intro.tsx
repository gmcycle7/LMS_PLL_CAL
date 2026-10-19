import { useMemo, type ReactNode } from 'react'
import { Callout, ClaimTag, Mermaid, ModeGate, Prereq, Section, SourceTag, StepDerivation, SystemMap, Tex, TexBlock, ChRef, ChapterErratum } from '@/components'
import { makeGrid, quantize, makeCtx } from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, LSB_FS_EXAMPLE, fx, n, tx } from '../common'
import { CHART_ERROR_PATH, CHART_SIGNAL_FLOW, SYSTEM_MAP_FOCUS } from '../diagrams'

/** @param afterMap 接在系統地圖那一節之後的內容（index.tsx 把標籤列放在這裡） */
export function Intro({ afterMap }: { afterMap?: ReactNode } = {}) {
  const nums = useMemo(() => {
    const grid = makeGrid(32.4, 'rational', 0)
    const ctx = makeCtx(DEFAULT_LAB_PARAMS, grid, 'freeze', 1)
    const code = quantize(grid.W0, { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }, ctx)
    // 第 12 章 T13 例子（μ = 10 fs、σ_v = 100 fs、N = 4096、C = 1）的係數雜訊，換算成本章的 LSB
    const K = Math.sqrt(2 / Math.PI) / 100
    const mu = 10
    const pcal = 1 - mu * K
    const sigmaWFs = mu / Math.sqrt(4096 * (1 - pcal * pcal))
    return { code, wFs: 32.4 * LSB_FS_EXAMPLE, errFs: (code - 32.4) * LSB_FS_EXAMPLE, sigmaWFs, sigmaWLsb: sigmaWFs / LSB_FS_EXAMPLE, pcal }
  }, [])

  return (
    <>
      <Section kind="intuition" title="這次我們要回答的問題" level={2} id="ch13-question">
        <p>
          前面幾章的 LMS 告訴我們最佳 DTC gain 是 <Tex>{String.raw`w^*=32.4\,\mathrm{LSB}`}</Tex>。可是晶片上真正控制 DTC
          的 gain register 只有 <strong>6 bit</strong>，只能放整數 <Tex>{String.raw`0,1,\dots,63`}</Tex>。那 0.4 怎麼辦？
        </p>
        <ul>
          <li>放 32，接受一點點誤差？（方法 A：Freeze）</li>
          <li>在 32 和 33 之間輪流切換，讓「平均」剛好是 32.4？（方法 B：Toggle、方法 C：隨機切換）</li>
          <li>像 Fractional-N 的 DSM 一樣，用一個高解析度 accumulator 記住「欠下的 0.4」，下次補回來？（方法 D：ΔΣ、E：ΔΣ + dither）</li>
        </ul>
        <p>
          本章的答案是：<strong>平均正確不等於頻譜理想</strong>。五種方法的總誤差功率可能一模一樣，差別只在誤差能量落在哪個頻率——而
          DSM residue（小數除頻留下的餘數碼 <Tex>{'x[n]'}</Tex>，也就是 reference 端 DTC 的 code）與 PLL 的 <Tex>{'T(f)'}</Tex>（從 DTC 誤差到 PLL 輸出的 closed-loop 轉移函數，low-pass）會決定哪個頻率最傷。對常數目標 32.4，一階 ΔΣ 甚至與「固定週期切換」落入<strong>同一個</strong>週期 5 循環（floor
          版逐點相同、round-half-up 版只差循環移位；<ChapterErratum id="E15" />）。
        </p>
        <SourceTag kind="illustrative" />
      </Section>

      <Section kind="diagram" title="系統地圖：本章在整個校正系統的哪裡？" id="ch13-map">
        <SystemMap focus={SYSTEM_MAP_FOCUS} />
        <p className="c-map-note">
          藍色的三塊是本章的主角：<strong>Gain accumulator</strong>（LMS 算出來的高解析係數）、<strong>Quantizer</strong>（把它放進有限個 bit）與 <strong>Gain correction</strong>（把量化後的係數乘上
          residue，得到 reference 端 DTC 的補償量）；前面幾章都把 Quantizer 當成一條直通的線，本章加上的就是這一塊，以及它造成的誤差怎麼沿著 Gain correction → reference 端的 DTC → PD → 主 PLL 迴路走到輸出。
        </p>
      </Section>
      {afterMap}

      <Section kind="diagram" title={<>訊號流：高解析 <Tex>{'w_H'}</Tex> <Tex>{String.raw`\to`}</Tex> 6-bit code <Tex>{String.raw`\to`}</Tex> DTC</>} id="ch13-diagram">
        <p>
          把系統地圖上藍色的三塊（Gain accumulator → Quantizer → Gain correction）放大。三個名字先記住：<Tex>{'w_H[n]'}</Tex> 是 LMS accumulator 裡的<strong>高解析係數</strong>（有小數 bit；LMS 收斂、不再變動時 <Tex>{String.raw`w_H=w^*`}</Tex>）；
          <Tex>{'y[n]'}</Tex> 是真正寫進 gain register 的<strong>整數 code</strong>，只能是 <Tex>{String.raw`0,1,\dots,2^B-1`}</Tex>（<Tex>{'B=6'}</Tex> 是位元數，所以最大 63）；
          <Tex>{'x[n]'}</Tex> 是 DSM residue。
        </p>
        <Mermaid
          chart={CHART_SIGNAL_FLOW}
          caption="6-bit gain code 的訊號流。先看藍色方塊：五種策略都是「高解析 $w_H$ 進、整數 $y$ 出」的同一個位置；再看 PD：從上面進來的是 reference 端的 DTC，從下面繞回來的是回授路徑的 divider，PD 的輸出 $e_{\mathrm{PD}}$ 分兩路，一路去 loop filter、一路給 comparator；最後看虛線：code 誤差乘上 $x$ 之後才到 PLL 輸出。"
          ariaLabel="GMAC 平均進入 LMS accumulator，經量化策略成為 6-bit gain register，再與 DSM residue 一起經 Gain correction 控制 reference 端的 DTC；reference clock 經 DTC 進 PD，PD 的輸出同時送給 loop filter 與 1-bit comparator；loop filter 與 VCO 的輸出只經 divider 回到 PD，回授路徑上沒有 DTC；comparator 經 GMAC 回到 accumulator；code 誤差乘上 DSM residue 後經 PLL 到輸出"
        />
        <p className="small ch13-figwalk">
          先看由上往下的主幹：GMAC 平均 <Tex>{'G_k'}</Tex>（<ChRef ch="04">第 4 章</ChRef>：一個 block 內 comparator 輸出乘上 code 的平均）更新 accumulator <Tex>{String.raw`\to`}</Tex> 藍色的量化策略 <Tex>{String.raw`\to`}</Tex> 6-bit register{' '}
          <Tex>{String.raw`\to`}</Tex> Gain correction（乘上 DSM residue <Tex>{'x[n]'}</Tex>，得到<strong>補償量</strong> <Tex>{String.raw`\Delta_\mathrm{LSB}\cdot y\cdot x[n]`}</Tex>）<Tex>{String.raw`\to`}</Tex> reference 端的 DTC。再看圖的下半：reference clock 經 DTC 才進 PD；PD 下面那一圈是主 PLL 迴路——PD{' '}
          <Tex>{String.raw`\to`}</Tex> loop filter <Tex>{String.raw`\to`}</Tex> VCO <Tex>{String.raw`\to`}</Tex> divider <Tex>{String.raw`\to`}</Tex> 回到 PD，回授路徑上只有 divider，沒有 DTC。PD 的輸出{' '}
          <Tex>{String.raw`e_\mathrm{PD}[n]`}</Tex> 分兩路：往右下送進 loop filter，往左下給 1-bit comparator、再經 GMAC 回到最上面（圖左邊往上的那條線），這就是校正迴路——comparator 取的是 PD 的輸出，也就是送進 loop filter 的<strong>同一個訊號</strong>（系統地圖上標{' '}
          <Tex>{'e[n]'}</Tex> 的那一個；本章的 <Tex>{String.raw`e=y-w^*`}</Tex> 已經是 code 誤差，所以 PD 的輸出在這裡記成 <Tex>{String.raw`e_\mathrm{PD}`}</Tex>）。
        </p>
        <p className="small">
          再看虛線：code 誤差 <Tex>{String.raw`e=y-w^*`}</Tex> 不是直接加到輸出，而是與 DSM residue <Tex>{'x[n]'}</Tex> <strong>相乘</strong>（§12.2：乘號不是加號），得到補償量的誤差{' '}
          <Tex>{String.raw`\delta t[n]=\Delta_\mathrm{LSB}\,e[n]\,x[n]`}</Tex>（<strong>多補償</strong>為正）。虛線是簡寫，不是一條實體的線：<Tex>{String.raw`\delta t`}</Tex> 跟著 reference edge 從 PD 的 reference 輸入進去，繞 PD 下面那一圈主迴路才到 VCO 的輸出，整圈合起來的效果就是{' '}
          <Tex>{'T(f)'}</Tex>。
        </p>
        <p className="small">
          DTC 方塊裡的 <Tex>{String.raw`T_0-\Delta_\mathrm{LSB}\cdot y\cdot x[n]`}</Tex> 怎麼來：feedback（divider）的 edge 比理想時刻早到 <Tex>{String.raw`a\,x[n]`}</Tex>（<Tex>{'a'}</Tex> 是真實的 DTC gain；換成本章的寫法，
          <Tex>{String.raw`a=\Delta_\mathrm{LSB}\,w^*`}</Tex>）；reference 端的 DTC 只能延遲、不能提前，所以它從固定的基準延遲 <Tex>{String.raw`T_0`}</Tex> 往回扣補償量 <Tex>{String.raw`w\,x[n]`}</Tex>（<Tex>{'w'}</Tex> 是實際寫進去的 gain，本章{' '}
          <Tex>{String.raw`w=\Delta_\mathrm{LSB}\,y`}</Tex>；<Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex> 是 1 個 gain LSB 對應多少 fs，下一段就算它），等於把 reference edge 提前去對齊。
          <Tex>{String.raw`T_0`}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收。PD 量的是（延遲後的）reference edge 減 feedback edge：
        </p>
        <TexBlock>{String.raw`\begin{aligned}e_\mathrm{PD}[n]&=t_\mathrm{ref}'[n]-t_\mathrm{fb}[n]\\&=(a-w)\,x[n]+v[n]\\&=-\delta t[n]+v[n]\end{aligned}`}</TexBlock>
        <p className="small">
          <Tex>{'v[n]'}</Tex> 是 comparator 前的雜訊。補償不足（<Tex>{'w<a'}</Tex>）時 reference 還是太晚，誤差為正；<Tex>{String.raw`(a-w)\,x[n]`}</Tex> 就是下面正負號約定裡的 <Tex>{String.raw`\delta\,x[n]`}</Tex>（<Tex>{String.raw`\delta=a-w`}</Tex>）。最後一行把{' '}
          <Tex>{String.raw`a=\Delta_\mathrm{LSB}\,w^*`}</Tex>、<Tex>{String.raw`w=\Delta_\mathrm{LSB}\,y`}</Tex> 代進去：<Tex>{String.raw`(a-w)\,x=-\Delta_\mathrm{LSB}\,(y-w^*)\,x=-\delta t`}</Tex>。本章顯示的 <Tex>{String.raw`\delta w`}</Tex> 與{' '}
          <Tex>{String.raw`\delta t`}</Tex> 以多補償為正：<Tex>{String.raw`\delta t>0`}</Tex> 時 DTC 從 <Tex>{String.raw`T_0`}</Tex> 扣得太多，reference edge 比該到的時刻早 <Tex>{String.raw`\delta t`}</Tex>；PD 量的是 reference 減 feedback，所以看到 <Tex>{String.raw`-\delta t`}</Tex>。LMS 的更新{' '}
          <Tex>{String.raw`w\leftarrow w+\mu\,q\,x`}</Tex>（<Tex>{String.raw`q=\mathrm{sign}(e_\mathrm{PD})`}</Tex>）看的是 PD 這個方向：補償不足時 <Tex>{String.raw`q\,x`}</Tex> 的平均為正，把 <Tex>{'w'}</Tex> 往上推。
        </p>
        <p className="small">
          線性化之後寫成相位（和<ChRef ch="12">第 12 章</ChRef>的寫法相同）：相位以 edge 晚到為正，DTC 的殘餘誤差在 PD 的 reference 輸入是 <Tex>{String.raw`\phi_\mathrm{dtc}=-2\pi f_\mathrm{out}\,\delta t`}</Tex>（<Tex>{String.raw`f_\mathrm{out}`}</Tex> 是 PLL 的輸出頻率），到輸出是{' '}
          <Tex>{String.raw`\theta_\mathrm{out}=T\,\phi_\mathrm{dtc}`}</Tex>（正號）。本章只用到 <Tex>{String.raw`|T|^2`}</Tex>、RMS 與 PSD，這個負號不影響任何數字。
        </p>
        <ModeGate min="engineer">
          <p className="small muted">
            硬體對應：<Tex>{'w_H'}</Tex> 是 LMS 更新暫存器（例如 16–24 bit）；<Tex>{'y'}</Tex> 是 DTC gain DAC 的 6-bit 控制字；量化策略是兩者之間的一小塊
            RTL。DTC 只能延遲，所以數位端真正送進它的 code 是 <Tex>{String.raw`C_0-w\,x[n]`}</Tex>（<Tex>{String.raw`C_0`}</Tex> 是固定的中心值，等於把 code 取補數；<Tex>{String.raw`T_0`}</Tex> 是它對應的基準延遲），這不改變本章任何數字。code 的更新時脈 <Tex>{'f_u'}</Tex>（每個 reference cycle 或每個 GMAC block）會決定量化誤差落在哪個頻率（§13.5 第 5 點）。
          </p>
        </ModeGate>
      </Section>

      <Section kind="example" title="先算一次：把 LSB 換成 fs" id="ch13-units">
        <p>
          規格 §13 只寫「32.4 LSB」，沒有說 1 LSB 是多少 fs，所以 6-bit 的結果無法和<ChRef ch="12">第 12 章</ChRef>的 0.399 fs 比較（<ChapterErratum id="E13" />）。本章補上
          <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>（1 個 gain LSB 對應的 DTC gain，單位 <Tex>{String.raw`\mathrm{fs/LSB}`}</Tex>），示例值取 <Tex>{String.raw`\Delta_\mathrm{LSB}=${LSB_FS_EXAMPLE}\,\mathrm{fs/LSB}`}</Tex>
          （與 Lab 的 <code>gain_lsb_fs</code> 預設一致，非量測值）。
        </p>
        <Mermaid
          chart={CHART_ERROR_PATH}
          caption={String.raw`誤差的定義與單位。先看左邊一條：$y$ 減 $w^*$ 得到 code 誤差（$\mathrm{LSB}$），乘 $\Delta_\mathrm{LSB}$ 變成 $\mathrm{fs}$，再乘 DSM residue 才是 timing error；再看右邊一條：§0 的約定把減法反過來，同一個誤差正負號相反。`}
        />
        <p className="small ch13-figwalk">
          圖上藍色加法點的輸出 <Tex>{String.raw`e=\delta w=y-w^*`}</Tex> 就是本章所有表格顯示的<strong>係數誤差</strong>（code 比理想值大就是正的）；圖上的 <Tex>{String.raw`\times\Delta_\mathrm{LSB}`}</Tex> 方塊就是下面公式 F-13.1 的{' '}
          <Tex>{String.raw`w\,[\mathrm{fs}]=\Delta_\mathrm{LSB}\cdot w\,[\mathrm{LSB}]`}</Tex>。下面的手算照著圖由上往下走一次：先算 <Tex>{'y'}</Tex>，再算 <Tex>{String.raw`\delta w`}</Tex>，最後乘 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>。其中{' '}
          <Tex>{String.raw`Q_6(\cdot)`}</Tex> 表示「四捨五入成 6-bit 整數 code」的量化器（一般寫成 <Tex>{String.raw`Q_B`}</Tex>，<Tex>{'B'}</Tex> 是位元數）。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`w^*[\mathrm{fs}]=\Delta_\mathrm{LSB}\cdot w^*[\mathrm{LSB}]=${LSB_FS_EXAMPLE}\times32.4=${fx(nums.wFs, 3)}\ \mathrm{fs}`, why: tx(String.raw`單位換算：每個 LSB 代表 $\Delta_\mathrm{LSB}$ 的 DTC gain（每單位 normalized code）。`) },
            { tex: String.raw`Q_6(32.4)=\lfloor 32.4+\tfrac12\rfloor=\lfloor 32.9\rfloor=${nums.code}`, why: tx(String.raw`round-half-up：加 $\tfrac12$ 後取 floor（這是本章 $Q_B$ 的預設定義，見 §13.1）。`) },
            { tex: String.raw`\delta w=${nums.code}-32.4=-0.4\,\mathrm{LSB}\;\Rightarrow\;${fx(nums.errFs, 3)}\ \mathrm{fs}`, why: tx(String.raw`係數誤差乘上 $\Delta_\mathrm{LSB}$ 就是 gain 誤差（$\mathrm{fs}$ / unit code）。`) },
            {
              tex: String.raw`\sigma_w^{(\mathrm{ch12})}=\frac{\mu}{\sqrt{N(1-p_\mathrm{cal}^2)}}=${fx(nums.sigmaWFs, 3)}\ \mathrm{fs}=\frac{${fx(nums.sigmaWFs, 3)}}{${LSB_FS_EXAMPLE}}=${fx(nums.sigmaWLsb, 2)}\ \mathrm{LSB}`,
              why: (
                <>
                  <Tex>{String.raw`\sigma_w`}</Tex> 是 LMS 更新雜訊讓係數在 <Tex>{'w^*'}</Tex> 附近擺動的 RMS（<ChRef ch="12">第 12 章</ChRef>）；<Tex>{String.raw`\mu`}</Tex> 是 LMS 步長、<Tex>{'N'}</Tex> 是 GMAC 的 block 長度、
                  <Tex>{String.raw`\sigma_v`}</Tex> 是 comparator 前的雜訊、<Tex>{String.raw`p_\mathrm{cal}`}</Tex> 是<ChRef ch="12">第 12 章</ChRef>的係數 pole（那裡記為 <Tex>{'p'}</Tex>；本章的 <Tex>{'p'}</Tex> 另指小數部分，所以改名）。<ChRef ch="12">第 12 章</ChRef> T13 例子（
                  <Tex>{String.raw`\mu=10\,\mathrm{fs},\ N=4096,\ \sigma_v=100\,\mathrm{fs}\Rightarrow p_\mathrm{cal}=${fx(nums.pcal, 5)}`}</Tex>）的係數雜訊換成 LSB：在這個 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex> 下 LMS
                  雜訊遠大於 1 LSB，量化幾乎被淹沒。本章因此把 <Tex>{String.raw`\sigma_w/\Delta_\mathrm{LSB}`}</Tex> 當成關鍵參數（§13.5a 的時變情境用 <Tex>{String.raw`\sigma_w=0.2\,\mathrm{LSB}`}</Tex>，量化誤差與 LMS 雜訊同量級）。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-13.1">{String.raw`w\,[\mathrm{fs}]=\Delta_\mathrm{LSB}\cdot w\,[\mathrm{LSB}]`}</TexBlock>
        <Callout kind="info" title="正負號約定（勘誤 E49）">
          本章表格與實驗顯示 <Tex>{String.raw`\delta w=w-w^*`}</Tex>（規格 §12 的約定），所以 Freeze 的 static error 是{' '}
          <strong>
            <Tex>{String.raw`-0.4\,\mathrm{LSB}`}</Tex>
          </strong>
          ；若依 §0 的
          <Tex>{String.raw`\delta=a-w`}</Tex>，同一個誤差是{' '}
          <strong>
            <Tex>{String.raw`+0.4\,\mathrm{LSB}`}</Tex>
          </strong>
          。兩者平方後都是 <Tex>{String.raw`0.16\,\mathrm{LSB}^2`}</Tex>。 <ChapterErratum id="E49" />
        </Callout>
      </Section>

      <Prereq title="floor、round 與小數部分（frac）">
        <p>
          <Tex>{String.raw`\lfloor x\rfloor`}</Tex>（floor）是「不大於 <Tex>{'x'}</Tex> 的最大整數」：<Tex>{String.raw`\lfloor 32.9\rfloor=32`}</Tex>、
          <Tex>{String.raw`\lfloor -0.2\rfloor=-1`}</Tex>。小數部分 <Tex>{String.raw`\mathrm{frac}(x)=x-\lfloor x\rfloor\in[0,1)`}</Tex>，例如
          <Tex>{String.raw`\mathrm{frac}(32.4)=0.4`}</Tex>。
        </p>
        <p>
          round-half-up：<Tex>{String.raw`\mathrm{round}(x)=\lfloor x+\tfrac12\rfloor`}</Tex>，所以 <Tex>{String.raw`\mathrm{round}(32.5)=33`}</Tex>（tie 往上）。truncation（floor）則直接
          <Tex>{String.raw`\lfloor x\rfloor`}</Tex>。兩者對 ΔΣ（§13.4）只差相位與它內部誤差暫存器 <Tex>{'r'}</Tex> 的範圍（<Tex>{String.raw`[-\tfrac12,\tfrac12)`}</Tex> vs <Tex>{'[0,1)'}</Tex>），但對「直接截位」會差半個 LSB 的 bias（§13.6）。
        </p>
        <TexBlock>{String.raw`x=\lfloor x\rfloor+\mathrm{frac}(x),\quad 0\le\mathrm{frac}(x)<1`}</TexBlock>
        <p className="small">
          <ClaimTag kind="exact" /> 這些都是定義，沒有近似。
        </p>
      </Prereq>
      <p className="small muted">
        模擬條件：{n(DEFAULT_LAB_PARAMS.bits, 2)}-bit register、round-half-up、saturate；所有數字由 <code>src/simulation/models/quantizer.ts</code> 即時計算。
      </p>
    </>
  )
}
