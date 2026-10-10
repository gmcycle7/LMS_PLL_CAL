import type { ReactNode } from 'react'
import { Callout, Tex } from '@/components'
import { SPEC_15_3_EXAMPLE } from '@/simulation/models/blockLms'
import { ChLink, ErratumNote, md } from '../common'

interface ParamRow {
  key: string
  meaning: ReactNode
  unit: string
  range: ReactNode
  /** §15.3 範例值（擴充欄位為 null） */
  spec: unknown
  note?: ReactNode
}

const S = SPEC_15_3_EXAMPLE as unknown as Record<string, unknown>

const ROWS: ParamRow[] = [
  { key: 'model', meaning: '模型名稱（固定）', unit: '—', range: "'sign_error_block_lms'", spec: S.model },
  { key: 'seed', meaning: '亂數種子：code pattern、comparator noise、stochastic rounding 各自 fork', unit: '—', range: md('$0\\ldots2^{32}-1$ 的整數'), spec: S.seed },
  { key: 'units', meaning: '單位宣告（只接受 fs / Hz）', unit: '—', range: "{ time: 'fs', frequency: 'Hz' }", spec: S.units },
  { key: 'sample_rate_hz', meaning: <>comparator / code 取樣率 <Tex>{'f_s'}</Tex>；只用來換算 <Tex>{'f_u=f_s/N'}</Tex> 與頻寬</>, unit: 'Hz', range: md('$>0$'), spec: S.sample_rate_hz },
  {
    key: 'output_frequency_hz',
    meaning: <>PLL 輸出頻率 <Tex>{'f_\\mathrm{out}'}</Tex></>,
    unit: 'Hz',
    range: md('$>0$'),
    spec: S.output_frequency_hz,
    note: '本站 L1/L2 模擬只記錄、不使用（fs 與 rad 的換算、spur dBc 在 Ch12）',
  },
  { key: 'gm_accum_samples', meaning: <>GMAC block 長度 <Tex>{'N'}</Tex></>, unit: 'samples', range: md('$1\\ldots2^{20}$ 的整數；$N\\times\\text{num\\_blocks}\\le2^{28}$'), spec: S.gm_accum_samples },
  { key: 'gain_initial', meaning: <>初始 gain <Tex>{'w_0'}</Tex></>, unit: 'fs / unit code', range: '有限數', spec: S.gain_initial },
  { key: 'gain_true', meaning: <>DUT 的真實 gain <Tex>{'a'}</Tex>（行為參數）</>, unit: 'fs / unit code', range: '有限數', spec: S.gain_true },
  {
    key: 'gain_step',
    meaning: <>learning rate <Tex>{'\\mu'}</Tex></>,
    unit: 'fs（average）',
    range: md('有限數（$\\mu\\le0$ 會發出警告）'),
    spec: S.gain_step,
    note: <>{md('單位依 gm_mode：average 為 fs，sum 為 fs per unit $S$')} <ErratumNote id="E13" /></>,
  },
  {
    key: 'code_normalization',
    meaning: 'code 正規化：none / zero_mean / unit_rms / standardize',
    unit: '—',
    range: "四選一（'standardize' 為本站擴充）",
    spec: S.code_normalization,
    note: 'unit_rms 只除 RMS、不減平均（保留 §11.1 的 offset 效應）；統計取自整段 record（非因果）',
  },
  { key: 'gm_mode', meaning: md('GMAC 輸出：average（除以 $N$）或 sum'), unit: '—', range: "'average' | 'sum'", spec: S.gm_mode, note: <>{md('sum 時有效增益乘上 $N$')} <ErratumNote id="E18" /></> },
  { key: 'pd_noise_rms_fs', meaning: <>comparator 前 Gaussian 雜訊 RMS <Tex>{'\\sigma_v'}</Tex></>, unit: 'fs', range: md('$\\ge0$（$0$ 時 $K_q$ 無定義）'), spec: S.pd_noise_rms_fs },
  { key: 'comparator_offset_fs', meaning: <>comparator offset <Tex>{'b'}</Tex></>, unit: 'fs', range: '有限數', spec: S.comparator_offset_fs, note: <>是否造成 gain bias 依架構而定 <ErratumNote id="E03" /></> },
  {
    key: 'comparator_encoding',
    meaning: md('$q$ 的編碼：bipolar_pm_one、unipolar_mapped（0/1 先映射成 $q=2b-1$）、unipolar_unmapped_bug（反面測試）'),
    unit: '—',
    range: '三選一',
    spec: S.comparator_encoding,
    note: <>{md('tie：$e\\ge0\\Rightarrow q=+1$')} <ErratumNote id="E07" /></>,
  },
  { key: 'gm_code_delay_samples', meaning: <>GMAC code 對齊延遲 <Tex>{'D'}</Tex>（regressor_mode 不是 raw 才生效）</>, unit: 'samples', range: md('$0\\ldots65536$ 的整數'), spec: S.gm_code_delay_samples, note: <><ErratumNote id="E34" />{md('（§16.1 原文寫 $d$）')}</> },
  { key: 'cal_update_delay_blocks', meaning: <>gain commit 延遲 <Tex>{'d'}</Tex></>, unit: 'blocks', range: md('$0\\ldots64$ 的整數'), spec: S.cal_update_delay_blocks },
  {
    key: 'pll_error_path',
    meaning: md('PD error path $H_\\mathrm{PD}$：identity / single_tone / fir / first_order_hp / type2_dt / iir'),
    unit: '—',
    range: 'kind + parameters（snake_case，見 pll.ts）',
    spec: S.pll_error_path,
    note: '狀態跨 block 持續；IIR 不穩定時警告',
  },
  {
    key: 'seeded_pattern',
    meaning: 'code 產生器：iid_pm_one / gaussian（可 AR(1)）/ uniform / sinusoid / dsm_first_order / mash111',
    unit: '—',
    range: 'kind + parameters',
    spec: S.seeded_pattern,
    note: <>1.34 之類的期望值必須連同分布一起寫 <ErratumNote id="E11" /></>,
  },
  {
    key: 'gain_register',
    meaning: 'internal_bits、physical_bits、rounding（nearest / truncate / stochastic）、overflow（saturate / wrap）',
    unit: 'bits',
    range: md('internal_bits $\\ge$ physical_bits；分別為 $1\\ldots48$、$1\\ldots24$'),
    spec: S.gain_register,
    note: <>擴充：quantize_physical（預設 false，§15.3「只有量化實驗開啟時才生效」）、lsb_fs（預設 0.125 fs）、signed <ErratumNote id="E13" /></>,
  },
  { key: 'mode', meaning: '自由字串（exploratory / sweep …）', unit: '—', range: '最多 64 字元', spec: S.mode },
  { key: 'num_blocks', meaning: md('模擬的 block 數 $K$（擴充）'), unit: 'blocks', range: md('$1\\ldots10^{6}$ 的整數'), spec: null },
  { key: 'regressor_mode', meaning: md('$x_\\mathrm{ref}$ 的取法：raw / delayed / filtered（擴充）'), unit: '—', range: '三選一', spec: null, note: md('raw 時忽略 $D$ 並警告') },
  { key: 'filtered_x_model', meaning: <>filtered-x 的 <Tex>{'\\hat H=\\text{gain}\\cdot H_\\text{model}\\cdot z^{-\\text{extra}}'}</Tex>（擴充）</>, unit: '—', range: 'path、gain_mismatch、extra_delay_samples', spec: null, note: <><Tex>{'\\hat H\\ne H'}</Tex> 時用 <Tex>{'E[u\\,u_f]'}</Tex> <ErratumNote id="E45" /></> },
  { key: 'dtc_nonlinearity', meaning: <>正規化 code 上的 <Tex>{'o+c_2x^2+c_3x^3'}</Tex>（擴充）</>, unit: 'fs', range: '有限數', spec: null },
  { key: 'record', meaning: 'trace 紀錄：sample_trace_blocks、decimate（擴充）', unit: '—', range: md('trace 點數 $\\le2^{21}$'), spec: null },
]

