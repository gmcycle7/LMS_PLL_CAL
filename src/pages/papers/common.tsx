import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClaimTag, CodeBlock, CodeCompare, HandCalc, ModeGate, Prereq, Tex, TexBlock, mathText } from '@/components'
import bridgeSrc from './bridge.ts?raw'
import { formulaById } from './formulas'
import { handcalc } from './handcalcs'
import { pageById } from '@/app/registry'
import { useSettings, type LearningMode } from '@/app/settings'

export const r = String.raw

export const BRIDGE_PATH = 'src/pages/papers/bridge.ts'

/** 顯示 bridge.ts 的核心程式碼（Engineer 以上；頁面上的數字就是這段程式算的）。 */
export function BridgeCode({ region, caption }: { region: string; caption?: string }) {
  return (
    <ModeGate min="engineer">
      <CodeBlock source={bridgeSrc} region={region} path={BRIDGE_PATH} caption={caption} />
    </ModeGate>
  )
}

/** 並排比較 bridge.ts 的兩段以上程式（差異行以 `// ← 差異：…` 標出）。 */
export function BridgeCompare({ items, caption }: { items: { label: string; region: string; note?: string }[]; caption?: string }) {
  return (
    <ModeGate min="engineer">
      <CodeCompare caption={caption} items={items.map((it) => ({ ...it, source: bridgeSrc, path: BRIDGE_PATH }))} />
    </ModeGate>
  )
}

/** 驗證頁的勘誤深連結：#/verification?e=Exx（驗證頁依 id 展開並捲動到該項勘誤）。 */
export function erratumHref(id: string): string {
  return `#/verification?e=${encodeURIComponent(id)}`
}

/** 「勘誤 Exx」小標記：連到驗證頁（#/verification）的該項勘誤。用純 <a>，不依賴 router context。 */
export function ErratumNote({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <span className="papers-erratum">
      <a href={erratumHref(id)} className="papers-erratum-tag" data-erratum={id} title={`本站與規格書不同之處，見驗證頁的勘誤 ${id}`}>
        勘誤 {id}
      </a>
      {children && <span className="papers-erratum-text">{children}</span>}
    </span>
  )
}

/**
 * 公式登錄錨點：把一段推導包成 id="formula-F-PR.n"（Formula & Unit Reference 頁依這個 id 跳轉並展開祖先 <details>），
 * 下方顯示公式 ID、登錄名稱與結論標籤。名稱與標籤直接讀 formulas.ts，不另外手寫。
 */
export function FormulaAnchor({ id, children }: { id: string; children: ReactNode }) {
  const f = formulaById(id)
  return (
    <div id={`formula-${id}`} className="papers-formula" data-formula={id}>
      {children}
      <div className="papers-formula-foot">
        <span className="c-formula-id" title={`公式 ${id}`}>
          ({id})
        </span>
        <span className="papers-formula-title">{mathText(f.title)}</span>
        <ClaimTag kind={f.claim} />
      </div>
    </div>
  )
}

/** 「帶入手算」題（handcalcs.ts 的 HC-PR.n）：放在對應推導的正後方，讓讀者馬上代數字算一次。 */
export function Hand({ id }: { id: string }) {
  return <HandCalc def={handcalc(id)} />
}

/**
 * 資料檔（references.ts、bridge.ts 的名稱表）裡的文字以 `$…$` 標出 TeX，這裡用共用的 mathText 顯示，
 * 讓資料檔也遵守「數學一律 LaTeX」的規則。
 */
export function RichText({ text }: { text: string }) {
  return <>{mathText(text)}</>
}

/** 本站頁面連結（由 registry 讀名稱與路徑，不手寫章節清單）。 */
export function PageChip({ id }: { id: string }) {
  const p = pageById(id)
  if (!p) return <span className="papers-chip papers-chip-missing">{id}</span>
  return (
    <Link to={p.path} className="papers-chip" title={p.title}>
      {p.nav}
    </Link>
  )
}

