from dmwe_core.llm.json_util import parse_json_response


def test_parse_json_response_plain():
    d = parse_json_response('{"tasks":[]}', expected_root_key="tasks")
    assert d == {"tasks": []}


def test_parse_json_response_embedded():
    raw = '説明\n{"dependencies":[{"from":"a","to":"b"}]}\n'
    d = parse_json_response(raw, expected_root_key="dependencies")
    assert "dependencies" in d
