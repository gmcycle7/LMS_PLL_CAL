import type { ReactNode } from 'react'
import { CaseSelector, ParamControl, SelectControl, Tex, type UseCasesResult } from '@/components'
import type { RegressorMode } from '@/simulation/models/filteredX'
import { MAX_BLOCKS, MODE_LABEL, type CodeKind, type LabCase, type LabScenario, type PathKind } from './labState'
import { DEG, fx } from '../util'

const r = String.raw

function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="ch07-controls-group">
      <div className="ch07-controls-title">{title}</div>
      {children}
    </div>
  )
}

export interface LabControlsProps {
  scenario: LabScenario
  setScenario: (patch: Partial<LabScenario>) => void
  cases: UseCasesResult<LabCase>
}

/** Lab 的參數面板：場景（Case 共用）＋目前 Case 的 regressor 設定。每個控制都有精確輸入、單位、範圍與對應的 reg。 */
export function LabControls({ scenario: s, setScenario, cases }: LabControlsProps) {
  const c = cases.active.params
  const set = (patch: Partial<LabCase>) => cases.update(patch)
  const showOmega = s.codeKind === 'sinusoid' || s.pathKind === 'single_tone'
  return (
    <>
      <Group title={<>誤差路徑 <Tex>{'H'}</Tex>（DTC → PD；Case 共用）</>}>
        <SelectControl<PathKind>
          label="誤差路徑模型"
          value={s.pathKind}
          onChange={(pathKind) => setScenario({ pathKind })}
          reg="pll_error_path.kind"
          options={[
            { value: 'single_tone', label: 'single_tone：2-tap FIR，在 Ω 精確給出 |H|e^{jφ}' },
            { value: 'type2_dt', label: 'type2_dt：Type-II DPLL 的 H_PD = 1/(1+L)（E44）' },
            { value: 'identity', label: 'identity：H = 1（code 錯位的反面測試）' },
          ]}
        />
        {s.pathKind === 'single_tone' && (
          <>
            <ParamControl
              label={<Tex>{r`|H(e^{j\Omega})|`}</Tex>}
              ariaLabel="誤差路徑振幅 |H|"
              value={s.mag}
              onChange={(mag) => setScenario({ mag })}
              min={0.05}
              max={2}
              step={0.01}
              reg="pll_error_path.magnitude"
            />
            <ParamControl
              label={<Tex>{r`\phi=\angle H(e^{j\Omega})`}</Tex>}
              ariaLabel="誤差路徑相位 φ"
              value={s.phiDeg}
              onChange={(phiDeg) => setScenario({ phiDeg })}
              min={-180}
              max={180}
              step={1}
              unit="deg"
              reg="pll_error_path.phase_deg"
              hint={<><Tex>{r`\phi<0`}</Tex>：PD 端落後 code（延遲 code 可補償）</>}
            />
          </>
        )}
        {s.pathKind === 'type2_dt' && (
          <>
            <ParamControl
              label={<Tex>{r`\omega_nT_s`}</Tex>}
              ariaLabel="迴路自然頻率 ω_nT_s"
              value={s.wnTs}
              onChange={(wnTs) => setScenario({ wnTs })}
              min={0.005}
              max={0.5}
              log
              unit="rad/sample"
              reg="pll_error_path.wn_ts"
              hint={<><Tex>{r`K_p=2\zeta\omega_nT_s`}</Tex>、<Tex>{r`K_i=(\omega_nT_s)^2`}</Tex>；大於 0.3 時與 CT 原型明顯失準（E44）</>}
            />
            <ParamControl
              label={<Tex>{r`\zeta`}</Tex>}
              ariaLabel="阻尼 ζ"
              value={s.zeta}
              onChange={(zeta) => setScenario({ zeta })}
              min={0.3}
              max={2}
              step={0.01}
              reg="pll_error_path.zeta"
            />
            <ParamControl
              label={<>額外 loop latency <Tex>{'d'}</Tex></>}
              ariaLabel="額外 loop latency d"
              value={s.loopDelay}
              onChange={(loopDelay) => setScenario({ loopDelay })}
              min={0}
              max={8}
              integer
              clampOnBlur
              unit="samples"
              reg="pll_error_path.loop_delay"
            />
          </>
        )}
      </Group>

      <Group title={<>Code <Tex>{'x[n]'}</Tex>（unit power：<Tex>{r`E[x^2]=1`}</Tex>；Case 共用）</>}>
        <SelectControl<CodeKind>
          label="code pattern"
          value={s.codeKind}
          onChange={(codeKind) => setScenario({ codeKind })}
          reg="seeded_pattern.kind"
          options={[
            { value: 'sinusoid', label: 'sinusoid：√2 cos(Ωn)（窄頻 training tone）' },
            { value: 'ar1', label: 'Gaussian AR(1)（可調頻寬的寬頻 code）' },
            { value: 'white_pm_one', label: 'iid ±1（白色）' },
            { value: 'mash111', label: 'MASH 1-1-1 residue（FCW 模擬；能量在高頻）' },
            { value: 'dsm1', label: '一階 DSM residue（FCW 模擬；基頻 frac·f_s 的 sawtooth）' },
          ]}
        />
        {showOmega && (
          <ParamControl
            label={<Tex>{s.codeKind === 'sinusoid' ? r`\Omega\ (\text{code tone})` : r`\Omega_0\ (\text{FIR 設計頻率})`}</Tex>}
            ariaLabel="頻率 Ω"
            value={s.omega}
            onChange={(omega) => setScenario({ omega })}
            min={0.005}
            max={3.1366}
            log
            unit="rad/sample"
            reg={s.codeKind === 'sinusoid' ? 'seeded_pattern.omega' : 'pll_error_path.omega'}
            hint={<><Tex>{`=${fx(s.omega * DEG, 2)}^\\circ/\\text{sample}`}</Tex>；週期 {fx((2 * Math.PI) / s.omega, 1)} samples（限制在 <Tex>{r`0<\Omega<\pi`}</Tex>，E46）</>}
          />
        )}
        {s.codeKind === 'ar1' && (
          <ParamControl
            label={<Tex>{r`\rho_x`}</Tex>}
            ariaLabel="AR(1) 係數"
            value={s.rho}
            onChange={(rho) => setScenario({ rho })}
            min={-0.99}
            max={0.999}
            step={0.001}
            reg="seeded_pattern.ar1"
            hint={<><Tex>{r`R_x[m]=\rho_x^{|m|}`}</Tex>：接近 1 是低通（能量集中在低頻）、0 是白色、負值是高通</>}
          />
        )}
        {(s.codeKind === 'mash111' || s.codeKind === 'dsm1') && (
          <ParamControl
            label="FCW 小數部分"
            value={s.frac}
            onChange={(frac) => setScenario({ frac })}
            min={0.001}
            max={0.999}
            step={0.001}
            reg="seeded_pattern.frac（FCW[19:0]）"
            hint={
              s.codeKind === 'mash111' ? (
                '20-bit MASH 1-1-1，regressor 用 DTC phase residue（standardize；無封閉式 PSD → 只有經驗值）'
              ) : (
                <>
                  20-bit phase accumulator 的 residue（standardize）：sawtooth，基頻 <Tex>{r`\Omega=2\pi\cdot\mathrm{frac}=${fx(2 * Math.PI * Math.min(s.frac, 1 - s.frac), 4)}`}</Tex>{' '}
                  rad/sample、週期約 {fx(1 / Math.min(s.frac, 1 - s.frac), 1)} samples；frac 靠近 0 或 1（near-integer）時 code 很慢
                </>
              )
            }
          />
        )}
      </Group>

      <Group title={<>Regressor（每個 Case 一組；目前編輯 Case {cases.activeId}）</>}>
        <CaseSelector cases={cases} label="比較組（同 seed）" />
        <div className="ch07-mode-switch" role="radiogroup" aria-label="regressor 三模式切換（REG_GMAC_XSEL）">
          {(['raw', 'delayed', 'filtered'] as RegressorMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={c.mode === m}
              className={`btn${c.mode === m ? ' is-active' : ''}`}
              onClick={() => set({ mode: m })}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="ch07-note">
          <span className="mono">REG_GMAC_XSEL[1:0]</span>（示意暫存器名）：raw = <Tex>{'x[n]'}</Tex>；delayed = <Tex>{'x[n-D]'}</Tex>；filtered =
          <Tex>{r`(\hat h*x)[n-D]`}</Tex>
        </p>
        <ParamControl
          label={<><Tex>{'D'}</Tex>（GMAC code 延遲）</>}
          ariaLabel="D（GMAC code 延遲）"
          value={c.D}
          onChange={(D) => set({ D })}
          min={0}
          max={512}
          integer
          clampOnBlur
          unit="samples"
          reg="REG_GMAC_DLY / gm_code_delay_samples"
          disabled={c.mode === 'raw'}
          hint={c.mode === 'raw' ? <>raw-x 不使用 <Tex>{'D'}</Tex></> : c.mode === 'filtered' ? (
              <>
                filtered-x 時 <Tex>{'D'}</Tex> 補的是 <Tex>{r`\hat H`}</Tex> 沒有包含的串聯純延遲；<Tex>{r`\hat H=H`}</Tex> 時應設 <Tex>{'D=0'}</Tex>。<Tex>{r`D\ne0`}</Tex> 時相關是{' '}
                <Tex>{r`C_{f,D}`}</Tex>（F-07.12），可能變小甚至變負
              </>
            ) : <>延遲的是 code（相位 <Tex>{r`+\Omega D`}</Tex>）</>}
        />
        <ParamControl
          label={<Tex>{r`\mu\ (\text{gain\_step})`}</Tex>}
          ariaLabel="learning rate μ"
          value={c.mu}
          onChange={(mu) => set({ mu })}
          min={0.01}
          max={100000}
          log
          unit="fs"
          reg="gain_step（REG_LMS_MU）"
          hint={<>average 模式；<Tex>{r`g=\mu K_qC`}</Tex>，不同模式的 <Tex>{'C'}</Tex> 量級不同時，可各自調 <Tex>{'\\mu'}</Tex> 讓 <Tex>{'g'}</Tex> 相近</>}
        />
        {c.mode === 'filtered' && (
          <>
            <SelectControl<LabCase['hatBase']>
              label={<><Tex>{r`\hat H`}</Tex> 的結構</>}
              ariaLabel="Ĥ 的結構"
              value={c.hatBase}
              onChange={(hatBase) => set({ hatBase })}
              reg="filtered_x_model.path"
              options={[
                { value: 'same', label: '與 H 同結構（可加參數誤差）' },
                { value: 'second_diff', label: '二次差分 (1 − z⁻¹)²/(ω̂_nT_s)²（Type-II 低頻近似）' },
              ]}
            />
            {s.pathKind === 'type2_dt' && (
              <ParamControl
                label={<>頻寬誤差 <Tex>{r`\hat\omega_n/\omega_n-1`}</Tex></>}
                ariaLabel="頻寬誤差"
                value={c.bwErrPct}
                onChange={(bwErrPct) => set({ bwErrPct })}
                min={-80}
                max={300}
                step={1}
                unit="%"
                reg="filtered_x_model.path（模型的頻寬）"
              />
            )}
            {s.pathKind === 'type2_dt' && c.hatBase === 'same' && (
              <ParamControl
                label={<>模型 latency 誤差 <Tex>{r`\Delta d`}</Tex>（<Tex>{r`\hat d=d+\Delta d`}</Tex>）</>}
                ariaLabel="模型 loop latency 誤差"
                value={c.loopDelayErr}
                onChange={(loopDelayErr) => set({ loopDelayErr })}
                min={-s.loopDelay}
                max={8}
                integer
                clampOnBlur
                unit="samples"
                reg="filtered_x_model.path（模型的 loop latency）"
                hint={
                  <>
                    負值 = 模型漏算 loop latency。它在迴路內部，不是串在路徑上的純延遲：白色這類寬頻 code 下加 <Tex>{'D'}</Tex> 只會讓相關變小，不能用 <Tex>{'D'}</Tex>{' '}
                    補回（低通的有色 code 在少數組合下，小的 <Tex>{'D'}</Tex> 能讓相關多幾個百分點，一樣補不回）；單頻 code 時 <Tex>{'D'}</Tex> 只是像 delayed-x 一樣轉那一個頻率的相位
                  </>
                }
              />
            )}
            <ParamControl
              label={<><Tex>{r`\hat H`}</Tex> 額外延遲 <Tex>{r`\Delta`}</Tex>（<Tex>{r`z^{-\Delta}`}</Tex>）</>}
              ariaLabel="Ĥ 額外延遲"
              value={c.extraDelay}
              onChange={(extraDelay) => set({ extraDelay })}
              min={0}
              max={64}
              integer
              clampOnBlur
              unit="samples"
              reg="filtered_x_model.extra_delay_samples"
              hint={<>模型多算的 latency：線性相位誤差 <Tex>{r`\Omega\Delta`}</Tex>（E45 的失效例子）</>}
            />
            <ParamControl
              label={<>相位誤差 <Tex>{r`\Delta\phi`}</Tex>（在 code tone）</>}
              ariaLabel="相位誤差"
              value={c.phaseErrDeg}
              onChange={(phaseErrDeg) => set({ phaseErrDeg })}
              min={-180}
              max={180}
              step={1}
              unit="deg"
              reg="filtered_x_model.path（相位旋轉器）"
              disabled={s.codeKind !== 'sinusoid'}
              hint={s.codeKind === 'sinusoid' ? '2-tap FIR 旋轉器，只在 code 頻率精確' : '只對 sinusoid code 定義；寬頻 code 請改用 latency 誤差'}
            />
            <ParamControl
              label={<>增益誤差 <Tex>{r`|\hat H|/|H|-1`}</Tex></>}
              ariaLabel="增益誤差"
              value={c.gainErrPct}
              onChange={(gainErrPct) => set({ gainErrPct })}
              min={-90}
              max={300}
              step={1}
              unit="%"
              reg="filtered_x_model.gain_mismatch"
              hint={<>只改變 <Tex>{'g'}</Tex> 的大小，不改變極性</>}
            />
          </>
        )}
      </Group>

      <Group title={<>閉迴路 Block Sign-LMS（<code>runBlockLms</code>；Case 共用）</>}>
        <ParamControl label={<><Tex>{'a'}</Tex>（真實 DTC gain）</>} ariaLabel="a（真實 DTC gain）" value={s.a} onChange={(a) => setScenario({ a })} min={-100} max={100} step={0.1} unit="fs" reg="gain_true" />
        <ParamControl label={<><Tex>{'w_0'}</Tex>（初值）</>} ariaLabel="w0（初值）" value={s.w0} onChange={(w0) => setScenario({ w0 })} min={-100} max={100} step={0.1} unit="fs" reg="gain_initial" />
        <ParamControl
          label={<Tex>{r`\sigma_v`}</Tex>}
          ariaLabel="comparator 雜訊 σ_v"
          value={s.sigmaV}
          onChange={(sigmaV) => setScenario({ sigmaV })}
          min={1}
          max={1000}
          log
          unit="fs"
          reg="pd_noise_rms_fs"
          hint={<Tex>{r`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>}
        />
        <ParamControl
          label={<><Tex>{'N'}</Tex>（GMAC 累加長度）</>}
          ariaLabel="N（GMAC 累加長度）"
          value={s.N}
          onChange={(N) => setScenario({ N })}
          min={16}
          max={65536}
          integer
          clampOnBlur
          reg="REG_GMAC_N / gm_accum_samples"
        />
        <ParamControl
          label={<>block 數 <Tex>{'K'}</Tex></>}
          ariaLabel="block 數"
          value={s.blocks}
          onChange={(blocks) => setScenario({ blocks })}
          min={10}
          max={MAX_BLOCKS}
          integer
          clampOnBlur
          reg="num_blocks"
        />
        <ParamControl
          label={<><Tex>{'C'}</Tex> vs <Tex>{'D'}</Tex> 掃描上限</>}
          ariaLabel="C vs D 掃描上限"
          value={s.Dmax}
          onChange={(Dmax) => setScenario({ Dmax })}
          min={4}
          max={1024}
          integer
          clampOnBlur
          unit="samples"
          reg="（分析用）"
        />
      </Group>
    </>
  )
}