export function PageChips({ ids }: { ids: string[] }) {
  return (
    <span className="papers-chips">
      {ids.map((id) => (
        <PageChip key={id} id={id} />
      ))}
    </span>
  )
}

/**
 * 依學習模式決定預設展開的段落：Beginner 預設收合（一鍵展開），Engineer / Research 預設展開。
 * 使用者手動切換後以手動狀態為準。
 */
export function Fold({ title, children, min = 'engineer' }: { title: ReactNode; children: ReactNode; min?: LearningMode }) {
  const { atLeast } = useSettings()
  const auto = atLeast(min)
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? auto
  return (
    <details
      className="papers-fold"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open
        if (now !== open) setManual(now)
      }}
    >
      <summary>
        <span className="papers-fold-title">{title}</span>
        {!auto && <span className="papers-fold-hint">（入門模式預設收合，點一下展開）</span>}
      </summary>
      <div className="papers-fold-body">{children}</div>
    </details>
  )
}

/**
 * 頁內跳轉：HashRouter 下 href="#id" 會被當成路由，所以改用 scrollIntoView（href 保留目前路由，供新分頁開啟）。
 */
export function JumpLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href="#/papers"
      className="papers-jump"
      onClick={(e) => {
        e.preventDefault()
        document.getElementById(to)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
    >
      {children}
    </a>
  )
}

/** 「這次要回答的問題」框 */
export function Question({ children }: { children: ReactNode }) {
  return (
    <div className="papers-question">
      <strong>這一段要回答的問題：</strong>
      {children}
    </div>
  )
}

/** 把浮點殘差（例如 cos 90° = 6e−17）顯示成 0 */
export function clean(x: number, eps = 1e-12): number {
  return Math.abs(x) < eps ? 0 : x
}

/** 小型數字格式：有效位數 digits，極大／極小用科學記號；∞ 與 NaN 照字面。 */
export function num(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '—'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e-4 && ax < 1e7) return String(Number(x.toPrecision(digits))).replace('-', '−')
  const [m, e] = x.toExponential(digits - 1).split('e')
  return `${m.replace('-', '−')}×10^${Number(e)}`
}

/** 數字轉成 TeX（科學記號用 \times 10^{}），方便放進公式。 */
export function texNum(x: number, digits = 4): string {
  const s = num(x, digits)
  const m = /^(.*)×10\^(-?\d+)$/.exec(s)
  if (m) return `${m[1].replace('−', '-')}\\times10^{${m[2]}}`
  return s.replace('−', '-').replace('∞', '\\infty')
}

/** 表格用的數字：一般大小用等寬純文字，科學記號改用 KaTeX（避免用 Unicode 拼出 ×10^n）。 */
export function Num({ x, digits = 4 }: { x: number; digits?: number }) {
  const s = num(x, digits)
  return s.includes('×10^') || s.includes('∞') ? <Tex>{texNum(x, digits)}</Tex> : <>{s}</>
}

/* ───────────── 先備知識框（只假設微積分程度；第一次用到時放在該處） ───────────── */

export function PrereqExpectation() {
  return (
    <Prereq title={r`期望值 $E[\cdot]$ 與變異數 $\mathrm{Var}(\cdot)$`}>
      <p>
        <strong>期望值</strong>（expectation）就是「做很多次再平均」的極限。離散隨機變數取值 <Tex>{'x_i'}</Tex>、機率 <Tex>{'p_i'}</Tex>：
      </p>
      <TexBlock>{r`E[X]=\sum_i x_i\,p_i,\qquad E[g(X)]=\sum_i g(x_i)\,p_i`}</TexBlock>
      <p>
        連續時把 <Tex>{r`\sum`}</Tex> 換成積分 <Tex>{r`\int x f(x)\,dx`}</Tex>（<Tex>{'f'}</Tex> 是機率密度）。期望值是<strong>線性</strong>的：
        <Tex>{r`E[aX+bY]=aE[X]+bE[Y]`}</Tex>，這是下面每個推導都在用的性質。
      </p>
      <p>
        <strong>變異數</strong>（variance）量測「離平均有多散」：<Tex>{r`\mathrm{Var}(X)=E[(X-E[X])^2]=E[X^2]-(E[X])^2`}</Tex>。 例：<Tex>{r`q=\pm1`}</Tex>、
        <Tex>{r`P(q=+1)=0.6\ \Rightarrow\ E[q]=0.6-0.4=0.2`}</Tex>、<Tex>{r`E[q^2]=1`}</Tex>、<Tex>{r`\mathrm{Var}(q)=1-0.2^2=0.96`}</Tex>。
      </p>
    </Prereq>
  )
}

