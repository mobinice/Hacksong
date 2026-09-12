#!/usr/bin/env python3
"""幼安雷達 Demo API 與靜態檔案伺服器。

AI 端點提供可解釋的本機模擬結果，讓介面在沒有雲端憑證時仍可完整展示；
回應中的 ``demo`` 與 ``provider`` 欄位會明確標示資料性質。
"""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import re
import socketserver
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent


def load_dotenv(path: Path | None = None) -> None:
    """Load local development settings without overriding process credentials."""
    env_path = path or BASE_DIR / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip().strip('"').strip("'")
    except OSError:
        return


load_dotenv()

from scripts.crawl_moe import create_session, enrich_risk_metrics, fetch_district_schools, query_schools
from scripts.workspace_data import load_workspace_schools
from scripts.official_risk import recalculate_all_schools as official_risks
from scripts.risk_engine import DEFAULT_RULES, DEFAULT_THRESHOLDS, recalculate_all_schools
from scripts.storage_db import get_state, get_stats, init_db, reset_db, save_state


init_db()

PORT = int(os.environ.get("YOUAN_PORT", os.environ.get("PORT", "8088")))
MAX_BODY_BYTES = 2 * 1024 * 1024
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8088",
    "http://localhost:8088",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
}

STANDARD_FIELDS = {
    "name": ["園所名稱", "機構名稱", "幼兒園名稱", "單位名稱", "school", "name"],
    "district": ["行政區", "區域", "鄉鎮市區", "所在區", "district", "area"],
    "address": ["地址", "機構地址", "園址", "所在地", "address"],
    "telephone": ["電話", "聯絡電話", "聯絡方式", "tel", "phone"],
    "capacity": ["核定人數", "核定規模", "招生人數", "容量", "capacity"],
    "pubType": ["設立別", "公私立", "機構類型", "屬性", "type"],
    "evaluation": ["評鑑結果", "查核結果", "評核結果", "evaluation", "result"],
    "date": ["日期", "評鑑日期", "查核日期", "發文日期", "date"],
}

OCR_RULES = [
    ("幼兒教育及照顧法第30條", ("超收", "核定人數", "師生比"), "人員與收托管理", 18),
    ("幼兒教育及照顧法第33條", ("不當管教", "體罰", "不當對待"), "兒童安全與照顧", 28),
    ("教保服務機構收退費辦法第6條", ("收費", "退費", "超收費用"), "收費與退費", 14),
    ("教保服務機構評鑑辦法第8條", ("限期改善", "改善事項", "追蹤評鑑"), "評鑑改善追蹤", 12),
    ("食品安全衛生管理法第8條", ("餐點", "廚房", "食品", "留樣"), "餐飲衛生", 16),
]

NEGATIVE_TERMS = {
    "受傷": 24,
    "體罰": 34,
    "不當管教": 32,
    "超收": 20,
    "違規": 18,
    "投訴": 12,
    "爭議": 10,
    "延誤": 8,
    "疑似": 5,
}


def demo_schools() -> list[dict[str, Any]]:
    """Return the stable synthetic school set used by the risk-engine API."""
    names = [
        "幸福", "晨光", "小橡樹", "向陽", "禾苗", "彩虹", "童心", "小星星", "蒲公英", "暖陽", "森林",
        "青田", "小樹屋", "果實", "晴空", "樂田", "花鹿", "小太陽", "星河", "月芽", "藍天", "小海豚",
    ]
    districts = ["板橋區", "新莊區", "三重區", "中和區", "淡水區", "汐止區"]
    return [
        {
            "id": index,
            "name": f"{name}幼兒園",
            "district": districts[index % len(districts)],
            "address": f"新北市{districts[index % len(districts)]}示範路{18 + index * 7}號",
            "complete": 34 + (index - 18) * 7 if index >= 18 else 91 - index % 7,
            "capacity": 120 + index * 5,
        }
        for index, name in enumerate(names)
    ]


