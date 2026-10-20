"""Structural validator for the website's data JSON files (stdlib only).

This is the Python twin of ``src/data/validate.ts``: both read the same schema file,
``src/data/golden/schemas.json``, and must agree on every case in ``src/data/golden/schema-cases.json``
(``test_web_schema.py`` runs those cases; ``src/data/validate.test.ts`` runs the same list in Vitest).

The schema language (version 1) is documented at the top of ``validate.ts``::

    'number' (finite) | 'int' | 'string' | 'boolean' | 'null' | 'any' (any JSON value, all numbers finite)
    {array: S, length?: n, minLength?: n}   {tuple: [S, ...]}
    {object: {key: S}, optional?: [key], rest?: S, sameLength?: [[key, ...]], minKeys?: n}
    {enum: [value, ...]}   {oneOf: [S, ...]}   {$ref: 'defName'}

Usage::

    python3 analysis/sspll/golden/tools/web_schema.py            # check every web JSON listed in schemas.json
    python3 golden/export_vectors.py --check-web                 # same check, from the golden CLI (what CI runs)

Only structure is checked (keys, dimensions, types, finite numbers, and the zero-needs-abs-tolerance rule for golden
vectors); the numeric values themselves are checked against the golden model by the pytest files next to this one.
"""
from __future__ import annotations

import glob
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO / 'src' / 'data' / 'golden' / 'schemas.json'
CASES_PATH = REPO / 'src' / 'data' / 'golden' / 'schema-cases.json'

_IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
PRIMITIVES = ('number', 'int', 'string', 'boolean', 'null', 'any')


class Err:
    __slots__ = ('path', 'reason')

    def __init__(self, path: str, reason: str) -> None:
        self.path = path
        self.reason = reason

    def __str__(self) -> str:
        return f'{self.path} {self.reason}'


def _child(path: str, key: str) -> str:
    return f'{path}.{key}' if _IDENT.match(key) else f'{path}[{json.dumps(key, ensure_ascii=False)}]'


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _finite(v: Any) -> bool:
    return _is_num(v) and math.isfinite(v)


def _describe(v: Any) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return f'boolean {str(v).lower()}'
    if isinstance(v, list):
        return f'array (length {len(v)})'
    if isinstance(v, dict):
        return 'object'
    if isinstance(v, str):
        return f'string {json.dumps(v[:24] + ("…" if len(v) > 24 else ""), ensure_ascii=False)}'
    if _is_num(v):
        return f'number {v}' if math.isfinite(v) else f'non-finite number {v}'
    return type(v).__name__


def _check_finite(v: Any, path: str) -> Err | None:
    if _is_num(v):
        return None if math.isfinite(v) else Err(path, f'expected finite number, got {_describe(v)}')
    if isinstance(v, list):
        for i, x in enumerate(v):
            e = _check_finite(x, f'{path}[{i}]')
            if e:
                return e
    elif isinstance(v, dict):
        for k, x in v.items():
            e = _check_finite(x, _child(path, k))
            if e:
                return e
    return None


def _resolve(s: Any, defs: dict) -> Any:
    hops = 0
    while isinstance(s, dict) and '$ref' in s:
        if s['$ref'] not in defs:
            raise KeyError(f"schema refers to unknown def {s['$ref']!r}")
        s = defs[s['$ref']]
        hops += 1
        if hops > 32:
            raise RecursionError('$ref loop')
    return s


def check(v: Any, schema: Any, defs: dict, path: str = '$') -> Err | None:
    """First error (with a ``$.a.b[3]`` path) or None."""
    s = _resolve(schema, defs)
    if isinstance(s, str):
        if s == 'number':
            return None if _finite(v) else Err(path, f'expected finite number, got {_describe(v)}')
        if s == 'int':
            ok = _is_num(v) and math.isfinite(v) and float(v).is_integer()
            return None if ok else Err(path, f'expected integer, got {_describe(v)}')
        if s == 'string':
            return None if isinstance(v, str) else Err(path, f'expected string, got {_describe(v)}')
        if s == 'boolean':
            return None if isinstance(v, bool) else Err(path, f'expected boolean, got {_describe(v)}')
        if s == 'null':
            return None if v is None else Err(path, f'expected null, got {_describe(v)}')
        return _check_finite(v, path)
    if 'array' in s:
        if not isinstance(v, list):
            return Err(path, f'expected array, got {_describe(v)}')
        if 'length' in s and len(v) != s['length']:
            return Err(path, f"expected array of length {s['length']}, got length {len(v)}")
        if 'minLength' in s and len(v) < s['minLength']:
            return Err(path, f"expected at least {s['minLength']} elements, got {len(v)}")
        item = _resolve(s['array'], defs)
        for i, x in enumerate(v):
            e = check(x, item, defs, f'{path}[{i}]')
            if e:
                return e
        return None
    if 'tuple' in s:
        if not isinstance(v, list):
            return Err(path, f'expected array, got {_describe(v)}')
        if len(v) != len(s['tuple']):
            return Err(path, f"expected array of length {len(s['tuple'])}, got length {len(v)}")
        for i, (x, sub) in enumerate(zip(v, s['tuple'])):
            e = check(x, sub, defs, f'{path}[{i}]')
            if e:
                return e
        return None
    if 'object' in s:
        if not isinstance(v, dict):
            return Err(path, f'expected object, got {_describe(v)}')
        optional = set(s.get('optional', []))
        for key, sub in s['object'].items():
            if key not in v:
                if key in optional:
                    continue
                return Err(_child(path, key), 'missing required key')
            e = check(v[key], sub, defs, _child(path, key))
            if e:
                return e
        if 'rest' in s:
            for key in v:
                if key in s['object']:
                    continue
                e = check(v[key], s['rest'], defs, _child(path, key))
                if e:
                    return e
        if 'minKeys' in s and len(v) < s['minKeys']:
            return Err(path, f"expected at least {s['minKeys']} keys, got {len(v)}")
        for group in s.get('sameLength', []):
            n, first = -1, ''
            for key in group:
                a = v.get(key)
                if not isinstance(a, list):
                    continue
                if n < 0:
                    n, first = len(a), key
                elif len(a) != n:
                    return Err(_child(path, key), f'length {len(a)} differs from {first} (length {n}); fields in one group must be equally long')
        return None
    if 'enum' in s:
        for x in s['enum']:
            if type(x) is type(v) and x == v:
                return None
            if _is_num(x) and _is_num(v) and x == v:
                return None
        return Err(path, f"expected {' | '.join(json.dumps(x, ensure_ascii=False) for x in s['enum'])}, got {_describe(v)}")
    if 'oneOf' in s:
        errs = []
        for alt in s['oneOf']:
            e = check(v, alt, defs, path)
            if e is None:
                return None
            errs.append(e)
        errs.sort(key=lambda e: -len(e.path))
        return Err(path, f"matches none of {len(s['oneOf'])} alternatives; closest: {errs[0]}")
    return Err(path, f'unknown schema node {s!r}')


