"""覆盖缺口（coverage gap）统计的纯函数逻辑。

统计口径：先把所选编码名下的全部半开标注区间合并为并集（互相重叠或
首尾相接的区间并成一段，与编码共现的归一化口径一致），再对
[0, 全文长度) 求补集，得到未被任何所选编码覆盖的连续文本区间。
文首缺口（[0, 首个并集区间起点)）、文尾缺口（[末个并集区间终点, 全文
长度)）与零标注（全文即一个缺口）场景都由此自然得到，无需特判。
"""

from __future__ import annotations

from .cooccurrence import normalize_intervals


def compute_gaps(
    content: str, codings: list[dict], code_ids: list[int]
) -> list[dict]:
    """计算未被 code_ids 中任何编码覆盖的连续缺口，按文档顺序返回。

    每个缺口：{"start", "end", "length", "text"}（原文摘录）。
    """
    selected = set(code_ids)
    union = normalize_intervals(
        (c["start"], c["end"]) for c in codings if c["code_id"] in selected
    )
    spans: list[tuple[int, int]] = []
    cursor = 0
    for start, end in union:
        if start > cursor:
            spans.append((cursor, start))
        if end > cursor:
            cursor = end
    if cursor < len(content):
        spans.append((cursor, len(content)))
    return [
        {"start": s, "end": e, "length": e - s, "text": content[s:e]}
        for s, e in spans
    ]
