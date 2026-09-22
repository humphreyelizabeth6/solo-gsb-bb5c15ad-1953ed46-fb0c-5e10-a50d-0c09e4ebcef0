"""标注包导入：解析「导出 JSON」标注包并给出导入预览 / 执行计划。

流程（全部为纯函数，不触碰数据库）：
  1. parse_package：校验标注包结构，抽取来源文档信息与标注条目；
  2. build_import_preview：
     - 按编码**名称**映射当前编码本（导出文件中的 code_id 一律忽略）；
     - 校验**文档内容指纹**（sha256；旧版导出无指纹时退化为文档长度
       + 逐条原文切片比对）；
     - 校验每条标注的**区间边界**（整数、start < end、不超出文本长度）
       与**原文切片**是否与当前文档一致；
     - 识别**重复项**（与既有标注完全相同 / 标注包内部重复）；
     - 分类为 created（新增）/ skipped（跳过）/ unknown（未知编码）/
       invalid（非法条目），并对新增项预计算与既有标注的冲突明细。

任何阻断项（指纹不一致、非法区间/切片、未知编码）都会令 can_import=False；
调用方在单事务中只写入 created 项，失败即整体回滚。
"""

from __future__ import annotations

import hashlib

from .conflicts import find_conflicts

FINGERPRINT_ALGO = "sha256"
MAX_IMPORT_ITEMS = 5000
SNIPPET_LIMIT = 50

CONFLICT_TYPE_LABELS = {
    "same_code": "同名重叠",
    "nested_container": "嵌套（被外层包含）",
    "nested_contained": "嵌套（包含内层）",
}


class PackageFormatError(ValueError):
    """标注包结构无法解析（不是合法的导出 JSON）。"""


def content_fingerprint(content: str) -> str:
    """文档内容指纹：sha256(UTF-8 字节) 的十六进制摘要。"""
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return f"{FINGERPRINT_ALGO}:{digest}"


def _snippet(text: str, limit: int = SNIPPET_LIMIT) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def parse_package(payload: object) -> tuple[dict, list[dict]]:
    """解析标注包，返回 (来源文档 dict, 标准化标注条目列表)。

    仅做结构校验；区间合法性、指纹、编码映射等由 build_import_preview 处理。
    """
    if not isinstance(payload, dict):
        raise PackageFormatError("不是有效的 JSON 对象，请粘贴或选择导出的 JSON 文件")
    src_doc = payload.get("document")
    if not isinstance(src_doc, dict):
        raise PackageFormatError(
            "缺少 document 字段，请使用「导出 JSON」生成的标注包"
        )
    if not any(
        isinstance(src_doc.get(k), str) for k in ("content", "fingerprint")
    ) and not isinstance(src_doc.get("length"), int):
        raise PackageFormatError(
            "document 缺少可识别的来源文档信息（content / length / fingerprint），"
            "请使用「导出 JSON」生成的标注包"
        )
    raw_items = payload.get("codings")
    if not isinstance(raw_items, list):
        raise PackageFormatError(
            "缺少 codings 列表，请使用「导出 JSON」生成的标注包"
        )
    if len(raw_items) > MAX_IMPORT_ITEMS:
        raise PackageFormatError(
            f"标注数量 {len(raw_items)} 超过单次导入上限 {MAX_IMPORT_ITEMS} 条"
        )

    items: list[dict] = []
    for i, raw in enumerate(raw_items):
        where = f"第 {i + 1} 条标注"
        if not isinstance(raw, dict):
            raise PackageFormatError(f"{where}不是 JSON 对象")
        # 以编码名称为映射键；兼容 code / code_name 两种写法
        name = raw.get("code")
        if name is None:
            name = raw.get("code_name")
        if not isinstance(name, str) or not name.strip():
            raise PackageFormatError(f"{where}缺少编码名称（code）")
        start, end = raw.get("start"), raw.get("end")
        # bool 是 int 的子类，需显式排除
        if (
            isinstance(start, bool)
            or isinstance(end, bool)
            or not isinstance(start, int)
            or not isinstance(end, int)
        ):
            raise PackageFormatError(f"{where}的 start / end 必须是整数")
        text = raw.get("text")
        items.append(
            {
                "index": i,
                "code_name": name.strip(),
                "start": start,
                "end": end,
                "text": text if isinstance(text, str) else None,
            }
        )
    return src_doc, items


