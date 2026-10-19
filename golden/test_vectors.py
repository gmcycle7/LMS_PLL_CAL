"""golden/vectors/*.json 的格式檢查與「是否與目前 golden model 同步」檢查。"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

import export_vectors

VECTORS_DIR = Path(__file__).resolve().parent / 'vectors'
REQUIRED_KEYS = ('id', 'description_zh', 'spec_section', 'inputs', 'expected', 'tolerance', 'notes')
T_IDS = [f'T{i:02d}' for i in range(1, 19)]


def _reject_constant(name: str) -> Any:
    raise ValueError(f'JSON 含非有限值 {name}')


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=_reject_constant)


def _numbers(x: Any) -> list[float]:
    if isinstance(x, bool):
        return []
    if isinstance(x, (int, float)):
        return [float(x)]
    if isinstance(x, list):
        return [v for item in x for v in _numbers(item)]
    if isinstance(x, dict):
        return [v for item in x.values() for v in _numbers(item)]
    return []


def test_vectors_exist_for_every_acceptance_id():
    for tid in T_IDS:
        assert (VECTORS_DIR / f'{tid}.json').exists(), f'缺少 {tid}.json —— 請執行 python3 golden/export_vectors.py'
    index = load(VECTORS_DIR / 'index.json')
    listed = {v['file'] for v in index['vectors']}
    for tid in T_IDS:
        assert f'{tid}.json' in listed
    for entry in index['vectors']:
        assert (VECTORS_DIR / entry['file']).exists()


@pytest.mark.parametrize('path', sorted(p for p in VECTORS_DIR.glob('*.json') if p.name != 'index.json'), ids=lambda p: p.name)
def test_vector_schema(path: Path):
    vec = load(path)
    for key in REQUIRED_KEYS:
        assert key in vec, f'{path.name} 缺少 {key}'
    assert vec['id'] == path.stem
    assert isinstance(vec['description_zh'], str) and vec['description_zh']
    assert isinstance(vec['spec_section'], str) and vec['spec_section'].startswith('§')
    assert isinstance(vec['inputs'], dict) and isinstance(vec['expected'], dict) and vec['expected']
    tol = vec['tolerance']
    assert set(tol) <= {'abs', 'rel'} and tol
    assert all(isinstance(t, (int, float)) and t >= 0 for t in tol.values())
    for key, ov in vec.get('tolerance_overrides', {}).items():
        assert key in vec['expected'], f'{path.name}: override {key} 不在 expected 中'
        assert set(ov) <= {'abs', 'rel'} and ov
    for value in _numbers(vec['expected']) + _numbers(vec['inputs']):
        assert math.isfinite(value)


def test_vectors_in_sync_with_golden_model():
    """
    磁碟上的 vectors 必須等於目前 golden model 重新計算的結果。比對規則和 `export_vectors.py --check` 相同
    （export_vectors.vector_mismatch）：中繼資料完全相等，inputs／expected 用該 vector 自己的容忍度——
    純相對容忍度會讓「數值上是 0」的量（例如 θ* 裡的 4e-15）在另一個平台／NumPy 版本上必定失敗。
    """
    fresh = export_vectors.build_vectors()
    for name, vec in fresh.items():
        path = VECTORS_DIR / f'{name}.json'
        assert path.exists(), f'缺少 {name}.json'
        on_disk = load(path)
        fresh_rt = json.loads(export_vectors.dumps(vec))
        mismatch = export_vectors.vector_mismatch(on_disk, fresh_rt)
        assert mismatch is None, f'{name}.json 已過期（{mismatch}）—— 請執行 python3 golden/export_vectors.py'
