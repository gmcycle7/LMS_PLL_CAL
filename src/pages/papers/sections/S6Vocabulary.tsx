import type { ReactNode } from 'react'
import { ClaimTag, Section, Tex, type ClaimKind } from '@/components'
import { ErratumNote, PageChips, Question, r } from '../common'

interface VocabRow {
  phrase: string
  meaning: ReactNode
  formula: string
  claim: ClaimKind
  claimNote: ReactNode
  pages: string[]
  check: ReactNode
}

export const VOCAB: VocabRow[] = [
  {
    phrase: '平均收斂（convergence in the mean）',
    meaning: (
      <>
        <Tex>{r`E[\boldsymbol\delta_n]\to\mathbf 0`}</Tex>：很多次實驗的平均誤差趨近 0。
      </>
    ),
    formula: r`|1-\mu\lambda_i|<1\ \ \forall i\ \Longleftrightarrow\ 0<\mu<2/\lambda_{\max}`,
    claim: 'exact',
    claimNote: 'iid 純量時精確；時間相關的 regressor 為近似',
    pages: ['ch03', 'ch09'],
    check: (
      <>
        有沒有假設 regressor 與係數誤差獨立？
        <ErratumNote id="E38" />
      </>
    ),
  },
  {
    phrase: '均方收斂／均方穩定（mean-square）',
    meaning: (
      <>
        <Tex>{r`E[\delta_n^2]`}</Tex> 有界或趨近 0：不只平均對，散布也要收斂。
      </>
    ),
    formula: r`1-2\mu E[x^2]+\mu^2E[x^4]<1\ \Longleftrightarrow\ 0<\mu<\frac{2E[x^2]}{E[x^4]}`,
    claim: 'exact',
    claimNote: 'iid 純量、無外加雜訊',
    pages: ['ch03'],
    check: (
      <>
        <Tex>{r`E[x^4]`}</Tex> 用的是哪個分布？Gaussian 時 <Tex>{r`E[x^4]=3E[x^2]^2`}</Tex>，<Tex>{r`\pm1`}</Tex> code 時 <Tex>{r`E[x^4]=E[x^2]^2`}</Tex>。
      </>
    ),
  },
  {
    phrase: '幾乎必然收斂（almost-sure / sample path）',
    meaning: <>幾乎每一條實際跑出來的路徑都收斂。</>,
    formula: r`E\big[\ln|1-\mu x^2|\big]<0`,
    claim: 'exact',
    claimNote: '界限需數值積分',
    pages: ['ch03'],
    check: (
      <>
        只畫了幾條 sample path 的「收斂」可能落在這一類，不代表均方收斂。
        <ErratumNote id="E14" />
      </>
    ),
  },
  {
    phrase: '局部（小訊號）穩定',
    meaning: <>在固定點附近線性化後的平均動態穩定；大誤差時不保證。</>,
    formula: r`p=1-\mu K_qC,\quad K_q=\sqrt{2/\pi}/\sigma_v`,
    claim: 'approx',
    claimNote: (
      <>
        需 <Tex>{r`|\delta|\ll\sigma_v`}</Tex>、Gaussian 雜訊
      </>
    ),
    pages: ['ch05', 'ch06'],
    check: <>線性化的工作點在哪裡？comparator 的雜訊分布與 offset 是什麼？</>,
  },
  {
    phrase: '含延遲／回授動態的穩定',
    meaning: <>把更新延遲與主迴路一起放進特徵方程後，所有根都在單位圓內。</>,
    formula: r`z^{d+1}-z^{d}+g=0,\quad 0<g<g^*(d)=2\sin\frac{\pi}{4d+2}`,
    claim: 'exact',
    claimNote: '線性平均模型、固定延遲',
    pages: ['ch08'],
    check: (
      <>
        延遲是幾個 block？主 PLL 的動態有沒有一起建模？
        <ErratumNote id="E19" />
      </>
    ),
  },
  {
    phrase: '穩態誤差（misadjustment／係數雜訊）',
    meaning: <>收斂之後係數還會在最佳點附近抖動多少。</>,
    formula: r`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`,
    claim: 'exact',
    claimNote: '線性模型、iid block 雜訊',
    pages: ['ch12', 'ch14'],
    check: <>報告的是係數的 RMS、換算後的時間誤差，還是 PLL 輸出 jitter？積分頻寬是多少？</>,
  },
  {
    phrase: '全域（非線性）穩定',
    meaning: <>任何初始值、包含 comparator 飽和與 sign 非線性時都收斂。</>,
    formula: r`\text{需要非線性分析或大量模擬}`,
    claim: 'research',
    claimNote: '本站一階模型不保證',
    pages: ['ch06', 'models'],
    check: <>是證明、還是有限次 Monte Carlo？有限樣本模擬不能證明全域穩定（規格附錄 B 第 8 點）。</>,
  },
]

/** §6：文獻說「收斂」時，到底是哪一種？ */
export function S6Vocabulary() {
  return (
    <Section kind="assumptions" level={2} title="6. 文獻說「收斂」「穩定」時，到底是哪一種？" id="papers-vocab">
      <Question>兩篇論文都說「LMS 收斂」，一篇的步長卻是另一篇的三倍。誰錯了？</Question>
      <p>
        很可能都沒錯：它們證明的是<strong>不同種類</strong>的收斂。規格書的原則是不能只寫「LMS
        一定穩定」，必須說明是哪一種。讀文獻時，用下表把它的說法對到本站的公式與條件：
      </p>
      <div className="table-wrap">
        <table className="papers-table papers-vocab">
          <thead>
            <tr>
              <th>文獻的說法</th>
              <th>數學意義</th>
              <th>本站的判據</th>
              <th>標籤</th>
              <th>本站頁面</th>
              <th>讀文獻時要確認</th>
            </tr>
          </thead>
          <tbody>
            {VOCAB.map((row) => (
              <tr key={row.phrase}>
                <td>{row.phrase}</td>
                <td>{row.meaning}</td>
                <td>
                  <Tex>{row.formula}</Tex>
                </td>
                <td>
                  <ClaimTag kind={row.claim} />
                  <div className="small muted">{row.claimNote}</div>
                </td>
                <td>
                  <PageChips ids={row.pages} />
                </td>
                <td>{row.check}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
