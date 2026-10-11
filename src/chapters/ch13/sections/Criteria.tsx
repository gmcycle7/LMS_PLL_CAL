import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, Mermaid, ModeGate, Plot, Prereq, Section, SourceTag, StepDerivation, Tex, TexBlock, useThemeTokens } from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import quantSrc from '@/simulation/models/quantizer.ts?raw'
import { firstOrderPeriod, quantizeFcw } from '@/simulation/models/dsm'
import {
  DSM_BITS,
  STRATEGY_SHORT,
  lcm,
  type CriteriaInput,
  type CriteriaResult,
  type CriteriaRow,
  type QuantStrategy,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Erratum, Fold, fx, n, ntex, num, tx } from '../common'
import { CHART_DECISION, CHART_MIXING_PATH, CHART_RECORD_CHECK, CHART_TONE_MIXING } from '../diagrams'

const DRIFT = 0.2
const N_SLOW = 1024
/** 「FCW 陷阱」示範：看起來很漂亮、但 20-bit DSM 無法精確表示的 frac */
const TRAP_FRAC = 0.1
const INPUT: CriteriaInput = {
  // mixSamples = 2^17 個 reference cycle（4 個 Welch 區塊）：預設 FCW 的混頻週期只有 640 / 5120 個 cycle，全部解析得出來
  params: { ...DEFAULT_LAB_PARAMS, length: 8192, mixSamples: 1 << 17, nperseg: 2048, arithmetic: 'rational' },
  driftPerK: DRIFT,
  nUpdSlow: N_SLOW,
  trapFrac: TRAP_FRAC,
}

// 本例的混頻週期（由參數推得，不手寫）：code 週期 L_t·N_upd 與一階 DSM residue 週期 2^20/gcd(K, 2^20) 的最小公倍數
const DSM_K = quantizeFcw(DEFAULT_LAB_PARAMS.dsmFrac, DSM_BITS).K
const DSM_PERIOD = firstOrderPeriod(DSM_K, DSM_BITS)
const PROD_FAST = lcm(DEFAULT_LAB_PARAMS.togglePeriod, DSM_PERIOD)
const PROD_SLOW = lcm(DEFAULT_LAB_PARAMS.togglePeriod * N_SLOW, DSM_PERIOD)

type Getter = (r: CriteriaRow) => ReactNode

interface CriterionDef {
  id: number
  title: ReactNode
  what: ReactNode
  get: Getter
  /** 說明；需要引用模擬結果時用函式（由表中的數字推得，不手寫結論） */
  note: ReactNode | ((rows: CriteriaRow[]) => ReactNode)
}

const rowOf = (rows: CriteriaRow[], s: QuantStrategy) => rows.find((r) => r.strategy === s)

/** 比較用的 in-band 總量：f ≥ f_L 的 σ_out 與 f < f_L 的慢變成分平方相加 [fs] */
const total = (c: CriteriaRow['constant']): number | null => (c.sigmaOutFs === null ? null : Math.hypot(c.sigmaOutFs, c.sigmaSlowFs ?? 0))

