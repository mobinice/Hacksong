#!/usr/bin/env python3
"""
幼安雷達 - 資料持久化模組 (支援 AWS RDS PostgreSQL 與 SQLite 本地備援)
儲存承辦人覆核狀態、查核日期、備註、自訂規則與系統整體狀態。
"""

import os
import sys
import json
import logging
import sqlite3
from datetime import datetime

def _load_dotenv_if_needed():
    """內建 .env 檔案自動載入器 (無需第三方 python-dotenv 套件)。"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(base_dir, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip()
                        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                            v = v[1:-1]
                        if k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

_load_dotenv_if_needed()

# 嘗試載入 psycopg2 (PostgreSQL / AWS RDS)
try:
    import psycopg2
    import psycopg2.extras
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
SQLITE_DB_PATH = os.path.join(DATA_DIR, "youan_radar.db")

logger = logging.getLogger("youan_storage")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def get_rds_config():
    """讀取 RDS 環境變數設定。"""
    host = os.getenv("RDS_HOST") or os.getenv("DB_HOST")
    port = int(os.getenv("RDS_PORT") or os.getenv("DB_PORT") or 5432)
    dbname = os.getenv("RDS_DB_NAME") or os.getenv("DB_NAME") or "youan_radar"
    user = os.getenv("RDS_USER") or os.getenv("DB_USER") or "youan_admin"
    password = os.getenv("RDS_PASSWORD") or os.getenv("DB_PASSWORD") or ""
    sslmode = os.getenv("RDS_SSLMODE") or os.getenv("DB_SSLMODE") or "prefer"
    return {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
        "sslmode": sslmode,
        "enabled": bool(host and PSYCOPG2_AVAILABLE)
    }


def is_rds_active():
    """檢查是否啟用且成功連線至 RDS。"""
    cfg = get_rds_config()
    if not cfg["enabled"]:
        return False
    try:
        conn = psycopg2.connect(
            host=cfg["host"],
            port=cfg["port"],
            dbname=cfg["dbname"],
            user=cfg["user"],
            password=cfg["password"],
            sslmode=cfg["sslmode"],
            connect_timeout=3
        )
        conn.close()
        return True
    except Exception as e:
        logger.warning(f"RDS 連線測試未通過，自動備援至 SQLite: {e}")
        return False


def get_rds_connection():
    cfg = get_rds_config()
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg["port"],
        dbname=cfg["dbname"],
        user=cfg["user"],
        password=cfg["password"],
        sslmode=cfg["sslmode"]
    )


def get_sqlite_connection(db_path=None):
    if db_path is None:
        db_path = SQLITE_DB_PATH
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path=None):
    """初始化資料庫（優先使用 RDS PostgreSQL，無設定或連線異常時自動使用 SQLite）。"""
    cfg = get_rds_config()
    if cfg["enabled"]:
        try:
            with get_rds_connection() as conn:
                with conn.cursor() as cursor:
                    # 1. 系統整體狀態表
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS app_state (
                            key VARCHAR(255) PRIMARY KEY,
                            value TEXT NOT NULL,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                    """)
                    # 2. 人工覆核紀錄表
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS reviews (
                            school_id BIGINT PRIMARY KEY,
                            status VARCHAR(64),
                            owner VARCHAR(64),
                            date VARCHAR(32),
                            note TEXT,
                            next_action TEXT,
                            checks TEXT,
                            saved VARCHAR(32),
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                    """)
                    # 3. 稽核案件表
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS cases (
                            school_id BIGINT PRIMARY KEY,
                            stage VARCHAR(64),
                            agency VARCHAR(64),
                            owner VARCHAR(64),
                            due VARCHAR(32),
                            notes TEXT,
                            actions TEXT,
                            timeline TEXT,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                    """)
                    cursor.execute("ALTER TABLE reviews ALTER COLUMN school_id TYPE BIGINT")
                    cursor.execute("ALTER TABLE cases ALTER COLUMN school_id TYPE BIGINT")
                conn.commit()

            # 檢查 RDS 是否為空，若為空且本地 SQLite 有歷史資料則自動遷移
            _auto_migrate_if_needed()
            logger.info("✅ AWS RDS PostgreSQL 資料庫初始化成功！")
            return "rds_postgres"
        except Exception as e:
            logger.warning(f"⚠️ RDS 初始化失敗，切換回 SQLite: {e}")

    # SQLite 本地備援
    with get_sqlite_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                school_id INTEGER PRIMARY KEY,
                status TEXT,
                owner TEXT,
                date TEXT,
                note TEXT,
                next_action TEXT,
                checks TEXT,
                saved TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cases (
                school_id INTEGER PRIMARY KEY,
                stage TEXT,
                agency TEXT,
                owner TEXT,
                due TEXT,
                notes TEXT,
                actions TEXT,
                timeline TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    return "sqlite"


def _auto_migrate_if_needed():
    """若 RDS 剛建立且為空，但本地 SQLite 有資料，則自動將 SQLite 資料遷移至 RDS。"""
    try:
        if not os.path.exists(SQLITE_DB_PATH):
            return
        with get_rds_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM app_state")
                cnt = cur.fetchone()[0]
                if cnt == 0:
                    logger.info("偵測到 RDS 為初始乾淨狀態，自動從本地 SQLite 遷移歷史資料至 RDS...")
                    migrate_sqlite_to_rds()
    except Exception as e:
        logger.warning(f"自動資料庫遷移檢查發生異常: {e}")


def save_state(state_dict, db_path=None, state_key="db_state"):
    """將完整狀態字典存入資料庫（優先 RDS，備援 SQLite）。"""
    cfg = get_rds_config()
    if cfg["enabled"]:
        try:
            return _save_state_rds(state_dict, state_key)
        except Exception as e:
            logger.warning(f"RDS 儲存失敗，降級存至 SQLite: {e}")
            return _save_state_sqlite(state_dict, db_path, state_key)
    return _save_state_sqlite(state_dict, db_path, state_key)


def _save_state_rds(state_dict, state_key="db_state"):
    init_db()
    with get_rds_connection() as conn:
        with conn.cursor() as cursor:
            json_str = json.dumps(state_dict, ensure_ascii=False)
            cursor.execute("""
                INSERT INTO app_state (key, value, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = CURRENT_TIMESTAMP
            """, (state_key, json_str))

            # 同步 reviews
            reviews = state_dict.get("reviews", {})
            if isinstance(reviews, dict):
                for s_id_str, rev in reviews.items():
                    try:
                        s_id = int(s_id_str)
                        checks_json = json.dumps(rev.get("checks", []), ensure_ascii=False)
                        cursor.execute("""
                            INSERT INTO reviews (school_id, status, owner, date, note, next_action, checks, saved, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                            ON CONFLICT (school_id) DO UPDATE SET
                                status = EXCLUDED.status,
                                owner = EXCLUDED.owner,
                                date = EXCLUDED.date,
                                note = EXCLUDED.note,
                                next_action = EXCLUDED.next_action,
                                checks = EXCLUDED.checks,
                                saved = EXCLUDED.saved,
                                updated_at = CURRENT_TIMESTAMP
                        """, (
                            s_id,
                            rev.get("status", ""),
                            rev.get("owner", ""),
                            rev.get("date", ""),
                            rev.get("note", ""),
                            rev.get("next", ""),
                            checks_json,
                            rev.get("saved", "")
                        ))
                    except (ValueError, TypeError):
                        continue

            # 同步 cases
            cases = state_dict.get("cases", {})
            if isinstance(cases, dict):
                for c_id_str, c in cases.items():
                    try:
                        c_id = int(c_id_str)
                        cursor.execute("""
                            INSERT INTO cases (school_id, stage, agency, owner, due, notes, actions, timeline, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                            ON CONFLICT (school_id) DO UPDATE SET
                                stage = EXCLUDED.stage,
                                agency = EXCLUDED.agency,
                                owner = EXCLUDED.owner,
                                due = EXCLUDED.due,
                                notes = EXCLUDED.notes,
                                actions = EXCLUDED.actions,
                                timeline = EXCLUDED.timeline,
                                updated_at = CURRENT_TIMESTAMP
                        """, (
                            c_id,
                            c.get("stage", ""),
                            c.get("agency", ""),
                            c.get("owner", ""),
                            c.get("due", ""),
                            c.get("notes", ""),
                            json.dumps(c.get("actions", []), ensure_ascii=False),
                            json.dumps(c.get("timeline", []), ensure_ascii=False)
                        ))
                    except (ValueError, TypeError):
                        continue

            conn.commit()
    return True


def _save_state_sqlite(state_dict, db_path=None, state_key="db_state"):
    with get_sqlite_connection(db_path) as conn:
        cursor = conn.cursor()
        json_str = json.dumps(state_dict, ensure_ascii=False)
        cursor.execute("""
            INSERT INTO app_state (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        """, (state_key, json_str))

        reviews = state_dict.get("reviews", {})
        if isinstance(reviews, dict):
            for s_id_str, rev in reviews.items():
                try:
                    s_id = int(s_id_str)
                    checks_json = json.dumps(rev.get("checks", []), ensure_ascii=False)
                    cursor.execute("""
                        INSERT INTO reviews (school_id, status, owner, date, note, next_action, checks, saved, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(school_id) DO UPDATE SET
                            status = excluded.status,
                            owner = excluded.owner,
                            date = excluded.date,
                            note = excluded.note,
                            next_action = excluded.next_action,
                            checks = excluded.checks,
                            saved = excluded.saved,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        s_id,
                        rev.get("status", ""),
                        rev.get("owner", ""),
                        rev.get("date", ""),
                        rev.get("note", ""),
                        rev.get("next", ""),
                        checks_json,
                        rev.get("saved", "")
                    ))
                except (ValueError, TypeError):
                    continue

        cases = state_dict.get("cases", {})
        if isinstance(cases, dict):
            for c_id_str, c in cases.items():
                try:
                    c_id = int(c_id_str)
                    cursor.execute("""
                        INSERT INTO cases (school_id, stage, agency, owner, due, notes, actions, timeline, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(school_id) DO UPDATE SET
                            stage = excluded.stage,
                            agency = excluded.agency,
                            owner = excluded.owner,
                            due = excluded.due,
                            notes = excluded.notes,
                            actions = excluded.actions,
                            timeline = excluded.timeline,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        c_id,
                        c.get("stage", ""),
                        c.get("agency", ""),
                        c.get("owner", ""),
                        c.get("due", ""),
                        c.get("notes", ""),
                        json.dumps(c.get("actions", []), ensure_ascii=False),
                        json.dumps(c.get("timeline", []), ensure_ascii=False)
                    ))
                except (ValueError, TypeError):
                    continue

        conn.commit()
    return True


def get_state(db_path=None, state_key="db_state"):
    """讀取狀態（優先 RDS，備援 SQLite）。"""
    cfg = get_rds_config()
    if cfg["enabled"]:
        try:
            with get_rds_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT value, updated_at FROM app_state WHERE key = %s", (state_key,))
                    row = cursor.fetchone()
                    if row and row[0]:
                        try:
                            data = json.loads(row[0])
                            up_str = row[1].strftime('%Y-%m-%d %H:%M:%S') if hasattr(row[1], 'strftime') else str(row[1])
                            return {"exists": True, "data": data, "updated_at": up_str, "backend": "AWS RDS PostgreSQL"}
                        except Exception:
                            pass
            return {"exists": False, "data": None, "backend": "AWS RDS PostgreSQL"}
        except Exception as e:
            logger.warning(f"RDS 讀取失敗，降級從 SQLite 讀取: {e}")

    with get_sqlite_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value, updated_at FROM app_state WHERE key = ?", (state_key,))
        row = cursor.fetchone()
        if row and row["value"]:
            try:
                data = json.loads(row["value"])
                return {"exists": True, "data": data, "updated_at": str(row["updated_at"]), "backend": "SQLite"}
            except Exception:
                pass
    return {"exists": False, "data": None, "backend": "SQLite"}


def reset_db(db_path=None, state_key="db_state"):
    """Reset only the selected workspace; other workspace records remain intact."""
    state = get_state(db_path, state_key=state_key).get("data") or {}
    reviews = [int(key) for key in state.get("reviews", {}) if str(key).isdigit()]
    cases = [int(key) for key in state.get("casework", {}) if str(key).isdigit()]
    def clear(conn, placeholder):
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM app_state WHERE key = {placeholder}", (state_key,))
        for key in reviews:
            cursor.execute(f"DELETE FROM reviews WHERE school_id = {placeholder}", (key,))
        for key in cases:
            cursor.execute(f"DELETE FROM cases WHERE school_id = {placeholder}", (key,))
        conn.commit()
    if get_rds_config()["enabled"]:
        with get_rds_connection() as conn:
            clear(conn, "%s")
    else:
        with get_sqlite_connection(db_path) as conn:
            clear(conn, "?")
    return True


def get_stats(db_path=None):
    """取得資料庫統計與目前運作中的儲存後端資訊。"""
    cfg = get_rds_config()
    if cfg["enabled"]:
        try:
            with get_rds_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT count(*) FROM reviews")
                    reviews_cnt = cursor.fetchone()[0]
                    cursor.execute("SELECT count(*) FROM cases")
                    cases_cnt = cursor.fetchone()[0]
                    cursor.execute("SELECT updated_at FROM app_state WHERE key = 'db_state'")
                    row = cursor.fetchone()
                    updated_at = row[0].strftime('%Y-%m-%d %H:%M:%S') if (row and hasattr(row[0], 'strftime')) else (str(row[0]) if row else None)
                    return {
                        "backend": "AWS RDS PostgreSQL",
                        "host": cfg["host"],
                        "database": cfg["dbname"],
                        "reviews_count": reviews_cnt,
                        "cases_count": cases_cnt,
                        "last_saved": updated_at
                    }
        except Exception as e:
            logger.warning(f"RDS 統計查詢失敗，讀取 SQLite: {e}")

    with get_sqlite_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) as c FROM reviews")
        reviews_cnt = cursor.fetchone()["c"]
        cursor.execute("SELECT count(*) as c FROM cases")
        cases_cnt = cursor.fetchone()["c"]
        cursor.execute("SELECT updated_at FROM app_state WHERE key = 'db_state'")
        row = cursor.fetchone()
        updated_at = row["updated_at"] if row else None
        return {
            "backend": "SQLite",
            "host": "localhost (local file)",
            "database": SQLITE_DB_PATH,
            "reviews_count": reviews_cnt,
            "cases_count": cases_cnt,
            "last_saved": str(updated_at) if updated_at else None
        }