export function PrereqEigen() {
  return (
    <Prereq title="矩陣、特徵值與特徵向量（eigenvalue / eigenvector）">
      <p>
        若一個非零向量 <Tex>{r`\mathbf v`}</Tex> 被矩陣乘完只是「伸縮」：<Tex>{r`\mathbf R\mathbf v=\lambda\mathbf v`}</Tex>，就稱 <Tex>{r`\lambda`}</Tex>{' '}
        為特徵值、
        <Tex>{r`\mathbf v`}</Tex> 為特徵向量。以本站常用的 <Tex>{r`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex> 為例，直接相乘就能驗證：
      </p>
      <TexBlock>{r`\mathbf R\begin{bmatrix}1\\1\end{bmatrix}=(1+\rho)\begin{bmatrix}1\\1\end{bmatrix},\qquad \mathbf R\begin{bmatrix}1\\-1\end{bmatrix}=(1-\rho)\begin{bmatrix}1\\-1\end{bmatrix}`}</TexBlock>
      <p>
        為什麼重要：把誤差 <Tex>{r`\boldsymbol\delta`}</Tex> 拆成沿這兩個方向的分量，遞迴{' '}
        <Tex>{r`\boldsymbol\delta_{k+1}=(\mathbf I-\mu\mathbf R)\boldsymbol\delta_k`}</Tex> 就變成兩條互不干擾的純量遞迴{' '}
        <Tex>{r`c_{i,k+1}=(1-\mu\lambda_i)c_{i,k}`}</Tex>，每條都是等比數列。最慢的那條由最小的 <Tex>{r`\lambda`}</Tex> 決定。
      </p>
    </Prereq>
  )
}

export function PrereqPole() {
  return (
    <Prereq title={r`Z transform、pole 與「試 $z^k$」`}>
      <p>
        線性遞迴最快的解法是猜 <Tex>{r`\delta_k=z^k`}</Tex>（等比數列）。例如 <Tex>{r`\delta_{k+1}=p\,\delta_k`}</Tex> 代入得 <Tex>{'z=p'}</Tex>，所以{' '}
        <Tex>{r`\delta_k=p^k\delta_0`}</Tex>：<Tex>{r`|p|<1`}</Tex> 收斂、<Tex>{r`|p|>1`}</Tex> 發散、<Tex>{'p<0'}</Tex> 正負交替。
      </p>
      <p>
        有延遲時 <Tex>{r`\delta_{k+1}=\delta_k-g\,\delta_{k-d}`}</Tex>，代入 <Tex>{r`z^k`}</Tex> 再同除 <Tex>{r`z^{k-d}`}</Tex>：
      </p>
      <TexBlock>{r`z^{d+1}=z^{d}-g\quad\Longleftrightarrow\quad z^{d+1}-z^{d}+g=0`}</TexBlock>
      <p>
        這個多項式的根叫做 <strong>pole</strong>。一般解是各個 <Tex>{r`z_i^k`}</Tex> 的線性組合，所以「全部 pole 都在單位圓內（<Tex>{r`|z|_{\max}<1`}</Tex>）」與「收斂」是同一件事。 Z transform 只是把這件事寫成 <Tex>{r`\sum_k\delta_k z^{-k}`}</Tex> 的形式。
      </p>
    </Prereq>
  )
}

export function PrereqCorrelation() {
  return (
    <Prereq title="相關（correlation）與積化和差">
      <p>
        兩個訊號的相關 <Tex>{r`E[x\,u]`}</Tex> 就是「逐點相乘再平均」：一起變大變小時為正，步調相反時為負，互不相干時為 0。
        正弦波相乘要用三角恆等式（積化和差）：
      </p>
      <TexBlock>{r`\cos\alpha\cos\beta=\tfrac12\left[\cos(\alpha-\beta)+\cos(\alpha+\beta)\right]`}</TexBlock>
      <p>
        <Tex>{r`\cos(\alpha+\beta)`}</Tex> 若是隨 <Tex>{'n'}</Tex> 振盪的項（頻率 <Tex>{r`2\Omega`}</Tex>，<Tex>{r`0<\Omega<\pi`}</Tex>），長時間平均為
        0，只剩下常數項。
      </p>
    </Prereq>
  )
}

export function PrereqPsd() {
  return (
    <Prereq title="PSD（功率頻譜密度）與 DFT 線譜">
      <p>
        PSD <Tex>{r`S_{xx}(e^{j\Omega})`}</Tex> 告訴你訊號的功率怎麼分布在各個頻率 <Tex>{r`\Omega`}</Tex>（rad/sample）上；全部加起來就是總功率：
      </p>
      <TexBlock>{r`E[x^2]=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,d\Omega\qquad(\text{雙邊、離散時間})`}</TexBlock>
      <p>
        <strong>週期</strong>為 <Tex>{'P'}</Tex> 的序列只含頻率 <Tex>{r`\Omega_k=2\pi k/P`}</Tex>：它的頻譜不是連續的「地毯」，而是一根根譜線（line
        spectrum，也就是 spur）。 對一個週期做 DFT <Tex>{r`E_k=\sum_{n=0}^{P-1}e[n]e^{-j2\pi kn/P}`}</Tex>，<Tex>{r`|E_k|/P`}</Tex> 就是第 <Tex>{'k'}</Tex>{' '}
        條線的複振幅大小； Parseval 定理保證各線功率加總等於 <Tex>{r`\frac1P\sum_n e[n]^2`}</Tex>。
      </p>
    </Prereq>
  )
}

export function PrereqGaussianKq() {
  return (
    <Prereq title={r`Gaussian、$\Phi$ 與 comparator 小訊號增益 $K_q$`}>
      <p>
        雜訊 <Tex>{r`v\sim\mathcal N(0,\sigma_v^2)`}</Tex>（Gaussian，鐘形曲線）。誤差 <Tex>{'s'}</Tex> 加上雜訊後過 1-bit comparator：
        <Tex>{r`P(q=+1)=P(s+v\ge0)=\Phi(s/\sigma_v)`}</Tex>，<Tex>{r`\Phi`}</Tex> 是標準常態的累積分布。於是
      </p>
      <TexBlock>{r`E[q]=2\Phi(s/\sigma_v)-1\approx 2\,\Phi'(0)\,\frac{s}{\sigma_v}=\sqrt{\frac2\pi}\,\frac{s}{\sigma_v}=K_q\,s,\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}`}</TexBlock>
      <p>
        約等號是泰勒一階展開（<Tex>{r`\Phi'(0)=1/\sqrt{2\pi}`}</Tex>），只在 <Tex>{r`|s|\ll\sigma_v`}</Tex> 時成立（Ch05）。
      </p>
    </Prereq>
  )
}

export function PrereqPm() {
  return (
    <Prereq title="相位裕度（phase margin, PM）">
      <p>
        開迴路 <Tex>{r`L(e^{j\omega})`}</Tex> 的大小剛好等於 1 的頻率叫 crossover <Tex>{r`\omega_c`}</Tex>；那裡的相位離 <Tex>{r`-180^\circ`}</Tex>{' '}
        還差多少，就是 PM：
        <Tex>{r`\mathrm{PM}=180^\circ+\angle L(e^{j\omega_c})`}</Tex>。PM 降到 0 時閉迴路剛好有 pole 落在單位圓上（臨界）。
      </p>
    </Prereq>
  )
}
