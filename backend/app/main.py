"""质性分析工作台后端：FastAPI + SQLite。"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .conflicts import (
    find_conflicts,
    merge_same_code,
    split_containers,
    subtract_ranges,
)
from .cooccurrence import build_code_intervals, intersect_intervals
from .db import get_db, init_db, list_codings, next_color
from .distribution import compute_distribution
from .gaps import compute_gaps
from .speakers import compute_speaker_stats
from .transitions import compute_transitions

Resolution = Literal["keep", "merge", "split"]


# ---------- Pydantic 模型 ----------

class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class CodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str | None = None


class CodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = None


class PreviewRequest(BaseModel):
    document_id: int
    code_id: int
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    exclude_id: int | None = None


class CodingCreate(BaseModel):
    document_id: int
    code_id: int
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    resolution: Resolution = "keep"


class CodingUpdate(BaseModel):
    code_id: int | None = None
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, gt=0)
    resolution: Resolution = "keep"


class BatchCodingItem(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class BatchCodingCreate(BaseModel):
    document_id: int
    code_id: int
    items: list[BatchCodingItem] = Field(min_length=1, max_length=1000)


# ---------- 应用 ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="访谈转录质性分析工作台", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_document_or_404(conn, document_id: int) -> dict:
    row = conn.execute(
        "SELECT id, title, content, created_at FROM documents WHERE id = ?",
        (document_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    return dict(row)


def get_code_or_404(conn, code_id: int) -> dict:
    row = conn.execute(
        "SELECT id, name, color, created_at FROM codes WHERE id = ?", (code_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="编码不存在")
    return dict(row)


def validate_range(doc: dict, start: int, end: int) -> None:
    if end <= start:
        raise HTTPException(status_code=422, detail="区间不合法：end 必须大于 start")
    if end > len(doc["content"]):
        raise HTTPException(status_code=422, detail="区间超出文本长度")


# ---------- 健康检查 ----------

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ---------- 文档 ----------

@app.get("/api/documents")
def list_documents() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT d.id, d.title, d.created_at, length(d.content) AS length,
                   (SELECT COUNT(*) FROM codings cg WHERE cg.document_id = d.id) AS coding_count
            FROM documents d ORDER BY d.id
            """
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/documents", status_code=201)
def create_document(body: DocumentCreate) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO documents (title, content) VALUES (?, ?)",
            (body.title, body.content),
        )
        return get_document_or_404(conn, cur.lastrowid)


@app.get("/api/documents/{document_id}")
def get_document(document_id: int) -> dict:
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        codes = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, color, created_at FROM codes ORDER BY id"
            ).fetchall()
        ]
        return {
            "document": doc,
            "codes": codes,
            "codings": list_codings(conn, document_id),
        }


@app.delete("/api/documents/{document_id}", status_code=204)
def delete_document(document_id: int) -> Response:
    with get_db() as conn:
        get_document_or_404(conn, document_id)
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    return Response(status_code=204)


# ---------- 关键词检索（批量编码用） ----------

SEARCH_CONTEXT_CHARS = 20


@app.get("/api/documents/{document_id}/search")
def search_document(
    document_id: int,
    query: str = Query(min_length=1, max_length=200),
) -> dict:
    """在文档全文中检索字面关键词（非正则），返回全部命中的稳定半开区间。

    彼此重叠的命中也一并返回（如 "aa" 在 "aaa" 中命中 [0,2) 与 [1,3)），
    每项附带前后文片段，便于前端逐项确认后批量编码。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
    content = doc["content"]
    matches: list[dict] = []
    pos = content.find(query)
    while pos != -1:
        end = pos + len(query)
        matches.append(
            {
                "start": pos,
                "end": end,
                "text": content[pos:end],
                "before": content[max(0, pos - SEARCH_CONTEXT_CHARS) : pos],
                "after": content[end : end + SEARCH_CONTEXT_CHARS],
            }
        )
        # 从下一字符继续找，保证重叠命中不被跳过
        pos = content.find(query, pos + 1)
    return {"document_id": document_id, "query": query, "matches": matches}


# ---------- 编码本（codebook） ----------

@app.get("/api/codes")
def list_codes() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.name, c.color, c.created_at,
                   (SELECT COUNT(*) FROM codings cg WHERE cg.code_id = c.id) AS usage_count
            FROM codes c ORDER BY c.id
            """
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/codes", status_code=201)
def create_code(body: CodeCreate) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="编码名不能为空")
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM codes WHERE name = ?", (name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="同名编码已存在")
        color = body.color or next_color(conn)
        cur = conn.execute(
            "INSERT INTO codes (name, color) VALUES (?, ?)", (name, color)
        )
        return get_code_or_404(conn, cur.lastrowid)


