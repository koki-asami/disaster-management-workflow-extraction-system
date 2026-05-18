from __future__ import annotations

import re
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any

SCHEMA_VERSION = "2.0"

PHASE_TAXONOMY = [
    {"id": "preparedness", "label": "平時・事前対策", "order": 10},
    {"id": "initial_response", "label": "初動対応", "order": 20},
    {"id": "emergency_response", "label": "応急対応", "order": 30},
    {"id": "recovery", "label": "復旧・復興", "order": 40},
]

WORKSTREAM_TAXONOMY = [
    {"id": "command", "label": "体制・本部運営", "order": 10},
    {"id": "information", "label": "情報収集・伝達", "order": 20},
    {"id": "evacuation", "label": "避難・避難所", "order": 30},
    {"id": "rescue_medical", "label": "救助・救急・医療", "order": 40},
    {"id": "logistics", "label": "物資・輸送", "order": 50},
    {"id": "external_support", "label": "応援・受援", "order": 60},
    {"id": "vulnerable_people", "label": "要配慮者支援", "order": 70},
    {"id": "public_communication", "label": "住民広報・相談", "order": 80},
    {"id": "infrastructure", "label": "インフラ・ライフライン", "order": 90},
    {"id": "damage_assessment", "label": "被害調査", "order": 100},
    {"id": "sanitation", "label": "衛生・廃棄物・遺体対応", "order": 110},
    {"id": "recovery", "label": "生活再建・復旧復興", "order": 120},
    {"id": "other", "label": "その他", "order": 900},
]

ORG_LEVEL_TAXONOMY = [
    {"id": "prefecture", "label": "県", "order": 10},
    {"id": "municipality", "label": "市町村", "order": 20},
    {"id": "national", "label": "国", "order": 30},
    {"id": "related_organization", "label": "関係機関", "order": 40},
    {"id": "other", "label": "その他", "order": 900},
]

DEFAULT_TAXONOMIES: dict[str, list[dict[str, Any]]] = {
    "phases": PHASE_TAXONOMY,
    "workstreams": WORKSTREAM_TAXONOMY,
    "org_levels": ORG_LEVEL_TAXONOMY,
}

PHASE_IDS = {x["id"] for x in PHASE_TAXONOMY}
WORKSTREAM_IDS = {x["id"] for x in WORKSTREAM_TAXONOMY}
ORG_LEVEL_IDS = {x["id"] for x in ORG_LEVEL_TAXONOMY}

DEPENDENCY_TYPES = {
    "precondition",
    "information_flow",
    "handoff",
    "resource_flow",
    "decision",
}
CONFIDENCE_VALUES = {"high", "medium", "low"}
FINDING_TYPES = {
    "duplicate",
    "overlap",
    "granularity_mismatch",
    "naming_variation",
    "owner_ambiguity",
    "missing_dependency",
}

_WORKSTREAM_KEYWORDS = [
    (
        "command",
        ["本部", "体制", "配備", "参集", "動員", "指揮", "調整", "会議", "対策部", "災害対策"],
    ),
    (
        "information",
        ["情報", "収集", "伝達", "連絡", "報告", "通信", "共有", "通報", "警報", "気象", "観測"],
    ),
    ("evacuation", ["避難", "避難所", "退避", "誘導", "収容", "帰宅困難", "一時滞在"]),
    (
        "rescue_medical",
        ["救助", "救急", "医療", "救護", "搬送", "負傷", "要救助", "病院", "保健", "感染症"],
    ),
    ("logistics", ["物資", "備蓄", "食料", "飲料水", "給水", "輸送", "配送", "調達", "燃料", "資機材"]),
    ("external_support", ["応援", "受援", "派遣", "要請", "協定", "自衛隊", "広域", "ボランティア"]),
    ("vulnerable_people", ["要配慮", "要援護", "高齢", "障害", "福祉", "乳幼児", "妊産婦", "外国人"]),
    ("public_communication", ["広報", "住民", "県民", "相談", "問い合わせ", "周知", "発表", "報道", "デマ"]),
    (
        "infrastructure",
        ["道路", "河川", "橋", "交通", "電力", "ガス", "水道", "下水", "通信施設", "ライフライン", "土砂"],
    ),
    ("damage_assessment", ["被害", "調査", "罹災", "り災", "住宅", "応急危険度", "被災状況"]),
    ("sanitation", ["衛生", "廃棄物", "ごみ", "し尿", "防疫", "遺体", "埋火葬", "行方不明"]),
    ("recovery", ["復旧", "復興", "再開", "生活再建", "義援金", "見舞金", "仮設住宅"]),
]

