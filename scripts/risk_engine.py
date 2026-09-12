#!/usr/bin/env python3
"""
幼安雷達 - 動態四構面風險評分引擎 (Risk Engine)
實作四大構面（法遵 40 / 財務 35 / 資料一致性 15 / 輿情 10）可解釋風險計算邏輯與資料不足防呆。
"""

from typing import Dict, List, Any, Optional

DEFAULT_RULES = [
    {
        "id": "repeat_penalty",
        "name": "一年內重複裁罰",
        "dimension": "法遵／裁罰／評鑑",
        "weight": 20,
        "threshold": 1,  # 裁罰次數超過 1 次
        "condition": "近 12 個月同類型裁罰累加",
        "impact": "高",
        "enabled": True,
        "date": "2026-09-12"
    },
    {
        "id": "eval_deficiency",
        "name": "評鑑缺失或待改善",
        "dimension": "法遵／裁罰／評鑑",
        "weight": 20,
        "threshold": 1,  # 評鑑有待改善或追蹤評鑑
        "condition": "基礎評鑑指標未全數通過或列為待改善",
        "impact": "高",
        "enabled": True,
        "date": "2026-09-12"
    },
    {
        "id": "staff_cost",
        "name": "每生人事成本偏高",
        "dimension": "財務／收費",
        "weight": 20,
        "threshold": 98000,  # 每生人事成本門檻 98,000 元/生
        "condition": "年度人事費 ÷ 實際學生數 > 每生金額門檻",
        "impact": "高",
        "enabled": True,
        "date": "2026-09-12"
    },
    {
        "id": "cost_growth",
        "name": "人事費增加快於學生人數",
        "dimension": "財務／收費",
        "weight": 15,
        "threshold": 30,  # 人事費年增率 > 30% 且大於學生數增幅
        "condition": "人事費年增率 > 門檻% 且大於學生數年增率",
        "impact": "中",
        "enabled": True,
        "date": "2026-09-12"
    },
    {
        "id": "revenue_diff",
        "name": "收費推估與申報收入差異",
        "dimension": "資料／營運一致性",
        "weight": 15,
        "threshold": 20,  # 收入差異 > 20%
        "condition": "|申報收入 − 月費 × 學生數 × 12| ÷ 推估收入 × 100 > 門檻%",
        "impact": "中",
        "enabled": True,
        "date": "2026-09-12"
    },
    {
        "id": "sentiment_alert",
        "name": "近期負面輿情訊號增加",
        "dimension": "輿情預警",
        "weight": 10,
        "threshold": 200,  # 負面訊號增幅 > 200%
        "condition": "（近 7 日訊號 − 基準訊號）÷ 基準訊號 × 100 > 門檻%",
        "impact": "低",
        "enabled": True,
        "date": "2026-09-12"
    }
]

DEFAULT_THRESHOLDS = [40, 60, 75]  # [低/中, 中/中高, 中高/高]

DIMENSION_WEIGHTS = {
    "法遵／裁罰／評鑑": 40,
    "財務／收費": 35,
    "資料／營運一致性": 15,
    "輿情預警": 10
}

