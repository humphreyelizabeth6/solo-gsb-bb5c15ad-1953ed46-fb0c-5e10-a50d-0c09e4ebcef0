"""编码共现（code co-occurrence）统计的纯函数逻辑。

统计口径：
  1. 对每个编码，先把它名下全部半开区间 [start, end) 做归一化——合并互相
     重叠或首尾相接（相邻）的区间，得到若干互不相交的合并区间。这样同一
     编码自身的多条标注不会把共享字符重复计数。
  2. 对每一对编码，求两组合并区间的交集：
       - char_count：交集覆盖的字符总数（各交集段长度之和）；
       - segment_count：交集被既有编码边界切成的片段数，即两组合并区间
         两两相交后得到的非空交集段数量。
  3. 每个交集片段同时回传原文摘录，供前端展示与定位。

对角线（编码与自身）给出该编码合并后的覆盖字符数与片段数，仅作覆盖参考，
不参与编码对之间的共现。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable


def normalize_intervals(intervals: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    """合并互相重叠或相邻（首尾相接）的半开区间，返回有序、互不相交的区间。"""
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            # 相邻（start == 上一段 end）也并入同一段
            if end > merged[-1][1]:
                merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def intersect_intervals(
    a: list[tuple[int, int]], b: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """求两组有序、互不相交区间的交集（双指针扫描）。"""
    result: list[tuple[int, int]] = []
    i = j = 0
    while i < len(a) and j < len(b):
        a_start, a_end = a[i]
        b_start, b_end = b[j]
        lo = max(a_start, b_start)
        hi = min(a_end, b_end)
        if lo < hi:
            result.append((lo, hi))
        if a_end <= b_end:
            i += 1
        else:
            j += 1
    return result


def build_code_intervals(codings: Iterable[dict]) -> dict[int, list[tuple[int, int]]]:
    """按 code_id 收集区间并各自归一化。"""
    raw: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for c in codings:
        raw[c["code_id"]].append((c["start"], c["end"]))
    return {code_id: normalize_intervals(ivs) for code_id, ivs in raw.items()}
