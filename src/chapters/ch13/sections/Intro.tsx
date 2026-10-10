import { useMemo } from 'react'
import {
  Callout,
  ClaimTag,
  Mermaid,
  ModeGate,
  Prereq,
  Section,
  SourceTag,
  StepDerivation,
  SymbolTable,
  Tex,
  TexBlock,
  type SymbolEntry,
} from '@/components'
import { makeGrid, quantize, makeCtx } from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Erratum, LSB_FS_EXAMPLE, fx, n, tx } from '../common'

const SYMBOLS: SymbolEntry[] = [
  { symbol: String.raw`w^*`, meaning: '理想（最佳）校正係數，本章例子 32.4', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: tx(String.raw`規格 §13 的 $w^*$；換成 fs 要乘 $\Delta_\mathrm{LSB}$`) },
  { symbol: String.raw`w_H[n]`, meaning: 'LMS 內部的高解析係數（accumulator 內容）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: tx(String.raw`常數情境 $w_H=w^*$；時變情境 $w_H[n]=w^*+\delta w[n]$`) },
  { symbol: String.raw`y[n]`, meaning: '實體 6-bit gain code（DTC gain register 的值）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: <Tex>{String.raw`y\in\{0,1,\dots,2^B-1\}`}</Tex> },
  { symbol: 'B', meaning: 'gain register 的位元數（本章 6）', firstSeen: '§13.0' },
  { symbol: String.raw`\Delta_\mathrm{LSB}`, meaning: '1 個 gain LSB 對應的 DTC gain', unit: String.raw`\mathrm{fs}/\mathrm{LSB}`, firstSeen: '§13.0', note: <><Erratum id="E13" />：規格原未給，本章示例 <Tex>{String.raw`${LSB_FS_EXAMPLE}\,\mathrm{fs/LSB}`}</Tex></> },
  { symbol: String.raw`Q_B(\cdot)`, meaning: tx(String.raw`$B$-bit 量化器：round-half-up $\lfloor v+\tfrac12\rfloor$ 或 floor $\lfloor v\rfloor$；超出 $[0,2^B-1]$ 時 saturate / wrap`), firstSeen: '§13.1' },
  { symbol: String.raw`\delta w=w-w^*`, meaning: '係數誤差（本章顯示用的約定）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.1', note: <><Erratum id="E49" />：{tx(String.raw`§0 約定 $\delta=a-w=-\delta w$，正負號相反`)}</> },
  { symbol: String.raw`e[n]=y[n]-w^*`, meaning: 'code 誤差（gain error）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.1' },
  { symbol: String.raw`\overline e,\;\overline{e^2}`, meaning: tx(String.raw`時間平均（DC 誤差）與平方平均（總誤差功率）；$\overline{e^2}=\overline e^{\,2}+$ 變異數`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.1' },
  { symbol: 'p', meaning: <><Tex>{String.raw`w^*`}</Tex> 的小數部分 <Tex>{String.raw`\mathrm{frac}(w^*)`}</Tex>（<Tex>{String.raw`32.4\to0.4`}</Tex>）；也是 stochastic rounding 輸出 33 的機率</>, firstSeen: '§13.2', note: tx(String.raw`第 12 章的係數 pole $p$ 在本章改記為 $p_\mathrm{cal}$，避免衝突`) },
  { symbol: String.raw`L_t,\;h`, meaning: 'toggle pattern 的週期與其中「進位」的個數（5 與 2）', firstSeen: '§13.2' },
  { symbol: String.raw`c_k,\;P_k`, meaning: tx(String.raw`週期誤差的第 $k$ 個傅立葉係數與 one-sided 線功率（頻率 $kf_u/q$）`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.2' },
  { symbol: String.raw`f_u`, meaning: tx(String.raw`6-bit code 的更新率（每個 reference cycle 更新時 $f_u=f_\mathrm{ref}$；每個 GMAC block 更新時 $f_u=f_s/N$）`), unit: String.raw`\mathrm{Hz}`, firstSeen: '§13.2', note: <><Erratum id="E47" />：{tx(String.raw`規格的 $f_\mathrm{toggle}$ 未定義，本章一律用 $f_u$`)}</> },
  { symbol: String.raw`f_s,\;N_\mathrm{upd}`, meaning: tx(String.raw`reference / DTC 取樣率；每 $N_\mathrm{upd}$ 個 reference cycle 更新一次 code（$f_u=f_s/N_\mathrm{upd}$）`), unit: String.raw`f_s:\ \mathrm{Hz}`, firstSeen: '§13.2', note: tx(String.raw`§13.2 的 ZOH 推導把保持的樣本數記為 $N_h$，與 $N_\mathrm{upd}$ 是同一個量`) },
  { symbol: String.raw`\Omega=2\pi f/f_u`, meaning: '以 code 更新率為取樣率的離散時間頻率', unit: String.raw`\mathrm{rad/sample}`, firstSeen: '§13.4' },
  { symbol: String.raw`v[n],\;r[n]`, meaning: 'ΔΣ 量化器輸入與內部量化誤差（residual）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.4', note: tx(String.raw`round-half-up 時 $r\in[-\tfrac12,\tfrac12)$；floor 時 $r\in[0,1)$`) },
  { symbol: String.raw`\sigma_r^2`, meaning: tx(String.raw`$r$ 的變異數；白色近似取 $\tfrac1{12}$，常數 32.4 時實際為 0.08`), unit: String.raw`\mathrm{LSB}^2`, firstSeen: '§13.4', note: <Erratum id="E15" /> },
  { symbol: String.raw`\mathrm{NTF}(z)=1-z^{-1}`, meaning: '一階 noise transfer function', firstSeen: '§13.4' },
  { symbol: String.raw`q,\;m`, meaning: tx(String.raw`有理目標 $w=m/q$（最簡分數）；$q$ 也是 limit cycle 的週期`), firstSeen: '§13.4' },
  { symbol: String.raw`F,\;K`, meaning: tx(String.raw`$w_H$ 定點表示的小數位元數；$K=w_H\cdot2^F$ 為整數`), unit: String.raw`F:\ \mathrm{bit}`, firstSeen: '§13.4' },
  { symbol: String.raw`d[n],\;A,\;\sigma_d^2`, meaning: tx(String.raw`dither、其峰對峰寬度、變異數（RPDF：$A^2/12$；TPDF：$A^2/24$）`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.4E' },
  { symbol: String.raw`u[n],\;e_q[n]`, meaning: tx(String.raw`加了 dither 的量化器輸入 $u=v+d$，與量化器本身的誤差 $e_q=y-u$`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.4E' },
  { symbol: String.raw`\delta w[n],\;\sigma_w,\;p_\mathrm{cal}`, meaning: tx(String.raw`LMS 更新雜訊（AR(1)）、其穩態 RMS 與 pole（第 12 章的 $p$）`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.5a' },
  { symbol: String.raw`\epsilon[n]=y[n]-w_H[n]`, meaning: tx(String.raw`量化誤差：只看量化器本身（不含 LMS 雜訊）；用 $\epsilon$ 是為了和有理分母 $q$、量化器誤差 $e_q$ 區分`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.5a' },
  { symbol: String.raw`f_B=f_u/64`, meaning: '本章「頻帶內」的上緣（相當於 OSR = 32）：會被當成 static / 慢變 gain error 的頻段', unit: String.raw`\mathrm{Hz}`, firstSeen: '§13.5a' },
  { symbol: String.raw`x[n],\;\delta t[n]`, meaning: tx(String.raw`DSM residue（正規化 regressor）與 DTC timing error $\delta t=\Delta_\mathrm{LSB}\,e\,x$`), unit: String.raw`\delta t:\ \mathrm{fs}`, firstSeen: '§13.5' },
  { symbol: String.raw`T(f)`, meaning: '從 DTC 誤差到 PLL output 的 closed-loop transfer（low-pass）', firstSeen: '§13.5' },
  { symbol: String.raw`\sigma_{\delta t},\;\sigma_\mathrm{out}`, meaning: tx(String.raw`$\delta t$ 的 RMS（未經 PLL）與經 $|T(f)|^2$ 加權積分後的 output jitter（只含 $f\ge f_L$）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§13.5' },
  { symbol: String.raw`f_L,\;\sigma_\mathrm{slow},\;\overline{\delta t}`, meaning: tx(String.raw`$\sigma_\mathrm{out}$ 的積分下限（Welch 的頻率解析度 $f_s/N_\mathrm{seg}$）；比它慢的成分 RMS；整段紀錄的平均（靜態偏移，或分辨不出的慢差頻）`), unit: String.raw`\mathrm{Hz},\;\mathrm{fs},\;\mathrm{fs}`, firstSeen: '§13.5b' },
  { symbol: String.raw`P_\mathrm{code},\;P_\mathrm{DSM}`, meaning: tx(String.raw`code 的 limit-cycle 週期與 DSM residue 的週期；混頻產物的週期是 $\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},\,P_\mathrm{DSM})$ 個 reference cycle`), unit: String.raw`\text{更新次數},\;\text{cycles}`, firstSeen: '§13.5b' },
]

export function Intro() {
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
          DSM residue 與 PLL 的 <Tex>{'T(f)'}</Tex> 會決定哪個頻率最傷。對常數目標 32.4，一階 ΔΣ 甚至與「固定週期切換」落入<strong>同一個</strong>週期 5 循環（floor
          版逐點相同、round-half-up 版只差循環移位；<Erratum id="E15" />）。
        </p>
        <SourceTag kind="illustrative" />
      </Section>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            全站約定見規格 §0。本章 code 一律以 LSB 為單位，換成時間要乘 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>（<Erratum id="E13" />）。
          </>
        }
      />

      <Section kind="example" title="先算一次：把 LSB 換成 fs" id="ch13-units">
        <p>
          規格 §13 只寫「32.4 LSB」，沒有說 1 LSB 是多少 fs，所以 6-bit 的結果無法和第 12 章的 0.399 fs 比較（<Erratum id="E13" />）。本章補上
          <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>，示例值取 <Tex>{String.raw`\Delta_\mathrm{LSB}=${LSB_FS_EXAMPLE}\,\mathrm{fs/LSB}`}</Tex>
          （與 Lab 的 <code>gain_lsb_fs</code> 預設一致，非量測值）。
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
                  第 12 章 T13 例子（<Tex>{String.raw`\mu=10\,\mathrm{fs},\ N=4096,\ \sigma_v=100\,\mathrm{fs}\Rightarrow p_\mathrm{cal}=${fx(nums.pcal, 5)}`}</Tex>）的係數雜訊換成 LSB：在這個 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex> 下 LMS
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
          。兩者平方後都是 <Tex>{String.raw`0.16\,\mathrm{LSB}^2`}</Tex>。 <Erratum id="E49" />
        </Callout>
      </Section>

      <Section kind="diagram" title={<>訊號流：高解析 <Tex>{'w_H'}</Tex> <Tex>{String.raw`\to`}</Tex> 6-bit code <Tex>{String.raw`\to`}</Tex> DTC</>} id="ch13-diagram">
        <Mermaid
          chart={[
            'flowchart LR',
            '  G[GMAC 平均 G_k] --> ACC["LMS accumulator<br/>w_H（高解析）"]',
            '  ACC --> Q{"量化策略<br/>A Freeze / B Toggle / C Stochastic<br/>D ΔΣ / E ΔΣ+dither"}',
            '  Q --> REG["6-bit gain register<br/>y ∈ {0..63}"]',
            '  REG --> DTC["DTC：延遲 = Δ_LSB·y·x[n]"]',
            '  DSM["DSM residue x[n]"] --> DTC',
            '  DTC --> PD["PD / comparator"] --> G',
            '  DTC -. "δt = Δ_LSB·(y − w*)·x" .-> OUT["PLL output（經 T(f)）"]',
          ].join('\n')}
          caption="6-bit gain code 的訊號流（虛線：code 誤差到 PLL 輸出的路徑）"
          ariaLabel="GMAC 平均進入 LMS accumulator，經量化策略成為 6-bit gain register，再與 DSM residue 一起控制 DTC；code 誤差乘上 DSM residue 後經 PLL 到輸出"
        />
        <p className="small">
          code 誤差 <Tex>{String.raw`e=y-w^*`}</Tex> 不是直接加到輸出，而是與 DSM residue <Tex>{'x[n]'}</Tex> <strong>相乘</strong>（§12.2：乘號不是加號）：
          <Tex>{String.raw`\delta t[n]=\Delta_\mathrm{LSB}\,e[n]\,x[n]`}</Tex>，再經 PLL 的 <Tex>{'T(f)'}</Tex> 到輸出。
        </p>
        <ModeGate min="engineer">
          <p className="small muted">
            硬體對應：<Tex>{'w_H'}</Tex> 是 LMS 更新暫存器（例如 16–24 bit）；<Tex>{'y'}</Tex> 是 DTC gain DAC 的 6-bit 控制字；量化策略是兩者之間的一小塊
            RTL。code 的更新時脈 <Tex>{'f_u'}</Tex>（每個 reference cycle 或每個 GMAC block）會決定量化誤差落在哪個頻率（§13.5 第 5 點）。
          </p>
        </ModeGate>
      </Section>

      <Prereq title="floor、round 與小數部分（frac）">
        <p>
          <Tex>{String.raw`\lfloor x\rfloor`}</Tex>（floor）是「不大於 <Tex>{'x'}</Tex> 的最大整數」：<Tex>{String.raw`\lfloor 32.9\rfloor=32`}</Tex>、
          <Tex>{String.raw`\lfloor -0.2\rfloor=-1`}</Tex>。小數部分 <Tex>{String.raw`\mathrm{frac}(x)=x-\lfloor x\rfloor\in[0,1)`}</Tex>，例如
          <Tex>{String.raw`\mathrm{frac}(32.4)=0.4`}</Tex>。
        </p>
        <p>
          round-half-up：<Tex>{String.raw`\mathrm{round}(x)=\lfloor x+\tfrac12\rfloor`}</Tex>，所以 <Tex>{String.raw`\mathrm{round}(32.5)=33`}</Tex>（tie 往上）。truncation（floor）則直接
          <Tex>{String.raw`\lfloor x\rfloor`}</Tex>。兩者對 ΔΣ 只差相位與 <Tex>{'r'}</Tex> 的範圍（<Tex>{String.raw`[-\tfrac12,\tfrac12)`}</Tex> vs <Tex>{'[0,1)'}</Tex>），但對「直接截位」會差半個 LSB 的 bias（§13.6）。
        </p>
        <TexBlock>{String.raw`x=\lfloor x\rfloor+\mathrm{frac}(x),\qquad 0\le\mathrm{frac}(x)<1`}</TexBlock>
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
