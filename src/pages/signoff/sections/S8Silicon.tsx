import { AnchorLink, Callout, ChRef, ClaimTag, CodeBlock, FormulaLink, ModeGate, Section, SourceTag, Tex, TexBlock } from '@/components'
import judgesSrc from '../judges.ts?raw'
import { accumulatorBitsRequired, oneHotPatternFactor, polarityReadoutPlan, spurDbc, timingToneFromSpur } from '../judges'
import { CHART_SILICON_LOOP } from '../diagrams'
import { Diagram, HandCalcSlot, RichText, Steps, nf, tx } from '../shared'

const PATH = 'src/pages/signoff/judges.ts'

/** §8.5 表格與推導用的一組 illustrative 數字（HC-SO.5／HC-SO.6 的預設值相同；handcalcs.test.tsx 核對）。 */
export const SILICON_EXAMPLE = {
  /** 極性那一列：σ_v = 200 fs ⇒ Δ = 0.3σ_v = 60 fs；靠近 keep-out 的 channel C = 0.1；讀出 block N = 1024；f_ref = 100 MHz；z = 3 */
  plan: { sigmaV: 200, deltaRatio: 0.3, C: 0.1, N: 1024, fRefHz: 100e6, z: 3 },
  /** spur 那一列：輸出 13 GHz（T15 的條件）量到 −60 dBc、tone 在帶內（|T| = 1）、8 相 PMUX 只有一相有殘差 */
  spur: { fOutHz: 13e9, spurDbc: -60, magT: 1, P: 8 },
  /** DfT 的讀出位寬：6-bit code、N = 1024 */
  readout: { Bx: 6, N: 1024 },
} as const

/** 表格／卡片字串：`$…$` 交給 RichText（KaTeX）；⟨name⟩ 顯示成 <code>（暫存器名稱）。 */
function PlanText({ text }: { text: string }) {
  const parts = text.split(/⟨([^⟩]+)⟩/)
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <code key={i}>{p}</code> : <RichText key={i} text={p} />))}
    </>
  )
}

/** 表格的一列：判準 → 晶片內觀測量 → 暫存器／測試模式 → 儀器上看什麼 → 通過數字（文字含 `$…$`，以 RichText 顯示）。 */
interface PlanRow {
  id: string
  criterion: string
  observe: string
  registers: string
  instrument: string
  pass: string
}