def build_import_preview(
    document_id: int,
    content: str,
    src_doc: dict,
    items: list[dict],
    code_rows: list[dict],
    existing: list[dict],
) -> dict:
    """按当前文档 / 编码本 / 既有标注对标注包条目分类，生成预览报告。"""
    length = len(content)
    expected_fp = content_fingerprint(content)
    declared_fp = src_doc.get("fingerprint")
    fp_mode = isinstance(declared_fp, str) and declared_fp.startswith(
        f"{FINGERPRINT_ALGO}:"
    )
    if fp_mode:
        fp_match = declared_fp == expected_fp
        fp_note = None
    else:
        # 旧版导出无指纹：退化为文档长度 + 逐条原文切片校验
        declared_len = src_doc.get("length")
        fp_match = not isinstance(declared_len, int) or declared_len == length
        fp_note = (
            "旧版导出文件不含内容指纹，已按文档长度与逐条原文切片校验"
        )

    code_by_name = {c["name"]: c for c in code_rows}
    id_by_key = {
        (c["code_id"], c["start"], c["end"]): c["id"] for c in existing
    }
    seen_keys: set[tuple[int, int, int]] = set()
    used_names: set[str] = set()

    created: list[dict] = []
    skipped: list[dict] = []
    unknown: list[dict] = []
    invalid: list[dict] = []
    conflict_item_count = 0

    for it in items:
        name, s, e = it["code_name"], it["start"], it["end"]
        base = {
            "index": it["index"],
            "code_name": name,
            "start": s,
            "end": e,
        }

        # 1) 区间边界
        if s < 0:
            invalid.append({**base, "reason": "range", "detail": "起始位置不能为负"})
            continue
        if e <= s:
            invalid.append(
                {**base, "reason": "range", "detail": "区间不合法：end 必须大于 start"}
            )
            continue
        if e > length:
            invalid.append(
                {
                    **base,
                    "reason": "range",
                    "detail": f"区间超出文本长度（当前文档 {length} 字）",
                }
            )
            continue

        actual_text = content[s:e]

        # 2) 原文切片（指纹不一致时尤其重要，可逐条发现错位）
        if it["text"] is not None and it["text"] != actual_text:
            invalid.append(
                {
                    **base,
                    "reason": "text_mismatch",
                    "detail": "原文切片与当前文档不一致，区间可能已错位",
                    "package_text": _snippet(it["text"]),
                    "actual_text": _snippet(actual_text),
                }
            )
            continue

        # 3) 编码名称映射
        code = code_by_name.get(name)
        used_names.add(name)
        if code is None:
            unknown.append({**base, "text": actual_text})
            continue

        # 4) 重复项：与既有标注完全相同 / 标注包内部重复
        key = (code["id"], s, e)
        if key in id_by_key:
            skipped.append(
                {
                    **base,
                    "code_id": code["id"],
                    "color": code["color"],
                    "text": actual_text,
                    "reason": "existing",
                    "existing_id": id_by_key[key],
                }
            )
            continue
        if key in seen_keys:
            skipped.append(
                {
                    **base,
                    "code_id": code["id"],
                    "color": code["color"],
                    "text": actual_text,
                    "reason": "duplicate",
                }
            )
            continue
        seen_keys.add(key)

        # 5) 新增项：预计算与既有标注的冲突（仅提示，导入按 keep 共存）
        conflicts = [
            {
                "type": c["type"],
                "type_label": CONFLICT_TYPE_LABELS[c["type"]],
                "code_id": c["coding"]["code_id"],
                "code_name": c["coding"]["code_name"],
                "start": c["coding"]["start"],
                "end": c["coding"]["end"],
            }
            for c in find_conflicts(existing, code["id"], s, e)
        ]
        if conflicts:
            conflict_item_count += 1
        created.append(
            {
                **base,
                "code_id": code["id"],
                "color": code["color"],
                "text": actual_text,
                "conflicts": conflicts,
            }
        )

    unknown_names = list(dict.fromkeys(u["code_name"] for u in unknown))
    mapped_codes = [
        {"code_id": code_by_name[n]["id"], "name": n, "color": code_by_name[n]["color"]}
        for n in dict.fromkeys(it["code_name"] for it in items)
        if n in code_by_name
    ]

    blockers: list[str] = []
    if not fp_match:
        blockers.append(
            "文档内容指纹不一致：标注包来自内容不同的文档，不能导入当前文档"
            if fp_mode
            else "文档长度与标注包不一致：标注包可能来自其它文档"
        )
    if invalid:
        blockers.append(f"存在 {len(invalid)} 条非法标注（区间越界或原文切片不匹配）")
    if unknown:
        blockers.append(
            f"存在 {len(unknown)} 条未知编码标注（{', '.join(unknown_names)}），"
            "请先在编码本中新建同名编码"
        )

    return {
        "document_id": document_id,
        "source": {
            "title": src_doc.get("title") if isinstance(src_doc.get("title"), str) else None,
            "length": src_doc.get("length") if isinstance(src_doc.get("length"), int) else None,
            "fingerprint": declared_fp if fp_mode else None,
        },
        "fingerprint_check": {
            "mode": "fingerprint" if fp_mode else "legacy",
            "expected": expected_fp,
            "declared": declared_fp if fp_mode else None,
            "match": fp_match,
            "note": fp_note,
        },
        "mapped_codes": mapped_codes,
        "unknown_codes": unknown_names,
        "summary": {
            "total": len(items),
            "created": len(created),
            "skipped": len(skipped),
            "unknown": len(unknown),
            "invalid": len(invalid),
            "conflicts": conflict_item_count,
        },
        "can_import": not blockers,
        "blockers": blockers,
        "created": created,
        "skipped": skipped,
        "unknown": unknown,
        "invalid": invalid,
    }
