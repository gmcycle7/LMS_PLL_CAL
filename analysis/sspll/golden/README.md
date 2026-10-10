# SSPLL GOS / PHOS 極性 golden model（`sspll_golden`）

這個資料夾是 `docs/analysis/sspll-gos-phos-polarity.md` 的**數值來源**。文件裡的每一個數字，都可以由這裡的程式重新算出來。

研究的問題是：在 subsampling PLL（SSPLL）與傳統 charge-pump PLL（CPPLL）裡，DTC 增益誤差（GOS）與 8 相 PMUX 相位偏差（PHOS）經過 $H_{PD}=1/(1+L)$ 到達 PD 之後，sign-error LMS 的平均梯度什麼時候會**反號**（不收斂）。

設定：$f_{ref}=4\ \mathrm{GHz}$，閉迴路 $|T|$ 的 −3 dB 頻寬 320 MHz，迴路延遲 1 個 reference cycle；分數部分由 8 相 PMUX（feedback 端）加 input DTC（reference 端）實現。

本套件不 import `analysis/sspll/{loops,regressors,sim,reconcile,challenge_*}` 的任何程式，是獨立重寫的版本，再拿來跟那些研究的結果交叉驗證。

## 1. 執行

需要 Python 3.12、`numpy>=2`、`scipy>=1.13`、`pytest>=8`，沒有其他依賴（與 repo 根目錄的 `golden/requirements.txt` 相同）。

```bash
cd analysis/sspll/golden
python3 -m pytest -q                       # 64 個 test_SSPLL_* 測試，約 30 秒
python3 tools/extract_sim_reference.py     # （可選）從 ../sim/results.json 重抽 reference/sim_fine_reference.json
python3 tools/make_results.py              # 文件裡的所有數字 -> results/doc_numbers.json/.log（約 90 秒）
python3 tools/worked_examples.py           # 文件裡的手算例 -> results/worked_examples.json
python3 tools/gos_dense_scan.py            # GOS 猜想的密集掃描（11 個迴路 × 152,096 個 β）-> results/gos_dense_scan.json
python3 tools/extract_sim_dither.py        # sim 的 MASH / PMUX 隨機旋轉結果（只有 sim 證據）-> results/sim_dither_extract.json
python3 tools/export_web_data.py           # 網站資料 -> ../../../src/data/sspll/*.json（約 2.5 分鐘）
```

## 2. 結構

```
golden/
├── sspll_golden/
│   ├── loops.py        L1 Type-I SSPLL、L2 Type-II SSPLL、L3 CPPLL（impulse / halfT / zoh），P-only 對策迴路，
│   │                   closed form（Type-I Re H、Type-II f_inv、CPPLL −Re L、Type-I latency / pole 判據）
│   ├── regressors.py   分數相位序列（exact rational 與 sim 的 32-bit 累加器）、GOS / PHOS regressor、
│   │                   Fourier 權重（W1 = 0.9496、方波 0.8106）、GMAC 前置濾波（raw / ac / zm / D:k / 1diff / 2diff / fx）
│   ├── predictions.py  Γ_eff = H_PD·conj(G)；exact periodic 9×9 C；ergodic 諧波和；mode-1 嚴格界限；
│   │                   PSD 定理用的 kernel_min；1diff margin 與 disc constant；有限步長判據；大訊號 κ∞；比較器 offset 偏差
│   └── simulator.py    sim 斜率量測的 deterministic replica；閉迴路 sign-error block LMS（真 1-bit 比較器，可加 u_os）
├── conftest.py         sys.path 與 session fixture（loops、models、sim_ref、web_dir）
├── test_sspll_loops.py      迴路設計、恆等式、反號帶 closed form、Type-I 判據、P-only、PVT
├── test_sspll_theory.py     regressor 權重、GOS（鋸齒）、PHOS（circulant）、mode-1 界限、j/4096 map、9×9 耦合、PSD 定理、f_vco
├── test_sspll_remedies.py   一階差分、filtered-x、P-only、D≠0 與二階差分（有害）、有限步長穩定
├── test_sspll_sim.py        replica 對 sim、theory 對 sim（500 點）、大訊號計數、閉迴路 LMS、比較器 offset
├── test_sspll_webdata.py    src/data/sspll/*.json 的大小、格式，以及與模型的抽查比對
├── reference/sim_fine_reference.json   sim 的 fine grid 結果（tools/extract_sim_reference.py 產生）
├── results/                             tools/*.py 的輸出（文件引用的數字都在這裡）
└── tools/                               產生數字與網站資料的腳本
```

核心程式段用 `# #region core:<name>` … `# #endregion` 標出（`gmac_variants`、`variant_G`、`C_periodic`、`gamma_eff`、`sign_lms_block`），文件中顯示的程式碼就是這幾段。比較 regressor 變體時，差異的那一行以 `# ← 差異：…` 標示。

## 3. 約定

