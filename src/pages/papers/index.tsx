import { Callout, ClaimTag, ModelLevel, Section, SourceTag, SymbolTable, Tex, TestBadge, type SymbolEntry } from '@/components'
import { useSettings } from '@/app/settings'
import { ErratumNote, JumpButton, PageChip, SYMBOLS_ANCHOR, SymbolsLink, TOP_ANCHOR, r } from './common'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'
import { PAPERS } from './references'
import { S1Policy } from './sections/S1Policy'
import { S2ReadingPath } from './sections/S2ReadingPath'
import { S3Papers } from './sections/S3Papers'
import { S4Conventions } from './sections/S4Conventions'
import { S6Vocabulary } from './sections/S6Vocabulary'
import { S7Books } from './sections/S7Books'
import { S8Wrapup } from './sections/S8Wrapup'
import { ConventionLab } from './experiments/ConventionLab'
import './papers.css'

export const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'a,\\ w_k',
    meaning: (
      <>
        真實參數與第 <Tex>{'k'}</Tex> 個 block 的校正係數
      </>
    ),
    unit: r`\mathrm{fs}/\text{unit code}`,
    firstSeen: '§3 D1',
    note: 'Part A 的例子無因次',
  },
  {
    symbol: r`\delta=a-w`,
    meaning: '剩餘參數誤差（全站極性）',
    unit: r`\mathrm{fs}/\text{unit code}`,
    firstSeen: '§3 D7',
    note: (
      <>
        <ErratumNote id="E32" />
        文獻常用 <Tex>{r`w-w_o`}</Tex>：pole 不變，偏差正負號相反
      </>
    ),
  },
  {
    symbol: r`\delta w_k=w_k-w^*`,
    meaning: '相對固定點的係數擾動（係數雜訊）',
    unit: r`\mathrm{fs}/\text{unit code}`,
    firstSeen: '§3 D1',
    note: <ErratumNote id="E33" />,
  },
  { symbol: 'x[n]', meaning: '原始 regressor（DSM／DTC code）', unit: r`\text{無因次}`, firstSeen: '§3 D2' },
  {
    symbol: r`u[n]=(h*x)[n]`,
    meaning: '經 PLL 誤差路徑的有效 regressor',
    unit: r`\text{無因次}`,
    firstSeen: '§3 D2',
    note: (
      <>
        Haykin 型教材的 <Tex>{r`\mathbf u(n)`}</Tex> 是輸入向量（＝本站 <Tex>{'x'}</Tex>）
      </>
    ),
  },
  {
    symbol: 'e[n],\\ \\varepsilon_k',
    meaning: (
      <>
        誤差；Widrow 型文獻記為 <Tex>{r`\varepsilon`}</Tex>
      </>
    ),
    unit: r`\mathrm{fs}`,
    firstSeen: '§4',
  },
  {
    symbol: r`q[n]=\mathrm{sign}(e[n])`,
    meaning: (
      <>
        1-bit comparator 輸出（<Tex>{r`e\ge0\Rightarrow q=+1`}</Tex>）
      </>
    ),
    unit: r`\pm1`,
    firstSeen: '§4',
    note: <ErratumNote id="E07" />,
  },
  {
    symbol: r`G_k=\tfrac1N\sum q\,x`,
    meaning: 'GMAC 一個 block 的平均相關（average 模式）',
    unit: r`\text{無因次}`,
    firstSeen: '§4',
    note: (
      <>
        sum 模式要再乘 <Tex>{'N'}</Tex>
      </>
    ),
  },
  {
    symbol: r`\mu`,
    meaning: (
      <>
        本站步長（成本 <Tex>{r`\tfrac12e^2`}</Tex> 的寫法）；Part B average-mode GMAC 時為 gain step
      </>
    ),
    unit: r`\text{—}\ /\ \mathrm{fs}`,
    firstSeen: '§4',
    note: <ErratumNote id="E13" />,
  },
  {
    symbol: r`\mu_W`,
    meaning: (
      <>
        Widrow 型（成本 <Tex>{r`\varepsilon^2`}</Tex>）的步長
      </>
    ),
    unit: r`\text{—}`,
    firstSeen: '§4',
    note: (
      <>
        <Tex>{r`\mu=2\mu_W`}</Tex>（<ErratumNote id="E41" />）
      </>
    ),
  },
  { symbol: r`\tilde\mu,\ \epsilon_{\mathrm{reg}}`, meaning: 'NLMS 的正規化步長與 regularizer', unit: r`\text{—}`, firstSeen: '§4' },
  {
    symbol: r`s`,
    meaning: '每單位 eigenvalue 的平均 loop gain（本頁的換算量）',
    unit: r`\text{—}`,
    firstSeen: '§4',
    note: (
      <>
        <Tex>{r`g_i=s\lambda_i`}</Tex>
      </>
    ),
  },
  {
    symbol: r`\mathbf R,\ \lambda_i`,
    meaning: 'regressor 自相關矩陣與其特徵值',
    unit: r`\text{—}`,
    firstSeen: '§3 D4',
    note: (
      <>
        <Tex>{r`\lambda_{\max},\lambda_{\min}`}</Tex>；只用於特徵值（
        <ErratumNote id="E22" />）
      </>
    ),
  },
  {
    symbol: r`\rho`,
    meaning: '兩個參數 regressor 的相關係數',
    unit: r`[-1,1]`,
    firstSeen: '§3 D4',
    note: (
      <>
        不是 spectral radius；本頁的最大根模寫成 <Tex>{r`|z|_{\max}`}</Tex>
      </>
    ),
  },
  { symbol: r`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: 'comparator 小訊號增益', unit: r`\mathrm{fs^{-1}}`, firstSeen: '§3 D1' },
  { symbol: r`C=E[x\,u]`, meaning: '有效相關（決定更新極性）', unit: r`\text{無因次}`, firstSeen: '§3 D2' },
  { symbol: r`g=\mu K_qC`, meaning: 'normalized loop gain', unit: r`\text{—}`, firstSeen: '§3 D1' },
  { symbol: r`p,\ |z|_{\max}`, meaning: '一階 pole；有延遲時特徵多項式最大根的模', unit: r`\text{—}`, firstSeen: '§3 D1' },
  {
    symbol: r`d,\ g^*(d)`,
    meaning: '更新延遲與臨界 loop gain',
    unit: r`\text{blocks},\ \text{—}`,
    firstSeen: '§3 D3',
    note: (
      <>
        與 Ch07 的 code 延遲 <Tex>{'D'}</Tex>（samples）不同
      </>
    ),
  },
  {
    symbol: r`N,\ \sigma_v,\ \sigma_\eta^2,\ \sigma_w`,
    meaning: 'GMAC 長度、comparator 前雜訊、block 雜訊變異數、係數 RMS',
    unit: r`\text{—},\ \mathrm{fs},\ \text{—},\ \mathrm{fs}`,
    firstSeen: '§3 D1',
  },
  { symbol: r`f_s,\ f_u=f_s/N`, meaning: 'comparator 取樣率與 block update rate', unit: r`\mathrm{Hz}`, firstSeen: '§3 D1' },
  {
    symbol: r`f_{\mathrm{BW}},\ \beta,\ \nu`,
    meaning: (
      <>
        文獻給的校正迴路頻寬；由它反解 pole 的輔助量 <Tex>{r`\beta=\sin(\pi f_{\mathrm{BW}}/f_u)`}</Tex>、<Tex>{r`\nu=2f_{\mathrm{BW}}/f_u`}</Tex>
      </>
    ),
    unit: r`\mathrm{Hz},\ \text{—},\ \text{—}`,
    firstSeen: '§3 D1',
    note: (
      <>
        <ErratumNote id="E06" />
        要先問它是 <Tex>{r`-3\ \mathrm{dB}`}</Tex> 還是 ENBW
      </>
    ),
  },
  {
    symbol: 'B',
    meaning: '與 code 相關的干擾經 GMAC 平均後留下的等效偏移（規格 §11.4 的記號）',
    unit: r`\mathrm{fs}`,
    firstSeen: '§3 D4',
    note: (
      <>
        固定點 <Tex>{r`w^*=a+B/C`}</Tex>（<ErratumNote id="E12" />）
      </>
    ),
  },
  {
    symbol: r`\Omega,\ H(e^{j\Omega})=|H|e^{j\phi}`,
    meaning: '離散時間頻率與誤差路徑頻率響應',
    unit: r`\mathrm{rad/sample}`,
    firstSeen: '§3 D2',
    note: <ErratumNote id="E44" />,
  },
  { symbol: r`S_{xx}(e^{j\Omega})`, meaning: 'code 的雙邊 PSD', unit: r`\text{—}`, firstSeen: '§3 D2' },
  { symbol: r`w_H,\ y[n],\ r[n]`, meaning: '6-bit 量化的目標、輸出 code、殘值', unit: r`\mathrm{LSB}`, firstSeen: '§3 D5' },
  {
    symbol: r`\xi[n]`,
    meaning: (
      <>
        dither（本頁不用 <Tex>{'d'}</Tex>，以免與更新延遲撞名）
      </>
    ),
    unit: r`\mathrm{LSB}`,
    firstSeen: '§3 D5',
  },
]

/**
 * Papers / Reading（規格附錄 D）：七份文獻、閱讀路線、背景教科書，以及「文獻寫法 ↔ 本站」的換算。
 * 符號表放在頁尾（§10，id="symbols"；docs/teaching-style.md §5），頁首只留一行連結；方塊圖的原始碼在 diagrams.ts。
 */
export default function PapersPage() {
  const { mode } = useSettings()
  return (
    <div className="papers">
      <p className="papers-lead" id={TOP_ANCHOR}>
        這一頁整理規格書附錄 D 的 {PAPERS.length} 份文獻與背景教科書。每一份都附上核對過的書目與 DOI 連結、為什麼讀、該搭配本站哪幾章，並把
        <strong>「論文說的（已發表主張）」</strong>與<strong>「本站自己推的（derived on this site）」</strong>分開標示。本站的數字都由網站程式即時計算，
        不是從任何文獻抄來的量測值。本頁自己推導的 {FORMULAS.length} 條換算／對照公式登錄為 {FORMULAS[0].id}–{FORMULAS[FORMULAS.length - 1].id}，可在{' '}
        <PageChip id="formulas" /> 頁搜尋。另有 {HANDCALCS.length} 題「帶入手算」（{HANDCALCS[0].id}–{HANDCALCS[HANDCALCS.length - 1].id}）：每一題都從書上或論文上的數字出發，
        用紙筆與計算機一步一步算到本站的 <Tex>{'g'}</Tex>、<Tex>{'p'}</Tex> 或步長上限，可以換成你自己的數字（全站的手算題彙整在 <PageChip id="workbook" />）。
      </p>
      <div className="c-tag-row">
        <SourceTag kind="literature" /> <SourceTag kind="illustrative" /> <ClaimTag kind="exact" /> <ModelLevel level="L1" /> <TestBadge id="T11" />{' '}
        <TestBadge id="T13" />
      </div>
      {mode === 'beginner' && (
        <Callout kind="info" title="入門模式：先抓住三句話">
          <ol>
            <li>論文是延伸閱讀，不是本站數字的來源；本站的每個數字都能在本站重算。</li>
            <li>
              讀論文前先換算寫法：很多教科書的 <Tex>{r`\mu`}</Tex> 是本站的一半（§4）。
            </li>
            <li>只讀一份的話，先讀 D7 講義，同時打開本站 Ch03 對照（§2）。</li>
          </ol>
        </Callout>
      )}
      <SymbolsLink />
      <S1Policy />
      <S2ReadingPath />
      <S3Papers />
      <S4Conventions />
      <Section kind="explore" level={2} title="5. 動手：把書上的步長換成本站的 loop gain" id="papers-lab">
        <p>
          輸入書上的寫法與數字，看它在本站的模型裡等於多大的 <Tex>{'g'}</Tex>、哪個 eigen-mode 最慢、加了更新延遲之後還穩不穩定。四種寫法的換算表會同時列出，
          方便直接對照文獻。
        </p>
        <ConventionLab />
      </Section>
      <S6Vocabulary />
      <S7Books />
      <S8Wrapup />
      <Section kind="formula" level={2} title="10. 本頁符號表" id={SYMBOLS_ANCHOR}>
        <p className="small muted">
          正文裡每個符號第一次出現時都已經就地說明；這裡把它們集中起來，方便回頭查單位、第一次出現的段落，以及和全站約定或勘誤的關係。{' '}
          <JumpButton to={TOP_ANCHOR}>↑ 回到頁首</JumpButton>
        </p>
        <SymbolTable
          rows={SYMBOLS}
          title="本頁符號"
          caption={
            <>
              時間索引：<Tex>{'n'}</Tex> = comparator sample、<Tex>{'k'}</Tex> = GMAC block。所有例子皆為 illustrative；數字由{' '}
              <code>src/pages/papers/bridge.ts</code> 即時計算，並以 <code>golden/vectors</code> 交叉驗算。
            </>
          }
        />
      </Section>
    </div>
  )
}
