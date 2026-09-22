"""说话人发言段落解析与编码覆盖统计的纯函数逻辑。

解析规则：行首出现「说话人：」（全角 ：或半角 :，标签为 1–20 个非空白、
非冒号字符）即开启一个发言段落；段落从标签行首延伸到下一个说话人标签的
行首（或文末）。因此全部发言段落加上文首未识别部分恰好覆盖整篇文档，
不会遗漏也不会重叠。文首到首个发言段落之间无法识别说话人的文本归入
「未标注说话人」。

统计口径（与编码共现一致）：每个编码先各自归一化（合并重叠/相邻区间），
再裁剪（求交集）到说话人的发言段落，同一编码的重叠标注不会被重复计数；
「总覆盖」为参与统计的全部编码合并后的并集覆盖。
"""

from __future__ import annotations

import re
from typing import Iterable

from .cooccurrence import build_code_intervals, intersect_intervals, normalize_intervals

# 行首「标签：」即说话人标签：1–20 个非空白、非冒号字符，支持全角/半角冒号
SPEAKER_RE = re.compile(r"^([^\s：:]{1,20})[：:]", re.MULTILINE)


def parse_speaker_turns(content: str) -> list[dict]:
    """解析发言段落，返回按文档顺序、互不重叠的 [{speaker, start, end}]。"""
    matches = list(SPEAKER_RE.finditer(content))
    turns: list[dict] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        turns.append({"speaker": m.group(1), "start": m.start(), "end": end})
    return turns


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


def _segments(intervals: Iterable[tuple[int, int]], content: str) -> list[dict]:
    return [{"start": s, "end": e, "text": content[s:e]} for s, e in intervals]


def _code_stat(
    code_id: int,
    turn_intervals: list[tuple[int, int]],
    code_intervals: dict[int, list[tuple[int, int]]],
    char_count: int,
    content: str,
) -> dict:
    segs = intersect_intervals(turn_intervals, code_intervals.get(code_id, []))
    chars = sum(e - s for s, e in segs)
    return {
        "code_id": code_id,
        "char_count": chars,
        "coverage_rate": _rate(chars, char_count),
        "segments": _segments(segs, content),
    }


def _speaker_entry(
    name: str | None,
    turn_intervals: list[tuple[int, int]],
    code_ids: list[int],
    code_intervals: dict[int, list[tuple[int, int]]],
    union_intervals: list[tuple[int, int]],
    content: str,
) -> dict:
    char_count = sum(e - s for s, e in turn_intervals)
    coded = intersect_intervals(turn_intervals, union_intervals)
    coded_char_count = sum(e - s for s, e in coded)
    return {
        "name": name,
        "unattributed": name is None,
        "turn_count": len(turn_intervals),
        "char_count": char_count,
        "coded_char_count": coded_char_count,
        "coverage_rate": _rate(coded_char_count, char_count),
        "turns": _segments(turn_intervals, content),
        "coded_segments": _segments(coded, content),
        "codes": [
            _code_stat(cid, turn_intervals, code_intervals, char_count, content)
            for cid in code_ids
        ],
    }


def compute_speaker_stats(
    content: str, codings: list[dict], code_ids: list[int]
) -> list[dict]:
    """按说话人统计文本长度与各编码覆盖，返回说话人统计列表。

    说话人按首次发言顺序排列；若文首存在无法识别说话人的文本，末尾追加
    一条 name=None 的「未标注说话人」统计。
    """
    turns = parse_speaker_turns(content)
    code_intervals = build_code_intervals(codings)
    union_intervals = normalize_intervals(
        iv for cid in code_ids for iv in code_intervals.get(cid, [])
    )

    grouped: dict[str, list[tuple[int, int]]] = {}
    for t in turns:
        grouped.setdefault(t["speaker"], []).append((t["start"], t["end"]))

    speakers = [
        _speaker_entry(name, ivs, code_ids, code_intervals, union_intervals, content)
        for name, ivs in grouped.items()
    ]

    # 文首到首个发言段落之间（无发言段落时为全文）归入未标注说话人
    unattributed_end = turns[0]["start"] if turns else len(content)
    if unattributed_end > 0:
        speakers.append(
            _speaker_entry(
                None,
                [(0, unattributed_end)],
                code_ids,
                code_intervals,
                union_intervals,
                content,
            )
        )
    return speakers
