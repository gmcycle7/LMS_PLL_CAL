import { useMemo, useState } from 'react'
import { ClaimTag, ExperimentShell, FormulaLink, ModeGate, ParamControl, SelectControl, Tex, ToggleControl, type MetricRow } from '@/components'
import type { PresetEntry } from '@/data/types'
import { ALL_PRESETS, presetById } from '@/app/presets'
import { experimentName, GALLERY_EXPECTED_KEYS, levelsOf, PREVIEWABLE_EXPERIMENTS } from '../data'
import { checkExpected, perturbMetrics, reliabilityRows } from '../consistency'
import { previewPreset, type PreviewOutcome } from '../previews'
import { acceptHalfWidth, rawToTex, texNum, texToPlain } from '../format'
import { Rich } from '../common'
import { PreviewView } from './PreviewPanel'

export const INSPECTOR_ID = 'gallery-inspector'

const PREVIEWABLE = ALL_PRESETS.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment))
const GALLERY_12 = ALL_PRESETS.filter((p) => p.galleryIndex !== undefined).sort((a, b) => (a.galleryIndex ?? 0) - (b.galleryIndex ?? 0))

/** params 只保留純量（ExperimentShell 的摘要與 JSON 匯出用；陣列與物件放進 preset_json） */
function scalarParams(p: PresetEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { preset_id: p.id, experiment: p.experiment, page: p.page }
  for (const [k, v] of Object.entries(p.params)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v
  }
  out.preset_json = JSON.stringify(p.params)
  return out
}

function optionLabel(p: PresetEntry): string {
  return `${p.galleryIndex !== undefined ? `#${p.galleryIndex} ` : ''}${p.id}`
}

const pctTex = (x: number, sig = 3) => (Number.isFinite(x) ? `${texNum(100 * x, sig)}\\%` : x > 0 ? '+\\infty' : x < 0 ? '-\\infty' : '\\text{—}')

/**
 * Preset Inspector：選一個可預覽的 preset，用真實模型函式重算，並和 preset 的「預期結果」文字逐項比對。
 * 反面測試：把所有重算值乘上 (1 + ε)，確認比對真的會判為 mismatch（規格 §17 末段「模型公式有錯，UI 卻顯示成功」）。
 * 可匯出 JSON（參數 + 重算數值 + 比對結果）、CSV 與 HTML 報告（ExperimentShell 內建）。
 */
