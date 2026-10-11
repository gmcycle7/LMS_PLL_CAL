import { CodeCompare, ModeGate, Section, StepDerivation, Tex } from '@/components'
import { DOC_JOINT, LOOP_KEYS } from '../data'
import { Claim, DataTable, Diagram, Formula, Kappa, MODEL_PATH, MODEL_SRC, PY_SOURCES, Sci, Src, r } from '../common'

const FVCO_GHZ = [12, 16, 24]

/** §9 GOS 與 PHOS 一起看：9×9 的耦合與 PSD 定理。 */
export function S09Joint() {
  const dec = DOC_JOINT.decoupling_L2
  const scan = DOC_JOINT.joint_scan
  const fv = DOC_JOINT.fvco
  return (
    <Section kind="formula" level={2} title="9. GOS 與 PHOS 一起看：$9\times9$ 的耦合與 PSD 定理" id="cs-9">
      <p>
        §7 與 §8 把 GOS 和 PHOS 分開算。但 9 個權重是同時在學的：GOS 的鋸齒和 PHOS 的 one-hot 會不會互相干擾？答案取決於頻道 <Tex>{r`\alpha=P/Q`}</Tex>（最簡分數；<Tex>{'Q'}</Tex> 也就是 regressor 重複一次的拍數）：
      </p>
      <Diagram id="joint" />
      <p>
        先看菱形：<Tex>{'Q'}</Tex> 是 8 的倍數（或 <Tex>{r`\alpha`}</Tex> 是無理數）時，PMUX 的 8 個相位被選到的次數一樣多（佔用率均勻）。再看兩條出路：均勻時 <Tex>{r`9\times9`}</Tex> 矩陣裡 GOS 與 PHOS 之間的耦合項（<Tex>{r`C_{0k}`}</Tex>、<Tex>{r`C_{k0}`}</Tex>，索引 0 是 GOS、1 到 8 是 PHOS）全部是 0，矩陣拆成 GOS 的{' '}
        <Tex>{r`1\times1`}</Tex> 與 PHOS 的 <Tex>{r`8\times8`}</Tex> 兩塊，§7、§8 的結果可以直接用；不均勻時有耦合，要直接算 <Tex>{r`9\times9`}</Tex> 的特徵值。圖上綠色那一格的 <Tex>{r`C_{0k}=C_{k0}=0`}</Tex> 就是下面 (a) 要說明的事。
      </p>
      <p>
        <strong>(a) 精確解耦</strong>：<Tex>{r`\rho`}</Tex> 的譜線只在 <Tex>{r`\ell\equiv0\ (\mathrm{mod}\ 8)`}</Tex>（頻率 <Tex>{r`m\beta=8m\alpha`}</Tex>）。one-hot 在這些線上的權重除了 <Tex>{r`\ell=0`}</Tex> 以外都是 0，而{' '}
        <Tex>{r`\ell=0`}</Tex> 乘上 <Tex>{r`\Gamma(0)=0`}</Tex>。所以對無理數 <Tex>{r`\alpha`}</Tex> 與 <Tex>{r`8\mid Q`}</Tex>，<Tex>{r`C_{0k}=C_{k0}=0`}</Tex>，<Tex>{r`9\times9`}</Tex> 是 block-diagonal。只有 <Tex>{r`8\nmid Q`}</Tex> 會耦合：
      </p>
      <DataTable
        className="cs-num"
        head={[<Tex key="a">{r`\alpha`}</Tex>, <Tex key="q">{r`8\mid Q`}</Tex>, <>L2 的 <Tex>{r`\max\lvert C_{0,k}\rvert`}</Tex></>]}
        rows={Object.entries(dec).map(([a, v]) => [a, v.eight_div_Q ? '是' : '否', v.max_cross < 1e-15 ? <>0（<Tex>{r`<10^{-15}`}</Tex>）</> : <Sci key="c" v={v.max_cross} sig={2} />])}
      />
      <p>
        <Claim kind="exact" />
      </p>
      <p>
        <strong>(b) 沒有「只在 joint 出現」的反號</strong>：<Tex>{`Q\\le${scan.L2.Q_max}`}</Tex> 的所有化簡有理數（每個迴路 {scan.L2.n_rationals.toLocaleString()} 個）中，joint 反號的有{' '}
        {LOOP_KEYS.map((k) => `${k} ${scan[k].n_joint_inverted} 個`).join('、')}；其中「GOS 與 PHOS 各自都不反號、只有 joint 反號」的是 <strong>{LOOP_KEYS.reduce((a, k) => a + scan[k].n_joint_only, 0)} 個</strong>。所以分開檢查 GOS 與 PHOS 就夠了。
        <Claim kind="approx">有限掃描</Claim>
      </p>
      <p>
        <strong>(c) PSD 定理（充分條件）</strong>——所有對策的理論基礎。前面每一個反號的例子，都是「某條譜線剛好落在 <Tex>{r`\mathrm{Re}\,\Gamma_{\rm eff}<0`}</Tex> 的頻率」。譜線落在哪裡由頻道 <Tex>{r`\alpha`}</Tex> 決定，使用者會換頻道，管不了；但 kernel 的實部是可以設計的：
      </p>
      <Diagram id="psd" />
      <p>
        先看進入加總點的兩條路：一條是頻道決定的譜線位置與權重（權重是絕對值的平方，一定不為負）；另一條是 kernel <Tex>{r`\Gamma_{\rm eff}=H_{PD}\,\overline G`}</Tex> 在那些頻率上的實部。再看藍色方塊：迴路 <Tex>{r`H_{PD}`}</Tex> 改不了，但 regressor 的前置濾波{' '}
        <Tex>{'G'}</Tex> 是你選的。只要把 <Tex>{r`\mathrm{Re}\,\Gamma_{\rm eff}`}</Tex> 做成每個頻率都不為負，不管譜線落在哪裡，加總都不會是負的。圖上加總點的輸出就是下面推導第 3 步的 <Tex>{r`\mathrm{Re}\,\lambda`}</Tex>（<Tex>{r`a_\nu`}</Tex> 是 9 條 regressor 在第{' '}
        <Tex>{r`\nu`}</Tex> 條譜線上的係數排成的向量，<Tex>{'v'}</Tex> 是特徵向量）；菱形的「是」就是第 4 步的結論。
      </p>
      <StepDerivation
        steps={[
          { tex: r`C=\textstyle\sum_\nu \Gamma_\nu\,\overline{a_\nu}\,a_\nu^{T},\qquad a_\nu=(c^0_\nu,\dots,c^8_\nu)`, why: <>§4.3 的結果寫成矩陣形式：每條譜線貢獻一個 rank-1 矩陣，乘上該頻率的 <Tex>{r`\Gamma`}</Tex>。</> },
          { tex: r`Cv=\lambda v,\ \lVert v\rVert=1\ \Rightarrow\ \lambda=v^HCv=\textstyle\sum_\nu \Gamma_\nu\,\lvert a_\nu^Tv\rvert^2`, why: <>左乘 <Tex>{'v^H'}</Tex>；<Tex>{r`v^H\overline{a}=\overline{a^Tv}`}</Tex>。</> },
          { tex: r`\mathrm{Re}\,\lambda=\textstyle\sum_\nu \mathrm{Re}\Gamma_\nu\,\lvert a_\nu^Tv\rvert^2`, why: <>取實部，<Tex>{r`\lvert\cdot\rvert^2`}</Tex> 是實數。</> },
          { tex: r`\mathrm{Re}\,\Gamma_{\rm eff}(f)\ge0\ \ \forall f\ \Rightarrow\ \mathrm{Re}\,\lambda\ge0\ \ \text{對任何 }\alpha\text{、任何 }Q`, why: <>所有權重非負、所有 <Tex>{r`\mathrm{Re}\Gamma\ge0`}</Tex>：非負數的非負加權和不可能是負的。</> },
        ]}
      />
      <Formula id="F-CS.15" />
      <p>
        <Claim kind="exact" />
        它只保證 <Tex>{r`\ge0`}</Tex>（可能有中性、停滯的模態），不保證 <Tex>{'>0'}</Tex>。golden 用一個 <Tex>{r`\mathrm{Re}\Gamma\ge0`}</Tex> 的任意 kernel 抽 200 個隨機有理 <Tex>{r`\alpha`}</Tex> 驗證，最小 <Tex>{r`\mathrm{Re\,eig}`}</Tex> ={' '}
        <Kappa v={DOC_JOINT.theorem_random_kernel_min_re_eig} digits={5} tol={0} />。<strong>只要把 <Tex>{r`\Gamma_{\rm eff}`}</Tex> 的實部做成處處非負，就與 <Tex>{r`\alpha`}</Tex> 無關地安全。</strong>
        raw regressor 做不到（Type-II 的 <Tex>{r`\mathrm{Re}H`}</Tex> 有負區）；一階差分與 filtered-x 做得到（§11）。
      </p>
      <p>
        <strong>
          (d) <Tex>{r`f_{vco}`}</Tex> 不影響符號
        </strong>
        ：理想模型裡所有誤差都對 <Tex>{r`\Delta=T_{vco}/8`}</Tex> 正規化，所以 <Tex>{r`f_{vco}`}</Tex> 不出現在線性分析中。sim 的物理模型有一個 <Tex>{r`\varepsilon/\Delta`}</Tex> 耦合項（GOS 欄），joint 9×9 的 min Re eig 在三個{' '}
        <Tex>{r`f_{vco}`}</Tex> 下：
      </p>
      <DataTable
        className="cs-num"
        head={[<Tex key="a">{r`\alpha`}</Tex>, ...FVCO_GHZ.map((f) => `${f} GHz`)]}
        rows={Object.entries(fv).map(([a, rows]) => [a, ...rows.map((x, i) => <Kappa key={i} v={x.joint_min} digits={7} tol={0} />)])}
        caption={
          <>
            <Tex>{r`8\mid Q`}</Tex> 的點（21/1000）矩陣是 block-triangular，三個 <Tex>{r`f_{vco}`}</Tex> 精確相同——這個測試點本身偵測不到 <Tex>{r`f_{vco}`}</Tex> 依賴；<Tex>{r`8\nmid Q`}</Tex> 的點差約 1%，符號不變。
          </>
        }
      />
      <p>
        <Claim kind="exact">理想模型</Claim>／<Claim kind="approx">物理模型</Claim>
        <Tex>{r`f_{vco}`}</Tex> 會影響的是大訊號與發散之後的行為：SSPD 單調範圍 <Tex>{r`\pm T_{vco}/4`}</Tex>（12／16／24 GHz 分別為 {FVCO_GHZ.map((f) => (1000 / f / 4).toFixed(1)).join('／')} ps）、DTC range、以及 mV 換算成 fs 的比較器 offset。
      </p>
      <Src>
        golden 的 <code>results/doc_numbers.json</code>（<code>joint</code>）；TS 的 <code>kappaRational</code> 在測試中重驗 <Tex>{r`\alpha=1/50`}</Tex> 的耦合與 1diff／fx 的 joint <Tex>{r`\ge0`}</Tex>。
      </Src>
      <ModeGate min="engineer">
        <CodeCompare
          items={[
            { label: 'TypeScript（網站執行）', source: MODEL_SRC, region: 'cPeriodic', path: MODEL_PATH, note: 'Parseval：$C_{ij}=\\sum_k\\overline{F_i[k]}\\,\\Gamma_{\\rm eff}(k/Q)\\,F_j[k]$' },
            { label: 'Python golden', source: PY_SOURCES.predictions.source, region: 'C_periodic', lang: 'python', path: PY_SOURCES.predictions.path, note: '同一個公式的 NumPy 版本（文件的數字由它產生）。' },
          ]}
          caption={r`精確週期穩態的 $9\times9$ 矩陣：$\alpha=P/Q$ 的 regressor 以 $Q$ 為週期，一個 DFT 就得到所有譜線；頻域 kernel 是 $\Gamma_{\rm eff}=H_{PD}\,\overline{G}$。`}
        />
      </ModeGate>
    </Section>
  )
}
