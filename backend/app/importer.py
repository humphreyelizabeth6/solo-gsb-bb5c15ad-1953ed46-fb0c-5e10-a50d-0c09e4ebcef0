"""标注包导入：解析导出 JSON、校验与分类的纯函数。

标注包即 GET /api/documents/{id}/export 的导出格式：
  {
    "document": {"id", "title", "content", "length", "content_sha256"},
    "codes": [{"id", "name", "color"}],
    "codings": [{"id", "code_id", "code", "color", "start", "end", "text"}],
    "exported_at": "..."
  }

导入按**编码名称**映射到当前编码本，并依次校验：
  - 文档内容指纹（content_sha256，缺失时退化为全文比对）；
  - 区间边界（0 <= start < end <= 全文长度）；
  - 重复项（与既有标注或包内前序条目完全相同）。

每条合法标注被分类为：新增（to_create）、跳过（to_skip）、未知编码
（unknown_codes）、冲突（conflicts，与既有或本批新增标注同名重叠/嵌套）。
结构非法、指纹不匹配或存在非法区间属于硬校验失败：禁止导入、不落库。
"""

from __future__ import annotations

import hashlib
from typing import Any

from .conflicts import find_conflicts

# 单个标注包的最大条目数，防止超大包拖垮导入事务
MAX_PACKAGE_ITEMS = 5000


class PackageError(ValueError):
    """标注包结构非法。"""


