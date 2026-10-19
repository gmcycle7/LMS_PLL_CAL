import { useMemo, useState } from 'react'
import { Callout, ClaimTag, ModeGate, ParamControl, Section, SelectControl, SourceTag, Tex, TexBlock } from '@/components'
import { settleFromPoles } from '@/simulation/models/stability'
import { F_REF, gammaEff, gosBeta, gosHarmonic, inversionBands, makeL2, type SspllLoop } from '@/simulation/models/sspll'
import { cornerFeasibleScan, cornerJudge, kq, type CornerRowResult, type CornerSpec } from '../judges'
import { CHART_PVT_EFFECTS } from '../diagrams'
import { Diagram, HandCalcSlot, Steps, Verdict, nf, tx } from '../shared'
import './S4bPvt.css'

/**
 * §4b PVT corner 表（2026-10-19，審查 depth：PVT 的三種效應分開在三個工具——K_q（σ_v）、迴路增益／帶緣、a 的漂移——沒有一張表放在使用者的迴路上）。
 * 把三種效應放到同一個迴路（案例頁的 L2：Type-II SSPLL、320 MHz、GOS 鋸齒 regressor）上：
 *   (1) σ_v 隨 corner 變 → K_q = √(2/π)/σ_v（Ch05）；
 *   (2) 迴路增益隨 PVT 變（不重新設計）→ H_PD 的反號帶緣 f_inv 移動 → regressor 的有效相關 κ_GOS(β) 變（案例頁 §6.5、§7）；
 *   (3) 溫度讓 DTC 的真實 gain a 漂移 → 校正後的初始誤差 Δa 要重新收斂、溫度斜坡要追蹤（Ch14 的 ramp 追蹤）。
 * 每一格都由既有的模型函式算：kq／cornerJudge／cornerFeasibleScan（judges.ts）、settleFromPoles（stability.ts）、
 * makeL2／inversionBands／gosHarmonic（sspll.ts）。數字全部是 illustrative：corner 的 σ_v 與迴路增益倍率沿用 Corner 判斷器的預設值。
 * 方塊圖 CHART_PVT_EFFECTS 定義在 ../diagrams.ts（三種效應進入迴路的位置；本檔重新匯出）；手算題 HC-SO.7（handcalcs.ts）。
 */

export interface PvtCorner {
  name: string
  /** comparator 雜訊 [fs] */
  sigmaV: number
  /** 主迴路增益相對標稱的倍率（PVT 之後不重新設計） */
  gainScale: number
  /** 溫度 [°C] */
  tempC: number
}

export interface PvtParams {
  corners: PvtCorner[]
  /** learning rate [fs]（所有 corner 共用） */
  mu: number
  /** 更新延遲 [blocks] */
  d: number
  N: number
  /** 允許的收斂 block 數（初始 δ 降到 5%） */
  B: number
  pmTargetDeg: number
  sigmaWMax: number
  /** FCW 的小數部分：GOS 鋸齒的基頻 β = frac(8α) */
  alpha: number
  /** DTC 的真實 gain a（以時間計；illustrative：T_vco = 62.5 ps @ 16 GHz）[fs] */
  aFs: number
  /** a 的溫度係數 [ppm/°C]（相對於 TT 25°C） */
  tcPpm: number
  /** 校準在 TT 25°C 做；重新收斂的容許誤差 [fs] */
  deltaTolFs: number
  /** 溫度斜坡 [°C/s]（追蹤） */
  rampCPerS: number
}

/** illustrative 預設：corner 的 σ_v 與 Corner 判斷器（§4）相同，迴路增益倍率取案例頁 §6.5 表的 ×0.8／×1／×1.25 */
export const PVT_DEFAULT: PvtParams = {
  corners: [
    { name: 'SS −40°C', sigmaV: 140, gainScale: 0.8, tempC: -40 },
    { name: 'TT 25°C', sigmaV: 100, gainScale: 1, tempC: 25 },
    { name: 'FF 125°C', sigmaV: 70, gainScale: 1.25, tempC: 125 },
  ],
  mu: 10,
  d: 1,
  N: 4096,
  B: 120,
  pmTargetDeg: 60,
  sigmaWMax: 1,
  alpha: 0.137,
  aFs: 62500,
  tcPpm: 300,
  deltaTolFs: 5,
  rampCPerS: 10,
}

