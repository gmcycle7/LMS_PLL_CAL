import { useMemo, type ReactNode } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, ModelLevel, Prereq, Section, Tex, TexBlock } from '@/components'
import fftSrc from '../experiments/fftPitfalls.ts?raw'
import { getWindow, windowStats, type WindowName } from '@/simulation/signal'
import { ChLink, ErratumNote, HandCalcSlot, Steps, fx, md, texNum } from '../common'
import { DEFAULT_FFT_PARAMS, rectLeakageApproxDb, runFftPitfalls, scallopLossDb } from '../experiments/fftPitfalls'
import { FftPitfallsLab } from '../experiments/FftPitfallsLab'

interface CheckItem {
  item: string
  /** 規格 §15.5 明列的 10 項為 true；本站補充的為 false */
  spec: boolean
  what: ReactNode
  wrong: ReactNode
  site: string
}

const CHECKLIST: CheckItem[] = [
  { item: 'Sampling frequency', spec: true, what: md('$f_s$（以及序列是在 $f_\\mathrm{ref}$、$f_s$ 還是 $f_u$ 上）'), wrong: md('頻率軸差 $N$ 倍（block 軸與 sample 軸混用，E29）'), site: '每張 PSD 圖的軸標示 f_s 或 f_u' },
  { item: 'Window', spec: true, what: '矩形 / Hann / Blackman-Harris…', wrong: '矩形窗加上非相干取樣：近載波的洩漏看起來像 spur', site: 'PsdResult.window' },
  { item: 'Segment length', spec: true, what: md('whole-record 的 $N$，或 Welch 的 nperseg'), wrong: 'segment 太短：RBW 太寬，spur 被載波主瓣吃掉', site: 'PsdResult.nperseg / nSegments' },
  { item: 'Coherent / noncoherent', spec: true, what: '訊號是否整數週期落在紀錄內', wrong: md('scalloping（矩形窗最多 $-3.92\\,\\mathrm{dB}$）與洩漏'), site: '下方實驗的「非相干偏移」控制項' },
  { item: 'Bin resolution', spec: true, what: md('$\\Delta f=f_s/N_\\mathrm{fft}$'), wrong: '兩根 tone 落在同一 bin，或 tone 與雜訊無法分辨', site: 'PsdResult.df' },
  { item: 'PSD normalization', spec: true, what: md('density（$x^2/\\mathrm{Hz}$）或 spectrum（$x^2$）'), wrong: 'tone 讀值依 RBW 改變（dBc/Hz 不是 tone 的單位）', site: 'PsdResult.scaling / units' },
  { item: 'One-sided vs two-sided', spec: true, what: md('是否把負頻率折到正頻率（功率乘 2）'), wrong: md('差 $3\\,\\mathrm{dB}$；$\\mathcal L(f)=10\\log_{10}\\bigl(S_\\varphi^{(1)}(f)/2\\bigr)$'), site: 'PsdResult.onesided' },
  { item: 'Peak vs RMS amplitude', spec: true, what: md('$A_\\mathrm{peak}$ 或 $A_\\mathrm{rms}=A_\\mathrm{peak}/\\sqrt2$'), wrong: md('差 $3\\,\\mathrm{dB}$；相位調變小角度時 spur $=20\\log_{10}(\\beta_\\mathrm{peak}/2)$ dBc'), site: 'toneFit.amplitudePeak / amplitudeRms' },
  { item: 'dBc vs dBc/Hz', spec: true, what: 'tone 用 dBc（積分功率），noise 用 dBc/Hz（密度）', wrong: md('把 tone 的 PSD 峰值當 dBc：偏 $10\\log_{10}(\\mathrm{ENBW_{Hz}})$'), site: '下方實驗 (B) 的兩個指標' },
  { item: 'Integration bandwidth', spec: true, what: md('積分 jitter 的 $[f_L,f_H]$'), wrong: md('同一條 PSD、不同積分範圍，jitter 差很多；白雜訊要用 ENBW 而非 $-3\\,\\mathrm{dB}$ 頻寬（E06）'), site: 'integratePsd(f, psd, fL, fH)' },
  { item: '量測模式', spec: false, what: 'Whole-record FFT、Welch PSD、coherent tone fit 三種都做', wrong: 'DSM 長週期：短資料窗把 tone 看成 noise，或把 leakage 當 spur', site: '下方實驗 (A)(B)(C)' },
  { item: '資料長度 vs DSM 週期', spec: false, what: md('紀錄是否涵蓋整數個 code 週期 $M/\\gcd(K_\\mathrm{FCW},M)$'), wrong: 'fractional spur 在短紀錄中「時有時無」', site: 'dsm.ts detectPeriod / firstOrderPeriod' },
]

