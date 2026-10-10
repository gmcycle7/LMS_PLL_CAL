import { useMemo, type ReactNode } from 'react'
import gmacSrc from '@/simulation/models/gmac.ts?raw'
import { roundingMeanError } from '@/simulation/models/gmac'
import blockLmsSrc from '@/simulation/models/blockLms.ts?raw'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, Section, Tex, TexBlock } from '@/components'
import { ChLink, ErratumNote, HandCalcPointer, Steps, md, sig, texNum } from '../common'
import { GmacSizingLab } from '../experiments/GmacSizingLab'
import { accBitsExact, truncationEquilibrium, worstCaseAccumulate } from '../experiments/gmacMath'
import { SPEC_NUMBERS, alignmentDemo, gCritical, limitCycleDemo } from '../refNumbers'

interface Check {
  no: number
  /** 標題（可含 $...$） */
  title: string
  what: ReactNode
  why: ReactNode
  verify: ReactNode
  site: ReactNode
  status: 'full' | 'partial' | 'none'
  presets?: { id: string; label: string }[]
}

/** 「=數值」或「≈0」：|x| < 10⁻³ fs 時不顯示成精確的 0 */
function nearZero(x: number): string {
  return Math.abs(x) < 1e-3 ? '\\approx0' : `=${texNum(x, 3)}`
}

const STATUS: Record<Check['status'], string> = { full: '本站可模擬', partial: '本站部分模擬', none: '本站未模擬（Not implemented）' }

function PresetLinks({ presets }: { presets?: Check['presets'] }) {
  if (!presets || presets.length === 0) return null
  return (
    <div className="models-preset-links small">
      重現（套用到 §6 JSON Lab）：
      {presets.map((p) => (
        <ChLink key={p.id} to={`/models?preset=${p.id}`}>
          {md(p.label)}
        </ChLink>
      ))}
    </div>
  )
}

interface MatrixRow {
  name: string
  what: ReactNode
  how: ReactNode
  site: ReactNode
  status: Check['status']
}

/** 規格 §16.2 Sign-off Matrix（前三欄為規格原文）＋ 本站能做到哪裡 */
const MATRIX: MatrixRow[] = [
  {
    name: '基本正確性',
    what: md('Error 極性、$w$ 更新方向'),
    how: md('freeze + $\\pm\\Delta w$ perturbation'),
    site: (
      <>
        {md('JSON Lab 解析區塊的 mean-field 斜率 $K_\\mathrm{mf}=-\\partial E[G]/\\partial w=-S_\\mathrm{GMAC}$（$K_\\mathrm{mf}>0$，即 $S_\\mathrm{GMAC}<0$，才有恢復力）、極性 preset；')}
        <ChLink to="/ch/06">Ch06</ChLink>
      </>
    ),
    status: 'full',
  },
  {
    name: 'Corner',
    what: 'TT/SS/FF、不同 V/T、不同 BW',
    how: 'Jacobian、Poles、Noise、Bias',
    site: (
      <>
        {md('沒有 PVT 模型：只能手動改 $\\sigma_v$、$a$、$\\omega_nT_s$ 當作 corner；$K_{\\min}\\ldots K_{\\max}$ 的 $\\mu$ 區間見 ')}
        <ChLink to="/ch/14">Ch14</ChLink>
      </>
    ),
    status: 'partial',
  },
  {
    name: 'FCW',
    what: 'Integer、Near-Integer、Near-Grid、隨機 Rational',
    how: md('PSD、PE、$S_\\mathrm{GMAC}$、spur'),
    site: (
      <>
        seeded_pattern 的 dsm_first_order / mash111（frac、bits）；<ChLink to="/ch/09">Ch09 PE</ChLink>、<ChLink to="/ch/11">Ch11 near-integer</ChLink>
      </>
    ),
    status: 'partial',
  },
  {
    name: 'Noise',
    what: 'White、colored、correlated、comparator offset',
    how: '多 seeds、confidence intervals',
    site: 'white 與 offset：JSON Lab（8-seed Monte Carlo、Student-t 95% CI）；colored / correlated：Not implemented（Backlog R1）',
    status: 'partial',
  },
  {
    name: '非線性',
    what: 'DTC INL、Clipping、BBPD Saturation',
    how: 'fixed point、limit cycle、bias',
    site: (
      <>
        {md('dtc_nonlinearity 的 $c_2,c_3$（mean-field 固定點）、gain register 飽和、comparator 的 $\\operatorname{erf}$ 飽和；')}
        <ChLink to="/ch/11">Ch11</ChLink>、<ChLink to="/ch/13">Ch13</ChLink>
      </>
    ),
    status: 'partial',
  },
  {
    name: '多參數',
    what: 'GOS/PHOS/Gain cross-coupling',
    how: 'singular values、combined eigenvalues',
    site: (
      <>
        JSON Lab 只有單一 gain；多參數在 <ChLink to="/ch/09">Ch09</ChLink>、<ChLink to="/ch/10">Ch10</ChLink>、<ChLink to="/case/sspll">SSPLL 案例</ChLink>
      </>
    ),
    status: 'partial',
  },
  {
    name: '校正策略',
    what: 'background、freeze、coarse/fine、relock',
    how: 'gain code + output PN/jitter/spur',
    site: (
      <>
        <ChLink to="/ch/14">Ch14 校正狀態機</ChLink>、<ChLink to="/ch/12">Ch12</ChLink>；事件級 relock 未實作（Backlog R7）
      </>
    ),
    status: 'partial',
  },
]

