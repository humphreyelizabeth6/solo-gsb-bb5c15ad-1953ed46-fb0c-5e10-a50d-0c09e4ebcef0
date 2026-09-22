"""编码流转（code transition）统计的纯函数逻辑。

统计口径：
  1. 取所选编码名下全部标注的起止边界，把 [0, 全文长度) 切成原子区间，
     每个原子区间的状态 = 覆盖它的编码 id 集合（升序元组，可能为空）；
  2. 跳过无编码区间；物理上首尾相接且状态相同的原子区间合并为一个
     状态区间（与共现 / 缺口"重叠或相邻即并"的口径一致），被无编码
     间隔分开的同状态区间不合并；
  3. 按文档顺序扫描状态区间序列，每对相邻状态区间计为一次有向转移，
     记录来源区间、目标区间与中间距离（目标起点 − 来源终点，即中间
     无编码文本的字符数，0 表示首尾相接）；
  4. 按（来源状态, 目标状态）聚合同类转移，返回转移次数与全部实例
     明细（含原文摘录），按次数降序、首次出现位置升序排列。
"""

from __future__ import annotations


def build_state_spans(
    content: str, codings: list[dict], code_ids: list[int]
) -> list[dict]:
    """把文档切成状态区间：跳过无编码区间，合并相邻同状态区间。

    每个状态区间：{"start", "end", "code_ids"}（覆盖编码 id 升序元组）。
    """
    selected = set(code_ids)
    relevant = [c for c in codings if c["code_id"] in selected]
    points = {0, len(content)}
    for c in relevant:
        points.add(c["start"])
        points.add(c["end"])
    bounds = sorted(points)
    spans: list[dict] = []
    for s, e in zip(bounds, bounds[1:]):
        if e <= s:
            continue
        state = tuple(
            sorted(
                {c["code_id"] for c in relevant if c["start"] <= s and c["end"] >= e}
            )
        )
        if not state:
            continue  # 跳过无编码区间
        if spans and spans[-1]["end"] == s and spans[-1]["code_ids"] == state:
            spans[-1]["end"] = e  # 相邻同状态：并入上一段
        else:
            spans.append({"start": s, "end": e, "code_ids": state})
    return spans


def compute_transitions(
    content: str, codings: list[dict], code_ids: list[int]
) -> dict:
    """统计相邻状态区间的有向转移，按（来源状态, 目标状态）聚合返回。

    返回 {"span_count", "transition_count", "transitions"}；每个转移条目
    含 from_code_ids / to_code_ids / count / min_distance / max_distance
    与全部实例（来源、目标区间及中间距离，附原文摘录）。
    """
    spans = build_state_spans(content, codings, code_ids)
    groups: dict[tuple[tuple[int, ...], tuple[int, ...]], dict] = {}
    for a, b in zip(spans, spans[1:]):
        key = (a["code_ids"], b["code_ids"])
        group = groups.setdefault(
            key,
            {
                "from_code_ids": list(key[0]),
                "to_code_ids": list(key[1]),
                "count": 0,
                "instances": [],
            },
        )
        group["count"] += 1
        group["instances"].append(
            {
                "from": {
                    "start": a["start"],
                    "end": a["end"],
                    "text": content[a["start"] : a["end"]],
                },
                "to": {
                    "start": b["start"],
                    "end": b["end"],
                    "text": content[b["start"] : b["end"]],
                },
                "distance": b["start"] - a["end"],
            }
        )
    transitions = sorted(
        groups.values(),
        key=lambda g: (
            -g["count"],
            g["instances"][0]["from"]["start"],
            g["from_code_ids"],
            g["to_code_ids"],
        ),
    )
    for g in transitions:
        distances = [i["distance"] for i in g["instances"]]
        g["min_distance"] = min(distances)
        g["max_distance"] = max(distances)
    return {
        "span_count": len(spans),
        "transition_count": sum(g["count"] for g in transitions),
        "transitions": transitions,
    }