def content_fingerprint(content: str) -> str:
    """文档内容指纹：UTF-8 编码的 SHA-256 十六进制串。"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _is_int(value: Any) -> bool:
    # JSON 的 true/false 在 Python 中是 int 子类，区间字段需排除
    return isinstance(value, int) and not isinstance(value, bool)


def parse_package(payload: Any) -> dict:
    """校验标注包结构并规范化条目，结构非法抛 PackageError。

    返回 {"document": dict, "items": [{"index", "code", "start", "end"}]}；
    条目缺少编码名称时按包内 codes 列表的 id → name 回退解析。
    """
    if not isinstance(payload, dict):
        raise PackageError("标注包必须是 JSON 对象")
    document = payload.get("document")
    if document is not None and not isinstance(document, dict):
        raise PackageError("document 字段必须是对象")
    codes = payload.get("codes")
    if codes is not None and not isinstance(codes, list):
        raise PackageError("codes 字段必须是数组")
    codings = payload.get("codings")
    if not isinstance(codings, list):
        raise PackageError("标注包缺少 codings 数组")
    if len(codings) > MAX_PACKAGE_ITEMS:
        raise PackageError(f"标注包条目过多（{len(codings)} > {MAX_PACKAGE_ITEMS}）")

    code_names: dict[int, str] = {}
    for c in codes or []:
        if (
            isinstance(c, dict)
            and _is_int(c.get("id"))
            and isinstance(c.get("name"), str)
        ):
            code_names[c["id"]] = c["name"]

    items: list[dict] = []
    for i, raw in enumerate(codings):
        if not isinstance(raw, dict):
            raise PackageError(f"第 {i} 条标注必须是对象")
        start, end = raw.get("start"), raw.get("end")
        if not (_is_int(start) and _is_int(end)):
            raise PackageError(f"第 {i} 条标注缺少合法的 start/end 整数")
        name = raw.get("code")
        if not (isinstance(name, str) and name.strip()):
            cid = raw.get("code_id")
            name = code_names.get(cid) if _is_int(cid) else None
        if not (isinstance(name, str) and name.strip()):
            raise PackageError(f"第 {i} 条标注缺少编码名称")
        items.append({"index": i, "code": name.strip(), "start": start, "end": end})
    return {"document": document or {}, "items": items}


def fingerprint_error(pkg_doc: dict, content: str) -> str | None:
    """校验文档内容指纹，返回错误消息（None 表示通过）。

    优先比对 content_sha256；缺失时退化为全文比对；两者皆无则无法校验。
    """
    provided = pkg_doc.get("content_sha256")
    if isinstance(provided, str) and provided:
        if provided.lower() != content_fingerprint(content):
            return "文档内容指纹不匹配：标注包来自其它文档，或文档在导出后被修改"
        return None
    pkg_content = pkg_doc.get("content")
    if isinstance(pkg_content, str):
        if pkg_content != content:
            return "文档内容不一致：标注包来自其它文档，或文档在导出后被修改"
        return None
    return "标注包缺少文档内容指纹（content_sha256 或 content），无法校验来源文档"


def _invalid_reason(item: dict, length: int) -> str | None:
    if item["start"] < 0:
        return "start 小于 0"
    if item["end"] <= item["start"]:
        return "end 必须大于 start"
    if item["end"] > length:
        return "区间超出文本长度"
    return None


def plan_import(
    document_id: int,
    doc: dict,
    codes: list[dict],
    existing: list[dict],
    package: dict,
) -> dict:
    """把规范化条目分类为 新增 / 跳过 / 未知编码 / 冲突，并汇总硬校验错误。

    冲突检测覆盖既有标注与本批已计划新增的条目，保证导入结果不引入新冲突；
    返回的 errors 非空即硬校验失败（指纹不匹配或存在非法区间），禁止导入。
    """
    content = doc["content"]
    length = len(content)
    code_by_name = {c["name"]: c for c in codes}

    invalid: list[dict] = []
    valid_items: list[dict] = []
    for it in package["items"]:
        reason = _invalid_reason(it, length)
        if reason is None:
            valid_items.append(it)
        else:
            invalid.append({**it, "reason": reason})

    # (code_id, start, end) -> ("existing", 既有标注 id) | ("package", 包内序号)
    seen: dict[tuple[int, int, int], tuple[str, int]] = {
        (c["code_id"], c["start"], c["end"]): ("existing", c["id"]) for c in existing
    }
    planned: list[dict] = []  # 已计划新增的条目，参与后续条目的冲突检测
    to_create: list[dict] = []
    to_skip: list[dict] = []
    conflicts: list[dict] = []
    unknown: dict[str, list[dict]] = {}

    for it in valid_items:
        code = code_by_name.get(it["code"])
        text = content[it["start"] : it["end"]]
        base = {**it, "text": text}
        if code is None:
            unknown.setdefault(it["code"], []).append(base)
            continue
        code_id = code["id"]
        key = (code_id, it["start"], it["end"])
        if key in seen:
            source, ref = seen[key]
            to_skip.append(
                {
                    **base,
                    "code_id": code_id,
                    "existing_id": ref if source == "existing" else None,
                    "package_index": ref if source == "package" else None,
                }
            )
            continue
        foes = find_conflicts(existing + planned, code_id, it["start"], it["end"])
        if foes:
            conflicts.append(
                {
                    **base,
                    "code_id": code_id,
                    "with": [
                        {"type": f["type"], "coding": f["coding"]} for f in foes
                    ],
                }
            )
            continue
        planned.append(
            {
                "id": None,
                "code_id": code_id,
                "code_name": code["name"],
                "code_color": code["color"],
                "start": it["start"],
                "end": it["end"],
                "package_index": it["index"],
            }
        )
        seen[key] = ("package", it["index"])
        to_create.append({**base, "code_id": code_id})

    fp_error = fingerprint_error(package["document"], content)
    errors: list[str] = []
    if fp_error:
        errors.append(fp_error)
    if invalid:
        errors.append(f"存在 {len(invalid)} 个非法区间，导入已被阻止")

    unknown_codes = [
        {"name": name, "count": len(group), "items": group}
        for name, group in sorted(unknown.items())
    ]
    provided = package["document"].get("content_sha256")
    return {
        "document_id": document_id,
        "fingerprint": {
            "matched": fp_error is None,
            "expected_sha256": content_fingerprint(content),
            "provided_sha256": provided if isinstance(provided, str) else None,
        },
        "errors": errors,
        "summary": {
            "total": len(package["items"]),
            "to_create": len(to_create),
            "to_skip": len(to_skip),
            "unknown": sum(g["count"] for g in unknown_codes),
            "conflict": len(conflicts),
            "invalid": len(invalid),
        },
        "invalid": invalid,
        "to_create": to_create,
        "to_skip": to_skip,
        "unknown_codes": unknown_codes,
        "conflicts": conflicts,
    }
