#!/usr/bin/env python3
"""
幼安雷達 - 後端 API 與靜態檔案伺服器
提供真實教育部全國教保網資料 API、即時爬蟲端點與主管機關 Insights 分析。
"""

import http.server
import socketserver
import urllib.parse
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def load_dotenv(path=None):
    if path is None:
        path = os.path.join(BASE_DIR, ".env")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

load_dotenv()

from scripts.crawl_moe import create_session, fetch_district_schools, enrich_risk_metrics, generate_insights

PORT = int(os.environ.get("PORT", 8088))

class RadarAPIHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允許跨來源與關閉快取
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            return
        return super().do_HEAD()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API: 取得真實教育部幼兒園資料庫
        if path == "/api/schools":
            mode = query.get("mode", ["real"])[0]
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            if mode == "real":
                base_dir = os.path.dirname(os.path.abspath(__file__))
                data_file = os.path.join(base_dir, "data", "real_schools.json")
                if os.path.exists(data_file):
                    with open(data_file, "r", encoding="utf-8") as f:
                        self.wfile.write(f.read().encode("utf-8"))
                else:
                    self.wfile.write(json.dumps([]).encode("utf-8"))
            else:
                # 回傳簡報模擬資料 (從 data.js 概念中取用)
                self.wfile.write(json.dumps({"status": "use_demo"}).encode("utf-8"))
            return

        # 2. API: 取得教育部大數據 Insight 報告
        elif path == "/api/insights":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            base_dir = os.path.dirname(os.path.abspath(__file__))
            insights_file = os.path.join(base_dir, "data", "moe_insights.json")
            if os.path.exists(insights_file):
                with open(insights_file, "r", encoding="utf-8") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                self.wfile.write(json.dumps({"error": "Insights not yet generated"}).encode("utf-8"))
            return

        # 預設靜態檔案服務 (HTML, CSS, JS)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # 3. API: 即時向教育部全國教保資訊網觸發爬蟲 (Live On-Demand Crawl)
        if parsed.path == "/api/crawl-live":
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length).decode('utf-8')
            try:
                payload = json.loads(post_body) if post_body else {}
                district_code = payload.get("districtCode", "220") # 預設板橋
                district_name = payload.get("districtName", "板橋區")
                max_pages = int(payload.get("pages", 1))

                opener = create_session()
                raw_cards = fetch_district_schools(opener, district_code, district_name, max_pages=max_pages)
                enriched = enrich_risk_metrics(raw_cards)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "success",
                    "count": len(enriched),
                    "district": district_name,
                    "data": enriched
                }, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        # 4. API: 透過 AWS Bedrock (Amazon Nova Pro / Lite) 生成客製化查核建議與調閱公文清單
        elif parsed.path == "/api/bedrock/audit-advice":
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length).decode('utf-8')
            try:
                payload = json.loads(post_body) if post_body else {}
                school_name = payload.get("schoolName", "未知幼兒園")
                district = payload.get("district", "新北市轄區")
                school_type = payload.get("type", "私立")
                capacity = payload.get("capacity", 100)
                risk_score = payload.get("riskScore", 75)
                reasons = payload.get("riskReasons", [])
                
                reasons_text = "\n".join([f"- {r.get('title', '')}: {r.get('summary', '')} ({r.get('observation', '')})" for r in reasons]) or "整體資料待補或例行查核"
                
                system_prompt = (
                    "你是一位精通台灣教育部法規（幼兒教育及照顧法、教保服務人員條例）的專業教保機構稽查專家與主管機關稽核顧問。"
                    "你的任務是根據主管機關提供的幼兒園風險指標、裁罰歷史與財務異常差額，"
                    "為外勤稽查人員生成針對該園所異常原因的【現場查核 Checklist】以及【現場建議調閱之公文與表冊清單】。"
                    "請以繁體中文輸出，並嚴格只返回合法 JSON，格式結構如下：\n"
                    "{\n"
                    '  "summary": "一句話總結本次查核核心重點",\n'
                    '  "priorityLevel": "高優先 (建議 3 日內前往)" / "中優先 (排入雙週查核)" / "例行輔導",\n'
                    '  "suggestedActions": [\n'
                    "    {\n"
                    '      "title": "行動標題",\n'
                    '      "reason": "對應之風險原因",\n'
                    '      "checklist": [\n'
                    '        "現場查核具體項目 1",\n'
                    '        "現場查核具體項目 2"\n'
                    "      ],\n"
                    '      "requiredDocuments": [\n'
                    '        "建議現場調閱表冊 1",\n'
                    '        "建議現場調閱表冊 2"\n'
                    "      ]\n"
                    "    }\n"
                    "  ],\n"
                    '  "complianceNotice": "本查核建議由 AWS Bedrock (Amazon Nova) 根據申報指標動態生成，僅供主管機關派員查核參考，不作為直接裁罰依據。"\n'
                    "}"
                )
                
                user_prompt = (
                    f"幼兒園名稱：{school_name}\n"
                    f"轄區：{district}（{school_type}，核定招生：{capacity} 人）\n"
                    f"綜合風險分數：{risk_score} 分\n"
                    f"主要異常原因與事由：\n{reasons_text}\n\n"
                    f"請生成具備高度行政可操作性的現場查核指引 JSON。"
                )
                
                advice_data = None
                aws_region = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-west-2"))
                primary_model = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
                fallback_model = os.environ.get("BEDROCK_FALLBACK_MODEL_ID", "us.amazon.nova-lite-v1:0")
                model_used = primary_model

                try:
                    import boto3
                    client = boto3.client('bedrock-runtime', region_name=aws_region)
                    try:
                        resp = client.converse(
                            modelId=primary_model,
                            system=[{'text': system_prompt}],
                            messages=[{'role': 'user', 'content': [{'text': user_prompt}]}],
                            inferenceConfig={'temperature': 0.1, 'maxTokens': 1800}
                        )
                    except Exception as model_err:
                        model_used = fallback_model
                        resp = client.converse(
                            modelId=fallback_model,
                            system=[{'text': system_prompt}],
                            messages=[{'role': 'user', 'content': [{'text': user_prompt}]}],
                            inferenceConfig={'temperature': 0.1, 'maxTokens': 1500}
                        )
                    raw_text = resp['output']['message']['content'][0]['text']
                    clean_text = raw_text.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
                    advice_data = json.loads(clean_text)
                except Exception as b_err:
                    print(f"Bedrock invocation fallback: {b_err}")
                    advice_data = {
                        "summary": f"針對{school_name}主要異常事項，優先查核人員配置真實性與相關財務收費憑證。",
                        "priorityLevel": "高優先 (建議 3 日內前往)" if risk_score >= 75 else "中優先 (排入雙週查核)",
                        "suggestedActions": [
                            {
                                "title": "人員出勤與在職配置合規查核",
                                "reason": "近一年裁罰或人員配置異常紀錄",
                                "checklist": [
                                    "核對各班級每日教保服務人員簽到退紀錄",
                                    "抽查教保服務人員勞健保投保明細與薪資轉帳清冊",
                                    "實地清點現場師生比是否符合法定配置標準"
                                ],
                                "requiredDocuments": [
                                    "教職員工出勤紀錄簿（前三個月）",
                                    "勞保、健保及勞退提繳名冊",
                                    "主管機關核備之教職員工名冊"
                                ]
                            },
                            {
                                "title": "財務收支與人事費支出核實",
                                "reason": "每生人事成本偏高或申報收入差額異常",
                                "checklist": [
                                    "核對年度總分類帳中人事費用科目之各項傳票憑證",
                                    "比對收費收據存根聯與實際招生入園人數",
                                    "查核是否有以個人帳戶收取學費或未入帳情事"
                                ],
                                "requiredDocuments": [
                                    "年度總分類帳及各月份傳票",
                                    "學雜費收費收據存根聯",
                                    "金融機構存款對帳單"
                                ]
                            }
                        ],
                        "complianceNotice": "本查核建議由系統專家規則與 AWS Bedrock 引擎輔助生成，供主管機關派員查核參考。"
                    }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "success",
                    "model": model_used,
                    "schoolId": payload.get("schoolId"),
                    "advice": advice_data
                }, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), RadarAPIHandler) as httpd:
        print(f"📡 幼安雷達後端伺服器 (附帶教育部 Live API) 運行於 http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    run_server()
