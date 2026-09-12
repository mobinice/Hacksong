"""Risk evaluation for observed official data; the original demo engine is unchanged."""
from typing import List, Dict, Any, Optional
from scripts.risk_engine import DEFAULT_RULES, DEFAULT_THRESHOLDS, DIMENSION_WEIGHTS

def evaluate_school_risk(school, rules=None, thresholds=None):
    """Evaluate only observed values; never synthesize evidence for missing inputs."""
    import math
    from scripts.workspace_data import evaluation_outcome, latest_evaluation
    rules = DEFAULT_RULES if rules is None else rules
    thresholds = DEFAULT_THRESHOLDS if thresholds is None else thresholds
    values = dict(school)
    if 'evaluationResult' not in values:
        latest = latest_evaluation(values.get('evaluations', []))
        values['evaluationResult'] = evaluation_outcome(latest['result']) if latest else None
    required = {
        'repeat': ['penaltyCount'], 'eval': ['evaluationResult'],
        'staff': ['staffCost', 'studentCount'],
        'growth': ['staffCost', 'previousStaffCost', 'studentCount', 'previousStudentCount'],
        'income': ['revenue', 'tuition', 'studentCount'],
        'signals': ['signalCount', 'signalBaseline']}
    aliases = dict(zip(['repeat_penalty','eval_deficiency','staff_cost','cost_growth','revenue_diff','sentiment_alert'], required))
    dim_scores = dict.fromkeys(DIMENSION_WEIGHTS, 0)
    evidence = []
    for rule in rules:
        if not rule.get('enabled', True):
            continue
        key = aliases.get(rule['id'], rule['id'])
        fields = required.get(key, [])
        missing = [f for f in fields if values.get(f) is None or values.get(f) == '']
        weight = rule.get('weight', 0)
        hit, contribution, observed, formula = False, 0, '資料不足', '待補齊：' + '、'.join(missing)
        available = bool(fields) and not missing
        if available and key != 'eval':
            available = all(isinstance(values[f], (int, float)) and not isinstance(values[f], bool) and math.isfinite(values[f]) and values[f] >= 0 for f in fields)
        if available:
            if key == 'repeat':
                count = values['penaltyCount']
                hit = count >= rule.get('threshold', 1)
                contribution = min(count * (weight // 2 or 10), weight) if hit else 0
                observed = f'近 12 個月裁罰 {count} 次'
            elif key == 'eval':
                outcome = evaluation_outcome(values['evaluationResult'])
                available = outcome is not None
                hit = outcome == '待改善'
                observed = '最近公開評鑑結果：' + str(values['evaluationResult'])
            elif key == 'staff':
                available = values['studentCount'] > 0
                if available:
                    amount = round(values['staffCost'] / values['studentCount'])
                    hit = amount > rule.get('threshold', 98000)
                    observed = f'每生人事費 {amount} 元'
            elif key == 'growth':
                available = values['previousStaffCost'] > 0 and values['previousStudentCount'] > 0
                if available:
                    growth = round((values['staffCost'] / values['previousStaffCost'] - 1) * 100)
                    students = round((values['studentCount'] / values['previousStudentCount'] - 1) * 100)
                    hit = growth > rule.get('threshold', 30) and growth > students
                    observed = f'人事費年增 {growth}%，學生數年增 {students}%'
            elif key == 'income':
                estimate = values['tuition'] * values['studentCount'] * 12
                available = estimate > 0
                if available:
                    difference = round(abs(values['revenue'] - estimate) / estimate * 100)
                    hit = difference > rule.get('threshold', 20)
                    observed = f'申報收入與月費推估收入差異 {difference}%'
            elif key == 'signals':
                available = values['signalBaseline'] > 0
                if available:
                    growth = round((values['signalCount'] / values['signalBaseline'] - 1) * 100)
                    hit = growth > rule.get('threshold', 200)
                    observed = f'負面訊號增幅 {growth}%'
            if key != 'repeat':
                contribution = weight if hit else 0
            formula = observed + f"；門檻 {rule.get('threshold', '—')}"
        if not available:
            hit, contribution, observed = False, 0, '資料不足'
            formula = '待補齊／確認：' + '、'.join(missing or fields)
        dimension = rule.get('dimension', '資料／營運一致性')
        dim_scores[dimension] = dim_scores.get(dimension, 0) + contribution
        evidence.append({'ruleId': rule['id'], 'name': rule.get('name', key), 'dimension': dimension,
                         'weight': weight, 'hit': hit, 'contribution': contribution,
                         'observed': observed, 'formula': formula, 'threshold': rule.get('threshold'),
                         'status': ('異常' if hit else '未觸發') if available else '資料不足',
                         'available': available, 'missing': missing,
                         'action': '核對原始來源及改善情形' if hit else '補齊資料來源' if not available else '追蹤來源更新'})
    total_weight = sum(e['weight'] for e in evidence)
    coverage = round(sum(e['weight'] for e in evidence if e['available']) / total_weight * 100, 2) if total_weight else 0
    incomplete = coverage < 60
    total = sum(dim_scores.values())
    level, en, cls = ('資料不足', 'incomplete', 'unknown') if incomplete else (('高風險','high','high') if total >= thresholds[2] else ('中高風險','mid-high','mid') if total >= thresholds[1] else ('中風險','medium','mid') if total >= thresholds[0] else ('低風險','low','low'))
    hits = [e for e in evidence if e['hit']]
    return {'id': school.get('id'), 'officialId': school.get('officialId'),
            'name': school.get('name'), 'district': school.get('district'),
            'address': school.get('address'), 'type': school.get('type'), 'capacity': school.get('capacity'),
            'completeness': coverage, 'isIncomplete': incomplete, 'totalScore': total,
            'displayScore': '—' if incomplete else total, 'riskLevel': level, 'riskLevelEn': en,
            'riskClass': cls, 'anomaliesCount': len(hits),
            'dimensions': {k: {'score': dim_scores[d], 'max': DIMENSION_WEIGHTS[d], 'label': d}
                           for k, d in zip(['compliance','finance','consistency','sentiment'], DIMENSION_WEIGHTS)},
            'hitReasons': hits, 'evidences': evidence}

def recalculate_all_schools(schools: List[Dict[str, Any]], rules: Optional[List[Dict[str, Any]]] = None, thresholds: Optional[List[int]] = None) -> Dict[str, Any]:
    """
    批次計算所有園所的最新風險分數與四構面分數，回傳綜合報表與統計指標。
    """
    evaluated = [evaluate_school_risk(s, rules, thresholds) for s in schools]

    high_risk_count = sum(1 for s in evaluated if s["riskLevel"] == "高風險")
    mid_high_count = sum(1 for s in evaluated if s["riskLevel"] == "中高風險")
    mid_count = sum(1 for s in evaluated if s["riskLevel"] == "中風險")
    low_count = sum(1 for s in evaluated if s["riskLevel"] == "低風險")
    incomplete_count = sum(1 for s in evaluated if s["isIncomplete"])
    anomalies_total = sum(1 for s in evaluated if s["anomaliesCount"] > 0)

    return {
        "schools": evaluated,
        "stats": {
            "total": len(evaluated),
            "high": high_risk_count,
            "midHigh": mid_high_count,
            "mid": mid_count,
            "low": low_count,
            "incomplete": incomplete_count,
            "hasAnomalies": anomalies_total
        },
        "rulesUsed": rules or DEFAULT_RULES,
        "thresholdsUsed": thresholds or DEFAULT_THRESHOLDS
    }
