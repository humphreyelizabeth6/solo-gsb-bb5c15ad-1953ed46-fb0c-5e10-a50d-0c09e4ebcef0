"""SQLite 数据访问层（标准库 sqlite3，数据落盘到挂载卷，刷新/重启可恢复）。"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", "/data/app.db")

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
    start INTEGER NOT NULL CHECK (start >= 0),
    "end" INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ("end" > start)
);

CREATE INDEX IF NOT EXISTS idx_codings_doc ON codings(document_id);
"""

PALETTE = [
    "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6",
    "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
]

SAMPLE_TITLE = "访谈记录 A-01：远程办公适应访谈"
SAMPLE_CONTENT = """【访谈对象】P07，某互联网公司产品经理，远程办公 18 个月
【访谈时间】2024-05-12 14:00-15:10
【访谈人】研究者 L

L：先聊聊你刚开始远程办公时的状态吧。

P07：说实话头两个月挺混乱的。家里没有专门的书房，我就在餐桌上办公，孩子上网课也在同一张桌子上。那时候我特别焦虑，总觉得工作和生活完全搅在一起了，晚上十点还在回消息，因为电脑就摆在那儿，你很难跟自己说"我下班了"。

L：后来是怎么调整的？

P07：大概第三个月，我给自己定了规矩：早上九点前必须换好衣服坐到桌前，中午出门走二十分钟，晚上七点把电脑收进柜子里。听起来挺形式主义的，但真的有用。我还跟团队约定了"异步优先"的沟通方式，非紧急的事情两小时内回复就行，不用秒回。这个约定让我的焦虑感下降了很多。

L：你觉得远程办公对团队协作有什么影响？

P07：双刃剑吧。好的方面是写文档的习惯养成了，决策都有记录，新人入职看文档就能上手。不好的方面是创意讨论明显变少了，以前在白板前一聊就是半小时，现在开会都有议程，到点就散，那种灵光一现的东西少了。还有就是新人融入困难，我带的一个应届生，入职三个月还没跟团队里一半的人说过话，这在以前是不可想象的。

L：如果未来公司要求回到办公室，你的态度是？

P07：我希望能保留混合模式。一周去两三天办公室，开会、讨论、团建放在办公室，需要深度专注的工作留在家里。完全回办公室我可能会考虑换工作，通勤每天两个小时，这个成本我现在已经不愿意付了。"""

SEED_CODES = [
    ("情绪体验", "#ef4444"),
    ("应对策略", "#10b981"),
    ("工作边界", "#f59e0b"),
    ("团队协作", "#3b82f6"),
]


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(SCHEMA)
        row = conn.execute("SELECT COUNT(*) AS n FROM documents").fetchone()
        if row["n"] == 0:
            _seed(conn)


def _seed(conn: sqlite3.Connection) -> None:
    cur = conn.execute(
        "INSERT INTO documents (title, content) VALUES (?, ?)",
        (SAMPLE_TITLE, SAMPLE_CONTENT),
    )
    doc_id = cur.lastrowid
    code_ids: dict[str, int] = {}
    for i, (name, color) in enumerate(SEED_CODES):
        cur = conn.execute(
            "INSERT INTO codes (name, color) VALUES (?, ?)", (name, color)
        )
        code_ids[name] = cur.lastrowid

    def add(code: str, anchor: str, occurrence: int = 1) -> None:
        """按文本锚点定位并写入一条编码，避免手写偏移量出错。"""
        pos = -1
        from_pos = 0
        for _ in range(occurrence):
            pos = SAMPLE_CONTENT.find(anchor, from_pos)
            from_pos = pos + 1
        if pos < 0:
            raise ValueError(f"seed anchor not found: {anchor!r}")
        conn.execute(
            'INSERT INTO codings (document_id, code_id, start, "end") VALUES (?, ?, ?, ?)',
            (doc_id, code_ids[code], pos, pos + len(anchor)),
        )

    add("情绪体验", "那时候我特别焦虑，总觉得工作和生活完全搅在一起了")
    add("工作边界", "晚上十点还在回消息，因为电脑就摆在那儿")
    add("情绪体验", "晚上十点还在回消息")
    add("应对策略", "我给自己定了规矩：早上九点前必须换好衣服坐到桌前，中午出门走二十分钟，晚上七点把电脑收进柜子里")
    add("应对策略", '跟团队约定了"异步优先"的沟通方式')
    add("情绪体验", "这个约定让我的焦虑感下降了很多")
    add("应对策略", "这个约定让我的焦虑感下降了很多")
    add("团队协作", "写文档的习惯养成了，决策都有记录")
    add("应对策略", "写文档的习惯养成了")
    add("团队协作", "创意讨论明显变少了")
    add("团队协作", "新人融入困难，我带的一个应届生，入职三个月还没跟团队里一半的人说过话")
    add("工作边界", "需要深度专注的工作留在家里")
    add("应对策略", "开会、讨论、团建放在办公室，需要深度专注的工作留在家里")


# ---------- 查询辅助 ----------

def list_codings(conn: sqlite3.Connection, document_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT cg.id, cg.document_id, cg.code_id, cg.start, cg."end",
               cg.created_at, cg.updated_at, c.name AS code_name, c.color AS code_color
        FROM codings cg JOIN codes c ON c.id = cg.code_id
        WHERE cg.document_id = ?
        ORDER BY cg.start, cg."end", cg.id
        """,
        (document_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def next_color(conn: sqlite3.Connection) -> str:
    n = conn.execute("SELECT COUNT(*) AS n FROM codes").fetchone()["n"]
    return PALETTE[n % len(PALETTE)]
