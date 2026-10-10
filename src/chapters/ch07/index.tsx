import { Callout, ClaimTag, ModelLevel, Section, SymbolTable, Tex, TestBadge, type SymbolEntry } from '@/components'
import { useSettings } from '@/app/settings'
import { ErratumNote } from './ErratumNote'
import { Hand } from './Hand'
import { S1Problem } from './sections/S1Problem'
import { S2DelayDerivation } from './sections/S2DelayDerivation'
import { S3LinearPhase } from './sections/S3LinearPhase'
import { S4Gradient } from './sections/S4Gradient'
import { S5Mismatch } from './sections/S5Mismatch'
import { S6Hardware } from './sections/S6Hardware'
import { S7Wrapup } from './sections/S7Wrapup'
import { DelayFxLab } from './experiments/DelayFxLab'
import './chapter.css'

const r = String.raw

const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: '原始 DTC／DSM code（GMAC 的 raw regressor）', unit: r`\text{無因次}`, firstSeen: '§7.1', note: <>§0 約定；Lab 中正規化成 unit power <Tex>{r`E[x^2]=1`}</Tex></> },
  {
    symbol: 'A',
    meaning: <>單頻 code 的振幅：<Tex>{r`x[n]=A\cos(\Omega n)`}</Tex></>,
    unit: r`\text{無因次}`,
    firstSeen: '§7.1',
    note: <>§7.1–7.2 的手算用 <Tex>{'A=1'}</Tex>（<Tex>{r`C_D`}</Tex> 最大 0.5）；§7.5 與 Lab 用 unit power <Tex>{r`A=\sqrt2`}</Tex>（最大 1，所有 <Tex>{'C'}</Tex> 變 2 倍）</>,
  },
  {
    symbol: r`u[n]=(h*x)[n]`,
    meaning: '經 PLL 誤差路徑到達 PD 的有效 regressor（comparator 實際「看到」的 code）',
    unit: r`\text{無因次}`,
    firstSeen: '§7.1',
    note: <>§0 定義；§11 的干擾已改名 <Tex>{r`\varepsilon_{\mathrm{cc}}`}</Tex>（E12）</>,
  },
  {
    symbol: r`h[k],\ H(e^{j\Omega})=|H|e^{j\phi}`,
    meaning: 'DTC 誤差 → PD residual 的脈衝響應與頻率響應',
    unit: '—',
    firstSeen: '§7.2',
    note: (
      <>
        一律離散時間；不可代入 CT 的 <Tex>{r`H(j\omega)`}</Tex>（<ErratumNote id="E44" />）。<Tex>{'h[k]'}</Tex>、<Tex>{r`\sum_k`}</Tex> 裡的 <Tex>{'k'}</Tex> 是 tap（延遲幾個
        sample）的編號，與 block 編號（只出現在下標 <Tex>{r`w_k,\ G_k,\ \delta_k`}</Tex>）無關
      </>
    ),
  },
  { symbol: r`\Omega`, meaning: '離散時間頻率（comparator 取樣率上）', unit: r`\mathrm{rad/sample}`, firstSeen: '§7.1', note: <Tex>{r`\Omega=2\pi f/f_s`}</Tex> },
  { symbol: r`\phi=\angle H(e^{j\Omega})`, meaning: <>誤差路徑在 code 頻率的相位；<Tex>{r`\phi<0`}</Tex> 表示 <Tex>{'u'}</Tex> 落後 <Tex>{'x'}</Tex></>, unit: r`\mathrm{rad}\ (\text{或 deg})`, firstSeen: '§7.1' },
  {
    symbol: 'D',
    meaning: 'GMAC code 的延遲（shift register 級數）',
    unit: r`\text{samples}`,
    firstSeen: '§7.1',
    note: <>本章 <Tex>{'D'}</Tex> 一律指延遲 code（相位 <Tex>{r`+\Omega D`}</Tex>）；§16.1 的 code delay 也改用 <Tex>{'D'}</Tex>（E34）</>,
  },
  { symbol: r`x_D[n]=x[n-D]`, meaning: 'delayed-x regressor', unit: r`\text{無因次}`, firstSeen: '§7.1' },
  { symbol: r`\theta=\mathrm{wrap}_{180}(\phi+\Omega D)`, meaning: <>殘餘相位；<Tex>{r`|\theta|<90^\circ`}</Tex> 才有正的恢復力</>, unit: r`\mathrm{deg}`, firstSeen: '§7.1' },
  { symbol: r`M_{\mathrm{pol}}=90^\circ-|\theta|`, meaning: 'polarity margin：殘餘相位離變號還有幾度', unit: r`\mathrm{deg}`, firstSeen: '§7.1', note: '§8.1 的自訂單頻指標，不是 Bode phase margin' },
  { symbol: r`C,\ C_D`, meaning: <>GMAC regressor 與 <Tex>{'u'}</Tex> 的相關 <Tex>{r`E[x_{\mathrm{ref}}u]`}</Tex>（決定更新極性）</>, unit: r`\text{無因次}`, firstSeen: '§7.1', note: <>單頻 unit-power code：<Tex>{r`A^2/2=1`}</Tex></> },
  { symbol: r`C'_D`, meaning: <>延遲 comparator 誤差時的相關 <Tex>{r`E[x[n]u[n-D]]`}</Tex>（相位 <Tex>{r`\phi-\Omega D`}</Tex>）</>, unit: r`\text{無因次}`, firstSeen: '§7.2' },
  { symbol: r`\hat H,\ \hat h`, meaning: '誤差路徑的模型（filtered-x 用）', unit: '—', firstSeen: '§7.4', note: <ErratumNote id="E45" /> },
  { symbol: r`u_f=\hat h*x`, meaning: 'filtered-x regressor', unit: r`\text{無因次}`, firstSeen: '§7.4' },
  { symbol: r`x_{\mathrm{ref}}[n]`, meaning: <>GMAC 實際相乘的 regressor：<Tex>{'x'}</Tex>、<Tex>{'x_D'}</Tex> 或 <Tex>{r`u_f[n-D]`}</Tex></>, unit: r`\text{無因次}`, firstSeen: '§7.4' },
  { symbol: r`e_{\mathrm{PD}}[n],\ v[n]`, meaning: <>comparator 前的 PD 誤差、雜訊（標準差 <Tex>{r`\sigma_v`}</Tex>）</>, unit: r`\mathrm{fs}`, firstSeen: '§7.4' },
  { symbol: r`q[n]=\mathrm{sign}(e_{\mathrm{PD}})`, meaning: '1-bit comparator 輸出', unit: r`\pm1`, firstSeen: '§7.4', note: <><Tex>{r`e\ge0\Rightarrow q=+1`}</Tex>（E07）</> },
  { symbol: r`\delta=a-w`, meaning: <>剩餘 gain 誤差（<Tex>{'a'}</Tex>：真實 DTC gain，<Tex>{'w'}</Tex>：校正係數）</>, unit: r`\mathrm{fs}\ \text{per unit code}`, firstSeen: '§7.4', note: <>本章採 <Tex>{r`\delta=a-w`}</Tex>（§0；E32）</> },
  { symbol: r`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號增益', unit: r`\mathrm{fs^{-1}}`, firstSeen: '§7.1', note: 'Ch05' },
  { symbol: r`\mu`, meaning: 'learning rate（gain_step，average 模式）', unit: r`\mathrm{fs}`, firstSeen: '§7.1' },
  { symbol: r`G_k,\ N`, meaning: <>第 <Tex>{'k'}</Tex> 個 GMAC block 的平均相關輸出；每 block 的 sample 數</>, unit: r`\text{無因次}`, firstSeen: '§7.4', note: <><Tex>{'n'}</Tex>：sample，<Tex>{'k'}</Tex>：block（E35）</> },
  { symbol: r`p,\ p_f`, meaning: <>平均更新 pole <Tex>{r`1-\mu K_qC`}</Tex>；filtered-x 時 <Tex>{'C'}</Tex> 換成 <Tex>{r`E[u\,u_f]`}</Tex></>, unit: '—', firstSeen: '§7.1' },
  {
    symbol: r`g=\mu K_qC,\ \tau=-1/\ln|p|`,
    meaning: <>校正迴路的 loop gain（每個 block 修正掉的誤差比例，<Tex>{'p=1-g'}</Tex>）與時間常數</>,
    unit: r`-,\ \text{blocks}`,
    firstSeen: '§7.1',
  },
  { symbol: r`J(w)=\tfrac12E[e_{\mathrm{PD}}^2]`, meaning: 'PD 端的均方誤差（要最小化的 cost）', unit: r`\mathrm{fs^2}`, firstSeen: '§7.4' },
  {
    symbol: r`s[n]=(a-w)\,u[n]`,
    meaning: <>comparator 輸入中由 code 決定的部分（訊號；雜訊是 <Tex>{'v'}</Tex>）</>,
    unit: r`\mathrm{fs}`,
    firstSeen: '§7.4',
    note: <>與 Ch05 的 <Tex>{'s'}</Tex> 相同；不要和 §7.5 連續時間原型 <Tex>{r`H_{\mathrm{PD}}(s)`}</Tex> 的 Laplace 變數 <Tex>{'s'}</Tex> 混淆</>,
  },
  { symbol: r`\eta_k,\ \sigma_w`, meaning: <>GMAC 每個 block 的平均雜訊；穩態時 <Tex>{'w'}</Tex> 的標準差（抖動）</>, unit: r`-,\ \mathrm{fs}`, firstSeen: '§7.4', note: 'Ch12 的主題' },
  { symbol: r`\rho_{\mathrm{ref}}`, meaning: <>正規化相關 <Tex>{r`C/\sqrt{E[x_{\mathrm{ref}}^2]E[u^2]}`}</Tex>（每單位 regressor 功率的恢復力）</>, unit: r`[-1,1]`, firstSeen: '§7.4' },
  { symbol: r`S_{xx}(e^{j\Omega}),\ R_x[m]`, meaning: 'code 的雙邊 DTFT PSD 與自相關', unit: r`\text{無因次}`, firstSeen: '§7.3', note: <><Tex>{r`\sigma_x^2=\frac1{2\pi}\int S_{xx}\,d\Omega`}</Tex>（E28）</> },
  {
    symbol: r`\omega_nT_s,\ \zeta,\ d`,
    meaning: 'Type-II DPLL 的正規化自然頻率、阻尼、額外 loop latency',
    unit: r`\mathrm{rad/sample},\ -,\ \text{samples}`,
    firstSeen: '§7.3',
    note: <>此 <Tex>{'d'}</Tex> 是 PLL loop latency（samples），不是 §8.3 的 GMAC 更新延遲（blocks）</>,
  },
  { symbol: r`K_p=2\zeta\omega_nT_s,\ K_i=(\omega_nT_s)^2`, meaning: 'DPLL 的 PI loop filter 係數（E44 的 DT 參考模型）', unit: '—', firstSeen: '§7.5' },
  {
    symbol: r`\Delta`,
    meaning: <><Tex>{r`\hat H`}</Tex> 多算的額外 latency（<Tex>{r`\hat H=H\,z^{-\Delta}`}</Tex>）</>,
    unit: r`\text{samples}`,
    firstSeen: '§7.5',
  },
  { symbol: r`\nabla\equiv1-z^{-1}`, meaning: <>一階差分（backward difference）；§7.5 推導 DT 的 <Tex>{r`H_{\mathrm{PD}}(z)`}</Tex> 時使用</>, unit: '—', firstSeen: '§7.5' },
  {
    symbol: r`\hat H_2=K_2\,(1-z^{-1})^2,\ K_2=1/(\hat\omega_nT_s)^2`,
    meaning: 'Type-II 的二次差分 regressor（低頻近似）與它的增益',
    unit: '—',
    firstSeen: '§7.5',
    note: <><Tex>{r`K_2=1/\hat K_i`}</Tex>；只影響 <Tex>{'g'}</Tex> 的大小，不影響極性</>,
  },
  {
    symbol: r`\rho_x`,
    meaning: <>AR(1) code 的係數：<Tex>{r`R_x[m]=\rho_x^{|m|}`}</Tex>（接近 1 = 低通）</>,
    unit: r`(-1,1)`,
    firstSeen: '§7.3',
    note: <>不要和正規化相關 <Tex>{r`\rho_{\mathrm{ref}}`}</Tex> 混淆</>,
  },
  { symbol: r`d_{\mathrm{upd}}`, meaning: <>GMAC 更新延遲（blocks；規格 §8.3 的 <Tex>{'d'}</Tex>）</>, unit: r`\text{blocks}`, firstSeen: '§7.10', note: 'Ch08 的主題' },
]

/** Chapter 07：Delay Alignment vs. Filtered-x LMS（規格 §7；課程第 7 課）。 */
export default function Chapter07() {
  const { mode } = useSettings()
  return (
    <div className="ch07">
      <p className="ch07-lead">
        Ch06 證明了：PLL 的誤差路徑 <Tex>{r`H_{\mathrm{PD}}`}</Tex> 可以讓 GMAC 的相關 <Tex>{'C=E[xu]'}</Tex> 變號，LMS 往錯的方向更新，而且
        <strong>減小 learning rate 改不了符號</strong>。本章比較兩種修法：把 GMAC 的 code <strong>延遲</strong>幾個 sample（delay alignment），
        或用 PLL 誤差路徑的<strong>模型</strong>把 code 濾一次（filtered-x）。我們會推導它們何時有效、何時失效，算出硬體成本，並在同一個 seed
        下比較閉迴路。
      </p>
      <div className="c-tag-row">
        <ModelLevel level="L2" /> <TestBadge id="T07" /> <ClaimTag kind="exact" />
      </div>
      {mode === 'beginner' && (
        <Callout kind="info" title="入門模式：先抓住三句話">
          <ol>
            <li>GMAC 是在算「code 和 comparator 看到的誤差同不同步」；PLL 讓誤差晚到，就把 code 也延遲同樣的時間。</li>
            <li>但延遲只能對準一個頻率；code 若有很多頻率（DSM），要用 PLL 的模型 <Tex>{r`\hat H`}</Tex> 把 code 濾一次（filtered-x）。</li>
            <li>
              模型若錯太多（相位差超過 <Tex>{r`90^\circ`}</Tex>），filtered-x 一樣會反向更新。入門模式下推導預設收合（點「推導」展開，boxed 結論仍會顯示）；可以先看 7.1
              節的數字和 7.7 節的 Lab，再回頭展開。
            </li>
          </ol>
        </Callout>
      )}
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            時間索引：<Tex>{'n'}</Tex> = comparator sample、<Tex>{'k'}</Tex> = GMAC block。本章例子皆為 illustrative，非晶片量測；所有表格數字由
            <code>src/simulation/models/filteredX.ts</code> 即時計算。
          </>
        }
      />
      <S1Problem />
      <S2DelayDerivation />
      <S3LinearPhase />
      <S4Gradient />
      <S5Mismatch />
      <S6Hardware />
      <Section kind="explore" level={2} title="7.7 動手觀察：Delay / Filtered-x Lab" id="ch07-lab">
        <p>
          三模式切換（raw-x / delayed-x / filtered-x）、<Tex>{r`\hat H`}</Tex> 的頻寬／latency／相位／增益誤差、<Tex>{'x'}</Tex>、<Tex>{'u'}</Tex>、
          <Tex>{'x_D'}</Tex>、<Tex>{'u_f'}</Tex> 疊圖、相關 vs <Tex>{'D'}</Tex>，以及 A/B/C 同 seed 的閉迴路。可從 Experiment Gallery 的 #4
          「<Tex>{r`\phi=-120^\circ`}</Tex>、<Tex>{'D=4'}</Tex>」直接載入。
        </p>
        <p className="small muted">
          注意振幅：Lab 把 code 正規化成 unit power（單頻時 <Tex>{r`A=\sqrt2`}</Tex>、<Tex>{r`A^2/2=1`}</Tex>），所以 7.1 節手算（<Tex>{'A=1'}</Tex>）的
          <Tex>{r`C_0=-0.25`}</Tex>、<Tex>{r`C_4=+0.5`}</Tex> 在 Lab 裡顯示為 <Tex>{r`-0.5`}</Tex>、<Tex>{r`+1`}</Tex>——剛好 2 倍，符號與相位完全相同。
        </p>
        <DelayFxLab />
        <h3 className="ch07-subhead">綜合手算：三種 regressor 的 pole，先用手算、再和 Lab 對答案</h3>
        <Hand id="HC-07.8">
          進入思考題之前，把整章的公式串起來算一次：同一個單頻例子，分別算 raw-x、delayed-x、filtered-x 的相關與平均 pole。預設值就是 Lab
          的預設（Gallery #4）——先用紙筆和計算機算，再看上面 Lab 的指標表與閉迴路結果是不是同一組數字；然後把 <Tex>{r`\phi`}</Tex>、<Tex>{'D'}</Tex>、
          <Tex>{r`\mu`}</Tex> 換成你自己的。
        </Hand>
      </Section>
      <S7Wrapup />
    </div>
  )
}
