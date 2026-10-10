import { useMemo, useState, type ReactNode } from 'react'
import { Callout, ClaimTag, CodeCompare, ModeGate, Section, SelectControl, StepDerivation, TestBadge, Tex } from '@/components'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import comparatorSrc from '@/simulation/models/comparator.ts?raw'
import peSrc from '@/simulation/models/pe.ts?raw'
import biasSrc from '@/simulation/models/bias.ts?raw'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import { aliasingWarnings, MUTANTS, pathConfusionCheck, type KeyComparison } from '@/simulation/models/acceptance'
import { ErratumChip, FBlock, M, PassMark, steps, useAcceptance } from '../common'
import { MUTANT_TEXT, NEGATIVE_TESTS, type NegativeTestMeta } from '../data'
import { GOLDEN, GOLDEN_NEGATIVE } from '../golden'
import { fmtNum, fmtNumeric, ratioTex, texNum, texToPlain } from '../format'

/** CodeCompare 需要的章節原始碼（?raw；就是網站實際執行的檔案） */
export const MODEL_SOURCES: Record<string, { src: string; path: string }> = {
  stability: { src: stabilitySrc, path: 'src/simulation/models/stability.ts' },
  calNoise: { src: calNoiseSrc, path: 'src/simulation/models/calNoise.ts' },
  comparator: { src: comparatorSrc, path: 'src/simulation/models/comparator.ts' },
  pe: { src: peSrc, path: 'src/simulation/models/pe.ts' },
  bias: { src: biasSrc, path: 'src/simulation/models/bias.ts' },
  mimo: { src: mimoSrc, path: 'src/simulation/models/mimo.ts' },
  lms: { src: lmsSrc, path: 'src/simulation/models/lms.ts' },
}

interface LiveCell {
  value: ReactNode
  criterion: ReactNode
  pass: boolean | null
}

function keyCell(k: KeyComparison | undefined, unit = ''): LiveCell {
  if (!k) return { value: '—', criterion: '—', pass: null }
  return {
    value: (
      <span className="ver-mono">
        {fmtNumeric(k.actual, 8)}
        {unit}
      </span>
    ),
    criterion: (
      <span className="small">
        golden <span className="ver-mono">{fmtNumeric(k.expected, 8)}</span>（<Tex>{`r=|\\Delta|/b=${ratioTex(k.diff?.worstRatio)}`}</Tex>）
      </span>
    ),
    pass: k.pass,
  }
}

function TestList({ meta }: { meta: NegativeTestMeta }) {
  return (
    <div className="small">
      {meta.ts.map((t) => (
        <div key={t.name}>
          <span className="ver-chip">TS</span> <code>{t.file.replace('src/simulation/models/', '')}</code>：{t.name}
        </div>
      ))}
      {meta.py.map((t) => (
        <div key={t.name}>
          <span className="ver-chip">PY</span> <code>{t.name}</code>
        </div>
      ))}
    </div>
  )
}

/** §V.4 反面測試清單（規格 §17 末段）與 Mutation Lab */
const r = String.raw

