import {
  Callout,
  ClaimTag,
  CodeCompare,
  ModeGate,
  Quiz,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
} from '@/components'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import {
  polarityMarginArcsin,
  polarityMarginMod180Bug,
  polarityMarginWrap,
  wrap180Spec,
} from '@/simulation/models/stability'
import { ErratumNote, Expand, fx, HandCalcSlot, rich } from '../common'
import { formula } from '../formulas'

const THETAS = [0, 45, 60, 89, 90, 120, 150, 180, 200, -150, 270, -300]
const SRC_PATH = 'src/simulation/models/stability.ts'

/** §8.1 單頻 Polarity Margin（勘誤 E20） */
export function Polarity() {
  return (
    <Section kind="formula" title="§8.1 Polarity margin：只看「更新方向」的工程指標" level={2} id="ch08-polarity">
      <p>
        先回顧 Ch06：單頻 code <Tex>{'x[n]=A\\cos\\Omega n'}</Tex> 經過 PLL error path（增益 <Tex>{'|H|'}</Tex>、相位 <Tex>{'\\phi'}</Tex>）並加上 GMAC 的 code
        delay <Tex>{'D'}</Tex> 之後，GMAC 量到的平均相關是
      </p>
      <TexBlock>{String.raw`E\big[x[n-D]\,u[n]\big]=\frac{A^2}{2}\,|H|\cos\theta,\qquad \theta=\phi+\Omega D .`}</TexBlock>
      <p>
        平均更新的「恢復力」正比於 <Tex>{'\\cos\\theta'}</Tex>：<Tex>{'\\cos\\theta>0'}</Tex> 時 <Tex>{'w'}</Tex> 被拉向 <Tex>{'a'}</Tex>，
        <Tex>{'\\cos\\theta<0'}</Tex> 時被推離（極性錯誤），<Tex>{'\\cos\\theta=0'}</Tex> 時完全沒有恢復力。規格 §8.1 把「<Tex>{'\\theta'}</Tex> 離 <Tex>{'\\pm90^\\circ'}</Tex> 的邊界還有多遠」定義成
        polarity margin。
      </p>
      <TexBlock id="F-08.1" label={rich(String.raw`Polarity margin 與 $\mathrm{wrap}_{180}$ 的精確定義（E20）`)}>
        {formula('F-08.1').tex}
      </TexBlock>
      <p className="small">
        <ErratumNote id="E20">{rich(String.raw`規格只寫 $\mathrm{wrap}_{180}$，沒有定義值域；若照字面實作成 $\theta\bmod180^\circ$，$\theta=-150^\circ$ 會被算成 $+60^\circ$（實際 $-60^\circ$，極性錯誤）`)}</ErratumNote>。注意：核心函式庫的{' '}
        <code>wrap180()</code> 取 <Tex>{'(-180^\\circ,180^\\circ]'}</Tex>，與 E20 的 <Tex>{'[-180^\\circ,180^\\circ)'}</Tex> 只差在 <Tex>{'\\pm180^\\circ'}</Tex> 這一點；因為公式只用{' '}
        <Tex>{'|\\mathrm{wrap}_{180}(\\theta)|'}</Tex>，兩種半開區間得到完全相同的 <Tex>{'M'}</Tex>。
      </p>

      <Expand title={rich(String.raw`為什麼 $90^\circ-|\mathrm{wrap}_{180}(\theta)|$ 一定等於 $\arcsin(\cos\theta)$？（一步一步）`)}>
        <StepDerivation
          steps={[
            { tex: String.raw`\psi\triangleq\mathrm{wrap}_{180}(\theta)\in[-180^\circ,180^\circ),\qquad \cos\theta=\cos\psi`, why: rich(String.raw`$\cos$ 的週期是 $360^\circ$：折回一整圈不改變 $\cos$ 的值。`) },
            { tex: String.raw`\cos\psi=\cos|\psi|`, why: rich(String.raw`$\cos$ 是偶函數：$\cos(-x)=\cos x$。`) },
            { tex: String.raw`\cos|\psi|=\sin\big(90^\circ-|\psi|\big)`, why: rich(String.raw`餘角公式 $\cos x=\sin(90^\circ-x)$。`) },
            { tex: String.raw`0\le|\psi|\le180^\circ\;\Rightarrow\;-90^\circ\le 90^\circ-|\psi|\le 90^\circ`, why: rich(String.raw`這正好是 $\arcsin$ 的主值範圍 $[-90^\circ,90^\circ]$，所以可以直接取反函數。`) },
            { tex: String.raw`\arcsin(\cos\theta)=\arcsin\big(\sin(90^\circ-|\psi|)\big)=90^\circ-|\psi|=M_{\mathrm{polarity}}`, why: rich(String.raw`在主值範圍內 $\arcsin(\sin y)=y$。證畢。`) },
          ]}
          result={String.raw`M_{\mathrm{polarity}}=\arcsin(\cos\theta)\;\Longrightarrow\;\cos\theta=\sin M_{\mathrm{polarity}}`}
        />
        <p className="small">
          最後一式給了 margin 一個直接的物理意義：<strong>有效 GMAC 斜率只剩 <Tex>{'\\sin M'}</Tex> 倍</strong>。<Tex>{'M=30^\\circ'}</Tex> 時恢復力減半，<Tex>{'M=0'}</Tex> 時恢復力為零。
        </p>
      </Expand>

      <h4>先算一次：12 個角度（全部由程式即時計算）</h4>
      <div className="table-wrap">
        <table className="ch08-table">
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$\theta$`)}</th>
              <th className="num">{rich(String.raw`$\mathrm{wrap}_{180}(\theta)$`)}</th>
              <th className="num">{rich(String.raw`$M=90^\circ-|\mathrm{wrap}_{180}|$`)}</th>
              <th className="num">{rich(String.raw`$\arcsin(\cos\theta)$`)}</th>
              <th className="num">{rich(String.raw`$\cos\theta=\sin M$（恢復力比例）`)}</th>
              <th className="num">{rich(String.raw`錯誤的 $\theta\bmod180^\circ$`)}</th>
              <th>判讀</th>
            </tr>
          </thead>
          <tbody>
            {THETAS.map((t) => {
              const m = polarityMarginWrap(t)
              const bug = polarityMarginMod180Bug(t)
              const cos = Math.cos((t * Math.PI) / 180)
              const wrong = Math.sign(bug) !== Math.sign(m) && Math.abs(m) > 1e-9
              return (
                <tr key={t}>
                  <td className="num mono">{t}°</td>
                  <td className="num mono">{fx(wrap180Spec(t), 1)}°</td>
                  <td className="num mono">{fx(m, 2)}°</td>
                  <td className="num mono">{fx(polarityMarginArcsin(t), 2)}°</td>
                  <td className="num mono">{fx(cos, 4)}</td>
                  <td className={`num mono${wrong ? ' ch08-bad' : ''}`}>
                    {fx(bug, 2)}°{wrong ? ' ✗' : ''}
                  </td>
                  <td>{Math.abs(m) < 1e-9 ? rich('$C=0$：沒有恢復力（random walk）') : m > 0 ? '極性正確' : '極性錯誤：平均發散'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {rich(
          String.raw`紅色 ✗：mod-180 實作把「極性錯誤」顯示成正的 margin（E20 的反面測試：$\theta=200^\circ$ → 正確 $${fx(polarityMarginWrap(200), 0)}^\circ$、錯誤 $${fx(polarityMarginMod180Bug(200), 0)}^\circ$；$\theta=-150^\circ$ → 正確 $${fx(polarityMarginWrap(-150), 0)}^\circ$、錯誤 $${fx(polarityMarginMod180Bug(-150), 0)}^\circ$）。`,
        )}
      </p>

      <HandCalcSlot id="HC-08.1">
        {rich(String.raw`把 $\theta$ 換成你量到（或模擬出來）的相位，先用紙筆做一次「加 $180^\circ$ → 取餘數 → 減 $180^\circ$」，看看 margin 是正是負。`)}
      </HandCalcSlot>

      <h4>核心程式碼：三種寫法並排（網站實際執行的版本）</h4>
      <CodeCompare
        items={[
          { label: '正確 wrap（E20）', source: stabilitySrc, region: 'polarityMarginWrap', path: SRC_PATH, note: String.raw`週期 $360^\circ$，值域 $[-180^\circ,180^\circ)$` },
          { label: 'arcsin 封閉式（網站採用）', source: stabilitySrc, region: 'polarityMarginArcsin', path: SRC_PATH, note: String.raw`$M=\arcsin(\cos\theta)$：免 wrap，與正確 wrap 逐點相等` },
          { label: '錯誤：mod 180 寫法', source: stabilitySrc, region: 'polarityMarginMod180Bug', path: SRC_PATH, note: String.raw`反面教材：把週期當成 $180^\circ$，負角度被折成正的` },
        ]}
        caption={String.raw`差異行以「← 差異」標出。單元測試在 2 萬個角度上確認前兩者差 $<10^{-9}$ 度，並與 pll.ts 的 polarityMarginDeg 一致。`}
      />

      <Callout kind="warn" title={String.raw`Polarity margin $\ne$ Phase margin`}>
        <p>
          <Tex>{'M_{\\mathrm{polarity}}'}</Tex> 只回答「平均更新<strong>方向</strong>對不對」——它是 code 頻率 <Tex>{'\\Omega'}</Tex>（comparator rate）上的<strong>靜態</strong>相關性質。
          它<strong>不</strong>回答「校正迴路會不會振盪」：即使 <Tex>{'M=90^\\circ'}</Tex>（完美極性），只要 loop gain <Tex>{'g'}</Tex> 太大或有更新延遲，迴路照樣發散；反過來{' '}
          <Tex>{'M=10^\\circ'}</Tex> 只是讓有效增益變成 <Tex>{String.raw`\sin10^\circ\approx${fx(Math.sin((10 * Math.PI) / 180), 2)}`}</Tex> 倍——收斂變慢，但不會因此振盪。
        </p>
        <p>
          真正的 calibration phase margin 是在 <strong>block rate</strong> 上、對 <Tex>{'L_{\\mathrm{cal}}(z)'}</Tex> 的頻率響應定義的（§8.2）。兩者的頻率軸、物理意義、失效模式都不同（本章末有對照表）。
          {rich(String.raw`規格建議「$M\ge45^\circ$」只是可選的設計守則，不是保證。`)} <ClaimTag kind="exact" />（單頻模型下）
        </p>
      </Callout>

      <ModeGate min="engineer">
        <Expand title="工程補充：多頻 code 時 polarity margin 失去意義" badge="工程">
          <p>
            多頻（DSM、PRBS）code 的相關是整個頻帶的加權積分 <Tex>{'C=\\frac{1}{2\\pi}\\int S_{xx}(\\Omega)\\,\\mathrm{Re}\\{H(e^{j\\Omega})e^{j\\Omega D}\\}\\,d\\Omega'}</Tex>（Ch06 §6.2）。
            此時沒有單一的 <Tex>{'\\theta'}</Tex>；可以用「等效相位」<Tex>{'\\theta_{\\mathrm{eq}}=\\arccos\\!\\big(C/C_{\\max}\\big)'}</Tex> 來報告，但真正的判據永遠是{' '}
            <Tex>{'C>0'}</Tex>（以及下一節的 PM）。
          </p>
        </Expand>
      </ModeGate>

      <Quiz
        title="思考題 1（polarity）"
        question={
          <>
            某架構量到 <Tex>{'\\theta=200^\\circ'}</Tex>。它的 polarity margin 是多少？正的 learning rate 會怎樣？
          </>
        }
        options={[{ label: rich(String.raw`$${fx(polarityMarginMod180Bug(200), 0)}^\circ$，穩定`) }, { label: rich(String.raw`$${fx(polarityMarginArcsin(200), 0)}^\circ$，平均發散`), correct: true }, { label: rich('$+20^\\circ$，收斂但很慢') }, { label: rich('$-20^\\circ$，臨界') }]}
        answer={
          <>
            <Tex>{String.raw`\mathrm{wrap}_{180}(200^\circ)=((200+180)\bmod 360)-180=20-180=-160^\circ`}</Tex>，
            <Tex>{String.raw`M=90^\circ-160^\circ=-70^\circ`}</Tex>；驗算 <Tex>{String.raw`\arcsin(\cos200^\circ)=\arcsin(${fx(Math.cos((200 * Math.PI) / 180), 4)})=${fx(polarityMarginArcsin(200), 2)}^\circ`}</Tex>。
            <Tex>{String.raw`M<0\Rightarrow\cos\theta<0`}</Tex>，更新方向反了，平均誤差會發散；{rich(String.raw`只調小 $\mu$ 不會改變符號。若用錯誤的 $\bmod 180^\circ$ 寫法會得到 $+70^\circ$（選項 A 就是這個 bug）。`)}
          </>
        }
      />
    </Section>
  )
}