/** 標稱的 L2（案例頁 §6.2：PM 60°、320 MHz）；增益倍率乘在設計好的 K_p、K_i 上 */
const NOMINAL = makeL2({ pm: 60 })
const KP = Number(NOMINAL.params.Kp)
const KI = Number(NOMINAL.params.Ki)
export const PVT_LOOP_PARAMS = { Kp: KP, Ki: KI }

export function pvtLoop(gainScale: number): SspllLoop {
  return makeL2({ Kp: KP, Ki: KI, gainScale })
}

export interface PvtEffectRow {
  name: string
  sigmaV: number
  Kq: number
  gainScale: number
  /** 反號帶上緣 [MHz]（Type-II 一定從 DC 開始） */
  fInvMHz: number
  /** 帶內最負的 Re H_PD */
  minReH: number
  /** GOS 鋸齒的基頻 β 與折回後的頻率 [MHz] */
  beta: number
  fSawMHz: number
  /** 有效相關 κ_GOS = 12·C_GOS(β)（案例頁 §7；H ≡ 1 時為 1） */
  kappa: number
  /** K_c = K_q·κ [fs⁻¹] */
  K: number
  /** 溫度造成的 a 偏移 Δa = a·TC·(T − 25°C) [fs] */
  deltaAFs: number
}

// #region core:pvtEffects
/** 三種效應各自算一次：σ_v → K_q；增益倍率 → 帶緣、κ_GOS；溫度 → Δa */
export function pvtEffects(p: PvtParams): PvtEffectRow[] {
  const beta = gosBeta(p.alpha)
  const fSawMHz = (Math.min(beta, 1 - beta) * F_REF) / 1e6
  return p.corners.map((c) => {
    const loop = pvtLoop(c.gainScale)
    const bands = inversionBands(loop)
    const band = bands[0]
    const kappa = 12 * gosHarmonic(p.alpha, gammaEff(loop)) // C_GOS/var(ρ)，var(ρ) = 1/12
    const Kq = kq(c.sigmaV)
    return {
      name: c.name,
      sigmaV: c.sigmaV,
      Kq,
      gainScale: c.gainScale,
      fInvMHz: band ? (band.fHi * F_REF) / 1e6 : 0,
      minReH: band ? band.minReH : 0,
      beta,
      fSawMHz,
      kappa,
      K: Kq * kappa,
      deltaAFs: p.aFs * p.tcPpm * 1e-6 * (c.tempC - 25),
    }
  })
}
// #endregion

export interface PvtLoopRow extends PvtEffectRow {
  judge: CornerRowResult
  /** 校準在 TT 做、搬到這個 corner 後，|Δa| 降到 δ_tol 要幾個 block（settleFromPoles，frac = δ_tol/|Δa|）；Δa 已在容許內為 0 */
  reconvergeBlocks: number
  reconvergeExact: boolean
  /** 溫度斜坡每個 block 讓 a 漂多少 [fs/block] */
  driftPerBlock: number
  /** 追蹤 ramp 的穩態落後 δ_lag = ȧ/g [fs]（Ch14 F-14.12 的 lag 項） */
  lagFs: number
}

/** cornerJudge 需要 (σ_v, θ)、C = cos θ；這裡的 C 是 κ_GOS（可能 > 1），所以改送等效的 σ_v/κ 與 θ = 0：K = K_q(σ_v/κ) = K_q(σ_v)·κ */
export function pvtCornerSpecs(rows: PvtEffectRow[]): CornerSpec[] {
  return rows.map((r) => ({ name: r.name, sigmaV: r.sigmaV / r.kappa, thetaDeg: 0 }))
}

// #region core:pvtTable
/** 同一組 (μ, d, N, B) 在每個 corner：五項判準（cornerJudge）＋ a 漂移的兩個後果（重新收斂、斜坡落後） */
export function pvtTable(p: PvtParams): PvtLoopRow[] {
  const rows = pvtEffects(p)
  const judged = cornerJudge(pvtCornerSpecs(rows), { mu: p.mu, d: p.d, pmTargetDeg: p.pmTargetDeg, B: p.B, N: p.N, sigmaWMax: p.sigmaWMax })
  const fu = F_REF / p.N // 更新率 [blocks/s]
  return rows.map((r, i) => {
    const j = judged[i]
    const frac = Math.abs(r.deltaAFs) > p.deltaTolFs ? p.deltaTolFs / Math.abs(r.deltaAFs) : 1
    const settle = frac < 1 && j.rho < 1 ? settleFromPoles(j.g, p.d, frac) : null
    const driftPerBlock = (p.aFs * p.tcPpm * 1e-6 * p.rampCPerS) / fu
    return {
      ...r,
      judge: j,
      reconvergeBlocks: settle ? settle.blocks : frac < 1 ? Infinity : 0,
      reconvergeExact: settle ? settle.exact : true,
      driftPerBlock,
      lagFs: j.g > 0 && j.rho < 1 ? driftPerBlock / j.g : Infinity,
    }
  })
}
// #endregion