export function NegativeTests() {
  const st = useAcceptance()
  const negKey = (key: string) => st.negative.keys.find((k) => k.key === key)
  // 兩個沒有 golden 數值的情境直接呼叫章節模型；模型丟錯時該列顯示「計算失敗」而不是讓整頁壞掉
  const path = useMemo(() => {
    try {
      const rows = pathConfusionCheck()
      const at01 = rows.find((x) => x.nu === 0.1)
      return at01 ? { p01: at01, maxSumErr: Math.max(...rows.map((x) => x.sumErr)), error: null } : { p01: null, maxSumErr: Number.NaN, error: 'pathConfusionCheck 沒有回傳 ν = 0.1 的點' }
    } catch (e) {
      return { p01: null, maxSumErr: Number.NaN, error: e instanceof Error ? e.message : String(e) }
    }
  }, [])
  const alias = useMemo(() => {
    try {
      return { ...aliasingWarnings(), error: null as string | null }
    } catch (e) {
      return { ok: [] as string[], aliased: [] as string[], error: e instanceof Error ? e.message : String(e) }
    }
  }, [])
  const failedCell = (msg: string): LiveCell => ({ value: <span className="ver-fail">計算失敗</span>, criterion: <span className="small">{msg}</span>, pass: false })
  const mutDetected = st.mutants.filter((m) => m.detected).length
  const mutExpected = MUTANTS.filter((m) => m.expectDetected).length
  const mutAllAsExpected = st.mutants.every((m) => m.asExpected)

  const live: Record<string, LiveCell> = {
    'neg-polarity': keyCell(negKey('reversed_polarity_pole')),
    'neg-pe': keyCell(negKey('missing_pe_eig_min')),
    'neg-misalign': keyCell(negKey('misaligned_C_D4_phi0')),
    'neg-scaling': keyCell(negKey('sum_mode_gain_multiplier'), ' ×'),
    'neg-overflow': (() => {
      const a = negKey('gmac_bits_required')
      const b = negKey('gmac_17bit_wrapped_sum')
      return {
        value: (
          <span className="ver-mono">
            需 {fmtNumeric(a?.actual ?? null)} bit；17-bit wrap → {fmtNumeric(b?.actual ?? null)}
          </span>
        ),
        criterion: (
          <span className="small">
            golden <span className="ver-mono">{fmtNumeric(a?.expected ?? null)}</span> bit、<span className="ver-mono">{fmtNumeric(b?.expected ?? null)}</span>（整數：必須完全相等）
          </span>
        ),
        pass: a?.pass === true && b?.pass === true,
      }
    })(),
    'neg-bit': (() => {
      const dc = negKey('wrong_encoding_update_at_truth_dc_code')
      const zm = negKey('wrong_encoding_update_at_truth_zero_mean_code')
      return {
        value: (
          <span className="ver-mono">
            DC code {fmtNumeric(dc?.actual ?? null, 6)}；零均值 {fmtNumeric(zm?.actual ?? null, 3)}
          </span>
        ),
        criterion: (
          <span className="small">
            golden <span className="ver-mono">{fmtNumeric(dc?.expected ?? null, 6)}</span> 與 <span className="ver-mono">{fmtNumeric(zm?.expected ?? null, 3)}</span>（<Tex>{r`E[x]/2`}</Tex>）
          </span>
        ),
        pass: dc?.pass === true && zm?.pass === true,
      }
    })(),
    'neg-path': path.p01
      ? {
          value: (
            <span>
              <Tex>{`|H_{\\rm PD}(j0.1\\omega_n)|=${fmtNum(path.p01.hpdMag, 4)}`}</Tex>，<Tex>{`|T(j0.1\\omega_n)|=${fmtNum(path.p01.tMag, 5)}`}</Tex>
            </span>
          ),
          criterion: (
            <span className="small">
              <Tex>{`|H_{\\rm PD}|<0.011,\\ |T|>1,\\ \\max|H_{\\rm PD}+T-1|=${texNum(path.maxSumErr, 2)}<10^{-12}`}</Tex>
            </span>
          ),
          pass: path.p01.hpdMag < 0.011 && path.p01.tMag > 1 && path.maxSumErr < 1e-12,
        }
      : failedCell(path.error ?? '未知錯誤'),
    'neg-alias': alias.error
      ? failedCell(alias.error)
      : {
      value: (
        <span className="small">
          正常設定 {alias.ok.length} 則警告；<Tex>{r`f_{\rm sim}=0.9\cdot2(f_x+f_w)`}</Tex> 時 {alias.aliased.length} 則
        </span>
      ),
      criterion: <span className="small">正常時不得有警告；aliasing 時必須警告</span>,
      pass: alias.ok.length === 0 && alias.aliased.some((w) => w.includes('alias')),
    },
    'neg-formula': {
      value: (
        <span className="small">
          {mutDetected} / {MUTANTS.length} 個 mutant 被判為不一致
        </span>
      ),
      criterion: (
        <span className="small">
          應抓到 {mutExpected} 個；1 個（<Tex>{r`\delta`}</Tex> 極性約定）本來就不是錯
        </span>
      ),
      pass: mutAllAsExpected,
    },
  }

  const [mutId, setMutId] = useState(MUTANTS[0].id)
  const mut = MUTANTS.find((m) => m.id === mutId) ?? MUTANTS[0]
  const mutRes = st.mutants.find((m) => m.id === mut.id)
  const mutText = MUTANT_TEXT[mut.id]
  const correct = MODEL_SOURCES[mut.correct.module]

  return (
    <Section kind="assumptions" title="§V.4 反面測試：故意做錯，驗收機制抓不抓得到？" level={2} id="ver-negative">
      <p>
        只會說「對」的測試沒有用。規格 §17 末段要求加入<strong>反面測試</strong>：把常見的設計錯誤（極性接反、少一個 scaling、位元沒映射……）做成輸入，確認模型與檢查會
        <strong>報錯</strong>，而不是安靜地顯示成功。下表每一列都在你的瀏覽器裡即時重算，並列出負責的自動測試。
        <ClaimTag kind="exact" />
      </p>
      {st.negativeError && (
        <Callout kind="danger" title="反面測試的即時值計算失敗">
          {st.negativeError}（某個章節模型丟出例外；下表對應的列顯示「未計算」，不會被當成通過）
        </Callout>
      )}
      <div className="table-wrap">
        <table className="ver-table" data-testid="negative-table">
          <thead>
            <tr>
              <th>情境（§17）</th>
              <th>錯在哪裡</th>
              <th>即時計算</th>
              <th>判準</th>
              <th>即時判定</th>
              <th>自動測試</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {NEGATIVE_TESTS.map((n) => {
              const cell = live[n.id]
              return (
                <tr key={n.id}>
                  <td className="ver-mid">
                    <strong>{M(n.title)}</strong>
                    {n.errata.length > 0 && (
                      <div className="ver-chips">
                        {n.errata.map((e) => (
                          <ErratumChip key={e} eid={e} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="ver-wide small">{M(n.failure)}</td>
                  <td className="ver-mid">{cell.value}</td>
                  <td className="ver-mid">{cell.criterion}</td>
                  <td>
                    <PassMark pass={cell.pass} label={cell.pass ? '如預期' : undefined} />
                  </td>
                  <td className="ver-wide">
                    <TestList meta={n} />
                  </td>
                  <td>
                    {n.tId ? (
                      <>
                        <TestBadge id={n.tId} />
                        <div className="small muted">計入 {n.tId}</div>
                      </>
                    ) : (
                      <span className="small muted">unmapped：Python 端為 test_NEG_…，verify 不把它算進任何 T-id</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        「即時計算」的 golden 參考值來自 <code>golden/vectors/negative_tests.json</code>（{Object.keys(GOLDEN_NEGATIVE.expected).length} 個 key：
        {st.negative.passed} 個一致）。PLL 路徑混淆與 aliasing 沒有 golden 數值，判準直接寫在表上。
      </p>

      <h3 id="ver-mutation">Mutation Lab：「模型公式有錯，UI 卻顯示成功」</h3>
      <p>
        最危險的錯誤是<strong>安靜的錯誤</strong>：公式少了一個 /2，圖照樣畫得出來，數字看起來也合理。檢驗方法叫 mutation testing——故意把一個公式改錯（mutant），
        用<strong>同一套</strong> golden 比對規則去檢查它；如果驗收機制沒有報錯，代表這個測試太弱。下面 {MUTANTS.length} 個 mutant 都寫在 <code>acceptance.ts</code> 的{' '}
        <code>#region core:mutant…</code>，和正確版本並排。
      </p>
      <Callout kind={mutAllAsExpected ? 'ok' : 'danger'} title={mutAllAsExpected ? `${mutDetected}/${mutExpected} 個真正的錯誤都被抓到` : '有 mutant 沒有被正確判定'}>
        最後一個 mutant（<Tex>{r`\delta=w-a`}</Tex>）刻意保留：它不是 bug，只是極性約定，pole 測試<strong>本來就</strong>看不出差別——這提醒我們每個測試只檢查它看得見的東西。T01
        因此另外比對整條 <Tex>{'w_n'}</Tex> 軌跡，而網站顯示 <Tex>{r`\delta`}</Tex> 時一律用 <Tex>{'a-w'}</Tex>。
      </Callout>
      <div className="table-wrap">
        <table className="ver-table" data-testid="mutant-table">
          <thead>
            <tr>
              <th>mutant</th>
              <th>比對的 golden key</th>
              <th>mutant 的值</th>
              <th>golden</th>
              <th>
                <Tex>{'r=|\\Delta|/b'}</Tex>
              </th>
              <th>驗收機制</th>
            </tr>
          </thead>
          <tbody>
            {MUTANTS.map((m) => {
              const r = st.mutants.find((x) => x.id === m.id)
              const t = MUTANT_TEXT[m.id]
              return (
                <tr key={m.id} className={m.id === mutId ? 'ver-row-target' : undefined}>
                  <td className="ver-mid">
                    <button type="button" className="btn ver-btn-small" onClick={() => setMutId(m.id)} aria-pressed={m.id === mutId} aria-label={`檢視 mutant：${texToPlain(t?.title ?? m.id)}`}>
                      {M(t?.title ?? m.id)}
                    </button>
                  </td>
                  <td className="ver-mono small">
                    {m.vector}.{m.key}
                    {m.index !== undefined ? `[${m.index}]` : ''}
                  </td>
                  <td className="ver-mono">{fmtNumeric(r?.value ?? null, 7)}</td>
                  <td className="ver-mono">{fmtNumeric(r?.expected ?? null, 7)}</td>
                  <td className="num">
                    <Tex>{ratioTex(r?.diff?.worstRatio)}</Tex>
                  </td>
                  <td>
                    {r?.error ? (
                      <span className="ver-fail" title={r.error}>
                        ✗ 計算失敗
                      </span>
                    ) : r?.detected ? (
                      <span className="ver-pass">✓ 抓到</span>
                    ) : m.expectDetected ? (
                      <span className="ver-fail">✗ 漏掉</span>
                    ) : (
                      <span className="ver-miss">○ 看不出（預期）</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <SelectControl
        label="並排檢視的 mutant"
        value={mutId}
        onChange={setMutId}
        options={MUTANTS.map((m) => ({ value: m.id, label: texToPlain(MUTANT_TEXT[m.id]?.title ?? m.id) }))}
      />
      {mutText && (
        <div className="ver-mut-card" data-testid="mutant-card">
          <p>
            錯誤版本：<Tex>{mutText.wrongTex}</Tex>；正確版本：<Tex>{mutText.rightTex}</Tex>
          </p>
          <p className="small">
            {M(mutText.lesson)}
            {mut.errata.map((e) => (
              <span key={e}>
                {' '}
                <ErratumChip eid={e} />
              </span>
            ))}
          </p>
          <p className="small">
            mutant = <span className="ver-mono">{fmtNumeric(mutRes?.value ?? null, 10)}</span>，golden {mut.vector}.{mut.key} ={' '}
            <span className="ver-mono">{fmtNumeric(mutRes?.expected ?? null, 10)}</span>，<Tex>{`r=|\\Delta|/b=${ratioTex(mutRes?.diff?.worstRatio)}`}</Tex> <Tex>{r`\Rightarrow`}</Tex>{' '}
            {mutRes?.detected ? <strong className="ver-pass">驗收失敗（正確地抓到）</strong> : <strong className="ver-miss">驗收通過（此測試看不出差別）</strong>}
          </p>
        </div>
      )}
      <ModeGate min="engineer">
        <CodeCompare
          items={[
            { label: '正確（章節模型）', source: correct.src, region: mut.correct.region, path: correct.path, note: '網站各章實際執行的版本' },
            { label: '故意寫錯（mutant）', source: acceptanceSrc, region: mut.region, path: 'src/simulation/models/acceptance.ts', note: '只用於 mutation testing，任何頁面都不會拿它當結果' },
          ]}
          caption="右邊標「← 差異」的那一行就是被改錯的地方。"
        />
      </ModeGate>
      <FBlock id="F-VF.12" />
      <ModeGate min="research">
        <StepDerivation
          title="為什麼一個 mutant 能被抓到：誤差必須大於容忍度"
          steps={steps([
            { tex: r`\Delta=|f_{\rm mutant}(x)-f(x)|`, why: r`同一組輸入 $x$，錯誤公式與正確公式的差。` },
            { tex: r`\text{抓到}\iff\Delta>\varepsilon_{\rm abs}+\varepsilon_{\rm rel}|f(x)|`, why: r`和 §V.1 的通過條件正好相反。` },
            { tex: r`\text{PM：}\ \Delta=\big|\arcsin1-\arcsin\tfrac12\big|=90^\circ-30^\circ=60^\circ\gg10^{-9}`, why: r`T08 的容忍度 $10^{-9}$：差了 $10^{10}$ 倍以上。` },
            { tex: r`\delta\ \text{極性：}\ \Delta=\big|(1-\mu x^2)-(1-\mu x^2)\big|=0`, why: r`兩種極性的遞迴係數完全相同——任何 pole 測試都不可能抓到，必須用 trace 或明確的符號規定。` },
          ])}
        />
        <p className="small">
          所以設計測試時要問兩件事：<strong>(1) 這個錯誤會造成多大的數值差？</strong>（大於容忍度才抓得到）<strong>(2) 測試觀察的量對這個錯誤敏感嗎？</strong>
          （pole 對 <Tex>{r`\delta`}</Tex> 的正負號不敏感）。
        </p>
      </ModeGate>
      <p className="small muted">
        golden 參考：{MUTANTS.length} 個 mutant 比對的 key 都取自 {[...new Set(MUTANTS.map((m) => m.vector))].join('、')} 的 golden vectors（例如 T08.pm_deg ={' '}
        <Tex>{`${fmtNum(GOLDEN.T08.expected.pm_deg as number)}^\\circ`}</Tex>）。
      </p>
    </Section>
  )
}