function showSpec(v: unknown): string {
  if (v === null) return '（擴充欄位）'
  return typeof v === 'string' ? `'${v}'` : JSON.stringify(v)
}

/** §5 §15.3 參數表 */
export function S5Params() {
  return (
    <section aria-labelledby="models-s5">
      <h2 id="models-s5">5｜§15.3 參數 JSON：每個欄位的意義、單位與合法範圍</h2>
      <p>
        規格 §15.3 的 JSON 是「示意 API」。本站用 zod schema（<code>BlockLmsConfigSchema</code>）把它變成真正會檢查的合約：缺的欄位用預設值補齊、範圍不對就用繁體中文指出「哪個欄位、為什麼」。下表的「§15.3 值」直接讀自程式中的{' '}
        <code>SPEC_15_3_EXAMPLE</code>。
      </p>
      <div className="table-wrap">
        <table className="models-table models-params">
          <thead>
            <tr>
              <th>欄位</th>
              <th>意義</th>
              <th>單位</th>
              <th>合法範圍</th>
              <th>§15.3 值</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className={r.spec === null ? 'models-ext' : undefined}>
                <td>
                  <code>{r.key}</code>
                </td>
                <td>{r.meaning}</td>
                <td className="nowrap">{r.unit}</td>
                <td className="small">{r.range}</td>
                <td>
                  <code className="models-json-val">{showSpec(r.spec)}</code>
                </td>
                <td className="small">{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="physical_bits = 6 什麼時候生效？">
        規格說「<code>physical_bits=6</code> 只有在量化實驗開啟時真正生效」。本站把這個開關明確化為 <code>gain_register.quantize_physical</code>（預設 false）：false 時 <Tex>{'w'}</Tex> 是理想浮點、位元設定完全不作用（模型層級 L1/L2）；true
        時內部暫存器有 <Tex>{'F=\\text{internal\\_bits}-\\text{physical\\_bits}'}</Tex> 個小數 bit、DTC 只看到 physical_bits 的整數 code 乘上 lsb_fs（模型層級 L5）。
      </Callout>
      <Callout kind="warn" title="不要把完整 PLL 硬塞進 L1 的 JSON">
        規格 §15.3 最後一句：對更完整的 PLL，應該<strong>另外增加</strong>下列參數，而不是把它們塞進這個簡化模型。本站的狀態如下（誠實標示）：
        <ul className="models-tight">
          <li>
            <Tex>{'f_\\mathrm{ref}'}</Tex> 與平均 divider <Tex>{'N_\\mathrm{div}=N_\\mathrm{int}+\\mathrm{frac}'}</Tex>：本模型假設 <Tex>{'f_s=f_\\mathrm{ref}'}</Tex>，只有{' '}
            <code>seeded_pattern</code> 的 <code>frac</code>（DSM 輸入）；多速率未實作。
          </li>
          <li>
            DSM 架構：<code>dsm_first_order</code>、<code>mash111</code> 兩種（dsm.ts）；其他架構未實作。
          </li>
          <li>
            DTC INL：只有 <code>dtc_nonlinearity</code> 的 <Tex>{'o+c_2x^2+c_3x^3'}</Tex>；查表 INL 在 dtc.ts（<code>inlLutFs</code>），JSON Lab 沒有接上。
          </li>
          <li>
            BBPD 觀測路徑：以線性化的 <code>pll_error_path</code> 代表；非線性 BBPD 主迴路（DC 由迴路歸零）未實作 <ErratumNote id="E03" />。
          </li>
          <li>
            PVT mode、injection mode：未實作（<ChLink to="/roadmap">Research Backlog</ChLink>）。
          </li>
        </ul>
      </Callout>
    </section>
  )
}