/** μ 的可行區（所有 corner 五項判準都過）：和 §4 的 Corner 判斷器同一個掃描函式 */
export function pvtFeasible(p: PvtParams) {
  const rows = pvtEffects(p)
  return cornerFeasibleScan(pvtCornerSpecs(rows), { d: p.d, pmTargetDeg: p.pmTargetDeg, B: p.B, N: p.N, sigmaWMax: p.sigmaWMax }, undefined, [p.mu])
}

export { CHART_PVT_EFFECTS }


function pct(x: number): string {
  return `${x >= 0 ? '+' : '−'}${nf(Math.abs(x) * 100, 3)}%`
}

export function S4bPvt() {
  const [p, setP] = useState<PvtParams>(PVT_DEFAULT)
  const set = <K extends keyof PvtParams>(k: K, v: PvtParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const rows = useMemo(() => pvtTable(p), [p])
  const scan = useMemo(() => pvtFeasible(p), [p])
  const allOk = rows.every((r) => Object.values(r.judge.ok).every(Boolean))
  const tt = rows[1]
  const fuMHz = F_REF / p.N / 1e6
  return (
    <Section kind="formula" level={2} title="4b. PVT corner 表：三種效應放在同一個迴路上" id="so-pvt" className="so-pvt">
      <>
        <p>
          §4 的 Corner 判斷器把每個 corner 壓成一對數字 <Tex>{'(\\sigma_{v,c},\\theta_c)'}</Tex>。但 PVT 其實從<strong>三個</strong>地方進來，而且本站把它們放在三個工具裡：<Tex>{'\\sigma_v'}</Tex> 變 <Tex>{'K_q'}</Tex>（
          <a href="#/ch/05">Ch05</a>）、主迴路增益變則 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 的反號帶緣移動、regressor 的有效相關跟著變（<a href="#/case/sspll">案例頁</a> §6.5、§7）、溫度讓 DTC 的真實 gain <Tex>{'a'}</Tex> 漂走（<a href="#/ch/14">Ch14</a> 的追蹤）。這一節把三種效應放到<strong>同一個迴路</strong>——案例頁的 L2（Type-II SSPLL、320 MHz）、GOS 鋸齒 regressor——上，一張表看同一個 <Tex>{'\\mu'}</Tex> 在三個 corner 的下場。
        </p>
        <Diagram
          chart={CHART_PVT_EFFECTS}
          caption={String.raw`PVT 三種效應進入迴路的位置：① 雜訊改 $K_q$、② 主迴路增益改 $H_{PD}$ 的帶緣與 regressor 的有效相關 $\kappa_c$，兩者相乘才是藍色方塊的 $K_c$；③ 溫度讓 $a$ 漂移，不改 $K_c$，但要重新收斂、還要追斜坡。綠色是最後要交出的東西：三個 corner 都過的 $\mu$ 區間。`}
          ariaLabel="PVT 三種效應進入校正迴路的位置：雜訊改 comparator 增益 K_q、主迴路增益改反號帶緣與有效相關 kappa，相乘得到每個 corner 的 K_c 與 g_c 再過五項判準；溫度讓 DTC gain 漂移，要重新收斂並追蹤斜坡；最後取三個 corner 都通過的 mu 區間"
        >
          <p>
            先看最上面三條分岔：同一個 corner 同時改變 <Tex>{'\\sigma_v'}</Tex>、主迴路增益與 <Tex>{'a'}</Tex>。再看藍色方塊：前兩種效應<strong>相乘</strong>——<Tex>{'K_c=K_q(\\sigma_{v,c})\\,\\kappa_c'}</Tex>，<Tex>{'\\kappa_c'}</Tex> 是這個 corner 的迴路下 GOS 鋸齒的有效相關（案例頁 §7 的 <Tex>{'12\\,C_{GOS}'}</Tex>，等於 §4 的{' '}
            <Tex>{'\\cos\\theta_c'}</Tex>），所以「雜訊最小的 corner 最快」這句話要修正成「<Tex>{'K_q\\kappa'}</Tex> 最大的 corner 最快」。最後看 <Tex>{'a'}</Tex> 那一條：它不改 <Tex>{'K_c'}</Tex>，但在 TT 校準好的 <Tex>{'w'}</Tex> 搬到別的 corner 就差了{' '}
            <Tex>{'\\Delta a_c'}</Tex>，迴路要用自己的 <Tex>{'g_c'}</Tex> 把它收掉；溫度斜坡則是每個 block 都在漂，迴路永遠落後 <Tex>{'\\dot a/(f_u g_c)'}</Tex>。
          </p>
        </Diagram>
        <Steps
          title={String.raw`三種效應怎麼進入 $K_c$、$g_c$ 與 $\Delta a_c$`}
          steps={[
            { tex: String.raw`K_q(\sigma_{v,c})=\frac{\sqrt{2/\pi}}{\sigma_{v,c}}`, why: String.raw`效應 ①：Ch05 的 comparator 小訊號增益（只在 $|e|\ll\sigma_v$ 成立）。` },
            { tex: String.raw`L_c(z)=s_c\,L(z)\ \Rightarrow\ f_{inv}(s_c)=\frac1\pi\arcsin\sqrt{\frac{s_cK_i}{2(2-s_cK_p)}},\qquad \kappa_c=12\sum_{m\ge1}\frac{\mathrm{Re}\,H_{PD,c}(\mathrm{frac}(m\beta))}{2\pi^2m^2}`, why: String.raw`效應 ②：PVT 把設計好的 $K_p$、$K_i$ 一起乘上 $s_c$（不重新設計）；帶緣是案例頁 F-CS.8 的 closed form，GOS 的有效相關是 F-CS.11 的諧波和（$\beta=\mathrm{frac}(8\alpha)$）。` },
            { tex: String.raw`K_c=K_q(\sigma_{v,c})\,\kappa_c,\qquad g_c=\mu K_c`, why: String.raw`兩種效應相乘。§4 的判斷器寫成 $K_q\cos\theta_c$：這裡 $\cos\theta_c\to\kappa_c$（可以大於 1，因為 $\mathrm{Re}\,H_{PD}$ 在帶外有 peaking）。` },
            { tex: String.raw`\Delta a_c=a\cdot\mathrm{TC}\cdot(T_c-25^\circ\mathrm{C})`, why: String.raw`效應 ③：DTC gain 的溫度係數（illustrative：$300$ ppm/°C）；校準在 TT 做，搬到 corner 之後初始誤差就是 $\Delta a_c$。` },
            { tex: String.raw`\lvert\Delta a_c\rvert\,\lvert y_k\rvert\le\delta_{tol}\ \Rightarrow\ k_{re}=\text{settleFromPoles}\big(g_c,d,\tfrac{\delta_{tol}}{\lvert\Delta a_c\rvert}\big)`, why: String.raw`重新收斂：平均誤差 $y_k$ 由 $z^{d+1}-z^d+g_c=0$ 的極點模態展開逐步求值（§4 的 $k_{95}$ 把 5% 換成 $\delta_{tol}/|\Delta a_c|$）。` },
            { tex: String.raw`\dot a=a\cdot\mathrm{TC}\cdot\dot T,\qquad r=\frac{\dot a}{f_u}\ \Big[\frac{\mathrm{fs}}{\mathrm{block}}\Big],\qquad \delta_{lag}=\frac{r}{g_c}`, why: String.raw`斜坡追蹤：$\delta_{k+1}=(1-g_c)\delta_k+r$ 的穩態是 $r/g_c$（Ch14 F-14.12 的 lag 項）；$f_u=f_{ref}/N$ 是 block 率。` },
          ]}
          result={String.raw`\mu\ \text{可行}\iff\text{三個 corner 的五項判準都過}\ \wedge\ k_{re,c}\le B\ \wedge\ \delta_{lag,c}\le\delta_{tol}`}
        />
        <TexBlock id="F-SO.14" label="PVT corner 表的一列：三種效應進入迴路的四條式子">
          {String.raw`\begin{aligned}K_c&=\frac{\sqrt{2/\pi}}{\sigma_{v,c}}\,\kappa_c\\[4pt]f_{inv}(s_c)&=\frac1\pi\arcsin\sqrt{\frac{s_cK_i}{2(2-s_cK_p)}}\\[4pt]\Delta a_c&=a\,\mathrm{TC}\,(T_c-25^\circ\mathrm{C})\\[4pt]\delta_{lag,c}&=\frac{a\,\mathrm{TC}\,\dot T\,N}{f_{ref}\,g_c}\end{aligned}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 在線性化平均模型內：<Tex>{'K_q'}</Tex>（L1）、帶緣與 <Tex>{'\\kappa_c'}</Tex>（L2、凍結權重）、模態展開的 <Tex>{'k_{re}'}</Tex> 與斜坡落後（一階平均模型）都是精確的；<ClaimTag kind="approx" /> 「增益倍率不重新設計」與 TC、
          <Tex>{'\\sigma_v'}</Tex> 的 corner 數字是 illustrative。<SourceTag kind="illustrative" />
        </p>
        <div className="so-pvt-controls">
          <ParamControl label={String.raw`$\mu$（所有 corner 共用）`} ariaLabel="learning rate mu" value={p.mu} onChange={(v) => set('mu', v)} min={0.5} max={60} step={0.5} unit="fs" />
          <SelectControl label="更新延遲 $d$" value={p.d} onChange={(v) => set('d', Number(v))} options={[0, 1, 2]} />
          <ParamControl label={String.raw`FCW 小數 $\alpha$（GOS 基頻 $\beta=\mathrm{frac}(8\alpha)$）`} ariaLabel="FCW fractional part alpha" value={p.alpha} onChange={(v) => set('alpha', v)} min={0.001} max={0.499} step={0.001} digits={4} />
          <ParamControl label="溫度係數 TC" ariaLabel="DTC gain temperature coefficient" value={p.tcPpm} onChange={(v) => set('tcPpm', v)} min={0} max={2000} step={10} unit="ppm/°C" />
          <ParamControl label={String.raw`溫度斜坡 $\dot T$`} ariaLabel="temperature ramp" value={p.rampCPerS} onChange={(v) => set('rampCPerS', v)} min={0} max={1000} step={1} unit="°C/s" />
          <ParamControl label={String.raw`容許誤差 $\delta_{tol}$`} ariaLabel="tolerance delta tol" value={p.deltaTolFs} onChange={(v) => set('deltaTolFs', v)} min={0.1} max={100} step={0.1} unit="fs" />
        </div>
        <div className="table-wrap">
          <table className="so-corner-table so-pvt-table">
            <caption>表 4b-1：三種效應各自的數字（每個 corner 一列；illustrative）</caption>
            <thead>
              <tr>
                <th scope="col">corner</th>
                <th scope="col" className="num"><Tex>{'\\sigma_v'}</Tex> [fs]</th>
                <th scope="col" className="num"><Tex>{'K_q'}</Tex> [fs⁻¹]</th>
                <th scope="col" className="num">增益 <Tex>{'s_c'}</Tex></th>
                <th scope="col" className="num"><Tex>{'f_{inv}'}</Tex> [MHz]</th>
                <th scope="col" className="num"><Tex>{'\\min\\mathrm{Re}\\,H_{PD}'}</Tex></th>
                <th scope="col" className="num"><Tex>{'\\kappa_c'}</Tex></th>
                <th scope="col" className="num"><Tex>{'K_c'}</Tex> [fs⁻¹]</th>
                <th scope="col" className="num"><Tex>{'\\Delta a_c'}</Tex> [fs]</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} data-corner={r.name}>
                  <th scope="row">{r.name}</th>
                  <td className="num">{nf(r.sigmaV, 4)}</td>
                  <td className="num">{nf(r.Kq, 4)}</td>
                  <td className="num">×{nf(r.gainScale, 3)}</td>
                  <td className="num">{nf(r.fInvMHz, 5)}</td>
                  <td className="num">{nf(r.minReH, 4)}</td>
                  <td className="num">{nf(r.kappa, 4)}</td>
                  <td className="num">{nf(r.K, 4)}</td>
                  <td className="num">
                    {nf(r.deltaAFs, 4)} <span className="muted small">（{pct(r.deltaAFs / p.aFs)}）</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          GOS 鋸齒基頻 <Tex>{`\\beta=\\mathrm{frac}(8\\times${tx(p.alpha, 4)})=${tx(tt.beta, 4)}`}</Tex>，折回後 {nf(tt.fSawMHz, 4)} MHz；三個 corner 的帶緣 {rows.map((r) => nf(r.fInvMHz, 4)).join('／')} MHz——增益越高、帶越寬。<Tex>{'\\kappa_c'}</Tex> 是把鋸齒的全部諧波（不只基波）各乘上該 corner 的{' '}
          <Tex>{'\\mathrm{Re}\\,H_{PD}'}</Tex> 再加總，所以帶緣移動的效果已經含在裡面（基波在帶內時 <Tex>{'\\kappa'}</Tex> 可以很小甚至為負）。<Tex>{'a=T_{vco}=' + tx(p.aFs / 1000, 3) + '\\,\\mathrm{ps}'}</Tex>（16 GHz 的 VCO 週期，illustrative）。
        </p>
        <div className="table-wrap">
          <table className="so-corner-table so-pvt-table">
            <caption>表 4b-2：同一組 (μ, d, N, B) 在每個 corner 的五項判準與 a 漂移的後果</caption>
            <thead>
              <tr>
                <th scope="col">corner</th>
                <th scope="col" className="num"><Tex>{'g_c'}</Tex></th>
                <th scope="col" className="num"><Tex>{'\\rho_c'}</Tex></th>
                <th scope="col" className="num"><Tex>{'PM_d'}</Tex></th>
                <th scope="col" className="num"><Tex>{'k_{95}'}</Tex></th>
                <th scope="col" className="num"><Tex>{'\\sigma_{w,c}'}</Tex> [fs]</th>
                <th scope="col" className="num">重新收斂 <Tex>{'k_{re}'}</Tex></th>
                <th scope="col" className="num">斜坡落後 <Tex>{'\\delta_{lag}'}</Tex> [fs]</th>
                <th scope="col">判定</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const j = r.judge
                const ok = Object.values(j.ok).every(Boolean)
                const fails = (Object.entries(j.ok) as [keyof typeof j.ok, boolean][]).filter(([, v]) => !v).map(([k]) => ({ polarity: '極性', stable: '穩定', pm: 'PM', settle: '收斂', noise: '雜訊' })[k])
                const reOk = r.reconvergeBlocks <= p.B
                const lagOk = r.lagFs <= p.deltaTolFs
                return (
                  <tr key={r.name} data-corner={r.name} data-ok={ok && reOk && lagOk}>
                    <th scope="row">{r.name}</th>
                    <td className="num">{nf(j.g, 4)}</td>
                    <td className="num">{nf(j.rho, 5)}</td>
                    <td className="num">{Number.isFinite(j.pm) ? `${nf(j.pm, 4)}°` : '—'}</td>
                    <td className="num">{Number.isFinite(j.settle95) ? `${j.settle95Exact ? '' : '≥ '}${j.settle95}` : '∞'}</td>
                    <td className="num">{nf(j.sigmaW, 4)}</td>
                    <td className="num">{Number.isFinite(r.reconvergeBlocks) ? `${r.reconvergeExact ? '' : '≥ '}${r.reconvergeBlocks}` : '∞'}</td>
                    <td className="num">{Number.isFinite(r.lagFs) ? nf(r.lagFs, 3) : '∞'}</td>
                    <td>
                      {ok && reOk && lagOk ? (
                        <Verdict kind="ok">通過</Verdict>
                      ) : (
                        <Verdict kind="bad">{[...fails, ...(reOk ? [] : ['重新收斂']), ...(lagOk ? [] : ['斜坡落後'])].join('、')}不過</Verdict>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p>
          判定與 §4 完全相同（<Tex>{'K_c>0'}</Tex>、<Tex>{'\\rho_c<1'}</Tex>、<Tex>{`PM_d\\ge${p.pmTargetDeg}^\\circ`}</Tex>、<Tex>{`k_{95}\\le B=${p.B}`}</Tex>、<Tex>{`\\sigma_w\\le${p.sigmaWMax}\\,\\mathrm{fs}`}</Tex>），多兩項：重新收斂 <Tex>{'k_{re}\\le B'}</Tex> 與斜坡落後{' '}
          <Tex>{'\\delta_{lag}\\le\\delta_{tol}'}</Tex>。目前 <Tex>{`\\mu=${tx(p.mu, 4)}`}</Tex> fs：{allOk ? <Verdict kind="ok">三個 corner 的五項判準都過</Verdict> : <Verdict kind="bad">至少一個 corner 不過</Verdict>}；所有 corner 同時通過五項判準的 <Tex>{'\\mu'}</Tex> 區間（§4 判斷器的掃描，240 個對數格點）：
          {Number.isFinite(scan.lo) ? (
            <>
              {' '}
              <Tex>{`${tx(scan.lo, 4)}\\le\\mu\\le${tx(scan.hi, 4)}`}</Tex> fs。
            </>
          ) : (
            <> 空集合（沒有任何 <Tex>{'\\mu'}</Tex> 同時過三個 corner）。</>
          )}
          斜坡落後：<Tex>{`f_u=${tx(fuMHz, 4)}`}</Tex> MHz 的 block 率下，<Tex>{`\\dot T=${tx(p.rampCPerS, 3)}`}</Tex> °C/s 每個 block 只漂 <Tex>{`${tx(tt.driftPerBlock, 3)}`}</Tex> fs，落後 <Tex>{`r/g_c`}</Tex> 在 fs 以下——溫度斜坡對 MHz 級的更新率幾乎不是問題，真正的門檻是搬到 corner 之後的<strong>重新收斂</strong>（<Tex>{'|\\Delta a_c|'}</Tex> 可以是幾千 fs，要在 <Tex>{'B'}</Tex> 內降到 <Tex>{'\\delta_{tol}'}</Tex>）。
        </p>
        <Callout kind="warn" title="三種效應不是各自獨立地加起來">
          <p>
            效應 ① 和 ② 相乘：SS corner 雜訊大（<Tex>{'K_q'}</Tex> 小）<strong>而且</strong>迴路增益低（帶緣往下、<Tex>{'\\kappa'}</Tex> 可能變小或變大，看 <Tex>{'\\beta'}</Tex> 落在哪），兩者一起決定最慢的 corner；FF corner 相反。效應 ③ 不改 <Tex>{'K_c'}</Tex>，但最慢的 corner 同時也是最難把 <Tex>{'\\Delta a'}</Tex> 收掉的 corner。所以「取 <Tex>{'\\sigma_v'}</Tex> 最差的 corner 算 <Tex>{'k_{95}'}</Tex>」會漏掉增益與 <Tex>{'\\kappa'}</Tex> 的交互作用；要像上表一樣逐 corner 把三個數字都算出來。把 <Tex>{'\\alpha'}</Tex> 調到讓鋸齒基波落進某個 corner 的反號帶（例如{' '}
            <Tex>{'\\alpha=0.123'}</Tex>），可以看到 <Tex>{'\\kappa'}</Tex> 在三個 corner 的差別被放大。
          </p>
        </Callout>
        <HandCalcSlot id="HC-SO.7">
          預設是上表 SS −40°C 那一列（<Tex>{'\\sigma_v=140\\,\\mathrm{fs}'}</Tex>、增益 ×0.8、<Tex>{'\\kappa'}</Tex> 由表讀入、<Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex>、<Tex>{'d=0'}</Tex>）。把 TC 改成 1000 ppm/°C，看重新收斂要幾個 block；把 <Tex>{'\\dot T'}</Tex> 改成 1000 °C/s，看落後還是不是可以忽略。
        </HandCalcSlot>
        <ModeGate min="research">
          <p className="small muted">
            增益倍率 <Tex>{'s_c'}</Tex> 只是把 PVT 對主迴路的影響壓成一個數字（案例頁 §6.5 的作法：帶緣 101／135／154 MHz 對應 ×0.6／×1／×1.25）；真實的 PVT 會同時改 <Tex>{'K_p'}</Tex>、<Tex>{'K_i'}</Tex> 的比例與延遲。<Tex>{'\\kappa_c'}</Tex> 用的是線性化（Bussgang）的小訊號相關；
            <Tex>{'|\\Delta a_c|'}</Tex> 幾千 fs 時 comparator 一開始是飽和的（大訊號 sign-LMS 以 <Tex>{'\\mu'}</Tex> 的固定步長前進，案例頁 §10.4），<Tex>{'k_{re}'}</Tex> 的線性估計在那一段只是下界。
          </p>
        </ModeGate>
      </>
    </Section>
  )
}
