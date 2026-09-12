"""Adapter for the official snapshot, stable UI keys, and persisted observations."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = 'ntpc-official-v1'
SNAPSHOT_YEAR = '最新快照'


def latest_evaluation(evaluations):
    """Latest dated outcome wins; an old failed inspection is not a current failure."""
    def order(e):
        return (e.get('date') or '', int(e.get('year') or 0))
    return max(evaluations, key=order, default=None)


def evaluation_outcome(result):
    if not result:
        return None
    if '部分指標' in result or '待改善' in result or '不符合' in result:
        return '待改善'
    if '全數指標通過' in result or '全數指標改善完畢' in result or result == '符合':
        return '符合'
    return None


def load_workspace_schools(state=None):
    state = state or {}
    if state.get('workspace') != WORKSPACE:
        state = {}
    raw = json.loads((ROOT/'data/real_schools.json').read_text())
    schools = []
    ids = set()
    year = state.get('p0', {}).get('year', SNAPSHOT_YEAR)
    for source in raw:
        # 48-bit value remains exactly representable by JavaScript and SQLite.
        key = int(source['id'].removeprefix('NTPC-')[:12], 16)
        if key in ids:
            raise ValueError('Duplicate workspace identifier')
        ids.add(key)
        latest = latest_evaluation(source['evaluations'])
        s = {**source, 'id': key, 'officialId': source['id'], 'complete': 0,
             'score': 0, 'trend': None, 'latestEvaluation': latest,
             'evaluationResult': evaluation_outcome(latest['result']) if latest else None}
        if year != SNAPSHOT_YEAR:
            s['evaluationResult'] = None
        records = state.get('p0', {}).get('data', {}).get(str(key), {}).get(year, {})
        for field, record in records.items():
            if record.get('conflict'):
                s[field] = None
            else:
                chosen = next((c for c in record.get('candidates', []) if c['id'] == record.get('chosen')), None)
                if chosen:
                    s[field] = chosen.get('value')
        schools.append(s)
    for imported in state.get('importedSchools', []):
        if imported['id'] not in ids:
            s = dict(imported)
            for field, record in state.get('p0', {}).get('data', {}).get(str(s['id']), {}).get(year, {}).items():
                chosen = next((c for c in record.get('candidates', []) if c['id'] == record.get('chosen')), None)
                s[field] = None if record.get('conflict') else chosen.get('value') if chosen else None
            schools.append(s)
    return schools
