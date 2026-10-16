import { useState } from 'react'
import { Callout, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import { erf } from '@/simulation/core'
import { refValues } from '../refValues'
import { SYMBOL_GROUP_LABEL, SYMBOL_GROUP_ORDER, GLOBAL_SYMBOLS, SYMBOL_COLLISIONS, type GlobalSymbol, type SymbolCollision } from '../symbols'
import { texNum, texPct } from '../format'
import { ErrataList, ErratumTag, Gate, MatchCount, NoMatch, PageLinks, Rich, useMode } from '../common'

/**
 * (2) 全站符號總表（規格 §0 的修正版）＋ 符號衝突速查。
 * Beginner 預設只列核心符號（可一鍵展開全部；有搜尋字串時一律搜尋全部）。
 */
export function SymbolsSection({ rows, collisions, searching }: { rows: GlobalSymbol[]; collisions: SymbolCollision[]; searching: boolean }) {
  const { mode } = useMode()
  const [showAll, setShowAll] = useState(false)
  const r = refValues()
  const coreOnly = mode === 'beginner' && !showAll && !searching
  const shown = coreOnly ? rows.filter((s) => s.core) : rows
  // 先備知識框裡的小例子（現場計算）：一階差分濾波器 h = [1, −1] 作用在 x = [2, 5, 4]
  const convH = [1, -1]
  const convX = [2, 5, 4]
  const convU = convX.map((_, n) => convH.reduce((acc, hk, k) => acc + (n - k >= 0 ? hk * convX[n - k] : 0), 0))
  const within1Sigma = erf(1 / Math.SQRT2) // P(|v| ≤ σ_v)

  return (
    <Section kind="formula" level={2} id="fr-symbols" title="1　全站符號總表（規格 §0，修正版）">
      {!searching && (
        <>
        <p>
          規格 §0 要求「全部網站使用同一套符號、極性與單位」。驗算後發現 §0 本身與後面章節有好幾處衝突（<Tex>{String.raw`\delta`}</Tex> 的極性、
          <Tex>{'u'}</Tex> 的雙重意義、<Tex>{'K'}</Tex> 沒有定義、<Tex>{String.raw`\mu`}</Tex> 的單位…），所以這張表是<strong>修正後</strong>的全站約定：
          「全站約定」欄就是網站實際採用的定義，「規格原文」欄列出被勘誤改掉的寫法，「例」欄的數字都由站內同一套模擬／解析核心即時算出。
        </p>
        <Callout kind="info" title="三條最常用、也最容易弄反的約定">
          <TexBlock>{String.raw`\boxed{\delta_k=a-w_k}\qquad\boxed{\delta w_k=w_k-w^*}\qquad\boxed{K=K_qC,\ \ g=\mu K,\ \ p=1-g}`}</TexBlock>
          <p className="small">
            第一個是「離真實參數還差多少」（<ErratumTag eid="E32" /> <ErratumTag eid="E39" />），第二個是「離 LMS 平衡點偏多少」（雜訊分析用，極性相反，
            <ErratumTag eid="E33" />），第三組讓 <Tex>{String.raw`\mu`}</Tex> 帶單位 <Tex>{String.raw`\mathrm{fs}`}</Tex>、
            <Tex>{'K'}</Tex> 帶 <Tex>{String.raw`\mathrm{fs^{-1}}`}</Tex>、<Tex>{'g'}</Tex> 無因次（<ErratumTag eid="E13" />）。
          </p>
        </Callout>
        <StepDerivation
          title={
            <>
              為什麼 <Tex>{String.raw`\delta`}</Tex> 的極性不影響遞迴、卻會讓圖反號（手算 T01）
            </>
          }
          steps={[
            { tex: String.raw`w_{n+1}=w_n+\mu(y_n-w_nx_n)x_n,\qquad y_n=ax_n`, why: '無雜訊的純量 LMS（規格 §1.2）。' },
            {
              tex: String.raw`a-w_{n+1}=(a-w_n)-{\mu(a-w_n)x_n^2}`,
              why: (
                <>
                  兩邊用 <Tex>{'a'}</Tex> 去減，並把 <Tex>{'y_n-w_nx_n'}</Tex> 寫成 <Tex>{'(a-w_n)x_n'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\delta_{n+1}=(1-\mu x^2)\,\delta_n,\qquad \delta_n\triangleq a-w_n`,
              why: (
                <>
                  提出公因式；這就是全站採用的 <Tex>{String.raw`\delta=a-w`}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`(w_{n+1}-a)=(1-\mu x^2)(w_n-a)`,
              why: (
                <>
                  兩邊同乘 <Tex>{'-1'}</Tex>：§3 的 <Tex>{String.raw`\delta=w-a`}</Tex> 得到同一條遞迴，所以 pole <Tex>{String.raw`1-\mu x^2`}</Tex> 不受影響。
                </>
              ),
            },
            {
              tex: String.raw`\delta_0,\delta_1,\delta_2=${r.t01.delta.map((d) => texNum(d)).join(',\\ ')}\quad\text{vs}\quad{${r.t01.delta.map((d) => texNum(-d)).join(',\\ ')}}`,
              why: (
                <>
                  代入 <Tex>{String.raw`a=${r.t01.a},\ w_0=${r.t01.w0},\ x=${r.t01.x},\ \mu=${r.t01.mu}`}</Tex>（由 lms.ts 的 conventionalStep 算出）：數值完全相反，所以圖表與逐步表一律用
                  <Tex>{'a-w'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <div className="fr-prereq-row">
          <Prereq title="期望值與變異數（表中的平均、雜訊變異數、MSD 都用到）">
            <p>
              期望值就是「同一個隨機實驗做很多次的平均」。例如 comparator 輸出 <Tex>{String.raw`q\in\{+1,-1\}`}</Tex>，<Tex>{'+1'}</Tex> 的機率是 <Tex>{'P'}</Tex>：
            </p>
            <TexBlock>{String.raw`E[q]=(+1)\cdot P+(-1)\cdot(1-P)=2P-1,\qquad \operatorname{Var}(q)=E[q^2]-E[q]^2=1-(2P-1)^2`}</TexBlock>
            <p>
              第二式用到 <Tex>{'q^2\\equiv1'}</Tex>。<Tex>{'N'}</Tex> 個獨立樣本相加時，平均相加、變異數也相加：<Tex>{String.raw`E[S_N]=NE[q]`}</Tex>、
              <Tex>{String.raw`\operatorname{Var}(S_N)=N\operatorname{Var}(q)`}</Tex>，所以訊號 <Tex>{String.raw`\propto N`}</Tex>、雜訊 <Tex>{String.raw`\propto\sqrt N`}</Tex>。
            </p>
          </Prereq>
          <Prereq title="矩陣、特徵值與 condition number（多參數那一組）">
            <p>
              對稱矩陣 <Tex>{String.raw`\mathbf R`}</Tex> 的特徵值 <Tex>{String.raw`\lambda`}</Tex> 與特徵向量 <Tex>{String.raw`\mathbf v`}</Tex> 滿足
              <Tex>{String.raw`\mathbf R\mathbf v=\lambda\mathbf v`}</Tex>：沿著 <Tex>{String.raw`\mathbf v`}</Tex> 方向，矩陣只是把長度乘上 <Tex>{String.raw`\lambda`}</Tex>。
              2×2 例 <Tex>{String.raw`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex>：
            </p>
            <TexBlock>{String.raw`\det(\mathbf R-\lambda\mathbf I)=(1-\lambda)^2-\rho^2=0\;\Rightarrow\;\lambda=1\pm\rho`}</TexBlock>
            <p>
              <Tex>{String.raw`\rho=${r.mimo.rho}`}</Tex> 時 <Tex>{String.raw`\lambda=${texNum(r.mimo.lamMax)},\ ${texNum(r.mimo.lamMin)}`}</Tex>（由 eigSym 算出），
              condition number <Tex>{String.raw`\lambda_{\max}/\lambda_{\min}=${texNum(r.mimo.lamMax / r.mimo.lamMin)}`}</Tex>：scalar <Tex>{String.raw`\mu`}</Tex> 下慢 mode
              的 pole 是 <Tex>{String.raw`1-\mu\lambda_{\min}`}</Tex>，非常接近 1。
            </p>
          </Prereq>
          <Prereq title="常態分布、$\Phi$ 與 $\operatorname{erf}$（comparator 那一組）">
            <p>
              Comparator 前的雜訊 <Tex>{'v'}</Tex> 假設服從常態（Gaussian）分布 <Tex>{String.raw`\mathcal N(0,\sigma_v^2)`}</Tex>：鐘形曲線，數值落在{' '}
              <Tex>{String.raw`\pm\sigma_v`}</Tex> 以內的機率是 <Tex>{texPct(within1Sigma, 4)}</Tex>。<Tex>{String.raw`\Phi(z)`}</Tex> 是「標準常態變數不超過 <Tex>{'z'}</Tex> 的機率」，
              一條從 0 升到 1 的 S 形曲線，<Tex>{String.raw`\Phi(0)=\tfrac12`}</Tex>。誤差函數 <Tex>{String.raw`\operatorname{erf}`}</Tex> 是同一條曲線換個尺度：
              <Tex>{String.raw`2\Phi(z)-1=\operatorname{erf}(z/\sqrt2)`}</Tex>。
            </p>
            <TexBlock>{String.raw`P(q=+1)=P(s+v>0)=\Phi\!\Big(\frac{s}{\sigma_v}\Big),\qquad E[q]=2\Phi\!\Big(\frac{s}{\sigma_v}\Big)-1=\operatorname{erf}\!\Big(\frac{s}{\sqrt2\,\sigma_v}\Big)\approx\sqrt{\frac2\pi}\,\frac{s}{\sigma_v}`}</TexBlock>
            <p>
              最後一步是 <Tex>{String.raw`\operatorname{erf}`}</Tex> 在原點的一階泰勒展開（斜率 <Tex>{String.raw`2/\sqrt\pi`}</Tex>），只在 <Tex>{String.raw`|s|\ll\sigma_v`}</Tex> 時成立。代入{' '}
              <Tex>{String.raw`s=${r.comparator.s}\,\mathrm{fs}`}</Tex>、<Tex>{String.raw`\sigma_v=${r.comparator.sigma}\,\mathrm{fs}`}</Tex>：
              <Tex>{String.raw`P(q=+1)=${texNum(r.comparator.pPlus, 7)}`}</Tex>、<Tex>{String.raw`E[q]=${texNum(r.comparator.meanQ, 6)}`}</Tex>（線性近似 <Tex>{String.raw`K_qs=${texNum(r.comparator.kqTimesS, 6)}`}</Tex>）——
              1 fs 的誤差埋在 100 fs 的雜訊裡，只讓「+1 的機率」比一半多一點點，但它不是零。
            </p>
          </Prereq>
          <Prereq title="卷積 $h*x$ 與相關 $E[xu]$（PLL 路徑那一組）">
            <p>
              卷積 <Tex>{String.raw`u[n]=(h*x)[n]=\sum_kh[k]\,x[n-k]`}</Tex>：把現在與過去幾筆輸入各乘一個權重再加起來，這就是「濾波器」；權重 <Tex>{'h[k]'}</Tex> 叫 impulse response。 例：
              <Tex>{String.raw`h=[${convH.join(',')}]`}</Tex>（一階差分，high-pass）作用在 <Tex>{String.raw`x=[${convX.join(',')}]`}</Tex>：
            </p>
            <TexBlock>{String.raw`u[1]=h[0]x[1]+h[1]x[0]=${convH[0]}\cdot${convX[1]}+(${convH[1]})\cdot${convX[0]}=${texNum(convU[1])},\qquad u[2]=${convH[0]}\cdot${convX[2]}+(${convH[1]})\cdot${convX[1]}=${texNum(convU[2])}`}</TexBlock>
            <p>
              相關 <Tex>{'E[xu]'}</Tex> 是「兩個量相乘之後的長時間平均」：兩者多半同號時為正、多半反號時為負。GMAC 平均往哪個方向推係數，就看{' '}
              <Tex>{'C=E[xu]'}</Tex> 的正負——PLL 的 error path（<Tex>{String.raw`H_{\mathrm{PD}}`}</Tex>）是一個濾波器，它會改變 <Tex>{'C'}</Tex>，甚至讓它變號（<ChRef ch="06">第 6 章</ChRef>）。
            </p>
          </Prereq>
        </div>

        </>
      )}

      <div className="fr-section-bar">
        <MatchCount shown={rows.length} total={GLOBAL_SYMBOLS.length} active={searching} />
        {mode === 'beginner' && !searching && (
          <button type="button" className="btn" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
            {showAll ? '只看核心符號' : `顯示全部 ${GLOBAL_SYMBOLS.length} 個符號`}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <NoMatch what="符號" />
      ) : (
        <div className="table-wrap fr-sym-wrap">
          <table className="fr-table fr-sym-table">
            <thead>
              <tr>
                <th>符號</th>
                <th>意義</th>
                <th>單位</th>
                <th>全站約定（修正版）</th>
                {mode !== 'beginner' && <th>規格原文</th>}
                <th>例（代入數字）</th>
                <th>勘誤</th>
                <th>主要頁面</th>
              </tr>
            </thead>
            {SYMBOL_GROUP_ORDER.map((g) => {
              const groupRows = shown.filter((s) => s.group === g)
              if (groupRows.length === 0) return null
              return (
                <tbody key={g}>
                  <tr className="fr-group-row">
                    <th colSpan={mode !== 'beginner' ? 8 : 7} scope="colgroup">
                      {SYMBOL_GROUP_LABEL[g]}
                    </th>
                  </tr>
                  {groupRows.map((s) => (
                    <tr key={s.key} data-symbol={s.key}>
                      <td data-label="符號" className="fr-sym-cell">
                        <Tex>{s.symbol}</Tex>
                      </td>
                      <td data-label="意義">
                        <Rich text={s.meaning} />
                      </td>
                      <td data-label="單位" className="nowrap">
                        {s.unit ? <Tex>{s.unit}</Tex> : <span className="muted">—</span>}
                      </td>
                      <td data-label="全站約定">
                        <Rich text={s.convention} />
                      </td>
                      {mode !== 'beginner' && (
                        <td data-label="規格原文" className="fr-spec-orig">
                          {s.specOriginal ? <Rich text={s.specOriginal} /> : <span className="muted">（未改）</span>}
                        </td>
                      )}
                      <td data-label="例" className="fr-example">
                        {s.example ? <Rich text={s.example(r)} /> : <span className="muted">—</span>}
                      </td>
                      <td data-label="勘誤">
                        <ErrataList ids={s.errata} />
                      </td>
                      <td data-label="頁面">
                        <PageLinks ids={s.pages} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
      )}
      {coreOnly && <p className="small muted">Beginner 模式只列核心符號；按上方按鈕或在搜尋框輸入關鍵字即可查全部。</p>}

      <Gate min="engineer">
        <h3 className="fr-sub" id="fr-collisions">
          符號衝突速查：同一個字母、不同意義 <MatchCount shown={collisions.length} total={SYMBOL_COLLISIONS.length} active={searching} />
        </h3>
        <p className="small">
          規格裡有不少字母在不同段落代表不同的量（<ErratumTag eid="E34" />）。網站在全站層級改名；只在單一章節內使用、不會混淆的局部符號，則保留該章的寫法並在該章符號表註明（標「局部」）。
        </p>
        {collisions.length === 0 ? (
          <NoMatch what="符號衝突" />
        ) : (
          <div className="table-wrap">
            <table className="fr-table fr-coll-table">
              <thead>
                <tr>
                  <th>字母</th>
                  <th>意義（出處 → 本站寫法）</th>
                  <th>勘誤</th>
                </tr>
              </thead>
              <tbody>
                {collisions.map((c) => (
                  <tr key={c.symbol}>
                    <td data-label="字母" className="fr-sym-cell">
                      <Tex>{c.symbol}</Tex>
                    </td>
                    <td data-label="意義">
                      <ul className="fr-coll-list">
                        {c.meanings.map((m, i) => (
                          <li key={i}>
                            <Tex>{m.tex}</Tex> <span className="muted small">［{m.where}］</span> <Rich text={m.note} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td data-label="勘誤">
                      <ErrataList ids={c.errata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Gate>
    </Section>
  )
}