@app.put("/api/codes/{code_id}")
def update_code(code_id: int, body: CodeUpdate) -> dict:
    with get_db() as conn:
        code = get_code_or_404(conn, code_id)
        name = (body.name or code["name"]).strip()
        color = body.color or code["color"]
        dup = conn.execute(
            "SELECT id FROM codes WHERE name = ? AND id != ?", (name, code_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="同名编码已存在")
        conn.execute(
            "UPDATE codes SET name = ?, color = ? WHERE id = ?",
            (name, color, code_id),
        )
        return get_code_or_404(conn, code_id)


@app.delete("/api/codes/{code_id}", status_code=204)
def delete_code(code_id: int) -> Response:
    with get_db() as conn:
        get_code_or_404(conn, code_id)
        conn.execute("DELETE FROM codes WHERE id = ?", (code_id,))
    return Response(status_code=204)


# ---------- 冲突预览 ----------

@app.post("/api/codings/preview")
def preview_coding(body: PreviewRequest) -> dict:
    with get_db() as conn:
        doc = get_document_or_404(conn, body.document_id)
        get_code_or_404(conn, body.code_id)
        validate_range(doc, body.start, body.end)
        existing = list_codings(conn, body.document_id)
        conflicts = find_conflicts(
            existing, body.code_id, body.start, body.end, body.exclude_id
        )
        return {
            "has_conflicts": len(conflicts) > 0,
            "conflicts": conflicts,
            "available_resolutions": sorted(
                {a for c in conflicts for a in c["actions"]} | {"keep"}
            ),
        }


# ---------- 编码的创建 / 修改 / 删除 ----------

INSERT_CODING = (
    'INSERT INTO codings (document_id, code_id, start, "end") VALUES (?, ?, ?, ?)'
)


def apply_coding(
    conn,
    document_id: int,
    code_id: int,
    start: int,
    end: int,
    resolution: Resolution,
    exclude_id: int | None = None,
) -> list[int]:
    """按决策写入编码，返回产生的 coding id 列表。"""
    existing = [
        c for c in list_codings(conn, document_id) if c["id"] != exclude_id
    ]
    conflicts = find_conflicts(existing, code_id, start, end)
    same = [c["coding"] for c in conflicts if c["type"] == "same_code"]
    containers = [c["coding"] for c in conflicts if c["type"] == "nested_container"]
    contained = [c["coding"] for c in conflicts if c["type"] == "nested_contained"]

    if resolution == "merge" and same:
        m_start, m_end, absorbed = merge_same_code(existing, code_id, start, end)
        for cid in absorbed:
            conn.execute("DELETE FROM codings WHERE id = ?", (cid,))
        cur = conn.execute(INSERT_CODING, (document_id, code_id, m_start, m_end))
        return [cur.lastrowid]

    if resolution == "split" and (containers or contained):
        for op in split_containers(containers, start, end):
            old = next(c for c in containers if c["id"] == op["id"])
            conn.execute("DELETE FROM codings WHERE id = ?", (op["id"],))
            for s, e in op["parts"]:
                conn.execute(
                    INSERT_CODING, (document_id, old["code_id"], s, e)
                )
        holes = [(c["start"], c["end"]) for c in contained]
        ids = []
        for s, e in subtract_ranges(start, end, holes):
            cur = conn.execute(INSERT_CODING, (document_id, code_id, s, e))
            ids.append(cur.lastrowid)
        return ids

    cur = conn.execute(INSERT_CODING, (document_id, code_id, start, end))
    return [cur.lastrowid]


@app.post("/api/codings", status_code=201)
def create_coding(body: CodingCreate) -> dict:
    with get_db() as conn:
        doc = get_document_or_404(conn, body.document_id)
        get_code_or_404(conn, body.code_id)
        validate_range(doc, body.start, body.end)
        ids = apply_coding(
            conn, body.document_id, body.code_id, body.start, body.end,
            body.resolution,
        )
        return {"ids": ids, "codings": list_codings(conn, body.document_id)}


@app.post("/api/codings/batch", status_code=201)
def create_codings_batch(body: BatchCodingCreate) -> dict:
    """批量创建编码标注（单个事务）。

    先在事务内校验全部区间：任一非法（end <= start 或超出文本长度）即抛 422，
    整批回滚不落库。校验通过后逐项写入：
      - 与既有标注完全相同（同编码、同区间）的项记为跳过（含本批先写入的项）；
      - 其余按 keep 边界原样写入，不做合并 / 拆分调整。
    返回新增与跳过明细及最新标注列表。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, body.document_id)
        get_code_or_404(conn, body.code_id)
        length = len(doc["content"])
        invalid = [
            {"index": i, "start": it.start, "end": it.end}
            for i, it in enumerate(body.items)
            if not (it.start < it.end <= length)
        ]
        if invalid:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": f"存在 {len(invalid)} 个非法区间，整批未写入",
                    "invalid": invalid,
                },
            )
        id_by_key = {
            (c["code_id"], c["start"], c["end"]): c["id"]
            for c in list_codings(conn, body.document_id)
        }
        created: list[dict] = []
        skipped: list[dict] = []
        for it in body.items:
            key = (body.code_id, it.start, it.end)
            if key in id_by_key:
                skipped.append(
                    {"start": it.start, "end": it.end, "existing_id": id_by_key[key]}
                )
                continue
            cur = conn.execute(
                INSERT_CODING, (body.document_id, body.code_id, it.start, it.end)
            )
            id_by_key[key] = cur.lastrowid
            created.append({"id": cur.lastrowid, "start": it.start, "end": it.end})
        return {
            "created": created,
            "skipped": skipped,
            "codings": list_codings(conn, body.document_id),
        }


@app.put("/api/codings/{coding_id}")
def update_coding(coding_id: int, body: CodingUpdate) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, document_id, code_id, start, \"end\" FROM codings WHERE id = ?",
            (coding_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="编码标注不存在")
        old = dict(row)
        doc = get_document_or_404(conn, old["document_id"])
        code_id = body.code_id if body.code_id is not None else old["code_id"]
        start = body.start if body.start is not None else old["start"]
        end = body.end if body.end is not None else old["end"]
        get_code_or_404(conn, code_id)
        validate_range(doc, start, end)
        if body.resolution == "keep":
            # 无结构变更：原地更新，保留原 id
            conn.execute(
                'UPDATE codings SET code_id = ?, start = ?, "end" = ?,'
                " updated_at = datetime('now') WHERE id = ?",
                (code_id, start, end, coding_id),
            )
            ids = [coding_id]
        else:
            # merge / split 会改动其它编码：删除旧标注后按决策重写（同事务，失败回滚）
            conn.execute("DELETE FROM codings WHERE id = ?", (coding_id,))
            ids = apply_coding(
                conn, old["document_id"], code_id, start, end,
                body.resolution, exclude_id=coding_id,
            )
        return {"ids": ids, "codings": list_codings(conn, old["document_id"])}


@app.delete("/api/codings/{coding_id}", status_code=204)
def delete_coding(coding_id: int) -> Response:
    with get_db() as conn:
        row = conn.execute("SELECT id FROM codings WHERE id = ?", (coding_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="编码标注不存在")
        conn.execute("DELETE FROM codings WHERE id = ?", (coding_id,))
    return Response(status_code=204)


# ---------- 导出 ----------

@app.get("/api/documents/{document_id}/export")
def export_document(document_id: int) -> JSONResponse:
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        codes = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, color FROM codes ORDER BY id"
            ).fetchall()
        ]
        codings = list_codings(conn, document_id)
    content = doc["content"]
    payload = {
        "document": {
            "id": doc["id"],
            "title": doc["title"],
            "content": content,
            "length": len(content),
        },
        "codes": codes,
        "codings": [
            {
                "id": c["id"],
                "code_id": c["code_id"],
                "code": c["code_name"],
                "color": c["code_color"],
                "start": c["start"],
                "end": c["end"],
                "text": content[c["start"] : c["end"]],
            }
            for c in codings
        ],
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }
    filename = f"codings-doc-{document_id}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- 编码共现统计 ----------

@app.get("/api/documents/{document_id}/cooccurrence")
def cooccurrence(
    document_id: int,
    codes: list[int] | None = Query(default=None),
) -> dict:
    """按当前文档返回编码两两共现矩阵数据。

    查询参数 `codes` 为可选的编码筛选（?codes=1&codes=2）；缺省统计编码本
    全部编码。每个编码先各自合并重叠/相邻区间，再对编码对求交集，保证
    共享字符不被重复计数。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        all_codes = {
            r["id"]: {"id": r["id"], "name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM codes ORDER BY id")
        }
        if codes:
            unknown = [cid for cid in dict.fromkeys(codes) if cid not in all_codes]
            if unknown:
                raise HTTPException(
                    status_code=404, detail=f"编码不存在: {unknown}"
                )
            member_ids = sorted(set(codes))
        else:
            member_ids = sorted(all_codes)
        codings = list_codings(conn, document_id)

    intervals = build_code_intervals(codings)
    content = doc["content"]
    pairs: list[dict] = []
    for i, ci in enumerate(member_ids):
        for cj in member_ids[i:]:
            ivs_i = intervals.get(ci, [])
            ivs_j = intervals.get(cj, [])
            shared = ivs_i if ci == cj else intersect_intervals(ivs_i, ivs_j)
            pairs.append(
                {
                    "code_a_id": ci,
                    "code_b_id": cj,
                    "diagonal": ci == cj,
                    "char_count": sum(e - s for s, e in shared),
                    "segment_count": len(shared),
                    "segments": [
                        {"start": s, "end": e, "text": content[s:e]}
                        for s, e in shared
                    ],
                }
            )
    return {
        "document_id": document_id,
        "codes": [all_codes[cid] for cid in member_ids],
        "pairs": pairs,
    }


# ---------- 说话人分析 ----------

@app.get("/api/documents/{document_id}/speakers")
def speaker_analysis(
    document_id: int,
    codes: str | None = Query(default=None),
) -> dict:
    """按当前文档返回说话人分析数据。

    解析形如「说话人：内容」的发言段落（行首标签 + 全角/半角冒号），统计
    每位说话人的文本长度、各编码覆盖字符数与覆盖率；文首无法识别说话人
    的文本归入「未标注说话人」。同一编码的重叠标注先合并再裁剪到发言段落，
    共享字符不重复计数。

    查询参数 `codes` 为逗号分隔的编码 id（?codes=1,2）：缺省统计编码本
    全部编码；空串（?codes=）表示不统计任何编码，仅返回文本长度。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        all_codes = {
            r["id"]: {"id": r["id"], "name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM codes ORDER BY id")
        }
        if codes is None:
            member_ids = sorted(all_codes)
        else:
            try:
                member_ids = sorted(
                    {int(x) for x in codes.split(",") if x.strip()}
                )
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="codes 参数格式错误：应为逗号分隔的编码 id",
                )
            unknown = [cid for cid in member_ids if cid not in all_codes]
            if unknown:
                raise HTTPException(
                    status_code=404, detail=f"编码不存在: {unknown}"
                )
        codings = list_codings(conn, document_id)

    content = doc["content"]
    return {
        "document_id": document_id,
        "document_length": len(content),
        "codes": [all_codes[cid] for cid in member_ids],
        "speakers": compute_speaker_stats(content, codings, member_ids),
    }


# ---------- 覆盖缺口 ----------

@app.get("/api/documents/{document_id}/gaps")
def coverage_gaps(
    document_id: int,
    codes: str | None = Query(default=None),
) -> dict:
    """按当前文档返回未被所选编码覆盖的连续文本区间（覆盖缺口）。

    先把所选编码的半开标注区间合并为并集（重叠/相邻的区间并成一段），
    再对 [0, 全文长度) 求补集；文首、文尾与零标注（全文即一个缺口）场景
    均自然保留。每个缺口返回起止位置、长度与原文摘录。

    查询参数 `codes` 为逗号分隔的编码 id（?codes=1,2）：缺省统计编码本
    全部编码；空串（?codes=）表示不统计任何编码，全文即一个缺口。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        all_codes = {
            r["id"]: {"id": r["id"], "name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM codes ORDER BY id")
        }
        if codes is None:
            member_ids = sorted(all_codes)
        else:
            try:
                member_ids = sorted(
                    {int(x) for x in codes.split(",") if x.strip()}
                )
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="codes 参数格式错误：应为逗号分隔的编码 id",
                )
            unknown = [cid for cid in member_ids if cid not in all_codes]
            if unknown:
                raise HTTPException(
                    status_code=404, detail=f"编码不存在: {unknown}"
                )
        codings = list_codings(conn, document_id)

    content = doc["content"]
    gaps = compute_gaps(content, codings, member_ids)
    covered = len(content) - sum(g["length"] for g in gaps)
    return {
        "document_id": document_id,
        "document_length": len(content),
        "codes": [all_codes[cid] for cid in member_ids],
        "covered_char_count": covered,
        "coverage_rate": round(covered / len(content), 4) if content else 0.0,
        "gaps": gaps,
    }


