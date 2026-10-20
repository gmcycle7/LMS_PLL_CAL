import { Callout, ClaimTag, CodeBlock, FormulaLink, ModeGate, ModelLevel, Quiz, Section, SourceTag, Tex, TexBlock, ChRef } from '@/components'
import acquisitionSrc from '@/simulation/models/acquisition.ts?raw'
import { ACQ_STATE_LABEL, DEFAULT_ACQ, acquisitionAnalytic, acquisitionTimeline, fllCyclesToTol, noFllCheck, noFllConfig } from '@/simulation/models/acquisition'
import { Diagram } from '../Diagram'
import { CHART_ACQ_PATH, CHART_ACQ_SM } from '../diagrams'
import { Hand } from '../Hand'
import { md, nf, Steps, tx } from '../shared'

/** 預設情境（illustrative）的封閉式與無雜訊時間表：內文的每個數字都從這裡來。 */
export const ACQ_A = acquisitionAnalytic(DEFAULT_ACQ)
export const ACQ_TL = acquisitionTimeline(DEFAULT_ACQ)
export const ACQ_TL_LINEAR = acquisitionTimeline({ ...DEFAULT_ACQ, pdShape: 'linear' })
export const ACQ_LOSS = acquisitionTimeline({ ...DEFAULT_ACQ, lossCycle: 12288, cycles: 32768 })
/** 手算例（HC-14.10）：σ_f = 0.4 MHz（z = 2.5）的 lock detect 統計 */
export const ACQ_HC = acquisitionAnalytic({ ...DEFAULT_ACQ, sigmaFHz: 4e5 })
/** 「試試看」：K_f 減半（g_f = 1.6）。無雜訊封閉式的 LOCK，與預設 σ_f 下 renewal 估計的 LOCK（實驗顯示的是有雜訊的單一 seed） */
export const ACQ_SLOW = acquisitionAnalytic({ ...DEFAULT_ACQ, fllGainLsb: 1.6 })
export const ACQ_SLOW_NOISY_BLOCKS = Math.ceil((ACQ_SLOW.noisyLockMeanCycle + Math.max(ACQ_SLOW.nPlRel, ACQ_SLOW.nSettleRel) + 1) / DEFAULT_ACQ.blockN)
/** 「試試看」：f_tol 放寬到 3 MHz：交棒時的殘餘誤差讓 θ_ss 超過 rms_max，穩態判定永遠不過 */
export const ACQ_FTOL3 = acquisitionAnalytic({ ...DEFAULT_ACQ, fTolHz: 3e6 })
/** §14.6b.0：不用 FLL、直接在 Δf_0 = 80 MHz 閉 SSPD（K_f = 0、門檻放寬；noFllConfig）的無雜訊模擬 */
export const ACQ_NOFLL_TL = acquisitionTimeline({ ...noFllConfig(DEFAULT_ACQ), cycles: 4096 })
/** §14.6b.0 的反例：Δf_0 = f_ref + 0.5 MHz、不用 FLL——SSPD 只看得到混疊後的 0.5 MHz，鎖在 (M + 1) f_ref */
export const ACQ_WH_DF0 = DEFAULT_ACQ.fRefHz + 5e5
export const ACQ_WH = noFllCheck(DEFAULT_ACQ, ACQ_WH_DF0)
export const ACQ_WH_TL = acquisitionTimeline({ ...noFllConfig(DEFAULT_ACQ, ACQ_WH_DF0), cycles: 4096 })
/** 思考題 A：K_f = 10⁻³、Δf_0 = 50 MHz、f_tol = 0.5 MHz */
export const QUIZ_NC = fllCyclesToTol(5e7, 5e5, 1e-3)
/** 思考題 A 的三個錯誤選項，各對應一種常見錯誤（由同一組數字算出，不手寫）。 */
export const QUIZ_NC_WRONG = {
  /** 當成每週期減掉固定的 K_f Δf_0（線性下降）：(Δf_0 − f_tol)/(K_f Δf_0) */
  linear: Math.ceil((5e7 - 5e5) / (1e-3 * 5e7) - 1e-9),
  /** 分子按成 log10：⌈log10(100)/(−ln(1 − K_f))⌉ */
  log10: Math.ceil(Math.log10(5e7 / 5e5) / -Math.log(1 - 1e-3) - 1e-9),
  /** 忘了取對數：(Δf_0/f_tol)/K_f */
  noLog: Math.round(5e7 / 5e5 / 1e-3),
}

const MHz = (hz: number, d = 3) => nf(hz / 1e6, d)
const ps = (fs: number, d = 4) => nf(fs / 1000, d)

/**
 * §14.6b：acquisition（為什麼要 FLL、FLL、lock detect、SSPD 範圍、phase lock、穩態、DTC 工作點）與校正 enable 的條件——LOCK 不只是計數器。
 * Beginner 只看結論、一張圖（CHART_ACQ_PATH）與一題手算（HC-14.9）；其餘推導、HC-14.10／11 與狀態機圖收在 ModeGate min="engineer"。
 */