def migrate_sqlite_to_rds(sqlite_path=None):
    """將現有本地 SQLite 資料一次性完整遷移至 AWS RDS PostgreSQL。"""
    if sqlite_path is None:
        sqlite_path = SQLITE_DB_PATH
    if not os.path.exists(sqlite_path):
        logger.error(f"SQLite 檔案不存在: {sqlite_path}")
        return False

    cfg = get_rds_config()
    if not cfg["enabled"]:
        logger.error("未設定 RDS_HOST，無法執行遷移！")
        return False

    logger.info(f"開始遷移資料：{sqlite_path} -> AWS RDS ({cfg['host']})")
    
    # 讀取 SQLite
    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    s_cur = sqlite_conn.cursor()

    # 連線 RDS
    rds_conn = get_rds_connection()
    r_cur = rds_conn.cursor()

    try:
        # 確保資料表存在
        r_cur.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS reviews (
                school_id BIGINT PRIMARY KEY,
                status VARCHAR(64),
                owner VARCHAR(64),
                date VARCHAR(32),
                note TEXT,
                next_action TEXT,
                checks TEXT,
                saved VARCHAR(32),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS cases (
                school_id BIGINT PRIMARY KEY,
                stage VARCHAR(64),
                agency VARCHAR(64),
                owner VARCHAR(64),
                due VARCHAR(32),
                notes TEXT,
                actions TEXT,
                timeline TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        r_cur.execute("ALTER TABLE reviews ALTER COLUMN school_id TYPE BIGINT")
        r_cur.execute("ALTER TABLE cases ALTER COLUMN school_id TYPE BIGINT")

        # 1. 遷移 app_state
        s_cur.execute("SELECT key, value, updated_at FROM app_state")
        app_rows = s_cur.fetchall()
        for r in app_rows:
            r_cur.execute("""
                INSERT INTO app_state (key, value, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
            """, (r["key"], r["value"], r["updated_at"]))
        logger.info(f"  - app_state 遷移筆數: {len(app_rows)}")

        # 2. 遷移 reviews
        s_cur.execute("SELECT school_id, status, owner, date, note, next_action, checks, saved, updated_at FROM reviews")
        rev_rows = s_cur.fetchall()
        for r in rev_rows:
            r_cur.execute("""
                INSERT INTO reviews (school_id, status, owner, date, note, next_action, checks, saved, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (school_id) DO UPDATE SET
                    status = EXCLUDED.status, owner = EXCLUDED.owner, date = EXCLUDED.date,
                    note = EXCLUDED.note, next_action = EXCLUDED.next_action, checks = EXCLUDED.checks,
                    saved = EXCLUDED.saved, updated_at = EXCLUDED.updated_at
            """, (r["school_id"], r["status"], r["owner"], r["date"], r["note"], r["next_action"], r["checks"], r["saved"], r["updated_at"]))
        logger.info(f"  - reviews 遷移筆數: {len(rev_rows)}")

        # 3. 遷移 cases
        s_cur.execute("SELECT school_id, stage, agency, owner, due, notes, actions, timeline, updated_at FROM cases")
        case_rows = s_cur.fetchall()
        for r in case_rows:
            r_cur.execute("""
                INSERT INTO cases (school_id, stage, agency, owner, due, notes, actions, timeline, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (school_id) DO UPDATE SET
                    stage = EXCLUDED.stage, agency = EXCLUDED.agency, owner = EXCLUDED.owner,
                    due = EXCLUDED.due, notes = EXCLUDED.notes, actions = EXCLUDED.actions,
                    timeline = EXCLUDED.timeline, updated_at = EXCLUDED.updated_at
            """, (r["school_id"], r["stage"], r["agency"], r["owner"], r["due"], r["notes"], r["actions"], r["timeline"], r["updated_at"]))
        logger.info(f"  - cases 遷移筆數: {len(case_rows)}")

        rds_conn.commit()
        logger.info("🎉 恭喜！SQLite 資料已全數安全遷移至 AWS RDS PostgreSQL！")
        return True
    except Exception as e:
        rds_conn.rollback()
        logger.error(f"❌ 遷移失敗，已回滾: {e}")
        return False
    finally:
        sqlite_conn.close()
        rds_conn.close()


if __name__ == "__main__":
    init_db()
    stats = get_stats()
    print("========================================")
    print("幼安雷達目前儲存資料庫狀態:")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print("========================================")