# ---------- 编码流转 ----------

@app.get("/api/documents/{document_id}/transitions")
def code_transitions(
    document_id: int,
    codes: str | None = Query(default=None),
) -> dict:
    """按当前文档返回相邻编码状态的有向转移统计。

    把所选编码的全部标注起止边界切成原子区间，以覆盖编码集合表示区间
    状态；跳过无编码区间并合并物理相邻的同状态区间，再按文档顺序统计
    相邻状态的有向转移次数，返回每次转移的来源、目标区间及中间距离
    （目标起点 − 来源终点，0 表示首尾相接）。

    查询参数 `codes` 为逗号分隔的编码 id（?codes=1,2）：缺省统计编码本
    全部编码；空串（?codes=）表示不统计任何编码（无状态区间、无转移）。
    """
    with get_db() as conn:
        doc = get_document_or_404(conn, document_id)
        all_codes = {
            r["id"]: {"id": r["id"], "name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM codes ORDER BY id")
        }
        if codes is None:
            member_ids = sorted(all_codes)
        else:
            try:
                member_ids = sorted(
                    {int(x) for x in codes.split(",") if x.strip()}
                )
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="codes 参数格式错误：应为逗号分隔的编码 id",
                )
            unknown = [cid for cid in member_ids if cid not in all_codes]
            if unknown:
                raise HTTPException(
                    status_code=404, detail=f"编码不存在: {unknown}"
                )
        codings = list_codings(conn, document_id)

    content = doc["content"]
    return {
        "document_id": document_id,
        "document_length": len(content),
        "codes": [all_codes[cid] for cid in member_ids],
        **compute_transitions(content, codings, member_ids),
    }


