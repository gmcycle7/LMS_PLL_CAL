import { useMemo } from 'react'
import { Callout, FormulaLink, JumpTo, ModeGate, StepDerivation, Tex } from '@/components'
import { cAbs, type Complex } from '@/simulation/core/complex'
import { W1, analyseAlpha, loopT, makeL2, phosSteadyState, residualLineSpectrum, spurDbcFromToneFs } from '@/simulation/models/sspll'
import { FREF_MHZ, LOOPS, PARAMS, PRED, SIM_CFG } from '../data'
import { Claim, DataTable, Diagram, Formula, Hand, Src, fx, r, tx, txs } from '../common'

/** 插圖頻道：§10.5 的 L2、α = 0.02（80 MHz，帶內）；校準用一階差分收斂到的 PHOS rms 與 |GOS 誤差|（golden，pred_vs_sim.json） */
export const OUTPUT_EXAMPLE = { alpha: 0.02, key1diff: 'L2|0.02|1diff', keyFx: 'L2|0.02|fx:exact', keyRaw137: 'L2|0.137|raw', keyRaw02: 'L2|0.02|raw' } as const

/** 插圖值：VCO 16 GHz（Δ = T_vco/8 = 7.8125 ps） */
export const F_VCO_HZ = PARAMS.assumptions.f_vco_Hz_illustrative

/** 把全部殘差放在 mode 1（與它的共軛 mode 7）的 δ_k：rms = δ_rms、|δ̂_1| = δ_rms/√2（HC-CS.9 的「最壞單一 tone」情況） */
export function pureMode1(rmsFs: number): number[] {
  return Array.from({ length: 8 }, (_, k) => Math.SQRT2 * rmsFs * Math.cos((2 * Math.PI * k) / 8))
}

/** PVT 角落（loop gain ×g，K_p 與 K_i 同時乘 g；§6.5／params.json sensitivity 的定義）：|T| 在 80 MHz 與 548 MHz，以及相對標稱的 spur 位移 [dB] */
export function pvtCornerTable(gains: number[] = [0.6, 0.8, 1, 1.25, 1.5]): { g: number; t80: number; t548: number; d80Db: number; d548Db: number; peakDb: number }[] {
  const Kp = Number(LOOPS.L2.params.Kp)
  const Ki = Number(LOOPS.L2.params.Ki)
  const nom = makeL2({ Kp, Ki })
  const t80n = cAbs(loopT(nom, 0.02))
  const t548n = cAbs(loopT(nom, 0.137))
  return gains.map((g) => {
    const lp = makeL2({ Kp: g * Kp, Ki: g * Ki })
    const t80 = cAbs(loopT(lp, 0.02))
    const t548 = cAbs(loopT(lp, 0.137))
    let peak = 0
    for (let i = 1; i <= 4000; i++) peak = Math.max(peak, cAbs(loopT(lp, (0.5 * i) / 4000)))
    return { g, t80, t548, d80Db: 20 * Math.log10(t80 / t80n), d548Db: 20 * Math.log10(t548 / t548n), peakDb: 20 * Math.log10(peak) }
  })
}

/** raw one-hot regressor 的 circulant 共變異數列 c[d]（8 個相位被選到的次數一樣多）：[1/8, 0, …] */
export const REG_COV_RAW = [1 / 8, 0, 0, 0, 0, 0, 0, 0]
/** 一階差分、α < 1/8：c[0] = 2α、c[±1] = −α（每 1/(8α) 拍換一相：r_k 只在進入與離開那一相時非零） */
export function regCov1diff(alpha: number): number[] {
  return [2 * alpha, -alpha, 0, 0, 0, 0, 0, -alpha]
}

/** F-CS.23 在實驗 C 預設設定下的數字：σ_v = 200 fs、N = 512、N_τ = 25；raw 的 μ_p = 8/(N_τ K_q)，1diff 再對功率 2α 正規化 */
export function steadyNumbers() {
  const sig = SIM_CFG.sigmaPs
  const N = 512
  const tau = 25
  const kq = Math.sqrt(2 / Math.PI) / sig
  const muRaw = 8 / (tau * kq)
  const one: Complex[] = Array.from({ length: 7 }, () => ({ re: 1, im: 0 }))
  const kappa1 = phosSteadyState(one, muRaw, sig, N, REG_COV_RAW)
  const raw137 = phosSteadyState(analyseAlpha(LOOPS.L2, 0.137, 'raw', undefined, 2048).kappaM, muRaw, sig, N, REG_COV_RAW)
  const a = OUTPUT_EXAMPLE.alpha
  const mu1d = (muRaw * (1 / 8)) / (2 * a)
  const diff02 = phosSteadyState(analyseAlpha(LOOPS.L2, a, '1diff', undefined, 2048).kappaM, mu1d, sig, N, regCov1diff(a))
  // 小步長閉合式：σ²_{θ,m} = πσ_v²/(4 N N_τ Re κ)（κ = 1）
  const closedFs = 1000 * Math.sqrt((Math.PI * sig * sig) / (4 * N * tau))
  return { sig, N, tau, kq, muRaw, mu1d, kappa1, raw137, diff02, closedFs }
}