def evaluate_school_risk(school: Dict[str, Any], rules: Optional[List[Dict[str, Any]]] = None, thresholds: Optional[List[int]] = None) -> Dict[str, Any]:
    """
    動態評估單一園所的四構面風險分數、各規則觸發狀態與數值比對證據。
    """
    if rules is None:
        rules = DEFAULT_RULES
    if thresholds is None:
        thresholds = DEFAULT_THRESHOLDS

    n = school.get("id", 0)
    if isinstance(n, str) and n.startswith("REAL-"):
        try:
            n_val = int(n.replace("REAL-", "")) - 1
        except ValueError:
            n_val = 0
    else:
        try:
            n_val = int(n)
        except (ValueError, TypeError):
            n_val = 0

    student_count = school.get("studentCount")
    if student_count is None:
        student_count = school.get("capacity", 100 + n_val * 3)

    capacity = school.get("capacity", 120 + n_val * 5)
    completeness = school.get("complete", school.get("completeness", 34 if n_val >= 18 else (91 - n_val % 7)))

    penalty_count = school.get("penaltyCount", 2 if n_val < 5 else (1 if n_val < 12 else 0))
    eval_result = school.get("evaluationResult", "待改善" if n_val < 5 else "符合")
    
    # 若有 evaluations 陣列（真實資料）
    evals = school.get("evaluations", [])
    if evals:
        eval_result = evals[0].get("result", eval_result)
        if any("部分指標" in e.get("result", "") or "追蹤" in e.get("result", "") for e in evals):
            eval_result = "待改善"
        elif any("全數指標通過" in e.get("result", "") for e in evals):
            eval_result = "符合"

    tuition = school.get("tuition", 5000)
    revenue = school.get("revenue", 9200000 if n_val < 5 else student_count * 60000)
    staff_cost = school.get("staffCost", student_count * 146000 if n_val < 7 else student_count * 80000)
    previous_staff_cost = school.get("previousStaffCost", round(student_count * 146000 / 1.4) if n_val < 7 else round(student_count * 80000 / 1.03))
    previous_student_count = school.get("previousStudentCount", round(student_count / 1.05))
    signal_count = school.get("signalCount", 10 if n_val < 3 else 2)
    signal_baseline = school.get("signalBaseline", 2)

    # 4 構面評分累積
    dim_scores = {
        "法遵／裁罰／評鑑": 0,
        "財務／收費": 0,
        "資料／營運一致性": 0,
        "輿情預警": 0
    }
    
    evidence_list = []
    anomalies_count = 0

    rules_dict = {r["id"]: r for r in rules}

    # 1. 法遵構面: 一年內重複裁罰
    r_repeat = rules_dict.get("repeat_penalty", rules_dict.get("repeat", {}))
    if r_repeat and r_repeat.get("enabled", True):
        weight = r_repeat.get("weight", 20)
        hit = penalty_count >= r_repeat.get("threshold", 1)
        contribution = min(penalty_count * (weight // 2 or 10), weight) if hit else 0
        if contribution > 0:
            anomalies_count += 1
            dim_scores["法遵／裁罰／評鑑"] += contribution
        evidence_list.append({
            "ruleId": "repeat_penalty",
            "name": r_repeat.get("name", "一年內重複裁罰"),
            "dimension": "法遵／裁罰／評鑑",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"近 12 個月裁罰紀錄 {penalty_count} 次",
            "threshold": f"門檻 ≥ {r_repeat.get('threshold', 1)} 次",
            "formula": f"裁罰次數 {penalty_count} 次 × {weight//2} 分 = {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "調閱前次裁罰通知書與改善計畫書，確認複查成果及人員配置。"
        })

    # 2. 法遵構面: 評鑑缺失
    r_eval = rules_dict.get("eval_deficiency", rules_dict.get("eval", {}))
    if r_eval and r_eval.get("enabled", True):
        weight = r_eval.get("weight", 20)
        hit = eval_result in ["待改善", "不符合", "部分指標通過", "追蹤評鑑"]
        contribution = weight if hit else 0
        if hit:
            anomalies_count += 1
            dim_scores["法遵／裁罰／評鑑"] += contribution
        evidence_list.append({
            "ruleId": "eval_deficiency",
            "name": r_eval.get("name", "評鑑缺失或待改善"),
            "dimension": "法遵／裁罰／評鑑",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"基礎評鑑狀態：{eval_result}",
            "threshold": "需為「全數指標通過／符合」",
            "formula": f"評鑑未達標 ({eval_result}) 計 {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "核對幼兒園基礎評鑑改善追蹤表與安全檢核紀錄。"
        })

    # 3. 財務構面: 每生人事成本偏高
    r_staff = rules_dict.get("staff_cost", rules_dict.get("staff", {}))
    if r_staff and r_staff.get("enabled", True):
        weight = r_staff.get("weight", 20)
        threshold_cost = r_staff.get("threshold", 98000)
        per_student_cost = round(staff_cost / student_count) if student_count > 0 else 0
        hit = per_student_cost > threshold_cost
        contribution = weight if hit else 0
        if hit:
            anomalies_count += 1
            dim_scores["財務／收費"] += contribution
        diff_pct = round((per_student_cost - threshold_cost) / threshold_cost * 100, 1) if threshold_cost else 0
        evidence_list.append({
            "ruleId": "staff_cost",
            "name": r_staff.get("name", "每生人事成本偏高"),
            "dimension": "財務／收費",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"每生人事費 {per_student_cost:,} 元／生 (人事費 {staff_cost:,} ÷ 學生數 {student_count})",
            "threshold": f"同類規模前 10% 門檻 {threshold_cost:,} 元／生",
            "formula": f"{per_student_cost:,} 元 > 門檻 {threshold_cost:,} 元 (+{diff_pct}%) 計 {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "比對員工名冊、薪資明細表與勞健保投保級距。"
        })

    # 4. 財務構面: 人事費增加快於學生人數
    r_growth = rules_dict.get("cost_growth", rules_dict.get("growth", {}))
    if r_growth and r_growth.get("enabled", True):
        weight = r_growth.get("weight", 15)
        threshold_growth = r_growth.get("threshold", 30)
        staff_growth = round((staff_cost - previous_staff_cost) / previous_staff_cost * 100, 1) if previous_staff_cost > 0 else 0
        student_growth = round((student_count - previous_student_count) / previous_student_count * 100, 1) if previous_student_count > 0 else 0
        hit = staff_growth > threshold_growth and staff_growth > student_growth
        contribution = weight if hit else 0
        if hit:
            anomalies_count += 1
            dim_scores["財務／收費"] += contribution
        evidence_list.append({
            "ruleId": "cost_growth",
            "name": r_growth.get("name", "人事費增加快於學生人數"),
            "dimension": "財務／收費",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"人事費年增率 +{staff_growth}%，學生數年增率 +{student_growth}%",
            "threshold": f"人事費增幅 > {threshold_growth}% 且 > 學生數增幅",
            "formula": f"人事費年增 {staff_growth}% 顯著超越學生增幅 {student_growth}% 計 {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "查核前後年度會計帳冊、調薪依據與臨時外包費用憑證。"
        })

    # 5. 資料一致性構面: 收費推估與申報收入差異
    r_rev = rules_dict.get("revenue_diff", rules_dict.get("income", {}))
    if r_rev and r_rev.get("enabled", True):
        weight = r_rev.get("weight", 15)
        threshold_rev_diff = r_rev.get("threshold", 20)
        estimated_rev = tuition * student_count * 12
        rev_diff_pct = round(abs(revenue - estimated_rev) / estimated_rev * 100, 1) if estimated_rev > 0 else 0
        hit = rev_diff_pct > threshold_rev_diff
        contribution = weight if hit else 0
        if hit:
            anomalies_count += 1
            dim_scores["資料／營運一致性"] += contribution
        evidence_list.append({
            "ruleId": "revenue_diff",
            "name": r_rev.get("name", "收費推估與申報收入差異"),
            "dimension": "資料／營運一致性",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"申報年收入 {revenue:,} 元 vs 收費推估 {estimated_rev:,} 元 (月費 {tuition:,} × {student_count} 人 × 12 月)",
            "threshold": f"差異比例 > {threshold_rev_diff}%",
            "formula": f"差異率 {rev_diff_pct}% > 門檻 {threshold_rev_diff}% (|{revenue - estimated_rev:,}| 元) 計 {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "調閱收退費明細清單、延托與代辦費收據、銀行往來存摺。"
        })

    # 6. 輿情預警構面: 近期負面輿情訊號增加
    r_sent = rules_dict.get("sentiment_alert", rules_dict.get("signals", {}))
    if r_sent and r_sent.get("enabled", True):
        weight = r_sent.get("weight", 10)
        threshold_sent = r_sent.get("threshold", 200)
        sent_growth = round((signal_count - signal_baseline) / signal_baseline * 100, 1) if signal_baseline > 0 else 0
        hit = sent_growth > threshold_sent
        contribution = weight if hit else 0
        if hit:
            anomalies_count += 1
            dim_scores["輿情預警"] += contribution
        evidence_list.append({
            "ruleId": "sentiment_alert",
            "name": r_sent.get("name", "近期負面輿情訊號增加"),
            "dimension": "輿情預警",
            "weight": weight,
            "hit": hit,
            "contribution": contribution,
            "observed": f"近 7 日負面訊號 {signal_count} 則 (前期基準 {signal_baseline} 則)",
            "threshold": f"負面訊號增幅 > {threshold_sent}%",
            "formula": f"訊號增幅 +{sent_growth}% > 門檻 {threshold_sent}% 計 {contribution} 分",
            "status": "異常" if hit else "正常",
            "action": "查證社群網路通報、媒體報導與家長申訴紀錄真實性。"
        })

    # 總分計算
    total_score = sum(dim_scores.values())

    # 防呆規則：資料完整度未達 60% 時，獨立標記「⚠️ 資料不足」，絕不誤標為安全低風險
    is_incomplete = completeness < 60
    if is_incomplete:
        risk_level = "資料不足"
        risk_level_en = "incomplete"
        risk_class = "unknown"
        display_score = "—"
    elif total_score >= thresholds[2]:
        risk_level = "高風險"
        risk_level_en = "high"
        risk_class = "high"
        display_score = total_score
    elif total_score >= thresholds[1]:
        risk_level = "中高風險"
        risk_level_en = "mid-high"
        risk_class = "mid"
        display_score = total_score
    elif total_score >= thresholds[0]:
        risk_level = "中風險"
        risk_level_en = "medium"
        risk_class = "mid"
        display_score = total_score
    else:
        risk_level = "低風險"
        risk_level_en = "low"
        risk_class = "low"
        display_score = total_score

    hit_reasons = [e for e in evidence_list if e["hit"]]
    if not hit_reasons:
        hit_reasons = [{
            "name": "目前未觸及主要風險條件",
            "dimension": "綜合指標",
            "observed": f"裁罰 {penalty_count} 次，各項指標未達預警門檻",
            "formula": "現有資料合規，建議納入例行排程追蹤",
            "action": "依常規期程進行年度書面備查審核"
        }]

    return {
        "id": school.get("id"),
        "name": school.get("name"),
        "district": school.get("district"),
        "address": school.get("address"),
        "type": school.get("type", "私立"),
        "capacity": capacity,
        "completeness": completeness,
        "isIncomplete": is_incomplete,
        "totalScore": total_score,
        "displayScore": display_score,
        "riskLevel": risk_level,
        "riskLevelEn": risk_level_en,
        "riskClass": risk_class,
        "anomaliesCount": anomalies_count,
        "dimensions": {
            "compliance": {
                "score": dim_scores["法遵／裁罰／評鑑"],
                "max": DIMENSION_WEIGHTS["法遵／裁罰／評鑑"],
                "label": "法遵／裁罰／評鑑"
            },
            "finance": {
                "score": dim_scores["財務／收費"],
                "max": DIMENSION_WEIGHTS["財務／收費"],
                "label": "財務／收費"
            },
            "consistency": {
                "score": dim_scores["資料／營運一致性"],
                "max": DIMENSION_WEIGHTS["資料／營運一致性"],
                "label": "資料一致性"
            },
            "sentiment": {
                "score": dim_scores["輿情預警"],
                "max": DIMENSION_WEIGHTS["輿情預警"],
                "label": "輿情預警"
            }
        },
        "hitReasons": hit_reasons,
        "evidences": evidence_list
    }

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

if __name__ == "__main__":
    sample_schools = [
        {"id": 0, "name": "幸福幼兒園", "district": "板橋區", "complete": 91, "capacity": 120},
        {"id": 18, "name": "星河幼兒園", "district": "板橋區", "complete": 34, "capacity": 210}
    ]
    res = recalculate_all_schools(sample_schools)
    print("Self test result:")
    for s in res["schools"]:
        print(f"School {s['name']}: Total={s['totalScore']}, Display={s['displayScore']}, Level={s['riskLevel']}, Dims={s['dimensions']}")
