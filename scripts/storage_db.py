#!/usr/bin/env python3
"""
幼安雷達 - SQLite 資料持久化模組
儲存承辦人覆核狀態、查核日期、備註、自訂規則與系統整體狀態。
"""

import sqlite3
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "youan_radar.db")

def get_connection(db_path=None):
    if db_path is None:
        db_path = DB_PATH
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(db_path=None):
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        
        # 1. 系統整體狀態表 (包含 rules, thresholds, profile, bedrockAdvice 等)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # 2. 人工覆核紀錄專屬表 (便於查詢、統計與結構化調閱)
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
        
        # 3. 稽核管理案件專屬表
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

def save_state(state_dict, db_path=None):
    """將完整 db 字典存入 SQLite，並同步拆解寫入 reviews 與 cases 表。"""
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        json_str = json.dumps(state_dict, ensure_ascii=False)
        cursor.execute("""
            INSERT INTO app_state (key, value, updated_at)
            VALUES ('db_state', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        """, (json_str,))
        
        # 同步 reviews
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

        # 同步 cases (若存在)
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

def get_state(db_path=None):
    """從 SQLite 讀取完整狀態。"""
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value, updated_at FROM app_state WHERE key = 'db_state'")
        row = cursor.fetchone()
        if row and row["value"]:
            try:
                data = json.loads(row["value"])
                return {"exists": True, "data": data, "updated_at": row["updated_at"]}
            except Exception:
                pass
    return {"exists": False, "data": None}

def reset_db(db_path=None):
    """清空所有自訂資料，重設為初始乾淨基線。"""
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM app_state")
        cursor.execute("DELETE FROM reviews")
        cursor.execute("DELETE FROM cases")
        conn.commit()
    return True

def get_stats(db_path=None):
    init_db(db_path)
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) as c FROM reviews")
        reviews_cnt = cursor.fetchone()["c"]
        cursor.execute("SELECT count(*) as c FROM cases")
        cases_cnt = cursor.fetchone()["c"]
        cursor.execute("SELECT updated_at FROM app_state WHERE key = 'db_state'")
        row = cursor.fetchone()
        updated_at = row["updated_at"] if row else None
        return {
            "reviews_count": reviews_cnt,
            "cases_count": cases_cnt,
            "last_saved": updated_at
        }

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
    stats = get_stats()
    print("Current stats:", stats)
