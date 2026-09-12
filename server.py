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
from scripts.crawl_moe import create_session, fetch_district_schools, enrich_risk_metrics, generate_insights

PORT = 8088

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