def normalize_label(value: Any) -> str:
    """Return a comparison-safe label without logging the original value."""
    label = re.sub(r"[^0-9a-z\u4e00-\u9fff]", "", str(value or "").strip().lower())
    for source, target in {"全稱": "名稱", "所在": "", "核准": "核定", "容量": "人數", "聯繫": "聯絡"}.items():
        label = label.replace(source, target)
    return label


def suggest_field_mapping(headers: list[Any]) -> list[dict[str, Any]]:
    """Create explainable semantic field suggestions for uploaded headers."""
    suggestions: list[dict[str, Any]] = []
    for raw_header in headers[:100]:
        header = str(raw_header or "").strip()[:120]
        normalized = normalize_label(header)
        best_field = ""
        best_alias = ""
        best_score = 0
        for field, aliases in STANDARD_FIELDS.items():
            for alias in aliases:
                candidate = normalize_label(alias)
                if not normalized or not candidate:
                    score = 0
                elif normalized == candidate:
                    score = 99
                elif normalized in candidate or candidate in normalized:
                    score = 88
                else:
                    common = len(set(normalized) & set(candidate))
                    score = round(common / max(len(set(candidate)), 1) * 64)
                if score > best_score:
                    best_field, best_alias, best_score = field, alias, score
        suggestions.append(
            {
                "source": header,
                "target": best_field if best_score >= 45 else "",
                "confidence": best_score,
                "reason": f"與「{best_alias}」語意接近" if best_field else "找不到可信的標準欄位，請人工確認",
                "needsReview": best_score < 75,
            }
        )
    return suggestions


def analyze_ocr_text(text: Any, filename: Any = "") -> dict[str, Any]:
    """Extract demo compliance findings from document text or filename."""
    content = re.sub(r"\s+", " ", f"{filename} {text}").strip()[:100_000]
    findings: list[dict[str, Any]] = []
    for clause, keywords, category, impact in OCR_RULES:
        hits = [keyword for keyword in keywords if keyword in content]
        if hits:
            findings.append(
                {
                    "category": category,
                    "summary": f"文件提及「{'、'.join(hits[:3])}」，建議列入人工覆核。",
                    "clause": clause,
                    "riskImpact": impact,
                    "evidence": f"關鍵詞：{'、'.join(hits[:3])}",
                    "verified": False,
                }
            )
    if not findings:
        findings.append(
            {
                "category": "文件完整性",
                "summary": "未在可讀文字中辨識明確缺失，請承辦人檢視原始頁面。",
                "clause": "需人工判讀",
                "riskImpact": 0,
                "evidence": "Demo 模式未取得足夠文字",
                "verified": False,
            }
        )
    return {
        "demo": True,
        "provider": "Demo OCR + 規則檢核",
        "document": str(filename or "未命名文件")[:180],
        "findings": findings,
        "notice": "本結果為 AI 輔助擷取，須由承辦人覆核後才能作為正式依據。",
    }


def _event_key(event: dict[str, Any]) -> str:
    title = normalize_label(event.get("title"))[:50]
    source = normalize_label(event.get("source"))[:30]
    date = str(event.get("date") or "")[:10]
    return hashlib.sha256(f"{title}|{source}|{date}".encode("utf-8")).hexdigest()[:16]


def safe_public_url(value: Any) -> str:
    try:
        parsed = urllib.parse.urlparse(str(value or ""))
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))[:500]
    except ValueError:
        pass
    return ""


