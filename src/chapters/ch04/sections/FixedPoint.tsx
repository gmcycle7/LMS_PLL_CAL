import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import gmacSrc from '@/simulation/models/gmac.ts?raw'
import goldenQuantSrc from '../../../../golden/lms_pll_golden/quantization.py?raw'
import {
  DITHER_MIN,
  accumulatorBitsClosedForm,
  accumulatorBitsRequired,
  accumulatorSizing,
  biasFixedPoint,
  floorRestoringSlope,
  incrementMeanError,
  roundingMeanError,
  wrapTwos,
} from '@/simulation/models/gmac'
import { FixedPointExperiment } from '../experiments/FixedPointExperiment'
import { DerivationFold, Erratum, f, HandCalcBox, tx, mt } from '../common'

const R = String.raw
const GMAC_PATH = 'src/simulation/models/gmac.ts'

/** 取出 golden Python 檔中 §16.1 那一段（該檔沒有 region 標記；以函式名稱為界，內容不改動）。 */
export function sliceGoldenGmac(src: string): string {
  const start = src.indexOf('def accumulator_bits_required')
  if (start < 0) return '# 找不到 golden/lms_pll_golden/quantization.py 的 accumulator_bits_required'
  const tail = src.slice(start)
  const m = /\n(?:def |class |# -{5,})/.exec(tail.slice(tail.indexOf('def gmac_accumulate') + 1))
  const endRel = m ? tail.indexOf('def gmac_accumulate') + 1 + m.index : tail.length
  return tail.slice(0, endRel).trimEnd()
}

/** 預設閉迴路例子的解析數字（與 FixedPointExperiment 預設相同的 datapath） */
export function defaultBiasNumbers(F_G: number) {
  const bx = 6
  const log2N = 10
  const N = 2 ** log2N
  const sigmaV = 100
  const hi = 2 ** (bx - 1) - 1
  let s = 0
  for (let i = -hi; i <= hi; i++) s += i * i
  const ExInt2 = s / (2 * hi + 1)
  const Ex2 = ExInt2 / 4 ** (bx - 1)
  const Kq = Math.sqrt(2 / Math.PI) / sigmaV
  const K = Kq * Ex2
  const ell = log2N - F_G
  const deltaG = 2 ** -F_G / 2 ** (bx - 1)
  const epsFloor = roundingMeanError(ell, 'floor')
  const deltaStar = (-epsFloor * deltaG) / K
  const sigmaS = Math.sqrt(N * ExInt2)
  const mu = 10
  const g = mu * K
  const sigmaW = mu * Math.sqrt(Ex2 / N / (1 - (1 - g) ** 2))
  const ditherRatio = ell > 0 ? sigmaS / 2 ** ell : Infinity
  return { bx, N, ell, deltaG, epsFloor, K, Ex2, deltaStar, sigmaS, sigmaW, mu, g, ditherRatio, rho: floorRestoringSlope(ditherRatio) }
}

/**
 * §5.6 的例子（與 preset gmac-fp-w-truncation 相同）：÷N 用 half-even（F_G = 4），更新量 μ·G 以 floor 取整到 Δ_W = 2^{ℓ_W}·μΔ_G。
 * 回傳 F-04.18 的各項數字；muHalf 是把 μ 減半（Δ_W 不變）後的偏差。
 */
export function wTruncNumbers(ellW = 3, tolFs = 0.1) {
  const d = defaultBiasNumbers(4)
  const muDeltaG = d.mu * d.deltaG
  const wLsb = 2 ** ellW * muDeltaG
  const R = wLsb / muDeltaG
  const eps = incrementMeanError(R, 'floor')
  const bias = (eps * wLsb) / d.g // w* − a
  const Rhalf = wLsb / ((d.mu / 2) * d.deltaG)
  const biasHalf = (incrementMeanError(Rhalf, 'floor') * wLsb) / (d.g / 2)
  const sigmaInc = d.mu * Math.sqrt(d.Ex2 / d.N) // μσ_G：每個 block 更新量的標準差
  const wLsbMax = 2 * d.g * tolFs // Δ_W ≤ 2g·δ_tol
  const physLsb = 0.125 // blockLms gain_register.lsb_fs 的預設值（E13 的 Δ_LSB）
  return { ...d, ellW, muDeltaG, wLsb, R, eps, bias, biasHalf, Rhalf, sigmaInc, ditherW: sigmaInc / wLsb, tolFs, wLsbMax, physLsb, fracBits: Math.ceil(Math.log2(physLsb / wLsbMax)) }
}

/** §5 的條件取負 bug 例子：6-bit full-range uniform code、N = 1024、σ_v = 100 fs、half-even（F-04.15） */
export function negateBugNumbers() {
  const bx = 6
  const sigmaV = 100
  let s = 0
  for (let i = -(2 ** (bx - 1)); i <= 2 ** (bx - 1) - 1; i++) s += i * i
  const Ex2 = s / 2 ** bx / 4 ** (bx - 1)
  const K = (Math.sqrt(2 / Math.PI) / sigmaV) * Ex2
  const pMin = 2 ** -bx
  const deltaStar = biasFixedPoint({ K, sigmaV, roundErr: 0, pMin })
  return { bx, sigmaV, Ex2, K, pMin, deltaStar, approx: pMin / K }
}

/** §5.4 的 windup 例子（與 preset gmac-fp-antiwindup 相同的數字）：W_peak = 32、w_max = 8、a′ = 4 */
export function windupNumbers() {
  const sigmaV = 100
  const mu = 10
  const hi = 31
  let s = 0
  for (let i = -hi; i <= hi; i++) s += i * i
  const Ex2 = s / (2 * hi + 1) / 1024
  const K = (Math.sqrt(2 / Math.PI) / sigmaV) * Ex2
  const Wpeak = 32
  const wMax = 8
  const aNew = 4
  const unwind = (Wpeak - wMax) / (mu * K * Math.abs(aNew - wMax))
  return { mu, K, Wpeak, wMax, aNew, unwind }
}

export function FixedPointSection() {
  const g6 = accumulatorSizing(6, 4096, 'symmetric')
  const ce = { bx: 2, N: 3, exact: accumulatorBitsRequired(2, 3, 'symmetric'), closed: accumulatorBitsClosedForm(2, 3, 'symmetric'), rule: 2 + Math.ceil(Math.log2(3)) }
  const nb = useMemo(() => negateBugNumbers(), [])
  const wu = useMemo(() => windupNumbers(), [])
  const g6full = accumulatorSizing(6, 4096, 'full')
  const wrapped = wrapTwos(31 * 4096, 17)
  const biasRows = useMemo(() => [0, 2, 4, 8].map((F) => ({ F, ...defaultBiasNumbers(F) })), [])
  const b2 = biasRows[1]
  const golden = useMemo(() => sliceGoldenGmac(goldenQuantSrc), [])
  const wt = useMemo(() => wTruncNumbers(), [])
  const rhoRows = useMemo(() => [1, 0.5, DITHER_MIN, 0.142].map((sv) => ({ s: sv, rho: floorRestoringSlope(sv) })), [])
  return (
    <Section kind="formula" title="§5 定點 GMAC：位元數、右移、rounding 與飽和" level={2} id="ch04-fixed">
      <p>
        浮點模型裡 <Tex>{R`G_k=S_k/N`}</Tex> 是一個精確的實數。RTL 裡每一步都有位元寬度：code 有 <Tex>{R`B_x`}</Tex> bits、累加器有 <Tex>{R`B_\mathrm{acc}`}</Tex>{' '}
        bits、「<Tex>{R`\div N`}</Tex>」是右移、右移要取整、gain accumulator 有上下限。這一節逐一推導它們會造成什麼誤差（規格 §16.1 第 3–8 項）。
      </p>

      <h3>1. 累加器要幾個 bit？</h3>
      <DerivationFold title="最壞情況的位元數">
        <StepDerivation
          steps={[
            { tex: R`x_\mathrm{int}\in[-2^{B_x-1},\;2^{B_x-1}-1]`, why: mt(R`有號 $B_x$-bit code 的範圍（二補數，負的一邊多一個）。`) },
            { tex: R`q\cdot x_\mathrm{int}\in[-2^{B_x-1},\;+2^{B_x-1}]\;\Rightarrow\;|q\,x_\mathrm{int}|\le2^{B_x-1}`, why: mt(R`$q=-1$ 時把範圍翻過來，最負 code 取負後是 $+2^{B_x-1}$。`) },
            { tex: R`M_x:=\max|q\,x_\mathrm{int}|=\begin{cases}2^{B_x-1},&\text{full range}\\2^{B_x-1}-1,&\text{symmetric（不含最負 code）}\end{cases}`, why: mt(R`把兩種 code 範圍的「單筆最大乘積」記成 $M_x$；對稱範圍排除了 $-2^{B_x-1}$。`) },
            { tex: R`|S_k|=\Bigl|\sum_{n=1}^{N}q\,x_\mathrm{int}\Bigr|\le\sum_{n=1}^{N}|q\,x_\mathrm{int}|\le N\,M_x`, why: mt(R`三角不等式；等號在 $N$ 個乘積全部同號且都取最大值時成立（例如剛開機、$\delta$ 很大、code 一直是最負值）。`) },
            { tex: R`B_\mathrm{acc}\text{-bit 有號暫存器：}[-2^{B_\mathrm{acc}-1},\;2^{B_\mathrm{acc}-1}-1]`, why: '二補數範圍。' },
            { tex: R`2^{B_\mathrm{acc}-1}-1\ge N M_x\;\Longleftrightarrow\;B_\mathrm{acc}\ge1+\log_2(NM_x+1)`, why: mt(R`正的一邊比較緊（少 1）；兩邊加 1 再取 $\log_2$。`) },
            { tex: R`B_\mathrm{acc}=1+\bigl\lceil\log_2(NM_x+1)\bigr\rceil`, why: mt(R`位元數是整數，取上整數就是最少位元數（精確，F-04.9）。`) },
            { tex: R`\text{full：}\;1+\bigl\lceil\log_2(N2^{B_x-1}+1)\bigr\rceil=B_x+\lfloor\log_2N\rfloor+1`, why: mt(R`$\log_2(N2^{B_x-1}+1)=B_x-1+\log_2(N+2^{1-B_x})$，而 $N$ 加上一個小於 1 的正數後，$\lceil\log_2(\cdot)\rceil=\lfloor\log_2N\rfloor+1$。`) },
            { tex: R`\text{symmetric：}\;N(2^{B_x-1}-1)+1\le N2^{B_x-1}\le2^{B_x-1+\lceil\log_2N\rceil}\;\Rightarrow\;B_\mathrm{acc}\le B_x+\lceil\log_2N\rceil`, why: mt(R`所以常用的 $B_x+\lceil\log_2N\rceil$ 對對稱 code 一定夠；$N=2^m$ 時兩邊相等（不能再少）。`) },
          ]}
          result={R`N=2^m:\quad B_\mathrm{acc}=B_x+m\;(\text{symmetric}),\qquad B_\mathrm{acc}=B_x+m+1\;(\text{full range})`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 反例提醒「<Tex>{R`B_x+\lceil\log_2N\rceil`}</Tex>」只是充分條件：<Tex>{R`B_x=${ce.bx},\;N=${ce.N}`}</Tex>（對稱 code <Tex>{R`|x|\le1`}</Tex>，<Tex>{R`|S|\le3`}</Tex>）只需要{' '}
          <Tex>{R`${ce.exact}`}</Tex> bits（窮舉 {ce.exact}、封閉式 {ce.closed}），經驗法則給 {ce.rule}。反過來，full range 且 <Tex>{R`N=2^m`}</Tex> 時經驗法則<strong>少 1 bit</strong>。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.9" label="GMAC accumulator 位元數（最壞情況的最少有號位元數，精確）">
        {R`\boxed{B_\mathrm{acc}=1+\bigl\lceil\log_2(NM_x+1)\bigr\rceil},\qquad B_\mathrm{acc}^\mathrm{sym}\le B_x+\lceil\log_2N\rceil\;(N=2^m\text{ 時取等號}),\qquad B_\mathrm{acc}^\mathrm{full}=B_x+\lfloor\log_2N\rfloor+1`}
      </TexBlock>
      <p>
        規格 golden 的例子：6-bit code、<Tex>{R`N=4096`}</Tex>，對稱範圍需要 <Tex>{R`${g6.bitsExact}`}</Tex> bits（full range 需要 <Tex>{R`${g6full.bitsExact}`}</Tex>）。
        如果只給 17 bits，最壞情況 <Tex>{R`31\times4096=126976`}</Tex> 會 wrap 成 <Tex>{R`${wrapped}`}</Tex>——<strong>不只變小，還變號</strong>，更新方向與正確方向相反。
        <ClaimTag kind="exact" />
      </p>
      <HandCalcBox id="HC-04.6">
        把 <Tex>{R`B_x`}</Tex>、<Tex>N</Tex> 換成你 RTL 裡的數字（<Tex>N</Tex> 不一定要是 2 的冪，也試試含最負 code 的 full range），先在紙上算出最壞情況的總和與需要的位元數，再故意少給 1 bit，看它 wrap
        成多少。
      </HandCalcBox>
      <Callout kind="warn" title="overflow 偏偏發生在迴路最需要正確方向的時候">
        收斂附近 <Tex>q</Tex> 和 <Tex>x</Tex> 幾乎無關，<Tex>S</Tex> 像隨機漫步，標準差只有 <Tex>{R`\sqrt{N\,E[x_\mathrm{int}^2]}`}</Tex>，遠小於最壞情況。
        但剛開機或 PVT 突變時 <Tex>{R`|\delta|\gg\sigma_v`}</Tex>，<Tex>{R`q\approx\mathrm{sign}(\delta x)`}</Tex>，<Tex>{R`S\approx N\,E|x_\mathrm{int}|`}</Tex> 線性成長——
        這時 wrap 讓 gain 往錯的方向走。只用「穩態模擬沒看到 overflow」不能證明位元數夠（§16.3：要用最壞情況或明定的 sweep）。saturate 至少保住正負號。
      </Callout>
      <CodeCompare
        items={[
          { label: '窮舉最壞情況', source: gmacSrc, region: 'accumulatorBits', path: GMAC_PATH, note: '直接檢查最壞的正、負總和' },
          { label: 'F-04.9 封閉式', source: gmacSrc, region: 'accumulatorBitsClosedForm', path: GMAC_PATH, note: R`$1+\lceil\log_2(NM_x+1)\rceil$` },
        ]}
        caption={R`兩種寫法在 $B_x=2\ldots16$、$N=1\ldots5000$ 全部一致（gmac.test.ts）；頁面上的位元數表與面板 A 都由它們計算。`}
      />
      <CodeCompare
        items={[
          { label: 'wrapTwos', source: gmacSrc, region: 'wrapTwos', path: GMAC_PATH, note: '未保護的暫存器' },
          { label: 'saturateTwos', source: gmacSrc, region: 'saturateTwos', path: GMAC_PATH, note: '飽和在 rail，保住正負號' },
        ]}
      />
      <ModeGate min="research">
        <DerivationFold badge="Python" title="Golden model 對照（golden/lms_pll_golden/quantization.py 的 §16.1 段落，原文）" openAt="research">
          <CodeBlock
            source={golden}
            lang="python"
            path="golden/lms_pll_golden/quantization.py"
            title="accumulator_bits_required / wrap_twos_complement / gmac_accumulate"
            caption={R`Python 的 $B_x+\lceil\log_2N\rceil$ 對應本站 symmetric 範圍；full range 的 $+1$ bit 由 TS 的 accumulatorBitsRequired 處理（gmac.test.ts 比對兩者）。`}
          />
        </DerivationFold>
      </ModeGate>

      <h3>
        2. 「<Tex>{R`\div N`}</Tex>」就是右移：保留幾個小數位元？
      </h3>
      <p>
        <Tex>N</Tex> 取 2 的冪時，<Tex>{R`S/N`}</Tex> 就是算術右移 <Tex>{R`\log_2N`}</Tex> bits，不需要除法器。但完全右移會把 <Tex>G</Tex> 截成整數個 code LSB——
        收斂附近 <Tex>{R`|E[G]|`}</Tex> 遠小於 1 LSB，全部變成 <Tex>0</Tex> 或 <Tex>-1</Tex>。所以要保留 <Tex>{R`F_G`}</Tex> 個小數位元，實際右移 <Tex>{R`\ell=\log_2N-F_G`}</Tex>，
        <Tex>G</Tex> 的解析度為 <Tex>{R`2^{-F_G}`}</Tex> code LSB，換成正規化單位是
      </p>
      <TexBlock>{R`\Delta_G=\frac{2^{-F_G}}{2^{B_x-1}}`}</TexBlock>
      <p>
        RTL 常把「<Tex>{R`\div N`}</Tex>」和「<Tex>{R`\times\mu`}</Tex>」合併成一次右移（<Tex>{R`\mu`}</Tex> 也取 2 的冪）。這沒問題，但文件與暫存器名稱必須寫清楚等效的 <Tex>{R`\mu`}</Tex> 是 average 意義還是 sum 意義
        （§16.1 第 4 項：<strong>不能只看 RTL 名字相同</strong>）。<Tex>N</Tex> 不是 2 的冪時需要乘上常數 <Tex>{R`1/N`}</Tex> 的近似值，多一個 rounding 點與 gain 誤差。
      </p>

      <h3>
        3. Rounding：<Tex>{R`G\approx0`}</Tex> 附近的系統偏差
      </h3>
      <DerivationFold title="四種 rounding 的平均誤差">
        <StepDerivation
          steps={[
            { tex: R`S=2^\ell j+\rho,\qquad j\in\mathbb Z,\;\rho\in\{0,1,\dots,2^\ell-1\}`, why: mt(R`把累加器內容寫成「商 $\times2^\ell$ + 餘數」（$\rho$ 就是被右移丟掉的低 $\ell$ bits）。`) },
            { tex: R`Q_\mathrm{floor}(S)=j\;\Rightarrow\;\varepsilon=Q-\frac{S}{2^\ell}=-\frac{\rho}{2^\ell}`, why: mt(R`二補數算術右移就是 floor（朝 $-\infty$），永遠丟掉一個非負的餘數。`) },
            { tex: R`\rho\text{ 均勻}\;\Rightarrow\;\bar\varepsilon_\mathrm{floor}=-\frac{1}{2^\ell}\cdot\frac{1}{2^\ell}\sum_{\rho=0}^{2^\ell-1}\rho=-\frac{2^\ell-1}{2\cdot2^\ell}=-\frac{1-2^{-\ell}}{2}`, why: mt(R`GMAC 雜訊夠大（$\sigma_S\gtrsim2^\ell$）時餘數近似均勻分布；等差數列求和 $\sum_{\rho=0}^{2^\ell-1}\rho=2^\ell(2^\ell-1)/2$。`) },
            { tex: R`Q_\mathrm{half\,up}=\Bigl\lfloor\frac{S+2^{\ell-1}}{2^\ell}\Bigr\rfloor:\;\varepsilon(\rho)=\begin{cases}-\rho/2^\ell,&\rho<2^{\ell-1}\\1-\rho/2^\ell,&\rho\ge2^{\ell-1}\end{cases}`, why: '餘數小於一半時捨去，大於或等於一半時進位（輸出多 1 個 LSB）。' },
            { tex: R`\bar\varepsilon_\mathrm{half\,up}=\frac{1}{2^\ell}\Bigl[\underbrace{2^{\ell-1}}_{\text{進位的格數}}-\frac{1}{2^\ell}\sum_{\rho=0}^{2^\ell-1}\rho\Bigr]=\frac{1}{2^\ell}\Bigl[2^{\ell-1}-\frac{2^\ell-1}{2}\Bigr]=2^{-\ell-1}`, why: mt(R`對均勻餘數平均：進位的那半邊每格貢獻 $+1$，所有格子都貢獻 $-\rho/2^\ell$；兩者幾乎抵消，只剩「恰好一半」那一格永遠進位造成的半格。`) },
            { tex: R`Q_\mathrm{half\,even}:\;\bar\varepsilon=0`, why: '恰好一半時進位到偶數，奇偶各半，所以這一格也抵消（convergent rounding）。' },
            { tex: R`Q_\mathrm{toward\,0}=\mathrm{sign}(S)\Bigl\lfloor\frac{|S|}{2^\ell}\Bigr\rfloor:\;\bar\varepsilon=-\mathrm{sign}(S)\,\frac{1-2^{-\ell}}{2}`, why: '正數像 floor、負數像 ceil：兩邊都往 0 縮。沒有固定偏差，但在 0 附近形成 dead zone、降低等效增益。' },
          ]}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 在「餘數均勻」的前提下精確；<ClaimTag kind="approx" /> 這個前提需要 GMAC 雜訊當 dither（下方 Research 說明有效範圍）。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.10" label="右移 rounding 的平均誤差（輸出 LSB，均勻餘數）">
        {R`\bar\varepsilon_\mathrm{floor}=-\frac{1-2^{-\ell}}{2},\quad\bar\varepsilon_\mathrm{half\,up}=2^{-\ell-1},\quad\bar\varepsilon_\mathrm{half\,even}=0,\quad\bar\varepsilon_\mathrm{toward\,0}=-\mathrm{sign}(S)\frac{1-2^{-\ell}}{2}`}
      </TexBlock>
      <DerivationFold title="閉迴路：平均誤差變成係數偏差">
        <StepDerivation
          steps={[
            { tex: R`w_{k+1}=w_k+\mu\,Q(G_k),\qquad E[Q(G_k)]=E[G_k]+\bar\varepsilon\,\Delta_G`, why: mt(R`更新使用取整後的 $G$；平均誤差 $\bar\varepsilon$（以 LSB 計）乘上 LSB 大小 $\Delta_G$。`) },
            { tex: R`E[w_{k+1}-w_k]=0\;\Rightarrow\;E[G]=-\bar\varepsilon\,\Delta_G`, why: '穩態時平均更新為 0（固定點）。' },
            { tex: R`E[G]=K\,\delta^*\;\Rightarrow\;\delta^*=-\frac{\bar\varepsilon\,\Delta_G}{K}`, why: mt(R`代入小訊號 $E[G]\approx K\delta$（§4）。`) },
            { tex: R`\text{floor: }\delta^*=\frac{(1-2^{-\ell})\,\Delta_G}{2K}>0\;\Rightarrow\;w^*=a-\delta^*<a`, why: mt(R`floor 的 $\bar\varepsilon<0$：迴路要靠一個正的 $E[G]$ 去抵消截斷，所以 $w$ 停在 $a$ 下方。`) },
          ]}
          result={R`w^*-a=\frac{\bar\varepsilon\,\Delta_G}{K}`}
        />
        <p className="small">
          <ClaimTag kind="approx" /> 平均模型 + 小訊號 + 均勻餘數。<Tex>K</Tex> 越小（雜訊越大、code 越小）偏差越大——偏差和 <Tex>{R`\mu`}</Tex> 無關，所以「調小 <Tex>{R`\mu`}</Tex>」救不了；
          要嘛保留更多 <Tex>{R`F_G`}</Tex>，要嘛改用 round-half-even。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.11" label="Rounding 偏差造成的係數偏移">
        {R`\boxed{\delta^*=a-w^*=-\frac{\bar\varepsilon\,\Delta_G}{K}}\;\Rightarrow\;w^*_\mathrm{floor}\approx a-\frac{(1-2^{-\ell})\,\Delta_G}{2K}`}
      </TexBlock>
      <p>
        數字（6-bit 對稱 uniform code、<Tex>{R`N=1024`}</Tex>、<Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex>，與下方實驗預設相同）<SourceTag kind="illustrative" />：
        <Tex>{R`E[x^2]=${tx(b2.Ex2, 5)}`}</Tex>、<Tex>{R`K=K_qE[x^2]=${tx(b2.K, 4)}\,\mathrm{fs}^{-1}`}</Tex>。floor 時的偏差：
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Tex>{R`F_G`}</Tex>
              </th>
              <th>
                <Tex>{R`\ell=\log_2N-F_G`}</Tex>
              </th>
              <th>
                <Tex>{R`\Delta_G`}</Tex>
              </th>
              <th>
                <Tex>{R`\delta^*=a-w^*`}</Tex> [fs]
              </th>
              <th>
                <Tex>{R`\sigma_S/2^\ell`}</Tex>
              </th>
              <th>
                回復斜率 <Tex>{R`\chi`}</Tex>
              </th>
              <th>預測是否可用</th>
            </tr>
          </thead>
          <tbody>
            {biasRows.map((r) => (
              <tr key={r.F}>
                <td className="num">{r.F}</td>
                <td className="num">{r.ell}</td>
                <td className="num">{f(r.deltaG, 4)}</td>
                <td className="num">{f(r.deltaStar, 4)}</td>
                <td className="num">{f(r.ditherRatio, 3)}</td>
                <td className="num">{f(r.rho, 3)}</td>
                <td>{r.ditherRatio < DITHER_MIN ? '不可用（dead zone）' : r.rho >= 0.9 ? '可用' : '可用（平衡點附近收斂較慢）'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        表中 <Tex>{R`\delta^*>0`}</Tex>：<Tex>w</Tex> 停在 <Tex>a</Tex> <strong>下方</strong>。gmac.test.ts 以 12 個 seeds、每個 3000 blocks 驗證（量的是{' '}
        <Tex>{R`w^*-a=-\delta^*`}</Tex>，以定點 − 浮點的 paired 差估計）：<Tex>{R`F_G=2`}</Tex> 時 <Tex>{R`-1.516\pm0.010\,\mathrm{fs}`}</Tex> vs 預測{' '}
        <Tex>{R`${tx(-b2.deltaStar, 4)}\,\mathrm{fs}`}</Tex>；<Tex>{R`F_G=4`}</Tex> 時 <Tex>{R`-0.370\pm0.004`}</Tex> vs <Tex>{R`${tx(-biasRows[2].deltaStar, 4)}\,\mathrm{fs}`}</Tex>。對照：同條件下{' '}
        <Tex>{R`\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p^2)}\approx${tx(b2.sigmaW, 3)}\,\mathrm{fs}`}</Tex>，所以 <Tex>{R`F_G=2`}</Tex> 的 floor 偏差比穩態抖動還大。
      </p>
      <p className="small">
        <ClaimTag kind="approx" /> 表的最後兩欄：<Tex>{R`\sigma_S/2^\ell`}</Tex> 是「雜訊有幾個輸出 LSB 大」。它不必大於 1——平衡點 <Tex>{R`E[G]=\tfrac12\Delta_G`}</Tex> 靠的是對稱性而不是均勻餘數（下方 Research 說明）；
        雜訊決定的是平衡點附近的回復斜率 <Tex>{R`\chi`}</Tex>（1 = 和沒有取整一樣，0 = dead zone）。多 seed 模擬：<Tex>{R`\sigma_S/2^\ell=0.57`}</Tex>（表中 <Tex>{R`F_G=0`}</Tex>）時{' '}
        <Tex>{R`w^*-a=-6.13\pm0.04\,\mathrm{fs}`}</Tex> vs 預測 <Tex>{R`${tx(-biasRows[0].deltaStar, 3)}\,\mathrm{fs}`}</Tex>；低於約 <Tex>{R`${DITHER_MIN}`}</Tex> 時迴路在有限時間內到不了平衡點，預測不再適用（gmac.test.ts）。
      </p>
      <HandCalcBox id="HC-04.7">
        先拿一個具體的數字感受四種取整：某個 block 累加出 <Tex>{R`S=-300`}</Tex>、右移 <Tex>{R`\ell=8`}</Tex> bits，<Tex>{R`-300/256=-1.17`}</Tex>——floor 給 <Tex>{R`-2`}</Tex>，其他三種都給{' '}
        <Tex>{R`-1`}</Tex>。把 <Tex>S</Tex>、<Tex>{R`F_G`}</Tex>、<Tex>K</Tex> 換成你自己的數字，在紙上算出 floor 平均少掉多少，以及它把 <Tex>w</Tex> 推離 <Tex>a</Tex> 多遠（預設值是上表{' '}
        <Tex>{R`F_G=2`}</Tex> 那一列）。
      </HandCalcBox>
      <ModeGate min="research">
        <Callout kind="info" title="Research：dither 不夠時會怎樣？平衡點為什麼不靠「餘數均勻」？">
          <p>
            設 <Tex>S</Tex> 近似 Gaussian（<Tex>N</Tex> 個獨立項的和，中央極限定理）、標準差 <Tex>{R`\sigma_S`}</Tex>。餘數 <Tex>{R`\rho=S\bmod2^\ell`}</Tex> 的分布由 Poisson summation 給出，
            與均勻分布的偏差由特徵函數在 <Tex>{R`2\pi/2^\ell`}</Tex> 的值決定：
          </p>
          <TexBlock>{R`\bigl|p_\rho(r)-2^{-\ell}\bigr|\lesssim2^{1-\ell}\exp\Bigl(-\frac{2\pi^2\sigma_S^2}{4^{\ell}}\Bigr)`}</TexBlock>
          <p>
            <Tex>{R`\sigma_S/2^\ell=1`}</Tex> 時指數為 <Tex>{R`e^{-2\pi^2}\approx2.7\times10^{-9}`}</Tex>，非常均勻；<Tex>{R`\sigma_S/2^\ell=0.5`}</Tex> 時約 0.007，開始看得到；
            更小時平均誤差隨操作點振盪（面板 B 的 dither 比滑桿）。但<strong>閉迴路的平衡點不受這個振盪影響</strong>。令 <Tex>{R`X=S/2^\ell\sim\mathcal N(m,s^2)`}</Tex>（<Tex>{R`s=\sigma_S/2^\ell`}</Tex>，連續格點極限），
            把 <Tex>{R`\lfloor x\rfloor=x-\tfrac12+\sum_{k\ge1}\frac{\sin2\pi kx}{\pi k}`}</Tex>（sawtooth 的 Fourier 級數）逐項取期望值：
          </p>
          <TexBlock>{R`E\bigl[\lfloor X\rfloor\bigr]=m-\frac12+\sum_{k\ge1}\frac{e^{-2\pi^2k^2s^2}}{\pi k}\sin(2\pi km)\;\;\Rightarrow\;\;E\bigl[\lfloor X\rfloor\bigr]\Big|_{m=\frac12}=0\quad(\text{對任何 }s)`}</TexBlock>
          <p>
            <Tex>{R`m=\tfrac12`}</Tex> 時每個 <Tex>{R`\sin(\pi k)=0`}</Tex>：只要雜訊分布對稱，「真值恰好半個 LSB」永遠讓 floor 的平均輸出為 0，所以 F-04.11 的平衡點對任何 dither 都成立。
            dither 決定的是平衡點附近的<strong>回復斜率</strong>（把上式對 <Tex>m</Tex> 微分）：
          </p>
          <TexBlock>{R`\chi(s)=\frac{dE[\lfloor X\rfloor]}{dm}\Big|_{m=\frac12}=1+2\sum_{k\ge1}(-1)^ke^{-2\pi^2k^2s^2}:\qquad ${rhoRows.map((r) => `\\chi(${tx(r.s, 3)})=${tx(r.rho, 3)}`).join(',\\;')}`}</TexBlock>
          <p>
            局部的 loop gain 變成 <Tex>{R`g\,\chi(s)`}</Tex>。<Tex>{R`s\gtrsim0.5`}</Tex> 幾乎沒有影響；<Tex>{R`s\approx${tx(rhoRows[3].s, 3)}`}</Tex> 時 <Tex>{R`\chi\approx${tx(rhoRows[3].rho, 2)}`}</Tex>，時間常數拉長約 {Math.round(1 / rhoRows[3].rho)} 倍，迴路實際上停在進入 dead zone 的地方
            （多 seed 模擬 <Tex>{R`-4.35\pm0.09`}</Tex> vs 平衡點 <Tex>{R`-6.06\,\mathrm{fs}`}</Tex>）。收斂附近 <Tex>{R`\sigma_S\approx\sqrt{N\,E[x_\mathrm{int}^2]}`}</Tex>。<Tex>{R`\sigma_v\to0`}</Tex>{' '}
            時沒有 dither，rounding 變成確定性的 dead zone / limit cycle 問題（Ch13）。<ClaimTag kind="exact" /> 級數與 <Tex>{R`\chi(s)`}</Tex> 在「Gaussian、連續格點」下精確（<code>floorRestoringSlope</code>）；
            <ClaimTag kind="approx" /> 套用到離散的 <Tex>S</Tex> 與閉迴路。
          </p>
        </Callout>
      </ModeGate>
      <CodeBlock source={gmacSrc} region="shiftRound" path={GMAC_PATH} title="右移 + rounding（四種模式）" />
      <CodeBlock source={gmacSrc} region="roundingMeanError" path={GMAC_PATH} title="均勻餘數下的平均誤差（F-04.10 的程式版）" />

      <h3>4. 最負 code 的取負 bug：偏差有多大？</h3>
      <p>
        §4 證明了「在 <Tex>{R`B_x`}</Tex> bits 內取負」只有最負 code <Tex>{R`-2^{B_x-1}`}</Tex> 會錯。它出現的機率很小（uniform 6-bit code 為 <Tex>{R`1/64`}</Tex>），但錯的方向永遠相同，
        所以平均起來是一個<strong>固定的偏差</strong>，和 rounding 偏差一樣不會被 <Tex>{R`\mu`}</Tex> 或 <Tex>N</Tex> 平均掉。
      </p>
      <DerivationFold title="取負 bug 的平均誤差與固定點">
        <StepDerivation
          steps={[
            { tex: R`x_\mathrm{int}=-2^{B_x-1},\;b=0:\quad\underbrace{-2^{B_x-1}}_{\text{bug}}-\underbrace{(+2^{B_x-1})}_{\text{正確}}=-2^{B_x}\;\text{LSB}=-2\;(\text{正規化})`, why: mt(R`bug 把應加的 $+2^{B_x-1}$ 加成 $-2^{B_x-1}$；除以 full scale $2^{B_x-1}$ 得正規化差 $-2$。$b=1$ 時不需取負，沒有錯。`) },
            { tex: R`P(b=0\mid x=-1)=P(-\delta+v<0)=\Phi\Bigl(\frac{\delta}{\sigma_v}\Bigr)`, why: mt(R`正規化 code $x=-1$ 時 $e=\delta\cdot(-1)+v$；$v\sim\mathcal N(0,\sigma_v^2)$。`) },
            { tex: R`E[G\mid\delta]\approx K\delta+\bar\varepsilon\,\Delta_G-2\,p_\mathrm{min}\,\Phi\Bigl(\frac{\delta}{\sigma_v}\Bigr)`, why: mt(R`平均 GMAC = 正確的部分（§4 的 $K\delta$）+ rounding 平均誤差 + 每個 sample 以機率 $p_\mathrm{min}\Phi$ 多出的 $-2$。`) },
            { tex: R`E[G\mid\delta^*]=0\;\Rightarrow\;K\delta^*=2\,p_\mathrm{min}\Phi\Bigl(\frac{\delta^*}{\sigma_v}\Bigr)-\bar\varepsilon\,\Delta_G`, why: mt(R`固定點：平均更新為 0。右邊對 $\delta$ 變化很慢（斜率 $2p_\mathrm{min}\varphi/\sigma_v\ll K$），用二分法求根（biasFixedPoint）。`) },
            { tex: R`\Phi\approx\tfrac12,\;\bar\varepsilon=0:\quad\delta^*\approx\frac{p_\mathrm{min}}{K},\qquad w^*-a\approx-\frac{p_\mathrm{min}}{K}`, why: mt(R`$|\delta^*|\ll\sigma_v$ 時 $\Phi\approx\tfrac12$；$w$ 停在 $a$ 下方（bug 讓 $S$ 系統性偏負）。`) },
          ]}
          result={R`B_x=${nb.bx},\;p_\mathrm{min}=1/${2 ** nb.bx},\;K=${tx(nb.K, 5)}\,\mathrm{fs}^{-1}:\quad w^*-a=${tx(-nb.deltaStar, 4)}\,\mathrm{fs}\;(\text{近似 }${tx(-nb.approx, 4)})`}
        />
        <p className="small">
          <ClaimTag kind="approx" /> 平均模型 + 小訊號 <Tex>K</Tex>。實驗 preset「條件取負的最負 code 陷阱」（同樣的 6-bit full range、<Tex>{R`\sigma_v=${nb.sigmaV}\,\mathrm{fs}`}</Tex>）的模擬值約{' '}
          <Tex>{R`-6.08\pm0.09\,\mathrm{fs}`}</Tex>，與自洽解一致；面板 C 的表格會同時列出預測值。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.15" label="條件取負 bug 造成的係數偏移">
        {R`K\delta^*+\bar\varepsilon\,\Delta_G-2\,p_\mathrm{min}\,\Phi\!\Bigl(\frac{\delta^*}{\sigma_v}\Bigr)=0\;\Rightarrow\;w^*-a=-\delta^*\approx-\frac{p_\mathrm{min}}{K}`}
      </TexBlock>
      <CodeBlock source={gmacSrc} region="biasFixedPoint" path={GMAC_PATH} title="rounding 與取負 bug 的固定點（F-04.11、F-04.15）" />

      <h3>5. 飽和與 anti-windup</h3>
      <p>
        DTC 的 gain trim 有範圍 <Tex>{R`[w_\mathrm{min},w_\mathrm{max}]`}</Tex>。若某個 PVT corner 的真實 <Tex>a</Tex> 超出範圍，gain 只能停在 rail。問題在於高解析的內部累加器{' '}
        <Tex>W</Tex> 通常比實體範圍寬：如果只在<strong>輸出</strong>端 clamp，<Tex>W</Tex> 會繼續往外積分（windup）。
      </p>
      <DerivationFold title="沒有 anti-windup 的回復時間">
        <StepDerivation
          steps={[
            { tex: R`a>w_\mathrm{max}\;\Rightarrow\;w_\mathrm{applied}=w_\mathrm{max},\;\delta=a-w_\mathrm{max}>0`, why: 'DTC 只能實現 rail 上的 gain；殘差不會消失。' },
            { tex: R`W_{k+1}=W_k+\mu G_k,\quad E[G_k]=K\,(a-w_\mathrm{max})>0`, why: '誤差持續為正，平均更新持續為正（小訊號）。' },
            { tex: R`W_k\approx w_\mathrm{max}+\mu K(a-w_\mathrm{max})\,(k-k_0)\;\to\;W_\mathrm{peak}`, why: mt(R`線性爬升，直到內部暫存器的上限或 $a$ 改變。`) },
            { tex: R`a\to a'<w_\mathrm{max}:\;E[G]=K(a'-w_\mathrm{max})<0`, why: mt(R`$a$ 回到範圍內，但只要 $W>w_\mathrm{max}$，實際作用的 gain 仍停在 $w_\mathrm{max}$。`) },
            { tex: R`T_\mathrm{unwind}\approx\frac{W_\mathrm{peak}-w_\mathrm{max}}{\mu K\,|a'-w_\mathrm{max}|}`, why: mt(R`$W$ 以 $\mu K|a'-w_\mathrm{max}|$ 的速率往回走，必須先「放掉」多積的量。`) },
            { tex: R`\text{anti-windup: }W\in[w_\mathrm{min},w_\mathrm{max}]\Rightarrow W_\mathrm{peak}=w_\mathrm{max}\Rightarrow T_\mathrm{unwind}=0`, why: '把積分器本身夾在實體範圍內，誤差一反向就立刻離開 rail。' },
          ]}
        />
      </DerivationFold>
      <TexBlock id="F-04.12" label="沒有 anti-windup 時的回復時間">
        {R`T_\mathrm{unwind}\approx\frac{W_\mathrm{peak}-w_\mathrm{max}}{\mu K\,|a'-w_\mathrm{max}|}\;[\text{blocks}]`}
      </TexBlock>
      <p>
        數字（preset「anti-windup」的設定）<SourceTag kind="illustrative" />：<Tex>{R`W_\mathrm{peak}=${wu.Wpeak},\;w_\mathrm{max}=${wu.wMax},\;a'=${wu.aNew}\,\mathrm{fs}`}</Tex>、<Tex>{R`\mu=${wu.mu}\,\mathrm{fs}`}</Tex>、
        <Tex>{R`K=${tx(wu.K, 5)}\,\mathrm{fs}^{-1}`}</Tex>，代入得 <Tex>{R`T_\mathrm{unwind}\approx\frac{${wu.Wpeak}-${wu.wMax}}{${wu.mu}\times${tx(wu.K, 4)}\times${Math.abs(wu.aNew - wu.wMax)}}=${tx(wu.unwind, 4)}`}</Tex> blocks；
        之後還要從 rail 以 pole <Tex>{R`1-g`}</Tex> 收斂到目標。面板 C 的表格把「放掉 windup + 指數收斂」的預測和模擬並列（模擬約 243 blocks，anti-windup 只要約 7 blocks）。
      </p>
      <p>
        更糟的是內部暫存器用 <strong>wrap</strong>：<Tex>W</Tex> 超過上限時跳到下限，實際 gain 由 <Tex>{R`w_\mathrm{max}`}</Tex> 直接跳到 <Tex>{R`w_\mathrm{min}`}</Tex>，
        PD 殘差瞬間變成最大。<ClaimTag kind="approx" /> 回復時間公式為線性小訊號估計；實驗的「anti-windup」preset 直接比較三種做法。
      </p>

      <h3>
        6. 「<Tex>{R`\times\mu`}</Tex>」也是右移：<Tex>W</Tex> 要幾個小數位元？（§16.1 第 6 項）
      </h3>
      <p>
        <strong>一個問題：</strong>為了壓低 <Tex>{R`\sigma_w`}</Tex>，把 <Tex>{R`\mu`}</Tex> 調成一半。浮點模型說偏差不變、雜訊變小；RTL 裡卻可能看到 <Tex>w</Tex> 離 <Tex>a</Tex>{' '}
        <strong>更遠</strong>。原因是第二個截斷點：更新量 <Tex>{R`\mu\,Q(G_k)`}</Tex> 加進 <Tex>W</Tex> 之前，要先對齊 <Tex>W</Tex> 的 LSB <Tex>{R`\Delta_W`}</Tex>
        （RTL 把「<Tex>{R`\times\mu`}</Tex>」做成再右移 <Tex>{R`\ell_W`}</Tex> bits，或 <Tex>W</Tex> 的小數位元不夠）。
      </p>
      <DerivationFold title={mt(R`第二個截斷點：$w^*-a=\bar\varepsilon_W\Delta_W/g$`)}>
        <StepDerivation
          steps={[
            { tex: R`\mu\,Q(G_k)=j_k\cdot\mu\Delta_G,\qquad j_k\in\mathbb Z`, why: mt(R`取整後的 $G$ 是 $\Delta_G$ 的整數倍，所以更新量落在間距 $\mu\Delta_G$ 的格點上。`) },
            { tex: R`\Delta_W=R\cdot\mu\Delta_G,\qquad R=2^{\ell_W}`, why: mt(R`$W$ 的格點比更新量的格點粗 $R$ 倍：等於把更新量再右移 $\ell_W$ bits 才加進 $W$。`) },
            { tex: R`Q_W^\mathrm{floor}(\mu G)-\mu G=-\frac{\rho_W}{R}\,\Delta_W,\qquad\rho_W=j_k\bmod R\in\{0,\dots,R-1\}`, why: mt(R`和 §5.3 的第 1–2 步一樣：floor 丟掉一個非負的餘數（這次單位是 $\Delta_W$）。`) },
            { tex: R`\bar\varepsilon_W=-\frac{1}{R}\cdot\frac1R\sum_{\rho_W=0}^{R-1}\rho_W=-\frac{1-1/R}{2}\quad[\Delta_W]`, why: mt(R`餘數均勻時取平均（等差數列和 $R(R-1)/2$）；half-even 則為 0。`) },
            { tex: R`E[W_{k+1}-W_k]=\mu\,E[G]+\bar\varepsilon_W\Delta_W=\mu K\delta+\bar\varepsilon_W\Delta_W`, why: mt(R`每個 block 的平均更新 = 理想更新 + 取整的平均誤差；代入 $E[G]\approx K\delta$（這裡「$\div N$」的右移用 half-even，$\bar\varepsilon=0$）。`) },
            { tex: R`E[W_{k+1}-W_k]=0\;\Rightarrow\;\delta^*=-\frac{\bar\varepsilon_W\Delta_W}{\mu K}=-\frac{\bar\varepsilon_W\Delta_W}{g}`, why: mt(R`固定點：平均更新為 0；$g=\mu K$。`) },
            { tex: R`\text{floor: }w^*-a=-\delta^*=-\frac{(1-1/R)\,\Delta_W}{2g}\approx-\frac{\Delta_W}{2g}`, why: mt(R`$w$ 停在 $a$ 下方「半個 $W$-LSB 除以 loop gain」的地方。$\Delta_W$ 是固定的硬體格點，所以 $\mu$（也就是 $g$）越小偏差越大。`) },
            { tex: R`\text{兩個 floor 串接：}\;w^*-a=\frac{\bar\varepsilon\,\Delta_G}{K}+\frac{\bar\varepsilon_W\Delta_W}{g}=-\frac{(1-2^{-(\ell+\ell_W)})\,\Delta_W}{2g}`, why: mt(R`$\lfloor\lfloor S/2^\ell\rfloor/2^{\ell_W}\rfloor=\lfloor S/2^{\ell+\ell_W}\rfloor$：先後兩次 floor 等於一次右移 $\ell+\ell_W$ bits；代入 $\mu\Delta_G=\Delta_W2^{-\ell_W}$ 可驗證兩項相加正好是右邊。`) },
          ]}
          result={R`\Delta_W\le2g\,\delta_\mathrm{tol}\quad(\text{floor；或改用 half-even})`}
        />
        <p className="small">
          <ClaimTag kind="approx" /> 平均模型 + 小訊號 + 更新量的雜訊足以當 dither（<Tex>{R`\mu\sigma_G/\Delta_W\gtrsim${DITHER_MIN}`}</Tex>，<Tex>{R`\sigma_G=\sqrt{E[x^2]/N}`}</Tex>）。和 §5.3 對照：
          那裡的「LSB」是 <Tex>{R`\mu\Delta_G`}</Tex>，跟著 <Tex>{R`\mu`}</Tex> 一起縮小，所以偏差與 <Tex>{R`\mu`}</Tex> 無關；這裡的 <Tex>{R`\Delta_W`}</Tex> 不跟著縮，偏差 <Tex>{R`\propto1/g`}</Tex>。
          <Tex>R</Tex> 不是整數時（<Tex>{R`\mu`}</Tex> 不是 2 的冪），把 <Tex>{R`R=p/q`}</Tex> 約成最簡分數，餘數只有 <Tex>p</Tex> 種，<Tex>{R`\bar\varepsilon_W=-(1-1/p)/2`}</Tex>（<code>incrementMeanError</code>）。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.18" label={mt(R`更新量取整到 $W$ 的 LSB（第二個截斷點）造成的係數偏移`)}>
        {R`\boxed{w^*-a=\frac{\bar\varepsilon_W\,\Delta_W}{g}},\qquad\bar\varepsilon_W^\mathrm{floor}=-\frac{1-1/R}{2},\quad R=\frac{\Delta_W}{\mu\Delta_G}\;\;\Rightarrow\;\;w^*_\mathrm{floor}\approx a-\frac{\Delta_W}{2g}`}
      </TexBlock>
      <p>
        數字（與 preset「第二個截斷點」相同）<SourceTag kind="illustrative" />：<Tex>{R`\mu=${wt.mu}\,\mathrm{fs}`}</Tex>、<Tex>{R`F_G=4\Rightarrow\mu\Delta_G=${tx(wt.muDeltaG, 5)}\,\mathrm{fs}`}</Tex>、
        <Tex>{R`g=\mu K=${tx(wt.g, 4)}`}</Tex>。若 <Tex>W</Tex> 的 LSB 是 <Tex>{R`\Delta_W=2^{${wt.ellW}}\mu\Delta_G=${tx(wt.wLsb, 6)}\,\mathrm{fs}`}</Tex>（<Tex>{R`R=${wt.R}`}</Tex>）並用 floor：
      </p>
      <TexBlock>
        {R`w^*-a=\frac{\bar\varepsilon_W\Delta_W}{g}=\frac{${tx(wt.eps, 4)}\times${tx(wt.wLsb, 6)}}{${tx(wt.g, 4)}}=${tx(wt.bias, 4)}\,\mathrm{fs};\qquad\mu\to\tfrac{\mu}{2}:\;R=${wt.Rhalf},\;w^*-a=${tx(wt.biasHalf, 4)}\,\mathrm{fs}`}
      </TexBlock>
      <p>
        多 seed 模擬（gmac.test.ts，8 個 seed、每個 2000 blocks）：<Tex>{R`-2.68\pm0.02\,\mathrm{fs}`}</Tex> 與 <Tex>{R`\mu`}</Tex> 減半後的 <Tex>{R`-5.66\pm0.05\,\mathrm{fs}`}</Tex>——偏差加倍，比 §5.3 的截斷偏差（
        <Tex>{R`${tx(-biasRows[2].deltaStar, 3)}\,\mathrm{fs}`}</Tex>）大得多；half-even 時為 <Tex>{R`-0.02\pm0.02\,\mathrm{fs}`}</Tex>。對照：每個 block 的更新量標準差 <Tex>{R`\mu\sigma_G=${tx(wt.sigmaInc, 4)}\,\mathrm{fs}`}</Tex>，
        <Tex>{R`\mu\sigma_G/\Delta_W=${tx(wt.ditherW, 3)}`}</Tex>。設計規則：若要 floor 的偏差小於 <Tex>{R`\delta_\mathrm{tol}=${wt.tolFs}\,\mathrm{fs}`}</Tex>，需要{' '}
        <Tex>{R`\Delta_W\le2g\,\delta_\mathrm{tol}=${tx(wt.wLsbMax, 3)}\,\mathrm{fs}`}</Tex>；實體 DTC gain 的 LSB 若為 <Tex>{R`${wt.physLsb}\,\mathrm{fs}`}</Tex>（Ch13 的 <Tex>{R`\Delta_\mathrm{LSB}`}</Tex> <Erratum id="E13" />），
        <Tex>W</Tex> 至少要在它下面再保留 <Tex>{R`\lceil\log_2(${wt.physLsb}/${tx(wt.wLsbMax, 3)})\rceil=${wt.fracBits}`}</Tex> 個小數位元。<ClaimTag kind="approx" />
      </p>
      <CodeBlock source={gmacSrc} region="quantizeIncrement" path={GMAC_PATH} title={R`更新量取整到 $W$ 的 LSB（第二個截斷點）`} />
      <CodeBlock source={gmacSrc} region="gainUpdate" path={GMAC_PATH} title="gain accumulator：saturation / anti-windup / wrap" />
      <CodeCompare
        items={[
          { label: '一個 block 的位元級 GMAC', source: gmacSrc, region: 'fixedGmacBlock', path: GMAC_PATH, note: R`取負 → $B_\mathrm{acc}$-bit 累加 → 右移 rounding` },
          { label: '閉迴路：定點 vs 浮點', source: gmacSrc, region: 'fixedLoopBlock', path: GMAC_PATH, note: '同一組 code 與雜訊，只有 datapath 不同' },
        ]}
        layout="tabs"
      />
      <FixedPointExperiment />
    </Section>
  )
}
