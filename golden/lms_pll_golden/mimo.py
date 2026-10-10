"""§9–§10：Persistent Excitation、Eigen/SVD、Preconditioner 與 Jacobian（T10、T11、T18）。

平均 LMS（理想匹配）：``δ_{k+1} = (I − μR)δ_k``，沿第 i 個 eigenvector 的 Pole ``1 − μλ_i``。
Jacobian 形式：``G(w) ≈ J(w − w*)``、``w_{k+1} = w_k + M G_k`` ⇒ ``A_cal = I + MJ``。
"""

from __future__ import annotations

import math

import numpy as np


def corr2(rho: float) -> np.ndarray:
    """``R = [[1, ρ], [ρ, 1]]``。"""
    return np.array([[1.0, rho], [rho, 1.0]])


def eig_sorted(r: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """對稱矩陣 eigen 分解，eigenvalue 由大到小；eigenvector 正規化成「第一個非零分量為正」。"""
    vals, vecs = np.linalg.eigh(r)
    order = np.argsort(vals)[::-1]
    vals = vals[order]
    vecs = vecs[:, order]
    for i in range(vecs.shape[1]):
        col = vecs[:, i]
        nz = np.flatnonzero(np.abs(col) > 1e-12)
        if nz.size and col[nz[0]] < 0:
            vecs[:, i] = -col
    return vals, vecs


def cond_number(r: np.ndarray) -> float:
    """2-norm condition number ``σ_max/σ_min``（奇異時回傳 inf）。"""
    s = np.linalg.svd(r, compute_uv=False)
    return float(s[0] / s[-1]) if s[-1] > 0 else math.inf


def mean_lms_poles(r: np.ndarray, mu: float) -> np.ndarray:
    """``1 − μλ_i(R)``（由 λ 大到小排列）。"""
    vals, _ = eig_sorted(r)
    return 1.0 - mu * vals


def steps_to_decay(p: float, fraction: float) -> int:
    """``|p|^k ≤ fraction`` 的最小 k = ``ceil(log(fraction)/log|p|)``。"""
    if not 0 < abs(p) < 1:
        raise ValueError('需 0 < |p| < 1')
    return math.ceil(math.log(fraction) / math.log(abs(p)))


def steps_to_decay_real(p: float, fraction: float) -> float:
    return math.log(fraction) / math.log(abs(p))


def simulate_mean_lms(r: np.ndarray, mu: float, delta0: np.ndarray, steps: int) -> np.ndarray:
    """平均遞迴 ``δ_{k+1} = (I − μR)δ_k``，回傳 shape (steps+1, M)。"""
    a = np.eye(r.shape[0]) - mu * r
    out = np.empty((steps + 1, r.shape[0]))
    out[0] = delta0
    for k in range(steps):
        out[k + 1] = a @ out[k]
    return out


def windowed_pe(u: np.ndarray, n0: int, k: int) -> np.ndarray:
    """§9.1 有限窗口 ``R_k = (1/N0) Σ_{n=k}^{k+N0−1} u[n]u[n]^T``；u shape (n_samples, M)。"""
    seg = u[k : k + n0]
    return seg.T @ seg / n0


# ---------------------------------------------------------------------------
# §9.2 GOS/PHOS Common-Mode Gauge Freedom
# ---------------------------------------------------------------------------


def onehot_with_global_regressors(n_phases: int = 4) -> np.ndarray:
    """回傳所有可能的 regressor 列 ``[1, x_0, …, x_{P−1}]``（x 為 one-hot）。"""
    rows = []
    for i in range(n_phases):
        x = np.zeros(n_phases)
        x[i] = 1.0
        rows.append(np.concatenate([[1.0], x]))
    return np.array(rows)


def null_space(a: np.ndarray, rtol: float = 1e-12) -> np.ndarray:
    """以 SVD 求零空間（欄向量）。"""
    _u, s, vt = np.linalg.svd(a)
    rank = int(np.sum(s > rtol * (s[0] if s.size else 1.0)))
    return vt[rank:].T


# ---------------------------------------------------------------------------
# §10 Preconditioner
# ---------------------------------------------------------------------------


def preconditioner_ideal(r: np.ndarray, k_q: float, gamma: float) -> np.ndarray:
    """``M = γ (K_q R)^{-1}``（R 正定且模型匹配時所有平均 Pole = 1 − γ）。"""
    return gamma * np.linalg.inv(k_q * r)


def preconditioned_var_closed(gamma: float, k_q: float, n: int, lam: float) -> float:
    """§10.1 ``Var(δ_i) ≈ γ / (K_q² N λ_i (2 − γ))``（iid Gaussian、Cov(η) = R/N）。"""
    return gamma / (k_q * k_q * n * lam * (2.0 - gamma))


def simulate_preconditioned_lms(
    rng: np.random.Generator,
    r: np.ndarray,
    k_q: float,
    n: int,
    gamma: float,
    chains: int,
    blocks: int,
) -> np.ndarray:
    """模擬 ``G_k = K_q R δ_k + η_k``、``η ~ N(0, R/N)``、``w ← w + M G``（δ = a − w）。

    ⇒ ``δ_{k+1} = δ_k − M(K_q R δ_k + η_k)``。回傳最後一個 block 的 δ（shape (chains, M)），
    各 chain 獨立 ⇒ 可直接當 iid 樣本估計穩態共變異。初值 δ0 = 0。
    """
    m = r.shape[0]
    mm = preconditioner_ideal(r, k_q, gamma)
    a = np.eye(m) - mm @ (k_q * r)
    chol = np.linalg.cholesky(r / n)
    delta = np.zeros((chains, m))
    for _ in range(blocks):
        eta = rng.standard_normal((chains, m)) @ chol.T
        delta = delta @ a.T - eta @ mm.T
    return delta


# ---------------------------------------------------------------------------
# §10.2 Jacobian（T18）
# ---------------------------------------------------------------------------


def jacobian_loop_matrix(j: np.ndarray, m: np.ndarray) -> np.ndarray:
    """``A_cal = I + MJ``。"""
    return np.eye(j.shape[0]) + m @ j


def regularized_update_matrix(j: np.ndarray, gamma: float, lam: float) -> np.ndarray:
    """``M = −γ (JᵀJ + λI)^{-1} Jᵀ``。"""
    n = j.shape[1]
    return -gamma * np.linalg.solve(j.T @ j + lam * np.eye(n), j.T)


def regularized_poles_closed(j: np.ndarray, gamma: float, lam: float) -> np.ndarray:
    """``p_i = 1 − γ σ_i²/(σ_i² + λ)``（σ_i 為 J 的 singular values，由大到小）。"""
    s = np.linalg.svd(j, compute_uv=False)
    return 1.0 - gamma * s**2 / (s**2 + lam)


def finite_difference_jacobian(g_fn, w: np.ndarray, deltas: np.ndarray) -> np.ndarray:
    """§10.2 中央差分 ``J_ij ≈ [G_i(w + Δ_j e_j) − G_i(w − Δ_j e_j)] / (2Δ_j)``。"""
    m = w.size
    cols = []
    for jdx in range(m):
        e = np.zeros(m)
        e[jdx] = deltas[jdx]
        cols.append((np.asarray(g_fn(w + e)) - np.asarray(g_fn(w - e))) / (2.0 * deltas[jdx]))
    return np.column_stack(cols)


def simulate_jacobian_loop(j: np.ndarray, m: np.ndarray, w_star: np.ndarray, w0: np.ndarray, steps: int) -> np.ndarray:
    """``w_{k+1} = w_k + M·J(w_k − w*)``，回傳 shape (steps+1, M)。"""
    out = np.empty((steps + 1, w0.size))
    out[0] = w0
    for k in range(steps):
        out[k + 1] = out[k] + m @ (j @ (out[k] - w_star))
    return out
