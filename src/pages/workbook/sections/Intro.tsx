import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Callout, HandCalc, Tex, TexBlock, texNum, ChRef } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { kq } from '@/simulation/models/comparator'
import { fixedXPole } from '@/simulation/models/lms'
import { LEVELS, LEVEL_LABEL, chapterOf, countByLevel, type ChapterGroup, type Level } from '../logic'
import { CHART_DEMO_ORDER, CHART_HOWTO } from '../diagrams'
import { Diagram, LevelBadge } from './common'

/** 「為什麼要手算」的兩個數字例：都呼叫模型函式，不在頁面上手打結果 */
const SIGMA_V_EXAMPLE = 100 // fs（全站 T13 示例的 comparator 雜訊）
const KQ_EXAMPLE = kq(SIGMA_V_EXAMPLE)
const MU0 = 0.1
const X0 = 2
const POLE = { base: fixedXPole(MU0, X0), muDoubled: fixedXPole(2 * MU0, X0), xDoubled: fixedXPole(MU0, 2 * X0) }
/** √(2/π) 取一位有效數字：估量級用 */
const KQ_COEFF_ROUGH = texNum(kq(1), 1)

/** 各難度需要的計算機功能 */
const CALCULATOR_KEYS: Record<Level, { tools: ReactNode; note: ReactNode }> = {
  beginner: {
    tools: (
      <>
        紙和筆就夠。計算機只會用到 <Tex>{String.raw`+\ -\ \times\ \div`}</Tex> 與平方 <Tex>{String.raw`x^2`}</Tex>。
      </>
    ),
    note: '先做這一級：重點是看懂「哪個數字乘哪個數字」。',
  },
  engineer: {
    tools: (
      <>
        工程計算機：<Tex>{String.raw`\sqrt{x}`}</Tex>、<Tex>{String.raw`x^y`}</Tex>、<Tex>{String.raw`\ln`}</Tex>、<Tex>{String.raw`\log_{10}`}</Tex>、
        <Tex>{String.raw`e^x`}</Tex>／<Tex>{String.raw`10^x`}</Tex>、<Tex>{String.raw`\sin`}</Tex>／<Tex>{String.raw`\cos`}</Tex>／<Tex>{String.raw`\arcsin`}</Tex>
        （先確認 DEG 或 RAD 模式）。
      </>
    ),
    note: '每題的「手算提示」會寫明要按哪個鍵；dB 與常數可查下方的手算工具。',
  },
  research: {
    tools: (
      <>
        另外需要 <Tex>{String.raw`\Phi(z)`}</Tex> 表（下方「手算工具」，或計算機的 <Tex>{String.raw`\operatorname{erf}`}</Tex>）、把複數 <Tex>{String.raw`a + jb`}</Tex>{' '}
        拆成實部／虛部分開算、二次方程式的公式解、<Tex>{String.raw`\operatorname{atan2}`}</Tex>。
      </>
    ),
    note: '步驟比較多，但每一步仍然只做一種運算。',
  },
}

export interface IntroProps {
  all: readonly HandCalcDef[]
  groups: readonly ChapterGroup[]
  /** 示範用的題目（HC-00.1）；不存在時不顯示示範 */
  demo?: HandCalcDef
}