/** §9 §16.1 十二項硬體檢查 + GMAC datapath + §16.2 Sign-off Matrix */
export function S8Hardware() {
  const n = SPEC_NUMBERS
  const settle100 = Math.log(0.01) / Math.log(n.p)
  const ex = useMemo(() => {
    const sym = accBitsExact(6, 4096, 'symmetric')
    const full = accBitsExact(6, 4096, 'full')
    const sym33 = accBitsExact(6, 33, 'symmetric')
    const wrap17 = worstCaseAccumulate(6, 4096, 'symmetric', 17, 1)
    const wrapFull = worstCaseAccumulate(6, 4096, 'full', full - 1, 1)
    const t0 = truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 0, rounding: 'floor', sigmaV: 100 })
    const t4 = truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 4, rounding: 'floor', sigmaV: 100 })
    const th = truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 0, rounding: 'half_up', sigmaV: 100 })
    return { sym, full, sym33, wrap17, wrapFull, t0, t4, th, lc: limitCycleDemo(), al: alignmentDemo() }
  }, [])
  const lc = ex.lc

  /** 實體 gain 的上限 rail：(2^physical_bits − 1)·LSB（unsigned，§15.3 的 6 bits） */
  const rail = (2 ** 6 - 1) * lc.lsb
  const ROUND_ROWS: { mode: string; rtl: ReactNode; err: ReactNode; effect: ReactNode; cost: string; claim?: 'exact' | 'approx' }[] = [
    {
      mode: 'floor',
      rtl: md('算術右移 $\\ggg$'),
      err: sig(roundingMeanError(12, 'floor'), 5),
      effect: md(`$\\delta^*=${texNum(ex.t0.deltaStar, 4)}\\,\\mathrm{fs}$（$w$ 偏小）`),
      cost: '0（最便宜）',
      claim: 'exact',
    },
    {
      mode: 'toward_zero',
      rtl: 'sign-magnitude 截斷',
      err: md(`${sig(roundingMeanError(12, 'toward_zero', 1), 5)}（$S>0$）／+${sig(roundingMeanError(12, 'toward_zero', -1), 5)}（$S<0$）`),
      effect: md('平均不偏，但 $|G|<1$ LSB 的 block 輸出 0：等效增益下降、有死區傾向'),
      cost: '需要符號判斷',
      claim: 'approx',
    },
    {
      mode: 'half_up',
      rtl: md('先加 $2^{\\ell-1}$ 再右移'),
      err: sig(roundingMeanError(12, 'half_up'), 5),
      effect: md(`$\\delta^*${nearZero(ex.th.deltaStar)}\\,\\mathrm{fs}$（只剩「恰好一半」那一格的微小偏差）`),
      cost: '一個常數加法',
      claim: 'exact',
    },
    { mode: 'half_even', rtl: 'convergent rounding', err: sig(roundingMeanError(12, 'half_even'), 5), effect: md('$\\approx0$（連「恰好一半」也對稱）'), cost: '需偵測 tie', claim: 'approx' },
    {
      mode: 'stochastic',
      rtl: md('$\\lfloor v+U\\rfloor$，$U\\sim\\mathrm{Unif}[0,1)$ 由 LFSR 產生'),
      err: '0（精確無偏）',
      effect: md('無偏，但每次多出最多 $\\tfrac14\\,\\mathrm{LSB}^2$ 的變異數'),
      cost: '需要亂數源',
      claim: 'exact',
    },
  ]

  const CHECKS: Check[] = [
    {
      no: 1,
      title: 'Comparator polarity：0/1 轉 $\\pm1$ 與 PD 正負',
      what: md('硬體 comparator 輸出 $b\\in\\{0,1\\}$，GMAC 需要 $q=2b-1$；$b=1$ 是否真的代表「DTC 太慢」（$e>0$）？'),
      why: (
        <>
          忘了映射（<Tex>{'q=b'}</Tex>）時 <Tex>{'E[G_\\mathrm{bug}]=\\tfrac12E[G]+\\tfrac12E[x_\\mathrm{ref}]'}</Tex>：增益減半，且 code 有 DC 時固定點整個移走（F-16.5）。極性接反（<Tex>{'q\\to-q'}</Tex>）時 pole 變{' '}
          <Tex>{`1+\\mu K=${texNum(1 + n.g, 7)}`}</Tex>，小訊號線性化模型的平均誤差指數發散 <ClaimTag kind="exact" />（誤差長大到 <Tex>{'\\sigma_v'}</Tex> 量級後 comparator 飽和，變成每個 block 最多{' '}
          <Tex>{'\\mu\\max|x_\\mathrm{ref}|'}</Tex> 的等速漂移）。
        </>
      ),
      verify: (
        <>
          freeze 校正後做 <Tex>{'\\pm\\Delta w'}</Tex> 擾動，量 <Tex>{'S_\\mathrm{GMAC}=(G_+-G_-)/(2\\Delta w)'}</Tex>，必須 <Tex>{'<0'}</Tex>（因為 <Tex>{'\\partial E[G]/\\partial w=-K'}</Tex>）。
        </>
      ),
      site: (
        <>
          <ChLink to="/ch/04">Ch04 bit encoding</ChLink>、<ChLink to="/ch/06">Ch06</ChLink>；JSON 的 comparator_encoding
        </>
      ),
      status: 'full',
      presets: [{ id: 'block-lms-json-unipolar-bug', label: '0/1 未映射' }],
    },
    {
      no: 2,
      title: 'Time / code alignment：$e[n]$ 對應 code $x[n-D]$',
      what: (
        <>
          PD 看到的誤差經過 pipeline 與 PLL 延遲；GMAC 必須用 <Tex>{'x[n-D]'}</Tex> 或 filtered-x。mode 切換（FCW、injection on/off）後是否重新對齊？
          <ErratumNote id="E34">{md('原文寫 $n-d$，本站用 $D$')}</ErratumNote>
        </>
      ),
      why: (
        <>
          單頻 code 時 <Tex>{'C_D=\\tfrac{A^2}{2}|H|\\cos(\\varphi+\\Omega D)'}</Tex>：錯位可讓 <Tex>{'C'}</Tex> 變號。T07：<Tex>{`\\varphi=${ex.al.phiDeg}^\\circ,\\;\\Omega=\\pi/6`}</Tex>，<Tex>{'D=4'}</Tex> 時{' '}
          <Tex>{`C_D=${sig(ex.al.c4, 4)}`}</Tex>，<Tex>{'D=0'}</Tex> 時 <Tex>{`C_D=${sig(ex.al.c0, 4)}`}</Tex> <ClaimTag kind="exact" />。
        </>
      ),
      verify: md('掃 $D$、量 $G$ 對 $\\Delta w$ 的斜率；選 $C_D$ 最大且留足 polarity margin 的 $D$。換頻率要重掃（delay 只能補與頻率成正比的相位）。'),
      site: (
        <>
          <ChLink to="/ch/07">Ch07</ChLink>、<ChLink to="/case/sspll">SSPLL 案例</ChLink>；JSON 的 regressor_mode / gm_code_delay_samples
        </>
      ),
      status: 'full',
      presets: [
        { id: 'block-lms-json-polarity-t06', label: '$C<0$（T06）' },
        { id: 'block-lms-json-delay-align-t07', label: '$D=4$ 對齊（T07）' },
      ],
    },
    {
      no: 3,
      title: 'GMAC accumulator bits',
      what: (
        <>
          輸入 <Tex>{'B_x'}</Tex> bits、累加 <Tex>{'N'}</Tex> 筆，整數位要含 sign 與 guard bits，以最壞情況避免 overflow。
        </>
      ),
      why: (
        <>
          6-bit symmetric code 累加 4096 筆需要 {ex.sym} bits；少 1 bit 時 <Tex>{`31\\times4096=${ex.wrap17.exact}`}</Tex> wrap 成 <Tex>{`${ex.wrap17.wrapped}`}</Tex>——<strong>符號翻轉</strong>，更新方向反了。full-range code
          需要 {ex.full} bits（見下方 §9.1 推導與計算器）。
        </>
      ),
      verify: '最壞情況（全部同號、最大幅度）的 bit-true 累加；RTL 加 overflow assertion。',
      site: (
        <>
          本頁 §9.1 計算器、<ChLink to="/ch/04">Ch04 Fixed-Point Lab</ChLink>
        </>
      ),
      status: 'full',
    },
    {
      no: 4,
      title: 'GMAC sum vs average：right shift 與 learning rate 的有效 scaling',
      what: md('RTL 名稱相同（「GMAC」「mu」）不代表 scaling 相同：$S_k$ 直接進積分器，還是先右移 $\\log_2N$ bits？'),
      why: (
        <>
          沿用 average 的 <Tex>{'\\mu'}</Tex> 卻用 sum：<Tex>{`g=N\\mu K=${texNum(n.gSum, 6)}`}</Tex>，pole <Tex>{texNum(n.poleSum, 6)}</Tex>（F-16.4）。sign-LMS 的 <Tex>{'|G|'}</Tex>{' '}
          有界，所以實際表現是大振幅振盪而非數值爆掉——更容易被誤判為「只是雜訊大」。
          <ErratumNote id="E18" />
        </>
      ),
      verify: md('從 RTL 推出 $g=\\mu_\\mathrm{eff}K$，$\\mu_\\mathrm{eff}$ 要含所有 shift；$N$ 改變時檢查 scaling 是否跟著改（規格 §17 反面測試）。'),
      site: (
        <>
          JSON 的 gm_mode；<ChLink to="/ch/04">Ch04</ChLink>、<ChLink to="/ch/12">Ch12</ChLink>
        </>
      ),
      status: 'full',
      presets: [
        { id: 'block-lms-json-sum-mode', label: `sum + 原 $\\mu$（$g=${sig(n.gSum, 4)}$）` },
        { id: 'block-lms-json-sum-scaled', label: 'sum + $\\mu/N$（等同 average）' },
      ],
    },
    {
      no: 5,
      title: 'Rounding / truncation：平均 GMAC 接近零時的系統偏差',
      what: md('右移（除以 $N$）與 $\\mu$ 的 shift 用 floor、truncate toward zero、還是 round half up？保留幾個小數 bit？'),
      why: (
        <>
          floor 平均截掉半個 LSB：平衡點移到 <Tex>{'\\delta^*\\approx\\Delta_G/(2K)'}</Tex>。6-bit、<Tex>{'N=4096'}</Tex>、不保留小數 bit：<Tex>{`\\delta^*=${texNum(ex.t0.deltaStar, 4)}\\,\\mathrm{fs}`}</Tex>，是{' '}
          <Tex>{`\\sigma_w=${sig(n.sigmaW, 3)}\\,\\mathrm{fs}`}</Tex> 的 {sig(ex.t0.deltaStar / n.sigmaW, 3)} 倍；保留 4 bit 降到 <Tex>{`${sig(ex.t4.deltaStar, 3)}\\,\\mathrm{fs}`}</Tex>；round half up 為{' '}
          <Tex>{`\\delta^*${nearZero(ex.th.deltaStar)}\\,\\mathrm{fs}`}</Tex>（F-16.3）。
        </>
      ),
      verify: '定點與浮點同 seed 對照（common random numbers），比較穩態平均；或解析 mean-field（本頁 §9.2 計算器）。',
      site: '本頁 §9.2 計算器；Ch04 shiftRound / roundingTransfer',
      status: 'full',
    },
    {
      no: 6,
      title: 'Quantized calibration state：內部小數 bit vs 實體 code 寬度',
      what: md('積分器保留多少 fractional bits？DTC 只看到 physical_bits 的整數 code 時，LSB 是否遠大於 $\\sigma_w$？'),
      why: (
        <>
          LSB 遠大於 <Tex>{'\\sigma_w'}</Tex> 時，實體 code 在相鄰兩值間 toggle（limit cycle）或停在 dead zone。例：<Tex>{`\\sigma_v=0,\\;a=${lc.a}\\,\\mathrm{fs},\\;\\mu=${lc.mu}\\,\\mathrm{fs}`}</Tex>、LSB{' '}
          <Tex>{`=${lc.lsb}\\,\\mathrm{fs}`}</Tex> 時，實體 gain 在 <Tex>{`\\{${lc.levels.map((v) => v.toFixed(3)).join(',\\,')}\\}\\,\\mathrm{fs}`}</Tex> 之間以週期 {lc.period} 切換，平均{' '}
          <Tex>{`${sig(lc.meanPhys, 5)}\\ne${lc.a}`}</Tex>（由 <code>runBlockLms</code> 計算）。
        </>
      ),
      verify: md('看實體 code 的 toggle 次數與週期（JSON Lab 的 limit-cycle 指標）；與 $\\Delta\\Sigma$ / dither 策略比較（Ch13）。'),
      site: (
        <>
          <ChLink to="/ch/13">Ch13</ChLink>；JSON 的 gain_register.quantize_physical
        </>
      ),
      status: 'full',
      presets: [{ id: 'block-lms-json-limit-cycle', label: '$\\sigma_v=0$ 的 limit cycle' }],
    },
    {
      no: 7,
      title: 'Update enable 與 block boundary：Clear / Commit / Reset 時序',
      what: '最後一個 sample 是否真的進 GMAC？commit 在第幾個 clock？新 gain 何時真正影響 PD？',
      why: (
        <>
          commit 延遲 <Tex>{'d'}</Tex> 個 block 時特徵方程 <Tex>{'z^{d+1}-z^d+g=0'}</Tex>，臨界增益從 2 降到 <Tex>{`${sig(gCritical(1), 4)}\\;(d=1)`}</Tex>、
          <Tex>{`${sig(gCritical(2), 4)}\\;(d=2)`}</Tex> <ClaimTag kind="exact" />（推導見 §3.4）。漏掉一個 sample 只讓增益乘 <Tex>{'(N-1)/N'}</Tex>，但若漏掉的是 block 邊界的「錯位」sample，等於{' '}
          <Tex>{'D'}</Tex> 錯 1。
        </>
      ),
      verify: md('RTL 波形核對 sample 計數器、clear / commit pulse；模型中把 $d$、$D$ 設成 RTL 的實際值再看 spectral radius $\\rho$。'),
      site: (
        <>
          <ChLink to="/ch/08">Ch08 update delay</ChLink>；JSON 的 cal_update_delay_blocks、gm_code_delay_samples——本站只把時序折算成 <Tex>{'d'}</Tex> 與 <Tex>{'D'}</Tex>；clear / commit / reset 的逐 clock 時序與漏 sample
          沒有建模（Backlog R9）
        </>
      ),
      status: 'partial',
      presets: [{ id: 'block-lms-json-update-delay', label: `$d=2$、$g=0.80>${sig(gCritical(2), 3)}$` }],
    },
    {
      no: 8,
      title: 'Saturation / anti-windup：卡在 rail 能不能回來',
      what: '真值超出 DTC gain 可調範圍時怎麼辦？內部積分器是否繼續往外積（windup）？',
      why: (
        <>
          實體範圍外 GMAC 永遠同號，<Tex>{'w'}</Tex> 停在 rail；若內部暫存器沒有一起夾住，它會越積越深，誤差反向後要先「退回」rail 才開始動，恢復時間約{' '}
          <Tex>{'T_\\mathrm{rec}\\approx\\Delta_\\mathrm{windup}/(\\mu\\,|G|)'}</Tex> 個 block（<Tex>{'\\Delta_\\mathrm{windup}'}</Tex> 為超出 rail 的量）。wrap 模式更糟：直接跳到另一端。
        </>
      ),
      verify: md('把 $a$ 設在可調範圍外，看 saturationCount 與恢復時間；wrap 模式必須被 assertion 抓到。'),
      site: (
        <>
          <ChLink to="/ch/04">Ch04 gainUpdate</ChLink>、<ChLink to="/ch/13">Ch13</ChLink>；JSON 的 gain_register.overflow
        </>
      ),
      status: 'full',
      presets: [
        { id: 'block-lms-json-saturation', label: `$a=9>${rail}$（saturate）` },
        { id: 'block-lms-json-wrap', label: '同上（wrap）' },
      ],
    },
    {
      no: 9,
      title: 'Clocks 與 CDC：多 bit gain 跨 clock domain',
      what: 'comparator、GMAC、calibration register、DTC control 常在不同 clock domain；多 bit gain code 跨 domain 需要 handshake 或 gray code。',
      why: (
        <>
          多 bit 暫存器在轉換瞬間被取樣，可能讀到新舊 bit 的混合：6-bit 由 <Tex>{'31=011111_2'}</Tex> 變 <Tex>{'32=100000_2'}</Tex> 時 6 個 bit 全部翻轉，可能讀到 <Tex>{'63'}</Tex> 或 <Tex>{'0'}</Tex>——一次{' '}
          <Tex>{'32\\,\\mathrm{LSB}'}</Tex> 的 DTC 跳動，形成 spur 或瞬間失鎖。延遲本身則等同 <Tex>{'d'}</Tex> 或 <Tex>{'D'}</Tex>。
        </>
      ),
      verify: md('CDC lint、gray / handshake 檢查；把同步器延遲折算成 $d$、$D$ 後重算 $\\rho$ 與 $C_D$。'),
      site: md('本站只以 $d$、$D$ 模型化延遲；metastability 與多 bit 取樣錯誤未建模（Backlog R9）'),
      status: 'none',
    },
    {
      no: 10,
      title: 'PLL lock 與 reacquire：失鎖、重設、模式切換、PVT 突變',
      what: '失鎖時校正要 freeze 還是 reinitialize？relock 後的 gain 是舊值還是重新收斂？',
      why: (
        <>
          失鎖期間 PD 誤差不是小訊號，GMAC 會被大誤差「推歪」；relock 後要讓誤差下降 100 倍需要 <Tex>{`\\ln 0.01/\\ln p=${sig(settle100, 4)}`}</Tex> blocks（§15.3 範例，
          <Tex>{`\\approx${sig((settle100 / n.fu) * 1e6, 3)}\\,\\mu\\mathrm{s}`}</Tex>），而且大初始誤差下 sign-LMS 是 slew-limited，比線性預測更慢 <ErratumNote id="E48" />。
        </>
      ),
      verify: '注入失鎖 / 頻率跳變事件，檢查 freeze 邏輯與 relock 後的收斂時間分布（多 seeds）。',
      site: (
        <>
          <ChLink to="/ch/14">Ch14 校正狀態機</ChLink>；事件級 PLL 未實作（R7）
        </>
      ),
      status: 'partial',
    },
    {
      no: 11,
      title: 'Injection-coupled modes：不同模式的 error transfer 不同',
      what: md('Injection ON/OFF、不同 VCO 頻率、不同 divider / PMUX pattern 下，$H_\\mathrm{PD}$ 的相位與 DC 增益都可能不同。'),
      why: (
        <>
          同一個 <Tex>{'\\mu'}</Tex> 在 A 模式 <Tex>{'C>0'}</Tex>、在 B 模式 <Tex>{'C<0'}</Tex> 是可能的（相位越過 <Tex>{'90^\\circ'}</Tex>）；DC 被抑制時（<Tex>{'H_\\mathrm{PD}(1)=0'}</Tex>）global offset 完全不可觀察{' '}
          <ErratumNote id="E04" />。
        </>
      ),
      verify: md('每個模式各自量 $S_\\mathrm{GMAC}$ 與 $C_D$；多參數時量 Jacobian 的 singular values。'),
      site: (
        <>
          <ChLink to="/ch/06">Ch06</ChLink>、<ChLink to="/case/sspll">SSPLL 案例</ChLink>、<ChLink to="/ch/10">Ch10</ChLink>
        </>
      ),
      status: 'partial',
    },
    {
      no: 12,
      title: 'Noise tracing：同一個 comparator noise 的兩條路',
      what: '同一個 PD / comparator noise 同時走主 PLL 直接路徑與 LMS 路徑；兩者相關。',
      why: md(
        '輸出 PSD 不能把兩條路的功率直接相加：$S_\\mathrm{out}=|H_1|^2S_v+|H_2|^2S_v+2\\,\\mathrm{Re}\\{H_1H_2^*\\}S_v$，最後一項是 cross-spectrum；極性用 $\\delta=a-w$ 還是 $\\delta w=w-w^*$ 會讓這一項變號。',
      ),
      verify: '用同一組 noise sample 驅動兩條路徑（common random numbers）並計算 cross-PSD。',
      site: (
        <>
          <ChLink to="/ch/12">Ch12 §12.3</ChLink>（分開計算、未含 cross-spectrum）<ErratumNote id="E33" />
        </>
      ),
      status: 'partial',
    },
  ]

  return (
    <section aria-labelledby="models-s9">
      <h2 id="models-s9">9｜RTL 必須檢查的 12 項硬體細節（§16.1）</h2>
      <p>
        教學模型裡的每一個等號，在 RTL 裡都是一個有位寬、有時序、有 rounding 的電路。下面 12 項是規格要求逐一核對的細節；每一項列出<strong>檢查什麼、為什麼（數學）、怎麼驗、本站對應</strong>，能用 JSON Lab
        重現的附上 preset 連結。
      </p>
      <div className="models-checks">
        {CHECKS.map((c) => (
          <article key={c.no} className="models-check" aria-labelledby={`models-check-${c.no}`}>
            <h3 id={`models-check-${c.no}`}>
              <span className="models-check-no">{c.no}</span> {md(c.title)}
            </h3>
            <span className={`models-status models-status-${c.status}`}>{STATUS[c.status]}</span>
            <dl className="models-check-dl">
              <dt>檢查什麼</dt>
              <dd>{c.what}</dd>
              <dt>為什麼</dt>
              <dd>{c.why}</dd>
              <dt>怎麼驗</dt>
              <dd>{c.verify}</dd>
              <dt>本站對應</dt>
              <dd>{c.site}</dd>
            </dl>
            <PresetLinks presets={c.presets} />
          </article>
        ))}
      </div>

      <Section kind="formula" title="9.1 GMAC accumulator 位元數：一步一步" level={3}>
        <Prereq title="二補數（two's complement）">
          <p>
            <Tex>{'A'}</Tex>-bit 二補數表示 <Tex>{'[-2^{A-1},\\,2^{A-1}-1]'}</Tex> 的整數：最高位權重是 <Tex>{'-2^{A-1}'}</Tex>。取負等於「逐位元反相再加 1」：<Tex>{'-x=\\bar x+1'}</Tex>。範圍不對稱——最負的數{' '}
            <Tex>{'-2^{A-1}'}</Tex> 取負後是 <Tex>{'+2^{A-1}'}</Tex>，在 <Tex>{'A'}</Tex> bits 內放不下。超出範圍時硬體會 wrap：加上 <Tex>{'2^A'}</Tex> 的整數倍回到範圍內（F-16.2），這等於數值跳到另一端、符號翻轉。
          </p>
        </Prereq>
        <Steps
          title="最壞情況總和決定最少位元數"
          steps={[
            { tex: String.raw`x_\mathrm{int}\in[-2^{B_x-1},\,2^{B_x-1}-1],\quad q\in\{\pm1\}`, why: '$B_x$-bit 有號 code；$q$ 以條件取負實作（$q=-1$ 時取 $-x$）。' },
            {
              tex: String.raw`q\,x_\mathrm{int}\in\bigl[-2^{B_x-1},\,+2^{B_x-1}\bigr]\;(\text{full}),\qquad \bigl[-(2^{B_x-1}-1),\,2^{B_x-1}-1\bigr]\;(\text{symmetric})`,
              why: 'full range 時 $-(-2^{B_x-1})=+2^{B_x-1}$，比原範圍多一格；symmetric code 不用最負值。',
            },
            { tex: String.raw`|S|=\Bigl|\sum_{n=1}^{N}q\,x_\mathrm{int}\Bigr|\le N\max|q\,x_\mathrm{int}|`, why: '三角不等式；所有樣本同號且取最大幅度時等號成立（最壞情況）。' },
            {
              tex: String.raw`\text{symmetric: }N(2^{B_x-1}-1)<N\,2^{B_x-1}\le2^{B_x-1+\lceil\log_2N\rceil}\;\Rightarrow\;B_\mathrm{acc}\le B_x+\lceil\log_2N\rceil\quad(N=2^L\text{ 時取等號})`,
              why: `需要 $2^{A-1}-1\\ge N(2^{B_x-1}-1)$；取 $A-1=B_x-1+\\lceil\\log_2N\\rceil$ 一定足夠（經驗法則）。$N$ 為 2 的冪時這也是最少；其他 $N$ 可能還能省 1 bit——例如 $B_x=6,\\,N=33$：$33\\times31=1023\\le2^{10}-1$，只要 ${ex.sym33} bits，法則給 ${6 + Math.ceil(Math.log2(33))}。`,
            },
            {
              tex: String.raw`\text{full},\;N=2^L:\;2^{A-1}-1\ge2^{B_x-1+L}\;\Rightarrow\;B_\mathrm{acc}=B_x+L+1`,
              why: '$+2^{B_x-1+L}$ 恰好比 $A=B_x+L$ 時的上限 $2^{B_x-1+L}-1$ 多 1，所以要再多一個 bit。一般的 $N$ 則是 $B_x+\\lfloor\\log_2N\\rfloor+1$；兩種範圍可以合寫成 $B_\\mathrm{acc}=1+\\lceil\\log_2(NM_x+1)\\rceil$，$M_x=\\max|q\\,x_\\mathrm{int}|$（F-16.1）。',
            },
            {
              tex: String.raw`B_x=6,\;N=4096:\;31\times4096=126976\le2^{17}-1=131071\;\Rightarrow\;${ex.sym}\text{ bits};\quad 32\times4096=${ex.wrapFull.exact}>131071\;\Rightarrow\;\text{full 需 }${ex.full}\text{ bits}`,
              why: '代入數字（由 accBitsExact 計算）；golden vector negative_tests.json 的 gmac_bits_required 為 18。',
            },
            {
              tex: String.raw`\mathrm{wrap}_{17}(126976)=126976-2^{17}=${ex.wrap17.wrapped},\qquad \mathrm{wrap}_{${ex.full - 1}}(${ex.wrapFull.exact})=${ex.wrapFull.wrapped}`,
              why: '少 1 bit 時，正的總和被 wrap 成負數——GMAC 的方向整個反了（F-16.2）。兩個數字都由 bit-true 的逐筆累加 worstCaseAccumulate 算出。',
            },
          ]}
        />
        <TexBlock id="F-16.1" label="GMAC accumulator 位元數（精確）">
          {String.raw`B_\mathrm{acc}=\min\{A:\,2^{A-1}-1\ge N\max(q x)^+,\;2^{A-1}\ge N\max(q x)^-\}=1+\bigl\lceil\log_2(N M_x+1)\bigr\rceil\;\le\;B_x+\lceil\log_2N\rceil\;(\text{symmetric})`}
        </TexBlock>
        <TexBlock id="F-16.2" label="二補數 wrap">
          {String.raw`\mathrm{wrap}_A(v)=\bigl((v+2^{A-1})\bmod 2^A\bigr)-2^{A-1}`}
        </TexBlock>
        <HandCalcPointer>
          accumulator 位元數與 wrap 的帶入手算題在 <ChLink to="/ch/04">Ch04</ChLink>（可以換成你的 <Tex>{'B_x'}</Tex>、<Tex>{'N'}</Tex>，也可以試不是 2 的冪的 <Tex>{'N'}</Tex>）；想即時試任何組合，用本節最後的計算器。
        </HandCalcPointer>
        <TexBlock id="F-16.4" label="sum vs average 與 shift 型 learning rate">
          {String.raw`g_\mathrm{sum}=N\,g_\mathrm{avg};\qquad w_{k+1}=w_k+\bigl(S_k\gg(\log_2N+m)\bigr)\;\Leftrightarrow\;\mu=2^{-m}\;(\text{average})`}
        </TexBlock>
        <HandCalcPointer>
          第 4 項的 bug（沿用 average 的 <Tex>{'\\mu'}</Tex> 卻少了右移）用數字算一次：<ChLink to="/ch/04">Ch04</ChLink> 的手算題「average 對 sum」，或 §11 的思考題 2。
        </HandCalcPointer>
        <Steps
          title="0/1 沒有映射成 $\pm1$ 會發生什麼（F-16.5）"
          steps={[
            { tex: String.raw`b=\tfrac12(q+1)\in\{0,1\}`, why: '$q=2b-1$ 的反函數：$q=+1$ 對應 $b=1$、$q=-1$ 對應 $b=0$。' },
            {
              tex: String.raw`G_\mathrm{bug}=\frac1N\sum_n b[n]\,x_\mathrm{ref}[n]=\frac12\cdot\frac1N\sum_n q[n]x_\mathrm{ref}[n]+\frac12\cdot\frac1N\sum_n x_\mathrm{ref}[n]`,
              why: 'RTL 直接拿 $b$ 去乘 code（忘了映射）；把 $b=\\tfrac12(q+1)$ 代入並拆成兩個和。',
            },
            { tex: String.raw`E[G_\mathrm{bug}]=\tfrac12E[G]+\tfrac12E[x_\mathrm{ref}]\approx\tfrac12K\delta+\tfrac12E[x_\mathrm{ref}]`, why: '取期望值，並用 F-15.3 的 $E[G]\\approx K\\delta$。' },
            {
              tex: String.raw`E[G_\mathrm{bug}]=0\;\Rightarrow\;\delta^*=-\frac{E[x_\mathrm{ref}]}{K}\;\Rightarrow\;w^*=a+\frac{E[x_\mathrm{ref}]}{K_qC}`,
              why: '零均值 code 時只有增益減半（收斂慢一倍）；code 有 DC 時固定點被推離 $a$，而且因為 $K_q\\propto1/\\sigma_v$，雜訊越大偏得越遠。這是線性化結果；偏移大到 $|\\delta^*x|$ 接近 $\\sigma_v$ 時要用 mean-field（F-15.7，JSON Lab 的 preset「0/1 未映射」）。',
            },
          ]}
        />
        <TexBlock id="F-16.5" label="Comparator 0/1 映射與錯誤編碼">
          {String.raw`q=2b-1;\quad q_\mathrm{bug}=b=\tfrac12(q+1)\Rightarrow E[G_\mathrm{bug}]=\tfrac12E[G]+\tfrac12E[x_\mathrm{ref}]`}
        </TexBlock>
        <CodeCompare
          items={[
            { label: '條件取負（正確）', source: gmacSrc, region: 'negateExtended', path: 'src/simulation/models/gmac.ts', note: '先符號延伸到 $B_x+1$ bits 再取負' },
            { label: '條件取負（常見 bug）', source: gmacSrc, region: 'negateInplace', path: 'src/simulation/models/gmac.ts', note: '在 $B_x$ bits 內取負：$x=-2^{B_x-1}$ 時溢位' },
            { label: 'XOR + carry-in 累加', source: gmacSrc, region: 'xorCarryAccumulate', path: 'src/simulation/models/gmac.ts', note: 'RTL 常見寫法：一個加法器完成 $\\mathrm{acc}\\pm x$' },
          ]}
          caption="Ch04 的 bit-true GMAC 模型（gmac.ts）實際執行的程式；「← 差異」行自動高亮。"
        />
        <CodeBlock source={gmacSrc} region="accumulatorBits" path="src/simulation/models/gmac.ts" title="core:accumulatorBits（gmac.ts）" caption="與本頁計算器的 accBitsExact 相同的定義；測試以 golden vector 與此函式交叉比對。" />
        <p>第 4 項的 sum 與 average，在程式裡只差一行：</p>
        <CodeCompare
          items={[
            { label: 'average（除以區塊長度）', source: gmacSrc, region: 'gmacAverage', path: 'src/simulation/models/gmac.ts', note: '$G_k=S_k/N$ 與 $N$ 無關：$g=\\mu K$' },
            { label: 'sum（不除）', source: gmacSrc, region: 'gmacSum', path: 'src/simulation/models/gmac.ts', note: '直接用 $S_k$：同一個 $\\mu$ 時 $g=N\\mu K$' },
          ]}
        />
      </Section>

      <Section kind="formula" title="9.2 右移截斷為什麼會變成 gain bias" level={3}>
        <Steps
          title="floor 的平衡點：對稱性論證"
          steps={[
            {
              tex: String.raw`\hat G=\Delta_G\lfloor Y\rfloor,\quad Y=\frac{S}{2^{\ell}}=\frac{G}{\Delta_G},\quad \Delta_G=\frac{2^{-F_G}}{2^{B_x-1}}`,
              why: '右移 $\\ell=\\log_2N-F_G$ bits（算術右移就是 floor），保留 $F_G$ 個小數 bit；$Y$ 是以 $\\hat G$ 的 LSB 為單位的真實 $G$。',
            },
            { tex: String.raw`\text{平衡：}\;E[\hat G]=0\iff E\bigl[\lfloor Y\rfloor\bigr]=0`, why: '迴路平均不再移動時，平均更新 $\\mu E[\\hat G]=0$。' },
            {
              tex: String.raw`Y\overset{d}{=}1-Y\;\Rightarrow\;E\lfloor Y\rfloor=E\lfloor1-Y\rfloor=-E\lfloor Y\rfloor\;\Rightarrow\;E\lfloor Y\rfloor=0`,
              why: '若 $Y$ 對 $\\tfrac12$ 對稱，$1-Y$ 與 $Y$ 同分布；$Y$ 不是整數時 $\\lfloor1-Y\\rfloor=-\\lfloor Y\\rfloor$。所以平衡點在 $E[Y]=\\tfrac12$（需要 $Y$ 的分布夠寬、近似連續）。',
            },
            { tex: String.raw`E[G]=\tfrac12\Delta_G,\quad E[G]\approx K\delta\;\Rightarrow\;\delta^*=a-w^*\approx\frac{\Delta_G}{2K}`, why: '換回 $G$ 的單位，再用平均 GMAC 的線性化 $E[G]\\approx K\\delta$（F-15.3）。' },
            {
              tex: String.raw`B_x=6,\,N=4096,\,F_G=0:\;\Delta_G=\tfrac1{32},\;K=K_q x_n^2=${texNum(ex.t0.derived.K, 5)}\,\mathrm{fs^{-1}}\;\Rightarrow\;\delta^*\approx${texNum(ex.t0.approxDeltaStar, 5)}\,\mathrm{fs}`,
              why: `代入；精確的 Binomial mean-field 給 $${texNum(ex.t0.deltaStar, 5)}\\,\\mathrm{fs}$（自然 dither $\\sigma_G/\\Delta_G=${texNum(ex.t0.derived.ditherLsb, 3)}$ LSB 已足夠）。`,
            },
            { tex: String.raw`\text{round half up：}\lfloor Y+\tfrac12\rfloor\;\Rightarrow\;E[Y]=0,\;\delta^*\approx0`, why: '同樣的對稱性論證，平衡點移回 0；只剩「恰好一半」那一格的微小偏差。' },
          ]}
        />
        <TexBlock id="F-16.3" label="右移截斷（floor）造成的 gain bias">
          {String.raw`\hat G=\Delta_G\Bigl\lfloor\frac{S}{2^{\ell}}\Bigr\rfloor,\;\Delta_G=\frac{2^{-F_G}}{2^{B_x-1}}\;\Rightarrow\;E[\hat G]=0\iff E[G]\approx\tfrac12\Delta_G\iff \delta^*=a-w^*\approx\frac{\Delta_G}{2K}`}
        </TexBlock>
        <p>
          <ClaimTag kind="approx" /> 近似式需要「自然 dither」：comparator 雜訊讓 <Tex>{'Y'}</Tex> 的標準差大於約 <Tex>{'\\tfrac12'}</Tex> LSB。因為 <Tex>{'K\\propto1/\\sigma_v'}</Tex>，偏差 <Tex>{'\\delta^*\\propto\\sigma_v'}</Tex>
          ——雜訊越大，截斷偏差越大，這是 1-bit sign-LMS 特有的放大效應。
        </p>
        <HandCalcPointer>
          單一步驟（四種取整各得多少、floor 讓 <Tex>{'w'}</Tex> 偏多少）的手算題在 <ChLink to="/ch/04">Ch04</ChLink>；本頁的綜合手算（§11）把它和 <Tex>{'\\sigma_w'}</Tex> 放在一起比：要保留幾個小數 bit，截斷偏差才會小於雜訊？
        </HandCalcPointer>
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>rounding 模式</th>
                <th>RTL 實作</th>
                <th>
                  平均誤差（餘數均勻、<Tex>{'\\ell=12'}</Tex>）[LSB]
                </th>
                <th>
                  對 <Tex>{'w'}</Tex> 的影響（6-bit、<Tex>{'N=4096,\\;\\sigma_v=100\\,\\mathrm{fs},\\;F_G=0'}</Tex>）
                </th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              {ROUND_ROWS.map((r) => (
                <tr key={r.mode}>
                  <td>
                    <code>{r.mode}</code>
                  </td>
                  <td>{r.rtl}</td>
                  <td className="mono">{r.err}</td>
                  <td>
                    {r.effect} {r.claim && <ClaimTag kind={r.claim} />}
                  </td>
                  <td className="small">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          平均誤差欄由 gmac.ts 的 <code>roundingMeanError</code> 計算；floor / half up 的 <Tex>{'\\delta^*'}</Tex> 由本頁的精確 mean-field 計算。blockLms 的 L5 模式對 gain 增量也用同一組 rounding 規則：
        </p>
        <ModeGate min="engineer">
          <CodeBlock
            source={blockLmsSrc}
            region="roundWith"
            path="src/simulation/models/blockLms.ts"
            title="core:roundWith（blockLms.ts）"
            caption="nearest 為 $\lfloor v+\tfrac12\rfloor$（round half up）、truncate 為 $\lfloor v\rfloor$、stochastic 為 $\lfloor v+U\rfloor$。"
          />
          <CodeBlock
            source={blockLmsSrc}
            region="blockLmsGainRegister"
            path="src/simulation/models/blockLms.ts"
            title="core:blockLmsGainRegister（blockLms.ts）"
            caption="內部暫存器以 $2^{-F}$ LSB 計數（$F$ 為 internal_bits 減 physical_bits）；saturate 計數 saturationCount、wrap 計數 wrapCount。"
          />
        </ModeGate>
        <GmacSizingLab />
      </Section>

      <Section kind="assumptions" title="9.3 Sign-off Matrix（§16.2）：十二項之後還要驗什麼" level={3}>
        <p>
          十二項細節確認後，還要在下列七個維度上驗證。前三欄是規格 §16.2 的原文；最後一欄誠實標示本站目前能做到哪裡——多數只到「部分」，因為真正的 sign-off 需要 PVT corner、事件級 PLL 與量測。
        </p>
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>必須驗證的內容</th>
                <th>判斷方式</th>
                <th>本站能做到哪裡</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((m) => (
                <tr key={m.name}>
                  <th>{m.name}</th>
                  <td>{m.what}</td>
                  <td>{m.how}</td>
                  <td>
                    <span className={`models-status models-status-${m.status}`}>{STATUS[m.status]}</span>
                    <div className="small">{m.site}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="互動版 Sign-off Matrix 與 design review checklist">
          可勾選、可匯出的完整矩陣在 <ChLink to="/signoff">Sign-off Checklist</ChLink> 頁；本表只說明每一列在本站對應到哪個模型層級與哪些章節。
        </Callout>
      </Section>
    </section>
  )
}
