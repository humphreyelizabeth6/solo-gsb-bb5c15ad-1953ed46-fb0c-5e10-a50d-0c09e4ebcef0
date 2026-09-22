"""跨文档编码分布对比统计的纯函数逻辑。

统计口径（与编码共现 / 说话人分析一致）：每个编码在每篇文档内先各自
归一化（合并重叠 / 相邻的半开区间），再汇总：
  - char_count：合并后区间覆盖的字符总数（共享字符不重复计数）；
  - segment_count：合并后的区间段数；
  - coverage_rate：char_count ÷ 文档长度（文档为空时为 0）。

差异百分比：同一编码在各文档间并列比较时，以该行最大 coverage_rate 为
基准，diff_pct = (max − 当前) ÷ max（max 为 0 时全行 diff_pct 为 0）。
"""

from __future__ import annotations

from .cooccurrence import build_code_intervals


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def compute_distribution(
    documents: list[dict],
    codings_by_doc: dict[int, list[dict]],
    code_ids: list[int],
) -> list[dict]:
    """按编码 × 文档汇总分布，返回行列表（每行一个编码，cells 与 documents 同序）。

    documents 需已按标题稳定排序；每行附带 max_coverage_rate（行内最高占比，
    即差异百分比的基准），每个单元格附带首个合并区间（供前端定位）。
    """
    intervals_by_doc = {
        doc["id"]: build_code_intervals(codings_by_doc.get(doc["id"], []))
        for doc in documents
    }
    rows: list[dict] = []
    for cid in code_ids:
        cells: list[dict] = []
        for doc in documents:
            ivs = intervals_by_doc[doc["id"]].get(cid, [])
            char_count = sum(e - s for s, e in ivs)
            content = doc["content"]
            first = ivs[0] if ivs else None
            cells.append(
                {
                    "document_id": doc["id"],
                    "char_count": char_count,
                    "segment_count": len(ivs),
                    "coverage_rate": _rate(char_count, len(content)),
                    "first_segment": (
                        {
                            "start": first[0],
                            "end": first[1],
                            "text": content[first[0] : first[1]],
                        }
                        if first
                        else None
                    ),
                }
            )
        max_rate = max((c["coverage_rate"] for c in cells), default=0.0)
        for c in cells:
            c["diff_pct"] = (
                round((max_rate - c["coverage_rate"]) / max_rate, 4)
                if max_rate > 0
                else 0.0
            )
        rows.append(
            {"code_id": cid, "max_coverage_rate": max_rate, "cells": cells}
        )
    return rows
