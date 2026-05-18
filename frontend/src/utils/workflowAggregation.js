export const DEFAULT_PHASES = [
  { id: 'preparedness', label: '平時・事前対策', order: 10 },
  { id: 'initial_response', label: '初動対応', order: 20 },
  { id: 'emergency_response', label: '応急対応', order: 30 },
  { id: 'recovery', label: '復旧・復興', order: 40 },
];

export const DEFAULT_WORKSTREAMS = [
  { id: 'command', label: '体制・本部運営', order: 10 },
  { id: 'information', label: '情報収集・伝達', order: 20 },
  { id: 'evacuation', label: '避難・避難所', order: 30 },
  { id: 'rescue_medical', label: '救助・救急・医療', order: 40 },
  { id: 'logistics', label: '物資・輸送', order: 50 },
  { id: 'external_support', label: '応援・受援', order: 60 },
  { id: 'vulnerable_people', label: '要配慮者支援', order: 70 },
  { id: 'public_communication', label: '住民広報・相談', order: 80 },
  { id: 'infrastructure', label: 'インフラ・ライフライン', order: 90 },
  { id: 'damage_assessment', label: '被害調査', order: 100 },
  { id: 'sanitation', label: '衛生・廃棄物・遺体対応', order: 110 },
  { id: 'recovery', label: '生活再建・復旧復興', order: 120 },
  { id: 'other', label: 'その他', order: 900 },
];

export const DEFAULT_ORG_LEVELS = [
  { id: 'prefecture', label: '県', order: 10 },
  { id: 'municipality', label: '市町村', order: 20 },
  { id: 'national', label: '国', order: 30 },
  { id: 'related_organization', label: '関係機関', order: 40 },
  { id: 'other', label: 'その他', order: 900 },
];

const phaseIds = new Set(DEFAULT_PHASES.map((item) => item.id));
const workstreamIds = new Set(DEFAULT_WORKSTREAMS.map((item) => item.id));
const orgLevelIds = new Set(DEFAULT_ORG_LEVELS.map((item) => item.id));

const workstreamKeywords = [
  ['command', ['本部', '体制', '配備', '参集', '動員', '指揮', '調整', '会議', '対策部', '災害対策']],
  ['information', ['情報', '収集', '伝達', '連絡', '報告', '通信', '共有', '通報', '警報', '気象', '観測']],
  ['evacuation', ['避難', '避難所', '退避', '誘導', '収容', '帰宅困難', '一時滞在']],
  ['rescue_medical', ['救助', '救急', '医療', '救護', '搬送', '負傷', '要救助', '病院', '保健', '感染症']],
  ['logistics', ['物資', '備蓄', '食料', '飲料水', '給水', '輸送', '配送', '調達', '燃料', '資機材']],
  ['external_support', ['応援', '受援', '派遣', '要請', '協定', '自衛隊', '広域', 'ボランティア']],
  ['vulnerable_people', ['要配慮', '要援護', '高齢', '障害', '福祉', '乳幼児', '妊産婦', '外国人']],
  ['public_communication', ['広報', '住民', '県民', '相談', '問い合わせ', '周知', '発表', '報道', 'デマ']],
  ['infrastructure', ['道路', '河川', '橋', '交通', '電力', 'ガス', '水道', '下水', '通信施設', 'ライフライン', '土砂']],
  ['damage_assessment', ['被害', '調査', '罹災', 'り災', '住宅', '応急危険度', '被災状況']],
  ['sanitation', ['衛生', '廃棄物', 'ごみ', 'し尿', '防疫', '遺体', '埋火葬', '行方不明']],
  ['recovery', ['復旧', '復興', '再開', '生活再建', '義援金', '見舞金', '仮設住宅']],
];

export function cleanText(value) {
  return String(value ?? '').replace(/\u3000/g, ' ').trim();
}