_ACTION_KEYWORDS = [
    ("collect", ["収集", "把握", "確認", "調査", "点検", "監視"]),
    ("share", ["共有", "伝達", "連絡", "報告", "通知", "周知", "発表", "広報"]),
    ("decide", ["判断", "決定", "指定", "指示", "命令"]),
    ("request", ["要請", "依頼", "派遣要請", "応援要請"]),
    ("open", ["開設", "設置", "立上げ", "立ち上げ"]),
    ("operate", ["運営", "実施", "対応", "管理", "調整"]),
    ("transport", ["輸送", "搬送", "配送", "移送"]),
    ("inspect", ["点検", "調査", "確認", "判定"]),
]


def clean_text(value: Any) -> str:
    return str(value or "").replace("\u3000", " ").strip()


def canonicalize_text(value: Any) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"^第[0-9０-９一二三四五六七八九十百千]+[章節款項]\s*", "", text)
    text = text.replace("り災", "罹災")
    text = re.sub(r"[、，・／/（）()「」『』\[\]\s]", "", text)
    text = re.sub(r"(に関する|のための|について)$", "", text)
    text = re.sub(r"(を)?(する|行う|行なう|実施する|実施|対応する|対応|業務)$", "", text)
    text = re.sub(r"[のをにへがと]", "", text)
    return text


def _task_search_text(task: dict[str, Any]) -> str:
    parts: list[str] = [
        clean_text(task.get("name")),
        clean_text(task.get("canonical_name")),
        clean_text(task.get("description")),
        clean_text(task.get("category")),
        clean_text(task.get("department")),
    ]
    snippets = task.get("context_snippets") or []
    if isinstance(snippets, str):
        snippets = [snippets]
    parts.extend(clean_text(x) for x in snippets[:3])
    return " ".join(x for x in parts if x)


def infer_phase(task: dict[str, Any]) -> str:
    value = clean_text(task.get("phase"))
    if value in PHASE_IDS:
        return value
    text = _task_search_text(task)
    if any(k in text for k in ["復旧", "復興", "生活再建", "義援金", "罹災", "り災", "仮設住宅"]):
        return "recovery"
    if any(k in text for k in ["平時", "事前", "予防", "備蓄", "訓練", "計画", "準備", "整備"]):
        return "preparedness"
    if any(k in text for k in ["初動", "直後", "発災", "参集", "配備", "本部設置", "警戒"]):
        return "initial_response"
    return "emergency_response"


def infer_workstream(task: dict[str, Any]) -> str:
    value = clean_text(task.get("workstream"))
    if value in WORKSTREAM_IDS:
        return value
    text = _task_search_text(task)
    scored = []
    for stream_id, keywords in _WORKSTREAM_KEYWORDS:
        score = sum(1 for keyword in keywords if keyword in text)
        if score:
            scored.append((score, stream_id))
    if not scored:
        return "other"
    scored.sort(key=lambda item: (-item[0], next(x["order"] for x in WORKSTREAM_TAXONOMY if x["id"] == item[1])))
    return scored[0][1]


def infer_action(task: dict[str, Any]) -> str:
    value = clean_text(task.get("action"))
    if value:
        return value
    text = _task_search_text(task)
    for action, keywords in _ACTION_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return action
    return "operate"


