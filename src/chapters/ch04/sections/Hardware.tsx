import { useMemo, useState, type ReactNode } from 'react'
import {
  Callout,
  ClaimTag,
  ModeGate,
  ParamControl,
  Prereq,
  Section,
  SelectControl,
  StepDerivation,
  Tex,
  TexBlock,
} from '@/components'
import { APPLY_MODES, AVERAGE_LOOP, LATENCY_TIMELINE, NOISE_FEEDBACK, RTL_DATAFLOW } from '../diagrams'
import { ROOT_MAX_DELAY, latencyCalc, type ApplyMode, type CriticalGainMethod, type LatencyParams } from '../latency'
import { DerivationFold, Erratum, f, FigRef, KpiRow, MermaidFig, mt } from '../common'

const R = String.raw

const MAPPING: { part: string; role: ReactNode; hw: ReactNode; model: ReactNode; note: ReactNode }[] = [
  {
    part: 'Fractional Residue Generator',
    role: '由 FCW、DSM divider sequence 推出要補償的 phase / time residue',
    hw: 'Counter、Accumulator、Fixed-Point',
    model: 'dsm.ts（runDsm / DsmStream）；§2 的 firstOrderAccumulator',
    note: mt(R`累加器內容 $s[n]$ 就是 code；取最高 $B_x$ bits、MSB 反相成二補數；注意 code 的 DC（E03）`),
  },
  {
    part: 'DTC',
    role: 'Code → Delay',
    hw: 'Analog delay / interpolation',
    model: mt(R`dtc.ts；blockLms 的 gain_true $=a$、dtc_nonlinearity`),
    note: '類比 gain 隨 PVT 漂移，所以需要背景校正；INL 造成 bias（Ch11）',
  },
  {
    part: 'PD / BBPD',
    role: '觀察 residual phase error',
    hw: '類比相位檢測，可能含 comparator',
    model: mt(R`$e[n]=H_\mathrm{PD}\{\delta x\}[n]+b_\mathrm{off}+v[n]$`),
    note: mt(R`極性與 $H_\mathrm{PD}$ 的相位決定 $C$ 的正負（Ch06）；BBPD 本身就是 1-bit comparator`),
  },
  {
    part: 'Code Alignment',
    role: '讓 GMAC 用的 code 與 PD 誤差的樣本來源、延遲一致',
    hw: 'Pipeline / FIFO / Tap MUX',
    model: mt(R`gm_code_delay_samples $=D$；regressor_mode raw / delayed / filtered`),
    note: mt(R`錯 $D$ 個 sample 會讓 $C$ 變號（Ch07）；mode 切換後要重新對齊（§16.1 第 2 項）`),
  },
  {
    part: 'GMAC',
    role: mt(R`$S_k=\sum q\,x_\mathrm{ref}$`),
    hw: mt(R`$q=\pm1\Rightarrow$ 條件取負 + 加法器，不需乘法器`),
    model: 'gmac.ts fixedGmacBlock / xorCarryAccumulate',
    note: mt(R`累加器位元數：對稱 code 用 $B_x+\lceil\log_2N\rceil$ 就夠；含最負 code 且 $N=2^m$ 時要再 $+1$（F-04.9）；最負 code 取負會溢位（§5）`),
  },
  {
    part: 'Normalize',
    role: mt(R`$\sum/N$、shift、gain scale`),
    hw: 'Arithmetic shift、rounding',
    model: 'gmac.ts shiftRound；blockLms gm_mode',
    note: mt(R`sum vs average 差 $N$ 倍 loop gain（§4）；floor 截斷在 $G\approx0$ 附近有偏差（§5）`),
  },
  {
    part: 'Gain Accumulator',
    role: mt(R`更新 $w$，保留足夠 fractional bits`),
    hw: '加法器、暫存器、飽和',
    model: 'gmac.ts gainUpdate；blockLms gain_register',
    note: mt(R`saturation 與 anti-windup；wrap 會讓 gain 從一個 rail 跳到另一個（§5）`),
  },
  {
    part: 'Correction DAC / DTC',
    role: mt(R`用 $w$ 修正 delay mapping`),
    hw: 'Multiplier / LUT / Control logic',
    model: 'blockLms wPhys（physical_bits、lsb_fs）',
    note: mt(R`實體 code 只有幾個 bit $\Rightarrow$ 量化與 limit cycle（Ch13）；commit 時序決定更新延遲 $d$`),
  },
]

const GCRIT_METHOD_LABEL: Record<CriticalGainMethod, string> = {
  closed_form: 'F-04.14 封閉式',
  jury: 'F-04.17 封閉式',
  root_finding: '特徵方程求根',
  continuation: R`$d>${ROOT_MAX_DELAY}$：F-04.14 的連續延拓，近似，誤差 $<0.03\%$`,
}

const DEFAULT_LAT: LatencyParams = { fsGHz: 4, N: 4096, D: 0, Pc: 8, dCfg: 0, apply: 'boundary' }