/** 「variance 條件」：mode-1 的雜訊 spur 要低於 spurDbc，σ_{θ,1} 不能超過多少、N·N_τ 至少要多少（raw、κ = 1、|T| 取 tMag） */
export function varianceCondition(spurDbc: number, tMag: number, fVcoHz = F_VCO_HZ, sigmaPs = SIM_CFG.sigmaPs, reKappa = 1): { sigmaMaxFs: number; nnTau: number } {
  const aOutFs = (2 * 10 ** (spurDbc / 20)) / (2 * Math.PI * fVcoHz * 1e-15)
  const sigmaMaxFs = aOutFs / (tMag * 2 * Math.sqrt(W1))
  const nnTau = (Math.PI * sigmaPs * sigmaPs) / (4 * reKappa * (sigmaMaxFs / 1000) ** 2)
  return { sigmaMaxFs, nnTau }
}

/** §15.4 校準完之後：殘餘 PHOS／GOS → 輸出 spur／jitter（閉合式、PVT 角落、穩態權重雜訊、HC-CS.9） */
export function S15Output() {
  const g1d = PRED.lms[OUTPUT_EXAMPLE.key1diff]
  const gfx = PRED.lms[OUTPUT_EXAMPLE.keyFx]
  const g137 = PRED.lms[OUTPUT_EXAMPLE.keyRaw137]
  const gRaw = PRED.lms[OUTPUT_EXAMPLE.keyRaw02]
  const num = useMemo(() => {
    const rms = g1d.final_phos_rms_fs
    // 單線表（F-CS.21／22 的字面意思：α 當成無理數）：全部殘差放在 mode 1、GOS 取 golden 的最終值
    const lines = residualLineSpectrum({ deltaFs: pureMode1(rms), gosErrFs: g1d.final_gos_fs, alpha: OUTPUT_EXAMPLE.alpha, loop: LOOPS.L2, fVcoHz: F_VCO_HZ, singleLines: true, lMax: 64, mMax: 64 })
    const t80 = cAbs(loopT(LOOPS.L2, OUTPUT_EXAMPLE.alpha))
    const main = lines.lines[0]
    const corners = pvtCornerTable()
    const st = steadyNumbers()
    const cond = varianceCondition(-80, t80)
    const sigma1 = 1000 * Math.sqrt(st.kappa1.varModePs2[0])
    const noiseSpur80 = spurDbcFromToneFs(F_VCO_HZ, 2 * Math.sqrt(W1) * sigma1 * t80)
    // raw 的「發散值」（§10.5 golden：28 ps）代進同一條單線公式得到的輸出相位峰值 Φ [rad]——遠超過小角 PM 的範圍
    const phiRaw = residualLineSpectrum({ deltaFs: pureMode1(gRaw.final_phos_rms_fs), gosErrFs: gRaw.final_gos_fs, alpha: OUTPUT_EXAMPLE.alpha, loop: LOOPS.L2, fVcoHz: F_VCO_HZ, singleLines: true, lMax: 8, mMax: 1 }).lines[0].betaRad
    const kappa1Re = analyseAlpha(LOOPS.L2, OUTPUT_EXAMPLE.alpha, '1diff', undefined, 2048).kappaM[0].re
    return { rms, lines, t80, main, corners, st, cond, sigma1, noiseSpur80, phiRaw, kappa1Re, spurPvtMax: Math.max(...corners.map((c) => c.d80Db)) }
  }, [g1d, gRaw])
  const L = num.lines
  return (
    <>
      <h3 id="cs-15-4">15.4 校準完之後：殘餘誤差 → 輸出 spur／jitter</h3>
      <p>
        §10.5 的表只說「收斂到 {fx(g1d.final_phos_rms_fs, 1)} fs」、「發散到 28 ps」，可是 sign-off 時量的不是 GMAC 歸零，而是 PLL 輸出的 spur 與 phase noise（Sign-off 頁第 7 列）。這一小節把校準停下來之後還留著的 PHOS 殘差{' '}
        <Tex>{r`\delta_k=\varepsilon_k-w_k`}</Tex> 與 GOS 殘差換成輸出端的數字：每條 fractional spur 幾 dBc、積分 jitter 幾 fs。做法只有三步：先把殘差拆成譜線（§7、§8 已經拆過一次，那時是為了算 <Tex>{'C'}</Tex>），每條線乘上主迴路的閉迴路響應{' '}
        <Tex>{r`\lvert T(f)\rvert`}</Tex>（<Tex>{r`T=1-H_{PD}`}</Tex>，F-CS.1），再用 <FormulaLink id="F-12.16" /> 把時間誤差換成輸出相位。
      </p>
      <Diagram id="output-spur" />
      <p>
        先看左上到右下的主線：PHOS 殘差（8 個數）經 8 點 DFT 變成 8 個模態 <Tex>{r`\hat\delta_m`}</Tex>，每個模態不是一條線而是一串——mode 1 的 regressor 是「PMUX 以 <Tex>{r`\alpha f_{ref}`}</Tex> 旋轉」這件事本身，§8 說過它是 8 階的階梯弦波，基波{' '}
        <Tex>{r`\ell=1`}</Tex> 占 {fx(W1 * 100, 0)}%，其餘散在 <Tex>{r`\ell=-7,9,-15,\dots`}</Tex>（頻率 <Tex>{r`\mathrm{frac}(\ell\alpha)f_{ref}`}</Tex>）。再看左下的 GOS 支線：鋸齒 <Tex>{r`\rho[n]`}</Tex> 的諧波（§7.1）。所有線匯到藍色那一格乘上 <Tex>{r`\lvert T(f)\rvert`}</Tex>：帶內（{fx(PARAMS.assumptions.closed_loop_3dB_Hz / 1e6, 0)} MHz 以內）幾乎原樣通過，帶緣還有{' '}
        {fx(PARAMS.loops.L2.T_peak_dB, 2)} dB 的 peaking，帶外才衰減。最後兩格就是儀器上看到的量：一根根 spur，和把所有線加起來的積分 jitter。
      </p>
      <StepDerivation
        title="PHOS：從 8 個殘差到每一根 spur"
        steps={[
          {
            tex: r`e[n]=\textstyle\sum_k\delta_k\,\mathbf 1\{p[n]=k\}=\sum_{m=0}^{7}\hat\delta_m\,e^{j2\pi m\,p[n]/8},\qquad \hat\delta_m=\tfrac18\sum_k\delta_k\,e^{-j2\pi mk/8}`,
            why: <>凍結後注入點的 PHOS 誤差：第 <Tex>{'n'}</Tex> 拍選到哪一相就輸出那一相的殘差。把 <Tex>{r`\delta_k`}</Tex> 換成它的 8 點 DFT（反變換 <Tex>{r`\delta_k=\sum_m\hat\delta_m e^{j2\pi mk/8}`}</Tex> 代進去），one-hot 的和就變成「相位索引的複數弦波」。Parseval：<Tex>{r`\sum_{m\ne0}\lvert\hat\delta_m\rvert^2=\tfrac18\sum_k(\delta_k-\bar\delta)^2`}</Tex>，就是 §10.5 表中 PHOS rms 的平方。</>,
          },
          {
            tex: r`e^{j2\pi m\,p[n]/8}=\textstyle\sum_{\ell\equiv m\,(8)}b_\ell\,e^{j2\pi\ell\varphi[n]}=\sum_{\ell\equiv m}b_\ell\,e^{j2\pi\ell\alpha n},\qquad b_\ell=\frac{8\,(1-e^{-j2\pi\ell/8})}{j2\pi\ell},\quad \lvert b_\ell\rvert^2=\frac{64\sin^2(\pi\ell/8)}{\pi^2\ell^2}=w_\ell`,
            why: <>階梯弦波對 <Tex>{r`\varphi`}</Tex> 展開：§8.1 第 1 步的 one-hot Fourier 係數 <Tex>{r`a_\ell`}</Tex> 乘上 <Tex>{r`e^{j2\pi mk/8}`}</Tex> 對 <Tex>{'k'}</Tex> 加總，只有 <Tex>{r`\ell\equiv m\pmod 8`}</Tex> 留下來（和 §8.1 第 3 步同一個篩選）。<Tex>{r`\varphi[n]=\mathrm{frac}(n\alpha)`}</Tex>，整數部分不影響 <Tex>{r`e^{j2\pi\ell\varphi}`}</Tex>，所以第 <Tex>{r`\ell`}</Tex> 條線的頻率就是 <Tex>{r`\ell\alpha`}</Tex>（取樣後折到 <Tex>{r`[0,\tfrac12]`}</Tex>）。權重 <Tex>{r`w_\ell`}</Tex> 就是 F-CS.13 的那一組，<Tex>{r`\sum_{\ell\equiv m}w_\ell=1`}</Tex>。</>,
          },
          {
            tex: r`A_\ell=2\,\lvert\hat\delta_m\rvert\sqrt{w_\ell}\ \ \text{在}\ f_\ell=\mathrm{frac}(\ell\alpha)\,f_{ref}\qquad(\ell>0,\ m=\ell\bmod8)`,
            why: <>實數訊號的線成對出現：<Tex>{r`\ell`}</Tex> 與 <Tex>{r`-\ell`}</Tex>（屬於共軛的模態 <Tex>{'8-m'}</Tex>）合成一條振幅 <Tex>{r`2\lvert\hat\delta_m b_\ell\rvert`}</Tex> 的餘弦。<Tex>{r`\ell=1`}</Tex> 那條就是 PMUX 的旋轉頻率 <Tex>{r`f_{rot}`}</Tex>，振幅 <Tex>{`2\\sqrt{W_1}\\,\\lvert\\hat\\delta_1\\rvert=${tx(2 * Math.sqrt(W1), 4)}\\,\\lvert\\hat\\delta_1\\rvert`}</Tex>。</>,
          },
          {
            tex: r`A_{out,\ell}=\lvert T(f_\ell)\rvert\,A_\ell,\qquad \Phi_\ell=2\pi f_{vco}\,A_{out,\ell},\qquad \mathrm{spur}_\ell\approx20\log_{10}\frac{\Phi_\ell}{2}\ \ [\mathrm{dBc}]`,
            why: <>注入點的時間誤差通過閉迴路響應 <Tex>{r`T=L/(1+L)`}</Tex> 才到 VCO（輸出的修正量 <Tex>{'y=u-e_{PD}'}</Tex>，§3）；輸出相位 <Tex>{r`\phi_{out}=2\pi f_{vco}\,T\,\delta t`}</Tex> 是 <FormulaLink id="F-12.16" />，一條 tone 的峰值相位 <Tex>{r`\Phi`}</Tex> 就是 Ch12 的調變指數（那裡寫 <Tex>{r`\beta`}</Tex>；本頁的 <Tex>{r`\beta`}</Tex> 已經是 <Tex>{r`\mathrm{frac}(8\alpha)`}</Tex>）。小角 PM 的單邊 sideband 是 <Tex>{r`\Phi/2`}</Tex>，T15 的 0.5 fs、13 GHz、<Tex>{r`\lvert T\rvert=1`}</Tex> 給 <Tex>{r`-93.8`}</Tex> dBc 就是同一條式子。</>,
          },
          {
            tex: r`\sigma_{t,out}^2=\textstyle\sum_\ell\frac{A_{out,\ell}^2}{2}\qquad\big(\lvert T\rvert\equiv1\text{ 時 }=\tfrac18\sum_k(\delta_k-\bar\delta)^2=\mathrm{rms}_{PHOS}^2\big)`,
            why: <>積分 jitter：每條線的功率 <Tex>{r`A^2/2`}</Tex> 相加（Parseval）。共模 <Tex>{'m=0'}</Tex> 只有 DC，被迴路當成靜態相位吸收，不算進去。高 <Tex>{r`\ell`}</Tex> 的線折到高頻、<Tex>{r`\lvert T\rvert`}</Tex> 小，所以輸出的 jitter 比注入點的 rms 小一些。</>,
          },
        ]}
      />
      <Formula id="F-CS.21" />
      <p>
        <Claim kind="approx">線性化的 <Tex>{'T'}</Tex>、小角 PM、權重凍結；有理 <Tex>{r`\alpha`}</Tex> 時重合的線要相干相加（實驗 C 用週期序列的精確 Fourier 係數）</Claim>
      </p>
      <p>
        <strong>GOS 走同一條路</strong>：殘餘的增益誤差讓注入點留下 <Tex>{r`(1-\mathrm{gain})\,\Delta\,\rho[n]`}</Tex>（§14 的「GOS 誤差」是它在 <Tex>{r`\rho=1`}</Tex> 時的值），§7.1 已經把鋸齒拆成 <Tex>{r`\tfrac12-\sum_m\sin(2\pi mn\beta)/(\pi m)`}</Tex>：第 <Tex>{'m'}</Tex> 次諧波在 <Tex>{r`\mathrm{frac}(m\beta)f_{ref}`}</Tex>，振幅按{' '}
        <Tex>{'1/m'}</Tex> 遞減，DC 項是靜態相位。
      </p>
      <Formula id="F-CS.22" />
      <p>
        這裡算的都是 <strong>fractional spur</strong>：落在 <Tex>{r`\mathrm{frac}(\ell\alpha)f_{ref}`}</Tex> 與 <Tex>{r`\mathrm{frac}(m\beta)f_{ref}`}</Tex>、隨頻道移動的線。<strong>reference spur</strong>（離載波 <Tex>{r`kf_{ref}=k\times4`}</Tex> GHz，來自 reference feedthrough 與 SSPD 每拍一次的週期性擾動，不隨{' '}
        <Tex>{r`\alpha`}</Tex> 變）是另一回事，不在本頁範圍。
      </p>
      <ModeGate min="engineer">
        <Callout kind="info" title="成立條件（Engineer）">
          <ul>
            <li>
              <Tex>{'T'}</Tex> 是小訊號線性化的閉迴路響應：SSPD 沒有飽和、沒有 cycle slip；§10.5 中 ps 級的「發散值」不能代進來（HC-CS.9 的 validate 會擋：<Tex>{r`\Phi\ge0.3`}</Tex> rad 時小角近似失效，硬體上是 DTC 飽和）。
            </li>
            <li>
              權重凍結（校準停下來之後）。校準還在跑時，權重雜訊讓每條線多一圈很窄的裙邊（頻寬約 <Tex>{r`f_{ref}/(2\pi NN_\tau)`}</Tex>，預設 50 kHz），頻譜儀的 RBW 比它寬，看到的仍是一根 spur；它的大小由下面的 F-CS.23 決定。
            </li>
            <li>
              <Tex>{r`\alpha`}</Tex> 為無理數時每條線各自獨立；有理 <Tex>{r`\alpha=P/Q`}</Tex> 時 <Tex>{r`\ell`}</Tex> 與 <Tex>{r`\ell\pm Q`}</Tex> 的線重合、要相干相加，而且取樣剛好落在 PMUX 相位邊緣上時 one-hot 的 Fourier 級數給的是跳變的中點（<Tex>{r`\alpha=1/50`}</Tex> 時單線公式差到 10%）——實驗 C 對週期序列直接算精確的 Fourier 係數，單線值另外列出對照。
            </li>
            <li>
              <Tex>{r`\lvert T\rvert`}</Tex> 的 peaking 隨 PVT 移動（下面的角落表）；<Tex>{r`f_{vco}=${F_VCO_HZ / 1e9}`}</Tex> GHz、<Tex>{`\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}`}</Tex> fs 是插圖值。
            </li>
          </ul>
        </Callout>
      </ModeGate>
      <p>
        <strong>算一次（L2、<Tex>{r`\alpha=0.02`}</Tex>，80 MHz）。</strong> §10.5 的一階差分收斂到 PHOS rms {fx(num.rms, 1)} fs、<Tex>{r`\lvert`}</Tex>GOS 誤差<Tex>{r`\rvert`}</Tex> {fx(g1d.final_gos_fs, 1)} fs。最壞的情況是殘差全部落在 mode 1（<Tex>{`\\lvert\\hat\\delta_1\\rvert=${tx(num.rms / Math.SQRT2, 3)}`}</Tex> fs），單線公式給下表（<Tex>{r`\alpha`}</Tex> 當成無理數；
        <Tex>{r`\lvert T(80\ \mathrm{MHz})\rvert=`}</Tex> {fx(num.t80, 4)}，帶內還被 peaking 放大）：
      </p>
      <DataTable
        className="cs-num"
        head={['譜線', <><Tex>{'f'}</Tex> [MHz]</>, <>注入點 <Tex>{r`A_\ell`}</Tex> [fs]</>, <Tex key="t">{r`\lvert T(f)\rvert`}</Tex>, <>輸出 <Tex>{r`A_{out}`}</Tex> [fs]</>, 'spur [dBc]']}
        rows={L.lines.slice(0, 7).map((l) => [
          l.source === 'phos' ? `PHOS mode ${l.mode}，$\\ell=${l.ell}$` : `GOS 諧波 $m=${l.mode}$`,
          fx(l.fMHz, 1),
          fx(l.ampPdFs, 3),
          fx(l.tMag, 3),
          fx(l.ampOutFs, 3),
          fx(l.spurDbc, 1),
        ])}
        caption={`單線公式（F-CS.21／F-CS.22）的前 7 條；輸出積分 jitter（全部 ${L.lines.length} 條線）$${tx(L.jitterOutFs, 2)}$ fs，其中 PHOS $${tx(L.jitterOutPhosFs, 2)}$、GOS $${tx(L.jitterOutGosFs, 2)}$ fs；注入點的 rms 是 PHOS $${tx(L.rmsPdPhosFs, 2)}$、GOS $${tx(L.rmsPdGosFs, 2)}$ fs。$\\alpha=1/50$ 其實是有理數：$\\ell=49$、$-47$ 這些高次線會折回 80、240 MHz 與低次線重合（實驗 C 把它們相干相加），這裡依單線公式分開列。數字是插圖值。`}
      />
      <p>
        所以「收斂到 {fx(num.rms, 1)} fs」在 16 GHz 的輸出上是一根約 <strong>{fx(num.main.spurDbc, 0)} dBc</strong> 的 fractional spur（在 <Tex>{r`f_{rot}=80`}</Tex> MHz），其餘的線都低 20 dB 以上；filtered-x 收斂到 {fx(gfx.final_phos_rms_fs, 1)} fs，再低{' '}
        {fx(20 * Math.log10(g1d.final_phos_rms_fs / gfx.final_phos_rms_fs), 1)} dB。對照 raw 的 {fx(gRaw.final_phos_rms_fs / 1000, 0)} ps「發散值」：同一條單線公式給 <Tex>{`\\Phi\\approx${tx(num.phiRaw, 1)}`}</Tex> rad（<Tex>{r`\ge0.3`}</Tex>，小角 PM 早就不成立），而且 {fx(gRaw.final_phos_rms_fs / 1000, 0)} ps 已經超過 DTC 的範圍{' '}
        <Tex>{`\\Delta=${tx(SIM_CFG.deltaPs, 2)}`}</Tex> ps——那不是 spur，是 DTC 飽和。
      </p>
      <p>
        <strong>PVT 把 <Tex>{r`\lvert T\rvert`}</Tex> 搬動。</strong> §6.5 的 loop-gain 角落（<Tex>{r`K_p`}</Tex>、<Tex>{r`K_i`}</Tex> 同乘 <Tex>{r`\times0.6`}</Tex>–<Tex>{r`\times1.5`}</Tex>）在兩個頻道上的 <Tex>{r`\lvert T\rvert`}</Tex>：
      </p>
      <DataTable
        className="cs-num"
        head={['loop gain', <><Tex>{r`\lvert T\rvert`}</Tex> 峰值 [dB]</>, <><Tex>{r`\lvert T(80\ \mathrm{MHz})\rvert`}</Tex></>, 'spur 位移 @80 MHz [dB]', <><Tex>{r`\lvert T(548\ \mathrm{MHz})\rvert`}</Tex></>, 'spur 位移 @548 MHz [dB]']}
        rows={num.corners.map((c) => [`$\\times${c.g}$`, fx(c.peakDb, 2), fx(c.t80, 3), (c.d80Db >= 0 ? '+' : '') + fx(c.d80Db, 2), fx(c.t548, 3), (c.d548Db >= 0 ? '+' : '') + fx(c.d548Db, 2)])}
        caption="帶內頻道（80 MHz）的 spur 只動 ±1 dB（本來就在 peaking 區），帶外頻道（548 MHz）在 gain ×1.5 時被多放進來 3.7 dB：keep-out 與 spur 預算都要用角落的 $\lvert T\rvert$。"
      />
      <p>
        <strong>校準還在跑時的「雜訊 spur」（variance 條件）。</strong> 收斂之後權重不是不動，而是在 <Tex>{r`\pm\sigma_\theta`}</Tex> 內抖（Ch12 §12.1 的 <Tex>{r`\sigma_w`}</Tex>）；PHOS 有 8 個權重，拆成 DFT 模態之後每個模態就是一條 Ch12 的一階遞迴，可以直接套 <FormulaLink id="F-12.4" />：
      </p>
      <StepDerivation
        title="穩態的權重雜訊（逐模態）"
        steps={[
          {
            tex: r`\eta_k=\tfrac1N\textstyle\sum_n q[n]\,r_k[n]-E[\cdot],\qquad \mathrm{cov}(\eta_k,\eta_j)=\tfrac1N\langle r_k r_j\rangle=\tfrac1N\,c[(j-k)\bmod8]`,
            why: <>GMAC 的 block 雜訊：<Tex>{r`q=\pm1`}</Tex>、在 block 內獨立（比較器雜訊主導、<Tex>{r`\lvert e_{PD}\rvert\ll\sigma_v`}</Tex>），所以共變異數只剩 regressor 自己的 <Tex>{r`\langle r_kr_j\rangle`}</Tex>，8 個相位地位相同 → circulant，列 <Tex>{'c[d]'}</Tex>。raw one-hot：<Tex>{r`c=[\tfrac18,0,\dots]`}</Tex>；一階差分（<Tex>{r`\alpha<\tfrac18`}</Tex>）：<Tex>{r`c[0]=2\alpha`}</Tex>、<Tex>{r`c[\pm1]=-\alpha`}</Tex>（只在換相的那一拍非零）。</>,
          },
          {
            tex: r`E\lvert\hat\eta_m\rvert^2=\frac{S_m}{8N},\qquad S_m=\textstyle\sum_{d}c[d]\,e^{-j2\pi md/8}\qquad(\text{raw: }S_m=\tfrac18;\ \text{1diff: }S_m=4\alpha\sin^2\tfrac{\pi m}{8})`,
            why: <>DFT 把 circulant 對角化（§8.1 的同一招）：模態間的雜訊互不相關，每個模態分到 <Tex>{'c'}</Tex> 的 DFT。一階差分把慢的 mode 1 的雜訊壓到 <Tex>{r`4\alpha\sin^2(\pi/8)`}</Tex>——<Tex>{r`\alpha=0.02`}</Tex> 時只有 raw 的 {fx((4 * 0.02 * Math.sin(Math.PI / 8) ** 2) / (1 / 8), 3)} 倍。</>,
          },
          {
            tex: r`\hat\theta_{m,k+1}=p_m\hat\theta_{m,k}+\mu_p\hat\eta_{m,k},\quad p_m=1-\frac{\kappa_m}{N_\tau}\ \Rightarrow\ \sigma^2_{\theta,m}=\frac{\mu_p^2\,S_m/(8N)}{1-\lvert p_m\rvert^2}`,
            why: <>F-CS.18 的遞迴加上雜訊：就是 Ch12 F-12.3／F-12.4 的 <Tex>{r`\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)`}</Tex>，只是極點是複數（<Tex>{r`\lvert p_m\rvert^2=(1-\mathrm{Re}\,\kappa_m/N_\tau)^2+(\mathrm{Im}\,\kappa_m/N_\tau)^2`}</Tex>），而且 Ch12 的 <Tex>{r`K=K_qC`}</Tex> 在這裡是 <Tex>{r`K_q\lambda_m=K_q\kappa_m/8`}</Tex>（<Tex>{r`\lambda_m`}</Tex> 含 one-hot 的功率 <Tex>{r`\tfrac18`}</Tex>）。</>,
          },
          {
            tex: r`\mathrm{rms}^2_{PHOS}=\textstyle\sum_{m=1}^{7}\sigma^2_{\theta,m}\ \xrightarrow{\ \text{raw},\ \kappa/N_\tau\ll1\ }\ \sum_{m=1}^{7}\frac{\pi\sigma_v^2}{4NN_\tau\,\mathrm{Re}\,\kappa_m}`,
            why: <>去共模的 PHOS rms 就是 7 個模態的變異數相加（Parseval）。小步長時 <Tex>{r`1-\lvert p\rvert^2\approx2\mathrm{Re}\,\kappa/N_\tau`}</Tex>，代入 <Tex>{r`\mu_p=8/(N_\tau K_q)`}</Tex>、<Tex>{r`K_q^2=2/(\pi\sigma_v^2)`}</Tex>：每個模態 <Tex>{`\\sigma_\\theta=\\sqrt{\\pi\\sigma_v^2/(4NN_\\tau)}=${tx(num.st.closedFs, 2)}`}</Tex> fs（<Tex>{r`\sigma_v=200`}</Tex> fs、<Tex>{'N=512'}</Tex>、<Tex>{r`N_\tau=25`}</Tex>、<Tex>{r`\kappa=1`}</Tex>），7 個合計 {fx(num.st.kappa1.rmsFs, 1)} fs。雜訊 <Tex>{r`\propto1/\sqrt{NN_\tau}`}</Tex>：平均得越久越小，代價是收斂越慢。</>,
          },
        ]}
      />
      <Formula id="F-CS.23" />
      <p>
        <Claim kind="approx">Bussgang 線性化、<Tex>{r`\hat\eta`}</Tex> 白色；只在 <Tex>{r`\lvert p_m\rvert<1`}</Tex> 時有穩態</Claim>
        對照 §10.5：raw 在帶外頻道 <Tex>{r`\alpha=0.137`}</Tex> 的預測 rms {fx(num.st.raw137.rmsFs, 1)} fs，golden 6000 blocks 後的最終值 {fx(g137.final_phos_rms_fs, 1)} fs；一階差分在 <Tex>{r`\alpha=0.02`}</Tex>（mode 1 的 <Tex>{r`\mathrm{Re}\,\kappa_1`}</Tex> 只有{' '}
        {fx(num.kappa1Re, 3)}，恢復力弱、抖得多）預測 {fx(num.st.diff02.rmsFs, 1)} fs，golden {fx(g1d.final_phos_rms_fs, 1)} fs。golden 的「最終值」是某一個 block 的一次抽樣，預測的是時間平均；實驗 C 把後半段的平均印出來比對：2000–8000 blocks、4 lanes 時四組設定都差在 1.5% 內（<code>sspll.test.ts</code> 以 2000 blocks、門檻 10% 守住），預設的 1500 blocks、2 lanes 只有十幾個有效樣本，容許 50%。
      </p>
      <p>
        <strong>variance 條件的用法</strong>：mode 1 的雜訊 spur 大約是 <Tex>{`20\\log_{10}(\\pi f_{vco}\\lvert T\\rvert\\cdot2\\sqrt{W_1}\\,\\sigma_{\\theta,1})`}</Tex>——raw、<Tex>{r`\kappa=1`}</Tex>、80 MHz（<Tex>{r`\lvert T\rvert=`}</Tex>
        {fx(num.t80, 3)}）時 <Tex>{`\\sigma_{\\theta,1}=${tx(num.sigma1, 2)}`}</Tex> fs 給 {fx(num.noiseSpur80, 1)} dBc。要把它壓到 <Tex>{'-80'}</Tex> dBc，<Tex>{r`\sigma_{\theta,1}`}</Tex> 不能超過 {fx(num.cond.sigmaMaxFs, 2)} fs，也就是{' '}
        <Tex>{`NN_\\tau\\ge${txs(num.cond.nnTau, 3)}`}</Tex> 拍（預設 <Tex>{'512\\times25=12800'}</Tex> 拍的 {fx(num.cond.nnTau / 12800, 1)} 倍），或者校準完就凍結權重（這時只剩 bias 那一部分：上面的單線表）。這就是 roadmap 的「variance」那一格對本案例的答案；「bias」是凍結後的殘差，「system」是 <Tex>{r`\lvert T\rvert`}</Tex> 把 PD 端的數字搬到輸出端。
      </p>
      <Hand id="HC-CS.9">{r`用 §10.5 的最終 PHOS rms、$f_{vco}=16$ GHz 與 $\lvert T(f_{rot})\rvert$ 算 mode-1 基波的 spur，再看 PVT 的 peaking 最多加幾 dB。`}</Hand>
      <p>
        實驗 C 現在會在模擬結束後把權重凍結、再跑 65,536 拍（128 個 <Tex>{'N=512'}</Tex> 的 block），把輸出 <Tex>{'y=T*u'}</Tex> 做 Welch PSD 與 toneFit，印出每個 case 的 spur 表與積分 jitter——raw 與一階差分並排，就能看到同一個頻道、同一顆比較器，輸出差幾十 dB。
        <JumpTo target="exp-sspll-closed-loop" className="cs-linkbtn">
          回到實驗 C
        </JumpTo>
      </p>
      <Src>
        TS port 的 <code>residualLineSpectrum</code>、<code>phosSteadyState</code>、<code>spurDbcFromToneFs</code>（<code>sspll.ts</code>）與 <code>pred_vs_sim.json</code> 的 <code>lms</code>；PVT 角落用 <code>makeL2</code> 把 <Tex>{r`K_p`}</Tex>、<Tex>{r`K_i`}</Tex> 同乘增益（與 <code>params.json</code> 的 <code>sensitivity</code> 同定義）。<Tex>{`f_{ref}=${FREF_MHZ / 1000}`}</Tex> GHz。
      </Src>
    </>
  )
}
