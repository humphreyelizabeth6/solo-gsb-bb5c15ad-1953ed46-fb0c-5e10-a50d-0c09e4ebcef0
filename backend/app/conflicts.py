"""冲突检测与消解的纯函数逻辑。

编码（coding）是文档字符区间 [start, end) 上的一条标注。
支持两类冲突的实时检测：
  - 同名冲突：相同编码（code）的区间相互重叠
  - 嵌套冲突：不同编码的区间互相包含（一方完全覆盖另一方）

对应的消解决策：
  - merge（合并）：把同名且重叠/相邻的编码合并为一个区间
  - split（拆分）：在嵌套边界处拆分外层编码，使区间不再相互包含
  - keep（保留边界）：不做任何调整，允许重叠/嵌套共存
"""

from __future__ import annotations

from typing import Iterable

# 区间是半开区间 [start, end)


def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def touches(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """重叠或首尾相接。"""
    return a_start <= b_end and b_start <= a_end


def contains(c_start: int, c_end: int, start: int, end: int) -> bool:
    """[c_start, c_end) 完全包含 [start, end)（允许边界重合）。"""
    return c_start <= start and c_end >= end


def strictly_contains(c_start: int, c_end: int, start: int, end: int) -> bool:
    return contains(c_start, c_end, start, end) and (c_start < start or c_end > end)


def find_conflicts(
    existing: Iterable[dict],
    code_id: int,
    start: int,
    end: int,
    exclude_id: int | None = None,
) -> list[dict]:
    """在既有编码中检测与新区间 [start, end) 的冲突。

    返回冲突列表，每项：
      {
        "type": "same_code" | "nested_container" | "nested_contained",
        "coding": <既有编码 dict>,
        "actions": ["merge", "keep"] 或 ["split", "keep"],
      }
    """
    conflicts: list[dict] = []
    for c in existing:
        if exclude_id is not None and c["id"] == exclude_id:
            continue
        if not overlaps(c["start"], c["end"], start, end) and not (
            c["start"] == start and c["end"] == end
        ):
            continue
        if c["code_id"] == code_id:
            conflicts.append(
                {"type": "same_code", "coding": c, "actions": ["merge", "keep"]}
            )
        elif strictly_contains(c["start"], c["end"], start, end):
            conflicts.append(
                {
                    "type": "nested_container",
                    "coding": c,
                    "actions": ["split", "keep"],
                }
            )
        elif strictly_contains(start, end, c["start"], c["end"]):
            conflicts.append(
                {
                    "type": "nested_contained",
                    "coding": c,
                    "actions": ["split", "keep"],
                }
            )
        # 不同编码的部分重叠（互不包含）在质性编码中属正常，不算冲突
    return conflicts


def merge_same_code(
    existing: Iterable[dict], code_id: int, start: int, end: int
) -> tuple[int, int, list[int]]:
    """计算同名合并：返回 (合并后 start, 合并后 end, 被吸收的 coding id 列表)。

    迭代扩张直到区间不再吞并任何同名且重叠/相邻的编码（传递闭包）。
    """
    absorbed: list[int] = []
    changed = True
    while changed:
        changed = False
        for c in existing:
            if c["id"] in absorbed or c["code_id"] != code_id:
                continue
            if touches(c["start"], c["end"], start, end):
                start = min(start, c["start"])
                end = max(end, c["end"])
                absorbed.append(c["id"])
                changed = True
    return start, end, absorbed


def split_containers(
    containers: Iterable[dict], start: int, end: int
) -> list[dict]:
    """拆分包含新区间的外层编码。

    每个外层编码 [s, e) 被替换为左侧 [s, start) 与右侧 [end, e) 两段
    （长度为零的段丢弃）。返回需要执行的拆分操作列表：
      {"id": 原 coding id, "parts": [(s1, e1), (s2, e2)]}
    """
    ops: list[dict] = []
    for c in containers:
        parts = []
        if c["start"] < start:
            parts.append((c["start"], start))
        if end < c["end"]:
            parts.append((end, c["end"]))
        ops.append({"id": c["id"], "parts": parts})
    return ops


def subtract_ranges(start: int, end: int, holes: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    """从 [start, end) 中扣除若干子区间，返回剩余的非空区间列表。

    用于新区间包含既有编码时，把新区间自身拆分绕开被包含者。
    """
    pieces = [(start, end)]
    for h_start, h_end in sorted(holes):
        next_pieces: list[tuple[int, int]] = []
        for p_start, p_end in pieces:
            if h_end <= p_start or h_start >= p_end:
                next_pieces.append((p_start, p_end))
                continue
            if p_start < h_start:
                next_pieces.append((p_start, h_start))
            if h_end < p_end:
                next_pieces.append((h_end, p_end))
        pieces = next_pieces
    return pieces
