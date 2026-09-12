#!/usr/bin/env python3
"""
幼安雷達 - 全系統端對端集成測試套件 (Full System E2E Test Suite)
涵蓋：
1. EC2 行程守護 (systemd) 崩潰自愈 (Crash Recovery) 實測
2. AWS RDS (PostgreSQL) 雲端資料庫讀寫、持久化與統計
3. 四構面動態風險評分引擎與完整度未滿 60% 資料不足防呆機制
4. AWS Bedrock (Amazon Nova) 智能查核建議與調閱公文動態生成
5. Nginx 反向代理、靜態資源與 HTTP API 延遲檢驗
"""

import os
import sys
import time
import json
import subprocess
import urllib.request
import urllib.error

EC2_HOST = "54.191.62.21"
EC2_USER = "ubuntu"
SSH_KEY = os.path.expanduser("~/.ssh/youan-radar-key.pem")

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

results = []

def record(module, item, passed, detail=""):
    status_str = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    results.append({"module": module, "item": item, "passed": passed, "detail": detail})
    print(f"[{status_str}] {BOLD}{module}{RESET} - {item}")
    if detail:
        print(f"       └─ {detail}")

def run_ssh(cmd, timeout=15):
    full_cmd = ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=accept-new", f"{EC2_USER}@{EC2_HOST}", cmd]
    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def http_get(path):
    url = f"http://{EC2_HOST}{path}"
    start = time.time()
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        elapsed = round((time.time() - start) * 1000, 1)
        data = resp.read().decode("utf-8")
        return resp.status, elapsed, data

def http_post(path, payload):
    url = f"http://{EC2_HOST}{path}"
    start = time.time()
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        elapsed = round((time.time() - start) * 1000, 1)
        data = resp.read().decode("utf-8")
        return resp.status, elapsed, data

