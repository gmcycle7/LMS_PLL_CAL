import { memo, type CSSProperties } from 'react'
import { ClaimTag, TestBadge, Tex, TexBlock } from '@/components'
import type { CaseId } from '@/components'
import { CLAIM_EXAMPLES, SIX_CONDITIONS } from '../data'
import { CONDITION_FLOW_CHART } from '../diagrams'
import { builtinPreset } from '../presets'
import type { ConditionCheck, ConditionId } from '../thesisModel'
import { DiagramWalk, ErratumLink, PageChip, Rich, STATE_LABEL, StateIcon, plainTip, scrollToId } from '../ui'

/** 最終教學主旨：六個條件的視覺化檢查表；右上角的燈號來自下方「動手體檢」目前選取的 case。 */
export const ThesisSection = memo(function ThesisSection({
  checks,
  caseId,
  onLoadExample,
}: {
  checks: ConditionCheck[]
  caseId: CaseId
  /** 把「會讓這個條件失敗」的內建 preset 載入目前的 case，並捲到動手體檢 */
  onLoadExample?: (id: ConditionId) => void
}) {
  return (
    <section id="dash-thesis" aria-labelledby="dash-thesis-h">
      <h2 id="dash-thesis-h" className="dash-h2">
        最終教學主旨：六個條件 <span className="dash-h2-kicker">規格 附錄 E</span>
      </h2>
      <p className="dash-lead-sm">
        成功的 calibration 必須<strong>同時</strong>滿足：資訊足夠（identifiability）、更新方向正確（polarity）、動態穩定（stability）、
        統計精度足夠（variance）、收斂到正確物理參數（bias），以及真正改善 PLL output jitter / spur（system-level performance）。
        它們彼此<strong>獨立</strong>：滿足其中五個，仍可能在第六個失敗。每張卡片右上角的燈號是下方
        <button type="button" className="btn btn-icon" style={{ margin: '0 4px', padding: '0 8px' }} onClick={() => scrollToId('dash-check')}>
          動手體檢
        </button>
        Case {caseId} 的即時結果，卡片中間那一行是它的關鍵數值與原因。想看某個條件<strong>不滿足</strong>時長什麼樣子，按卡片下方的「載入反例」。
      </p>
      <DiagramWalk
        chart={CONDITION_FLOW_CHART}
        caption="六個條件的檢查流程：由上到下逐一問，六個「是」才算成功；任何一個「否」就停在那一格，紅色方塊寫的是會看到的現象與該修哪裡。"
        ariaLabel="六個條件的檢查流程圖：依序檢查資訊足夠、更新方向正確、動態穩定、統計精度足夠、正確的物理參數、改善 PLL 輸出；每一個不通過都對應一種現象與修正方向，六個都通過才是成功的 calibration"
      >
        <p>
          先看那一串由上往下的菱形：順序就是卡片的編號。它們互相獨立（通過前五個不保證第六個），但<strong>計算上有先後</strong>——後面的判據要用到前面算出來的量。
        </p>
        <p>
          圖上的 <Tex>{'C'}</Tex> 是 code 與它造成的誤差之間的相關（條件 2）；有了它才能算 loop gain <Tex>{'g=\\mu K_qC'}</Tex>（條件 3，<Tex>{'g^*(d)'}</Tex> 是更新晚 <Tex>{'d'}</Tex> 個 block 時的臨界值）；迴路收斂了，才有穩態的係數抖動{' '}
          <Tex>{'\\sigma_w'}</Tex>（條件 4）與固定點偏移 <Tex>{'w^*-a=B/C'}</Tex>（條件 5）；最後把兩者一起換算到 DTC 的時間誤差 <Tex>{'\\sigma_{\\delta t}'}</Tex> 與 spur（條件 6）。每個符號的定義在下面的卡片與「一條方程式」那一節。
        </p>
      </DiagramWalk>
      <div className="dash-cond-grid">
        {SIX_CONDITIONS.map((c) => {
          const live = checks.find((k) => k.id === c.id)
          const example = builtinPreset(c.example)
          return (
            <article
              key={c.id}
              id={`dash-cond-${c.id}`}
              className="dash-cond-card"
              style={{ '--cond-c': `var(${c.color})` } as CSSProperties}
              aria-labelledby={`dash-cond-${c.id}-h`}
            >
              <div className="dash-cond-head">
                <span className="dash-cond-n" aria-hidden="true">
                  {c.n}
                </span>
                <div className="dash-cond-title" id={`dash-cond-${c.id}-h`}>
                  {c.zh}
                  <span className="dash-cond-en">{c.en}</span>
                </div>
                {live && (
                  <span className="dash-cond-live" title={plainTip(live.reason)}>
                    Case {caseId}
                    <StateIcon state={live.state} />
                  </span>
                )}
              </div>
              <div className="dash-cond-ask">
                <Rich text={c.ask} />
              </div>
              <div className="dash-cond-tex">
                <TexBlock>{c.tex}</TexBlock>
              </div>
              <div className="dash-chips">
                <ClaimTag kind={c.claim} />
                <span className="small muted">
                  <Rich text={c.claimNote} />
                </span>
              </div>
              {live && (
                <div className={`dash-cond-now dash-cond-now-${live.state}`} aria-live="polite">
                  <strong>
                    Case {caseId} 目前（{STATE_LABEL[live.state]}）：
                  </strong>
                  <Rich text={live.summary} />
                  <span className="dash-cond-now-why">
                    <Rich text={live.reason} />
                  </span>
                </div>
              )}
              <div className="dash-cond-fail">
                <strong>不滿足時：</strong>
                <Rich text={c.failure} />
              </div>
              <div className="dash-cond-hw">
                <strong>硬體對應：</strong>
                <Rich text={c.hardware} />
              </div>
              <div className="dash-cond-foot">
                <div className="dash-chips">
                  <span className="small muted">章節</span>
                  {c.pages.map((id, i) => (
                    <PageChip key={id} id={id} primary={i === 0} />
                  ))}
                  <span className="small muted">· 問題</span>
                  {c.questions.map((q) => (
                    <button key={q} type="button" className="dash-chip" onClick={() => scrollToId(`dash-q-${q}`)}>
                      Q{q}
                    </button>
                  ))}
                </div>
                <div className="dash-chips">
                  {c.tests.map((t) => (
                    <TestBadge key={t} id={t} />
                  ))}
                  {c.errata.map((e) => (
                    <ErratumLink key={e} eid={e} />
                  ))}
                </div>
                {example && onLoadExample && (
                  <div>
                    <button type="button" className="btn dash-cond-example" onClick={() => onLoadExample(c.id)} title={plainTip(example.description)}>
                      載入反例：
                      <Rich text={example.rich ?? example.name} />
                    </button>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <div className="dash-claims">
        <div className="dash-claims-box ok">
          <strong>可以這樣宣稱（規格 §16.3）</strong>
          <ul>
            {CLAIM_EXAMPLES.filter((x) => x.ok).map((x) => (
              <li key={x.text}>
                <StateIcon state="ok" label="可以宣稱" />
                <span>
                  <Rich text={x.text} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="dash-claims-box bad">
          <strong>不可以這樣宣稱</strong>
          <ul>
            {CLAIM_EXAMPLES.filter((x) => !x.ok).map((x) => (
              <li key={x.text}>
                <StateIcon state="fail" label="不可宣稱" />
                <span>
                  <Rich text={x.text} />
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            第一句錯在把單一 PM（條件 3）當成全部；第二句錯在把 GMAC 歸零（只代表條件 2、3 讓它停下來）當成條件 5、6。
          </p>
        </div>
      </div>
    </section>
  )
})