def infer_object(task: dict[str, Any]) -> str:
    value = clean_text(task.get("object"))
    if value:
        return value
    name = clean_text(task.get("name"))
    text = _task_search_text(task)
    candidates = [
        "被害情報",
        "避難者",
        "避難所",
        "物資",
        "道路",
        "医療救護",
        "住民",
        "要配慮者",
        "ライフライン",
        "災害対策本部",
        "遺体",
        "廃棄物",
    ]
    for candidate in candidates:
        if candidate in text:
            return candidate
    stripped = re.sub(r"(の)?(収集|伝達|連絡|報告|共有|確認|把握|判断|決定|設置|開設|運営|実施|要請|調整|確保|支援|救助|搬送|調査|点検|復旧|対応)(を)?(する|行う|行なう)?$", "", name)
    return stripped.strip(" のをにへ") or name or "対象未特定"


def normalize_actor(raw_actor: Any = None, fallback_department: Any = None) -> dict[str, str]:
    actor = raw_actor if isinstance(raw_actor, dict) else {}
    org_name_raw = clean_text(actor.get("org_name_raw")) or clean_text(fallback_department)
    org_name_normalized = clean_text(actor.get("org_name_normalized"))
    department_raw = clean_text(actor.get("department_raw")) or clean_text(fallback_department)
    department_normalized = clean_text(actor.get("department_normalized"))
    org_level = clean_text(actor.get("org_level"))

    raw = org_name_raw or department_raw
    if org_level not in ORG_LEVEL_IDS:
        if re.search(r"奈良県|^県($|庁|警|土木|保健|防災|危機|消防|福祉|医療|教育|農林|地域|災害|水道|道路|河川)", raw):
            org_level = "prefecture"
        elif re.search(r"市町村|市町|町村|奈良市|大和郡山市|天理市|橿原市|桜井市|五條市|御所市|生駒市|香芝市|葛城市|宇陀市|村$|町$|市$", raw):
            org_level = "municipality"
        elif re.search(r"^国|内閣府|気象庁|国土交通省|総務省|厚生労働省|農林水産省|経済産業省|自衛隊", raw):
            org_level = "national"
        elif re.search(r"警察|消防|医療|病院|ライフライン|電力|ガス|通信|交通|鉄道|道路管理者|関係機関|防災関係機関", raw):
            org_level = "related_organization"
        else:
            org_level = "other"

    if not org_name_normalized:
        org_name_normalized = {
            "prefecture": "県",
            "municipality": "市町村",
            "national": "国",
            "related_organization": "関係機関",
            "other": "その他",
        }[org_level]

    if not department_normalized:
        department_normalized = department_raw
        if org_level == "prefecture":
            department_normalized = re.sub(r"^(奈良県|県庁|県)[・･\s-]*", "", department_normalized).strip()
        elif org_level == "municipality":
            department_normalized = re.sub(r"^(市町村|市町|町村)[・･\s-]*", "", department_normalized).strip()
            department_normalized = re.sub(r"^[^・･\s-]+[市町村][・･\s-]*", "", department_normalized).strip()
        elif org_level == "national":
            department_normalized = re.sub(r"^国[・･\s-]*", "", department_normalized).strip()
        if not department_normalized:
            department_normalized = "担当部署不明"

    return {
        "org_level": org_level,
        "org_name_raw": org_name_raw,
        "org_name_normalized": org_name_normalized,
        "department_raw": department_raw,
        "department_normalized": department_normalized,
    }


