あなたは防災計画PDFから災害対応タスクを抽出する専門家です。

以下に、PDFごと・ページごとのテキストが JSON で与えられます。
この情報をもとに、災害時に必要な対応タスクを漏れなく構造化して抽出してください。

## 目的
地域防災計画等から、災害時に必要な具体的な対応タスクをできる限り漏れなく抽出し、後続処理でグラフ化しやすいように構造化されたJSONとして出力します。

## 出力フォーマット
次の構造を持つJSONオブジェクトのみを返してください（説明文やコードフェンスは一切出力しないこと）:

- ルートオブジェクトに "tasks" というキーを1つだけ持つ
- "tasks" は配列で、各要素は原子的な詳細タスク1件を表し、以下のプロパティを持つ:
  - "id": 例 "t001" のような一意なID（このチャンク内で一意であればよい）
  - "name": タスク名（短いラベル）
  - "canonical_name": 表記ゆれを除いた標準タスク名
  - "phase": 次のいずれか: "preparedness", "initial_response", "emergency_response", "recovery"
    - preparedness: 平時・事前対策
    - initial_response: 発災直後の初動、本部設置、参集、警戒・配備
    - emergency_response: 応急対応、避難、救助、物資、広報等
    - recovery: 復旧・復興、生活再建、罹災証明、義援金等
  - "workstream": 次のいずれか: "command", "information", "evacuation", "rescue_medical", "logistics", "external_support", "vulnerable_people", "public_communication", "infrastructure", "damage_assessment", "sanitation", "recovery", "other"
    - command: 体制・本部運営
    - information: 情報収集・伝達
    - evacuation: 避難・避難所
    - rescue_medical: 救助・救急・医療
    - logistics: 物資・輸送
    - external_support: 応援・受援
    - vulnerable_people: 要配慮者支援
    - public_communication: 住民広報・相談
    - infrastructure: インフラ・ライフライン
    - damage_assessment: 被害調査
    - sanitation: 衛生・廃棄物・遺体対応
    - recovery: 生活再建・復旧復興
    - other: 上記に分類できないもの
  - "department": 主担当部署名（複数部署の場合はカンマ区切りで列挙してよい）
  - "description": タスクの具体的な内容
  - "category": 章・節・セクション名など、そのタスクが属する大分類
  - "source_pdf": 主に参照したPDFファイル名
  - "page_range": "3-4" のように主に関連するページ範囲（単一ページなら "3"）
  - "context_snippets": 依存関係抽出に役立つ原文抜粋の配列（最大3件程度）
  - "evidence": 必須。根拠の配列（1件以上）。各要素は少なくとも次を含む:
    - "source_quote": 原文からの短い抜粋（必須）
    - "chapter_ref": 章見出し文字列（分かる場合）
    - "section_path": 見出し階層の配列（例: ["第3章","第2節"]）
    - "page_start": チャンク内の0始まりページ番号（分かる場合）
    - "page_end": チャンク内の0始まり終了ページ番号（分かる場合）
    - "char_offset_start": 文字位置（不明なら null）
    - "char_offset_end": 文字位置（不明なら null）
  - "actor": 主担当主体の正規化情報
    - "org_level": "prefecture", "municipality", "national", "related_organization", "other" のいずれか
    - "org_name_raw": 原文の組織名
    - "org_name_normalized": "県", "市町村", "国", "関係機関", "その他" のいずれかを基本に正規化
    - "department_raw": 原文の部署名
    - "department_normalized": 表記ゆれを除いた部署名
  - "action": 動作カテゴリ。例 "collect", "share", "decide", "request", "open", "operate", "transport", "inspect"
  - "object": 対象物・対象者。例 "被害情報", "避難者", "物資", "道路", "医療救護"
  - "scope": タスク範囲の説明。MECE判定で包含・重複を見分けられる粒度で書く
  - "aliases": 原文中の別表記候補の配列
  - "analysis_keys": 後続分析用キー
    - "duplicate_key": canonical_name、actor、object から作る重複判定キー
    - "mece_axis": "phase:workstream" 形式
    - "owner_key": "org_level:department_normalized" 形式

全文書の他章との依存は後続フェーズで推定するため、ここでは当該チャンクの根拠を明確に記載してください。

## 抽出時の注意点
- 災害応急対策に関する章・節を中心に、網羅的にタスクを抽出してください。
- 大項目タスクを無理に作らず、実施可能な原子的な詳細タスクを抽出してください。大項目表示は後続の可視化で phase と workstream から集約します。
- 類似タスクが複数ページに跨る場合は、1つのタスクに集約し、description や context_snippets に統合してよいです。
- "奈良県", "県", "県庁" は actor.org_name_normalized では "県" に統合し、市町村系は "市町村" に統合してください。
- JSON以外（解説文、日本語の前置き、コードフェンスなど）は一切出力しないでください。
