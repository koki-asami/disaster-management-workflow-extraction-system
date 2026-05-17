from dmwe_core.workflow_v2 import (
    diagnose_workflow_quality,
    enrich_workflow_v2,
    normalize_actor,
    workflow_root_extras,
)


def test_workflow_root_extras_are_v2_defaults():
    extras = workflow_root_extras()

    assert extras["schema_version"] == "2.0"
    assert extras["quality_findings"] == []
    assert [x["id"] for x in extras["taxonomies"]["org_levels"]] == [
        "prefecture",
        "municipality",
        "national",
        "related_organization",
        "other",
    ]


def test_enrich_workflow_v2_fills_v1_task_fields_and_dependency_metadata():
    tasks, dependencies = enrich_workflow_v2(
        [
            {
                "id": "t001",
                "name": "奈良県災害対策本部の設置",
                "department": "奈良県 防災統括室",
                "description": "発災後、災害対策本部を設置する。",
                "context_snippets": ["災害対策本部を設置する。"],
            }
        ],
        [{"from": "t001", "to": "t002", "reason": "本部の判断後に避難情報を発表する"}],
    )

    task = tasks[0]
    assert task["canonical_name"] == "奈良県災害対策本部の設置"
    assert task["phase"] == "initial_response"
    assert task["workstream"] == "command"
    assert task["actor"]["org_level"] == "prefecture"
    assert task["actor"]["org_name_normalized"] == "県"
    assert task["analysis_keys"]["mece_axis"] == "initial_response:command"
    assert dependencies[0]["dependency_type"] == "decision"
    assert dependencies[0]["confidence"] == "medium"


def test_normalize_actor_unifies_prefecture_and_municipality_labels():
    pref = normalize_actor(fallback_department="県庁 危機管理課")
    city = normalize_actor(fallback_department="奈良市 防災課")

    assert pref["org_level"] == "prefecture"
    assert pref["org_name_normalized"] == "県"
    assert city["org_level"] == "municipality"
    assert city["org_name_normalized"] == "市町村"


def test_diagnose_workflow_quality_detects_duplicates_and_naming_variation():
    tasks = [
        {
            "id": "t001",
            "name": "避難所開設",
            "canonical_name": "避難所の開設",
            "phase": "emergency_response",
            "workstream": "evacuation",
            "department": "市町村 防災課",
            "scope": "指定避難所を開設する",
        },
        {
            "id": "t002",
            "name": "避難所の開設",
            "canonical_name": "避難所の開設",
            "phase": "emergency_response",
            "workstream": "evacuation",
            "department": "市町村 防災課",
            "scope": "指定避難所を開設する",
            "aliases": ["避難所開設"],
        },
    ]

    findings = diagnose_workflow_quality(tasks, [])
    types = {finding["type"] for finding in findings}

    assert "duplicate" in types
    assert "naming_variation" in types
    assert any(set(finding["task_ids"]) == {"t001", "t002"} for finding in findings)
