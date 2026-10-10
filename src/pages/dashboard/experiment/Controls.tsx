import { ModeGate, ParamControl, SelectControl, ToggleControl } from '@/components'
import { PARAM_RANGE, comparatorGain, criticalGain, type ThesisParams } from '../thesisModel'
import { Rich } from '../ui'

const r = PARAM_RANGE
const f = (x: number, d = 4) => Number(x.toPrecision(d)).toString()
/** 標籤 / 提示中的數學一律走 KaTeX（`$…$`），ariaLabel 另給純文字 */
const T = (s: string) => <Rich text={s} />

/**
 * 「六條件體檢」的參數面板（目前選取的 case）。Beginner 只顯示最關鍵的參數；其餘在 Engineer 以上顯示，
 * 隱藏的參數仍使用目前值——三種模式共用同一個計算核心，只改變呈現。
 */
export function ThesisControls({ p, set }: { p: ThesisParams; set: (patch: Partial<ThesisParams>) => void }) {
  const kq = comparatorGain(p.sigmaV)
  return (
    <>
      <fieldset className="dash-ctl-group">
        <legend>Comparator 與 GMAC</legend>
        <ParamControl
          label={T('$\\sigma_v$（comparator 前雜訊 RMS）')}
          ariaLabel="sigma_v（comparator 前雜訊 RMS）"
          value={p.sigmaV}
          onChange={(sigmaV) => set({ sigmaV })}
          min={r.sigmaV[0]}
          max={r.sigmaV[1]}
          log
          unit="fs"
          reg="pd_noise_rms_fs（behavioral）"
          hint={T(`$K_q=\\sqrt{2/\\pi}/\\sigma_v=${f(kq)}\\,\\mathrm{fs^{-1}}$`)}
        />
        <ParamControl
          label={T('$N$（每個 GMAC block 的樣本數）')}
          ariaLabel="N（每個 GMAC block 的樣本數）"
          value={p.N}
          onChange={(N) => set({ N })}
          min={r.N[0]}
          max={r.N[1]}
          log
          integer
          clampOnBlur
          digits={8}
          unit="samples"
          reg="REG_GMAC_N（gm_accum_samples）"
          hint={T('$\\sigma_\\eta^2\\approx P_x/N$')}
        />
        <ParamControl
          label={T('$\\mu$（學習率，average-mode 單位）')}
          ariaLabel="mu（學習率）"
          value={p.mu}
          onChange={(mu) => set({ mu })}
          min={r.mu[0]}
          max={r.mu[1]}
          log
          unit="fs"
          reg="REG_LMS_MU（gain_step）"
          hint={T('$g=\\mu\\,s\\,K_q\\,C$（$s=1$ average、$s=N$ sum）')}
        />
        <ModeGate min="engineer">
          <SelectControl
            label="GMAC 輸出"
            value={p.gmacMode}
            onChange={(gmacMode) => set({ gmacMode })}
            options={[
              // <option> 只能放純文字：公式寫在下面的 hint（KaTeX）
              { value: 'average', label: 'average：block 平均（除以 N）' },
              { value: 'sum', label: 'sum：block 總和（不除以 N，學習率也沒有跟著調整）' },
            ]}
            reg="REG_GMAC_MODE（gm_mode）"
            hint={T('average：$G_k=\\tfrac1N\\sum_n q\\,x$；sum：$G_k=\\sum_n q\\,x$。sum 模式沒有把 $\\mu$ 除以 $N$ 時，等效 $g$ 放大 $N$ 倍（勘誤 E18）')}
          />
          <ParamControl
            label={T('$f_s$（comparator 取樣率）')}
            ariaLabel="f_s（comparator 取樣率）"
            value={p.fsGHz}
            onChange={(fsGHz) => set({ fsGHz })}
            min={r.fsGHz[0]}
            max={r.fsGHz[1]}
            log
            unit="GHz"
            reg="sample_rate_hz"
            hint={T(`$f_u=f_s/N=${f((p.fsGHz * 1e9) / p.N / 1e3)}\\,\\mathrm{kHz}$`)}
          />
        </ModeGate>
      </fieldset>

      <fieldset className="dash-ctl-group">
        <legend>Code 與 PLL error path（單頻 code）</legend>
        <ParamControl
          label={T('$\\phi=\\angle H$（error path 在 code 頻率的相位）')}
          ariaLabel="phi（error path 相位）"
          value={p.phiDeg}
          onChange={(phiDeg) => set({ phiDeg })}
          min={r.phiDeg[0]}
          max={r.phiDeg[1]}
          step={0.1}
          unit="deg"
          reg="pll_error_path.parameters.phase_deg"
          hint={T('$C\\propto\\cos(\\phi+\\Omega D)$')}
        />
        <ModeGate min="engineer">
          <ParamControl
            label={T('$P_x=E[x^2]$（code 功率）')}
            ariaLabel="P_x（code 功率）"
            value={p.Px}
            onChange={(Px) => set({ Px })}
            min={r.Px[0]}
            max={r.Px[1]}
            step={0.01}
            reg="seeded_pattern.parameters.amplitude（code_normalization = none）"
            hint={T(`$x=A\\cos\\Omega n$，$A=\\sqrt{2P_x}=${f(Math.sqrt(2 * p.Px))}$`)}
          />
          <ParamControl
            label={T('$|H|$（error path 在 code 頻率的幅度）')}
            ariaLabel="|H|（error path 幅度）"
            value={p.Hmag}
            onChange={(Hmag) => set({ Hmag })}
            min={r.Hmag[0]}
            max={r.Hmag[1]}
            step={0.01}
            reg="pll_error_path.parameters.magnitude"
          />
          <ParamControl
            label={T('$\\Omega$（code 的離散角頻率）')}
            ariaLabel="Omega（code 角頻率）"
            value={p.omega}
            onChange={(omega) => set({ omega })}
            min={r.omega[0]}
            max={r.omega[1]}
            step={0.0001}
            unit="rad/sample"
            reg="seeded_pattern.parameters.omega"
            hint={T(`$\\pi/6=${f(Math.PI / 6, 6)}$；$\\Omega D=${f((p.omega * p.D * 180) / Math.PI)}^\\circ$`)}
          />
          <ParamControl
            label={T('$D$（GMAC code delay）')}
            ariaLabel="D（GMAC code delay）"
            value={p.D}
            onChange={(D) => set({ D })}
            min={r.D[0]}
            max={r.D[1]}
            integer
            clampOnBlur
            unit="samples"
            reg="REG_GMAC_CODE_DLY（gm_code_delay_samples）"
          />
          <ParamControl
            label={T('$d$（係數 commit 延遲）')}
            ariaLabel="d（係數 commit 延遲）"
            value={p.d}
            onChange={(d) => set({ d })}
            min={r.d[0]}
            max={r.d[1]}
            integer
            clampOnBlur
            unit="blocks"
            reg="REG_CAL_COMMIT_DLY（cal_update_delay_blocks）"
            hint={T(`$g^*=2\\sin\\frac{\\pi}{4d+2}=${f(criticalGain(p.d))}$`)}
          />
        </ModeGate>
      </fieldset>

      <fieldset className="dash-ctl-group">
        <legend>Identifiability（第二個校正參數）</legend>
        <ToggleControl
          label={T('同時校正第二個參數（$2\\times2$ 模型）')}
          ariaLabel="同時校正第二個參數（二乘二模型）"
          value={p.twoParam}
          onChange={(twoParam) => set({ twoParam })}
          hint="例如 gain + offset、或 GOS + PHOS"
          reg="cal_param_count（1 / 2）"
        />
        {p.twoParam && (
          <>
            <ParamControl
              label={T('$\\rho$（兩個 regressor 的相關係數）')}
              ariaLabel="rho（regressor 相關係數）"
              value={p.rho}
              onChange={(rho) => set({ rho })}
              min={r.rho[0]}
              max={r.rho[1]}
              step={0.001}
              reg="regressor_corr_rho（behavioral）"
              hint={T(`$\\tilde\\lambda=1\\pm\\rho=${f(1 + p.rho)},\\ ${f(1 - p.rho)}$`)}
            />
            <ModeGate min="engineer">
              <SelectControl
                label={T('更新矩陣 $\\mathbf M$')}
                ariaLabel="更新矩陣 M"
                value={p.update}
                onChange={(update) => set({ update })}
                options={[
                  // <option> 只能放純文字：公式寫在下面的 hint（KaTeX）
                  { value: 'scalar', label: '一般 LMS（scalar 步長）' },
                  { value: 'precond', label: 'Preconditioned LMS（乘上相關矩陣的反矩陣）' },
                ]}
                reg="REG_CAL_MATRIX_MODE"
                hint={T('一般 LMS：$\\mathbf M=\\mu\\mathbf I$；preconditioned：$\\mathbf M=\\mu\\tilde{\\mathbf R}^{-1}$。$\\tilde{\\mathbf R}^{-1}$ 只消除 regressor 相關，不修正 path 極性')}
              />
            </ModeGate>
          </>
        )}
      </fieldset>

      <fieldset className="dash-ctl-group">
        <legend>Bias</legend>
        <ParamControl
          label={T('$B=E[x\\,\\varepsilon_{\\mathrm{det}}]$（code 相關干擾）')}
          ariaLabel="B（code 相關干擾）"
          value={p.B}
          onChange={(B) => set({ B })}
          min={r.B[0]}
          max={r.B[1]}
          step={0.01}
          unit="fs"
          reg="code_corr_disturbance_fs（behavioral）"
          hint={T('固定點 $w^*=a+B/C$；$B=b\\,E[x]+E[x\\,d(x)]+E[x\\,\\varepsilon_{\\mathrm{cc}}]$（offset、INL、code-correlated 干擾）')}
        />
        <ModeGate min="engineer">
          <ParamControl
            label={T('$w_0-a$（初始 gain 誤差）')}
            ariaLabel="w0 − a（初始 gain 誤差）"
            value={p.w0MinusA}
            onChange={(w0MinusA) => set({ w0MinusA })}
            min={r.w0MinusA[0]}
            max={r.w0MinusA[1]}
            step={0.1}
            unit="fs"
            reg="gain_initial − gain_true"
          />
        </ModeGate>
      </fieldset>

      <ModeGate min="engineer">
        <fieldset className="dash-ctl-group">
          <legend>System-level 預算（illustrative 規格）</legend>
          <ParamControl
            label={T('$\\sigma_{\\delta t,\\max}$（DTC-referred timing error 預算）')}
            ariaLabel="timing error 預算"
            value={p.jitterBudget}
            onChange={(jitterBudget) => set({ jitterBudget })}
            min={r.jitterBudget[0]}
            max={r.jitterBudget[1]}
            log
            unit="fs"
            reg="spec.timing_error_max_fs（illustrative）"
          />
          <ParamControl
            label="Spur 上限"
            ariaLabel="Spur 上限"
            value={p.spurLimit}
            onChange={(spurLimit) => set({ spurLimit })}
            min={r.spurLimit[0]}
            max={r.spurLimit[1]}
            step={0.5}
            unit="dBc"
            reg="spec.spur_limit_dbc（illustrative）"
          />
          <ParamControl
            label={T('$f_{\\mathrm{out}}$（PLL 輸出頻率）')}
            ariaLabel="f_out（PLL 輸出頻率）"
            value={p.foutGHz}
            onChange={(foutGHz) => set({ foutGHz })}
            min={r.foutGHz[0]}
            max={r.foutGHz[1]}
            log
            unit="GHz"
            reg="output_frequency_hz"
          />
          <ParamControl
            label={T('$|T|$（output transfer 在 code 頻率偏移處）')}
            ariaLabel="|T|（output transfer 幅度）"
            value={p.Tmag}
            onChange={(Tmag) => set({ Tmag })}
            min={r.Tmag[0]}
            max={r.Tmag[1]}
            step={0.01}
            reg="pll_output_transfer_mag（behavioral）"
          />
        </fieldset>
      </ModeGate>
    </>
  )
}