def load_schema_doc(path: Path = SCHEMA_PATH) -> dict:
    doc = json.loads(path.read_text(encoding='utf-8'))
    if doc.get('version') != 1:
        raise ValueError(f"{path}: unsupported schema version {doc.get('version')!r}")
    return doc


def expand(entry: dict, repo: Path = REPO) -> list[Path]:
    """The concrete files a schemas.json entry covers (``paths`` or a single-``*`` ``glob``)."""
    if 'paths' in entry:
        return [repo / p for p in entry['paths']]
    return sorted(Path(p) for p in glob.glob(str(repo / entry['glob'])) if Path(p).name != 'index.json')


# --- extra rule for golden vectors: an expected value of exactly 0 needs an absolute tolerance -------------------------

def _zeros(v: Any, prefix: str) -> list[str]:
    if _is_num(v):
        return [prefix] if v == 0 else []
    if isinstance(v, list):
        return [z for i, x in enumerate(v) for z in _zeros(x, f'{prefix}[{i}]')]
    return []


def vector_zero_tolerance_problems(vec: dict) -> list[str]:
    """Keys whose expected value contains 0 although the applicable tolerance has abs == 0 or no abs (rel alone cannot hit 0)."""
    out = []
    for key, val in vec.get('expected', {}).items():
        tol = vec.get('tolerance_overrides', {}).get(key, vec.get('tolerance', {}))
        zs = _zeros(val, key)
        if zs and not tol.get('abs', 0) > 0:
            out += [f'{z} = 0 but its tolerance has no abs > 0 ({tol})' for z in zs]
    return out


def check_web(repo: Path = REPO, schema_path: Path = SCHEMA_PATH) -> list[str]:
    """Validate every JSON listed in schemas.json. Returns a list of problems (empty = fine)."""
    doc = load_schema_doc(schema_path)
    defs = doc['defs']
    problems: list[str] = []
    seen: set[Path] = set()
    for entry in doc['files']:
        files = expand(entry, repo)
        if not files:
            problems.append(f"{entry['id']}: no files match")
        for f in files:
            rel = f.relative_to(repo) if f.is_relative_to(repo) else f
            seen.add(f.resolve())
            if not f.exists():
                problems.append(f'{rel}: file is missing (schema id {entry["id"]})')
                continue
            try:
                # parse_constant: refuse NaN / Infinity literals that Python's json.dump writes by default
                bad: list[str] = []
                data = json.loads(f.read_text(encoding='utf-8'), parse_constant=lambda c: bad.append(c) or 0.0)
            except (OSError, ValueError) as ex:
                problems.append(f'{rel}: not valid JSON ({ex})')
                continue
            if bad:
                problems.append(f'{rel}: contains the non-JSON literal {bad[0]} (use null or a finite number)')
                continue
            e = check(data, entry['schema'], defs)
            if e:
                problems.append(f'{rel} [{entry["id"]}]: {e}')
            elif entry['id'].startswith('golden/vector'):
                problems += [f'{rel}: {p}' for p in vector_zero_tolerance_problems(data)]
    # every golden vector on disk, and every file in src/data/sspll, must be covered by some entry
    for pattern in ('golden/vectors/*.json', 'src/data/sspll/*.json', 'src/data/*.json'):
        for f in sorted(glob.glob(str(repo / pattern))):
            if Path(f).resolve() not in seen:
                problems.append(f'{Path(f).relative_to(repo)}: not listed in schemas.json (add a schema entry, or move the file out of the web data folders)')
    return problems


def main(argv: list[str] | None = None) -> int:
    problems = check_web()
    if problems:
        print('web data check FAILED:')
        for p in problems:
            print('  -', p)
        return 1
    doc = load_schema_doc()
    n = sum(len(expand(e)) for e in doc['files'])
    print(f'web data OK: {n} JSON files match {len(doc["files"])} schema entries ({SCHEMA_PATH.relative_to(REPO)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