def deduplicate_sentiment(events: list[Any]) -> list[dict[str, Any]]:
    """Deduplicate public clues and calculate explainable severity."""
    unique: dict[str, dict[str, Any]] = {}
    for raw in events[:200]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "未命名公開線索")[:240]
        excerpt = str(raw.get("excerpt") or raw.get("summary") or "")[:1200]
        score = min(100, 8 + sum(weight for term, weight in NEGATIVE_TERMS.items() if term in f"{title} {excerpt}"))
        severity = "高" if score >= 55 else "中" if score >= 28 else "低"
        event = {
            "id": _event_key(raw),
            "title": title,
            "source": str(raw.get("source") or "公開網路")[:80],
            "date": str(raw.get("date") or "")[:20],
            "url": safe_public_url(raw.get("url")),
            "excerpt": excerpt,
            "negativeScore": score,
            "severity": severity,
            "label": "未經查證之公開線索",
            "aiSummary": f"偵測到{severity}度負向訊號，建議與正式陳情或查核紀錄交叉比對。",
        }
        key = event["id"]
        if key not in unique or event["negativeScore"] > unique[key]["negativeScore"]:
            unique[key] = event
    return sorted(unique.values(), key=lambda item: (item["date"], item["negativeScore"]), reverse=True)


def mask_sensitive(value: Any) -> str:
    """Mask common Taiwan PII patterns before display or logging."""
    text = str(value or "")[:100_000]
    text = re.sub(r"\b[A-Z][12]\d{8}\b", lambda m: m.group(0)[:2] + "******" + m.group(0)[-2:], text)
    text = re.sub(r"(?<!\d)09\d{8}(?!\d)", lambda m: m.group(0)[:4] + "***" + m.group(0)[-3:], text)
    text = re.sub(r"([\w.+-])([\w.+-]*)(@[^\s@]+)", lambda m: m.group(1) + "***" + m.group(3), text)
    return text


def _fallback_audit_advice(school_name: str, risk_score: int) -> dict[str, Any]:
    return {
        "summary": f"針對{school_name}的主要異常，優先核對人員配置與財務收費憑證。",
        "priorityLevel": "高優先（建議 3 日內前往）" if risk_score >= 75 else "中優先（排入雙週查核）",
        "suggestedActions": [
            {
                "title": "人員出勤與在職配置查核",
                "reason": "裁罰紀錄或人員配置出現異常訊號",
                "checklist": [
                    "核對各班級教保服務人員簽到退紀錄",
                    "抽查勞健保投保明細與薪資轉帳清冊",
                    "實地清點師生比是否符合核定配置",
                ],
                "requiredDocuments": ["近三個月出勤紀錄簿", "勞健保及勞退提繳名冊", "主管機關核備人員名冊"],
            },
            {
                "title": "財務收支與收費核實",
                "reason": "人事成本或申報收入差額出現異常訊號",
                "checklist": [
                    "核對人事費科目的傳票與憑證",
                    "比對收費收據與實際在園人數",
                    "確認收費款項均進入機構帳戶並入帳",
                ],
                "requiredDocuments": ["年度總分類帳及傳票", "學雜費收據存根", "金融機構存款對帳單"],
            },
        ],
        "complianceNotice": "系統分析僅供主管機關安排查核參考，仍須由承辦人確認，不作為直接裁罰依據。",
    }