const CRITERIA: CriterionDef[] = [
  {
    id: 1,
    title: 'Static residual gain error',
    what: tx(String.raw`DC 誤差 $\delta w=\bar y-w^*$（常數情境）[LSB]`),
    get: (r) => fx(r.constant.dcError, 4),
    note: (rows) => {
      const a = rowOf(rows, 'freeze')
      return tx(String.raw`Freeze 的弱點：$\delta w=${fx(a?.constant.dcError, 1)}\,\mathrm{LSB}$ 永遠在（$\delta=a-w$ 約定則反號，勘誤 E49）。其餘策略的平均都追得上 $w^*$，表中的殘餘只是有限紀錄長度（不是整數個週期）或有限樣本的平均誤差。`)
    },
  },
  {
    id: 2,
    title: 'Output spur（決定性 toggle / limit cycle）',
    what: tx(String.raw`code 誤差最大譜線 [$\mathrm{LSB}^2$] @ $f/f_u$（常數情境）`),
    get: (r) => (r.constant.maxSpurPower !== null ? <>{num(r.constant.maxSpurPower, 3)} @ {fx(r.constant.maxSpurFreqRel, 3)}</> : '無'),
    note: (rows) => {
      const b = rowOf(rows, 'toggle')?.constant
      const d = rowOf(rows, 'deltaSigma')?.constant
      const c = rowOf(rows, 'stochastic')?.constant
      const e = rowOf(rows, 'deltaSigmaDither')?.constant
      const same = !!b && !!d && b.maxSpurPower !== null && d.maxSpurPower !== null && Math.abs(b.maxSpurPower - d.maxSpurPower) < 1e-12 && b.maxSpurFreqRel === d.maxSpurFreqRel
      const quiet = !!c && !!e && c.maxSpurPower === null && e.maxSpurPower === null
      return (
        <>
          {same ? 'B 與 D 的最大 code 譜線完全相同（同一個 limit cycle，勘誤 E15）' : 'B 與 D 的最大 code 譜線不同（請檢查 toggle 週期是否能表示目標的小數部分）'}；
          {quiet ? 'C、E 沒有統計顯著的離散譜線。' : 'C 或 E 仍偵測到譜線（見表中數值）。'}
        </>
      )
    },
  },
  {
    id: 3,
    title: 'Output integrated jitter',
    what: tx(String.raw`$\sigma_\mathrm{out}=\sqrt{\int_{f_L}|T|^2S_{\delta t}\,df}$ ＋ 慢變成分（$f<f_L$）的 RMS [fs]（常數情境，$N_\mathrm{upd}=1$）`),
    get: (r) => (
      <>
        {num(r.constant.sigmaOutFs, 3)} + {r.constant.sigmaSlowFs === null ? '—' : num(r.constant.sigmaSlowFs, 2)}
      </>
    ),
    note: (rows) => {
      const ranked = rows
        .map((r) => ({ s: STRATEGY_SHORT[r.strategy], t: total(r.constant) }))
        .filter((x): x is { s: string; t: number } => x.t !== null)
        .sort((a, b) => a.t - b.t)
      if (!ranked.length) return '（mixing 未計算）'
      const worst = ranked[ranked.length - 1]
      const limitCycleWorst = worst.s === 'B' || worst.s === 'D'
      return (
        <>
          由小到大：
          {ranked.map((x, i) => (
            <span key={x.s}>
              {i > 0 ? <> <Tex>{Math.abs(x.t - ranked[i - 1].t) <= 1e-3 * x.t ? String.raw`\approx` : '<'}</Tex> </> : ' '}
              {x.s}（{n(x.t, 3)}）
            </span>
          ))}
          。
          {limitCycleWorst
            ? ' 本例最差的是週期性的 limit cycle（B、D）：code 的 tone 與 DSM residue 的諧波混頻後，差頻落回 PLL 通帶；隨機 / dither 把同樣的功率攤平，落入通帶的比例反而較小。'
            : ' 隨機 / dither 的代價：白色或高頻誤差經 DSM residue mixing 後，有一部分落入 PLL 頻寬。'}
        </>
      )
    },
  },
  {
    id: 4,
    title: 'PVT tracking ability',
    what: tx(`$w^*$ 漂移 ${DRIFT} LSB / 1000 次更新：最後 1/4 的平均誤差 [LSB]`),
    get: (r) => fx(r.drift.trackDcError, 3),
    note: tx(String.raw`Freeze 無法追蹤；toggle 受 $1/L_t$ 解析度限制；ΔΣ 由 telescoping 保證平均追上。`),
  },
  {
    id: 5,
    title: '量化輸出作用頻率（update rate）',
    what: tx(`$\\sigma_\\mathrm{out}$ [fs]：$N_\\mathrm{upd}=1\\to${N_SLOW}$`),
    get: (r) => (
      <>
        {num(r.constant.sigmaOutFs, 3)} <Tex>{String.raw`\to`}</Tex> {num(r.slow.sigmaOutFs, 3)}
      </>
    ),
    // 兩個情境的紀錄長度與 f_L 相同（runQuantCriteria 保證），所以是同一個量的比較
    note: tx(
      String.raw`同一個 toggle pattern：$N_\mathrm{upd}=1$ 時 code 誤差的 tone 在 $f_s/5$、$2f_s/5$；$N_\mathrm{upd}=${N_SLOW}$ 時主 tone 在 $2f_s/(5\times${N_SLOW})\approx${fx((2 * DEFAULT_LAB_PARAMS.fs) / (5 * N_SLOW) / 1e3, 2)}\,\mathrm{kHz}$。但 $\delta t=\Delta_\mathrm{LSB}\,e\,x$ 還要再與 $x$ 的頻譜捲積，最後落點只能由模擬判斷（見表下說明）。`,
    ),
  },
  {
    id: 6,
    title: tx(String.raw`PLL $T(f)$ 與 DSM residue 的 mixing`),
    what: tx(String.raw`$\delta t$ 最大 tone [$\mathrm{fs}^2$]（常數情境）；LMS 雜訊情境的 $\sigma_\mathrm{out}$ [fs]`),
    get: (r) => (
      <>
        {r.constant.mixToneFs2 !== null ? num(r.constant.mixToneFs2, 3) : '—'}；{num(r.noise.sigmaOutFs, 3)}
      </>
    ),
    note: 'code 誤差與 DSM residue 相乘會把高頻量化誤差搬回低頻（乘法 = 頻譜捲積，§12.2）；結果取決於 FCW，只能靠模擬判斷（見下方的「FCW 陷阱」）。',
  },
]