const WINDOWS: WindowName[] = ['rectangular', 'hann', 'blackmanHarris']

/** §8 §15.5：一條 FFT 不能證明有 spur */
export function S7Spur() {
  const winTable = useMemo(
    () =>
      WINDOWS.map((w) => {
        const win = getWindow(w, 4096)
        const st = windowStats(win)
        return { w, enbw: st.enbwBins, sl: scallopLossDb(win, 0.5) }
      }),
    [],
  )
  // 預設設定（矩形窗、δ = ½、Δ = 40 bin）：洩漏的手算近似 vs 實際計算
  const leak = useMemo(() => {
    const r = runFftPitfalls(DEFAULT_FFT_PARAMS)
    const m = DEFAULT_FFT_PARAMS.spurOffsetBins - 0.5 // spur ±1 bin 內離載波最近的 bin：Δ − ½
    return { sim: r.leakAtSpurDbc, approx: rectLeakageApproxDb(m), m, spur: DEFAULT_FFT_PARAMS.spurDbc, N: r.N }
  }, [])
  const rect = winTable[0]
  return (
    <section aria-labelledby="models-s8">
      <h2 id="models-s8">8｜一條 FFT 曲線不能證明有 Spur（§15.5）</h2>
      <p>
        「我在 FFT 上看到一根 <Tex>{'-90\\,\\mathrm{dBc}'}</Tex> 的峰，所以有 <Tex>{'-90\\,\\mathrm{dBc}'}</Tex> 的 spur。」這句話至少缺了十個條件。同一筆資料，換一個 window、換一個紀錄長度，峰值可以差{' '}
        <Tex>{'40\\,\\mathrm{dB}'}</Tex>；而一根真的 spur 也可能完全看不見。
        <ModelLevel level="L4" />
      </p>
      <Prereq title="PSD、FFT bin 與 ENBW（只用到等比級數與三角函數）">
        <p>
          長度 <Tex>{'N'}</Tex> 的 DFT <Tex>{'X[k]=\\sum_{n=0}^{N-1}w[n]x[n]e^{-j2\\pi kn/N}'}</Tex> 把訊號拆到 <Tex>{'N'}</Tex> 個等間隔頻率（bin），間隔 <Tex>{'\\Delta f=f_s/N'}</Tex>。乘上視窗{' '}
          <Tex>{'w[n]'}</Tex>（注意：這裡的 <Tex>{'w[n]'}</Tex> 是視窗，不是 gain <Tex>{'w_k'}</Tex>）是為了讓「沒有整數週期」的 tone 不要洩漏到遠方 bin。代價是每個 bin 變寬：等效雜訊頻寬（ENBW）
          <Tex>{'\\mathrm{ENBW_{bins}}=N\\sum w^2/(\\sum w)^2'}</Tex>（矩形窗為 1）。PSD 是「每 Hz 的功率」，積分才是功率：<Tex>{'\\sigma^2=\\int S(f)\\,df'}</Tex>。所以一根 tone 在 PSD
          上的高度等於它的功率除以 ENBW——換個 RBW 高度就變，這就是 dBc 與 dBc/Hz 不能混用的原因。
        </p>
      </Prereq>
      <Callout kind="info" title="符號提醒">
        本節的 <Tex>{'\\delta'}</Tex> 是「tone 偏離 bin 中心多少個 bin」（<Tex>{'0\\le\\delta\\le\\tfrac12'}</Tex>），不是其他各節的參數誤差 <Tex>{'\\delta=a-w'}</Tex>；<Tex>{'W(\\delta)'}</Tex> 是視窗在該偏移的頻率響應。
      </Callout>
      <Section kind="formula" title="8.1 一根 tone 在 periodogram 上讀到多少？" level={3}>
        <Steps
          title="視窗化 DFT 的 tone 與雜訊讀值"
          steps={[
            {
              tex: String.raw`x[n]=A\cos\!\Bigl(\frac{2\pi(k_0+\delta)n}{N}\Bigr)=\frac A2e^{j2\pi(k_0+\delta)n/N}+\frac A2e^{-j2\pi(k_0+\delta)n/N}`,
              why: 'Euler 公式；$\\delta$ 是 tone 偏離 bin 中心的分數（coherent 取樣時 $\\delta=0$）。',
            },
            {
              tex: String.raw`X[k_0]=\frac A2\sum_n w[n]e^{j2\pi\delta n/N}+(\text{負頻率項})\approx\frac A2W^*(\delta),\qquad W(\delta)\equiv\sum_n w[n]e^{-j2\pi\delta n/N}`,
              why: '代入 DFT：正頻率項在 $k=k_0$ 只剩 $\\delta$ 的相位旋轉；負頻率項離得很遠，可忽略。',
            },
            {
              tex: String.raw`\hat P_\mathrm{tone}=2\,\frac{|X[k_0]|^2}{(\sum w)^2}=\frac{A^2}{2}\,\frac{|W(\delta)|^2}{(\sum w)^2}`,
              why: 'one-sided「spectrum」正規化：除以 $(\\sum w)^2$ 讓 $\\delta=0$ 時讀到 $A^2/2$，乘 2 把負頻率折回。',
            },
            {
              tex: String.raw`E|X[k]|^2_\mathrm{noise}=\sigma^2\sum w^2\;\Rightarrow\;\hat P_\mathrm{noise/bin}=\frac{2\sigma^2\sum w^2}{(\sum w)^2}=\frac{2\sigma^2\,\mathrm{ENBW_{bins}}}{N}`,
              why: '白雜訊各 sample 獨立，交叉項的期望值為 0；用同樣的正規化。',
            },
            {
              tex: String.raw`\frac{\hat P_\mathrm{tone}}{\hat P_\mathrm{noise/bin}}=\underbrace{\frac{A^2/2}{\sigma^2}}_{\text{SNR}}\cdot\frac{N}{2\,\mathrm{ENBW_{bins}}}\cdot\frac{|W(\delta)|^2}{(\sum w)^2}`,
              why: '兩式相除：紀錄長度每加倍，tone 相對雜訊底多 $3\\,\\mathrm{dB}$（processing gain）。',
            },
          ]}
        />
        <TexBlock id="F-15.11" label="視窗化 periodogram 的 tone 讀值與雜訊底">
          {String.raw`\hat P_\mathrm{tone}=\frac{A^2}{2}\frac{|W(\delta)|^2}{(\sum w)^2},\quad \hat P_\mathrm{noise/bin}=2\sigma^2\frac{\sum w^2}{(\sum w)^2}=\frac{2\sigma^2\,\mathrm{ENBW_{bins}}}{N}`}
        </TexBlock>
        <Steps
          title="矩形窗：scalloping 與洩漏都來自同一個等比級數"
          steps={[
            {
              tex: String.raw`W(\nu)=\sum_{n=0}^{N-1}e^{-j2\pi\nu n/N}=\frac{1-e^{-j2\pi\nu}}{1-e^{-j2\pi\nu/N}}`,
              why: '矩形窗 $w[n]=1$；公比 $r=e^{-j2\\pi\\nu/N}$ 的等比級數和 $(1-r^N)/(1-r)$。$\\nu$ 是「離 tone 多少個 bin」，可以不是整數。',
            },
            { tex: String.raw`\frac{|W(\nu)|}{N}=\frac{|\sin\pi\nu|}{N\,|\sin(\pi\nu/N)|}\approx\frac{|\sin\pi\nu|}{\pi|\nu|}`, why: '用 $|1-e^{-j\\theta}|=2|\\sin(\\theta/2)|$（§3.4 推過），再用 $N\\gg\\nu$ 時 $\\sin x\\approx x$。' },
            {
              tex: String.raw`\nu=\delta=\tfrac12:\quad\frac{|W|}{N}=\frac{2}{\pi}\;\Rightarrow\;20\log_{10}\frac2\pi=${texNum(rect.sl, 4)}\ \mathrm{dB}`,
              why: 'scalloping：tone 剛好落在兩個 bin 正中間，兩邊的 bin 都只讀到 $2/\\pi$ 倍的振幅。',
            },
            {
              tex: String.raw`\nu=m+\delta,\;m\in\mathbb Z:\quad\frac{|W|}{N}\approx\frac{|\sin\pi\delta|}{\pi|m+\delta|}\quad\bigl(\delta=0\Rightarrow0\bigr)`,
              why: '洩漏：$\\sin\\pi(m+\\delta)=\\pm\\sin\\pi\\delta$。coherent（$\\delta=0$）時每個其他 bin 都剛好落在零點；$\\delta\\ne0$ 時裙邊只以 $1/|\\nu|$ 緩慢下降。',
            },
            {
              tex: String.raw`\delta=\tfrac12,\;\nu=${leak.m}:\quad 20\log_{10}\frac{1}{\pi\times${leak.m}}=${texNum(leak.approx, 4)}\ \mathrm{dBc}\quad(\text{實際計算 }${texNum(leak.sim, 4)}\ \mathrm{dBc})`,
              why: `下方實驗的預設值（spur 在 ${DEFAULT_FFT_PARAMS.spurOffsetBins} 個 bin 外，量測取 spur 前後 1 個 bin 的最大值，最近的 bin 離載波 ${leak.m} 個 bin）：載波洩漏就有約 $${Math.round(leak.sim)}\\,\\mathrm{dBc}$，比真正的 spur（$${leak.spur}\\,\\mathrm{dBc}$）高了約 $${Math.round(leak.sim - leak.spur)}\\,\\mathrm{dB}$——這條 FFT 上看到的「峰」是 leakage。`,
            },
          ]}
        />
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>
                  視窗（<Tex>{'N=4096'}</Tex>）
                </th>
                <th>ENBW [bins]</th>
                <th>
                  <Tex>{'\\delta=0.5'}</Tex> 的 scalloping [dB]
                </th>
              </tr>
            </thead>
            <tbody>
              {winTable.map((r) => (
                <tr key={r.w}>
                  <td>{r.w}</td>
                  <td>{fx(r.enbw, 4)}</td>
                  <td>{fx(r.sl, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          <ClaimTag kind="exact" /> 由 <code>getWindow</code>、<code>windowStats</code> 與 <Tex>{'|W(\\delta)|^2'}</Tex> 的直接求和計算。矩形窗 ENBW 最小（雜訊底最低）但洩漏最嚴重；Blackman-Harris 的旁瓣低到{' '}
          <Tex>{'-92\\,\\mathrm{dB}'}</Tex>，代價是 ENBW 約 2 bins（雜訊底高 <Tex>{'3\\,\\mathrm{dB}'}</Tex>）。
        </p>
      </Section>
      <HandCalcSlot id="HC-MD.3">
        先用紙筆估「雜訊底在哪裡、洩漏有多高」，再到下面的實驗用同一組數字驗證（預設值相同）。
      </HandCalcSlot>
      <Section kind="assumptions" title="8.2 量測檢查表：每張 spur 圖都要寫明的 12 件事" level={3}>
        <p className="small">
          前 10 項是規格 §15.5 的原文要求；最後 2 項是本站依規格同一節第二段（DSM 長週期訊號）補充的。<ErratumNote id="E06">積分頻寬與 Noise BW 的區分</ErratumNote>
        </p>
        <div className="table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th>#</th>
                <th>項目</th>
                <th>要寫明什麼</th>
                <th>不寫會怎樣</th>
                <th>本站對應</th>
              </tr>
            </thead>
            <tbody>
              {CHECKLIST.map((c, i) => (
                <tr key={c.item}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{c.item}</strong>
                    {!c.spec && <div className="small muted">（本站補充）</div>}
                  </td>
                  <td>{c.what}</td>
                  <td className="small">{c.wrong}</td>
                  <td className="small">
                    <code>{c.site}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="warn" title="對 DSM 長週期訊號">
          規格建議同時提供 Whole-Record FFT、Welch PSD 與 coherent tone measurement 三種模式。短資料窗可能把 tone 看成 noise，也可能把 leakage 誤判為 spur；已知頻率（例如 FCW 決定的 fractional spur）時，coherent tone fit
          最可靠，但它只能回答「這個頻率有多大」，不能幫你發現未知頻率的 spur。PLL 的 <Tex>{'-93.8\\,\\mathrm{dBc}'}</Tex> 例子見 <ChLink to="/ch/12">Ch12</ChLink>。
        </Callout>
      </Section>
      <HandCalcSlot id="HC-MD.4">
        檢查表第 9 項（dBc 與 dBc/Hz）和第 3 項（segment length）用數字算一次：為什麼 coherent 取樣之後，Welch 的主瓣積分還是比真實 spur 高了將近 <Tex>{'5\\,\\mathrm{dB}'}</Tex>？
      </HandCalcSlot>
      <ModeGate min="engineer">
        <CodeBlock
          source={fftSrc}
          region="fftHandFormulas"
          path="src/pages/models/experiments/fftPitfalls.ts"
          title="core:fftHandFormulas（fftPitfalls.ts）"
          caption="上面兩題手算與下方實驗共用的函式：實驗的「每 bin 雜訊底（解析）」「(B) 積分範圍內白雜訊的期望功率」就是呼叫它們算出來的，再拿模擬的 periodogram／Welch 去比。"
        />
      </ModeGate>
      <FftPitfallsLab />
    </section>
  )
}