def generate_bedrock_advice(payload: dict[str, Any]) -> dict[str, Any]:
    """Use Bedrock when configured and keep a safe, usable local fallback."""
    school_name = str(payload.get("schoolName") or "未知幼兒園")[:120]
    district = str(payload.get("district") or "新北市轄區")[:60]
    school_type = str(payload.get("type") or "私立")[:40]
    try:
        capacity = max(0, min(int(payload.get("capacity", 100)), 10_000))
        risk_score = max(0, min(int(payload.get("riskScore", 75)), 100))
    except (TypeError, ValueError):
        capacity, risk_score = 100, 75
    reasons = payload.get("riskReasons", [])
    if not isinstance(reasons, list):
        reasons = []
    reason_lines = []
    for reason in reasons[:10]:
        if not isinstance(reason, dict):
            continue
        title = str(reason.get("title") or "")[:160]
        summary = str(reason.get("summary") or "")[:500]
        observation = str(reason.get("observation") or "")[:500]
        reason_lines.append(f"- {title}: {summary} ({observation})")
    reasons_text = "\n".join(reason_lines) or "整體資料待補或例行查核"

    system_prompt = (
        "你是熟悉台灣幼兒教育及照顧法規的主管機關稽核顧問。"
        "請根據園所風險資料產出具體的現場查核清單與建議調閱表冊。"
        "只輸出合法 JSON，欄位必須包含 summary、priorityLevel、suggestedActions、complianceNotice；"
        "suggestedActions 每項包含 title、reason、checklist、requiredDocuments。"
    )
    user_prompt = (
        f"園所：{school_name}\n轄區：{district}\n類型：{school_type}\n"
        f"核定招生：{capacity} 人\n風險分數：{risk_score}\n異常原因：\n{reasons_text}"
    )
    region = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-west-2"))
    primary_model = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
    fallback_model = os.environ.get("BEDROCK_FALLBACK_MODEL_ID", "us.amazon.nova-lite-v1:0")
    model_used = primary_model
    advice = None
    provider = "local-fallback"
    try:
        import boto3

        client = boto3.client("bedrock-runtime", region_name=region)
        response = None
        for model_id, max_tokens in ((primary_model, 1800), (fallback_model, 1500)):
            try:
                response = client.converse(
                    modelId=model_id,
                    system=[{"text": system_prompt}],
                    messages=[{"role": "user", "content": [{"text": user_prompt}]}],
                    inferenceConfig={"temperature": 0.1, "maxTokens": max_tokens},
                )
                model_used = model_id
                break
            except Exception:
                response = None
        if response:
            raw_text = response["output"]["message"]["content"][0]["text"]
            clean_text = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            candidate = json.loads(clean_text)
            if isinstance(candidate, dict) and isinstance(candidate.get("suggestedActions"), list):
                advice = candidate
                provider = "aws-bedrock"
    except Exception:
        advice = None
    if advice is None:
        advice = _fallback_audit_advice(school_name, risk_score)
    return {
        "status": "success",
        "model": model_used,
        "provider": provider,
        "schoolId": payload.get("schoolId"),
        "advice": advice,
    }