export function CriteriaSection() {
  const tokens = useThemeTokens()
  const task = useWorkerTask<CriteriaInput, CriteriaResult>('quantizer', 'runQuantCriteria')
  const { run } = task
  const [res, setRes] = useState<CriteriaResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    run(INPUT)
      .then(setRes)
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
      })
  }, [run])

  const rows = res?.rows ?? null
  const phase = res?.phase ?? null
  const trap = res?.trap ?? null
  const cOf = (s: QuantStrategy) => rows?.find((r) => r.strategy === s) ?? null
  const c0 = rows?.[0]?.constant ?? null
  const tOf = (s: QuantStrategy) => {
    const r = cOf(s)
    return r ? total(r.constant) : null
  }
  const sA = tOf('freeze')
  const sC = tOf('stochastic')
  const sE = tOf('deltaSigmaDither')
  const sD = tOf('deltaSigma')
  const freezeVsRandom = sA !== null && sC !== null && sE !== null ? sA < Math.min(sC, sE) : null
  const rateTrend = { up: [] as string[], down: [] as string[] }
  for (const r of rows ?? []) {
    const a0 = r.constant.sigmaOutFs
    const a1 = r.slow.sigmaOutFs
    if (a0 === null || a1 === null) continue
    if (a1 > a0 * 1.05) rateTrend.up.push(STRATEGY_SHORT[r.strategy])
    else if (a1 < a0 / 1.05) rateTrend.down.push(STRATEGY_SHORT[r.strategy])
  }
  const bRow = cOf('toggle')

  const trapData = useMemo<Data[]>(() => {
    if (!trap) return []
    const stepMs = ((trap.samples / trap.blockMeans.length) / DEFAULT_LAB_PARAMS.fs) * 1e3
    return [
      {
        x: Array.from(trap.blockMeans, (_, i) => i * stepMs),
        y: Array.from(trap.blockMeans),
        name: String.raw`區塊平均 $\delta t$（toggle $\times$ DSM residue，$\mathrm{frac}=0.1$）`,
        mode: 'lines',
        line: { shape: 'hv', color: tokens.series[0], width: 2 },
      },
      {
        x: [0, (trap.short.samples / DEFAULT_LAB_PARAMS.fs) * 1e3],
        y: [trap.short.meanToggle, trap.short.meanToggle],
        name: '短紀錄看到的「靜態偏移」',
        mode: 'lines',
        line: { color: tokens.series[1], width: 4 },
      },
    ]
  }, [trap, tokens])

  return (
    <Section kind="assumptions" title="§13.5b Dither + Noise Shaping 不一定勝過 Freeze：六個準則" level={2} id="ch13-criteria">
      <p>
        規格 §13.5 要求至少用六個準則比較。下表全部由模擬計算（同一 seed、同一 DSM 序列；<Tex>{String.raw`f_s=${ntex(DEFAULT_LAB_PARAMS.fs, 3)}\,\mathrm{Hz}`}</Tex>、<Tex>{String.raw`\Delta_\mathrm{LSB}=${DEFAULT_LAB_PARAMS.lsbFs}\,\mathrm{fs/LSB}`}</Tex>、一階 DSM{' '}
        <Tex>{String.raw`\mathrm{frac}=13/128=${DEFAULT_LAB_PARAMS.dsmFrac}`}</Tex>、PLL 頻寬 <Tex>{String.raw`f_\mathrm{BW}=${ntex(DEFAULT_LAB_PARAMS.pllBwHz, 3)}\,\mathrm{Hz}`}</Tex>、<Tex>{String.raw`\zeta=${DEFAULT_LAB_PARAMS.pllZeta}`}</Tex>、
        <Tex>{String.raw`\sigma_w=${DEFAULT_LAB_PARAMS.sigmaW}\,\mathrm{LSB}`}</Tex>）。<SourceTag kind="illustrative" />
      </p>
      <Mermaid
        chart={CHART_MIXING_PATH}
        caption="code 誤差怎麼變成 output jitter。先看最上面：code 每 $N_\mathrm{upd}$ 個 cycle 才更新一次，ZOH 把同一個誤差重複 $N_\mathrm{upd}$ 次；再看藍色的乘法點：誤差乘上每個 cycle 都在變的 DSM residue，頻譜因此被搬移；最後才經過 PLL 的 low-pass。"
      />
      <p className="small ch13-figwalk">
        注意兩個時間索引：圖上的 <Tex>{'k'}</Tex> 是「第幾次 code 更新」（更新率 <Tex>{String.raw`f_u=f_s/N_\mathrm{upd}`}</Tex>），<Tex>{'n'}</Tex> 是「第幾個 reference cycle」（取樣率 <Tex>{'f_s'}</Tex>），兩者的關係是{' '}
        <Tex>{String.raw`k=\lfloor n/N_\mathrm{upd}\rfloor`}</Tex>。圖上的 <Tex>{'e_s[n]'}</Tex> 是保持（ZOH）之後的 code 誤差；<Tex>{String.raw`\delta t[n]=\Delta_\mathrm{LSB}\,e_s[n]\,x[n]`}</Tex> 就是後面公式 F-13.11 的前半，
        <Tex>{String.raw`|T(f)|^2`}</Tex> 之後的積分就是後半的 <Tex>{String.raw`\sigma_{t,\mathrm{out}}^2`}</Tex>（表中的 <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex>：經過 PLL 之後的 output jitter）。
      </p>
      <Prereq title="捲積（convolution）：為什麼「時域相乘」會把頻譜搬來搬去？">
        <p>先看兩個 tone 相乘（三角恆等式：積化和差）：</p>
        <TexBlock>{String.raw`\cos(\Omega_e n)\cdot\cos(\Omega_x n)=\tfrac12\cos\big((\Omega_x-\Omega_e)n\big)+\tfrac12\cos\big((\Omega_x+\Omega_e)n\big)`}</TexBlock>
        <p>
          相乘之後，原來的兩個頻率都不見了，出現的是<strong>差頻</strong>與<strong>和頻</strong>。一般訊號是很多 tone 的疊加，<Tex>{'e'}</Tex> 的每一個成分都和 <Tex>{'x'}</Tex> 的每一個成分配對一次；把所有配對加總，就是頻譜的
          <strong>捲積</strong>：
        </p>
        <TexBlock>{String.raw`(S_x\circledast S_e)(\Omega)=\frac1{2\pi}\int_{-\pi}^{\pi}S_x(\nu)\,S_e(\Omega-\nu)\,d\nu`}</TexBlock>
        <p>
          讀法：「頻率 <Tex>{String.raw`\nu`}</Tex> 的 <Tex>{'x'}</Tex> 成分」配上「頻率 <Tex>{String.raw`\Omega-\nu`}</Tex> 的 <Tex>{'e'}</Tex> 成分」，兩個頻率相加剛好是 <Tex>{String.raw`\Omega`}</Tex>。所以一個很高頻的 code tone，只要{' '}
          <Tex>{'x'}</Tex> 在它附近也有 tone，差頻就可能掉進 PLL 的通帶。
        </p>
        <p className="small">
          兩個名詞：<strong>廣義平穩</strong>（WSS）指平均與自相關 <Tex>{String.raw`R[\ell]=E\big[x[n]\,x[n+\ell]\big]`}</Tex> 不隨 <Tex>{'n'}</Tex> 改變；<strong>cyclostationary</strong> 指這些統計量隨 <Tex>{'n'}</Tex>{' '}
          週期性改變（例如 code 以 ZOH 保持時，每 <Tex>{String.raw`N_\mathrm{upd}`}</Tex> 個 sample 重複一次），此時說的 PSD 是「時間平均」的 PSD。
        </p>
      </Prereq>
      <Mermaid
        chart={CHART_TONE_MIXING}
        caption={String.raw`一個具體的差頻（本章實驗的預設參數：$f_s=100\,\mathrm{MHz}$、DSM $\mathrm{frac}=13/128$、PLL 頻寬 $1\,\mathrm{MHz}$、code 每個 cycle 更新）。先看左邊兩個 tone：都在 $40\,\mathrm{MHz}$ 附近、遠在通帶外；再看紅色的差頻：只有 $156\,\mathrm{kHz}$，落進 PLL 通帶，而綠色的和頻被 $T(f)$ 濾掉。`}
      />
      <p className="small ch13-figwalk">
        這是上面「積化和差」的數字版：圖上的 <Tex>{'f_e'}</Tex> 是 code 誤差的主線 <Tex>{String.raw`2f_u/5`}</Tex>（<Tex>{String.raw`N_\mathrm{upd}=1`}</Tex> 時 <Tex>{'f_u=f_s'}</Tex>），<Tex>{'f_x'}</Tex> 是週期 128 的 DSM residue 的第 51 次諧波，差頻{' '}
        <Tex>{String.raw`\big(\tfrac25-\tfrac{51}{128}\big)f_s=\tfrac{f_s}{640}`}</Tex>。換成第 50、52 次諧波會得到 <Tex>{String.raw`6f_s/640`}</Tex>、<Tex>{String.raw`4f_s/640`}</Tex>，所以通帶內不只一條——這就是 limit cycle（B、D）的 tone 明明在通帶外、卻能回到通帶的機制；它在{' '}
        <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 裡佔多少，由下表的模擬數字判斷（準則 3、6）。
      </p>
      <Fold title="準則 3、5、6 的數學：code 誤差怎麼變成 output jitter？">
        <StepDerivation
          steps={[
            { tex: String.raw`\delta t[n]=\Delta_\mathrm{LSB}\,e_s[n]\,x[n],\qquad e_s[n]=e\big[\lfloor n/N_\mathrm{upd}\rfloor\big]`, why: tx(String.raw`DTC 延遲是 gain 乘上 code（§12.2 的 $\delta t=x\,\delta w$，乘號不是加號）；code 以 ZOH 保持 $N_\mathrm{upd}$ 個 reference cycle，$e_s$ 是 $e$ 在 $f_s$ 上的版本（勘誤 E09 的 ZOH 映射；此處 commit latency $n_c=0$）。`) },
            { tex: String.raw`S_{e_s}(e^{j\Omega})=\frac1{N_\mathrm{upd}}\left[\frac{\sin(N_\mathrm{upd}\Omega/2)}{\sin(\Omega/2)}\right]^2S_e\big(e^{jN_\mathrm{upd}\Omega}\big)`, why: tx(String.raw`勘誤 E09：block-rate 的 $S_e$ 不能直接放到 sample-rate 軸；ZOH 的 $\mathrm{sinc}^2$ 權重乘上「頻率軸壓縮 $N_\mathrm{upd}$ 倍」的 $S_e$（時間平均 PSD，序列實際上是 cyclostationary）。`) },
            { tex: String.raw`R_{\delta t}[\ell]=\Delta_\mathrm{LSB}^2\,R_x[\ell]\,R_{e_s}[\ell]`, why: tx(String.raw`若 $x$ 與 $e_s$ 獨立、廣義平穩：$E\big[x[n]x[n+\ell]\,e_s[n]e_s[n+\ell]\big]=E\big[x[n]x[n+\ell]\big]\,E\big[e_s[n]e_s[n+\ell]\big]$，乘積的自相關 = 自相關的乘積（真實 LMS 中兩者不必獨立，所以下表直接模擬）。`) },
            { tex: String.raw`S_{\delta t}(e^{j\Omega})=\frac{\Delta_\mathrm{LSB}^2}{2\pi}\int_{-\pi}^{\pi}S_x(e^{j\nu})\,S_{e_s}(e^{j(\Omega-\nu)})\,d\nu`, why: tx(String.raw`對上一式取 DTFT：時域相乘 = 頻域捲積（見上方先備知識）。$e$ 在 $f_e$ 的 tone 與 $x$ 在 $f_x$ 的 tone 會產生 $f_x\pm f_e$ 的 tone。`) },
            { tex: String.raw`|f_x-f_e|<f_\mathrm{BW}\;\Rightarrow\;\text{混頻產物落入 PLL 通帶}`, why: '這就是「量化誤差被搬回通帶」：高頻的 code tone 碰上同樣高頻的 DSM tone，差頻可以很低。' },
            { tex: String.raw`S_{\delta t}^{(1)}(f)=\frac{2}{f_s}S_{\delta t}\big(e^{j2\pi f/f_s}\big),\quad 0<f<\tfrac{f_s}2`, why: tx(String.raw`DTFT 形式換成 one-sided、$\mathrm{fs}^2/\mathrm{Hz}$（勘誤 E28；漏掉會差 $10\log_{10}(f_s/2)$ dB）。`) },
            { tex: String.raw`\sigma_{t,\mathrm{out}}^2=\int_{f_L}^{f_s/2}|T(f)|^2S_{\delta t}^{(1)}(f)\,df`, why: tx(String.raw`time-jitter PSD 經 closed-loop $T(f)$（low-pass）到輸出（§12.3；以時間單位表示時 $2\pi f_\mathrm{out}$ 的換算抵消）；$f_L$ 取 Welch 的第一個非零頻率。`) },
          ]}
        />
        <TexBlock id="F-13.11">{String.raw`\delta t[n]=\Delta_\mathrm{LSB}\big(y[\lfloor n/N_\mathrm{upd}\rfloor]-w^*\big)x[n],\qquad\sigma_{t,\mathrm{out}}^2=\int_{f_L}^{f_s/2}|T(f)|^2S_{\delta t}^{(1)}(f)\,df`}</TexBlock>
        <p className="small">
          <ClaimTag kind="approx" /> 表中的 <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 直接模擬 <Tex>{String.raw`\delta t`}</Tex>（不假設獨立），再以 Welch PSD 乘 <Tex>{String.raw`|T|^2`}</Tex> 積分。Welch 每段先去平均，所以積分下限{' '}
          <Tex>{String.raw`f_L=f_s/N_\mathrm{seg}`}</Tex>（頻率解析度）以下的成分<strong>不在</strong> <Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 裡：整段紀錄的平均 <Tex>{String.raw`\overline{\delta t}`}</Tex>{' '}
          可能是靜態偏移（PLL 會吸收，不算 jitter），也可能是比紀錄更慢、分辨不出的差頻；各區塊平均的起伏則是 <Tex>{String.raw`f<f_L`}</Tex> 的「慢變成分」<Tex>{String.raw`\sigma_\mathrm{slow}`}</Tex>，本表另外列出（它在 PLL 通帶內，
          <Tex>{String.raw`|T|\approx1`}</Tex>）。<Tex>{String.raw`T(f)`}</Tex> 用 CT 二階原型（<Tex>{String.raw`f\ll f_s`}</Tex> 時才準）。完整 noise budget 還要包含 PD noise 與 cross-spectrum（§12.3）。 <Erratum id="E13" />
        </p>
        <ModeGate min="engineer">
          <CodeBlock source={quantSrc} region="mixing" path="src/simulation/models/quantizer.ts" caption="網站實際執行的 mixing（每個 reference cycle 一個 timing error 樣本）。" />
        </ModeGate>
      </Fold>
      {err && <Callout kind="danger">計算失敗：{err}</Callout>}
      {!rows && !err && <Callout kind="info">計算中…（Web Worker：4 個情境 <Tex>{String.raw`\times`}</Tex> 5 個策略，外加「FCW 陷阱」示範）</Callout>}
      {rows && (
        <div className="table-wrap">
          <table className="ch13-table ch13-table-wide" aria-label="規格 §13.5 六個準則下五種量化策略的模擬結果">
            <thead>
              <tr>
                <th>準則</th>
                <th>量測</th>
                {rows.map((r) => (
                  <th key={r.strategy}>{STRATEGY_SHORT[r.strategy]}</th>
                ))}
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.id}. {c.title}
                  </td>
                  <td className="small">{c.what}</td>
                  {rows.map((r) => (
                    <td key={r.strategy} className="nowrap">
                      {c.get(r)}
                    </td>
                  ))}
                  <td className="small">{typeof c.note === 'function' ? c.note(rows) : c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        欄位 A = Freeze、B = Toggle、C = Stochastic、D = ΔΣ、E = ΔΣ + dither（dither 寬度 <Tex>{String.raw`${DEFAULT_LAB_PARAMS.ditherLsb}\,\mathrm{LSB}`}</Tex> 峰對峰、RPDF）。由 <code>runQuantCriteria()</code> 在 Web Worker 計算；
        DC 誤差依 <Tex>{String.raw`\delta w=w-w^*`}</Tex> 約定。
      </p>
      <p>讀表之前先確認一件事：紀錄夠不夠長，表中的數字「解析得出來」嗎？</p>
      <Mermaid
        chart={CHART_RECORD_CHECK}
        caption="紀錄長度的檢查（sign-off 前先做）。先看上面：code 的週期與 DSM residue 的週期取最小公倍數，就是混頻產物的週期；再看菱形：紀錄比它長（綠色）結果才可信，比它短（紅色）時最大的產物會被看成靜態偏移。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{String.raw`P_\mathrm{code}`}</Tex> 是 code 的 limit-cycle 週期（以更新次數計），<Tex>{String.raw`P_\mathrm{DSM}`}</Tex> 是 DSM residue 的週期（以 reference cycle 計；這裡的 <Tex>{'K'}</Tex> 是 DSM 的 FCW 整數{' '}
        <Tex>{String.raw`\mathrm{frac}\cdot2^{20}`}</Tex>），<Tex>{String.raw`P_\mathrm{mix}=\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},\,P_\mathrm{DSM})`}</Tex> 是兩者相乘後的週期。<Tex>{'f_L'}</Tex> 是 Welch PSD 分辨得出來的最低頻率（<Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 的積分下限），比它慢的成分另外列為{' '}
        <Tex>{String.raw`\sigma_\mathrm{slow}`}</Tex>。下面的說明與「FCW 陷阱」就是圖上綠、紅兩個分支的模擬結果。
      </p>
      {c0 && c0.fLowHz !== null && (
        <p className="small muted">
          這張表「解析得出來」嗎？Mixing 用 {INPUT.params.mixSamples} 個 reference cycle（有 mixing 的情境都相同），<Tex>{String.raw`f_L=${fx(c0.fLowHz / 1e3, 2)}\,\mathrm{kHz}`}</Tex>。{DSM_BITS}-bit 的一階 DSM、
          <Tex>{String.raw`K=\mathrm{frac}\cdot2^{${DSM_BITS}}=${DSM_K}`}</Tex>，residue 的週期是 <Tex>{String.raw`2^{${DSM_BITS}}/\gcd(K,2^{${DSM_BITS}})=${DSM_PERIOD}`}</Tex> 個 cycle；與週期{' '}
          {DEFAULT_LAB_PARAMS.togglePeriod} 的 code 相乘，混頻產物的週期是 <Tex>{String.raw`\mathrm{lcm}(${DEFAULT_LAB_PARAMS.togglePeriod},${DSM_PERIOD})=${PROD_FAST}`}</Tex> 個 cycle（
          <Tex>{String.raw`N_\mathrm{upd}=${N_SLOW}`}</Tex> 時 <Tex>{String.raw`\mathrm{lcm}(${DEFAULT_LAB_PARAMS.togglePeriod * N_SLOW},${DSM_PERIOD})=${PROD_SLOW}`}</Tex>），所有產物都落在{' '}
          <Tex>{String.raw`f_s/${PROD_FAST}=${fx(DEFAULT_LAB_PARAMS.fs / PROD_FAST / 1e3, 2)}\,\mathrm{kHz}`}</Tex>（或 <Tex>{String.raw`f_s/${PROD_SLOW}=${fx(DEFAULT_LAB_PARAMS.fs / PROD_SLOW / 1e3, 2)}\,\mathrm{kHz}`}</Tex>）的整數倍上，都高於{' '}
          <Tex>{'f_L'}</Tex>：沒有東西藏在 DC 附近，所以「慢變成分」欄幾乎是 0。 <ClaimTag kind="exact" />
        </p>
      )}
      {rows && (
        <p className="small">
          準則 5 的模擬結果：<Tex>{String.raw`N_\mathrm{upd}`}</Tex> 由 1 改成 {N_SLOW} 時，<Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 變大的策略：{rateTrend.up.join('、') || '無'}；變小的策略：{rateTrend.down.join('、') || '無'}。
          直覺上「慢更新會把 toggle 的 tone 從 PLL 頻寬外搬進頻寬內，所以比較差」，但 code 誤差還要乘上 DSM residue <Tex>{String.raw`x[n]`}</Tex>：<Tex>{String.raw`N_\mathrm{upd}=1`}</Tex> 時，
          <Tex>{String.raw`2f_s/5`}</Tex> 的 code tone 與 <Tex>{'x'}</Tex> 的高次諧波（<Tex>{String.raw`kf_s/${DSM_PERIOD}`}</Tex>）之間有很多落在通帶內的差頻；<Tex>{String.raw`N_\mathrm{upd}=${N_SLOW}`}</Tex> 時 code 誤差在低頻，乘上沒有 DC 的{' '}
          <Tex>{'x'}</Tex> 反而被搬到 <Tex>{'x'}</Tex> 的 tone 旁邊（多半在通帶外）。哪個效應主導取決於策略、FCW 與 <Tex>{String.raw`T(f)`}</Tex>，只能逐案模擬。 <ClaimTag kind="approx" />
        </p>
      )}
      {phase && phase.toggle !== null && phase.dsNearest !== null && phase.dsFloor !== null && (
        <p className="small">
          <strong>D ≡ B 對 output jitter 也成立嗎？</strong> 常數 32.4 時 D 的 code 序列是 B 的循環移位（round-half-up），code 頻譜完全相同。乘上<strong>確定性</strong>的 DSM residue 之後，移位改變的是各個混頻產物的相位。模擬：B 的{' '}
          <Tex>{String.raw`\sigma_\mathrm{out}=${ntex(phase.toggle, 5)}\,\mathrm{fs}`}</Tex>；D（round-half-up）<Tex>{String.raw`${ntex(phase.dsNearest, 5)}\,\mathrm{fs}`}</Tex>（相對差{' '}
          <Tex>{ntex(Math.abs(phase.dsNearest - phase.toggle) / phase.toggle, 2)}</Tex>）；D（floor，與 B 逐點相同）<Tex>{String.raw`${ntex(phase.dsFloor, 5)}\,\mathrm{fs}`}</Tex>
          {Math.abs(phase.dsFloor - phase.toggle) <= 1e-12 * Math.max(1, phase.toggle) ? '（與 B 完全相同 ✓）' : '（與 B 不同 ✗）'}。只要混頻產物都解析得出來，B 與 D 的 output jitter 就幾乎一樣；但若有產物落在 DC
          附近，它的大小與正負號會跟著相位變——這就是下面的陷阱。 <ClaimTag kind="approx" />
        </p>
      )}
      {trap && bRow && (
        <Callout kind="danger" title={String.raw`FCW 陷阱：同一個 toggle，把 $\mathrm{frac}$ 從 $13/128$ 改成 $0.1$，最大的混頻產物就藏進 DC`}>
          <p>
            <Tex>{String.raw`\mathrm{frac}=${trap.frac}`}</Tex> 看起來更漂亮，但 {DSM_BITS}-bit 的 DSM 只能表示成 <Tex>{String.raw`K=\mathrm{round}(${trap.frac}\cdot2^{${DSM_BITS}})=${trap.K}`}</Tex>（
            <Tex>{String.raw`K/2^{${DSM_BITS}}=${fx(trap.K / 2 ** DSM_BITS, 8)}`}</Tex>）。residue 的週期變成 <Tex>{String.raw`2^{${DSM_BITS}}/\gcd=${trap.dsmPeriod}`}</Tex> 個 cycle，與週期 {DEFAULT_LAB_PARAMS.togglePeriod} 的 code
            相乘後，混頻週期是 <Tex>{String.raw`\mathrm{lcm}=${trap.productPeriod}`}</Tex> 個 cycle（<Tex>{String.raw`${fx((trap.productPeriod / DEFAULT_LAB_PARAMS.fs) * 1e3, 1)}\,\mathrm{ms}`}</Tex>），比上表的紀錄（
            {trap.short.samples} 個 cycle）長 {fx(trap.productPeriod / trap.short.samples, 0)} 倍。
          </p>
          <ul>
            <li>
              <strong>短紀錄看到的</strong>（與上表相同的 {trap.short.samples} 個 cycle）：B 的 <Tex>{String.raw`\sigma_\mathrm{out}=${ntex(trap.short.sigmaOutToggle, 3)}\,\mathrm{fs}`}</Tex>、D{' '}
              <Tex>{String.raw`${ntex(trap.short.sigmaOutDs, 3)}\,\mathrm{fs}`}</Tex>——比上表 B 的 <Tex>{ntex(bRow.constant.sigmaOutFs, 3)}</Tex> 小得多，看起來很乾淨；多出來的只是一個「靜態偏移」：B{' '}
              <Tex>{String.raw`${ntex(trap.short.meanToggle, 3)}`}</Tex>、D <Tex>{String.raw`${ntex(trap.short.meanDs, 3)}\,\mathrm{fs}`}</Tex>（B 與 D 還不一樣：相位不同）。
            </li>
            <li>
              <strong>模擬一整個混頻週期</strong>（{trap.samples} 個 cycle{trap.complete ? '' : '，受上限限制、未涵蓋完整週期'}，每 {trap.blockLen} 個 cycle 取一次平均）：那個「靜態偏移」其實是在{' '}
              <Tex>{String.raw`[${ntex(trap.levelMinFs, 3)},\ ${ntex(trap.levelMaxFs, 3)}]\,\mathrm{fs}`}</Tex> 之間慢慢換階的階梯，RMS <strong>{num(trap.slowRmsFs, 3)} fs</strong>——與上表（解析得出來的 FCW）B 的{' '}
              {num(bRow.constant.sigmaOutFs, 3)} fs 是同一個量級，而且全部落在 PLL 通帶內。
            </li>
          </ul>
          <Plot
            title={String.raw`FCW 陷阱：toggle $\times$ DSM residue 的慢階梯（$\mathrm{frac}=0.1$）`}
            ariaLabel="FCW 陷阱：toggle 乘上 DSM residue 的慢階梯（frac = 0.1）"
            data={trapData}
            height={240}
            csvName="ch13-fcw-trap-staircase"
            layout={{ xaxis: { title: { text: '時間 [ms]' } }, yaxis: { title: { text: String.raw`區塊平均 $\delta t$ [fs]` } } }}
            caption={
              <>
                由 <code>slowProductStaircase()</code> 計算：<Tex>{String.raw`\delta t[n]=\Delta_\mathrm{LSB}\,e[n]\,x[n]`}</Tex> 每 {trap.blockLen} 個 cycle 的平均（比 <Tex>{String.raw`f_L`}</Tex>{' '}
                慢的成分）。粗線是只模擬 {trap.short.samples} 個 cycle 時看到的那一段：一條水平線，被誤認成靜態偏移。
              </>
            }
          />
          <p className="small">
            教訓：limit cycle 與 DSM residue 幾乎同頻時，最大的混頻產物會落在極低頻；紀錄比混頻週期短，就只看得到「靜態偏移」，<Tex>{String.raw`\sigma_\mathrm{out}`}</Tex>{' '}
            被嚴重低估。Sign-off 前先算 <Tex>{String.raw`\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},\,P_\mathrm{DSM})`}</Tex> 與紀錄長度比較（實驗會在紀錄太短時警告），並掃過實際會用到的 FCW。 <ClaimTag kind="exact" />
          </p>
          <ModeGate min="engineer">
            <Fold title="程式碼：一整個混頻週期的區塊平均（slowProductStaircase）" openFrom="research">
              <CodeBlock source={quantSrc} region="slowProduct" path="src/simulation/models/quantizer.ts" />
            </Fold>
          </ModeGate>
        </Callout>
      )}
      <Callout kind="warn" title="怎麼讀這張表">
        <ul>
          <li>
            沒有一個策略在六個準則都贏。Freeze 沒有 code 譜線、沒有切換
            {freezeVsRandom === null || sA === null
              ? ''
              : freezeVsRandom
                ? <>，本例的 output jitter（<Tex>{String.raw`\sqrt{\sigma_\mathrm{out}^2+\sigma_\mathrm{slow}^2}=${ntex(sA, 3)}\,\mathrm{fs}`}</Tex>）也比 C（{n(sC, 3)}）、E（{n(sE, 3)}）小（模擬結果）</>
                : <>，但本例的 output jitter（<Tex>{String.raw`\sqrt{\sigma_\mathrm{out}^2+\sigma_\mathrm{slow}^2}=${ntex(sA, 3)}\,\mathrm{fs}`}</Tex>）並不比 C（{n(sC, 3)}）、E（{n(sE, 3)}）小（模擬結果）</>}
            ；它的 static error 與 PVT 追蹤最差。 <ClaimTag kind="approx" />
          </li>
          <li>
            ΔΣ 對<strong>靜態</strong>目標並沒有比 toggle 好（同一個 limit cycle）；它的優勢在時變 / 漂移情境（準則 4）。 <ClaimTag kind="exact" />
          </li>
          <li>
            Dither（E）消除譜線（準則 2），代價是總功率與 code 擺幅上升
            {sD !== null && sE !== null ? (
              sE < sD ? (
                <>
                  ；本例經 mixing 後 E 的 output jitter（{n(sE, 3)} fs）反而比沒有 dither 的 D（{n(sD, 3)} fs）小——limit cycle 的 tone 才是落回通帶的主因
                </>
              ) : (
                <>
                  ；本例經 mixing 後 E 的 output jitter（{n(sE, 3)} fs）比 D（{n(sD, 3)} fs）大
                </>
              )
            ) : null}
            。換一個 FCW 或 <Tex>{'T(f)'}</Tex> 結論就可能不同（準則 6）。 <ClaimTag kind="research" />
          </li>
          <li>
            更新率（準則 5）的影響不能只看 code tone 落在 <Tex>{'T(f)'}</Tex> 內或外
            {bRow && bRow.constant.sigmaOutFs !== null && bRow.slow.sigmaOutFs !== null ? (
              <>
                ：同一個 toggle，<Tex>{String.raw`N_\mathrm{upd}`}</Tex> 由 1 改成 {N_SLOW}，<Tex>{String.raw`\sigma_\mathrm{out}`}</Tex> 由 {n(bRow.constant.sigmaOutFs, 3)} 變成 {n(bRow.slow.sigmaOutFs, 3)} fs
              </>
            ) : null}
            。
          </li>
        </ul>
      </Callout>
      <Mermaid
        chart={CHART_DECISION}
        caption="沿著六個準則的選擇流程（教學用的思考順序，不是 sign-off 規則）。先看第一個六角形的問題：能接受 static error、又不必追漂移，就不需要任何切換；再往下：$w_H$ 會不會動、tone 會不會被混回通帶、能不能接受較大的 code 擺幅。每一條路最後都回到藍色方塊：用實際的 FCW 與 $T(f)$ 模擬確認。"
      />
      <p className="small ch13-figwalk">
        這張圖只是把上面「怎麼讀這張表」的四點排成先後順序：每個六角形上標的準則編號就是表中的那一列。它是本例（這一組 FCW、<Tex>{'T(f)'}</Tex> 與 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>）下的歸納，不是定理；換一組參數時，分支的答案要重新用模擬回答（準則 5、6）。{' '}
        <ClaimTag kind="approx" />
      </p>
      <ModeGate min="research">
        <p className="small">
          研究延伸（規格附錄 C R3）：二階 / MASH ΔΣ、PRBS 長度與 seed、FCW 與 code 更新率的 limit cycle 交互作用、Freeze vs Background Tracking 的 jitter–spur–drift
          trade-off，都需要完整 multirate / cyclostationary 模擬（本表只是 L5 的示例）。 <ClaimTag kind="research" />
        </p>
      </ModeGate>
    </Section>
  )
}
