import { Callout, Mermaid, ModeGate, Section, Tex, ChRef } from '@/components'
import { useSettings } from '@/app/settings'
import { LEVEL_LABEL, PAPERS_BY_ORDER, READING_PATH_CHART, type ReadingLevel } from '../references'
import { JumpLink, PageChips, Question, RichText, r } from '../common'

interface PathStep {
  key: string
  what: string
  why: string
  prereqs: string[]
  pages: string[]
  level: ReadingLevel | 'site'
}

/** 閱讀步驟：本站預備章節 → 依 order 排列的文獻，教科書插在 order 2。 */
export function readingSteps(): PathStep[] {
  const steps: PathStep[] = [
    {
      key: 'site',
      what: '本站 Ch00–Ch03',
      why: '先用一個未知數 a 的黑盒子把 LMS、梯度、pole、mean / mean-square 走一遍；後面所有文獻都假設你已經會這些。',
      prereqs: ['微積分（導數、等比數列）'],
      pages: ['ch00', 'ch01', 'ch02', 'ch03'],
      level: 'site',
    },
  ]
  for (const p of PAPERS_BY_ORDER) {
    if (p.order === 3) {
      steps.push({
        key: 'textbook',
        what: '教科書的 LMS 章節（Widrow & Stearns、Haykin 或 Sayed 擇一）',
        why: String.raw`講義之後用一本教科書把 steepest descent、LMS、NLMS 的推導依序補完整；先看本頁 §4「同一個 LMS，三種寫法」再讀，避免被 $2\mu$ 的差別絆倒。`,
        prereqs: ['矩陣與特徵值'],
        pages: ['ch03', 'ch09'],
        level: 'intro',
      })
    }
    steps.push({
      key: p.id,
      what: `${p.id}｜${p.authors[0].split(' ').slice(-1)[0]}${p.authors.length > 1 ? ' et al.' : ''} ${p.year}`,
      why: p.relevance,
      prereqs: p.prereqs,
      pages: p.pages_,
      level: p.level,
    })
  }
  return steps
}

/** §2：給微積分程度讀者的閱讀路線。 */
export function S2ReadingPath() {
  const { mode } = useSettings()
  const steps = readingSteps()
  return (
    <Section kind="diagram" level={2} title="2. 閱讀路線：只會微積分，要從哪一篇開始？" id="papers-path">
      <Question>七份文獻難度差很多；先讀錯一篇（例如 D2 的 Toeplitz pseudospectrum），很容易以為自己數學不夠而放棄。</Question>
      <p>
        原則只有一個：<strong>先在本站把對應章節的推導走過一次，再去讀文獻</strong>。這樣讀論文時，你只需要做「符號對照」與「條件對照」，不必同時學新數學。
        下圖的箭頭表示「建議先讀」。
      </p>
      <Mermaid chart={READING_PATH_CHART} caption="建議閱讀順序（D1–D7 為規格書附錄 D 的編號；標「本站」的方塊是本站的預備章節）" ariaLabel="文獻閱讀路線圖" />
      {mode === 'beginner' && (
        <Callout kind="info" title="入門模式：只讀一份的話">
          先讀 <strong>D7 講義</strong>，同時打開本站 <ChRef ch="03">Ch03</ChRef> 對照；講義裡的 <Tex>{r`1-\mu\lambda_i`}</Tex> 就是本站的 pole。其他論文等你讀完 Part B 再回來。
        </Callout>
      )}
      <p className="small muted">
        下表的「順位」與 §3 每張文獻卡上的「建議第 N 順位」是同一個編號；第 2 順位留給一本教科書，所以文獻卡上沒有第 2 順位。
      </p>
      <div className="table-wrap">
        <table className="papers-table papers-path-table">
          <thead>
            <tr>
              <th className="num">順位</th>
              <th>讀什麼</th>
              <th>為什麼這時候讀</th>
              <th>先準備的數學</th>
              <th>搭配本站</th>
              <th>難度</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.key}>
                <td className="num">{i === 0 ? '預備' : i}</td>
                <td className="papers-path-what">{s.key.startsWith('D') ? <JumpLink to={`papers-${s.key}`}>{s.what}</JumpLink> : s.what}</td>
                <td>
                  <RichText text={s.why} />
                </td>
                <td>
                  <RichText text={s.prereqs.join('、')} />
                </td>
                <td>
                  <PageChips ids={s.pages} />
                </td>
                <td className="nowrap">{LEVEL_LABEL[s.level === 'site' ? 'intro' : s.level]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="讀任何一篇之前，先準備這五個問題">
        <ol>
          <li>
            <strong>模型是什麼？</strong>哪一種 LMS（線性、sign-error、sign-sign、NLMS）、哪一個轉移函數、在哪個取樣率上？
          </li>
          <li>
            <strong>符號與極性？</strong>誤差定義是 <Tex>{r`a-w`}</Tex> 還是 <Tex>{r`w-a`}</Tex>、步長是否帶 2 倍（本頁 §4）。
          </li>
          <li>
            <strong>「收斂」是哪一種？</strong>mean、mean-square、almost-sure、局部線性、或全域非線性（本頁 §6）。
          </li>
          <li>
            <strong>數字從哪來？</strong>量測（measured）、模擬（simulation）、還是推導；模擬的話，條件與本站相同嗎？
          </li>
          <li>
            <strong>可以搬到我的 PLL 嗎？</strong>把論文的條件逐條對到本站的假設清單；任何一條不同就要重推，不能直接套數字。
          </li>
        </ol>
      </Callout>
      <ModeGate min="research">
        <p className="small muted">
          Research：D2（Toeplitz 矩陣的漸近 pseudospectrum）需要的線性代數超出本站 <ChRef ch="09">Ch09</ChRef>–<ChRef ch="10">Ch10</ChRef> 的範圍；建議先讀 Strang 的特徵值章節與 Oppenheim & Schafer 的
          DTFT， 再讀 D2 的必要條件推導。
        </p>
      </ModeGate>
    </Section>
  )
}