/** §1 為什麼要手算、§2 怎麼用、各難度需要的計算機功能。 */
export function Intro({ all, groups, demo }: IntroProps) {
  const counts = countByLevel(all)
  const firstOf = (level: Level) => all.find((d) => d.level === level)
  return (
    <>
      <section aria-labelledby="wb-s1" className="wb-section">
        <h2 id="wb-s1">1｜為什麼要自己算一次</h2>
        <p>
          看懂推導，和「給我一組晶片數字，我算得出答案」是兩件事。這本練習簿把全站 {groups.length} 個章節／頁面的 <strong>{all.length} 題</strong>
          「帶入手算」收在一起：每一題都是一條公式加上一組數字，用紙、筆和一般工程計算機就能算完，再和網站的模擬函式對答案。自己代一次數字，會得到三樣只讀公式得不到的東西：
        </p>
        <ol className="wb-why">
          <li>
            <strong>量級與單位。</strong>
            <Tex>{String.raw`K_q = \sqrt{2/\pi}\,/\sigma_v`}</Tex> 看起來只是一個常數除以雜訊；把 <Tex>{String.raw`\sigma_v = ${texNum(SIGMA_V_EXAMPLE, 4)}\ \mathrm{fs}`}</Tex> 代進去，才知道它是{' '}
            <Tex>{String.raw`${texNum(KQ_EXAMPLE, 3)}\ \mathrm{fs}^{-1}`}</Tex>——也就是誤差每增加 <Tex>{String.raw`1\ \mathrm{fs}`}</Tex>，1-bit 比較器的平均輸出{' '}
            <Tex>{String.raw`E[q]`}</Tex> 只增加 <Tex>{texNum(KQ_EXAMPLE, 3)}</Tex>（滿刻度是 <Tex>{String.raw`\pm 1`}</Tex>）。這種「原來這麼小」的感覺，只有算過才有。
          </li>
          <li>
            <strong>哪個數字最敏感。</strong>固定輸入的 LMS，誤差每一步乘上 <Tex>{String.raw`p = 1 - \mu x^2`}</Tex>。<Tex>{String.raw`\mu = ${texNum(MU0, 4)},\ x = ${texNum(X0, 4)}`}</Tex> 時{' '}
            <Tex>{String.raw`p = ${texNum(POLE.base, 4)}`}</Tex>；學習率加倍，<Tex>{String.raw`p = ${texNum(POLE.muDoubled, 4)}`}</Tex>（更快）；輸入加倍，
            <Tex>{String.raw`p = ${texNum(POLE.xDoubled, 4)}`}</Tex>（變成負的，開始來回震盪）。同樣是「加倍」，結果差這麼多，是因為 <Tex>x</Tex> 以平方進入公式。
          </li>
          <li>
            <strong>正負號與極性。</strong>全站約定參數誤差是 <Tex>{String.raw`\delta = a - w`}</Tex>（真實值減猜測）。<Tex>{String.raw`\delta > 0`}</Tex> 表示猜得太小，更新就應該把{' '}
            <Tex>w</Tex> 加大。代數字時只要有一個符號放反，<Tex>w</Tex> 會往反方向走——在紙上第一步就看得出來，比在模擬波形裡找容易得多。
          </li>
        </ol>
        <Callout kind="info" title="手算、網站、晶片：三邊互相檢查">
          每一題的詳解都由網站實際執行的模擬函式即時算出（不是另外寫的一份公式）。所以「手算 = 詳解」代表你會用這條公式；「詳解 = 各章的互動實驗」代表模型一致；最後把晶片量到的數字代進同一題，就知道量測與模型差在哪裡。
        </Callout>
      </section>

      <section aria-labelledby="wb-s2" className="wb-section">
        <h2 id="wb-s2">2｜怎麼用這本練習簿</h2>
        <ol className="wb-how">
          <li>
            <strong>改數字，看代入過程。</strong>把輸入框的數字換成你自己的，下方每一步立刻重新排成「符號式 = 代入數字 = 結果」，每一個等號只做一種運算。
          </li>
          <li>
            <strong>自己算算看。</strong>切到「自己算算看」，先用紙筆算，把答案填進去按「對答案」；卡住了再按「看詳解」。答案預設容許 <Tex>{String.raw`1\%`}</Tex>{' '}
            的相對誤差（一般手算的四捨五入），所以中間結果請保留 4–5 位有效數字。
          </li>
          <li>
            <strong>換一題。</strong>「換一題（隨機數字）」會在手算友善的範圍內重新出數字；本頁的「隨機練習」會連題目一起隨機抽，並幫你記下各章的作答與答對題數。
          </li>
          <li>
            <strong>印出來寫。</strong>「練習卷」可以選章節、難度與題數，產生一份有空白作答區的卷子，後面附逐步解答；按「列印／存成 PDF」只會印出卷子本身。
          </li>
        </ol>

        <Diagram
          chart={CHART_HOWTO}
          caption="一題的練習流程：先改數字看代入，再自己算；菱形是「對答案」的判定，不對就看詳解找出哪一步錯。"
          ariaLabel="練習流程圖：挑一題、改成自己的數字、切到自己算算看、填答案對答案；正確就換一題，不對就看詳解、對照每一步找出算錯的地方、改正後重填"
        >
          <p>
            <strong>先看</strong>
            前四個方塊：挑題、換成你自己的數字看代入、切到「自己算算看」用紙筆算、填答案。
            <strong>再看</strong>
            藍色菱形：它就是「對答案」背後的判定，答案落在 <Tex>{String.raw`1\%`}</Tex> 相對誤差內（或和詳解只差 <Tex>{String.raw`10^{-9}`}</Tex> 以內）就算對；對了可以「換一題（隨機數字）」繼續練。
            不對（或卡住了）走棕色的「看詳解」，把你的每個中間結果和詳解逐步對照，找出哪一步算錯再改正重填。
          </p>
        </Diagram>

        {demo && (
          <div className="wb-demo">
            <h3>先試一題</h3>
            <p className="small muted">
              這是<ChRef ch="00">第 00 章</ChRef>的第一題。試著把 <Tex>{String.raw`\mu`}</Tex> 改成 <Tex>0.2</Tex> 看每一步怎麼變，再切到「自己算算看」。
            </p>
            <Diagram
              chart={CHART_DEMO_ORDER}
              caption="這一題的計算順序：①預測、②比較、③修正量、④更新，然後用新的猜測再做一次。"
              ariaLabel="LMS 更新的方塊圖：目前的猜測乘輸入得到預測；量到的輸出減預測得到誤差；誤差乘學習率和輸入得到修正量；修正量加回目前的猜測得到下一個猜測"
            >
              <p>
                <strong>先看</strong>
                <Tex>{String.raw`w_n`}</Tex> 是目前的猜測，<Tex>x</Tex> 是輸入：① 先預測 <Tex>{String.raw`\hat y_n = w_n x`}</Tex>。進加法點時預測帶負號、量到的輸出 <Tex>y</Tex> 帶正號，所以 ② 比較的結果是{' '}
                <Tex>{String.raw`e_n = y - \hat y_n`}</Tex>（<Tex>{String.raw`e_n>0`}</Tex> 表示預測太小）。
              </p>
              <p>
                <strong>再看</strong>
                藍色方塊：③ 修正量 <Tex>{String.raw`\Delta w_n = \mu\,e_n\,x`}</Tex>（學習率 × 誤差 × 輸入，連乘兩次；乘上 <Tex>x</Tex> 自動決定方向）；④ 加回 <Tex>{String.raw`w_n`}</Tex> 得到{' '}
                <Tex>{String.raw`w_{n+1} = w_n + \Delta w_n`}</Tex>。下面這一題就是把這張圖走兩圈（題目裡的下標 0 就是這裡的 <Tex>{String.raw`n=0`}</Tex>），詳解的前四步對應 ①②③④，後兩步是第二圈。
              </p>
            </Diagram>
            <HandCalc def={demo} compact />
          </div>
        )}

        <h3>每一級需要什麼計算機功能</h3>
        <div className="table-wrap">
          <table className="wb-level-table">
            <thead>
              <tr>
                <th scope="col">難度</th>
                <th scope="col">需要的工具</th>
                <th scope="col" className="num">
                  題數
                </th>
                <th scope="col">例題</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => {
                const example = firstOf(level)
                return (
                  <tr key={level} data-level={level}>
                    <th scope="row" className="nowrap">
                      <LevelBadge level={level} />
                    </th>
                    <td>
                      {CALCULATOR_KEYS[level].tools}
                      <div className="small muted">{CALCULATOR_KEYS[level].note}</div>
                    </td>
                    <td className="num">{counts[level]}</td>
                    <td className="nowrap">
                      {example ? (
                        <Link to={`/workbook?hc=${encodeURIComponent(example.id)}`} title={`${LEVEL_LABEL[level]}：${chapterOf(example).nav}`}>
                          {example.id}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <h3>手算的五個好習慣</h3>
        <ol className="wb-habits">
          <li>
            <strong>先估量級，再按計算機。</strong>例如 <Tex>{String.raw`\sqrt{2/\pi}\approx ${KQ_COEFF_ROUGH}`}</Tex>，所以 <Tex>{String.raw`K_q\approx ${KQ_COEFF_ROUGH}/\sigma_v`}</Tex>
            ；按出來差十倍，就是小數點放錯了。
          </li>
          <li>
            <strong>一個等號只做一件事。</strong>先乘、再加、最後開根號，每個中間結果都寫下來，並保留 4–5 位有效數字——兩個很接近的數相減時（例如 <Tex>{String.raw`1 - p`}</Tex>
            ）尤其重要。
          </li>
          <li>
            <strong>單位跟著數字走。</strong>
            <Tex>{String.raw`\mu\,[\mathrm{fs}]\times K\,[\mathrm{fs}^{-1}]`}</Tex> 要剛好沒有單位，才能拿去和 1、2 這些穩定界限比。
          </li>
          <li>
            <strong>每一步問一次方向。</strong>
            <Tex>{String.raw`\delta = a - w > 0`}</Tex> 時 <Tex>w</Tex> 應該變大；pole <Tex>{String.raw`|p| < 1`}</Tex> 才收斂、<Tex>{String.raw`p < 0`}</Tex> 會來回跳。
          </li>
          <li>
            <strong>角度與對數先確認模式。</strong>
            <Tex>{String.raw`\Omega`}</Tex> 的單位是 rad/sample，相位裕度用 deg；<Tex>{String.raw`\ln`}</Tex> 與 <Tex>{String.raw`\log_{10}`}</Tex> 差{' '}
            <Tex>{String.raw`\ln 10 = ${texNum(Math.LN10, 4)}`}</Tex> 倍。
          </li>
        </ol>
        <TexBlock label="每一題的詳解都長這樣：左邊是符號式，中間把數字代進去，右邊是結果">
          {String.raw`\underbrace{p = 1 - \mu x^2}_{\text{符號式}} \;=\; \underbrace{1 - ${texNum(MU0, 4)}\times ${texNum(X0, 4)}^2}_{\text{代入數字}} \;=\; \underbrace{${texNum(POLE.base, 4)}}_{\text{結果}}`}
        </TexBlock>
      </section>
    </>
  )
}