def _normalize_aliases(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [clean_text(x) for x in value if clean_text(x)]
    text = clean_text(value)
    return [text] if text else []


def normalize_task_v2(task: dict[str, Any]) -> dict[str, Any]:
    out = dict(task)
    name = clean_text(out.get("name")) or clean_text(out.get("canonical_name")) or clean_text(out.get("id")) or "未命名タスク"
    out["name"] = name
    out.setdefault("department", "")
    out.setdefault("description", "")
    out.setdefault("category", "")
    out.setdefault("source_pdf", None)
    out.setdefault("page_range", None)
    snippets = out.get("context_snippets") or []
    out["context_snippets"] = [snippets] if isinstance(snippets, str) else list(snippets)
    canonical_name = clean_text(out.get("canonical_name")) or name
    out["canonical_name"] = canonical_name
    out["phase"] = infer_phase(out)
    out["workstream"] = infer_workstream(out)
    out["actor"] = normalize_actor(out.get("actor"), out.get("department"))
    out["action"] = infer_action(out)
    out["object"] = infer_object(out)
    out["scope"] = clean_text(out.get("scope")) or clean_text(out.get("description")) or name
    out["aliases"] = _normalize_aliases(out.get("aliases"))
    duplicate_key = canonicalize_text(canonical_name) or canonicalize_text(name)
    owner_key = f'{out["actor"]["org_level"]}:{canonicalize_text(out["actor"]["department_normalized"])}'
    mece_axis = f'{out["phase"]}:{out["workstream"]}'
    existing_keys = out.get("analysis_keys") if isinstance(out.get("analysis_keys"), dict) else {}
    out["analysis_keys"] = {
        "duplicate_key": clean_text(existing_keys.get("duplicate_key")) or f"{duplicate_key}:{owner_key}",
        "mece_axis": clean_text(existing_keys.get("mece_axis")) or mece_axis,
        "owner_key": clean_text(existing_keys.get("owner_key")) or owner_key,
    }
    return out


def normalize_dependency_v2(dep: dict[str, Any]) -> dict[str, Any]:
    out = dict(dep)
    dep_type = clean_text(out.get("dependency_type"))
    if dep_type not in DEPENDENCY_TYPES:
        reason = clean_text(out.get("reason"))
        if any(k in reason for k in ["判断", "決定", "指示"]):
            dep_type = "decision"
        elif any(k in reason for k in ["情報", "報告", "共有", "伝達"]):
            dep_type = "information_flow"
        elif any(k in reason for k in ["物資", "資源", "輸送", "燃料"]):
            dep_type = "resource_flow"
        elif any(k in reason for k in ["引継", "引き継", "移管", "連携"]):
            dep_type = "handoff"
        else:
            dep_type = "precondition"
    confidence = clean_text(out.get("confidence"))
    out["dependency_type"] = dep_type
    out["confidence"] = confidence if confidence in CONFIDENCE_VALUES else "medium"
    out.setdefault("reason", "")
    return out


def enrich_workflow_v2(
    tasks: list[dict[str, Any]],
    dependencies: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return [normalize_task_v2(t) for t in tasks], [normalize_dependency_v2(d) for d in dependencies]


def workflow_root_extras() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "taxonomies": DEFAULT_TAXONOMIES,
        "quality_findings": [],
    }


def _tokens(value: Any) -> set[str]:
    text = clean_text(value)
    tokens = {token.strip() for token in re.split(r"[、，・／/（）()「」『』\s]+", text) if len(token.strip()) >= 2}
    if not tokens:
        canon = canonicalize_text(text)
        return {canon} if canon else set()
    return tokens


def _task_ids(items: list[dict[str, Any]]) -> list[str]:
    return [str(x.get("id")) for x in items if x.get("id")]


def diagnose_workflow_quality(
    tasks: list[dict[str, Any]],
    dependencies: list[dict[str, Any]] | None = None,
    taxonomies: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    normalized_tasks, normalized_deps = enrich_workflow_v2(tasks, dependencies or [])
    findings: list[dict[str, Any]] = []

    by_duplicate_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_name_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for task in normalized_tasks:
        by_duplicate_key[task["analysis_keys"]["duplicate_key"]].append(task)
        by_name_key[canonicalize_text(task.get("canonical_name") or task.get("name"))].append(task)

    for key, group in by_duplicate_key.items():
        if key and len(group) > 1:
            findings.append(
                {
                    "type": "duplicate",
                    "severity": "high",
                    "task_ids": _task_ids(group),
                    "summary": "同一内容とみなせるタスクが重複しています。",
                    "evidence": [f"{t.get('id')}: {t.get('name')}" for t in group],
                    "suggested_fix": "代表タスクへ統合し、差分は scope または evidence に残してください。",
                }
            )

    for key, group in by_name_key.items():
        names = {clean_text(t.get("name")) for t in group if clean_text(t.get("name"))}
        aliases = {alias for t in group for alias in t.get("aliases", [])}
        if key and len(group) > 1 and len(names | aliases) > 1:
            findings.append(
                {
                    "type": "naming_variation",
                    "severity": "medium",
                    "task_ids": _task_ids(group),
                    "summary": "同じ標準タスク名に対して複数の表記が使われています。",
                    "evidence": sorted(names | aliases)[:8],
                    "suggested_fix": "canonical_name を統一し、原文表記は aliases に寄せてください。",
                }
            )

    max_overlap_findings = 12
    for i, left in enumerate(normalized_tasks):
        if len([f for f in findings if f["type"] == "overlap"]) >= max_overlap_findings:
            break
        left_id = str(left.get("id") or "")
        for right in normalized_tasks[i + 1 :]:
            right_id = str(right.get("id") or "")
            if not left_id or not right_id:
                continue
            if left["phase"] != right["phase"] or left["workstream"] != right["workstream"]:
                continue
            if left["analysis_keys"]["duplicate_key"] == right["analysis_keys"]["duplicate_key"]:
                continue
            left_scope = clean_text(left.get("scope") or left.get("description") or left.get("name"))
            right_scope = clean_text(right.get("scope") or right.get("description") or right.get("name"))
            left_tokens = _tokens(left_scope)
            right_tokens = _tokens(right_scope)
            if not left_tokens or not right_tokens:
                continue
            overlap = len(left_tokens & right_tokens) / min(len(left_tokens), len(right_tokens))
            similarity = SequenceMatcher(None, canonicalize_text(left_scope), canonicalize_text(right_scope)).ratio()
            if overlap >= 0.5 or similarity >= 0.72:
                findings.append(
                    {
                        "type": "overlap",
                        "severity": "medium",
                        "task_ids": [left_id, right_id],
                        "summary": "同一フェーズ・業務テーマ内で範囲が部分的に重なっている可能性があります。",
                        "evidence": [
                            f"{left_id}: {left.get('name')} / scope={left_scope}",
                            f"{right_id}: {right.get('name')} / scope={right_scope}",
                        ],
                        "suggested_fix": "scope を分割または明確化し、片方が包含関係なら粒度を揃えてください。",
                    }
                )
                break

    for task in normalized_tasks:
        actor = task.get("actor") or {}
        department = clean_text(actor.get("department_normalized"))
        if actor.get("org_level") == "other" or department in {"", "担当部署不明", "不明"}:
            findings.append(
                {
                    "type": "owner_ambiguity",
                    "severity": "low",
                    "task_ids": [str(task.get("id"))],
                    "summary": "担当主体の組織階層または部署が曖昧です。",
                    "evidence": [f"{task.get('id')}: department={task.get('department') or ''}"],
                    "suggested_fix": "actor.org_level と department_normalized を原文根拠に基づいて補完してください。",
                }
            )

    dep_pairs = {
        (str(dep.get("from") or dep.get("source") or ""), str(dep.get("to") or dep.get("target") or ""))
        for dep in normalized_deps
    }
    task_by_id = {str(task.get("id")): task for task in normalized_tasks if task.get("id")}
    for from_id, to_id in dep_pairs:
        if from_id and to_id and from_id == to_id and from_id in task_by_id:
            findings.append(
                {
                    "type": "granularity_mismatch",
                    "severity": "high",
                    "task_ids": [from_id],
                    "summary": "同一タスクを自己依存として扱っています。",
                    "evidence": [f"{from_id} -> {to_id}"],
                    "suggested_fix": "自己依存を削除し、必要ならタスクを前後工程へ分割してください。",
                }
            )

    return [finding for finding in findings if finding["type"] in FINDING_TYPES]