# ---------- 跨文档编码分布对比 ----------

ALL_CODINGS_SQL = """
    SELECT cg.id, cg.document_id, cg.code_id, cg.start, cg."end",
           cg.created_at, cg.updated_at, c.name AS code_name, c.color AS code_color
    FROM codings cg JOIN codes c ON c.id = cg.code_id
    ORDER BY cg.start, cg."end", cg.id
"""


@app.get("/api/code-distribution")
def code_distribution(codes: str | None = Query(default=None)) -> dict:
    """跨文档编码分布对比（单一快照计算，不修改任何标注）。

    对全部文档按所选编码汇总标注字符数、标注段数与占文档长度比例，文档按
    标题稳定排序（标题相同按 id）；同一编码在每篇文档内先合并重叠/相邻区间
    再统计，共享字符不重复计数。每行（编码）附带相对行内最高占比的差异
    百分比与首个合并区间（供前端定位）。同时返回：
      - missing_codes：在全部文档中都没有标注的所选编码；
      - empty_documents：没有任何所选编码标注的文档。

    查询参数 codes 为逗号分隔的编码 id（?codes=1,2）：缺省统计编码本全部
    编码；空串（?codes=）表示不统计任何编码。
    """
    with get_db() as conn:
        all_codes = {
            r["id"]: {"id": r["id"], "name": r["name"], "color": r["color"]}
            for r in conn.execute("SELECT id, name, color FROM codes ORDER BY id")
        }
        if codes is None:
            member_ids = sorted(all_codes)
        else:
            try:
                member_ids = sorted(
                    {int(x) for x in codes.split(",") if x.strip()}
                )
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="codes 参数格式错误：应为逗号分隔的编码 id",
                )
            unknown = [cid for cid in member_ids if cid not in all_codes]
            if unknown:
                raise HTTPException(
                    status_code=404, detail=f"编码不存在: {unknown}"
                )
        documents = [
            dict(r)
            for r in conn.execute(
                "SELECT id, title, content FROM documents ORDER BY title, id"
            ).fetchall()
        ]
        codings_by_doc: dict[int, list[dict]] = {}
        for row in conn.execute(ALL_CODINGS_SQL).fetchall():
            codings_by_doc.setdefault(row["document_id"], []).append(dict(row))

    rows = compute_distribution(documents, codings_by_doc, member_ids)
    missing_codes = [
        all_codes[cid]
        for cid, row in zip(member_ids, rows)
        if all(cell["char_count"] == 0 for cell in row["cells"])
    ]
    coded_doc_ids = {
        cell["document_id"]
        for row in rows
        for cell in row["cells"]
        if cell["char_count"] > 0
    }
    empty_documents = [
        {"id": d["id"], "title": d["title"]}
        for d in documents
        if d["id"] not in coded_doc_ids
    ]
    return {
        "codes": [all_codes[cid] for cid in member_ids],
        "documents": [
            {"id": d["id"], "title": d["title"], "length": len(d["content"])}
            for d in documents
        ],
        "rows": rows,
        "missing_codes": missing_codes,
        "empty_documents": empty_documents,
    }