export default function Inspector({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [onlyGallery, setOnlyGallery] = useState(false)
  const [tolK, setTolK] = useState(1)
  const [epsPct, setEpsPct] = useState(0)
  const [epsMaxPct, setEpsMaxPct] = useState(10)
  const preset = presetById(selected) ?? GALLERY_12[0] ?? PREVIEWABLE[0]
  const outcome = useMemo(() => (preset ? previewPreset(preset) : null), [preset])
  const result = outcome?.status === 'ok' ? outcome.result : null
  const eps = epsPct / 100
  // 反面測試：顯示與比對用的是乘上 (1 + ε) 之後的值；ε = 0 時就是模型的原始輸出
  const shownMetrics = useMemo(() => (result ? perturbMetrics(result.metrics, eps) : []), [result, eps])
  const shownOutcome: PreviewOutcome | null = useMemo(
    () => (outcome && outcome.status === 'ok' && eps !== 0 ? { ...outcome, result: { ...outcome.result, metrics: shownMetrics } } : outcome),
    [outcome, shownMetrics, eps],
  )
  const check = useMemo(() => (preset && result ? checkExpected(preset, shownMetrics, tolK * 1.001) : null), [preset, result, shownMetrics, tolK])
  // 可靠度一律用「沒有注入誤差」的重算值來算：問的是「若模型錯了 ε，抓不抓得到」
  const reliability = useMemo(() => (preset && result ? reliabilityRows(preset, result.metrics, epsMaxPct / 100, tolK) : []), [preset, result, epsMaxPct, tolK])
  const options = useMemo(
    () => (onlyGallery ? GALLERY_12.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment)) : PREVIEWABLE).map((p) => ({ value: p.id, label: optionLabel(p) })),
    [onlyGallery],
  )
  if (!preset || !outcome || !shownOutcome) return <p className="muted">沒有可檢視的 preset。</p>

  const metricMeta = new Map(shownMetrics.map((m) => [m.key, m]))
  const metrics: MetricRow[] = (check?.rows ?? [])
    .filter((r) => r.required || r.status === 'match')
    .map((r) => {
      const m = metricMeta.get(r.key)
      return {
        name: m ? `$${m.label}$` : r.key,
        value: typeof m?.value === 'number' ? m.value : (m?.value ?? null),
        unit: m?.unit ? `$${m.unit}$` : undefined, // MetricRow.unit 支援 `$...$`（KaTeX）；匯出檔的 unit 欄才用 texToPlain 轉成純文字
        claim: m?.claim,
        analytic: r.hit?.value,
        tolerance: r.hit ? acceptHalfWidth(r.hit, tolK * 1.001, r.required) : undefined,
        toleranceMode: 'abs' as const,
        digits: 9,
        note: r.hit ? `key ${r.key}；「解析值」欄是預期文字中的數字 $${rawToTex(r.hit.raw)}$${r.required ? '（必備）' : ''}` : `key ${r.key}；必備數值，但預期文字中找不到相符的數字`,
      }
    })

  const warnings: string[] = []
  if (outcome.status === 'unsupported') warnings.push(`無法預覽：${outcome.reason}`)
  if (outcome.status === 'error') warnings.push(`模型函式拒絕這組參數：${outcome.message}`)
  if (eps !== 0)
    warnings.push(
      `反面測試進行中：所有重算值已被人為乘上 $(1+\\varepsilon)$，$\\varepsilon=${texNum(epsPct, 6)}\\%$。下方的數字不是模型的真實輸出；把「注入相對誤差」設回 0 即可還原。`,
    )
  if (result) for (const v of result.verdicts) if (v.kind === 'danger' || v.kind === 'warn') warnings.push(`模型判定：${v.text}`)
  if (check?.status === 'mismatch') warnings.push(`重算值與 preset 預期文字不一致：${check.note}${eps === 0 ? '（若模型或預期文字被改動，這裡會先抓到）' : '（這正是注入誤差後應該看到的結果）'}`)
  if (eps !== 0 && check?.status === 'ok')
    warnings.push('注入誤差後仍然全部相符：$\\varepsilon$ 落在每個必備數值的偵測視窗內（文字精度的極限，見下方可靠度表），比對抓不到這麼小的誤差。')

  const lv = levelsOf(preset)
  const level = result?.level ?? lv.levels[0] ?? 'L0'
  const requiredKeys = GALLERY_EXPECTED_KEYS[preset.id] ?? []

  return (
    <ExperimentShell
      id={INSPECTOR_ID}
      title="Preset Inspector：用真實模型函式重算一個 preset"
      level={level}
      claim={result?.claim}
      source={preset.source}
      tests={preset.tests}
      description={
        <>
          目前的 preset 屬於「{experimentName(preset.experiment)}」。Gallery 把它的 <code>params</code> 直接交給 <code>src/simulation/models</code> 的函式重算，再逐項到「預期結果」文字中找相符的數字（判據{' '}
          <FormulaLink id="F-GA.1" />）。
          {requiredKeys.length > 0 ? ` 這個 preset 宣告了 ${requiredKeys.length} 個必備數值，任一個找不到就判 mismatch。` : ' 這個 preset 沒有宣告必備數值，所以只報告找得到的相符數字。'}
        </>
      }
      assumptions={[
        '只呼叫主執行緒負擔得起的純函式（封閉式、短的確定性模擬；每個 preset 數 ms 到約 0.1 s），不跑 Monte Carlo。',
        '預期結果文字由各章作者撰寫；比對只檢查數字，不解讀文字語意。',
        '必備數值清單（GALLERY_EXPECTED_KEYS）只為規格 §19.2 的 12 個 preset 宣告。',
        '可靠度表假設模型的相對誤差 $\\varepsilon$ 在 $[-\\varepsilon_{\\max},\\varepsilon_{\\max}]$ 均勻分布；這是假設，不是量測。',
        ...(result?.notes ?? []),
      ]}
      controls={
        <>
          <SelectControl label="preset" value={preset.id} onChange={(id) => onSelect(id)} options={options} reg="BEH_GALLERY_PRESET_ID" hint={preset.title} />
          <ToggleControl label="只列 §19.2 的 12 個" value={onlyGallery} onChange={setOnlyGallery} hint="其餘為各章自己的 preset" reg="BEH_GALLERY_ONLY_REQUIRED" />
          <ParamControl
            label={<>容差倍數 <Tex>{'k_{\\mathrm{tol}}'}</Tex></>}
            ariaLabel="容差倍數 k_tol"
            value={tolK}
            onChange={setTolK}
            min={0.1}
            max={20}
            step={0.1}
            digits={3}
            unit={String.raw`$\times$ 捨入半寬`}
            reg="BEH_EXPECTED_TOL_K"
            hint="1 = 文字就是重算值的正確捨入；小於 1 更嚴格"
          />
          <ParamControl
            label={<>注入相對誤差 <Tex>{'\\varepsilon'}</Tex></>}
            ariaLabel="注入相對誤差 epsilon（百分比）"
            value={epsPct}
            onChange={setEpsPct}
            min={-50}
            max={50}
            step={0.01}
            digits={6}
            unit="%"
            reg="BEH_INJECT_REL_ERR"
            hint={<>反面測試：所有重算值乘上 <Tex>{'(1+\\varepsilon)'}</Tex>；0 = 模型的真實輸出</>}
          />
          <ParamControl
            label={<>假想誤差範圍 <Tex>{'\\varepsilon_{\\max}'}</Tex></>}
            ariaLabel="假想誤差範圍 epsilon max（百分比）"
            value={epsMaxPct}
            onChange={setEpsMaxPct}
            min={0.01}
            max={100}
            step={0.01}
            digits={4}
            log
            unit="%"
            reg="BEH_ERR_RANGE_MAX"
            hint={<>可靠度表用：<Tex>{'\\varepsilon'}</Tex> 在 <Tex>{'\\pm\\varepsilon_{\\max}'}</Tex> 內均勻分布</>}
          />
        </>
      }
      params={{ ...scalarParams(preset), tolerance_k: tolK, injected_rel_error_pct: epsPct, eps_max_pct: epsMaxPct }}
      units={{ tolerance_k: '× 捨入半寬', injected_rel_error_pct: '%', eps_max_pct: '%' }}
      seed={result?.seed}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: check
          ? { status: check.status, note: `重算值${eps !== 0 ? '（已注入誤差）' : ''} vs preset 預期文字：${check.note}` }
          : { status: 'n/a', note: outcome.status === 'unsupported' ? outcome.reason : '預覽失敗，沒有數值可比對' },
        monteCarlo: { status: 'n/a', note: 'Gallery 預覽只做封閉式或確定性短模擬；Monte Carlo 由原頁面的 worker 執行並與解析值比對。' },
        fixedPoint: { status: 'not-implemented', note: 'Gallery 沒有 RTL bit-true 對照（定點行為見 Ch04 / Ch13 / Models 頁）。' },
      }}
      exportData={() => {
        const rows = new Map((check?.rows ?? []).map((r) => [r.key, r]))
        const rel = new Map(reliability.map((r) => [r.key, r]))
        return {
          key: shownMetrics.map((m) => m.key),
          value: shownMetrics.map((m) => (typeof m.value === 'number' ? m.value : String(m.value))),
          unit: shownMetrics.map((m) => texToPlain(m.unit ? `$${m.unit}$` : '')),
          claim: shownMetrics.map((m) => m.claim),
          expected_text_match: shownMetrics.map((m) => rows.get(m.key)?.hit?.raw ?? ''),
          check: shownMetrics.map((m) => rows.get(m.key)?.status ?? ''),
          required: shownMetrics.map((m) => (rows.get(m.key)?.required ? 'yes' : '')),
          eps_window_lo: shownMetrics.map((m) => rel.get(m.key)?.window.lo ?? ''),
          eps_window_hi: shownMetrics.map((m) => rel.get(m.key)?.window.hi ?? ''),
          p_match_self: shownMetrics.map((m) => rel.get(m.key)?.coverage.self ?? ''),
          p_match_other: shownMetrics.map((m) => rel.get(m.key)?.coverage.other ?? ''),
        }
      }}
      presets={GALLERY_12.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment)).map((p) => ({ name: `#${p.galleryIndex} ${p.title}`, params: { id: p.id }, description: p.description }))}
      onLoadPreset={(p) => {
        const id = (p.params as { id?: unknown }).id
        if (typeof id === 'string') onSelect(id)
      }}
      actions={{
        onReset: () => {
          setTolK(1)
          setEpsPct(0)
          setEpsMaxPct(10)
          onSelect(GALLERY_12.find((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment))?.id ?? PREVIEWABLE[0]?.id ?? '')
        },
      }}
    >
      <div className="gal-inspector-head" data-inspected={preset.id}>
        <strong>
          <Rich text={preset.title} />
        </strong>
        <div className="small muted">
          預期結果（作者撰寫）：
          <Rich text={preset.expected} />
        </div>
      </div>
      <div className="small gal-tryit">
        試試看：
        <ol>
          <li>
            把「注入相對誤差」設成 <Tex>{'1\\%'}</Tex>：必備數值幾乎全部變成 ✗，交叉比對變成 Mismatch。
          </li>
          <li>
            慢慢把它調小（例如 <Tex>{'0.01\\%'}</Tex>）：到某個值以下又全部相符——那就是下表「偵測視窗」的邊界。
          </li>
          <li>
            把「容差倍數」調到 <Tex>{'0.1'}</Tex>：連模型的真實輸出也可能對不上（文字只是四捨五入的結果，不是精確值）。
          </li>
        </ol>
      </div>
      <PreviewView preset={preset} outcome={shownOutcome} tolK={tolK * 1.001} />
      <ModeGate min="engineer" summary="可靠度表（偵測視窗與巧合相符機率，F-GA.2、F-GA.3）">
        {reliability.length > 0 ? (
          <div className="table-wrap">
            <table className="gal-table gal-num-table gal-reliability">
              <caption className="small muted">
                可靠度（<FormulaLink id="F-GA.2" />、<FormulaLink id="F-GA.3" />）：以沒有注入誤差的重算值計算，<Tex>{`\\varepsilon_{\\max}=${texNum(epsMaxPct, 4)}\\%`}</Tex>、<Tex>{`k_{\\mathrm{tol}}=${texNum(tolK, 3)}`}</Tex>
              </caption>
              <thead>
                <tr>
                  <th>必備數值</th>
                  <th>
                    重算值 <Tex>{'\\hat y'}</Tex>
                  </th>
                  <th>
                    文字 <Tex>{'y_{\\mathrm t}'}</Tex>
                  </th>
                  <th>
                    接受半寬 <Tex>{'W'}</Tex>
                  </th>
                  <th>
                    偵測視窗 <Tex>{'\\varepsilon'}</Tex>（視窗外必被抓到）
                  </th>
                  <th>
                    <Tex>{'P'}</Tex>（仍對到原數字）
                  </th>
                  <th>
                    <Tex>{'P'}</Tex>（巧合對到別的數字）
                  </th>
                </tr>
              </thead>
              <tbody>
                {reliability.map((r) => (
                  <tr key={r.key} data-reliability={r.key}>
                    <td>
                      <code className="gal-id">{r.key}</code>
                    </td>
                    <td>
                      <Tex>{texNum(r.value, 9)}</Tex>
                    </td>
                    <td>
                      <Tex>{rawToTex(r.hit.raw)}</Tex>
                    </td>
                    <td>
                      <Tex>{texNum(acceptHalfWidth(r.hit, tolK, true), 3)}</Tex>
                    </td>
                    <td>
                      <Tex>{`[${pctTex(r.window.lo)},\\ ${pctTex(r.window.hi)}]`}</Tex>
                    </td>
                    <td>
                      <Tex>{pctTex(r.coverage.self)}</Tex>
                    </td>
                    <td>
                      <Tex>{pctTex(r.coverage.other)}</Tex>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">這個 preset 沒有宣告必備數值（或目前沒有相符的必備數值），所以沒有可靠度表。</p>
        )}
        <div className="c-tag-row">
          <ClaimTag kind="approx" />
          <span className="small muted">偵測視窗是精確的不等式；兩個機率建立在「誤差均勻分布」的假設上，只用來比較各個數值的檢查強度。</span>
        </div>
      </ModeGate>
    </ExperimentShell>
  )
}