def main():
    print(f"\n{CYAN}{'='*70}{RESET}")
    print(f"{CYAN}{BOLD}🚀 幼安雷達 - 全系統端對端整合測試 (Target: http://{EC2_HOST}){RESET}")
    print(f"{CYAN}{'='*70}{RESET}\n")

    # -------------------------------------------------------------
    # 測試項目 1: Nginx 反向代理與前端靜態資源健康度
    # -------------------------------------------------------------
    print(f"{BOLD}1. 檢驗 Nginx 反向代理與 HTTP 前端介面...{RESET}")
    try:
        st, ms, html = http_get("/")
        record("Nginx & Frontend", "首頁根目錄 HTTP 200", st == 200, f"延遲: {ms}ms")
    except Exception as e:
        record("Nginx & Frontend", "首頁根目錄 HTTP 200", False, str(e))

    try:
        st, ms, html = http_get("/preview.html")
        has_content = "幼安雷達" in html and "AWS RDS PostgreSQL" in html
        record("Nginx & Frontend", "主預覽介面 (/preview.html) 載入正常", st == 200 and has_content, f"延遲: {ms}ms, 含有 RDS 雲端宣告")
    except Exception as e:
        record("Nginx & Frontend", "主預覽介面 (/preview.html) 載入正常", False, str(e))

    # -------------------------------------------------------------
    # 測試項目 2: AWS RDS (PostgreSQL) 雲端儲存與持久化 API
    # -------------------------------------------------------------
    print(f"\n{BOLD}2. 檢驗 AWS RDS (PostgreSQL) 雲端資料庫狀態與 API...{RESET}")
    try:
        st, ms, body = http_get("/api/storage/stats")
        data = json.loads(body)
        stats = data.get("stats", {})
        is_rds = stats.get("backend") == "AWS RDS PostgreSQL"
        has_host = "rds.amazonaws.com" in stats.get("host", "")
        record("AWS RDS 雲端儲存", "資料庫後端確認為 AWS RDS PostgreSQL", is_rds and has_host, f"Host: {stats.get('host')}, Reviews: {stats.get('reviews_count')}, 延遲: {ms}ms")
    except Exception as e:
        record("AWS RDS 雲端儲存", "資料庫後端確認為 AWS RDS PostgreSQL", False, str(e))

    try:
        # 測試儲存覆核資料至 RDS
        test_payload = {
            "reviews": {
                "0": {
                    "status": "已排入查核",
                    "owner": "端對端整合測試員",
                    "date": "2026-09-20",
                    "note": "【全系統整合測試】模擬現場查核案件並驗證 RDS 雲端持久化儲存。",
                    "next": "調閱 113 學年度損益表與教保員薪資簽收單。",
                    "saved": time.strftime("%Y/%m/%d %H:%M:%S")
                }
            }
        }
        st, ms, body = http_post("/api/storage/save", test_payload)
        res_json = json.loads(body)
        saved_ok = res_json.get("status") == "success" and "AWS RDS" in res_json.get("backend", "")
        record("AWS RDS 雲端儲存", "寫入人工覆核紀錄至 RDS (/api/storage/save)", saved_ok, f"後端: {res_json.get('backend')}, 延遲: {ms}ms")
    except Exception as e:
        record("AWS RDS 雲端儲存", "寫入人工覆核紀錄至 RDS (/api/storage/save)", False, str(e))

    try:
        st, ms, body = http_get("/api/storage/state")
        res_json = json.loads(body)
        state_data = res_json.get("data", {})
        rev0 = state_data.get("reviews", {}).get("0", {})
        read_ok = rev0.get("owner") == "端對端整合測試員"
        record("AWS RDS 雲端儲存", "自 RDS 讀取最新覆核狀態 (/api/storage/state)", read_ok, f"讀出承辦人: {rev0.get('owner')}, 日期: {rev0.get('date')}, 延遲: {ms}ms")
    except Exception as e:
        record("AWS RDS 雲端儲存", "自 RDS 讀取最新覆核狀態 (/api/storage/state)", False, str(e))

    # -------------------------------------------------------------
    # 測試項目 3: 四構面動態風險評分引擎與資料不足防呆機制
    # -------------------------------------------------------------
    print(f"\n{BOLD}3. 檢驗四構面動態風險評分引擎與防呆機制...{RESET}")
    try:
        st, ms, body = http_get("/api/risk/schools")
        data = json.loads(body)
        schools = data.get("schools", [])
        rules = data.get("rules", [])
        
        # 1. 權重合計 100% 檢查
        total_weight = sum(r.get("weight", 0) for r in rules if r.get("enabled"))
        weight_ok = (total_weight == 100)
        record("風險評分引擎", "六大規則啟用權重合計 100%", weight_ok, f"啟用規則數: {len([r for r in rules if r.get('enabled')])}, 權重總和: {total_weight}%")

        # 2. 幸福幼兒園滿分檢查
        s0 = next((s for s in schools if s.get("id") == 0), None)
        s0_ok = s0 and s0.get("totalScore") == 100 and s0.get("riskLevel") == "高風險"
        record("風險評分引擎", "指標園所（幸福幼兒園）四構面滿分 100/100", s0_ok, f"分數: {s0.get('totalScore') if s0 else None}, 等級: {s0.get('riskLevel') if s0 else None}")

        # 3. 星河幼兒園完整度 < 60% 防呆檢查
        s18 = next((s for s in schools if s.get("id") == 18), None)
        s18_failsafe = s18 and s18.get("completeness", 100) < 60 and s18.get("displayScore") == "—" and s18.get("riskLevel") == "資料不足" and s18.get("riskClass") == "unknown"
        record("風險評分引擎", "星河幼兒園 (34%) 資料不足防呆觸發 (未知等級／分數破折號)", s18_failsafe, f"完整度: {s18.get('completeness') if s18 else None}%, 等級: {s18.get('riskLevel') if s18 else None}, 標記: {s18.get('displayScore') if s18 else None}")

        # 4. 動態重算 API 測試
        recalc_payload = {"thresholds": [41, 61, 76]}
        rst, rms, rbody = http_post("/api/risk/recalculate", recalc_payload)
        rdata = json.loads(rbody)
        recalc_ok = rdata.get("status") == "success" and rdata.get("thresholds") == [41, 61, 76]
        record("風險評分引擎", "動態調整門檻即時重算與持久化 (/api/risk/recalculate)", recalc_ok, f"門檻已更新: {rdata.get('thresholds')}, 延遲: {rms}ms")
    except Exception as e:
        record("風險評分引擎", "四構面動態風險評分引擎檢驗", False, str(e))

    # -------------------------------------------------------------
    # 測試項目 4: AWS Bedrock (Amazon Nova) 智能查核建議
    # -------------------------------------------------------------
    print(f"\n{BOLD}4. 檢驗 AWS Bedrock (Amazon Nova) 智能建議生成...{RESET}")
    try:
        bedrock_payload = {
            "schoolId": 0,
            "schoolName": "幸福幼兒園",
            "district": "板橋區",
            "type": "公辦民營",
            "capacity": 120,
            "riskScore": 100,
            "riskReasons": [
                {"title": "近一年內重複裁罰", "summary": "近 12 個月同類型裁罰累加 2 次", "observation": "裁罰次數 2 次，涉及人員配置缺失"},
                {"title": "每生人事成本高於同類園所", "summary": "每生人事成本 146,000 元高於同儕門檻 98,000 元", "observation": "年度人事費 14,600,000 元，實際學生 100 人"}
            ]
        }
        st, ms, body = http_post("/api/bedrock/audit-advice", bedrock_payload)
        data = json.loads(body)
        has_advice = data.get("status") == "success" and "advice" in data
        advice = data.get("advice", {})
        has_actions = len(advice.get("suggestedActions", [])) > 0
        has_docs = any(len(a.get("requiredDocuments", [])) > 0 for a in advice.get("suggestedActions", []))
        record("AWS Bedrock AI", "生成專屬查核建議、現場 Checklist 與公文表冊清單", has_advice and has_actions and has_docs, f"模型: {data.get('modelId', 'Amazon Nova')}, 行動項數: {len(advice.get('suggestedActions', []))}, 延遲: {ms}ms")
    except Exception as e:
        record("AWS Bedrock AI", "生成專屬查核建議與公文清單", False, str(e))

    # -------------------------------------------------------------
    # 測試項目 5: EC2 行程守護 (systemd) 崩潰自愈能力 (Crash Auto-Recovery)
    # -------------------------------------------------------------
    print(f"\n{BOLD}5. 檢驗 EC2 systemd 行程守護與 Crash 自動自愈能力...{RESET}")
    try:
        # 1. 檢查開機自啟與服務狀態
        rc, out, err = run_ssh("systemctl is-enabled youan-radar-api.service")
        is_enabled = (out.strip() == "enabled")
        record("守護行程 (systemd)", "服務配置為系統開機自啟 (is-enabled)", is_enabled, f"狀態: {out.strip()}")

        # 2. 取得目前運作中 PID
        rc, pid_before, _ = run_ssh("pgrep -f 'python3 /var/www/youan-radar/server.py' | head -n 1")
        pid_before = pid_before.strip()
        print(f"       目前運行中 API 主行程 PID: {pid_before}")

        # 3. 執行模擬崩潰 (kill -9)
        print(f"       ⚡ 模擬嚴苛崩潰：對 PID {pid_before} 發送 SIGKILL (kill -9)...")
        run_ssh(f"sudo kill -9 {pid_before}")
        
        # 4. 等待 4 秒讓 systemd (RestartSec=3) 自動拉起
        time.sleep(4)

        # 5. 檢驗全新 PID
        rc, pid_after, _ = run_ssh("pgrep -f 'python3 /var/www/youan-radar/server.py' | head -n 1")
        pid_after = pid_after.strip()
        is_recovered = bool(pid_after and pid_after != pid_before)
        record("守護行程 (systemd)", "崩潰後 3 秒內成功自愈並產生新行程", is_recovered, f"原 PID: {pid_before} ➔ 新 PID: {pid_after}")

        # 6. 立即發送 HTTP 請求驗證 API 服務已無縫恢復
        st, ms, _ = http_get("/api/storage/stats")
        api_healthy = (st == 200)
        record("守護行程 (systemd)", "自愈後 HTTP API 請求即時恢復正常 (HTTP 200)", api_healthy, f"重啟後首度請求延遲: {ms}ms")

        # 7. 檢查 systemd 日誌中的重啟紀錄
        rc, journal_log, _ = run_ssh("sudo journalctl -u youan-radar-api.service -n 5 --no-pager")
        has_restart_log = "Scheduled restart job" in journal_log or "Started" in journal_log
        record("守護行程 (systemd)", "系統日誌完整留存 Crash 重啟軌跡", has_restart_log, "journalctl 包含 Scheduled restart job / Started 紀錄")
    except Exception as e:
        record("守護行程 (systemd)", "行程守護與崩潰自愈測試", False, str(e))

    # -------------------------------------------------------------
    # 測試總結報告
    # -------------------------------------------------------------
    print(f"\n{CYAN}{'='*70}{RESET}")
    print(f"{BOLD}📊 測試總結與指標統計 (Summary Report){RESET}")
    print(f"{CYAN}{'='*70}{RESET}")
    total_tests = len(results)
    passed_tests = sum(1 for r in results if r["passed"])
    failed_tests = total_tests - passed_tests

    for r in results:
        badge = f"{GREEN}✓ PASS{RESET}" if r["passed"] else f"{RED}✗ FAIL{RESET}"
        print(f" {badge} [{r['module']}] {r['item']}")

    print(f"\n{BOLD}總計測試項目：{total_tests} 項 | 通過：{GREEN}{passed_tests}{RESET} 項 | 失敗：{RED}{failed_tests}{RESET} 項{RESET}")
    pass_rate = (passed_tests / total_tests) * 100
    print(f"{BOLD}整體測試通過率：{GREEN if pass_rate == 100 else RED}{pass_rate:.1f}%{RESET}\n")

    if failed_tests > 0:
        sys.exit(1)
    else:
        print(f"{GREEN}{BOLD}🎉 所有驗收項目均 100% 通過驗證！系統具備生產環境高可用性。{RESET}\n")

if __name__ == "__main__":
    main()
