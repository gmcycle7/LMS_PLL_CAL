import { useMemo } from 'react'
import { Badge, ClaimTag, SourceTag, Tex } from '@/components'
import type { ClaimKind } from '@/data/types'
import { texArg, texNum } from '../format'
import { previewPreset, type PreviewResult } from '../previews'
import type { SlotAudit } from '../data'
import { JumpButton } from './SlotAudit'

const t = (x: number, sig = 6) => texNum(x, sig)
const ta = (x: number, sig = 6) => texArg(x, sig)

export interface UnifiedRow {
  slot: number
  /** 回答三個問題中的哪一個 */
  question: '(1) 走不走得回來' | '(2) 停在哪裡' | '(3) 停下來後抖多大'
  /** 把這個 preset 的數字代進 F-GA.4（TeX） */
  tex: string
  /** F-GA.4 算出的值 */
  unified: number
  /** 該章模型函式直接給出的值（previewPreset 的 metric 或軌跡） */
  model: number
  /** 這個量是什麼（TeX） */
  what: string
  claim: ClaimKind
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
const metric = (r: PreviewResult, key: string): number => num(r.metrics.find((m) => m.key === key)?.value)

/**
 * 用 12 個必備 preset 中的四個，把「統一觀點」F-GA.4 的三個答案各驗算一次：
 * 左邊是把 preset 的參數代進 F-GA.4 算出的數，右邊是該章自己的模型函式（previewPreset）給的數。
 * 純函式；preset 缺少或預覽失敗的列直接略過（不補數字）。
 */
export function unifiedRows(audit: SlotAudit[]): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  const run = (index: number): { params: Record<string, unknown>; result: PreviewResult } | null => {
    const p = audit.find((a) => a.slot.index === index)?.preset
    if (!p) return null
    const o = previewPreset(p)
    return o.status === 'ok' ? { params: p.params, result: o.result } : null
  }

  // #1（問題 1）：A = p = 1 − μx²；δ₃ = p³δ₀ 對照 runScalarLms 跑出來的 a − w₃
  const s1 = run(1)
  if (s1) {
    const a = num(s1.params.a)
    const w0 = num(s1.params.w0)
    const p = metric(s1.result, 'pole')
    const w3 = num(s1.result.chart?.series[0]?.y[3])
    rows.push({
      slot: 1,
      question: '(1) 走不走得回來',
      tex: `A=p=${t(p)},\\ b=0:\\quad \\delta_3=p^3\\delta_0=${ta(p)}^3\\times${ta(a - w0)}`,
      unified: p ** 3 * (a - w0),
      model: a - w3,
      what: '\\delta_3=a-w_3',
      claim: 'exact',
    })
  }

  // #12（問題 1 的矩陣版）：ρ(A) = max|eig(I + MJ)|，由兩個 eigenvalue 取最大絕對值
  const s12 = run(12)
  if (s12) {
    const e0 = metric(s12.result, 'eigA0')
    const e1 = metric(s12.result, 'eigA1')
    rows.push({
      slot: 12,
      question: '(1) 走不走得回來',
      tex: `\\mathbf A=\\mathbf I+\\mathbf M\\mathbf J:\\quad \\rho(\\mathbf A)=\\max(|${t(e0)}|,\\ |${t(e1)}|)`,
      unified: Math.max(Math.abs(e0), Math.abs(e1)),
      model: metric(s12.result, 'rho:A'),
      what: '\\rho(\\mathbf I+\\mathbf M\\mathbf J)',
      claim: 'exact',
    })
  }

  // #7（問題 2）：MSE-LMS 的 K = E[x²]、B = c₃E[x⁴]（b = c₂ = κ = 0）⇒ δ_∞ = −B/K，對照 a − w*_MSE
  const s7 = run(7)
  if (s7 && num(s7.params.b) === 0 && num(s7.params.c2) === 0 && num(s7.params.kappa) === 0) {
    const a = num(s7.params.a)
    const c3 = num(s7.params.c3)
    const Ex2 = metric(s7.result, 'Ex2')
    const Ex4 = metric(s7.result, 'Ex4')
    rows.push({
      slot: 7,
      question: '(2) 停在哪裡',
      tex: `K=E[x^2]=${t(Ex2)},\\ B=c_3E[x^4]=${ta(c3)}\\times${t(Ex4)}:\\quad \\delta_\\infty=-\\frac{B}{K}`,
      unified: -(c3 * Ex4) / Ex2,
      model: a - metric(s7.result, 'wMse'),
      what: '\\delta_\\infty=a-w^*_{\\text{MSE}}',
      claim: 'exact',
    })
  }

