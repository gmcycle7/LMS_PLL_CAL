"""Tests for tools/web_schema.py, the Python twin of src/data/validate.ts (shared schema: src/data/golden/schemas.json)."""
from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import web_schema as ws  # noqa: E402

CASES = json.loads(ws.CASES_PATH.read_text(encoding='utf-8'))


def _read(rel: str):
    return json.loads((ws.REPO / rel).read_text(encoding='utf-8'))


def _entry(id_: str) -> dict:
    return next(e for e in ws.load_schema_doc()['files'] if e['id'] == id_)


def _check(id_: str, value):
    return ws.check(value, _entry(id_)['schema'], ws.load_schema_doc()['defs'])


@pytest.mark.parametrize('case', CASES['cases'], ids=lambda c: c['name'])
def test_WEBSCHEMA_shared_cases_match_typescript(case):
    """The same cases run in src/data/validate.test.ts; ok flag and error path must agree on both sides."""
    err = ws.check(case['value'], case['schema'], CASES['defs'])
    if case['ok']:
        assert err is None, str(err)
    else:
        assert err is not None
        assert str(err).startswith(case.get('path', '$') + ' '), str(err)


def test_WEBSCHEMA_non_finite_numbers_are_rejected():
    assert ws.check(math.nan, 'number', {}) is not None
    assert str(ws.check([1, math.inf], {'array': 'number'}, {})).startswith('$[1] ')
    assert str(ws.check({'a': [0, {'b': -math.inf}]}, 'any', {})).startswith('$.a[1].b ')


def test_WEBSCHEMA_real_web_json_passes():
    """Every JSON listed in schemas.json validates (this is what `export_vectors.py --check-web` runs in CI)."""
    assert ws.check_web() == []


def test_WEBSCHEMA_every_web_data_file_is_listed():
    doc = ws.load_schema_doc()
    listed = {p.resolve() for e in doc['files'] for p in ws.expand(e)}
    for pattern in ('golden/vectors/*.json', 'src/data/sspll/*.json', 'src/data/*.json'):
        for f in (ws.REPO).glob(pattern):
            assert f.resolve() in listed, f'{f} has no schema entry'


def test_WEBSCHEMA_mutations_are_caught_at_the_right_path():
    hpd = _read('src/data/sspll/hpd_L1.json')
    short = copy.deepcopy(hpd)
    short['ReH'].pop()
    assert str(_check('sspll/hpd', short)).startswith('$.ReH ')
    renamed = copy.deepcopy(hpd)
    renamed['ReH_renamed'] = renamed.pop('ReH')
    assert str(_check('sspll/hpd', renamed)).startswith('$.ReH ')
    assert str(_check('sspll/hpd', {**hpd, 'loop': 'L4'})).startswith('$.loop ')

    sm = _read('src/data/sspll/signmap_L2.json')
    sm['summary']['n_large_signal_inverted'] = 2.5
    assert str(_check('sspll/signmap', sm)).startswith('$.summary.n_large_signal_inverted ')

    params = _read('src/data/sspll/params.json')
    del params['loops']['L2']['bL']
    assert str(_check('sspll/params', params)).startswith('$.loops.L2.bL ')

    pred = _read('src/data/sspll/pred_vs_sim.json')
    pred['fine']['L2']['kP_sim'].pop()
    assert str(_check('sspll/pred_vs_sim', pred)).startswith('$.fine.L2.kP_sim ')

    vec = _read('golden/vectors/T01.json')
    vec['tolerance'] = {}
    assert str(_check('golden/vector', vec)).startswith('$.tolerance ')


def test_WEBSCHEMA_nan_literal_in_a_file_is_reported(tmp_path):
    """Python's json.dump writes NaN by default; --check-web must flag the literal (JS's JSON.parse would reject it)."""
    repo = tmp_path
    (repo / 'src/data/golden').mkdir(parents=True)
    (repo / 'x.json').write_text('{"a": NaN}', encoding='utf-8')
    schema = {'version': 1, 'defs': {}, 'files': [{'id': 'x', 'paths': ['x.json'], 'tsType': 'T', 'usedBy': ['u'], 'schema': {'object': {'a': 'number'}}}]}
    sp = repo / 'src/data/golden/schemas.json'
    sp.write_text(json.dumps(schema), encoding='utf-8')
    problems = ws.check_web(repo, sp)
    assert any('NaN' in p for p in problems), problems


def test_WEBSCHEMA_zero_expected_needs_abs_tolerance():
    ok = {'expected': {'a': 0.0, 'b': [1.0, 0]}, 'tolerance': {'abs': 1e-12}}
    assert ws.vector_zero_tolerance_problems(ok) == []
    rel_only = {'expected': {'a': 0.0}, 'tolerance': {'rel': 1e-9}}
    assert len(ws.vector_zero_tolerance_problems(rel_only)) == 1
    override = {'expected': {'a': 0.0, 'b': 3.0}, 'tolerance': {'rel': 1e-9}, 'tolerance_overrides': {'a': {'abs': 0.0}}}
    assert len(ws.vector_zero_tolerance_problems(override)) == 1   # the override replaces the default and has abs == 0