export function cleanTaskName(value) {
  return cleanText(value)
    .replace(/^第[0-9０-９一二三四五六七八九十百千]+章\s*/u, '')
    .replace(/^第[0-9０-９一二三四五六七八九十百千]+節\s*/u, '')
    .replace(/^第[0-9０-９一二三四五六七八九十百千]+款\s*/u, '')
    .replace(/^第[0-9０-９一二三四五六七八九十百千]+項\s*/u, '')
    .replace(/災害応急対策計画/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateText(value, maxLength = 24) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function dependencyEndpoints(dep) {
  const from = dep?.from ?? dep?.source;
  const to = dep?.to ?? dep?.target;
  if (from == null || to == null) return null;
  return { from: String(from), to: String(to) };
}

export function taxonomyItems(taxonomies, key, defaults) {
  const value = taxonomies?.[key];
  if (!Array.isArray(value) || value.length === 0) return defaults;
  return value
    .filter((item) => item && item.id)
    .map((item, index) => ({
      id: String(item.id),
      label: cleanText(item.label) || String(item.id),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index * 10,
    }));
}

export function workflowTaxonomies(graphData) {
  return {
    phases: taxonomyItems(graphData?.taxonomies, 'phases', DEFAULT_PHASES),
    workstreams: taxonomyItems(graphData?.taxonomies, 'workstreams', DEFAULT_WORKSTREAMS),
    orgLevels: taxonomyItems(graphData?.taxonomies, 'org_levels', DEFAULT_ORG_LEVELS),
  };
}

function itemById(items, id, fallbackId) {
  return items.find((item) => item.id === id) || items.find((item) => item.id === fallbackId) || items[0];
}

function taskSearchText(task) {
  const snippets = Array.isArray(task?.context_snippets)
    ? task.context_snippets
    : task?.context_snippets
      ? [task.context_snippets]
      : [];
  return [
    cleanTaskName(task?.name),
    cleanTaskName(task?.canonical_name),
    cleanText(task?.description),
    cleanText(task?.category),
    cleanText(task?.department),
    ...snippets.map(cleanText),
  ]
    .filter(Boolean)
    .join(' ');
}

export function inferPhase(task) {
  const explicit = cleanText(task?.phase);
  if (phaseIds.has(explicit)) return explicit;
  const text = taskSearchText(task);
  if (/復旧|復興|生活再建|義援金|罹災|り災|仮設住宅/u.test(text)) return 'recovery';
  if (/平時|事前|予防|備蓄|訓練|計画|準備|整備/u.test(text)) return 'preparedness';
  if (/初動|直後|発災|参集|配備|本部設置|警戒/u.test(text)) return 'initial_response';
  return 'emergency_response';
}

export function inferWorkstream(task) {
  const explicit = cleanText(task?.workstream);
  if (workstreamIds.has(explicit)) return explicit;
  const text = taskSearchText(task);
  const scored = workstreamKeywords
    .map(([id, keywords]) => ({
      id,
      score: keywords.reduce((sum, keyword) => (text.includes(keyword) ? sum + 1 : sum), 0),
      order: itemById(DEFAULT_WORKSTREAMS, id, 'other').order,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return scored[0]?.id || 'other';
}

export function normalizeActor(task) {
  const actor = task?.actor && typeof task.actor === 'object' ? task.actor : {};
  const rawDepartment = cleanText(actor.department_raw) || cleanText(task?.department);
  const rawOrg = cleanText(actor.org_name_raw) || rawDepartment;
  let orgLevel = cleanText(actor.org_level);

  if (!orgLevelIds.has(orgLevel)) {
    if (/奈良県|^県($|庁|警|土木|保健|防災|危機|消防|福祉|医療|教育|農林|地域|災害|水道|道路|河川)/u.test(rawOrg)) {
      orgLevel = 'prefecture';
    } else if (/市町村|市町|町村|奈良市|大和郡山市|天理市|橿原市|桜井市|五條市|御所市|生駒市|香芝市|葛城市|宇陀市|村$|町$|市$/u.test(rawOrg)) {
      orgLevel = 'municipality';
    } else if (/^国|内閣府|気象庁|国土交通省|総務省|厚生労働省|農林水産省|経済産業省|自衛隊/u.test(rawOrg)) {
      orgLevel = 'national';
    } else if (/警察|消防|医療|病院|ライフライン|電力|ガス|通信|交通|鉄道|道路管理者|関係機関|防災関係機関/u.test(rawOrg)) {
      orgLevel = 'related_organization';
    } else {
      orgLevel = 'other';
    }
  }

  const orgNameNormalized =
    cleanText(actor.org_name_normalized) ||
    itemById(DEFAULT_ORG_LEVELS, orgLevel, 'other')?.label ||
    'その他';
  let departmentNormalized = cleanText(actor.department_normalized) || rawDepartment;

  if (orgLevel === 'prefecture') {
    departmentNormalized = departmentNormalized.replace(/^(奈良県|県庁|県)[・･\s-]*/u, '').trim();
  } else if (orgLevel === 'municipality') {
    departmentNormalized = departmentNormalized
      .replace(/^(市町村|市町|町村)[・･\s-]*/u, '')
      .replace(/^[^・･\s-]+[市町村][・･\s-]*/u, '')
      .trim();
  } else if (orgLevel === 'national') {
    departmentNormalized = departmentNormalized.replace(/^国[・･\s-]*/u, '').trim();
  }

  return {
    org_level: orgLevel,
    org_name_raw: rawOrg,
    org_name_normalized: orgNameNormalized,
    department_raw: rawDepartment,
    department_normalized: departmentNormalized || '担当部署不明',
  };
}

export function laneInfoForTask(task, graphData = null) {
  const actor = task?.__actor || normalizeActor(task);
  const tax = workflowTaxonomies(graphData);
  const orgItem = itemById(tax.orgLevels, actor.org_level, 'other') || DEFAULT_ORG_LEVELS[4];
  const org = orgItem.label;
  const department = cleanText(actor.department_normalized) || '担当部署不明';
  return {
    key: `${actor.org_level}:${department}`,
    org,
    orgOrder: orgItem.order,
    department,
    label: `${org} / ${department}`,
  };
}

export function normalizeWorkflowData(graphData) {
  const tax = workflowTaxonomies(graphData);
  const phaseIdSet = new Set(tax.phases.map((item) => item.id));
  const workstreamIdSet = new Set(tax.workstreams.map((item) => item.id));
  const tasks = Array.isArray(graphData?.tasks) ? graphData.tasks : [];
  const normalizedTasks = tasks.map((task, index) => {
    const id = cleanText(task?.id) || `task-${index + 1}`;
    let phase = inferPhase(task);
    let workstream = inferWorkstream(task);
    if (!phaseIdSet.has(phase)) phase = 'emergency_response';
    if (!workstreamIdSet.has(workstream)) workstream = 'other';
    const actor = normalizeActor(task);
    return {
      ...task,
      id,
      __phase: phase,
      __workstream: workstream,
      __actor: actor,
      __canonical_name: cleanText(task?.canonical_name) || cleanTaskName(task?.name) || id,
    };
  });
  const normalizedDependencies = Array.isArray(graphData?.dependencies)
    ? graphData.dependencies
        .map((dep, index) => ({
          ...dep,
          id: cleanText(dep?.id) || `dep-${index + 1}`,
          dependency_type: cleanText(dep?.dependency_type) || 'precondition',
          confidence: cleanText(dep?.confidence) || 'medium',
        }))
        .filter((dep) => dependencyEndpoints(dep))
    : [];
  return { ...tax, tasks: normalizedTasks, dependencies: normalizedDependencies };
}

export function buildWorkflowOverview(graphData) {
  const workflow = normalizeWorkflowData(graphData);
  const phaseById = new Map(workflow.phases.map((item) => [item.id, item]));
  const workstreamById = new Map(workflow.workstreams.map((item) => [item.id, item]));
  const groupByKey = new Map();
  const taskToGroup = new Map();

  workflow.tasks.forEach((task) => {
    const phase = itemById(workflow.phases, task.__phase, 'emergency_response');
    const workstream = itemById(workflow.workstreams, task.__workstream, 'other');
    const key = `${phase.id}:${workstream.id}`;
    if (!groupByKey.has(key)) {
      groupByKey.set(key, {
        id: `overview:${key}`,
        key,
        phase: phase.id,
        workstream: workstream.id,
        phaseLabel: phase.label,
        workstreamLabel: workstream.label,
        phaseOrder: phase.order,
        workstreamOrder: workstream.order,
        tasks: [],
      });
    }
    groupByKey.get(key).tasks.push(task);
    taskToGroup.set(String(task.id), groupByKey.get(key));
  });

  const edgeRollups = new Map();
  workflow.dependencies.forEach((dep, index) => {
    const endpoints = dependencyEndpoints(dep);
    if (!endpoints) return;
    const fromGroup = taskToGroup.get(endpoints.from);
    const toGroup = taskToGroup.get(endpoints.to);
    if (!fromGroup || !toGroup || fromGroup.key === toGroup.key) return;
    const id = `overview-edge:${fromGroup.key}->${toGroup.key}`;
    if (!edgeRollups.has(id)) {
      edgeRollups.set(id, {
        id,
        source: fromGroup.id,
        target: toGroup.id,
        fromGroup,
        toGroup,
        dependencies: [],
        dependencyTypes: {},
      });
    }
    const rollup = edgeRollups.get(id);
    const type = cleanText(dep.dependency_type) || 'precondition';
    rollup.dependencyTypes[type] = (rollup.dependencyTypes[type] || 0) + 1;
    rollup.dependencies.push({
      index,
      dep,
      endpoints,
      fromTask: workflow.tasks.find((task) => String(task.id) === endpoints.from) || null,
      toTask: workflow.tasks.find((task) => String(task.id) === endpoints.to) || null,
    });
  });

  const overviewNodes = Array.from(groupByKey.values()).sort(
    (a, b) => a.phaseOrder - b.phaseOrder || a.workstreamOrder - b.workstreamOrder
  );
  const overviewEdges = Array.from(edgeRollups.values());

  return {
    overviewNodes,
    overviewEdges,
    edgeRollups: Object.fromEntries(edgeRollups.entries()),
    taskToGroup,
    phaseById,
    workstreamById,
    normalizedTasks: workflow.tasks,
    normalizedDependencies: workflow.dependencies,
    phases: workflow.phases,
    workstreams: workflow.workstreams,
    orgLevels: workflow.orgLevels,
  };
}