  // #8（問題 3）：σ_w = √(μ²σ_η²/(1 − p²))，對照 calLoop 的 σ_w
  const s8 = run(8)
  if (s8) {
    const mu = num(s8.params.mu)
    const p = metric(s8.result, 'p')
    const s2 = metric(s8.result, 'sigmaEta2')
    rows.push({
      slot: 8,
      question: '(3) 停下來後抖多大',
      tex: `p=${t(p)},\\ \\sigma_\\eta^2=${t(s2)}:\\quad \\sigma_w=\\sqrt{\\frac{\\mu^2\\sigma_\\eta^2}{1-p^2}}=\\sqrt{\\frac{${t(mu * mu)}\\times${t(s2)}}{1-${t(p * p)}}}`,
      unified: Math.sqrt((mu * mu * s2) / (1 - p * p)),
      model: metric(s8.result, 'sigmaW'),
      what: '\\sigma_w\\ [\\mathrm{fs}]',
      claim: 'approx',
    })
  }
  return rows.filter((r) => Number.isFinite(r.unified) && Number.isFinite(r.model))
}

/** 兩個數「相同」：相對 1e-9（等於同一條公式的兩種算法，只差浮點捨入） */
export function sameNumber(x: number, y: number): boolean {
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))
}

/**
 * §4 的數值驗算表（lazy chunk：會載入 previews 與各模型模組）。
 * 每一格都當場計算；兩欄不同時直接顯示「不同」，不做任何修飾。
 */
export default function UnifiedCheck({ audit }: { audit: SlotAudit[] }) {
  const rows = useMemo(() => unifiedRows(audit), [audit])
  if (rows.length === 0) return <p className="small muted">（必備 preset 缺少或無法預覽，沒有可驗算的列。）</p>
  return (
    <>
      <div className="c-tag-row">
        <SourceTag kind="illustrative" />
        <span className="small muted">先算一次：把四個 preset 的數字代進 F-GA.4，和各章模型函式自己算出的值並排（全部當場計算）。</span>
      </div>
      <div className="table-wrap">
        <table className="gal-table gal-unified-check">
          <caption className="small muted">統一觀點的數值驗算：左欄只用 F-GA.4 的公式，右欄是該章的模型函式（previewPreset）</caption>
          <thead>
            <tr>
              <th>#</th>
              <th>問題</th>
              <th>代入 F-GA.4</th>
              <th className="num">F-GA.4 的值</th>
              <th>模型函式的量</th>
              <th className="num">模型函式的值</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const same = sameNumber(r.unified, r.model)
              return (
                <tr key={`${r.slot}-${r.what}`} data-unified-check={r.slot} data-same={same}>
                  <td>
                    <JumpButton domId={`gal-slot-h-${r.slot}`}>#{r.slot}</JumpButton>
                  </td>
                  <td className="small nowrap">{r.question}</td>
                  <td className="gal-unified-math">
                    <Tex>{r.tex}</Tex>
                  </td>
                  <td className="num nowrap">
                    <Tex>{t(r.unified, 8)}</Tex>
                  </td>
                  <td className="nowrap">
                    <Tex>{r.what}</Tex> <ClaimTag kind={r.claim} />
                  </td>
                  <td className="num nowrap">
                    <Tex>{t(r.model, 8)}</Tex>
                  </td>
                  <td>{same ? (
                      <Badge variant="ok" className="gal-match gal-match-ok">
                        ✓ 相同
                      </Badge>
                    ) : (
                      <Badge variant="mismatch" className="gal-match gal-match-bad">
                        ✗ 不同
                      </Badge>
                    )}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small">
        讀法：#1 的誤差每步乘 <Tex>{'p'}</Tex>，三步後剩 <Tex>{'p^3'}</Tex> 倍；#7 沒有發散，但停在 <Tex>{'\\delta_\\infty=-B/K\\ne0'}</Tex>（<Tex>{'w^*\\ne a'}</Tex>）；#8 的平均誤差是 0，卻以{' '}
        <Tex>{'\\sigma_w'}</Tex> 的大小在抖；#12 的 <Tex>{'\\rho(\\mathbf A)>1'}</Tex>，連第一個問題都沒有通過。
      </p>
    </>
  )
}
