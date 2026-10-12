import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Callout, ClaimTag, Mermaid, ModeGate, Prereq, Tex, TexBlock } from '@/components'
import { QUESTION_LABEL, type QuestionId, type SlotAudit } from '../data'
import { CHART_UNIFIED_LOOP, THREE_QUESTIONS } from '../diagrams'
import { Diagram, ErratumChip, LevelBadges, PageLink, Rich, Steps } from '../common'
import { JumpButton } from './SlotAudit'

const QUESTION_ORDER: QuestionId[] = ['converge', 'where', 'noise']

// 數值驗算表會呼叫 previewPreset（連同各模型模組）：切成 lazy chunk，不拖慢首屏
const UnifiedCheck = lazy(() => import('./UnifiedCheck'))

/**
 * §4 的開場：12 個例子放在同一個框架下——線性化的誤差遞迴 δ_{k+1} = Aδ_k + b + μη_k，
 * 三個問題（走不走得回來／停在哪裡／停下來後抖多大）。表格只列公式；每個例子的數字在各自的即時預覽與 §5 的重算表。
 */
export function UnifiedView({ audit }: { audit: SlotAudit[] }) {
  return (
    <>
      <p>
        12 個 preset 橫跨第 1 章到第 13 章，看起來各講各的；其實它們都在回答同一個校正迴路的三個問題。把係數誤差寫成 <Tex>{'\\delta=a-w'}</Tex>，在收斂點附近把 GMAC 的平均輸出對{' '}
        <Tex>{'\\delta'}</Tex> 做一階泰勒展開，每一個例子都可以整理成同一種遞迴。先看這個迴路長什麼樣子：
      </p>
      <Diagram
        chart={CHART_UNIFIED_LOOP}
        caption="12 個例子共用的校正迴路（純量情形）：真值減去係數得到誤差，乘上斜率後加上固定項與雜訊，再乘步長累加回係數。三個有顏色的方塊各對應一個問題。"
        ariaLabel="統一觀點的校正迴路方塊圖：誤差乘上斜率，加上固定項與雜訊得到 GMAC 輸出，乘上步長後由累加器更新係數並回授"
      >
        <p>
          <strong>先看</strong>迴路本身：左邊的加法點算出 <Tex>{'\\delta_k=a-w_k'}</Tex>（真值為正、回授的 <Tex>{'w_k'}</Tex> 為負）。GMAC 的平均輸出 <Tex>{'G_k'}</Tex> 在收斂點附近是「斜率{' '}
          <Tex>{'K'}</Tex> 乘上 <Tex>{'\\delta_k'}</Tex>」，再加上兩個與 <Tex>{'\\delta_k'}</Tex> 無關的東西：固定項 <Tex>{'B'}</Tex> 與零均值雜訊 <Tex>{'\\eta_k'}</Tex>。最後乘上步長{' '}
          <Tex>{'\\mu'}</Tex>，由累加器加回 <Tex>{'w_k'}</Tex>。
        </p>
        <p>
          <strong>再看</strong>顏色：圖上藍色的斜率 <Tex>{'K'}</Tex> 決定每一步誤差剩下多少（pole <Tex>{'p=1-\\mu K'}</Tex>，問題 (1)）；棕色的 <Tex>{'B'}</Tex> 把停下來的位置從 <Tex>{'a'}</Tex> 推到{' '}
          <Tex>{'w^*=a+B/K'}</Tex>（問題 (2)）；紫色的 <Tex>{'\\eta_k'}</Tex> 讓係數在停下來的位置附近抖動，RMS 是 <Tex>{'\\sigma_w'}</Tex>（問題 (3)）。把這張圖改用 <Tex>{'\\delta'}</Tex>{' '}
          寫成一條式子，就是下面的 F-GA.4：
        </p>
      </Diagram>
      <TexBlock id="F-GA.4">{String.raw`\boldsymbol\delta_{k+1}=\mathbf A\,\boldsymbol\delta_k+\mathbf b+\mu\,\boldsymbol\eta_k:\quad \underbrace{\rho(\mathbf A)<1}_{\text{(1) 走不走得回來}},\quad \underbrace{\boldsymbol\delta_\infty=(\mathbf I-\mathbf A)^{-1}\mathbf b}_{\text{(2) 停在哪裡}},\quad \underbrace{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}}_{\text{(3) 停下來後抖多大（純量）}}`}</TexBlock>
      <div className="c-tag-row">
        <ClaimTag kind="approx" />
        <span className="small muted">
          小訊號線性化的平均（mean）模型；<Tex>{'\\delta=a-w'}</Tex> <ErratumChip eid="E39" />。個別例子在自己的模型內是精確的，見各卡片的標籤。
        </span>
      </div>
      <Mermaid chart={THREE_QUESTIONS} caption="三個問題與 12 個必備 preset 的對應（#10 同時涉及「停在哪裡」與「抖多大」）。" ariaLabel="三個問題對應到 12 個 preset 的分組圖" />
      <Steps
        title="從這條遞迴讀出三個答案（純量情形，只用等比數列與變異數）"
        steps={[
          {
            tex: String.raw`w_{k+1}=w_k+\mu G_k,\quad G_k=K\,\delta_k+B+\eta_k\;\Rightarrow\;\delta_{k+1}=\underbrace{(1-\mu K)}_{p}\,\delta_k\underbrace{-\mu B}_{b}-\mu\,\eta_k`,
            why: '更新式兩邊用 $a$ 去減（$\\delta=a-w$）。$G_k$ 在收斂點附近的一階展開：斜率 $K$（例如 $K_qC$）、與 $\\delta$ 無關的固定項 $B$（offset、INL…造成的平均 GMAC），以及零均值雜訊 $\\eta_k$（變異數 $\\sigma_\\eta^2$、各 block 獨立）。',
          },
          {
            tex: String.raw`\delta_{k+1}=p\,\delta_k+b+\mu\,\eta_k`,
            why: '整理成同一個形狀：$p$ 是 pole，$b$ 是每個 block 被推偏的固定量。$\\eta_k$ 對稱、零均值，前面的負號併入 $\\eta_k$ 的定義——它不影響下面要算的平均與變異數。',
          },
          { tex: String.raw`m_{k+1}=p\,m_k+b,\qquad m_k\equiv E[\delta_k]`, why: '兩邊取期望值：$E[\\eta_k]=0$，常數的期望值是自己，期望值可以逐項相加。' },
          { tex: String.raw`m_k=p^k m_0+b\,(1+p+\dots+p^{k-1})=p^k m_0+b\,\frac{1-p^k}{1-p}`, why: '一項一項展開後是等比級數（公比 $p$）。' },
          { tex: String.raw`|p|<1\;\Rightarrow\;m_k\to\frac{b}{1-p}`, why: '(1) $p^k\\to0$ 才走得回來；(2) 回來之後停在 $b/(1-p)$，只有 $b=0$ 時才是 0（沒有 bias）。' },
          {
            tex: String.raw`\delta_\infty=\frac{b}{1-p}=\frac{-\mu B}{\mu K}=-\frac{B}{K}\;\Rightarrow\;w^*=a-\delta_\infty=a+\frac{B}{K}`,
            why: '代回 $b=-\\mu B$、$1-p=\\mu K$：$\\mu$ 約掉了——停在哪裡與步長無關，只看「固定推力 $B$」與「恢復力的斜率 $K$」的比。$K\\to0$（例如 $C\\to0$）時同樣的 $B$ 會被放大成很大的 bias；#7 的 $1.34$ 就是 $B/K=c_3E[x^4]/E[x^2]$。',
          },
          { tex: String.raw`\mathrm{Var}(\delta_{k+1})=p^2\,\mathrm{Var}(\delta_k)+\mu^2\sigma_\eta^2`, why: '$\\eta_k$ 與 $\\delta_k$ 獨立時變異數相加；常數乘進去要平方；$b$ 是常數，不影響變異數。' },
          { tex: String.raw`\sigma_w^2=p^2\sigma_w^2+\mu^2\sigma_\eta^2\Rightarrow\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`, why: '(3) 穩態時前後兩步的變異數相等，解這個一次方程式。' },
          { tex: String.raw`\text{多參數：}\ p\to\mathbf A,\qquad |p|<1\to\rho(\mathbf A)<1,\qquad \frac{b}{1-p}\to(\mathbf I-\mathbf A)^{-1}\mathbf b`, why: '每個 eigenvalue 是一個獨立方向上的 pole；$\\mathbf I-\\mathbf A$ 不可逆（有 eigenvalue 等於 1）時，那個方向的固定點不唯一——這就是 #11 的不可辨識。' },
        ]}
        result={String.raw`\rho(\mathbf A)<1,\qquad \boldsymbol\delta_\infty=(\mathbf I-\mathbf A)^{-1}\mathbf b,\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`}
      />
      <Suspense fallback={<p className="small muted gal-loading">載入模型模組並驗算中…</p>}>
        <UnifiedCheck audit={audit} />
      </Suspense>
      <div className="gal-prereqs">
        <Prereq title="期望值 $E[\cdot]$ 與變異數：這裡只用到三條規則">
          <p>
            <strong>期望值（expectation）</strong>是「重複很多次之後的平均」。<strong>變異數（variance）</strong> <Tex>{'\\mathrm{Var}(X)=E[(X-E[X])^2]'}</Tex> 是「離平均多遠」的平方的平均，開根號就是 RMS。上面只用到：
          </p>
          <ol>
            <li>
              線性：<Tex>{'E[aX+b]=a\\,E[X]+b'}</Tex>，<Tex>{'E[X+Y]=E[X]+E[Y]'}</Tex>。
            </li>
            <li>
              常數乘進變異數要平方、加常數不影響：<Tex>{'\\mathrm{Var}(aX+b)=a^2\\,\\mathrm{Var}(X)'}</Tex>。
            </li>
            <li>
              <Tex>{'X,Y'}</Tex> 獨立時 <Tex>{'\\mathrm{Var}(X+Y)=\\mathrm{Var}(X)+\\mathrm{Var}(Y)'}</Tex>。
            </li>
          </ol>
          <p>
            從頭的說明在<Link to="/ch/00">第 0 章</Link>（雜訊平均）與<Link to="/ch/05">第 5 章</Link>（comparator）。
          </p>
        </Prereq>
        <Prereq title="標準常態分布的 $\Phi$、erf 與 comparator 增益 $K_q$（#2、#7、#8 會用到）">
          <p>
            雜訊 <Tex>{'v'}</Tex> 是平均 0、RMS <Tex>{'\\sigma_v'}</Tex> 的 Gaussian（高斯分布）時，<Tex>{'\\Phi(z)'}</Tex> 定義為「標準化後的值不超過 <Tex>{'z'}</Tex> 的機率」：
            <Tex>{'\\Phi(z)=\\int_{-\\infty}^{z}\\tfrac{1}{\\sqrt{2\\pi}}e^{-t^2/2}\\,dt'}</Tex>。comparator 輸出 <Tex>{'q=+1'}</Tex> 的條件是 <Tex>{'s+v\\ge0'}</Tex>，機率就是{' '}
            <Tex>{'\\Phi(s/\\sigma_v)'}</Tex>；所以 <Tex>{'E[q]=(+1)\\Phi+(-1)(1-\\Phi)=2\\Phi(s/\\sigma_v)-1=\\operatorname{erf}\\!\\big(\\tfrac{s}{\\sqrt2\\,\\sigma_v}\\big)'}</Tex>。對 <Tex>{'s'}</Tex> 微分並在{' '}
            <Tex>{'s=0'}</Tex> 取值，得到小訊號增益 <Tex>{'K_q=2\\cdot\\tfrac{1}{\\sqrt{2\\pi}}\\cdot\\tfrac{1}{\\sigma_v}=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>（單位 <Tex>{'\\mathrm{fs^{-1}}'}</Tex>）：誤差每多 1 fs，<Tex>{'E[q]'}</Tex>{' '}
            增加多少。完整推導在<Link to="/ch/05">第 5 章</Link>。
          </p>
        </Prereq>
        <Prereq title="相關（correlation）$C=E[x\,u]$ 為什麼可以是負的（#3、#4）">
          <p>
            <Tex>{'C'}</Tex> 是「regressor <Tex>{'x'}</Tex> 與 PD 看到的訊號 <Tex>{'u'}</Tex> 相乘後的長時間平均」。單頻時 <Tex>{'x=A\\cos\\Omega n'}</Tex>、<Tex>{'u=A|H|\\cos(\\Omega n+\\varphi)'}</Tex>，用積化和差{' '}
            <Tex>{'\\cos\\alpha\\cos\\beta=\\tfrac12[\\cos(\\alpha-\\beta)+\\cos(\\alpha+\\beta)]'}</Tex>：<Tex>{'x\\,u=\\tfrac{A^2|H|}{2}[\\cos\\varphi+\\cos(2\\Omega n+\\varphi)]'}</Tex>。第二項隨時間振盪，平均為 0（<Tex>{'0<\\Omega<\\pi'}</Tex>），剩下{' '}
            <Tex>{'C=\\tfrac{A^2}{2}|H|\\cos\\varphi'}</Tex>。相位 <Tex>{'\\varphi'}</Tex> 超過 <Tex>{'90^\\circ'}</Tex> 時 <Tex>{'\\cos\\varphi<0'}</Tex>，更新方向就反了。完整推導在<Link to="/ch/06">第 6 章</Link>；<Tex>{'\\Omega=0'}</Tex> 或{' '}
            <Tex>{'\\pi'}</Tex> 的例外見 <ErratumChip eid="E46" />。
          </p>
        </Prereq>
        <Prereq title="矩陣的 eigenvalue 與 spectral radius $\rho(\mathbf A)$">
          <p>
            若 <Tex>{'\\mathbf A\\mathbf v=\\lambda\\mathbf v'}</Tex>（<Tex>{'\\mathbf v\\ne\\mathbf 0'}</Tex>），<Tex>{'\\lambda'}</Tex> 叫 eigenvalue、<Tex>{'\\mathbf v'}</Tex> 叫 eigenvector：沿著{' '}
            <Tex>{'\\mathbf v'}</Tex> 的方向，矩陣的作用只是乘上一個數。所以 <Tex>{'\\boldsymbol\\delta_0=\\mathbf v'}</Tex> 時 <Tex>{'\\boldsymbol\\delta_k=\\lambda^k\\mathbf v'}</Tex>——每個 eigenvalue 就是那個方向上的 pole。
            <strong>Spectral radius</strong> <Tex>{'\\rho(\\mathbf A)=\\max_i|\\lambda_i|'}</Tex> 是最不聽話的那個 pole 的大小；它小於 1，所有方向才都收斂。<Tex>{'2\\times2'}</Tex> 的例子：
            <Tex>{'\\det(\\mathbf A-\\lambda\\mathbf I)=0'}</Tex> 是 <Tex>{'\\lambda'}</Tex> 的二次方程式，用公式解即可（#5、#6、#12 的預覽都有代入數字的步驟）。詳見<Link to="/ch/09">第 9 章</Link>。
          </p>
        </Prereq>
        <Prereq title="PSD、$-3\,\mathrm{dB}$ 頻寬、ENBW 與 dBc（#8、#9）">
          <p>
            <strong>PSD（power spectral density，功率頻譜密度）</strong> <Tex>{'S_w^{(1)}(f)'}</Tex> 說的是「變異數在各個頻率上分到多少」：把它從 0 積到取樣率的一半，就得到總變異數{' '}
            <Tex>{'\\sigma_w^2=\\int_0^{f_u/2}S_w^{(1)}(f)\\,df'}</Tex>（上標 <Tex>{'(1)'}</Tex> 表示 one-sided，單位 <Tex>{'\\mathrm{fs^2/Hz}'}</Tex>）。#8 的遞迴{' '}
            <Tex>{'\\delta w_{k+1}=p\\,\\delta w_k+\\mu\\eta_k'}</Tex> 是一個一階 low-pass：<Tex>{'|H_{\\eta\\to w}(e^{j\\Omega})|^2=\\mu^2/(1-2p\\cos\\Omega+p^2)'}</Tex>，低頻的雜訊通過、高頻的被擋掉。
          </p>
          <ul>
            <li>
              <strong><Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬</strong> <Tex>{'f_{3\\mathrm{dB}}'}</Tex>：<Tex>{'|H|^2'}</Tex> 降到 DC 值一半的頻率——描述「形狀在哪裡轉折」。
            </li>
            <li>
              <strong>ENBW（equivalent noise bandwidth，等效雜訊頻寬）</strong>：把 PSD 換成一個高度等於 DC 值的矩形，面積（總變異數）不變時的寬度，
              <Tex>{'\\mathrm{ENBW}=\\sigma_w^2/S_w^{(1)}(0)=\\tfrac{f_u}{2}\\tfrac{1-p}{1+p}'}</Tex>——描述「積分起來有多少」。兩者不是同一個數（<Tex>{'p\\to1'}</Tex> 時 ENBW 約為{' '}
              <Tex>{'\\tfrac{\\pi}{2}f_{3\\mathrm{dB}}'}</Tex>），把 <Tex>{'f_{3\\mathrm{dB}}'}</Tex> 當成 noise BW 去乘 <Tex>{'S_w^{(1)}(0)'}</Tex> 會低估 <Tex>{'\\sigma_w'}</Tex> <ErratumChip eid="E06" />。
            </li>
            <li>
              <strong>dBc</strong>：spur 相對載波（carrier）的功率比，取 <Tex>{'10\\log_{10}'}</Tex>。相位被 <Tex>{'\\beta\\sin(2\\pi f_mt)'}</Tex> 調變、且 <Tex>{'\\beta\\ll1'}</Tex> 時，每一根 sideband 的振幅是載波的{' '}
              <Tex>{'\\beta/2'}</Tex> 倍，所以是 <Tex>{'20\\log_{10}(\\beta/2)'}</Tex>（#9）。
            </li>
          </ul>
          <p>
            完整推導（含 one-sided／two-sided 的換算 <ErratumChip eid="E28" />）在<Link to="/ch/12">第 12 章</Link>。
          </p>
        </Prereq>
      </div>
      <div className="table-wrap">
        <table className="gal-table gal-unified-table">
          <caption className="small muted">12 個例子的誤差模型（只列公式；數字見各卡片的即時預覽或 §5 的重算表）</caption>
          <thead>
            <tr>
              <th>#</th>
              <th>現象</th>
              <th>層級</th>
              <th>誤差怎麼演化</th>
              <th>回答的問題</th>
              <th>頁面</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.slot.index} data-unified={a.slot.index}>
                <td>
                  <JumpButton domId={`gal-slot-h-${a.slot.index}`}>#{a.slot.index}</JumpButton>
                </td>
                <td>
                  <Rich text={a.slot.lesson} />
                </td>
                <td>{a.preset ? <LevelBadges preset={a.preset} /> : <span className="small muted">—</span>}</td>
                <td className="gal-unified-math">
                  <Tex>{a.slot.dynamics}</Tex>
                </td>
                <td className="small">
                  {QUESTION_ORDER.filter((q) => a.slot.questions.includes(q)).map((q) => (
                    <span key={q} className={`gal-q gal-q-${q}`}>
                      {QUESTION_ORDER.indexOf(q) === 0 ? '(1)' : QUESTION_ORDER.indexOf(q) === 1 ? '(2)' : '(3)'} {QUESTION_LABEL[q]}
                    </span>
                  ))}
                </td>
                <td className="small">{a.preset ? <PageLink path={a.preset.page} /> : <span className="muted">{a.slot.pages[0]}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModeGate min="engineer">
        <Callout kind="warn" title="線性化的適用範圍">
          <ul>
            <li>
              (1) 的 <Tex>{'\\rho(\\mathbf A)<1'}</Tex> 是<strong>平均（mean）收斂</strong>的條件。隨機 regressor 的均方穩定條件更嚴（<ErratumChip eid="E23" />，#6 的預覽列出 mean-square 半徑）；1-bit comparator
              在大誤差時飽和，指數發散會變成線性漂移（#3）。
            </li>
            <li>
              (2) 的固定點要用<strong>實際的平均 GMAC</strong> <Tex>{'E[G](w)=0'}</Tex> 求（#7 的 Sign-LMS 用 erf，而不是線性公式，<ErratumChip eid="E01" />）。
            </li>
            <li>
              (3) 的 <Tex>{'\\sigma_w'}</Tex> 是 gain-equivalent 的係數雜訊，不是 output jitter；要再乘上 code（<ErratumChip eid="E09" />）並經過 PLL 的 <Tex>{'T'}</Tex> 才到輸出（#9）。成立前提見 <ErratumChip eid="E30" />。
            </li>
          </ul>
        </Callout>
      </ModeGate>
    </>
  )
}