| 量 | 定義 |
|---|---|
| 時間 / 頻率 | 時間以 $T_{ref}=250$ ps 為單位；$f$ 對 $f_{ref}$ 正規化；$\Omega=2\pi f/f_{ref}$；$z^{-1}=e^{-j\Omega}$ |
| 迴路 | $L(z)$ 嚴格 proper（≥ 1 拍延遲），$H_{PD}=1/(1+L)$，$T=L/(1+L)$，$h_{PD}[0]=1$ |
| regressor | index 0：GOS 殘差 $\rho[n]\in[0,1)$；index $1+k$：PHOS one-hot $\mathbb 1\{p[n]=k\}$ |
| 平均 GMAC 矩陣 | $C_{ij}=\langle r_i\,(h_{PD}*x_j)\rangle=\sum_\nu \overline{c^i_\nu}c^j_\nu\,\Gamma_{\rm eff}(f_\nu)$，$\Gamma_{\rm eff}=H_{PD}\,\overline{G}$ |
| 極性 | 以 $H_{PD}\equiv1$ 時更新正確來定義；收斂 ⟺ 可觀測子空間上 $\mathrm{Re\,eig}(C)>0$（小 μ） |
| 正規化 | $\kappa_{PHOS}=$ min Re eig / 開迴路參考（$=8\min_m\mathrm{Re}\lambda_m$），$\kappa_m=8\lambda_m$，$\kappa_{GOS}=C_{GOS}/\mathrm{var}(\rho)$（$=12C_{GOS}$） |
| sim 正規化 | `theory_point(...)['kP_simnorm']`：開迴路參考保留 regressor DC（GOS 因此大約差 4 倍） |
| 「反號」 | $\kappa<-\tau$，$\tau=10^{-3}$ 或 $10^{-2}$；$|\kappa|\le\tau$ 稱為 dead zone |

插圖用的假設值：$\sigma_v=200$ fs、$f_{vco}=16$ GHz（$\Delta=T_{vco}/8=7.8125$ ps）；sim 物理模型的 $a=0.03$，ε 取 seed 7、rms 0.25 ps。小訊號的符號結論與 $f_{vco}$ 無關。

## 4. 測試涵蓋的關鍵數字

| 測試 | 數字 |
|---|---|
| `test_SSPLL_loop_design_parameters` | $K=0.388836$；$(K_p,K_i)=(0.287717,0.0382535)$；$b=13.928$、$\omega_cT=0.303955$；三個迴路 $f_{3dB}=320.000000$ MHz；PM 78.79 / 60.00 / 58.58° |
| `test_SSPLL_typeII_band_edge_closed_form` | L2 反號帶 0–134.820 MHz，最低 −0.2053 @ 83.8 MHz |
| `test_SSPLL_cppll_closed_form_and_mappings` | L3 反號帶 0–117.278 MHz；halfT 115.64 MHz（PM 52.56°）；zoh 115.10 MHz |
| `test_SSPLL_typeI_latency_criterion` / `_pole_criterion` | $K(d-\tfrac12)>1$、$K(\tfrac12+\tfrac{p}{1-p})>1$；latency 5 → 0–107.08 MHz；200 MHz pole → 0–122.85 MHz |
| `test_SSPLL_p_only_loops` | 218.09 MHz；267.84 MHz / 73.79°（判據 0.2961）；精確 R∥C2：297.95 MHz / 71.72°（判據 0.3392） |
| `test_SSPLL_mode1_sure_inversion_band` | 一定反號：L2 32.68–125.33 MHz、L3 27.72–105.09 MHz；超過 136.38 / 118.78 MHz 時 mode-1 不可能反號 |
| `test_SSPLL_phos_sign_map_j4096` | τ=1e-2：L2 29.3–124.0 MHz、L3 23.4–103.5 MHz；最差 −0.1397 @ 83.0 MHz / −0.0957 @ 67.4 MHz |
| `test_SSPLL_phos_point_values_alpha_1_over_50` | 8λ_min：+0.1285 / −0.1385 / −0.0847；L2 的 occupancy 正規化值 −0.1443；L2 的 12C = 1.1086 |
| `test_SSPLL_gos_small_beta_asymptotes` | $12C(\beta=10^{-3})=3.137\times10^{-4}=12\beta^2/K_i$；D=1 時 $C\approx-\beta$ |
| `test_SSPLL_one_diff_kernel_nonnegative` / `_disc_constant` | margin 0.3888 / 0.2686 / 0.2698；c = 0.403 / 0.423 / 0.459 |
| `test_SSPLL_harmful_variants` | D=1：−1.1812（L2）、−1.0853（L3）；二階差分：−0.2776 / −0.4143 |
| `test_SSPLL_filtered_x_typeI_model_critical_gain` | $\hat K_{crit}=0.1247$；$\hat K=0.12$ 在 27 MHz 以下為負 |
| `test_SSPLL_finite_step_mean_stability` | τ=25 blocks：L2 多 2 個、L3 多 1 個不穩定的 α |
| `test_SSPLL_replica_matches_stored_sim` | replica 與 sim 的 κ 差 < 1e-5 |
| `test_SSPLL_theory_vs_sim_fine_grid` | 反號個數 sim/theory：L2 44/38、L3 27/23；τ=1e-2 時分類 0 個不一致 |
| `test_SSPLL_large_signal_counts` | A = 1 ps / 5 ps / ∞：L1 0/36/34、L2 70/81/83、L3 58/72/75；1diff 全為 0 |
| `test_SSPLL_comparator_offset_needs_zero_mean_regressor` | u_os=25 fs：raw GOS 偏差 −145.8 fs（公式）；LMS 的 raw 共模漂移，zm / 1diff 不漂移 |

## 5. 誠實標示

- 所有線性結論都建立在 Bussgang 線性化（$|e|\ll\sigma_v$）與穩態平均上。大訊號另外用 1-bit 相關 $\kappa_\infty$ 處理，只沿 6 個方向計算，不是完整的非線性穩定域。
- 「GOS 在 D=0 時不反號」是**猜想**。`tools/gos_dense_scan.py` 在 11 個迴路上掃了 152,096 個有理 β，0 個反例，但沒有證明。
- 閉迴路 LMS 的 ps 級「發散值」來自無界的線性 SSPD 與無限的 DTC range。實際硬體會飽和、cycle slip 或失鎖。
- MASH 與 PMUX 隨機旋轉只有 `../sim` 的時域證據（`tools/extract_sim_dither.py` 只是把那些結果抽出來），本套件沒有對應的理論。