/** §8.5：矽上量測計畫與 DfT 清單——前面每一列判準在晶片上要讀什麼、寫什麼、儀器上看什麼 */
export function S8Silicon() {
  const plan = polarityReadoutPlan(SILICON_EXAMPLE.plan)
  const { sigmaV, N, z } = SILICON_EXAMPLE.plan
  const fRefMHz = SILICON_EXAMPLE.plan.fRefHz / 1e6
  const tBlkUs = plan.tBlockS * 1e6
  const tMeasUs = plan.tMeasS * 1e6
  const { fOutHz, spurDbc: spurIn, magT, P } = SILICON_EXAMPLE.spur
  const fOutGHz = fOutHz / 1e9
  const beta = 2 * 10 ** (spurIn / 20)
  const at = timingToneFromSpur(fOutHz, spurIn, magT)
  const kappa = oneHotPatternFactor(P)
  /** α = s/P（DTC 殘量固定）時的相干加總 2/P，與分數頻道的 κ_pat 差 √w₁ = P sin(π/P)/π（案例頁 F-CS.21） */
  const kappaDft = 2 / P
  const sqrtW1 = (P * Math.sin(Math.PI / P)) / Math.PI
  const dP = at / kappa
  const atOutOfBand = timingToneFromSpur(fOutHz, spurIn, 10 ** (-20 / 20))
  const spurBack = spurDbc(fOutHz, at * magT)
  const bits = accumulatorBitsRequired(SILICON_EXAMPLE.readout.Bx, SILICON_EXAMPLE.readout.N)
  const stepMax = 0.1 * sigmaV

  const rows: PlanRow[] = [
    {
      id: 'polarity',
      criterion: String.raw`極性（§2；F-SO.1、F-SO.3）`,
      observe: String.raw`兩個工作點 $w_0\pm\Delta$ 各 $M$ 個 block 的 $\bar G$（整個累加器讀出來，不是只讀符號位元）`,
      registers: String.raw`⟨cal_freeze⟩＝1；⟨w_force⟩ 寫 $w_0\pm\Delta$（步進 $\le0.1\sigma_v$）；⟨gmac_rd⟩ 逐 block 讀出；⟨regr_sel⟩ 選同一個 $D$`,
      instrument: String.raw`不需要儀器（純數位讀出）；只要同時確認 lock-detect 沒有掉`,
      pass: String.raw`$\sigma_v=${nf(sigmaV, 3)}$ fs ⇒ $\Delta\le0.3\sigma_v=${nf(plan.delta, 3)}$ fs；$C=${nf(SILICON_EXAMPLE.plan.C, 2)}$、$N=${N}$、$z=${z}$ ⇒ 每側 $M\ge${plan.M}$ 個 block（$2M$ 個 block 共 $${nf(tMeasUs, 5)}\ \mu$s @ ${nf(fRefMHz, 3)} MHz）；判準 $\hat K-z\,\mathrm{se}>0$，預期 $\bar G_+<\bar G_-$`,
    },
    {
      id: 'keepout',
      criterion: String.raw`keep-out channel（§5）`,
      observe: String.raw`每個 channel：放開 $w$ 後的 $w$ 軌跡（往哪裡漂、是否兩側都收到同一個 $w^*$）與量到的 $\hat C$`,
      registers: String.raw`⟨w_rd⟩ 定時讀 $w$；⟨cal_en⟩；FCW 掃描腳本（每個 channel 同一組 $\mu$、$N$）`,
      instrument: String.raw`頻譜儀：輸出在 $\alpha f_\text{ref}$（及倍頻）的 fractional spur 隨 $w$ 的變化；spur 是經 $|T|$ 的輸出量`,
      pass: String.raw`從 $w_0+\Delta$ 與 $w_0-\Delta$ 放開都往同一個 $w^*$ 收斂（方向與 $\mathrm{sgn}\,\hat C$ 一致），spur 下降到預算內；$w$ 單向漂到 rail、或 spur 隨校正上升 ⇒ 該 channel 進 keep-out 清單`,
    },
    {
      id: 'bias',
      criterion: String.raw`bias（§5.1；$w^*\ne a$）`,
      observe: String.raw`收斂後 freeze 讀到的 $w^*$；殘餘 spur 反推出的 $A_t$、$\delta$`,
      registers: String.raw`⟨cal_freeze⟩＝1；⟨w_rd⟩；⟨w_force⟩ 掃 $w^*\pm$ 幾個 $\sigma_w$ 找 spur 最低點 $w_\text{opt}$（$\approx$ 物理的 $a$）`,
      instrument: String.raw`頻譜儀：殘餘 spur 對 $w$ 的曲線；spur dBc → $A_t$（F-SO.13）`,
      pass: String.raw`$|w^*-w_\text{opt}|\le\varepsilon_\text{bias}$（例如 $2\sigma_w$）；$${nf(spurIn, 3)}$ dBc @ ${nf(fOutGHz, 3)} GHz、$|T|=1$ ⇒ $A_t=${nf(at, 4)}$ fs ⇒ 單相殘差 $\delta_P\approx${nf(dP, 4)}$ fs（$\kappa_\text{pat}=2\sin(\pi/P)/\pi=${nf(kappa, 4)}$）`,
    },
    {
      id: 'clip',
      criterion: String.raw`clip／saturation（§16.1-8）`,
      observe: String.raw`飽和計數器 ⟨sat_cnt⟩（可清除）與 rail 旗標；$w$ 離開 rail 的時間`,
      registers: String.raw`⟨sat_cnt⟩ 讀出與清除；測試模式：⟨w_force⟩ 把 $w$ 推到 rail 再放開（模擬 PVT 步階）`,
      instrument: String.raw`頻譜儀／lock 指示：rail 期間 spur 變大、放開後回到規格；lock-detect 不可掉`,
      pass: String.raw`放開後 ⟨sat_cnt⟩ 在幾個 block 內停止增加、$w$ 回到 $w^*$ 的時間 $\le k_{95}+$settling（§4 的 $k_{95}$）；正常運作時長期 ⟨sat_cnt⟩＝0`,
    },
    {
      id: 'relock',
      criterion: String.raw`relock／mode 切換（§16.1-10）`,
      observe: String.raw`lock-detect 與校正 enable 的時序；失鎖期間 $w$ 不變；relock 後回到規格內的時間`,
      registers: String.raw`⟨lock_det⟩、⟨cal_en⟩ 接到測試腳位；事件記錄（失鎖前後的 $w$）；自動 freeze 的狀態位元`,
      instrument: String.raw`示波器／邏輯分析儀：⟨lock_det⟩ 掉下後 ⟨cal_en⟩ 何時關；relock 後 ⟨lock_det⟩ 回來＋settling 才重新 enable`,
      pass: String.raw`失鎖期間 $w$ 的變化＝0（freeze）；⟨cal_en⟩ 在 $\le1$ 個 block 內關閉；relock 到輸出回到規格內的時間 $\le$ 上界（$k_{95}$ 個 block＋settling）`,
    },
  ]

  const dft: { id: string; reg: string; title: string; body: string }[] = [
    { id: 'readout', reg: 'gmac_rd', title: '讀出位寬：整個 GMAC 累加器', body: String.raw`$B_\text{acc}\ge B_x+\lceil\log_2N\rceil$（F-SO.10）：$B_x=${SILICON_EXAMPLE.readout.Bx}$、$N=${SILICON_EXAMPLE.readout.N}$ ⇒ $${bits}$ bit。average 模式讀出要附右移位數 $s$（F-SO.10 的 $G_\text{shift}$）；也要讀得到 block 計數，才確認真的讀了 $M$ 個 block。` },
    { id: 'wforce', reg: 'w_force', title: String.raw`可寫入 $w$`, body: String.raw`覆寫 $w$（與 LMS 更新互斥），步進 $\le0.1\sigma_v$（$\sigma_v=${nf(sigmaV, 3)}$ fs 時 $\le${nf(stepMax, 3)}$ fs），範圍涵蓋 $w_0\pm0.3\sigma_v$ 與 rail；寫入對齊 block 邊界，才能把 settling block 丟乾淨。` },
    { id: 'freeze', reg: 'cal_freeze', title: '可凍結', body: String.raw`停止更新但 GMAC 照跑——freeze $\pm\Delta$ 與讀 $w^*$ 都靠它；失鎖時自動 freeze（relock 列）；freeze 狀態可讀。` },
    { id: 'qinv', reg: 'q_inv', title: String.raw`可反相 $q$`, body: String.raw`每個 loop、每個 mode 一個位元：反面測試「comparator 接反」與 mode-specific 的極性修正（§2.5 的 $c_P<0$）都用它，不必改 RTL。` },
    { id: 'regr', reg: 'regr_sel', title: '可選 regressor', body: String.raw`raw $x$／$x[n-D]$（可程式化的 $D$）／filtered-x：用它量 $C_D$ 隨 $D$ 的變化（F-SO.4），找出每個 mode 的對齊。` },
    { id: 'phase', reg: 'phase_force', title: 'PMUX 相位強制', body: String.raw`固定選某一相（或固定 pattern）：量每一相的 $\hat J_{PP}$（§2.5）與 one-hot 的單相殘差；配合 ⟨w_force⟩ 做逐一擾動。` },
  ]

  return (
    <Section kind="explore" level={2} title="8.5 矽上量測計畫與 DfT 清單：每一列判準在晶片上要讀什麼、寫什麼、儀器上看什麼" id="so-silicon">
      <p>
        前面每一列判準都假設「讀得到 <Tex>{'\\bar G'}</Tex>、凍得住 <Tex>{'w'}</Tex>、推得動 <Tex>{'w'}</Tex>」。tape-out 之後能看到的只有兩種東西：<strong>暫存器讀出來的數字</strong>（<Tex>{'\\bar G'}</Tex>、<Tex>{'w'}</Tex>、計數器、lock-detect）和<strong>儀器量到的輸出</strong>（頻譜儀上的 spur、示波器上的時序）。這一節把兩者接起來：每一列判準對應到晶片內的觀測量、要有的暫存器／測試模式、儀器上看什麼、以及通過的數字。數字一律是 illustrative（<SourceTag kind="illustrative" />），由本頁的函式即時算出；不寫任何特定晶片的細節。
      </p>
      <div className="c-tag-row">
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
      </div>
      <Callout kind="warn" title="儀器量到的是輸出，不是 PD 端">
        頻譜儀的 spur 是 DTC／PMUX 端的 timing tone 經過主 PLL 的輸出 transfer <Tex>{'T=L/(1+L)'}</Tex> 之後的量（<FormulaLink id="F-12.16" />）：帶內 <Tex>{'|T|\\approx1'}</Tex>（有 peaking 時略大於 1），帶外被 PLL 濾掉。所以反推殘差時要<strong>除回 <Tex>{'|T(f_m)|'}</Tex></strong>——同樣是 <Tex>{`${nf(spurIn, 3)}`}</Tex> dBc，tone 在帶內對應 <Tex>{`A_t=${tx(at, 4)}`}</Tex> fs，若 tone 在 <Tex>{'|T|=-20'}</Tex> dB 的帶外，DTC 端其實是 <Tex>{`${tx(atOutOfBand, 4)}`}</Tex> fs。PD 端的 <Tex>{'e_\\text{PD}=H_\\mathrm{PD}\\,\\phi_\\text{dtc}'}</Tex> 儀器量不到，只能從 GMAC 讀出。
      </Callout>

      <div className="table-wrap">
        <table className="so-plan">
          <thead>
            <tr>
              <th>判準</th>
              <th>晶片內觀測量</th>
              <th>暫存器／測試模式</th>
              <th>儀器上看什麼</th>
              <th>通過數字（illustrative）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-plan={r.id}>
                <td>
                  <PlanText text={r.criterion} />
                </td>
                <td>
                  <PlanText text={r.observe} />
                </td>
                <td>
                  <PlanText text={r.registers} />
                </td>
                <td>
                  <PlanText text={r.instrument} />
                </td>
                <td>
                  <PlanText text={r.pass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        暫存器名稱只是示意（<code>cal_freeze</code>、<code>w_force</code>…），對應下面 DfT 清單的六項；每一列都已連到上方 Matrix 的對應項目（<AnchorLink id="so-matrix">Sign-off Matrix</AnchorLink>：基本正確性、FCW、非線性、策略、SSPLL），量完就在那裡記錄狀態與數字。
      </p>

      <Diagram
        chart={CHART_SILICON_LOOP}
        caption={String.raw`矽上量測迴圈：每個 channel／mode／corner 跑一輪——數位側凍結、強制 $w_0\pm\Delta$、丟掉 settling block、讀 $M$ 個 block 的 $\bar G$ 做極性判決；放開 $w$ 後讀軌跡與飽和計數器；儀器側在輸出量 $\alpha f_\text{ref}$ 的 spur，反推 $A_t$ 與 freeze 後的 $w^*$ 比對。`}
        ariaLabel="矽上量測迴圈的流程圖：選一個 channel、mode 或 corner，設 freeze 位元並強制 w 等於 w0 加減 Delta，丟掉主 PLL settling 的 block，讀出 M 個 block 的 G 平均，算出 K 估計與標準誤做極性判決；通過就放開 w 讀軌跡與飽和計數器，用頻譜儀量輸出在 alpha f_ref 的 spur，反推 A_t 與 w 星比對後記錄；否或無法判定就加大 M、Delta 或進 keep-out；最後換下一個 channel"
      >
        <p>
          先看上半段的藍色方塊「讀出 <Tex>{'M'}</Tex> 個 block 的 <Tex>{'\\bar G'}</Tex>」：它就是 §2 的 freeze <Tex>{'\\pm\\Delta'}</Tex> 流程搬到晶片上，<Tex>{'M'}</Tex> 由 <FormulaLink id="F-SO.3" /> 決定、<Tex>{'\\Delta\\le0.3\\sigma_v'}</Tex> 由 <FormulaLink id="F-SO.2" /> 的截斷比決定；前面的「丟掉 settling block」是因為改 <Tex>{'w'}</Tex> 之後主 PLL 經 <Tex>{'T'}</Tex> 有暫態，那幾個 block 的 <Tex>{'\\bar G'}</Tex> 不屬於任何一個工作點。
        </p>
        <p>
          下半段棕色的「頻譜儀」是整個迴圈裡唯一的儀器量測，而且量到的是經 <Tex>{'|T|'}</Tex> 的輸出：藍色的「反推」用 <FormulaLink id="F-SO.13" /> 把 spur dBc 換回 DTC／PMUX 端的 <Tex>{'A_t'}</Tex>，再和 freeze 後讀到的 <Tex>{'w^*'}</Tex> 比對——這就是 bias 那一列。紅色出口不是失敗，是「這個 channel 要進 keep-out、或這個 mode 要反相 <Tex>{'q'}</Tex>」，仍然要記進 Matrix。
        </p>
      </Diagram>

      <Steps
        title={String.raw`要讀幾個 block 的 $\bar G$ 才能以 $z=3$ 判定極性？要花多少時間？`}
        steps={[
          { tex: String.raw`\Delta=0.3\,\sigma_v=0.3\times${tx(sigmaV, 3)}=${tx(plan.delta, 3)}\ \mathrm{fs}`, why: String.raw`強制寫進 w_force 的擾動：$\Delta\le0.3\sigma_v$ 時中央差分的截斷比 $r_\text{CD}\approx1-\Delta^2/(6\sigma_v^2)$ 只差約 $1.5\%$（F-SO.2），量到的 $\hat K$ 可以直接當小訊號的 $K_qC$ 用。` },
          { tex: String.raw`K=K_qC=\frac{\sqrt{2/\pi}}{\sigma_v}\,C=\frac{0.79788}{${tx(sigmaV, 3)}}\times${tx(SILICON_EXAMPLE.plan.C, 2)}=${tx(plan.K, 5)}\ \mathrm{fs}^{-1}`, why: String.raw`靠近 keep-out 的 channel（$C=0.1$）才是最需要量的：恢復力只有 $C=1$ 時的十分之一。` },
          { tex: String.raw`2N\Delta^2K^2=2\times${N}\times${tx(plan.delta, 3)}^2\times(${tx(plan.K, 5)})^2=${tx(2 * N * plan.delta ** 2 * plan.K ** 2, 4)}`, why: String.raw`F-SO.3 的分母：$\mathrm{se}=\sigma_\eta/(\Delta\sqrt{2M})$、$\sigma_\eta\approx1/\sqrt N$ 代進 $\hat K-z\,\mathrm{se}>0$ 之後，$M$ 的下限就是 $z^2$ 除以這個數。` },
          { tex: String.raw`M\ge\frac{z^2}{2N\Delta^2K^2}=\frac{${z}^2}{${tx(2 * N * plan.delta ** 2 * plan.K ** 2, 4)}}=${tx((z * z) / (2 * N * plan.delta ** 2 * plan.K ** 2), 4)}\ \Rightarrow\ M_{\min}=${plan.M}`, why: String.raw`無條件進位；這是「每側」的 block 數，兩側共 $2M_{\min}=${2 * plan.M}$ 個。用 $M_{\min}$ 個 block 時預期的 $z=${tx(plan.zExpected, 4)}\ge${z}$。` },
          { tex: String.raw`T_\text{blk}=\frac{N}{f_\text{ref}}=\frac{${N}}{${tx(fRefMHz, 3)}\ \mathrm{MHz}}=${tx(tBlkUs, 4)}\ \mu\mathrm{s},\qquad T_\text{meas}=2M_{\min}T_\text{blk}=2\times${plan.M}\times${tx(tBlkUs, 4)}=${tx(tMeasUs, 5)}\ \mu\mathrm{s}`, why: String.raw`每個 reference 週期一個 comparator sample，所以一個 block 要 $N$ 個 reference 週期。每次改 $w$ 後丟掉的 settling block（幾個 $T$ 的時間常數）另外加；交錯量 $+\Delta$／$-\Delta$ 時每次切換都要丟。` },
        ]}
        result={String.raw`M_{\min}=${plan.M},\ \ T_\text{meas}=${tx(tMeasUs, 5)}\ \mu\mathrm{s}`}
      />
      <HandCalcSlot id="HC-SO.5">
        預設值就是上表極性那一列（<Tex>{`\\sigma_v=${tx(sigmaV, 3)}`}</Tex> fs、<Tex>{'C=0.1'}</Tex>、<Tex>{`N=${N}`}</Tex>）。把 <Tex>{'C'}</Tex> 改成 <Tex>{'0.05'}</Tex>、<Tex>{'N'}</Tex> 改成 <Tex>{'4096'}</Tex>，或把 <Tex>{'z_t'}</Tex> 提到 <Tex>{'6'}</Tex>，看 block 數與時間怎麼變。
      </HandCalcSlot>

      <Steps
        title="從頻譜儀的 spur（dBc）反推 timing tone 的 peak，再反推單相的 PHOS 殘差"
        steps={[
          { tex: String.raw`\text{spur}\approx20\log_{10}\frac\beta2\ \Rightarrow\ \beta=2\cdot10^{\text{spur}/20}=2\times10^{${tx(spurIn / 20, 3)}}=${tx(beta, 4)}\ \mathrm{rad}`, why: String.raw`F-12.18 的小角近似（$J_1(\beta)/J_0(\beta)\approx\beta/2$）反過來用；$-60$ dBc 就是 $\beta/2=10^{-3}$。` },
          { tex: String.raw`\beta=2\pi f_\text{out}|T(f_m)|A_t\ \Rightarrow\ A_t=\frac{\beta}{2\pi f_\text{out}|T(f_m)|}=\frac{${tx(beta, 4)}}{2\pi\times${tx(fOutGHz, 3)}\times10^{9}\times${tx(magT, 3)}}=${tx(at * 1e-15, 5)}\ \mathrm{s}=${tx(at, 5)}\ \mathrm{fs}`, why: String.raw`F-12.16：輸出相位 $\phi_\text{out}=-2\pi f_\text{out}T\,\delta t$——儀器量到的振幅已經乘過 $|T(f_m)|$，除回去才是 DTC／PMUX 端的 tone peak。負號只影響相位，不影響 dBc。` },
          { tex: String.raw`\begin{aligned}&e[n]=\delta_P\,\mathbf 1\{p[n]=j\}\\[2pt]&p[n]=\lfloor P\,\mathrm{frac}(\alpha n)\rfloor\\[2pt]&\mathbf 1\{p[n]=j\}=\sum_{\ell}c_\ell\,e^{j2\pi\ell\alpha n}\\[2pt]&|c_\ell|=\frac{\sin(\pi\ell/P)}{\pi\ell}\end{aligned}`, why: String.raw`只有一相（第 $j$ 相）有 offset 殘差 $\delta_P$。分數頻道的 PMUX 相位索引是分數相位 $\mathrm{frac}(\alpha n)$ 的粗量化（$1/P$ 以下的殘量交給 DTC），所以指示函數是「$\mathrm{frac}(\alpha n)$ 落在 $[j/P,(j+1)/P)$」的方窗，Fourier 係數是 sinc 形——就是案例頁 F-CS.13／F-CS.21 的 $w_\ell=(P|c_\ell|)^2$；第 $\ell$ 條線在 $\mathrm{frac}(\ell\alpha)f_\text{ref}$，$c_0=1/P$ 是佔空比（DC，被迴路吸收）。` },
          { tex: String.raw`A_t=2|c_1|\,\delta_P\equiv\kappa_\text{pat}\,\delta_P,\qquad \kappa_\text{pat}=\frac{2\sin(\pi/P)}{\pi}=\frac{2\sin(\pi/${P})}{\pi}=${tx(kappa, 4)}`, why: String.raw`儀器在 $\alpha f_\text{ref}$ 看到的是 $\ell=1$ 那一根；實數 tone 的 peak 是複數係數的兩倍。用 $P$ 點 DFT 看是同一件事：$|\hat\delta_1|=\delta_P/P$ 再乘案例頁 F-CS.21 的 $\sqrt{w_1}=P\sin(\pi/P)/\pi=${tx(sqrtW1, 4)}$。只有 $\alpha=s/P$（DTC 殘量固定、$p[n]=sn\bmod P$）時 $\ell\equiv1$ 的線全疊在同一個頻率、相干加總成 $2/P=${tx(kappaDft, 3)}$，差 ${nf(100 * (kappaDft / kappa - 1), 2)}%（${nf(20 * Math.log10(kappaDft / kappa), 2)} dB）。多相同時有殘差要用 F-CS.21 的 DFT 正向公式，係數就不是單一個 $\kappa_\text{pat}$。` },
          { tex: String.raw`\delta_P=\frac{A_t}{\kappa_\text{pat}}=\frac{${tx(at, 5)}}{${tx(kappa, 4)}}=${tx(dP, 5)}\ \mathrm{fs}`, why: String.raw`和 freeze 後讀到的該相 $w^*$（或 PMUX 相位強制量到的殘差）比對；差太多就是 bias，或量到的是別的來源（reference spur 在 $f_\text{ref}$ 偏移，不是 $\alpha f_\text{ref}$）。驗算：$20\log_{10}(\pi f_\text{out}|T|A_t)=${tx(spurBack, 4)}$ dBc。` },
        ]}
        result={String.raw`A_t=\frac{2\cdot10^{\text{spur}/20}}{2\pi f_\text{out}|T|},\ \ \delta_P=\frac{A_t}{\kappa_\text{pat}}`}
      />
      <TexBlock id="F-SO.13" label="從輸出 spur 反推 timing tone 的 peak 與單相 PHOS 殘差（F-12.18 反過來用）">{String.raw`\begin{aligned}&A_t=\frac{10^{\mathrm{spur}/20}}{\pi f_\text{out}\,|T(f_m)|}\\[2pt]&\delta_P=\frac{A_t}{\kappa_\text{pat}}\\[2pt]&\kappa_\text{pat}=\frac{2\sin(\pi/P)}{\pi}\\[2pt]&\quad(\text{單相 one-hot})\end{aligned}`}</TexBlock>
      <ModeGate min="engineer">
        <p className="small muted" data-conditions="F-SO.13">
          成立條件：小角 <Tex>{'\\beta=2\\cdot10^{\\mathrm{spur}/20}\\ll1'}</Tex>（spur 約 <Tex>{'-20'}</Tex> dBc 以下，否則用 <FormulaLink id="F-12.18" /> 的 Bessel 精確式 <Tex>{'20\\log_{10}(J_1(\\beta)/J_0(\\beta))'}</Tex>）；單邊 spur；<Tex>{'|T|'}</Tex> 取 tone 頻率 <Tex>{'f_m'}</Tex> 處的值，因為儀器量到的是經 <Tex>{'|T|'}</Tex> 的輸出（<FormulaLink id="F-12.16" />）而不是 PD 端；<Tex>{'\\kappa_\\text{pat}=2\\sin(\\pi/P)/\\pi'}</Tex> 只對「單一相有殘差、看 <Tex>{'\\alpha f_\\text{ref}'}</Tex> 的基波」成立（<Tex>{'\\alpha=s/P'}</Tex>、DTC 殘量固定時相干加總成 <Tex>{'2/P'}</Tex>），多相殘差要用案例頁 <FormulaLink id="F-CS.21" /> 的 DFT 正向公式；反推的是校正<strong>之後</strong>殘留在 <Tex>{'\\alpha f_\\text{ref}'}</Tex>（或其倍頻）的那一根 spur，reference spur 另有來源。<ClaimTag kind="approx" />
        </p>
      </ModeGate>
      <HandCalcSlot id="HC-SO.6">
        預設值就是上表 bias 那一列（<Tex>{`${tx(spurIn, 3)}`}</Tex> dBc、<Tex>{`${tx(fOutGHz, 3)}`}</Tex> GHz、<Tex>{'|T|=0'}</Tex> dB、<Tex>{`P=${P}`}</Tex>）。把 <Tex>{'|T|'}</Tex> 改成 <Tex>{'-20'}</Tex> dB（tone 在帶外）、spur 改成 <Tex>{'-40'}</Tex> dBc，或 <Tex>{'P'}</Tex> 改成 <Tex>{'16'}</Tex>，看 <Tex>{'A_t'}</Tex> 與 <Tex>{'\\delta_P'}</Tex> 怎麼變。
      </HandCalcSlot>
      <CodeBlock source={judgesSrc} region="spurInverse" path={PATH} title="spur dBc → $A_t$（本頁執行的程式碼；正向的 spurDbc 在 §8）" />

      <h3>最少要有的 DfT：六個暫存器／測試模式</h3>
      <p>
        沒有這六項，上表每一列在矽上都做不到；它們都只是暫存器位元與多工器，面積可以忽略。飽和計數器 <code>sat_cnt</code>、<code>lock_det</code>／<code>cal_en</code> 的腳位已在上表第 4、5 列。
      </p>
      <div className="so-dft">
        {dft.map((d) => (
          <div className="so-dft-item" key={d.id} data-dft={d.id}>
            <h4>
              <PlanText text={d.title} />
              <code>{d.reg}</code>
            </h4>
            <p>
              <PlanText text={d.body} />
            </p>
          </div>
        ))}
      </div>
      <p className="small muted">
        SSPLL 的 GOS／PHOS 兩參數版本（每一相各做一次、<Tex>{'\\hat{\\mathbf J}'}</Tex> 的四個元素）見 §2.5 與 <ChRef ch="07b">案例頁</ChRef>；量測迴圈同上，只是 <code>w_force</code> 與 <code>phase_force</code> 要一起用。
      </p>
    </Section>
  )
}
