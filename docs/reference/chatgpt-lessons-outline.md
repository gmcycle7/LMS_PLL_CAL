# 參考：使用者分享的 ChatGPT 入門課程（教學節奏與範例）

來源：使用者分享的對話「LMS演算法介紹」（2026-10-10 讀取）。使用者明確表示「他前面那種很簡單的教學我也需要」。以下是各課的**教學節奏與具體範例**，供各章入門段落參考（內容需以本站驗算／勘誤後的版本為準，見 `docs/validation.md`）。

| 課 | 主題 | 入門手法（請沿用） | 對應本站 |
|---|---|---|---|
| 1 | 什麼是 LMS、為什麼重要 | 黑盒子 \(y=ax\)：先給三筆乾淨資料 (1,3)(2,6)(4,12) 一眼看出 \(a=3\)；再給含雜訊資料 (1,3.2)(2,5.7)(4,12.5) 說明「沒有任何一筆能直接告訴你 \(a\)」。三個動作：預測→比較→修正。手算 \(w_0=1,x=2,y=6,\mu=0.1\Rightarrow w_1=1.8,w_2=2.28\)。互動：\(\mu\in\{0.02,0.10,0.65\}\) 慢／穩／發散。推導 \(dJ/dw=-ex\)。有雜訊時 \(E[ex]=(a-w)E[x^2]\)，雜訊平均以 \(1/\sqrt N\) 下降。應用：ANC 耳機、高速通訊 Equalizer（FFE/DFE）、PLL/DTC 校正、SGD。思考題：\(w=2,x=-3,y=-9,\mu=0.1\) → 選項 1.1 / 2.9 / 3.0 / 2.3（答案 \(2+0.1\cdot(-3)\cdot(-3)=2.9\)）。「學完應記住的五件事」。 | ch00、ch01 |
| 2 | 為何叫 LMS、怎麼保證穩定 | Least / Mean / Squares 拆字表；模型 A 誤差 ±10、模型 B 誤差 ±1 平均都是 0 → 需要平方。\(E[\cdot]\) 用「很多次的平均」解釋。用**等比數列** \(r^n\to0\iff|r|<1\) 推出 \(0<\mu<2/x^2\)；互動 \(\mu\in\{0.1,0.25,0.4,0.5,0.6\}\)（\(x=2\)）顯示 \(p=1-4\mu\)。穩定不代表不震盪。隨機輸入：mean \(0<\mu<2/P_x\) vs mean-square \(0<\mu<2E[x^2]/E[x^4]=2/3\)。GMAC 估計 \(E[ex]\)；sum vs average 差 \(N\) 倍。四層檢查表（方向、loop gain、noise、非理想）。 | ch01、ch03 |
| 3 | 平方 vs 絕對值 | \(e^2\) 與 \(|e|\) 圖形比較表（L2/L1、對大誤差懲罰、可微性、需要的資訊）；推導 \(\Delta w=\mu ex\) vs \(\mu\,\mathrm{sign}(e)x\)；\(a=3,x=1,w=1,\mu=0.2\)：LMS 1.4 vs Sign 1.2；互動兩者收斂（Sign 在 2.8/3.2 間跳）；\(y=[0,0,0,10]\)：平均 2.5 vs 中位數 0；連到 1-bit comparator。 | ch01、ch02 |
| 4 | 1 fs 誤差埋在 100 fs 雜訊 | \(P(q=+1)=\Phi(0.01)=50.3989\%\)；\(E[q]=0.0079787\)；累加 10,000 次平均 79.8；\(\mathrm{Var}(q)=1-m^2\)；訊號 \(\propto N\)、雜訊 \(\propto\sqrt N\)；表格 N vs 正確率（注意勘誤 E02：偶數 N 的 tie）；erf S 曲線圖；\(K_q=\sqrt{2/\pi}/\sigma_v\)；\(p=1-\alpha K_q\)；\(0<\alpha<250.66\) fs；\(\tau=-1/\ln p\approx12\) blocks；\(\sigma_w=\alpha/\sqrt{N(1-p^2)}\)（N=10,000 時 0.255 fs）；\(\alpha\) vs pole / 時間常數 / RMS 表；sum vs average；1-block delay → \(0<g<1\)；「適度雜訊像 dither」。7 項設計檢查清單。 | ch05、ch12、ch14 |
| 5 | 實作系統圖與 Bias | Mermaid 系統圖 A（PLL + DTC 校正）、B（Block Sign-LMS RTL：conditional negate、accumulator、shift、saturation）；硬體對應表；\(e=(a-w)x+b+d(x)+u+v\) 逐項表；\(w^*\) 分解成 Offset / INL / Correlated bias；三階 INL 例 \(w^*=1.34\) 與殘差表；三類雜訊會不會造成 bias 表；系統圖 C（含 \(H_\mathrm{PD}\)）；8 項 Behavioral 測試表；Convergence / Accuracy / PLL Performance 三層次。 | ch04、ch11 |
| 6 | Phase shift 會讓 LMS 發散嗎 | 正弦波證明 \(E[xx_\mathrm{eff}]=\tfrac{A^2}{2}|H|\cos\phi\)；0°/60°/90°/120°/180° 表；互動相位滑桿（150° → pole 1.346）；「GMAC 用錯了 gradient」→ Filtered-x（系統圖 D）；Type-I \(H=s/(s+\omega_c)\) 在 \(0.3\omega_c\) 為 73.3°（只變慢）vs Type-II 155.2°（變號）；PSD 加權積分 \(C\)；delay 表（0/1/2 blocks → 2 / 1 / 0.618）；用 \(S_\mathrm{GMAC}=(G_+-G_-)/(2\Delta w)\) 量測極性；\(w^*=a+B/C\) 在 \(C\to0\) 時放大 bias。 | ch06、ch07、ch08、案例頁 |
| 7 | 只加 Delay Register 能否修正 | Delay-tap MUX 架構圖；\(\cos(\phi+\Omega D)\)；「只加 4 個 delay registers 就讓發散變收斂」；delay 只能提供與頻率成正比的相位。 | ch07 |
| 8–9 | LMS 的 Phase Margin、雙迴路 | Polarity margin vs 真正 \(L_\mathrm{cal}(z)=g/(z-1)\) 的 PM。 | ch08 |
| 10 | 如何決定最佳 Learning Rate | 設計方程 \(E[\delta_K^2]\approx\delta_0^2p^{2K}+\tfrac{\alpha^2}{N}\tfrac{1-p^{2K}}{1-p^2}\)；互動設計計算器（\(\sigma_v\)、N、總比較次數、相位）→ 建議 \(\alpha=11.20\) fs、RMS 0.449 fs、pole 0.9106、PM 87.4°；corner-based 區間；量測 Jacobian 的 6 步流程。 | ch14 |
| 11 | 多個 LMS loops 互相干擾 | \(\mathbf R=[[1,0.8],[0.8,1]]\) 時 \(G_1=0.8K_q\delta_2\)；preconditioner 598 → 5 次；\(\mathbf M\approx[[25.13,-24.87],[-24.87,25.13]]\)；互動 ρ 滑桿比較一般／完整反矩陣／regularized（598 / 5 / 65）；\(\sigma_\mathrm{weak}/\sigma_\mathrm{strong}=\sqrt{199}\approx14.1\)；Jacobian 反例；NLMS / Preconditioned / Sequential 比較表。 | ch09、ch10 |
| 12 | Calibration noise → output PN/spur | Noise propagation 圖；\(\delta t=x\,\delta w\)「乘號不是加號」；\(H_{\eta\to w}\)；三角恆等式推頻譜混合；三種 code 頻譜表（const / cos / ±1 隨機 → 0.399 / 0.282 / 0.009 fs）；PD high-pass vs output low-pass；−93.8 dBc spur；四組 PSD 與 A/B/C 三組對照實驗。 | ch12 |

**共通手法**：每課開頭一句「這次我們要回答的問題」；先數字後公式；每個公式後面接一句白話；重要結論粗體＋boxed；表格比較；互動圖附「你會發現…」；結尾「這堂課最重要的 N 個公式」與「下一個值得研究的問題」。