export function S7bAcquisition() {
  const a = ACQ_A
  const tl = ACQ_TL
  const nf0 = a.noFll
  const wh = ACQ_WH_TL.summary
  return (
    <Section kind="formula" level={2} title="14.6b Acquisition 與校正 enable：LOCK 不只是一個計數器" id="ch14-acquisition">
      <div className="c-tag-row">
        <ModelLevel level="L1" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
      </div>
      <p>
        §14.7 的狀態機從 LOCK 開始：上電後要「等 PLL 鎖定」才准 COARSE 更新。之前的版本把 LOCK 做成一個固定長度的計數器（<Tex>{'10'}</Tex> 個 block），這一節把它換成真正的條件：FLL 先把 VCO 頻率拉進 SSPD 分得清倍頻的捕獲範圍並宣告<strong>頻率鎖定</strong>（subsampling PLL 為什麼非做這一步不可，見 §14.6b.0），SSPD 的相位迴路再把相位拉進門檻（<strong>phase lock</strong>），迴路的暫態要消掉（<strong>穩態</strong>），而且 DTC 的工作點要在 code 範圍內（<strong>DTC 工作點</strong>）——四個條件同時成立才能 enable 校正。LOCK 的長度由這四個條件決定，每一個都有封閉式可以手算，也有 Monte Carlo 可以對照。
      </p>
      <p>
        時間單位是 reference 週期 <Tex>{'n'}</Tex>（每個 reference edge PD 取樣一次；校正的一個 block 是 <Tex>{'N'}</Tex> 個 reference 週期），頻率單位 Hz，相位誤差一律以時間（fs）表示。本節的 <Tex>{'\\theta'}</Tex> 是 SSPD 看到的相位誤差（reference edge 對 VCO 波形的時間誤差），和 §14.0 的極性相位 <Tex>{'\\theta'}</Tex>（度）不是同一個量。所有數字都是 illustrative：<Tex>{'f_\\text{ref}=4\\,\\mathrm{GHz}'}</Tex>、<Tex>{'M=4'}</Tex>（<Tex>{'f_\\text{vco}=16\\,\\mathrm{GHz}'}</Tex>、<Tex>{'T_\\text{vco}=62.5\\,\\mathrm{ps}'}</Tex>）、迴路頻寬 <Tex>{'320\\,\\mathrm{MHz}'}</Tex>。
      </p>
      <h3 id="ch14-acq-why">14.6b.0 為什麼 SSPLL 一定要先有 FLL：先分清倍頻，再談相位</h3>
      <p>
        subsampling PD（SSPD）不經過 divider：它直接用 reference edge 去取樣 VCO 的波形，取到的值就是相位誤差。問題出在「取樣」本身——VCO 若跑在 <Tex>{'f_\\text{vco}=(M+k)f_\\text{ref}'}</Tex>（<Tex>{'k'}</Tex> 是整數），每個 reference 週期 VCO 剛好多走 <Tex>{'k'}</Tex> 個完整週期，取樣點落在波形上的同一個位置，SSPD 的輸出和鎖在 <Tex>{'Mf_\\text{ref}'}</Tex> 時一模一樣。所以 SSPD 分不出 <Tex>{'Mf_\\text{ref}'}</Tex> 與 <Tex>{'(M\\pm1)f_\\text{ref}'}</Tex>，只會把 VCO 拉到離它最近的那一根——可能是錯的倍頻。這是 SSPLL 需要 FLL 的<strong>第一個理由（倍頻模糊）</strong>：FLL 的頻率偵測走 divider 路徑，數的是 divider 輸出的 edge，看得出 <Tex>{'M'}</Tex>；它要先把 <Tex>{'f_\\text{vco}'}</Tex> 拉到 <Tex>{'Mf_\\text{ref}\\pm f_\\text{ref}/2'}</Tex> 之內（<strong>捕獲範圍</strong>），SSPD 才鎖得到對的那一根。
      </p>
      <p>
        <strong>第二層是相位層級的條件</strong>：在對的那一根上，SSPD 的 <Tex>{'\\sin'}</Tex> 曲線只在 <Tex>{'\\pm T_\\text{vco}/4'}</Tex> 內單調，超過 <Tex>{'\\pm T_\\text{vco}/2'}</Tex> 就 cycle slip 到隔壁的 VCO 週期（§14.6b.3）；殘餘頻率誤差每個週期把相位推走 <Tex>{'\\Delta T'}</Tex>，相位迴路要拉得住（不 slip），而且留下的靜態偏移 <Tex>{'\\theta_\\text{ss}=\\Delta T/g_p'}</Tex> 要小於 phase lock 與穩態的門檻。兩層的尺度差很多，下面先看圖，再用模型的數字看在這個 illustrative 例子裡到底是哪一個條件卡住。
      </p>
      <Diagram chart={CHART_ACQ_PATH} caption="acquisition 路徑：FLL 的頻率偵測走 divider（數得出 $M$，分得清倍頻），先把頻率拉進捕獲範圍；SSPD 相位迴路再把相位拉近；三個偵測器（頻率鎖定與倍頻捕獲、phase lock 與穩態、DTC 工作點）的 AND 才是校正的 enable。">
        <p>
          <strong>先看</strong>上半部的主迴路：reference 先經過 DTC（延遲 <Tex>{'T_0-w\\,x[n]'}</Tex>）再進 SSPD，回授只有 divider——和全站的架構相同。SSPD 直接取樣 VCO 的波形，所以分不出 <Tex>{'Mf_\\text{ref}'}</Tex> 與 <Tex>{'(M\\pm1)f_\\text{ref}'}</Tex>。<strong>再看</strong>下半部左側的 FLL：頻率偵測把 divider 輸出和 reference 的頻率差 <Tex>{'\\hat{\\Delta f}'}</Tex> 量出來——它數的是 divider 的 edge，看得出 <Tex>{'M'}</Tex>，這正是 SSPD 做不到、要由 FLL 先做的事；累加器每個週期把 VCO 的控制字改 <Tex>{'-K_f\\hat{\\Delta f}'}</Tex>，它和相位迴路共用同一個 VCO。<strong>最後看</strong>下面三個六角形（判斷條件）：頻率鎖定（<Tex>{'|\\hat{\\Delta f}|<f_\\text{tol}'}</Tex> 連續 <Tex>{'N_\\text{ld}'}</Tex> 個週期，而且 <Tex>{'|\\hat{\\Delta f}|<f_\\text{ref}/2'}</Tex>：SSPD 鎖的是第 <Tex>{'M'}</Tex> 根）、phase lock 與穩態（<Tex>{'|\\theta|<\\theta_{\\max}'}</Tex> 連續 <Tex>{'N_\\text{pl}'}</Tex> 個週期、<Tex>{'W'}</Tex> 個週期的 rms 低於門檻）、DTC 工作點（code 沒有飽和），AND 之後才是 CAL enable。
        </p>
        <p>
          圖上的 <Tex>{'K_f'}</Tex> 就是 F-14.22 的 FLL 增益 <Tex>{'K_\\text{vco}g_f/(Mf_\\text{ref})'}</Tex>；<Tex>{'\\hat{\\Delta f}=\\Delta f+e_f'}</Tex> 的雜訊 <Tex>{'e_f'}</Tex> 是 F-14.23 誤判率的來源；SSPD 的倍頻捕獲 <Tex>{'|\\Delta f|<f_\\text{ref}/2'}</Tex> 與 <Tex>{'\\sin(2\\pi\\theta/T_\\text{vco})'}</Tex> 的單調範圍都在 F-14.24；DTC 的六角形就是 <ChRef ch="04" sec="§5b">Ch04</ChRef> 的 <FormulaLink id="F-04.20">F-04.20</FormulaLink>（code 夾住時 <Tex>{'\\partial e/\\partial w=0'}</Tex>）。
        </p>
      </Diagram>
      <Steps
        title="SSPD 為什麼分不出倍頻：取樣點每個週期移動多少"
        steps={[
          {
            tex: String.raw`f_\text{vco}=Mf_\text{ref}+\Delta f\ \Rightarrow\ \frac{f_\text{vco}}{f_\text{ref}}=M+\frac{\Delta f}{f_\text{ref}}`,
            why: <>每個 reference 週期 VCO 走過的週期數：<Tex>{'M'}</Tex> 個整數週期，再加上頻率誤差造成的零頭。</>,
          },
          {
            tex: String.raw`\Delta T=\frac{\Delta f}{f_\text{ref}}\,T_\text{vco}=\frac{\Delta f}{f_\text{ref}}\cdot\frac{1}{Mf_\text{ref}}=\frac{\Delta f}{Mf_\text{ref}^2}`,
            why: <>SSPD 只看取樣點落在 VCO 波形（週期 <Tex>{'T_\\text{vco}'}</Tex>）的哪個位置：整數個週期回到原位，零頭讓取樣點每個週期移動 <Tex>{'\\Delta T'}</Tex>——就是 §14.6b.3 的相位斜坡。</>,
          },
          {
            tex: String.raw`\Delta f\to\Delta f-k\,f_\text{ref}\ \Rightarrow\ \Delta T\to\Delta T-k\,T_\text{vco}\qquad(k\in\mathbb Z)`,
            why: <>頻率差一整根 <Tex>{'f_\\text{ref}'}</Tex>，取樣點每個週期就多走一整個 <Tex>{'T_\\text{vco}'}</Tex>，落在波形上的同一個位置：SSPD 看到的序列完全相同。</>,
          },
          {
            tex: String.raw`k=\Big\lfloor\frac{\Delta f}{f_\text{ref}}+\frac12\Big\rfloor,\qquad \Delta f_\text{alias}=\Delta f-k\,f_\text{ref}\in\Big[-\frac{f_\text{ref}}{2},\,\frac{f_\text{ref}}{2}\Big)`,
            why: <>SSPD 只看得到混疊後的 <Tex>{'\\Delta f_\\text{alias}'}</Tex>；相位迴路把它拉到 0，也就是把 VCO 拉到最近的 <Tex>{'(M+k)f_\\text{ref}'}</Tex>。</>,
          },
          {
            tex: String.raw`k=0\ \Leftrightarrow\ |\Delta f|<\frac{f_\text{ref}}{2}=${MHz(nf0.harmonic.captureHz, 4)}\,\mathrm{MHz}`,
            why: <>鎖在對的第 <Tex>{'M'}</Tex> 根的條件就是捕獲範圍。FLL 的頻率偵測數 divider 的 edge，不受這個混疊影響，所以由它先把 <Tex>{'|\\Delta f|'}</Tex> 拉進來。</>,
          },
        ]}
      />
      <TexBlock>{String.raw`\underbrace{|\Delta f|<\tfrac12f_\text{ref}}_{\text{倍頻捕獲}}\ \Rightarrow\ \underbrace{|\Delta T|<\tfrac{g_pT_\text{vco}}{2\pi}}_{\text{不 slip}}\ \Rightarrow\ \underbrace{|\theta_\text{ss}|<\theta_{\max}}_{\text{phase lock}}`}</TexBlock>
      <p>
        <ClaimTag kind="exact" /> 倍頻模糊在理想取樣的 SSPD 模型裡是精確的（<code>harmonicCapture</code>）：逐週期模擬裡 FLL 關掉時，<Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex> 與 <Tex>{'80\\,\\mathrm{MHz}+f_\\text{ref}'}</Tex> 的相位序列逐週期相同。上面三個條件由左到右是同一件事（殘餘頻率誤差）越來越嚴的要求；下表把它們套到「不用 FLL、直接在 <Tex>{'\\Delta f_0'}</Tex> 閉 SSPD」的情況（數字由 <code>noFllCheck</code> 算出）。
      </p>
      <div className="table-wrap">
        <table className="ch14-table">
          <caption className="c-sr-only">不用 FLL、直接在初始頻率誤差閉 SSPD 相位迴路時兩層條件的檢查（illustrative）</caption>
          <thead>
            <tr>
              <th scope="col">層級</th>
              <th scope="col">條件（殘餘頻率誤差的上限）</th>
              <th scope="col">不用 FLL：<Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex></th>
              <th scope="col">結果</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>第一層：倍頻</td>
              <td>
                <Tex>{`|\\Delta f|<f_\\text{ref}/2=${MHz(nf0.harmonic.captureHz, 4)}\\,\\mathrm{MHz}`}</Tex>
              </td>
              <td>
                <Tex>{`k=${nf0.harmonic.k}`}</Tex>：鎖在第 <Tex>{'M'}</Tex> 根
              </td>
              <td>{nf0.harmonic.ok ? '成立' : '不成立'}</td>
            </tr>
            <tr>
              <td>第二層：不 slip</td>
              <td>
                <Tex>{`|\\Delta f|<\\Delta f_\\text{limit}=${MHz(a.slip.dfLimitHz, 4)}\\,\\mathrm{MHz}`}</Tex>
              </td>
              <td>
                <Tex>{`\\Delta T=${nf(nf0.rampFsPerCycle, 4)}\\,\\mathrm{fs}`}</Tex>／週期，迴路拉得回來
              </td>
              <td>{nf0.slipOk ? '成立' : '不成立'}</td>
            </tr>
            <tr>
              <td>第二層：phase lock</td>
              <td>
                <Tex>{`|\\theta_\\text{ss}|<\\theta_{\\max}\\Leftrightarrow|\\Delta f|<${MHz(nf0.dfThetaMaxHz, 4)}\\,\\mathrm{MHz}`}</Tex>
              </td>
              <td>
                <Tex>{`\\theta_\\text{ss}=${ps(nf0.thetaSsPdFs)}\\,\\mathrm{ps}>\\theta_{\\max}=${ps(DEFAULT_ACQ.thetaMaxFs, 3)}\\,\\mathrm{ps}`}</Tex>
              </td>
              <td>
                <strong>{nf0.phaseLockOk ? '成立' : '不成立：真正卡住的'}</strong>
              </td>
            </tr>
            <tr>
              <td>第二層：穩態</td>
              <td>
                <Tex>{`|\\theta_\\text{ss}|<\\mathrm{rms}_{\\max}\\Leftrightarrow|\\Delta f|<${MHz(nf0.dfRmsMaxHz, 4)}\\,\\mathrm{MHz}`}</Tex>
              </td>
              <td>
                <Tex>{`${ps(nf0.thetaSsPdFs)}\\,\\mathrm{ps}>${nf(DEFAULT_ACQ.rmsMaxFs, 3)}\\,\\mathrm{fs}`}</Tex>
              </td>
              <td>{nf0.settleOk ? '成立' : '不成立'}</td>
            </tr>
            <tr>
              <td>有 FLL（交棒）</td>
              <td>同上四項</td>
              <td>
                <Tex>{`\\Delta f_h=${MHz(a.dfHandoffHz, 4)}\\,\\mathrm{MHz}`}</Tex>：<Tex>{`\\theta_\\text{ss}=${nf(a.thetaSsFs, 3)}\\,\\mathrm{fs}`}</Tex>
              </td>
              <td>{a.harmonic.ok && Number.isFinite(a.nEnable) ? '全部成立' : '不成立'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <ClaimTag kind="exact" /> 在本節的模型（理想取樣的 SSPD、一階相位迴路、無雜訊）裡：預設的 <Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex> 遠在捕獲範圍 <Tex>{`\\pm${MHz(nf0.harmonic.captureHz, 4)}\\,\\mathrm{MHz}`}</Tex> 內，也在 slip 上限 <Tex>{`${MHz(a.slip.dfLimitHz, 4)}\\,\\mathrm{MHz}`}</Tex> 內——沒有 FLL 也鎖得到對的那一根、也不會 slip。擋住 enable 的是第二層裡更細的條件：<Tex>{`\\Delta T=${nf(nf0.rampFsPerCycle, 4)}\\,\\mathrm{fs}`}</Tex>／週期的斜坡在一階迴路留下 <Tex>{`\\theta_\\text{ss}=\\Delta T/g_p=${ps(nf0.thetaSsFs)}\\,\\mathrm{ps}`}</Tex>（sine PD 的平衡點 <Tex>{`${ps(nf0.thetaSsPdFs)}\\,\\mathrm{ps}`}</Tex>），大於 <Tex>{'\\theta_{\\max}'}</Tex>，phase lock 永遠判不過；穩態門檻 <Tex>{'\\mathrm{rms}_{\\max}'}</Tex> 更嚴，也過不了。FLL 關掉的逐週期模擬一致：第 <Tex>{`${ACQ_NOFLL_TL.summary.freqLockCycle}`}</Tex> 個週期交棒、<Tex>{`${ACQ_NOFLL_TL.summary.slips}`}</Tex> 次 slip、相位停在 <Tex>{`${ps(ACQ_NOFLL_TL.theta[ACQ_NOFLL_TL.theta.length - 1])}\\,\\mathrm{ps}`}</Tex>、永遠不 enable。FLL 把殘餘誤差壓到 <Tex>{`${MHz(a.dfHandoffHz, 4)}\\,\\mathrm{MHz}`}</Tex>，<Tex>{'\\theta_\\text{ss}'}</Tex> 只剩 <Tex>{`${nf(a.thetaSsFs, 3)}\\,\\mathrm{fs}`}</Tex>——<Tex>{`f_\\text{tol}=${MHz(DEFAULT_ACQ.fTolHz, 3)}\\,\\mathrm{MHz}`}</Tex> 是替最嚴的穩態門檻（<Tex>{`${MHz(nf0.dfRmsMaxHz, 4)}\\,\\mathrm{MHz}`}</Tex>）留的餘裕。這個「卡在靜態偏移」是一階（只有比例路徑）相位迴路的結論：Type-II 迴路的積分器會把 <Tex>{'\\theta_\\text{ss}'}</Tex> 積到 0（F-14.24 的假設保留它，是最壞情況），所以實際的 type-II SSPLL 在 <Tex>{'80\\,\\mathrm{MHz}'}</Tex> 這個例子裡不靠 FLL 也可能鎖得到（積分路徑與 sine PD 的 pull-in 沒有建模）<ClaimTag kind="research" />——不論迴路是幾型，第一層的倍頻模糊都不會消失，FLL 不可少的理由是它。
      </p>
      <p>
        倍頻模糊要等 <Tex>{'|\\Delta f|'}</Tex> 超過 <Tex>{'f_\\text{ref}/2'}</Tex> 才出現，所以 80 MHz 的例子看不到它；這裡的 <Tex>{'\\Delta f_0'}</Tex> 代表 coarse tuning 之後的殘餘。上電時 VCO 的頻率由 coarse band 與 PVT 決定，離 <Tex>{'Mf_\\text{ref}'}</Tex> 多遠沒有保證，只有 FLL 知道該往哪一根拉。模型裡的反例：<Tex>{'\\Delta f_0=f_\\text{ref}+0.5\\,\\mathrm{MHz}'}</Tex> 而不用 FLL，SSPD 只看得到混疊後的 <Tex>{`${MHz(ACQ_WH.harmonic.aliasHz, 3)}\\,\\mathrm{MHz}`}</Tex>（<Tex>{`k=${ACQ_WH.harmonic.k}`}</Tex>、靜態偏移 <Tex>{`${nf(ACQ_WH.thetaSsPdFs, 3)}\\,\\mathrm{fs}`}</Tex>），第 <Tex>{`${wh.phaseLockCycle}`}</Tex> 個週期 phase lock、第 <Tex>{`${wh.settleCycle}`}</Tex> 個週期 rms 視窗也通過、<Tex>{`${wh.slips}`}</Tex> 次 slip——但 VCO 鎖在 <Tex>{`(M+${ACQ_WH.harmonic.k})f_\\text{ref}=${nf(((DEFAULT_ACQ.divRatio + ACQ_WH.harmonic.k) * DEFAULT_ACQ.fRefHz) / 1e9, 3)}\\,\\mathrm{GHz}`}</Tex>，不是 <Tex>{`${nf((DEFAULT_ACQ.divRatio * DEFAULT_ACQ.fRefHz) / 1e9, 3)}\\,\\mathrm{GHz}`}</Tex>。所以本站的 enable 條件把倍頻捕獲（頻率偵測的讀值 <Tex>{'|\\hat{\\Delta f}|<f_\\text{ref}/2'}</Tex>）也算進去，這個例子永遠不 enable（{wh.enableCycle < 0 ? <>逐週期模擬 <Tex>{`${ACQ_WH_TL.df.length}`}</Tex> 個週期都沒有進 CAL</> : <>模擬在第 <Tex>{`${wh.enableCycle}`}</Tex> 個週期進 CAL</>}）。<ClaimTag kind="exact" />
      </p>

      <h3 id="ch14-acq-fll">14.6b.1 FLL：頻率誤差怎麼收斂、要幾個週期</h3>
      <p>
        FLL 是一個最簡單的離散時間一階迴路：每個 reference 週期量一次頻率誤差，按比例修正 VCO 的控制字。把 VCO 增益與除頻比都寫進去，收斂速度只由一個無因次的 <Tex>{'K_f'}</Tex> 決定。
      </p>
      <ModeGate min="engineer" summary={String.raw`推導 F-14.22：從 $K_\text{vco}$、$g_f$、$M$ 到 FLL 的一階模型與 $n_c$（6 步）`}>
        <Steps
          title="從硬體參數到 FLL 的一階模型"
          steps={[
            {
              tex: String.raw`u[n+1]=u[n]-g_f\,\frac{\hat{\Delta f}[n]}{Mf_\text{ref}},\qquad \hat{\Delta f}[n]=\Delta f[n]+e_f[n]`,
              why: (
                <>
                  FLL 的累加器：頻率偵測量到 divider 輸出相對 reference 的誤差比例 <Tex>{'\\hat{\\Delta f}/(Mf_\\text{ref})'}</Tex>（<Tex>{'\\Delta f'}</Tex> 是 VCO 端的頻率誤差，除以 <Tex>{'M'}</Tex> 才是 divider 輸出的），每個週期把控制字 <Tex>{'u'}</Tex> 改 <Tex>{'g_f'}</Tex> 倍的這個比例；<Tex>{'e_f'}</Tex> 是估計的雜訊（零均值、iid、RMS <Tex>{'\\sigma_f'}</Tex>）。
                </>
              ),
            },
            {
              tex: String.raw`f_\text{vco}=f_0+K_\text{vco}\,u\ \Rightarrow\ \Delta f[n+1]=\Delta f[n]-\frac{K_\text{vco}\,g_f}{Mf_\text{ref}}\,\hat{\Delta f}[n]`,
              why: (
                <>
                  VCO 的控制字每改一個 LSB，頻率改 <Tex>{'K_\\text{vco}'}</Tex>（Hz/LSB）；把上一步代進去，兩邊減掉標稱頻率 <Tex>{'Mf_\\text{ref}'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\Delta f[n+1]=(1-K_f)\,\Delta f[n]-K_f\,e_f[n],\qquad K_f\equiv\frac{K_\text{vco}\,g_f}{Mf_\text{ref}}`,
              why: (
                <>
                  把係數取名 <Tex>{'K_f'}</Tex>：每個週期修掉的誤差比例（無因次）。這和 §14.0 的校正迴路 <Tex>{'\\delta_{k+1}=(1-g)\\delta_k-\\mu\\eta_k'}</Tex> 是同一種一階遞迴，只是時間單位從 block 換成 reference 週期。
                </>
              ),
            },
            {
              tex: String.raw`E[\Delta f[n]]=(1-K_f)^n\,\Delta f_0\qquad(\text{無雜訊時就是 }\Delta f[n]\text{ 本身})`,
              why: <>取期望值：<Tex>{'E[e_f]=0'}</Tex>，遞迴變成等比數列。有雜訊時平均軌跡不變，這是 Monte Carlo 可以直接對照的量。</>,
            },
            {
              tex: String.raw`(1-K_f)^n|\Delta f_0|<f_\text{tol}\ \Leftrightarrow\ n>\frac{\ln(f_\text{tol}/|\Delta f_0|)}{\ln(1-K_f)}\ \Rightarrow\ n_c=\Big\lceil\frac{\ln(f_\text{tol}/|\Delta f_0|)}{\ln(1-K_f)}\Big\rceil`,
              why: <>兩邊取自然對數；<Tex>{'\\ln(1-K_f)<0'}</Tex>，除過去時不等號反向。<Tex>{'n_c'}</Tex> 是第一個落在門檻內的週期（無雜訊）。</>,
            },
            {
              tex: String.raw`n_\text{FL}=n_c+N_\text{ld}-1,\qquad \Delta f_h=(1-K_f)^{n_\text{FL}+1}\Delta f_0`,
              why: (
                <>
                  lock detector 要連續 <Tex>{'N_\\text{ld}'}</Tex> 個樣本都在門檻內：從 <Tex>{'n_c'}</Tex> 數起第 <Tex>{'N_\\text{ld}'}</Tex> 個在 <Tex>{'n_c+N_\\text{ld}-1'}</Tex>。宣告鎖定的那個週期 FLL 還更新了一次，所以交棒給相位迴路的殘餘誤差是 <Tex>{'n_\\text{FL}+1'}</Tex> 次方。
                </>
              ),
            },
          ]}
        />
      </ModeGate>
      <TexBlock id="F-14.22" label="FLL 的一階模型與收斂週期數">
        {String.raw`\begin{aligned}\Delta f[n+1]&=(1-K_f)\,\Delta f[n]-K_f\,e_f[n],\qquad K_f=\frac{K_\text{vco}\,g_f}{M f_\text{ref}}\\ n_c&=\Big\lceil\frac{\ln(f_\text{tol}/|\Delta f_0|)}{\ln(1-K_f)}\Big\rceil,\qquad n_\text{FL}=n_c+N_\text{ld}-1\end{aligned}`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 平均軌跡與 <Tex>{'n_c'}</Tex> 在一階線性模型內是精確的（<Tex>{'K_f<1'}</Tex>）。預設情境：<Tex>{'K_\\text{vco}=2.5\\,\\mathrm{MHz/LSB}'}</Tex>、<Tex>{'g_f=3.2'}</Tex>、<Tex>{'M=4'}</Tex>、<Tex>{'f_\\text{ref}=4\\,\\mathrm{GHz}'}</Tex> 給 <Tex>{`K_f=${tx(a.kF, 4)}`}</Tex>；<Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex>、<Tex>{'f_\\text{tol}=1\\,\\mathrm{MHz}'}</Tex>、<Tex>{'N_\\text{ld}=32'}</Tex> 給 <Tex>{`n_c=${a.nC}`}</Tex>、<Tex>{`n_\\text{FL}=${a.nFL}`}</Tex>（<Tex>{`${nf(a.nFL / DEFAULT_ACQ.blockN, 3)}`}</Tex> 個 <Tex>{'N=1024'}</Tex> 的 block），交棒時的殘餘誤差 <Tex>{`\\Delta f_h=${MHz(a.dfHandoffHz)}\\,\\mathrm{MHz}`}</Tex>。<Tex>{'K_f'}</Tex> 很小時 <Tex>{'\\ln(1-K_f)\\approx-K_f'}</Tex>，所以 <Tex>{'n_c\\approx\\ln(|\\Delta f_0|/f_\\text{tol})/K_f'}</Tex>：要縮 <Tex>{`${nf(Math.log(DEFAULT_ACQ.df0Hz / DEFAULT_ACQ.fTolHz), 3)}`}</Tex> 個 e 倍、每個 e 倍 <Tex>{`1/K_f=${nf(1 / a.kF, 4)}`}</Tex> 個週期。
      </p>
      <Hand id="HC-14.9">把你的 VCO 增益、FLL 增益、除頻比與門檻代進去，算 FLL 要跑幾個 reference 週期；再和實驗裡量到的頻率鎖定週期比。</Hand>

      <h3 id="ch14-acq-lockdet">14.6b.2 lock detect 的誤判率：Gaussian 估計下的誤報與漏報</h3>
      <p>
        頻率偵測量到的是含雜訊的 <Tex>{'\\hat{\\Delta f}=\\Delta f+e_f'}</Tex>，單一樣本落在 <Tex>{'\\pm f_\\text{tol}'}</Tex> 內不代表鎖定，所以 lock detector 要求連續 <Tex>{'N_\\text{ld}'}</Tex> 個樣本都在窗內：誤報（還沒鎖好卻宣告）的機率變成單一樣本機率的 <Tex>{'N_\\text{ld}'}</Tex> 次方，幾乎為零；代價是漏報造成的延遲——預設 <Tex>{'\\sigma_f=0.1\\,\\mathrm{MHz}'}</Tex> 時平均只比無雜訊晚 <Tex>{`${nf(a.noisyLockMeanCycle - a.nFL, 3)}`}</Tex> 個週期，雜訊放大到 <Tex>{'0.4\\,\\mathrm{MHz}'}</Tex> 時晚 <Tex>{`${nf(ACQ_HC.noisyLockMeanCycle - a.nFL, 4)}`}</Tex> 個週期，lock 時間改由雜訊決定。
      </p>
      <ModeGate min="engineer" summary={String.raw`推導 F-14.23：誤報、漏報與期望延遲，有雜訊時的 renewal 估計，與手算 HC-14.10`}>
        <p>
          下面把兩種錯誤算出來：真的還沒鎖好卻宣告（誤報）、已經鎖好卻這一個視窗沒宣告（漏報），以及漏報造成的平均延遲。
        </p>
        <Steps
          title="從 Gaussian 估計到誤報、漏報與期望延遲"
          steps={[
            {
              tex: String.raw`p_\text{in}(\Delta f)=P\big(|\Delta f+e_f|<f_\text{tol}\big)=\Phi\!\Big(\frac{f_\text{tol}-\Delta f}{\sigma_f}\Big)-\Phi\!\Big(\frac{-f_\text{tol}-\Delta f}{\sigma_f}\Big)`,
              why: (
                <>
                  <Tex>{'e_f\\sim\\mathcal N(0,\\sigma_f^2)'}</Tex>：<Tex>{'\\hat{\\Delta f}'}</Tex> 落在區間 <Tex>{'(-f_\\text{tol},f_\\text{tol})'}</Tex> 的機率是兩個 <Tex>{'\\Phi'}</Tex> 的差（先備知識：<Tex>{'\\Phi'}</Tex> 是標準常態的累積分布）。
                </>
              ),
            },
            {
              tex: String.raw`P(\text{連續 }N_\text{ld}\text{ 個都在窗內})=p_\text{in}^{N_\text{ld}}`,
              why: <>樣本獨立（白雜訊）：機率相乘。這是「連續」的威力——單一樣本的 <Tex>{'p'}</Tex> 變成 <Tex>{'p^N'}</Tex>。</>,
            },
            {
              tex: String.raw`P_\text{FA}=p_\text{in}(\Delta f_x)^{N_\text{ld}}\ (\Delta f_x>f_\text{tol}),\qquad P_\text{miss}=1-p_\text{in}(0)^{N_\text{ld}}`,
              why: (
                <>
                  誤報：真實誤差 <Tex>{'\\Delta f_x'}</Tex> 在門檻外、卻 <Tex>{'N_\\text{ld}'}</Tex> 個樣本全部誤落在窗內。漏報：真實誤差 0，但某一個 <Tex>{'N_\\text{ld}'}</Tex> 的視窗裡至少一個樣本跑出門檻（補事件）。
                </>
              ),
            },
            {
              tex: String.raw`E[T_N]=\frac{E[T_{N-1}]+1}{p}\ \Rightarrow\ E[T_N]=\sum_{k=1}^{N}p^{-k}=\frac{1-p^N}{(1-p)\,p^N}`,
              why: (
                <>
                  漏報不是失敗、只是延遲：第一次出現 <Tex>{'N'}</Tex> 個連續成功的期望樣本數。遞迴：要先湊到 <Tex>{'N-1'}</Tex> 個，再抽一個；成功（機率 <Tex>{'p'}</Tex>）就結束，失敗就從頭來——解出來是等比級數。<Tex>{'p=1'}</Tex> 時正好等於 <Tex>{'N'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-14.23" label="lock detect 的誤判率與期望延遲">
          {String.raw`\begin{aligned}p_\text{in}(\Delta f)&=\Phi\!\Big(\frac{f_\text{tol}-\Delta f}{\sigma_f}\Big)-\Phi\!\Big(\frac{-f_\text{tol}-\Delta f}{\sigma_f}\Big)\\ P_\text{FA}&=p_\text{in}(\Delta f_x)^{N_\text{ld}},\qquad P_\text{miss}=1-p_\text{in}(0)^{N_\text{ld}},\qquad E[T_N]=\frac{1-p^{N}}{(1-p)\,p^{N}}\Big|_{p=p_\text{in}(0)}\end{aligned}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 在「估計樣本 iid Gaussian」的模型內精確。兩組數字：預設情境 <Tex>{'\\sigma_f=0.1\\,\\mathrm{MHz}'}</Tex>（<Tex>{'z=f_\\text{tol}/\\sigma_f=10'}</Tex>）的 <Tex>{`P_\\text{miss}=${tx(a.pMiss, 2)}`}</Tex>，幾乎不會漏；把雜訊放大到 <Tex>{'\\sigma_f=0.4\\,\\mathrm{MHz}'}</Tex>（<Tex>{'z=2.5'}</Tex>）則 <Tex>{`p_\\text{in}(0)=${nf(ACQ_HC.pIn0, 5)}`}</Tex>、<Tex>{`P_\\text{miss}=${nf(ACQ_HC.pMiss, 3)}`}</Tex>、<Tex>{`E[T_{32}]=${nf(ACQ_HC.expectedDetectCycles, 4)}`}</Tex> 個週期——三分之一的視窗會漏，但平均只晚 <Tex>{`${nf(ACQ_HC.expectedDetectCycles - DEFAULT_ACQ.nLd, 3)}`}</Tex> 個週期。誤報則被 <Tex>{'N_\\text{ld}'}</Tex> 次方壓到可以忽略：真實誤差剛好在窗外一個 <Tex>{'\\sigma_f'}</Tex> 時 <Tex>{`P_\\text{FA}=${tx(a.pFalseAlarm, 2)}`}</Tex>。
        </p>
        <Callout kind="warn" title={md(String.raw`有雜訊時 $n_c$ 不是 lock 的時間：門檻要留 $\sigma_f$ 的餘裕`)}>
          <p>
            F-14.22 的 <Tex>{'n_c'}</Tex> 假設 <Tex>{'|\\Delta f|'}</Tex> 一進門檻就被看到。有雜訊時 <Tex>{'N_\\text{ld}'}</Tex> 個樣本要全部在窗內：單一個視窗要真實誤差降到約 <Tex>{'f_\\text{tol}-2\\sigma_f'}</Tex>（<Tex>{'p_\\text{in}^{N}\\approx\\tfrac12'}</Tex> 的位置）才有一半機會通過。但每個週期都是一次新的嘗試，所以平均宣告會比這個點早。FLL 的 <Tex>{'\\Delta f'}</Tex> 變化比 <Tex>{'N_\\text{ld}'}</Tex> 個週期慢得多，可以把「這個週期剛好完成一段連續 <Tex>{'N_\\text{ld}'}</Tex> 個」的機率近似成 F-14.23 期望延遲的倒數（renewal 近似），再累加成「到第 <Tex>{'n'}</Tex> 個週期還沒宣告」的存活機率：
          </p>
          <TexBlock>{String.raw`\begin{aligned}\lambda_n&\approx\frac{1}{E[T_N](p_n)}=\frac{(1-p_n)\,p_n^{N_\text{ld}}}{1-p_n^{N_\text{ld}}}\\ p_n&=p_\text{in}\big((1-K_f)^n\,\Delta f_0\big)\\ E[n_\text{FL}]&\approx\sum_{n\ge0}\exp\Big(-\sum_{m=0}^{n}\lambda_m\Big)\end{aligned}`}</TexBlock>
          <p>
            <ClaimTag kind="approx" /> 和逐週期模擬的 Monte Carlo 差 1% 左右（<Tex>{'24'}</Tex> 個 seed，以 <Tex>{'4\\,\\mathrm{se}+1\\%'}</Tex> 判定；忽略 FLL 自己被 <Tex>{'e_f'}</Tex> 推動的量與 run 從頭數的記憶）。預設 <Tex>{`z=${nf(DEFAULT_ACQ.fTolHz / DEFAULT_ACQ.sigmaFHz, 3)}`}</Tex>：<Tex>{`E[n_\\text{FL}]\\approx${nf(a.noisyLockMeanCycle, 4)}`}</Tex>，比無雜訊的 <Tex>{`n_\\text{FL}=${a.nFL}`}</Tex> 晚 <Tex>{`${nf(a.noisyLockMeanCycle - a.nFL, 3)}`}</Tex> 個週期；<Tex>{'\\sigma_f=0.4\\,\\mathrm{MHz}'}</Tex>（<Tex>{'z=2.5'}</Tex>）：<Tex>{`E[n_\\text{FL}]\\approx${nf(ACQ_HC.noisyLockMeanCycle, 5)}`}</Tex>，晚 <Tex>{`${nf(ACQ_HC.noisyLockMeanCycle - a.nFL, 4)}`}</Tex> 個週期——lock 時間改由雜訊決定，實驗裡載入「頻率估計雜訊 4 倍」就看得到 LOCK 從 10 個 block 變成 11 個。只用單一視窗的點估計（等 <Tex>{'\\Delta f'}</Tex> 降到 <Tex>{'f_\\text{tol}-2\\sigma_f'}</Tex>）會給 <Tex>{`\\ln\\big(f_\\text{tol}/(f_\\text{tol}-2\\sigma_f)\\big)/K_f\\approx${nf(Math.log(DEFAULT_ACQ.fTolHz / (DEFAULT_ACQ.fTolHz - 2 * 4e5)) / a.kF, 4)}`}</Tex> 個週期，高估一倍以上。
          </p>
        </Callout>
        <Hand id="HC-14.10">先用表上查得到的 <Tex>{'\\Phi(2.5)'}</Tex> 算一次漏報與期望延遲，再算門檻外兩倍處的誤報，體會「連續 <Tex>{'N'}</Tex> 個」把機率變成 <Tex>{'N'}</Tex> 次方的效果。</Hand>
        <ModeGate min="research" summary="估計樣本彼此相關時的修正">
          <p>
            <ClaimTag kind="research" /> 實際的頻率偵測常是 counter 在 <Tex>{'L'}</Tex> 個週期內累加再輸出，相鄰樣本不獨立。獨立樣本的假設讓 <Tex>{'p^N'}</Tex> 太樂觀：有效樣本數大約是 <Tex>{'N_\\text{ld}/L'}</Tex>（整段重疊時），誤報要用它算；漏報的 <Tex>{'E[T_N]'}</Tex> 則變成 <Tex>{'L'}</Tex> 倍的延遲。<Tex>{'e_f'}</Tex> 若不是 Gaussian（例如量化成整數的 counter 差），<Tex>{'\\Phi'}</Tex> 要換成該分布的累積函數，結構不變。
          </p>
        </ModeGate>
      </ModeGate>

      <h3 id="ch14-acq-sspd">14.6b.3 第二層（相位）：SSPD 的單調範圍、cycle slip 與靜態偏移</h3>
      <p>
        回到第二層：假設倍頻已經對了（<Tex>{'|\\Delta f|<f_\\text{ref}/2'}</Tex>，§14.6b.0）。SSPD 把 VCO 的正弦波形用 reference edge 取樣，輸出 <Tex>{'\\propto\\sin(2\\pi\\theta/T_\\text{vco})'}</Tex>，<Tex>{'\\theta'}</Tex> 是 reference edge 對 VCO 過零點的時間誤差。這條曲線只在 <Tex>{'\\pm T_\\text{vco}/4'}</Tex> 內單調，<Tex>{'\\pm T_\\text{vco}/2'}</Tex> 是吸引區的邊界——越過去就被拉向隔壁那個 VCO 週期的過零點（cycle slip）。殘餘頻率誤差每個週期把相位推走 <Tex>{'\\Delta T=\\Delta f/(Mf_\\text{ref}^2)'}</Tex>：斜坡超過迴路每個週期拉得回來的量，就一路 slip；沒超過也會留下靜態偏移 <Tex>{'\\theta_\\text{ss}=\\Delta T/g_p'}</Tex>，它還得小於 phase lock 與穩態的門檻。把殘餘頻率誤差的四個上限依序（倍頻捕獲、不 slip、phase lock、穩態）排在一起：<Tex>{`${MHz(nf0.harmonic.captureHz, 4)}\\gg${MHz(a.slip.dfLimitHz, 4)}\\gg${MHz(nf0.dfThetaMaxHz, 4)}\\gg${MHz(nf0.dfRmsMaxHz, 4)}\\ \\mathrm{MHz}`}</Tex>——後三個是相位層級的條件、一個比一個嚴，FLL 的 <Tex>{'f_\\text{tol}'}</Tex> 要對最嚴的那一個留餘裕。<ClaimTag kind="exact" />
      </p>
      <ModeGate min="engineer" summary={String.raw`推導 F-14.24：單調範圍、吸引區、相位斜坡 $\Delta T$ 與 slip 條件，以及預設情境的數字表`}>
        <Steps
          title="單調範圍、吸引區與殘餘頻率誤差的相位斜坡"
          steps={[
            {
              tex: String.raw`S(\theta)=\frac{T_\text{vco}}{2\pi}\sin\!\Big(\frac{2\pi\theta}{T_\text{vco}}\Big)\approx\theta\ (|\theta|\ll T_\text{vco})`,
              why: <>把 PD 輸出正規化成「等效時間誤差」：<Tex>{'\\theta=0'}</Tex> 附近斜率 1，所以小訊號時就是線性 PD。</>,
            },
            {
              tex: String.raw`\frac{dS}{d\theta}=\cos\!\Big(\frac{2\pi\theta}{T_\text{vco}}\Big)>0\ \Leftrightarrow\ |\theta|<\frac{T_\text{vco}}{4}`,
              why: <>單調（斜率為正）的範圍：超過四分之一週期，斜率歸零再反號，迴路增益先消失再變負。</>,
            },
            {
              tex: String.raw`\operatorname{sign}S(\theta)=\operatorname{sign}\theta\ \Leftrightarrow\ |\theta|<\frac{T_\text{vco}}{2};\qquad \theta\to\theta\mp T_\text{vco}\ \text{當 }|\theta|\text{ 超過 }\tfrac12T_\text{vco}`,
              why: (
                <>
                  恢復力方向正確的範圍（吸引區）是半個週期：<Tex>{'\\pm T_\\text{vco}/2'}</Tex> 是不穩定平衡點，越過去就被拉向隔壁的過零點——這就是 cycle slip，相位折回 <Tex>{'(-T_\\text{vco}/2,\\,T_\\text{vco}/2]'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\Delta T=T_\text{ref}-\frac{M}{Mf_\text{ref}+\Delta f_h}\approx\frac{\Delta f_h}{Mf_\text{ref}^2}`,
              why: (
                <>
                  殘餘頻率誤差讓 divider 輸出的週期和 <Tex>{'T_\\text{ref}'}</Tex> 差一點點：每個 reference 週期相位誤差被推走 <Tex>{'\\Delta T'}</Tex>（一階展開，<Tex>{'\\Delta f_h\\ll Mf_\\text{ref}'}</Tex>）。
                </>
              ),
            },
            {
              tex: String.raw`\theta[n+1]=\theta[n]-g_pS(\theta[n]+v[n])+\Delta T\ \Rightarrow\ \theta_\text{ss}=\frac{\Delta T}{g_p}\ (\text{線性})`,
              why: (
                <>
                  一階相位迴路每個週期拉回 <Tex>{'g_p'}</Tex> 倍（<Tex>{'g_p'}</Tex> 在下一小節由頻寬算出；<Tex>{'v'}</Tex> 是 PD 端雜訊），斜坡推走 <Tex>{'\\Delta T'}</Tex>：平衡在靜態偏移 <Tex>{'\\Delta T/g_p'}</Tex>。Type-II 迴路的積分器會把它積到 0，這裡保留最壞情況。
                </>
              ),
            },
            {
              tex: String.raw`\text{slip 條件：}\ \Delta T\ge g_p\max_\theta S(\theta)=g_p\frac{T_\text{vco}}{2\pi}\ (\text{sine}),\qquad |\theta_\text{ss}|\ge\tfrac12T_\text{vco}\ (\text{linear})`,
              why: <>迴路每週期最多只能拉回 <Tex>{'g_p'}</Tex> 倍的 PD 最大輸出；斜坡比它大，相位每個週期都往外走，一定 slip。換算成頻率就是 <Tex>{'\\Delta f_\\text{limit}'}</Tex>：殘餘頻率誤差超過它，相位迴路根本鎖不住；比它小還要再看靜態偏移 <Tex>{'\\theta_\\text{ss}'}</Tex> 進不進得了門檻（§14.6b.0 的表：預設的 80 MHz 卡在這裡，不是 slip）。</>,
            },
          ]}
        />
        <TexBlock id="F-14.24" label="SSPD 的倍頻捕獲、單調範圍、cycle slip 條件與相位斜坡">
          {String.raw`\begin{aligned}&|\Delta f|<\tfrac12f_\text{ref}\ \text{倍頻捕獲}\ \big(f_\text{vco}\to(M+k)f_\text{ref},\ k=\lfloor\Delta f/f_\text{ref}+\tfrac12\rfloor\big)\\ &|\theta|<\tfrac14T_\text{vco}\ \text{單調},\qquad |\theta|<\tfrac12T_\text{vco}\ \text{不 slip}\\ &\Delta T=\frac{\Delta f_h}{M f_\text{ref}^2},\qquad \theta_\text{ss}=\frac{\Delta T}{g_p}\\ &\text{slip 條件：}\ \Delta T\ge g_p\frac{T_\text{vco}}{2\pi}\ (\text{sine})\quad\text{或}\quad |\theta_\text{ss}|\ge\tfrac12T_\text{vco}\ (\text{linear})\\ &P_\text{slip}\approx\Phi\!\Big(\!-\frac{T_\text{vco}/2-|\theta_\text{ss}|}{\sigma_\text{ss}}\Big)+\Phi\!\Big(\!-\frac{T_\text{vco}/2+|\theta_\text{ss}|}{\sigma_\text{ss}}\Big)\end{aligned}`}
        </TexBlock>
        <div className="table-wrap">
          <table className="ch14-table">
            <caption className="c-sr-only">預設情境的 SSPD 範圍與 slip 條件</caption>
            <thead>
              <tr>
                <th scope="col">量</th>
                <th scope="col">值（illustrative）</th>
                <th scope="col">意思</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'T_\\text{vco}/4'}</Tex>
                </td>
                <td className="num">{nf(a.slip.monotonicFs / 1000, 4)} ps</td>
                <td>單調範圍：超過它迴路增益先歸零再反號</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'T_\\text{vco}/2'}</Tex>
                </td>
                <td className="num">{nf(a.slip.basinFs / 1000, 4)} ps</td>
                <td>吸引區：超過它就 cycle slip（phase-lock 的門檻 <Tex>{'\\theta_{\\max}'}</Tex> 必須遠小於它）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'g_pT_\\text{vco}/(2\\pi)'}</Tex>
                </td>
                <td className="num">{nf(a.slip.rampLimitFsPerCycle, 4)} fs／週期</td>
                <td>相位迴路每個週期最多拉得回來的量</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\Delta f_\\text{limit}'}</Tex>
                </td>
                <td className="num">{MHz(a.slip.dfLimitHz, 4)} MHz</td>
                <td>不 slip 的上限：殘餘頻率誤差超過它就一路 slip（必要條件；phase lock 與穩態的上限更嚴，見 §14.6b.0 的表）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\Delta T,\\ \\theta_\\text{ss}'}</Tex>
                </td>
                <td className="num">
                  {nf(a.rampFsPerCycle, 4)} fs／週期、{nf(a.thetaSsFs, 4)} fs
                </td>
                <td>預設的 <Tex>{`\\Delta f_h=${MHz(a.dfHandoffHz)}\\,\\mathrm{MHz}`}</Tex> 造成的斜坡與靜態偏移（遠小於 <Tex>{'\\theta_{\\max}=2\\,\\mathrm{ps}'}</Tex>，也小於 <Tex>{'\\mathrm{rms}_{\\max}=100\\,\\mathrm{fs}'}</Tex>）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <ClaimTag kind="approx" /> <Tex>{'P_\\text{slip}'}</Tex> 是穩態下每個週期超出 <Tex>{'\\pm T_\\text{vco}/2'}</Tex> 的 Gaussian 雙尾近似（<Tex>{'\\sigma_\\text{ss}=\\sigma_\\theta\\sqrt{g_p/(2-g_p)}'}</Tex>，下一小節），預設情境 <Tex>{`\\sigma_\\text{ss}=${nf(a.sigmaSsFs, 3)}\\,\\mathrm{fs}`}</Tex> 遠小於 31 ps，所以是 0；sine PD 在大 <Tex>{'|\\theta|'}</Tex> 時增益變小、暫態比線性慢（F-14.25 用弦斜率給上界），模擬值會落在線性值與上界之間。
        </p>
      </ModeGate>
      <Callout kind="info" title="連結到 PLL：使用者晶片的 8 相 PMUX">
        <p>
          回授端的 8 相 PMUX 讓 reference 端的 DTC 只需補 <Tex>{'T_\\text{vco}/8'}</Tex> 以內的量（<ChRef ch="07b">案例頁</ChRef>）；PMUX 切相位不會改變 SSPD 的 <Tex>{'\\pm T_\\text{vco}/2'}</Tex> 吸引區，但 PMUX 選錯相位的 glitch 相當於一次 <Tex>{'T_\\text{vco}/8'}</Tex> 的相位跳變——它在門檻 <Tex>{'\\theta_{\\max}'}</Tex> 之外，會觸發 HOLD；這個 glitch 與 FLL dead zone 的交互作用都沒有建模（本節的已知限制，見 §14.6b.5 的研究假說說明）。
        </p>
      </Callout>

      <h3 id="ch14-acq-enable">14.6b.4 enable 的條件與總延遲預算</h3>
      <p>
        頻率鎖定之後，相位迴路閉合，還要等三件事：相位進門檻並連續 <Tex>{'N_\\text{pl}'}</Tex> 個週期（phase lock）、最近 <Tex>{'W'}</Tex> 個週期的 rms 低於門檻（暫態消掉了，校正量到的才是穩態的誤差）、DTC 的 code 沒有飽和（否則 <Tex>{'\\partial e/\\partial w=0'}</Tex>，LMS 沒有梯度可跟）。每一項都能算出要幾個週期，加起來就是 LOCK 的預算。預設情境的結論：FLL 佔 <Tex>{`n_\\text{FL}=${a.nFL}`}</Tex> 個週期；之後 rms 視窗 <Tex>{`W=${DEFAULT_ACQ.settleWindow}`}</Tex> 是最大的一項（phase lock 只要 <Tex>{`${a.nPlRel}`}</Tex> 個週期），enable 在第 <Tex>{`${a.nEnable}`}</Tex> 個週期（sine PD <Tex>{`${tl.summary.enableCycle}`}</Tex>），LOCK <Tex>{`=\\lceil${a.nEnable + 1}/${DEFAULT_ACQ.blockN}\\rceil=${a.lockBlocks}`}</Tex> 個 block——和 §14.7 原本固定的 <Tex>{'10'}</Tex> 相同，但現在是算出來的。
      </p>
      <ModeGate min="engineer" summary={String.raw`推導 F-14.25：$g_p$、phase lock、rms 視窗與 LOCK 的 block 數，逐週期的時間表，與手算 HC-14.11`}>
        <Steps
          title="phase lock、rms 視窗與 LOCK 的 block 數"
          steps={[
            {
              tex: String.raw`g_p=1-e^{-2\pi f_\text{BW}/f_\text{ref}}`,
              why: (
                <>
                  連續時間的一階閉迴路在一個 reference 週期（<Tex>{'T_\\text{ref}=1/f_\\text{ref}'}</Tex>）內衰減 <Tex>{'e^{-2\\pi f_\\text{BW}T_\\text{ref}}=e^{-2\\pi f_\\text{BW}/f_\\text{ref}}'}</Tex>；離散模型每個週期修掉的比例就是 1 減它。<Tex>{'320\\,\\mathrm{MHz}/4\\,\\mathrm{GHz}'}</Tex> 給 <Tex>{`g_p=${nf(a.gp, 4)}`}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\theta[n]-\theta_\text{ss}=(1-g_p)^n(\theta_0-\theta_\text{ss})\ \Rightarrow\ |\theta[n]|\le|\theta_\text{ss}|+(1-g_p)^n|\theta_0-\theta_\text{ss}|`,
              why: <>線性 PD 的暫態是等比數列（和 F-14.2 一樣）；三角不等式把它變成「最壞情況」的上界，所以算出來的週期數是保守的。</>,
            },
            {
              tex: String.raw`n_\text{tr}=\max\Big(1,\Big\lceil\frac{\ln\big((\theta_{\max}-|\theta_\text{ss}|)/|\theta_0-\theta_\text{ss}|\big)}{\ln(1-g_p)}\Big\rceil\Big),\qquad n_\text{PL}=n_\text{tr}+N_\text{pl}-1`,
              why: <>暫態縮到「門檻減靜態偏移」所需的週期，再加連續 <Tex>{'N_\\text{pl}'}</Tex> 個；<Tex>{'\\theta_0'}</Tex> 是宣告頻率鎖定那個週期的相位誤差，所以 <Tex>{'n_\\text{PL}'}</Tex> 相對於 <Tex>{'n_\\text{FL}'}</Tex>。<Tex>{'\\theta_0'}</Tex> 本身不計數（第一個樣本在 <Tex>{'n_\\text{FL}+1'}</Tex>），所以 <Tex>{'n_\\text{tr}'}</Tex> 至少是 1——起點已在門檻內時 <Tex>{'\\lceil\\cdot\\rceil'}</Tex> 會是 0 或負的。</>,
            },
            {
              tex: String.raw`\frac1W\sum_{k=n-W+1}^{n}\theta[k]^2<\mathrm{rms}_{\max}^2\ \Leftarrow\ \underbrace{\frac{(\theta_0-\theta_\text{ss})^2(1-g_p)^{2n_{\text{tr},W}}}{1-(1-g_p)^2}}_{\text{視窗裡剩下的暫態能量}}<(\mathrm{rms}_{\max}^2-\theta_\text{ss}^2)\,W`,
              why: (
                <>
                  rms 視窗：把平方和拆成靜態偏移、暫態能量與雜訊；暫態能量是公比 <Tex>{'(1-g_p)^2'}</Tex> 的等比級數，前 <Tex>{'n_{\\text{tr},W}'}</Tex> 個最大的樣本滑出視窗後剩下的部分要低於額度。
                </>
              ),
            },
            {
              tex: String.raw`n_\text{settle}=W+n_{\text{tr},W}-1,\qquad n_{\text{tr},W}=\max\Big(1,\Big\lceil\frac{\ln\big((\mathrm{rms}_{\max}^2-\theta_\text{ss}^2)W(1-(1-g_p)^2)/(\theta_0-\theta_\text{ss})^2\big)}{2\ln(1-g_p)}\Big\rceil\Big)`,
              why: <>視窗先要填滿 <Tex>{'W'}</Tex> 個樣本，而且最前面 <Tex>{'n_{\\text{tr},W}'}</Tex> 個已經滑出去；能量每個週期乘 <Tex>{'(1-g_p)^2'}</Tex>，所以分母是 <Tex>{'2\\ln(1-g_p)'}</Tex>。</>,
            },
            {
              tex: String.raw`n_\text{enable}=n_\text{FL}+\max(n_\text{PL},n_\text{settle}),\qquad B_\text{LOCK}=\Big\lceil\frac{n_\text{enable}+1}{N}\Big\rceil`,
              why: (
                <>
                  三個時間條件取最晚的那一個（倍頻捕獲與 DTC 工作點是靜態檢查，不佔時間）；第一個 CAL 週期落在哪個 block，那個 block 還不能更新——整個 block 都在 CAL 才算，所以是向上取整。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-14.25" label="phase lock、迴路穩態與校正 enable 的總延遲預算">
          {String.raw`\begin{aligned}n_\text{PL}&=\max\Big(1,\Big\lceil\frac{\ln\big((\theta_{\max}-|\theta_\text{ss}|)/|\theta_0-\theta_\text{ss}|\big)}{\ln(1-g_p)}\Big\rceil\Big)+N_\text{pl}-1\\ n_\text{settle}&=W+\max\Big(1,\Big\lceil\frac{\ln\big((\mathrm{rms}_{\max}^2-\theta_\text{ss}^2)\,W\,(1-(1-g_p)^2)/(\theta_0-\theta_\text{ss})^2\big)}{2\ln(1-g_p)}\Big\rceil\Big)-1\\ n_\text{enable}&=n_\text{FL}+\max(n_\text{PL},n_\text{settle})\ (|\Delta f_h|<\tfrac12f_\text{ref},\ \text{DTC 工作點在範圍內}),\qquad B_\text{LOCK}=\Big\lceil\frac{n_\text{enable}+1}{N}\Big\rceil\end{aligned}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 線性 PD、無雜訊時這就是逐週期狀態機跑出來的數字（下表）：<Tex>{`n_\\text{PL}=${a.nPlRel}`}</Tex>、<Tex>{`n_\\text{settle}=${a.nSettleRel}`}</Tex>——rms 視窗 <Tex>{'W=512'}</Tex> 本身就是最大的一項；<Tex>{`n_\\text{enable}=${a.nFL}+${Math.max(a.nPlRel, a.nSettleRel)}=${a.nEnable}`}</Tex>、<Tex>{`B_\\text{LOCK}=\\lceil${a.nEnable + 1}/1024\\rceil=${a.lockBlocks}`}</Tex>。sine PD 慢 <Tex>{`${tl.summary.enableCycle - ACQ_TL_LINEAR.summary.enableCycle}`}</Tex> 個週期（enable <Tex>{`${tl.summary.enableCycle}`}</Tex>），在弦斜率的上界 <Tex>{`${a.nEnableBound}`}</Tex> 之內，LOCK 仍是 <Tex>{`${tl.summary.lockBlocks}`}</Tex> 個 block——和 §14.7 原本固定的 <Tex>{'10'}</Tex> 相同，但現在是算出來的。DTC 工作點：<Tex>{`T_0=${nf(a.dtc.t0Fs / 1000, 4)}\\,\\mathrm{ps}`}</Tex>、<Tex>{`R=${nf(a.dtc.rangeFs / 1000, 4)}\\,\\mathrm{ps}`}</Tex>（<FormulaLink id="F-04.19">F-04.19</FormulaLink>），初始 <Tex>{'w_0=0'}</Tex> 與真值 <Tex>{'a_0=100\\,\\mathrm{fs}'}</Tex> 在 <Tex>{'x=\\pm1'}</Tex> 都沒有飽和。
        </p>
        <div className="table-wrap">
          <table className="ch14-table">
            <caption className="c-sr-only">預設情境（sine PD、無雜訊）每個狀態的起訖週期與進入條件</caption>
            <thead>
              <tr>
                <th scope="col">狀態</th>
                <th scope="col">起（週期）</th>
                <th scope="col">迄（不含）</th>
                <th scope="col">進入的條件</th>
              </tr>
            </thead>
            <tbody>
              {tl.segments.map((g, i) => (
                <tr key={i}>
                  <td>{ACQ_STATE_LABEL[g.state]}</td>
                  <td className="num">{g.from}</td>
                  <td className="num">{g.to === tl.df.length ? '（模擬結束）' : g.to}</td>
                  <td>{md(g.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Hand id="HC-14.11">把迴路頻寬、殘餘頻率誤差、交棒時的相位、門檻與視窗代進去，算出 LOCK 要幾個 block；比較 <Tex>{'W'}</Tex> 與 FLL 各佔多少。</Hand>
      </ModeGate>

      <h3 id="ch14-acq-sm">14.6b.5 acquisition 狀態機與失鎖回退</h3>
      <p>
        把四個條件接成狀態機：ACQ 期間只有 FLL 在動（校正關閉）；頻率鎖定後 FLL 凍結、相位迴路閉合進 PLOCK；條件齊了進 CAL（§14.7 的狀態機從這裡離開 LOCK）。之後有兩種回退：相位出事（cycle slip 或 <Tex>{'|\\theta|\\ge\\theta_{\\max}'}</Tex>）只需暫停校正（HOLD），重新 phase lock 後經 RECAL 通知 block 級狀態機先 VERIFY 再更新；頻率出事（<Tex>{'|\\hat{\\Delta f}|>f_\\text{unlock}'}</Tex> 連續 <Tex>{'N_\\text{ul}'}</Tex> 個週期）就得整個重來，回到 ACQ。
      </p>
      <ModeGate min="engineer" summary="acquisition 狀態機圖（ACQ → PLOCK → CAL → HOLD／RECAL、失鎖回退）、核心程式碼，與 §14.7 實驗裡 acquisition 控制項的五個「試試看」">
        <Diagram chart={CHART_ACQ_SM} caption="acquisition 狀態機：實線是上電的主線（ACQ → PLOCK → CAL）與相位層級的回退（HOLD → RECAL → CAL），虛線是失鎖回到 ACQ；每條邊都是 acquisition.ts 真的會走的轉移。">
          <p>
            <strong>先看</strong>主線：ACQ 的條件是 F-14.22／F-14.23 的 lock detect，PLOCK 的條件是 F-14.25 的 phase lock 與 rms 視窗，再 AND 上倍頻捕獲（<Tex>{'|\\hat{\\Delta f}|<f_\\text{ref}/2'}</Tex>）與 DTC 工作點。<strong>再看</strong>HOLD 與 RECAL：相位層級的事件不需要重跑 FLL，但 block 級狀態機回來時要先 VERIFY（§14.7 的「重新鎖定後先驗證」）。<strong>最後看</strong>虛線：失鎖用比 <Tex>{'f_\\text{tol}'}</Tex> 高的 <Tex>{'f_\\text{unlock}'}</Tex> 判定（遲滯，和 §14.7 TRACK 警報的 Schmitt trigger 同一個道理），任何狀態都可以回 ACQ。
          </p>
          <p>
            圖上的「失鎖」就是 block 級狀態機看到的 lock detect = 0：§14.7 實驗裡失鎖事件的長度不再只是使用者設的那幾個 block，而是加上重新 acquisition 的時間。預設情境在 CAL 中讓 VCO 頻率跳 <Tex>{'+50\\,\\mathrm{MHz}'}</Tex>：<Tex>{`${ACQ_LOSS.summary.holds}`}</Tex> 次 HOLD、<Tex>{`${ACQ_LOSS.summary.unlocks}`}</Tex> 次失鎖，從跳變到重新 enable 要 <Tex>{`${ACQ_LOSS.summary.relockCycles}`}</Tex> 個週期（<Tex>{`${ACQ_LOSS.summary.relockBlocks}`}</Tex> 個 block）——FLL 從 50 MHz 重新拉到 1 MHz 的 <Tex>{`\\lceil\\ln(1/50)/\\ln(1-K_f)\\rceil=${fllCyclesToTol(5e7, 1e6, a.kF)}`}</Tex> 個週期占了大部分。
          </p>
        </Diagram>
        <p>
          <ClaimTag kind="research" /> 狀態機的門檻、連續週期數與回退路徑是教學用的參考設計；block 級的狀態機（§14.7）目前只把「失鎖」接進來，HOLD／RECAL 的暫停還沒有接到 block 級；FLL dead zone、PMUX 切相 glitch 與 Type-II 迴路的積分路徑也都沒有建模（列在假設裡）。
        </p>
        <CodeBlock source={acquisitionSrc} region="harmonicCapture" path="src/simulation/models/acquisition.ts" title="core:harmonicCapture（§14.6b.0 的倍頻模糊：SSPD 只看得到混疊後的頻率誤差）" />
        <CodeBlock source={acquisitionSrc} region="fllClosedForm" path="src/simulation/models/acquisition.ts" title="core:fllClosedForm（F-14.22 的 n_c 與 n_FL）" />
        <CodeBlock source={acquisitionSrc} region="acqStep" path="src/simulation/models/acquisition.ts" title="core:acqStep（一個 reference 週期：量測 → FLL 或相位迴路 → 偵測器 → 轉移）" />
        <ModeGate min="research" summary="lock detect 統計與 phase lock 封閉式的核心程式碼">
          <CodeBlock source={acquisitionSrc} region="lockDetectStats" path="src/simulation/models/acquisition.ts" title="core:lockDetectStats（F-14.23）" />
          <CodeBlock source={acquisitionSrc} region="phaseLockClosedForm" path="src/simulation/models/acquisition.ts" title="core:phaseLockClosedForm（F-14.25 的 n_PL 與 n_settle）" />
        </ModeGate>
        <Callout kind="info" title="試試看（§14.7 的實驗多了一組 acquisition 控制項）">
          <ul>
            <li>
              預設：acquisition 時間軸顯示 FLL 的 <Tex>{'|\\Delta f|'}</Tex> 指數下降、<Tex>{`${a.nFL}`}</Tex> 附近宣告頻率鎖定（有雜訊時稍晚）、相位從 25 ps 幾個週期內收到門檻、再等 512 個週期的 rms 視窗；LOCK = 10 個 block，和原本的計數器一樣，但 Analytic 欄現在會把封閉式和模擬逐項對照。
            </li>
            <li>
              把 <Tex>{'K_f'}</Tex> 減半（載入「FLL 增益減半」）：無雜訊的封閉式 LOCK = <Tex>{`${ACQ_SLOW.lockBlocks}`}</Tex> 個 block，實驗（預設 <Tex>{'\\sigma_f=0.1\\,\\mathrm{MHz}'}</Tex>）顯示 <Tex>{`${ACQ_SLOW_NOISY_BLOCKS}`}</Tex> 個——FLL 變慢，lock detect 因雜訊多等的週期也跟著變長，剛好跨過 block 邊界。把 <Tex>{'f_\\text{tol}'}</Tex> 放寬到 3 MHz：FLL 提早交棒，但殘餘誤差造成的靜態偏移 <Tex>{`\\theta_\\text{ss}=${nf(ACQ_FTOL3.thetaSsFs, 3)}\\,\\mathrm{fs}`}</Tex> 已超過 <Tex>{'\\mathrm{rms}_{\\max}=100\\,\\mathrm{fs}'}</Tex>，rms 視窗永遠判不過、校正不 enable——<Tex>{'f_\\text{tol}'}</Tex> 同時是 <Tex>{'\\theta_\\text{ss}'}</Tex> 的預算；再放寬到超過 <Tex>{'f_\\text{unlock}=4\\,\\mathrm{MHz}'}</Tex>，遲滯反向，會在 ACQ 與 PLOCK 之間來回。
            </li>
            <li>
              載入「頻率估計雜訊 4 倍」：lock 時間改由雜訊決定（F-14.23 的餘裕），LOCK 從 10 變 11 個 block；再把 <Tex>{'N_\\text{ld}'}</Tex> 從 32 改成 8，看漏報少了、但誤報的指數變小。
            </li>
            <li>
              載入「DTC 工作點超出範圍」：四個條件少一個，校正永遠不 enable——這不是調 <Tex>{'\\mu'}</Tex> 能解決的，要回 <ChRef ch="04" sec="§5b">Ch04</ChRef> 改 DTC 的範圍預算。
            </li>
            <li>載入「失鎖後要重新 acquisition」：block 級的失鎖視窗從 10 個 block 變成 19 個，重新鎖定後先 VERIFY。</li>
          </ul>
        </Callout>
      </ModeGate>

      <h3 id="ch14-acq-quiz">本節思考題</h3>
      <Quiz
        title="思考題 A（FLL 週期數）"
        question={
          <>
            <Tex>{'K_f=10^{-3}'}</Tex>、<Tex>{'\\Delta f_0=50\\,\\mathrm{MHz}'}</Tex>、<Tex>{'f_\\text{tol}=0.5\\,\\mathrm{MHz}'}</Tex>。無雜訊時 FLL 第幾個週期進門檻（<Tex>{'n_c'}</Tex>）？
          </>
        }
        options={[{ label: String(QUIZ_NC_WRONG.linear) }, { label: String(QUIZ_NC), correct: true }, { label: String(QUIZ_NC_WRONG.log10) }, { label: String(QUIZ_NC_WRONG.noLog) }]}
        answer={
          <>
            <TexBlock>{String.raw`n_c=\Big\lceil\frac{\ln(0.5/50)}{\ln(1-10^{-3})}\Big\rceil=\Big\lceil\frac{${tx(Math.log(0.01), 5)}}{${tx(Math.log(0.999), 5)}}\Big\rceil=\lceil${tx(Math.log(0.01) / Math.log(0.999), 6)}\rceil=${QUIZ_NC}`}</TexBlock>
            <p>
              要縮 100 倍（<Tex>{'\\ln100=4.605'}</Tex> 個 e 倍），每個 e 倍約 <Tex>{'1/K_f=1000'}</Tex> 個週期。{QUIZ_NC_WRONG.linear} 是把指數衰減當成每週期減掉固定的 <Tex>{'K_f\\Delta f_0'}</Tex>（線性下降；實際上誤差越小、每週期修掉的也越少）；{QUIZ_NC_WRONG.log10} 是把分子的 <Tex>{'\\ln'}</Tex> 按成 <Tex>{'\\log_{10}'}</Tex>（分母仍是 <Tex>{'\\ln'}</Tex>，差 <Tex>{'2.3026'}</Tex> 倍）；{QUIZ_NC_WRONG.noLog} 是忘了取對數，把比例 <Tex>{'100'}</Tex> 直接除以 <Tex>{'K_f'}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 B（為什麼要連續 N 個）"
        question={<>lock detect 若只看單一樣本（<Tex>{'N_\\text{ld}=1'}</Tex>），在真實誤差剛好在門檻外一個 <Tex>{'\\sigma_f'}</Tex> 時會怎樣？</>}
        options={[
          { label: <>和 <Tex>{'N_\\text{ld}=32'}</Tex> 一樣幾乎不誤報，只是快一點</> },
          { label: <>誤報機率約 <Tex>{'\\Phi(-1)\\approx16\\%'}</Tex>：校正會在頻率還差一個 <Tex>{'\\sigma_f'}</Tex> 時就 enable</>, correct: true },
          { label: '漏報變多，鎖定變慢' },
          { label: <>誤報機率是 <Tex>{'\\Phi(-1)^{32}'}</Tex></> },
        ]}
        answer={
          <p>
            F-14.23：<Tex>{'P_\\text{FA}=p_\\text{in}(\\Delta f_x)^{N_\\text{ld}}'}</Tex>，<Tex>{'\\Delta f_x=f_\\text{tol}+\\sigma_f'}</Tex> 時 <Tex>{'p_\\text{in}\\approx\\Phi(-1)=0.159'}</Tex>。單一樣本就是 16% 的誤報；連續 32 個把它壓到 <Tex>{`${tx(a.pFalseAlarm, 2)}`}</Tex>。漏報則相反：<Tex>{'N_\\text{ld}'}</Tex> 越大漏報越多，但漏報只是延遲（<Tex>{'E[T_N]'}</Tex>），不會讓校正在錯的時候開始。
          </p>
        }
      />
      <Quiz
        title="思考題 C（SSPLL 為什麼要先有 FLL）"
        question={
          <>
            subsampling PLL 為什麼一定要先用 FLL 把 VCO 頻率拉近，才閉 SSPD 的相位迴路？（本節的 illustrative 數字：<Tex>{'f_\\text{ref}=4\\,\\mathrm{GHz}'}</Tex>、<Tex>{'M=4'}</Tex>、<Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex>）
          </>
        }
        options={[
          { label: '頻率沒拉好就閉相位迴路，SSPD 會看錯方向、一定 cycle slip' },
          {
            label: (
              <>
                SSPD 取樣 VCO 波形，分不出 <Tex>{'Mf_\\text{ref}'}</Tex> 與 <Tex>{'(M\\pm1)f_\\text{ref}'}</Tex>；FLL（走 divider）要先把 <Tex>{'|\\Delta f|'}</Tex> 拉進 <Tex>{'f_\\text{ref}/2'}</Tex> 的捕獲範圍，SSPD 才鎖得到對的那一根
              </>
            ),
            correct: true,
          },
          { label: 'FLL 的頻寬比 SSPD 相位迴路寬，鎖得比較快' },
          { label: 'SSPD 的小訊號增益太小，不先拉頻率相位迴路就不收斂' },
        ]}
        answer={
          <p>
            第一個理由是倍頻模糊（§14.6b.0）：<Tex>{'f_\\text{vco}=(M+k)f_\\text{ref}'}</Tex> 在取樣點看起來完全一樣，SSPD 只會把 VCO 拉到最近的那一根；FLL 的頻率偵測數 divider 的 edge，看得出 <Tex>{'M'}</Tex>。第一個選項把第二層（相位層級）的條件當成理由：在這個模型裡 <Tex>{'\\Delta f_0=80\\,\\mathrm{MHz}'}</Tex> 遠小於 slip 上限 <Tex>{`\\Delta f_\\text{limit}=${MHz(ACQ_A.slip.dfLimitHz, 4)}\\,\\mathrm{MHz}`}</Tex>，沒有 FLL 也不會 slip（模擬 <Tex>{`${ACQ_NOFLL_TL.summary.slips}`}</Tex> 次）、方向也沒有看錯（<Tex>{'|\\theta|<T_\\text{vco}/4'}</Tex>）；真正卡住的是靜態偏移 <Tex>{`\\theta_\\text{ss}=${ps(ACQ_A.noFll.thetaSsFs, 3)}\\,\\mathrm{ps}>\\theta_{\\max}`}</Tex>（一階相位迴路；Type-II 的積分器會把它積掉，倍頻模糊則不會）。殘餘誤差超過 <Tex>{'\\Delta f_\\text{limit}'}</Tex> 才會一路 slip——那是第二層的條件，不是 FLL 存在的主要理由。第三個選項剛好相反：FLL 每週期只修 <Tex>{`K_f=${tx(ACQ_A.kF, 2)}`}</Tex>，相位迴路每週期修 <Tex>{`g_p=${nf(ACQ_A.gp, 3)}`}</Tex>，FLL 慢得多，它負責的是「拉到對的那一根」，不是速度。第四個選項：SSPD 在 <Tex>{'\\theta=0'}</Tex> 附近的斜率就是 1（F-14.24 的 <Tex>{'S(\\theta)\\approx\\theta'}</Tex>），增益不是問題。
          </p>
        }
      />
    </Section>
  )
}