class _RateLimiter:
    def __init__(self, limit: int = 60, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            return True


RATE_LIMITER = _RateLimiter()


class RadarAPIHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "YouanRadar/1.0"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        # Do not log query strings or request bodies; they can contain PII.
        clean_path = urllib.parse.urlparse(self.path).path
        print(f"{self.address_string()} [{self.log_date_time_string()}] {self.command} {clean_path}")

    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; "
            "worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        super().end_headers()

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self) -> dict[str, Any] | None:
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"status": "error", "message": "Content-Length 格式錯誤"})
            return None
        if size < 0 or size > MAX_BODY_BYTES:
            self._json(413, {"status": "error", "message": "請求內容超過 2 MB 上限"})
            return None
        try:
            data = json.loads(self.rfile.read(size).decode("utf-8")) if size else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"status": "error", "message": "JSON 格式錯誤"})
            return None
        if not isinstance(data, dict):
            self._json(400, {"status": "error", "message": "JSON 最外層必須是物件"})
            return None
        return data

    def _allow_request(self) -> bool:
        key = self.client_address[0] if self.client_address else "unknown"
        if RATE_LIMITER.allow(key):
            return True
        self._json(429, {"status": "error", "message": "請求過於頻繁，請稍後再試"})
        return False

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self) -> None:
        if urllib.parse.urlparse(self.path).path.startswith("/api/"):
            self._json(200, {"status": "ok"})
            return
        super().do_HEAD()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        official = urllib.parse.parse_qs(parsed.query).get("workspace") == ["official"]
        if path.startswith("/api/") and not self._allow_request():
            return
        if path == "/api/health":
            self._json(200, {"status": "ok", "service": "幼安雷達 Demo API"})
            return
        if path == "/api/security/status":
            self._json(
                200,
                {
                    "status": "ok",
                    "controls": ["同源 API", "2 MB 請求上限", "敏感資料遮罩", "安全回應標頭", "重新整理重設 Demo 狀態"],
                    "artifactStorage": "private-s3-sse-s3",
                    "credentialMode": "environment-or-instance-role",
                },
            )
            return
        if path == "/api/workspace":
            try:
                self._json(200, {"schools": load_workspace_schools()})
            except (OSError, ValueError):
                self._json(503, {"message": "官方資料快照暫時無法讀取"})
            return
        if path == "/api/schools":
            mode = urllib.parse.parse_qs(parsed.query).get("mode", ["real"])[0]
            if mode != "real":
                self._json(200, {"status": "use_demo"})
                return
            file_path = BASE_DIR / "data" / "real_schools.json"
            try:
                data = json.loads(file_path.read_text(encoding="utf-8")) if file_path.exists() else []
                query = urllib.parse.parse_qs(parsed.query)
                # Preserve the original array contract for map and existing clients.
                if any(k in query for k in ("page", "size", "q", "district", "type")) and query.get("format") != ["legacy"]:
                    try:
                        data = query_schools(data, query)
                    except (ValueError, TypeError):
                        self._json(400, {"message": "分頁或篩選參數無效"})
                        return
                self._json(200, data)
            except (OSError, json.JSONDecodeError):
                self._json(500, {"status": "error", "message": "資料檔暫時無法讀取"})
            return
        if path == "/api/insights":
            file_path = BASE_DIR / "data" / "moe_insights.json"
            try:
                if not file_path.exists():
                    self._json(404, {"status": "error", "message": "Insights 尚未產生"})
                else:
                    self._json(200, json.loads(file_path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                self._json(500, {"status": "error", "message": "Insights 暫時無法讀取"})
            return
        if path == "/api/storage/state":
            try:
                state = get_state(state_key="ntpc_official") if official else get_state()
                self._json(
                    200,
                    {
                        "status": "success",
                        "exists": state["exists"],
                        "data": state["data"],
                        "backend": state.get("backend"),
                        "updatedAt": state.get("updated_at"),
                    },
                )
            except Exception:
                self._json(500, {"status": "error", "message": "儲存狀態暫時無法讀取"})
            return
        if path == "/api/storage/stats":
            try:
                self._json(200, {"status": "success", "stats": get_stats()})
            except Exception:
                self._json(500, {"status": "error", "message": "儲存統計暫時無法讀取"})
            return
        if path in {"/api/risk/schools", "/api/risk/rules"}:
            try:
                state = get_state(state_key="ntpc_official") if official else get_state()
                state_data = state.get("data") or {}
                rules = state_data.get("rules", DEFAULT_RULES)
                thresholds = state_data.get("thresholds", DEFAULT_THRESHOLDS)
                if path == "/api/risk/rules":
                    self._json(200, {"status": "success", "rules": rules, "thresholds": thresholds})
                    return
                result = official_risks(load_workspace_schools(state_data), rules, thresholds) if official else recalculate_all_schools(demo_schools(), rules, thresholds)
                self._json(
                    200,
                    {
                        "status": "success",
                        "count": len(result["schools"]),
                        "stats": result["stats"],
                        "schools": result["schools"],
                        "rules": result["rulesUsed"],
                        "thresholds": result["thresholdsUsed"],
                    },
                )
            except Exception:
                self._json(500, {"status": "error", "message": "風險評分資料暫時無法讀取"})
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        official = urllib.parse.parse_qs(parsed.query).get("workspace") == ["official"]
        if not self._allow_request():
            return
        payload = self._read_json()
        if payload is None:
            return
        if path == "/api/ai/field-map":
            headers = payload.get("headers", [])
            if not isinstance(headers, list):
                self._json(400, {"status": "error", "message": "headers 必須是陣列"})
                return
            self._json(200, {"demo": True, "provider": "Demo Semantic Mapper", "suggestions": suggest_field_mapping(headers)})
            return
        if path == "/api/ai/ocr-check":
            self._json(200, analyze_ocr_text(payload.get("text", ""), payload.get("filename", "")))
            return
        if path == "/api/ai/sentiment":
            events = payload.get("events", [])
            if not isinstance(events, list):
                self._json(400, {"status": "error", "message": "events 必須是陣列"})
                return
            self._json(
                200,
                {
                    "demo": True,
                    "provider": "Demo Sentiment Analyzer",
                    "events": deduplicate_sentiment(events),
                    "notice": "未經查證之公開線索，僅供決定是否進一步查核。",
                },
            )
            return
        if path == "/api/security/mask":
            self._json(200, {"masked": mask_sensitive(payload.get("text", ""))})
            return
        if path == "/api/bedrock/audit-advice":
            self._json(200, generate_bedrock_advice(payload))
            return
        if path == "/api/crawl-live":
            try:
                district_code = str(payload.get("districtCode", "220"))[:10]
                district_name = str(payload.get("districtName", "板橋區"))[:30]
                max_pages = max(1, min(int(payload.get("pages", 1)), 3))
                cards = fetch_district_schools(create_session(), district_code, district_name, max_pages=max_pages)
                enriched = enrich_risk_metrics(cards)
                self._json(200, {"status": "success", "count": len(enriched), "district": district_name, "data": enriched})
            except (OSError, ValueError, TimeoutError):
                self._json(502, {"status": "error", "message": "教育部資料來源暫時無法連線"})
            return
        if path == "/api/storage/save":
            incoming = payload.get("db", payload)
            if not isinstance(incoming, dict):
                self._json(400, {"status": "error", "message": "db 必須是物件"})
                return
            try:
                current = (get_state(state_key="ntpc_official") if official else get_state()).get("data") or {}
                state = {**current, **incoming} if isinstance(current, dict) else incoming
                if isinstance(current, dict) and isinstance(current.get("reviews"), dict) and isinstance(incoming.get("reviews"), dict):
                    state["reviews"] = {**current["reviews"], **incoming["reviews"]}
                if official:
                    state["workspace"] = "ntpc-official-v1"
                    save_state(state, state_key="ntpc_official")
                else:
                    save_state(state)
                backend = get_stats().get("backend", "database")
                self._json(200, {"status": "success", "backend": backend, "message": f"狀態已儲存至 {backend}"})
            except Exception:
                self._json(500, {"status": "error", "message": "狀態暫時無法儲存"})
            return
        if path == "/api/storage/reset":
            try:
                if official:
                    reset_db(state_key="ntpc_official")
                else:
                    reset_db()
                backend = get_stats().get("backend", "database")
                self._json(200, {"status": "success", "backend": backend, "message": f"{backend} Demo 狀態已清除"})
            except Exception:
                self._json(500, {"status": "error", "message": "Demo 狀態暫時無法重設"})
            return
        if path == "/api/risk/recalculate":
            rules = payload.get("rules", DEFAULT_RULES)
            thresholds = payload.get("thresholds", DEFAULT_THRESHOLDS)
            if not isinstance(rules, list) or not isinstance(thresholds, list):
                self._json(400, {"status": "error", "message": "rules 與 thresholds 格式錯誤"})
                return
            try:
                state_data = (get_state(state_key="ntpc_official").get("data") or {}) if official else {}
                result = official_risks(load_workspace_schools(state_data), rules, thresholds) if official else recalculate_all_schools(demo_schools(), rules, thresholds)
                self._json(
                    200,
                    {
                        "status": "success",
                        "stats": result["stats"],
                        "schools": result["schools"],
                        "rules": result["rulesUsed"],
                        "thresholds": result["thresholdsUsed"],
                        "persisted": False,
                        "message": "已完成本次 Demo 計算；結果未寫入共享資料庫",
                    },
                )
            except (TypeError, ValueError):
                self._json(400, {"status": "error", "message": "風險規則或門檻內容無法計算"})
            return
        self._json(404, {"status": "error", "message": "找不到 API 端點"})


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


def run_server() -> None:
    os.chdir(BASE_DIR)
    with ThreadingServer((os.environ.get("HOST", ""), PORT), RadarAPIHandler) as server:
        print(f"📡 幼安雷達 Demo API：http://127.0.0.1:{PORT}/preview.html")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    run_server()