function LatencyCalculator() {
  const [p, setP] = useState<LatencyParams>(DEFAULT_LAT)
  const r = useMemo(() => latencyCalc(p), [p])
  return (
    <div className="ch04-mini">
      <div className="ch04-panel-title">Latency 計算器（平均線性模型）</div>
      <div className="grid-2">
        <div>
          <ParamControl label={mt(R`$f_s$`)} ariaLabel="f_s" value={p.fsGHz} onChange={(fsGHz) => setP({ ...p, fsGHz })} min={0.01} max={20} step={0.01} unit="GHz" reg="sample_rate_hz" />
          <ParamControl label={mt(R`$N$`)} ariaLabel="N" value={p.N} onChange={(N) => setP({ ...p, N })} min={1} max={1048576} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label={mt(R`$D$（code 對齊）`)} ariaLabel="D（code 對齊）" value={p.D} onChange={(D) => setP({ ...p, D })} min={0} max={65536} integer clampOnBlur unit="samples" reg="gm_code_delay_samples" />
        </div>
        <div>
          <ParamControl label={mt(R`$P_c$（commit pipeline）`)} ariaLabel="P_c（commit pipeline）" value={p.Pc} onChange={(Pc) => setP({ ...p, Pc })} min={0} max={65536} integer clampOnBlur unit="samples" reg="RTL: update pipeline depth" />
          <ParamControl label={mt(R`$d$（額外等待）`)} ariaLabel="d（額外等待）" value={p.dCfg} onChange={(dCfg) => setP({ ...p, dCfg })} min={0} max={16} integer clampOnBlur unit="blocks" reg="cal_update_delay_blocks" />
          <SelectControl<ApplyMode>
            label="新 gain 何時生效"
            value={p.apply}
            onChange={(apply) => setP({ ...p, apply })}
            options={[
              { value: 'boundary', label: '等下一個 block 邊界' },
              { value: 'immediate', label: 'ready 就立即生效（block 中途）' },
            ]}
            reg="RTL: commit strobe"
          />
        </div>
      </div>
      <KpiRow
        items={[
          { label: <Tex>{R`T_s=1/f_s`}</Tex>, value: `${f(r.TsPs, 4)} ps` },
          { label: <Tex>{R`T_\mathrm{block}=N/f_s`}</Tex>, value: `${f(r.TblockUs, 4)} µs` },
          { label: <Tex>{R`f_u=f_s/N`}</Tex>, value: `${f(r.fuKHz, 5)} kHz` },
          {
            label: '等效更新延遲',
            value: r.dFrac > 0 ? <Tex>{R`d+d_\mathrm{f}=${r.dEff}+${f(r.dFrac, 4)}`}</Tex> : <Tex>{R`d=${r.dEff}`}</Tex>,
            note: r.dFrac > 0 ? 'blocks（整數 + 分數）' : 'blocks',
          },
          { label: <Tex>{R`g_\mathrm{crit}`}</Tex>, value: f(r.gCrit, 5), note: mt(`平均模型的穩定上限（${GCRIT_METHOD_LABEL[r.gCritMethod]}）`) },
          { label: '資訊年齡（block 中心到生效）', value: `${f(r.ageSamples, 6)} samples`, note: `${f(r.ageUs, 4)} µs` },
        ]}
      />
      {r.warnings.map((w) => (
        <Callout key={w} kind="warn" title={null}>
          {mt(w)}
        </Callout>
      ))}
      <p className="small muted">
        <ClaimTag kind="exact" /> <Tex>{R`g_\mathrm{crit}`}</Tex> 由平均模型的特徵方程決定：等 block 邊界生效時延遲是整數 <Tex>{R`d=d_\mathrm{cfg}+\lceil P_c/N\rceil`}</Tex>，
        <Tex>{R`g_\mathrm{crit}=2\sin\frac{\pi}{4d+2}`}</Tex>（F-04.14）；block 中途生效時延遲是 <Tex>{R`d+d_\mathrm{f}`}</Tex>（<Tex>{R`d=d_\mathrm{cfg}+\lfloor P_c/N\rfloor`}</Tex>、
        <Tex>{R`d_\mathrm{f}=(P_c\bmod N)/N`}</Tex>），<Tex>{R`d=0`}</Tex> 用 F-04.17 的封閉式，<Tex>{R`d\ge1`}</Tex> 直接對特徵方程求根（見下方推導）。這只是一階平均模型的界，
        不是整顆 PLL 的 sign-off（Ch08 有完整的 phase margin 分析）。實務上另一個做法：每個 block 開頭先丟掉 <Tex>{R`P_c`}</Tex> 個 sample 不累加，等新 gain 生效後才開始累加——這樣 <Tex>{R`d=0`}</Tex>，
        代價是每個 block 只用到 <Tex>{R`N-P_c`}</Tex> 筆資料（GMAC 雜訊的標準差變成 <Tex>{R`\sqrt{N/(N-P_c)}`}</Tex> 倍）。
      </p>
    </div>
  )
}

export function HardwareSection() {
  return (
    <Section kind="diagram" title="§3 硬體對應、RTL 資料流與時序" level={2} id="ch04-hardware">
      <p>
        規格 §4.1 的硬體對應表，加上兩欄：本站哪個模型負責模擬它，以及設計時最常出錯的地方。每一列在後面的章節都有對應的實驗。
      </p>
      <p>
        表裡會用到幾個後面才正式推導的符號，先各用一句話說明：<Tex>{R`H_\mathrm{PD}`}</Tex> 是「DTC 的時間誤差 → PD 輸出」這條路徑的轉移函數（主 PLL 會把慢的誤差追掉，所以 PD 看到的不是原封不動的{' '}
        <Tex>{R`\delta\,x[n]`}</Tex>）；<Tex>{R`u[n]`}</Tex> 是 code <Tex>{R`x[n]`}</Tex> 通過這條路徑之後的樣子，叫做<strong>有效 regressor</strong>（effective regressor，和 <Tex>x</Tex> 同樣無因次）；
        <Tex>{R`b_\mathrm{off}`}</Tex> 是 comparator 的 offset，<Tex>{R`v[n]`}</Tex> 是 comparator 前的雜訊（RMS 為 <Tex>{R`\sigma_v`}</Tex>），三項相加就是 comparator 的輸入 <Tex>{R`e[n]`}</Tex>（單位都是 fs）；
        <Tex>{R`C=E[x_\mathrm{ref}\,u]`}</Tex> 是 GMAC 用的對齊 code 與有效 regressor 的相關（correlation，無因次；它的正負號決定迴路極性，期望值 <Tex>{R`E[\cdot]`}</Tex> 的說明框在本節稍後）；
        <Tex>D</Tex> 是 code 對齊延遲（單位 samples），<Tex>d</Tex> 是更新延遲（單位 blocks）；<Tex>{R`B_x`}</Tex> 是有號 code 的位元數。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>主要元件</th>
              <th>功能</th>
              <th>硬體概念</th>
              <th>本站模型</th>
              <th>設計重點 / 常見錯誤</th>
            </tr>
          </thead>
          <tbody>
            {MAPPING.map((m) => (
              <tr key={m.part}>
                <td className="nowrap">
                  <strong>{m.part}</strong>
                </td>
                <td>{m.role}</td>
                <td>{m.hw}</td>
                <td className="small">{m.model}</td>
                <td className="small">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>RTL 級資料流（規格 §4.2）</h3>
      <p>
        把上表的後五列（code alignment → GMAC → normalize → gain accumulator → DTC）串起來，就是校正邏輯的 RTL 資料流。它分成兩段：前段每個 sample 進來一筆資料，後段每個 block 才吐出一個新的 gain。
      </p>
      <MermaidFig
        chart={RTL_DATAFLOW}
        caption={R`一個 block 內：條件取負 → 累加 → 右移 rounding → 乘 $\mu$ → 高解析累加器 → 飽和 / anti-windup → gain register → 映射成實體 DTC code，在 block $k+1+d$ 才套用。看兩欄之間的箭頭：左欄（sample rate）每個 sample 動一次，右欄（block rate）每 $N$ 個 sample 才動一次。`}
        ariaLabel="GMAC RTL 資料流"
      />
      <p>
        <strong>先看</strong>左欄上半部的兩個輸入（上下錯開排列，只是為了讓圖窄一點）：對齊後的有號 code <Tex>{R`x_\mathrm{ref}[n]`}</Tex>（<Tex>{R`B_x`}</Tex> bits）和 comparator 的位元 <Tex>{R`b[n]`}</Tex>。因為 <Tex>{R`q=2b-1`}</Tex> 只有{' '}
        <Tex>{R`\pm1`}</Tex>，「乘」只是照抄或取負（§4 的 F-04.8）。<strong>再看</strong>左欄最下面的 GMAC 累加器：它把 <Tex>N</Tex> 筆乘積加成總和 <Tex>{R`S_k`}</Tex>，需要 <Tex>{R`B_\mathrm{acc}`}</Tex> bits（方塊裡的 <Tex>{R`M_x`}</Tex>{' '}
        是單筆乘積的最大絕對值，§5.1）。<strong>接著</strong>順著中間的箭頭到右欄，第一格是 normalize：「<Tex>{R`\div N`}</Tex>」做成算術右移，方塊裡的 <Tex>{R`F_G`}</Tex> 是右移後保留的小數位元數（§5.2）。<strong>最後</strong>乘上 <Tex>{R`\mu`}</Tex>、
        加進高解析累加器 <Tex>W</Tex>、經過飽和保護後成為 gain register 的 <Tex>{R`w_k`}</Tex>。
      </p>
      <p>
        每一格在 §5 都有對應的位元級模型（<code>gmac.ts</code>）。注意兩個規格原圖沒有畫出、但 RTL 一定要有的控制訊號：
        <strong>block 邊界清除 S</strong>（圖上的虛線；忘了清會讓迴路變成無阻尼振盪器，§6 第 7 項）與 <strong>commit / 套用時間</strong>（右欄最下面那一格：新 gain 寫進 register 要經過 <Tex>{R`P_c`}</Tex> 個 sample 的 pipeline 延遲，block <Tex>k</Tex> 的結果在 block <Tex>{R`k+1+d`}</Tex> 才套用，<Tex>d</Tex> 就是更新延遲；時序見下面的圖）。
      </p>

      <h3>雜訊與回授的等效模型（系統圖 C）</h3>
      <p>
        上面的資料流只畫了數位那一半。要分析迴路會不會收斂，必須把類比那一半也接起來：gain 誤差乘上 code 變成時間誤差，經過 PLL、加上雜訊，才到 comparator。把整顆 PLL 的作用收進一個方塊{' '}
        <Tex>{R`H_\mathrm{PD}(z)`}</Tex>，整個校正迴路就剩下「一個未知數 <Tex>a</Tex>、一個可調係數 <Tex>w</Tex>」的單係數迴路：
      </p>
      <MermaidFig
        chart={NOISE_FEEDBACK}
        caption={R`把 PLL 吸收進 $H_\mathrm{PD}$ 後的單係數等效迴路：減法（$a-w_k$）→ 乘 code → $H_\mathrm{PD}$ → 加雜訊 → sign → 相關 → 平均 → 乘 $\mu$ → 積分。看最上面加法點的正負號（$\delta=a-w$），以及兩個乘法點各乘的是哪一個 code。`}
        ariaLabel="LMS 雜訊與回授等效模型"
      />
      <p>
        <strong>先看</strong>最上面的加法點：真實 gain <Tex>a</Tex> 標「<Tex>+</Tex>」，從最下面繞回來的 <Tex>{R`w_k`}</Tex> 標「<Tex>-</Tex>」，輸出就是 <Tex>{R`\delta_k=a-w_k`}</Tex>。<strong>再順著箭頭往下走</strong>：
        第一個乘法點乘的是送進 DTC 的 code <Tex>{R`x[n]`}</Tex>，得到時間誤差 <Tex>{R`\delta_k\,x[n]`}</Tex>（fs）；經過 <Tex>{R`H_\mathrm{PD}`}</Tex> 變成 <Tex>{R`\delta_k\,u[n]`}</Tex>；加上雜訊 <Tex>{R`v[n]`}</Tex> 與 offset 得到{' '}
        <Tex>{R`e[n]`}</Tex>；sign 之後只剩 <Tex>{R`q[n]=\pm1`}</Tex>；第二個乘法點乘的是對齊後的 <Tex>{R`x_\mathrm{ref}[n]`}</Tex>。到這裡為止每個 sample 動一次；從「<Tex>{R`(1/N)\sum`}</Tex>」開始每個 block 才動一次。
      </p>
      <p>
        沿著這個迴路走一圈，就得到一階平均模型。圈上每個方塊對平均增益的貢獻：兩個乘法點（<Tex>{R`\times x`}</Tex> 與 <Tex>{R`\times x_\mathrm{ref}`}</Tex>）和 <Tex>{R`H_\mathrm{PD}`}</Tex>{' '}
        合起來給出 <Tex>{R`C=E[x_\mathrm{ref}u]`}</Tex>；sign 加雜訊給出 <Tex>{R`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>（1-bit comparator 的小訊號增益：誤差每多 1 fs，<Tex>q</Tex> 的平均增加多少，單位{' '}
        <Tex>{R`\mathrm{fs}^{-1}`}</Tex>；§4 推導）；「平均再乘 <Tex>{R`\mu`}</Tex>」給出 <Tex>{R`\mu`}</Tex>（average），若 RTL 沒有除以 <Tex>N</Tex> 則給出 <Tex>{R`N\mu`}</Tex>（sum）；最後的 gain accumulator{' '}
        <Tex>{R`w_{k+1}=w_k+\mu G_k`}</Tex> 寫成轉移函數是 <Tex>{R`1/(z-1)=z^{-1}/(1-z^{-1})`}</Tex>：一個積分器，加上暫存器本身的一拍延遲（<Tex>{R`z^{-1}`}</Tex> = 延遲一個 block，見 §2 的說明框）。
      </p>
      <Prereq title={R`期望值 $E[\cdot]$、變異數、相關（correlation）`}>
        <p>
          <strong>期望值</strong> <Tex>{R`E[X]`}</Tex>
          ：把同一個隨機實驗做非常多次後的平均。若 <Tex>X</Tex> 取值 <Tex>{R`x_i`}</Tex> 的機率是 <Tex>{R`p_i`}</Tex>，<Tex>{R`E[X]=\sum_i p_ix_i`}</Tex>。它是<strong>線性</strong>的：
          <Tex>{R`E[aX+bY]=aE[X]+bE[Y]`}</Tex>
          （只要把定義中的求和拆開就證明了）。
        </p>
        <p>
          <strong>變異數</strong> <Tex>{R`\mathrm{Var}(X)=E[(X-E[X])^2]=E[X^2]-E[X]^2`}</Tex>
          ：偏離平均的平方的平均。<Tex>N</Tex> 個獨立變數的和，變異數相加：
          <Tex>{R`\mathrm{Var}(\sum X_i)=\sum\mathrm{Var}(X_i)`}</Tex>；所以 <Tex>N</Tex> 個獨立同分布變數的<strong>平均</strong>，變異數是 <Tex>{R`\mathrm{Var}(X)/N`}</Tex>，標準差以 <Tex>{R`1/\sqrt N`}</Tex>{' '}
          下降。
        </p>
        <p>
          <strong>相關</strong> <Tex>{R`E[XY]`}</Tex>
          ：兩個訊號乘積的平均。同號的時候多，平均為正；異號多，平均為負；沒有關係，平均為 0。GMAC 的 <Tex>{R`\frac1N\sum q\,x`}</Tex> 就是 <Tex>{R`E[q\,x]`}</Tex> 的樣本估計。
        </p>
      </Prereq>
      <Prereq title={R`Gaussian 分布、$\Phi$ 與 $\mathrm{erf}$`}>
        <p>
          標準 Gaussian 的機率密度 <Tex>{R`\varphi(z)=\frac{1}{\sqrt{2\pi}}e^{-z^2/2}`}</Tex>（鐘形曲線，面積 1）；平均 0、標準差 <Tex>{R`\sigma`}</Tex> 的雜訊 <Tex>v</Tex> 的密度是{' '}
          <Tex>{R`\varphi(v/\sigma)/\sigma`}</Tex>。累積分布 <Tex>{R`\Phi(z)=P(v/\sigma\le z)=\int_{-\infty}^{z}\frac{1}{\sqrt{2\pi}}e^{-t^2/2}dt`}</Tex>
          。誤差函數 <Tex>{R`\mathrm{erf}(z)=\frac{2}{\sqrt\pi}\int_0^ze^{-t^2}dt`}</Tex>
          ，兩者的關係是 <Tex>{R`2\Phi(z)-1=\mathrm{erf}(z/\sqrt2)`}</Tex>
          （變數代換 <Tex>{R`t=\sqrt2 s`}</Tex>）。 在 0 附近泰勒展開：
          <Tex>{R`e^{-t^2}\approx1\;\Rightarrow\;\mathrm{erf}(z)\approx\frac{2}{\sqrt\pi}z`}</Tex>。§4 會用它一步一步推出 GMAC 的平均；Ch05 有完整的 comparator 統計。
        </p>
      </Prereq>
      <Prereq title="pole 與單位圓：等比數列的推廣">
        <p>
          一階遞迴 <Tex>{R`\delta_{k+1}=p\,\delta_k`}</Tex> 的解是 <Tex>{R`\delta_k=p^k\delta_0`}</Tex>（等比數列），所以 <Tex>{R`\delta_k\to0\Leftrightarrow|p|<1`}</Tex>；
          <Tex>{R`0<p<1`}</Tex> 單調衰減、<Tex>{R`-1<p<0`}</Tex> 正負交替地衰減。這個 <Tex>p</Tex> 叫做 <strong>pole</strong>。
        </p>
        <p>
          高階遞迴（例如 <Tex>{R`\delta_{k+2}=a_1\delta_{k+1}+a_0\delta_k`}</Tex>）就猜 <Tex>{R`\delta_k=z^k`}</Tex>，代入得到<strong>特徵方程</strong>{' '}
          <Tex>{R`z^2-a_1z-a_0=0`}</Tex>；一般解是各根的等比數列相加 <Tex>{R`c_1z_1^k+c_2z_2^k`}</Tex>。根可能是複數 <Tex>{R`z=|z|e^{j\theta}`}</Tex>，
          <Tex>{R`z^k=|z|^ke^{jk\theta}`}</Tex> 是包絡 <Tex>{R`|z|^k`}</Tex> 的振盪。所以「收斂 <Tex>{R`\Longleftrightarrow`}</Tex> 所有根都在<strong>單位圓</strong> <Tex>{R`|z|<1`}</Tex> 內」；
          單根落在 <Tex>{R`|z|=1`}</Tex> 是不衰減也不發散的邊界（§6 第 7 項會遇到）；重根落在單位圓上則會線性成長。判斷「根是否全在單位圓內」而不必真的解出根的代數條件叫 Jury 條件（本節最後的推導會用到二次式的版本）。
        </p>
      </Prereq>
      <DerivationFold title="把迴路走一圈：一階平均模型">
        <StepDerivation
          steps={[
            { tex: R`e[n]=\delta_k\,u[n]+b_\mathrm{off}+v[n],\qquad u[n]=(h*x)[n]`, why: mt(R`block $k$ 內 $w$ 固定為 $w_k$；PLL 的作用整理成誤差路徑 $h$（假設 $H_\mathrm{PD}$ 線性、狀態跨 block 延續）；$b_\mathrm{off}$ 為 comparator offset。`) },
            { tex: R`E\bigl[q[n]\bigr]=\mathrm{erf}\!\Bigl(\frac{\delta_k u[n]+b_\mathrm{off}}{\sqrt2\,\sigma_v}\Bigr)\approx K_q\bigl(\delta_k u[n]+b_\mathrm{off}\bigr)`, why: mt(R`Gaussian 雜訊下 sign 的平均是 $\mathrm{erf}$；小訊號時取泰勒一階（§4 有完整推導）。`) },
            { tex: R`E[G_k]=\frac1N\sum_n x_\mathrm{ref}[n]\,E\bigl[q[n]\bigr]\approx K_q C\,\delta_k+K_q\,b_\mathrm{off}\,E[x_\mathrm{ref}]`, why: mt(R`期望值是線性的；把 $\frac1N\sum x_\mathrm{ref}u$ 記成 $C$、$\frac1N\sum x_\mathrm{ref}$ 記成 $E[x_\mathrm{ref}]$。`) },
            { tex: R`\delta_{k+1}=a-w_{k+1}=\delta_k-\mu G_k`, why: mt(R`更新 $w_{k+1}=w_k+\mu G_k$，兩邊用 $a$ 去減（$\delta=a-w$ 極性）。`) },
            { tex: R`E[\delta_{k+1}]\approx(1-\mu K_qC)\,E[\delta_k]-\mu K_q\,b_\mathrm{off}\,E[x_\mathrm{ref}]`, why: mt(R`代入第 3 式並取期望值；$d=0$（新 gain 下一個 block 就生效）。`) },
          ]}
          result={R`p=1-g,\quad g=\mu K=\mu K_qC\;(\text{average});\quad g=N\mu K\;(\text{sum});\qquad \delta_\infty=-\frac{b_\mathrm{off}E[x_\mathrm{ref}]}{C}`}
        />
        <p className="small">
          <ClaimTag kind="approx" /> 小訊號（<Tex>{R`|\delta u+b_\mathrm{off}|\ll\sigma_v`}</Tex>）、雜訊 iid Gaussian 且與 code 獨立。最後一項是 comparator offset 造成的固定點偏移：令{' '}
          <Tex>{R`E[\delta_{k+1}]=E[\delta_k]=\delta_\infty`}</Tex> 解出上面的 <Tex>{R`\delta_\infty`}</Tex>，<Tex>{R`b_\mathrm{off}=0`}</Tex> 或零均值 code 時消失；若主 PLL 的 integral path 強制{' '}
          <Tex>{R`E[q]=0`}</Tex>，offset 會被吸收（勘誤 E03，Ch11）。單位：<Tex>{R`K_q`}</Tex> 為 <Tex>{R`\mathrm{fs}^{-1}`}</Tex>、<Tex>{R`C`}</Tex> 無因次、<Tex>{R`\mu`}</Tex> 為 fs，所以{' '}
          <Tex>g</Tex> 無因次 <Erratum id="E13" />。
        </p>
      </DerivationFold>

      <h3>
        Clock domain 與 latency：sample <Tex>n</Tex>、block <Tex>k</Tex>、commit、apply
      </h3>
      <p>
        規格 §4.1 要求標出不同 clock domain。至少有四個時間尺度：comparator / code 的 <strong>sample clock</strong>（<Tex>{R`f_s`}</Tex>，索引 <Tex>n</Tex>）、
        GMAC 的 <strong>block</strong>（<Tex>{R`f_u=f_s/N`}</Tex>，索引 <Tex>k</Tex>）、gain register 的 <strong>commit</strong>（有 pipeline 延遲 <Tex>{R`P_c`}</Tex>）、
        以及 DTC control 真正<strong>套用</strong>新 gain 的時刻。
      </p>
      <MermaidFig
        chart={LATENCY_TIMELINE}
        caption={R`一個 block 的時序（先左欄、再右欄，箭頭依 (1)–(5) 編號）：累加 $N$ 個 sample → $S_k$ 完成並清除 → commit → 在 block $k+1+d$ 套用。看右欄的兩個箭頭之間隔了多久：那就是更新延遲。`}
        ariaLabel="clock domain 與 latency 時序圖"
      />
      <p>
        <strong>先看左欄、由上往下讀</strong>（時間往下走）：箭頭 (1)(2) 每個 sample 重複一次，共 <Tex>N</Tex> 次——comparator 每拍送出一個位元，GMAC 把它和對齊的 code 累加。<strong>再看</strong>兩欄之間的箭頭 (3)：block 的最後一個 sample
        （<Tex>{R`n=kN+N-1`}</Tex>）之後 <Tex>{R`S_k`}</Tex> 才完成，交給 update logic 並把累加器清為 0。<strong>最後看右欄</strong>（同樣由上往下）的箭頭 (4)(5)：算出新 gain 寫進 register 要花 <Tex>{R`P_c`}</Tex> 個 sample（commit pipeline），
        DTC 真正開始用它是在 block <Tex>{R`k+1+d`}</Tex> 的開頭。<Tex>d</Tex> 就是「block <Tex>k</Tex> 量到的資訊，晚幾個 block 才反映在 PD 看到的誤差上」。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>時脈 / 索引</th>
              <th>發生的事</th>
              <th>跨 domain 時要注意</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sample</td>
              <td>
                <Tex>{R`f_s`}</Tex>、<Tex>n</Tex>
              </td>
              <td>
                comparator 取樣、code 對齊（延遲 <Tex>D</Tex>）、GMAC 累加
              </td>
              <td>code 與誤差必須是同一個 reference cycle 的（§16.1 第 2 項）</td>
            </tr>
            <tr>
              <td>Block</td>
              <td>
                <Tex>{R`f_u=f_s/N`}</Tex>、<Tex>k</Tex>
              </td>
              <td>
                <Tex>{R`S_k`}</Tex> 完成、清除、右移、乘 <Tex>{R`\mu`}</Tex>
              </td>
              <td>最後一個 sample 是否算進來、清除與下一個 block 第一個 sample 的先後（第 7 項）</td>
            </tr>
            <tr>
              <td>Commit</td>
              <td>
                pipeline <Tex>{R`P_c`}</Tex>
              </td>
              <td>寫入 gain register</td>
              <td>若 calibration logic 與 DTC control 不同 clock，需要 CDC handshake（第 9 項）</td>
            </tr>
            <tr>
              <td>Apply</td>
              <td>block 邊界或立即</td>
              <td>DTC 開始用新的 <Tex>w</Tex></td>
              <td>決定等效更新延遲 <Tex>d</Tex>，進而決定穩定上限 <Tex>{R`g_\mathrm{crit}`}</Tex></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        延遲為什麼會影響穩定？把 <FigRef chart={NOISE_FEEDBACK} /> 走一圈的結果畫成 block rate 的迴路（每個 block 一拍）：comparator、相關與平均合成一個增益 <Tex>{R`K=K_qC`}</Tex>，學習率是 <Tex>{R`\mu`}</Tex>，gain accumulator 是積分器{' '}
        <Tex>{R`1/(z-1)`}</Tex>；「新 gain 晚 <Tex>d</Tex> 個 block 才生效」就是在迴路裡多串一個延遲 <Tex>{R`z^{-d}`}</Tex>。
      </p>
      <MermaidFig
        chart={AVERAGE_LOOP}
        caption={R`一階平均模型的迴路（block rate，索引 $k$）。看藍色的延遲方塊：$d=0$ 時迴路只有一個積分器；每多等一個 block，回授就多晚一拍。`}
        ariaLabel="平均模型迴路：a 減 w 得到 delta，乘 K、乘 mu、延遲 d 個 block、積分得到 w"
      />
      <p>
        <strong>先看</strong>不含延遲的部分：迴路繞一圈的增益是 <Tex>{R`g=\mu K`}</Tex>（無因次的 loop gain：<Tex>{R`\mu`}</Tex> 的 fs 乘上 <Tex>K</Tex> 的 <Tex>{R`\mathrm{fs}^{-1}`}</Tex>）。<Tex>{R`d=0`}</Tex> 時積分器每拍把{' '}
        <Tex>{R`\mu K\delta_k`}</Tex> 加進 <Tex>w</Tex>，所以 <Tex>{R`\delta_{k+1}=(1-g)\,\delta_k`}</Tex>；<Tex>{R`p=1-g`}</Tex> 叫做平均 pole（誤差每個 block 乘上 <Tex>p</Tex>）。<strong>再看</strong>藍色方塊：有延遲時，
        這一拍加進 <Tex>w</Tex> 的修正量是 <Tex>d</Tex> 個 block 以前量到的，所以 <Tex>{R`\delta_{k+1}=\delta_k-g\,\delta_{k-d}`}</Tex>——圖上的 <Tex>{R`z^{-d}`}</Tex> 就是公式裡下標的 <Tex>{R`k-d`}</Tex>。
        延遲越長，迴路越容易「修過頭才發現」，能用的 <Tex>g</Tex> 上限（臨界增益 <Tex>{R`g_\mathrm{crit}`}</Tex>）就越小：
      </p>
      <TexBlock id="F-04.14" label={mt(R`更新延遲 $d$ 個 block 時，平均模型 $\delta_{k+1}=\delta_k-g\,\delta_{k-d}$ 的臨界增益（Ch08 詳述）`)}>
        {R`g_\mathrm{crit}(d)=2\sin\frac{\pi}{4d+2}\qquad(d=0:\,2;\;d=1:\,1;\;d=2:\,0.618)`}
      </TexBlock>
      <LatencyCalculator />
      <p>
        計算器裡「新 gain 何時生效」的選項，差別只在一件事：block <Tex>{R`k+1`}</Tex> 的那 <Tex>N</Tex> 個 sample，DTC 用的是舊 gain 還是新 gain。新 gain 要在 block <Tex>k</Tex> 結束後再過{' '}
        <Tex>{R`P_c`}</Tex> 個 sample 才準備好，有三種處理方式：
      </p>
      <MermaidFig
        chart={APPLY_MODES}
        caption={R`新 gain 何時生效的三種做法（以 $0<P_c<N$ 為例）。看每一欄的第一格——block $k+1$ 裡用的是哪一個 gain——再看第二格它對應的遞迴式與臨界增益。`}
        ariaLabel="等 block 邊界生效、立即生效、丟掉前 P_c 個 sample 三種做法的比較"
      />
      <p>
        <strong>先看</strong>做法 A（藍色，建議的做法）：新 gain 等到下一個 block 邊界才生效，block <Tex>{R`k+1`}</Tex> 整段都還在用舊 gain，等效延遲是整數 <Tex>{R`d=\lceil P_c/N\rceil=1`}</Tex>，代入 F-04.14 得{' '}
        <Tex>{R`g_\mathrm{crit}=1`}</Tex>。<strong>再看</strong>做法 B（紅色）：gain 一準備好就換，block <Tex>{R`k+1`}</Tex> 的前 <Tex>{R`P_c`}</Tex> 個 sample 用舊 gain、其餘用新 gain；把「還在用舊 gain 的比例」記成{' '}
        <strong>分數延遲</strong> <Tex>{R`d_\mathrm{f}=P_c/N`}</Tex>（單位 block，介於 0 與 1 之間）。圖上做法 B 第二格的 <Tex>{R`G_{k+1}\approx K[d_\mathrm{f}\delta_k+(1-d_\mathrm{f})\delta_{k+1}]`}</Tex>{' '}
        就是下面 F-04.17 推導的第 1 步。<strong>最後看</strong>做法 C：乾脆不累加那 <Tex>{R`P_c`}</Tex> 個 sample，延遲回到 <Tex>{R`d=0`}</Tex>，代價是每個 block 少用 <Tex>{R`P_c`}</Tex> 筆資料。
      </p>
      <TexBlock id="F-04.17" label={mt(R`block 中途生效（$d=0$、分數延遲 $d_\mathrm{f}$）時平均模型的臨界增益`)}>
        {R`z^2-\bigl(1-g(1-d_\mathrm{f})\bigr)z+g\,d_\mathrm{f}=0\;\Rightarrow\;\boxed{g_\mathrm{crit}(d_\mathrm{f})=\min\Bigl(\frac{1}{d_\mathrm{f}},\;\frac{2}{1-2d_\mathrm{f}}\Bigr)\;(d_\mathrm{f}<\tfrac12),\qquad\frac{1}{d_\mathrm{f}}\;(d_\mathrm{f}\ge\tfrac12)}`}
      </TexBlock>
      <ModeGate min="engineer">
        <DerivationFold title="commit 在 block 中途生效：分數延遲的特徵方程">
          <p className="small">
            符號：分數延遲寫成 <Tex>{R`d_\mathrm{f}\in[0,1)`}</Tex>（單位 block），不用 <Tex>{R`\varphi`}</Tex>——<Tex>{R`\varphi(z)`}</Tex> 在本章是 Gaussian 密度。先看沒有額外整數延遲（
            <Tex>{R`d=0`}</Tex>、<Tex>{R`P_c<N`}</Tex>）的情形。
          </p>
          <StepDerivation
            steps={[
              { tex: R`G_{k+1}\approx K\Bigl[d_\mathrm{f}\,\delta_k+(1-d_\mathrm{f})\,\delta_{k+1}\Bigr],\quad d_\mathrm{f}=\frac{P_c}{N}`, why: mt(R`block $k+1$ 的前 $P_c$ 個 sample 仍用舊的 $w_k$，其餘用 $w_{k+1}$；平均 GMAC 按 sample 比例加權。`) },
              { tex: R`\delta_{k+2}=\delta_{k+1}-g\bigl[(1-d_\mathrm{f})\,\delta_{k+1}+d_\mathrm{f}\,\delta_k\bigr]`, why: mt(R`代入 $\delta_{k+2}=\delta_{k+1}-\mu G_{k+1}$，$g=\mu K$。`) },
              { tex: R`z^2-\bigl(1-g(1-d_\mathrm{f})\bigr)z+g\,d_\mathrm{f}=0`, why: mt(R`令 $\delta_k=z^k$，兩邊除以 $z^k$，整理成特徵方程。`) },
              { tex: R`a_1:=-(1-g(1-d_\mathrm{f})),\quad a_0:=g\,d_\mathrm{f}`, why: mt(R`把特徵方程寫成標準形 $z^2+a_1z+a_0=0$，方便套用 Jury 條件。`) },
              { tex: R`|a_0|<1:\;g\,d_\mathrm{f}<1;\qquad1-a_1+a_0>0:\;2-g+2g\,d_\mathrm{f}>0;\qquad1+a_1+a_0=g>0`, why: mt(R`Jury 條件：二次式兩根都在單位圓內 $\Leftrightarrow|a_0|<1$ 且 $1\pm a_1+a_0>0$。第三式只要 $g>0$ 就自動成立。`) },
              { tex: R`g_\mathrm{crit}(d_\mathrm{f})=\begin{cases}\min\bigl(\tfrac{1}{d_\mathrm{f}},\tfrac{2}{1-2d_\mathrm{f}}\bigr),&d_\mathrm{f}<\tfrac12\\[2pt]\tfrac{1}{d_\mathrm{f}},&d_\mathrm{f}\ge\tfrac12\end{cases}`, why: mt(R`前兩個條件各解出 $g$ 的上限，取較小者；$d_\mathrm{f}\ge\tfrac12$ 時第二個條件對所有 $g>0$ 都成立。`) },
              { tex: R`d_\mathrm{f}\to0:\;g_\mathrm{crit}\to2;\qquad d_\mathrm{f}=\tfrac14:\;g_\mathrm{crit}=4;\qquad d_\mathrm{f}\to1:\;g_\mathrm{crit}\to1`, why: mt(R`兩端回到 $d=0$ 與 $d=1$ 的整數延遲結果（$2\sin(\pi/6)=1$）；中間反而變大。`) },
              { tex: R`\text{一般情形：}\;\delta_{k+1}=\delta_k-g\bigl[(1-d_\mathrm{f})\,\delta_{k-d}+d_\mathrm{f}\,\delta_{k-d-1}\bigr]\;\Rightarrow\;z^{d+2}-z^{d+1}+g(1-d_\mathrm{f})\,z+g\,d_\mathrm{f}=0`, why: mt(R`再加 $d$ 個整 block 的延遲時，同樣的加權只是整體往前移 $d$ 個 block；$d_\mathrm{f}=0$ 時約掉一個 $z$ 回到 $z^{d+1}-z^d+g=0$（F-04.14）。$d\ge1$ 沒有簡單的封閉式，計算器直接求根。`) },
            ]}
          />
          <p className="small">
            <ClaimTag kind="exact" /> 在平均線性模型下精確（latency.test.ts 以求根與獨立的時域遞迴驗證）。<strong>反直覺</strong>的地方：小的 <Tex>{R`d_\mathrm{f}`}</Tex> 讓 <Tex>{R`g_\mathrm{crit}`}</Tex>{' '}
            先<strong>上升</strong>——舊 <Tex>w</Tex> 的那一小段權重等於對 <Tex>{R`\delta`}</Tex> 做兩點平均，壓低了 <Tex>{R`z=-1`}</Tex> 的振盪模態。但這不是好設計：
            混合 block 讓 <Tex>{R`G_{k+1}`}</Tex> 的統計依賴 commit 時刻，<Tex>{R`P_c`}</Tex> 隨 PVT 或 clock 比例改變時迴路行為跟著變；實務上應該在 block 邊界 commit，並把 <Tex>d</Tex> 計入設計。
            <ClaimTag kind="approx" /> 真正的 sign-LMS 還有 comparator 的非線性與雜訊，<Tex>{R`g_\mathrm{crit}`}</Tex> 只是平均模型的界。
          </p>
        </DerivationFold>
      </ModeGate>
    </Section>
  )
}
