import dagre from 'dagre';
import React, { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  getBezierPath,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
  useStore,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { diagnoseWorkflow } from '../config.js';
import {
  buildWorkflowOverview,
  cleanTaskName,
  cleanText,
  dependencyEndpoints,
  laneInfoForTask,
  normalizeWorkflowData,
  truncateText,
  workflowTaxonomies,
} from '../utils/workflowAggregation.js';

const nodeWidth = 220;
const nodeHeight = 62;
const dependencyEdgeType = 'workflowDependency';
const unknownDepartmentLabel = '担当部署不明';
const inactiveEdgeColor = '#94a3b8';
const stableEdgeLabelStyle = {
  fill: '#475569',
  fontSize: 12,
  fontWeight: 700,
  pointerEvents: 'none',
};
const stableEdgeLabelBgStyle = {
  fill: 'rgba(255,255,255,0.92)',
};
const stableEdgeLabelProps = {
  labelStyle: stableEdgeLabelStyle,
  labelShowBg: true,
  labelBgStyle: stableEdgeLabelBgStyle,
  labelBgPadding: [6, 3],
  labelBgBorderRadius: 4,
};

const palette = [
  { bg: '#ecfdf5', border: '#0f766e', text: '#134e4a', area: 'rgba(15, 118, 110, 0.08)' },
  { bg: '#eff6ff', border: '#2563eb', text: '#1e3a8a', area: 'rgba(37, 99, 235, 0.08)' },
  { bg: '#fff7ed', border: '#ea580c', text: '#7c2d12', area: 'rgba(234, 88, 12, 0.09)' },
  { bg: '#fdf2f8', border: '#db2777', text: '#831843', area: 'rgba(219, 39, 119, 0.08)' },
  { bg: '#f8fafc', border: '#475569', text: '#1e293b', area: 'rgba(71, 85, 105, 0.08)' },
  { bg: '#f0fdf4', border: '#16a34a', text: '#14532d', area: 'rgba(22, 163, 74, 0.08)' },
  { bg: '#fefce8', border: '#ca8a04', text: '#713f12', area: 'rgba(202, 138, 4, 0.10)' },
  { bg: '#f0f9ff', border: '#0284c7', text: '#075985', area: 'rgba(2, 132, 199, 0.08)' },
];

const dependencyTypeLabels = {
  precondition: '前提',
  information_flow: '情報',
  handoff: '引渡',
  resource_flow: '資源',
  decision: '判断',
};

const findingTypeLabels = {
  duplicate: '重複',
  overlap: '範囲重複',
  granularity_mismatch: '粒度不一致',
  naming_variation: '表記ゆれ',
  owner_ambiguity: '担当曖昧',
  missing_dependency: '依存欠落疑い',
};

function colorForIndex(index) {
  const safeIndex = Number.isFinite(index) && index >= 0 ? index : 0;
  return palette[safeIndex % palette.length];
}

function nodeStyle(kind, color = palette[0], highlighted = false) {
  const muted = highlighted === 'muted';
  const active = highlighted === true;
  if (kind === 'group') {
    return {
      width: nodeWidth,
      minHeight: nodeHeight,
      border: `2px solid ${active ? '#dc2626' : color.border}`,
      background: muted ? '#f8fafc' : color.bg,
      color: muted ? '#94a3b8' : color.text,
      fontWeight: 700,
      fontSize: 13,
      lineHeight: 1.25,
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      opacity: muted ? 0.45 : 1,
      boxShadow: active ? '0 0 0 3px rgba(220,38,38,0.18)' : 'none',
    };
  }

  return {
    width: nodeWidth,
    minHeight: nodeHeight,
    border: `1px solid ${active ? '#dc2626' : color.border}`,
    borderLeft: `5px solid ${active ? '#dc2626' : color.border}`,
    background: active ? '#fff1f2' : '#fff',
    color: muted ? '#94a3b8' : '#1e293b',
    fontSize: 13,
    lineHeight: 1.25,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    opacity: muted ? 0.42 : 1,
    boxShadow: active ? '0 0 0 3px rgba(220,38,38,0.16)' : 'none',
  };
}

function edgeMarker(color = inactiveEdgeColor) {
  return {
    type: MarkerType.ArrowClosed,
    color,
  };
}

function edgeStyle(active = false, activeColor = '#334155') {
  return {
    stroke: active ? activeColor : inactiveEdgeColor,
    strokeWidth: active ? 3 : 1.5,
    opacity: active ? 1 : 0.58,
  };
}

function nodeBox(node, fallbackX, fallbackY) {
  const width = node?.width || node?.measured?.width || nodeWidth;
  const height = node?.height || node?.measured?.height || nodeHeight;
  const left = node?.positionAbsolute?.x ?? node?.position?.x ?? fallbackX - width / 2;
  const top = node?.positionAbsolute?.y ?? node?.position?.y ?? fallbackY - height / 2;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function stableHash(value) {
  return String(value)
    .split('')
    .reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function WorkflowDependencyEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  markerStart,
  style,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
}) {
  const sourceNode = useStore(
    useCallback(
      (store) => store.nodeInternals.get(source),
      [source]
    )
  );
  const targetNode = useStore(
    useCallback(
      (store) => store.nodeInternals.get(target),
      [target]
    )
  );
  const sourceBox = nodeBox(sourceNode, sourceX, sourceY);
  const targetBox = nodeBox(targetNode, targetX, targetY);
  const isVertical =
    Math.abs(targetBox.centerY - sourceBox.centerY) >
    Math.abs(targetBox.centerX - sourceBox.centerX);
  const edgeSourceX = isVertical ? sourceBox.centerX : sourceBox.left + sourceBox.width;
  const edgeSourceY = isVertical ? sourceBox.top + sourceBox.height : sourceBox.centerY;
  const edgeTargetX = isVertical ? targetBox.centerX : targetBox.left;
  const edgeTargetY = isVertical ? targetBox.top : targetBox.centerY;
  const edgeHash = Math.abs(stableHash(id));
  const verticalLaneOffset = 36 + (edgeHash % 5) * 14;
  const verticalLabelOffset = ((Math.floor(edgeHash / 5) % 5) - 2) * 7;
  const laneDirection = edgeHash % 2 === 0 ? -1 : 1;
  const bendX = (edgeSourceX + edgeTargetX) / 2 + laneDirection * verticalLaneOffset;
  const midY = (edgeSourceY + edgeTargetY) / 2;
  const sourceOutY = edgeSourceY + 42;
  const targetInY = edgeTargetY - 42;
  const [path, labelX, labelY] = isVertical
    ? [
        `M ${edgeSourceX},${edgeSourceY} C ${edgeSourceX},${sourceOutY} ${bendX},${sourceOutY} ${bendX},${midY} C ${bendX},${targetInY} ${edgeTargetX},${targetInY} ${edgeTargetX},${edgeTargetY}`,
        bendX,
        midY + verticalLabelOffset,
      ]
    : getBezierPath({
        sourceX: edgeSourceX,
        sourceY: edgeSourceY,
        sourcePosition: Position.Right,
        targetX: edgeTargetX,
        targetY: edgeTargetY,
        targetPosition: Position.Left,
      });

  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      interactionWidth={interactionWidth}
    />
  );
}

const workflowEdgeTypes = {
  [dependencyEdgeType]: WorkflowDependencyEdge,
};

function markMutualDependencies(edges) {
  const edgePairs = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  return edges.map((edge) => {
    const hasReverse = edgePairs.has(`${edge.target}->${edge.source}`);
    if (!hasReverse) return edge;
    return {
      ...edge,
      markerStart: edgeMarker(),
    };
  });
}

function dependencyRanks(nodes, edges) {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const rank = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !indegree.has(edge.target)) return;
    adjacency.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });

  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort((a, b) => nodeOrder.get(a.id) - nodeOrder.get(b.id))
    .map((node) => node.id);

  while (queue.length > 0) {
    const current = queue.shift();
    (adjacency.get(current) || []).forEach((next) => {
      rank.set(next, Math.max(rank.get(next) || 0, (rank.get(current) || 0) + 1));
      indegree.set(next, (indegree.get(next) || 0) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b));
      }
    });
  }

  return { rank, nodeOrder };
}

function layoutOverviewByPhase(nodes, edges, phases) {
  const phaseOrder = new Map(phases.map((phase, index) => [phase.id, index]));
  const nodesByPhase = new Map();
  nodes.forEach((node) => {
    const phase = node.data?.phase || 'emergency_response';
    if (!nodesByPhase.has(phase)) nodesByPhase.set(phase, []);
    nodesByPhase.get(phase).push(node);
  });

  const columnGap = 380;
  const rowGap = 112;
  const headerHeight = 88;
  const laidNodes = [];
  const phaseNodes = [];
  const maxRows = Math.max(1, ...Array.from(nodesByPhase.values()).map((items) => items.length));
  const phaseBandHeight = headerHeight + maxRows * rowGap + 34;

  phases.forEach((phase, phaseIndex) => {
    const phaseNodesInColumn = (nodesByPhase.get(phase.id) || []).sort((a, b) => {
      return (a.data?.workstreamOrder || 0) - (b.data?.workstreamOrder || 0);
    });
    const x = phaseIndex * columnGap;
    phaseNodes.push({
      id: `phase-band:${phase.id}`,
      type: 'default',
      data: { kind: 'phase-band', label: phase.label },
      position: { x: x - 22, y: 0 },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -2,
      style: {
        width: nodeWidth + 44,
        height: phaseBandHeight + 18,
        border: '1px solid rgba(148, 163, 184, 0.35)',
        background: phaseIndex % 2 === 0 ? 'rgba(248,250,252,0.88)' : 'rgba(241,245,249,0.66)',
        color: '#475569',
        borderRadius: 8,
        padding: '14px 12px',
        fontSize: 13,
        fontWeight: 800,
        pointerEvents: 'none',
      },
    });
    phaseNodesInColumn.forEach((node, rowIndex) => {
      laidNodes.push({
        ...node,
        position: {
          x,
          y: headerHeight + rowIndex * rowGap,
        },
      });
    });
  });

  const unknownPhaseNodes = nodes.filter((node) => !phaseOrder.has(node.data?.phase));
  unknownPhaseNodes.forEach((node, rowIndex) => {
    laidNodes.push({
      ...node,
      position: {
        x: phases.length * columnGap,
        y: headerHeight + rowIndex * rowGap,
      },
    });
  });

  return [...phaseNodes, ...laidNodes];
}

function layoutWithDagre(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 130 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });
  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
    };
  });
}

function layoutByTimelineAndDepartment(nodes, edges, options = {}) {
  const columnGap = options.columnGap ?? 300;
  const stackGap = options.stackGap ?? 86;
  const lanePadding = options.lanePadding ?? 26;
  const laneGap = options.laneGap ?? 24;
  const leftOffset = options.leftOffset ?? 190;
  const laneOfNode = options.laneOfNode;
  const { rank, nodeOrder } = dependencyRanks(nodes, edges);
  const lanesByKey = new Map();

  nodes.forEach((node) => {
    const laneInfo = laneOfNode(node);
    if (!lanesByKey.has(laneInfo.key)) lanesByKey.set(laneInfo.key, laneInfo);
  });

  const laneInfos = Array.from(lanesByKey.values()).sort((a, b) => {
    if (a.orgOrder !== b.orgOrder) return a.orgOrder - b.orgOrder;
    return a.department.localeCompare(b.department, 'ja');
  });
  const laneRankStacks = new Map();
  laneInfos.forEach((laneInfo) => laneRankStacks.set(laneInfo.key, new Map()));

  nodes.forEach((node) => {
    const laneInfo = laneOfNode(node);
    const nodeRank = rank.get(node.id) || 0;
    const rankStacks = laneRankStacks.get(laneInfo.key);
    if (!rankStacks.has(nodeRank)) rankStacks.set(nodeRank, []);
    rankStacks.get(nodeRank).push(node);
  });

  laneRankStacks.forEach((rankStacks) => {
    rankStacks.forEach((stack) => stack.sort((a, b) => nodeOrder.get(a.id) - nodeOrder.get(b.id)));
  });

  let currentY = 0;
  const lanes = laneInfos.map((laneInfo) => {
    const rankStacks = laneRankStacks.get(laneInfo.key);
    const maxStackSize = Math.max(1, ...Array.from(rankStacks.values()).map((stack) => stack.length));
    const height = lanePadding * 2 + nodeHeight + (maxStackSize - 1) * stackGap;
    const lane = { ...laneInfo, y: currentY, height };
    currentY += height + laneGap;
    return lane;
  });
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));

  const laidNodes = nodes.map((node) => {
    const laneInfo = laneOfNode(node);
    const lane = laneByKey.get(laneInfo.key);
    const nodeRank = rank.get(node.id) || 0;
    const stack = laneRankStacks.get(laneInfo.key).get(nodeRank) || [];
    const stackIndex = stack.findIndex((rankNode) => rankNode.id === node.id);
    return {
      ...node,
      position: {
        x: leftOffset + nodeRank * columnGap,
        y: lane.y + lanePadding + Math.max(0, stackIndex) * stackGap,
      },
    };
  });

  return { nodes: laidNodes, lanes };
}

function createDepartmentLaneNodes(lanes, width, prefix) {
  return lanes.map((lane, index) => ({
    id: `${prefix}:${index}:${lane.key}`,
    type: 'default',
    data: { kind: 'department-lane', label: lane.label },
    position: { x: 0, y: lane.y },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    zIndex: -1,
    style: {
      width,
      height: lane.height,
      border: '1px solid rgba(148, 163, 184, 0.28)',
      background: index % 2 === 0 ? 'rgba(248, 250, 252, 0.92)' : 'rgba(241, 245, 249, 0.62)',
      color: '#475569',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      padding: '8px 10px',
      fontSize: 12,
      fontWeight: 700,
      pointerEvents: 'none',
      boxSizing: 'border-box',
    },
  })).map((node) => ({
    ...node,
    data: { ...node.data, label: truncateText(node.data.label, 20) },
  }));
}

function createWorkstreamAreaNodes(nodes, graphData, options = {}) {
  const workflow = normalizeWorkflowData(graphData);
  const workstreamLabels = new Map(workflow.workstreams.map((item) => [item.id, item.label]));
  const grouped = new Map();
  nodes.forEach((node) => {
    const workstream = node.data?.task?.__workstream || node.data?.task?.workstream || 'other';
    if (!grouped.has(workstream)) grouped.set(workstream, []);
    grouped.get(workstream).push(node);
  });

  const padX = options.padX ?? 24;
  const padY = options.padY ?? 22;
  const headerPad = options.headerPad ?? 36;
  const prefix = options.prefix ?? 'workstream-area';

  return Array.from(grouped.entries()).map(([workstream, groupNodes], index) => {
    const color = colorForIndex(workflow.workstreams.findIndex((item) => item.id === workstream));
    const minX = Math.min(...groupNodes.map((node) => node.position.x));
    const minY = Math.min(...groupNodes.map((node) => node.position.y));
    const maxX = Math.max(...groupNodes.map((node) => node.position.x + nodeWidth));
    const maxY = Math.max(...groupNodes.map((node) => node.position.y + nodeHeight));
    return {
      id: `${prefix}:${workstream}:${index}`,
      type: 'default',
      data: {
        kind: 'workstream-area',
        label: workstreamLabels.get(workstream) || workstream,
      },
      position: {
        x: minX - padX,
        y: minY - headerPad,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -3,
      style: {
        width: maxX - minX + padX * 2,
        height: maxY - minY + headerPad + padY,
        border: `1px dashed ${color.border}`,
        background: color.area,
        color: color.text,
        borderRadius: 8,
        padding: '9px 11px',
        fontSize: 12,
        fontWeight: 800,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      },
    };
  });
}

function createPhaseAreaNode({ selectedGroup, bounds, color, graphData, groupKey }) {
  const phaseLabel =
    workflowTaxonomies(graphData).phases.find((phase) => phase.id === selectedGroup?.phase)?.label ||
    selectedGroup?.phaseLabel ||
    'フェーズ';
  return {
    id: `phase-area:${groupKey}`,
    type: 'default',
    data: { kind: 'phase-area', label: phaseLabel },
    position: {
      x: bounds.minX - 38,
      y: bounds.minY - 86,
    },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    zIndex: -4,
    style: {
      width: bounds.maxX - bounds.minX + 76,
      height: bounds.maxY - bounds.minY + 126,
      border: '1px solid rgba(100, 116, 139, 0.36)',
      background: 'rgba(248, 250, 252, 0.72)',
      color: '#334155',
      borderRadius: 10,
      padding: '12px 14px',
      fontSize: 13,
      fontWeight: 900,
      pointerEvents: 'none',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.75)',
    },
  };
}

function taskLabel(task) {
  return truncateText(cleanTaskName(task?.name) || task?.id || 'タスク', 28);
}

function edgeTypeSummary(dependencyTypes) {
  return Object.entries(dependencyTypes || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([type, count]) => `${dependencyTypeLabels[type] || type}${count > 1 ? count : ''}`)
    .join(' / ');
}

export function graphDataToGroupedFlow(graphData) {
  const overview = buildWorkflowOverview(graphData);
  const workstreamColor = new Map();
  overview.workstreams.forEach((workstream, index) => {
    workstreamColor.set(workstream.id, colorForIndex(index));
  });

  const nodes = overview.overviewNodes.map((group) => {
    const color = workstreamColor.get(group.workstream) || colorForIndex(0);
    return {
      id: group.id,
      type: 'default',
      data: {
        kind: 'group',
        groupKey: group.key,
        groupLabel: `${group.phaseLabel} / ${group.workstreamLabel}`,
        phase: group.phase,
        phaseLabel: group.phaseLabel,
        workstream: group.workstream,
        workstreamOrder: group.workstreamOrder,
        workstreamLabel: group.workstreamLabel,
        tasks: group.tasks,
        taskCount: group.tasks.length,
        label: `${truncateText(group.workstreamLabel, 16)} (${group.tasks.length})`,
        color,
      },
      position: { x: 0, y: 0 },
      style: nodeStyle('group', color),
      zIndex: 2,
    };
  });

  const edges = markMutualDependencies(overview.overviewEdges.map((rollup) => {
    const typeSummary = edgeTypeSummary(rollup.dependencyTypes);
    return {
      id: rollup.id,
      source: rollup.source,
      target: rollup.target,
      type: dependencyEdgeType,
      label: `${rollup.dependencies.length}件${typeSummary ? ` ${typeSummary}` : ''}`,
      markerEnd: edgeMarker(),
      style: edgeStyle(false),
      ...stableEdgeLabelProps,
      data: { kind: 'group-edge', rollup, deps: rollup.dependencies.map((item) => item.dep) },
    };
  }));

  return {
    nodes: layoutOverviewByPhase(nodes, edges, overview.phases),
    edges,
    overview,
    focusNodeIds: nodes.map((node) => node.id),
  };
}

export function graphDataToDetailFlow(graphData, groupKey) {
  const overview = buildWorkflowOverview(graphData);
  const selectedGroup = overview.overviewNodes.find((group) => group.key === groupKey);
  const filteredTasks = selectedGroup?.tasks || [];
  const taskIds = new Set(filteredTasks.map((task) => String(task.id)));
  const color =
    colorForIndex(overview.workstreams.findIndex((item) => item.id === selectedGroup?.workstream));

  const taskNodes = filteredTasks.map((task) => ({
    id: String(task.id),
    type: 'default',
      data: {
        kind: 'task',
        label: taskLabel(task),
        task,
        department: laneInfoForTask(task, graphData).label,
        color,
      },
    position: { x: 0, y: 0 },
    style: nodeStyle('task', color),
    zIndex: 2,
  }));

  const edges = markMutualDependencies(overview.normalizedDependencies
    .map((dep, index) => ({ dep, endpoints: dependencyEndpoints(dep), index }))
    .filter(({ endpoints }) => endpoints && taskIds.has(endpoints.from) && taskIds.has(endpoints.to))
    .map(({ dep, endpoints, index }) => ({
      id: `e-${index}-${endpoints.from}-${endpoints.to}`,
      source: endpoints.from,
      target: endpoints.to,
      type: dependencyEdgeType,
      label: dependencyTypeLabels[dep.dependency_type] || '',
      markerEnd: edgeMarker(),
      style: edgeStyle(false),
      ...stableEdgeLabelProps,
      data: { kind: 'task-edge', dep },
    })));

  const layout = layoutByTimelineAndDepartment(taskNodes, edges, {
    laneOfNode: (node) => laneInfoForTask(node.data?.task, graphData),
  });

  const laidTaskNodes = layout.nodes;
  if (laidTaskNodes.length === 0) return { nodes: [], edges, selectedGroup, focusNodeIds: [] };

  const maxX = Math.max(...laidTaskNodes.map((node) => node.position.x + nodeWidth));
  const maxY = Math.max(...layout.lanes.map((lane) => lane.y + lane.height));
  const bounds = { minX: 0, minY: 0, maxX: maxX + 32, maxY: maxY + 18 };
  const phaseAreaNode = createPhaseAreaNode({
    selectedGroup,
    bounds,
    color,
    graphData,
    groupKey: selectedGroup?.key || groupKey,
  });
  const backgroundNode = {
    id: `topic-area:${selectedGroup?.key || groupKey}`,
    type: 'default',
    data: { kind: 'topic-area', label: selectedGroup?.workstreamLabel || '詳細' },
    position: { x: -16, y: -50 },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    zIndex: -2,
    style: {
      width: maxX + 32,
      height: maxY + 72,
      border: `2px dashed ${color.border}`,
      background: color.area,
      color: color.text,
      borderRadius: 8,
      padding: '10px 12px',
      fontSize: 13,
      fontWeight: 800,
      pointerEvents: 'none',
    },
  };
  const laneNodes = createDepartmentLaneNodes(layout.lanes, maxX + 32, `detail-lane:${groupKey}`);

  return {
    nodes: [phaseAreaNode, backgroundNode, ...laneNodes, ...laidTaskNodes],
    edges,
    selectedGroup,
    focusNodeIds: laidTaskNodes.map((node) => node.id),
  };
}

export function graphDataToDiagnosticsFlow(graphData, highlightedTaskIds = new Set()) {
  const workflow = normalizeWorkflowData(graphData);
  const colorByWorkstream = new Map();
  workflow.workstreams.forEach((workstream, index) => {
    colorByWorkstream.set(workstream.id, colorForIndex(index));
  });
  const taskIds = new Set(workflow.tasks.map((task) => String(task.id)));
  const nodes = workflow.tasks.map((task) => {
    const highlighted = highlightedTaskIds.has(String(task.id));
    const color = colorByWorkstream.get(task.__workstream) || colorForIndex(0);
    return {
      id: String(task.id),
      type: 'default',
      data: { kind: 'task', label: taskLabel(task), task, color },
      position: { x: 0, y: 0 },
      style: nodeStyle('task', color, highlighted),
      zIndex: highlighted ? 3 : 2,
    };
  });
  const edges = markMutualDependencies(workflow.dependencies
    .map((dep, index) => ({ dep, endpoints: dependencyEndpoints(dep), index }))
    .filter(({ endpoints }) => endpoints && taskIds.has(endpoints.from) && taskIds.has(endpoints.to))
    .map(({ dep, endpoints, index }) => ({
      id: `diag-e-${index}-${endpoints.from}-${endpoints.to}`,
      source: endpoints.from,
      target: endpoints.to,
      type: dependencyEdgeType,
      markerEnd: edgeMarker(),
      style: edgeStyle(false),
      data: { kind: 'task-edge', dep },
  })));

  if (nodes.length > 80) {
    const laidNodes = layoutWithDagre(nodes, edges);
    const workstreamAreas = createWorkstreamAreaNodes(laidNodes, graphData, {
      prefix: 'diagnostics-workstream-area',
    });
    return {
      nodes: [...workstreamAreas, ...laidNodes],
      edges,
      focusNodeIds: laidNodes.map((node) => node.id),
    };
  }

  const layout = layoutByTimelineAndDepartment(nodes, edges, {
    laneOfNode: (node) => laneInfoForTask(node.data?.task, graphData),
    columnGap: 270,
    stackGap: 82,
  });
  if (layout.nodes.length === 0) return { nodes: [], edges, focusNodeIds: [] };
  const maxX = Math.max(...layout.nodes.map((node) => node.position.x + nodeWidth));
  const workstreamAreas = createWorkstreamAreaNodes(layout.nodes, graphData, {
    prefix: 'diagnostics-workstream-area',
    padX: 18,
    padY: 18,
    headerPad: 34,
  });
  const laneNodes = createDepartmentLaneNodes(layout.lanes, maxX + 32, 'diagnostics-lane');
  return {
    nodes: [...workstreamAreas, ...laneNodes, ...layout.nodes],
    edges,
    focusNodeIds: layout.nodes.map((node) => node.id),
  };
}

function selectedTaskIdsFromFinding(findings, highlightedFindingIndex) {
  const finding = findings[highlightedFindingIndex];
  if (!finding || !Array.isArray(finding.task_ids)) return new Set();
  return new Set(finding.task_ids.map(String));
}

function taskIdsKey(taskIds) {
  return Array.from(taskIds).sort().join('|');
}

function relatedNodeIdsForNode(node, edges) {
  if (!node?.id) return new Set();
  const ids = new Set([String(node.id)]);
  edges.forEach((edge) => {
    if (edge.target === node.id) ids.add(String(edge.source));
  });
  return ids;
}

function applyFocusStyling(baseNodes, baseEdges, focusNode, diagnosticsTaskIds = new Set()) {
  const relatedIds = relatedNodeIdsForNode(focusNode, baseEdges);
  const hasFocus = !!focusNode?.id && relatedIds.size > 0;
  const nodeById = new Map(baseNodes.map((node) => [String(node.id), node]));
  const activeEdgeIds = new Set(
    baseEdges
      .filter((edge) => hasFocus && edge.target === focusNode.id)
      .map((edge) => edge.id)
  );

  const nodes = baseNodes.map((node) => {
    if (node.data?.kind !== 'task' && node.data?.kind !== 'group') return node;
    const color = node.data?.color || palette[0];
    const diagnosticHit = diagnosticsTaskIds.has(String(node.id));
    let state = diagnosticHit ? true : false;
    let zIndex = diagnosticHit ? 12 : node.zIndex;
    if (hasFocus) {
      state = relatedIds.has(String(node.id)) ? true : 'muted';
      if (String(node.id) === String(focusNode.id)) {
        zIndex = 24;
      } else if (state === true) {
        zIndex = 18;
      } else {
        zIndex = node.zIndex;
      }
    }
    return {
      ...node,
      style: nodeStyle(node.data?.kind === 'group' ? 'group' : 'task', color, state),
      zIndex,
    };
  });

  const edges = baseEdges.map((edge) => {
    const active = activeEdgeIds.has(edge.id);
    const sourceNode = nodeById.get(String(edge.source));
    const activeColor = sourceNode?.data?.color?.border || '#334155';
    return {
      ...edge,
      style: edgeStyle(active, activeColor),
      markerEnd: edgeMarker(active ? activeColor : inactiveEdgeColor),
      markerStart: edge.markerStart
        ? edgeMarker(active ? activeColor : inactiveEdgeColor)
        : edge.markerStart,
      zIndex: active ? 16 : edge.zIndex,
    };
  });

  return { nodes, edges };
}

function WorkflowCanvas({ graphData }) {
  const { fitView } = useReactFlow();
  const [viewMode, setViewMode] = useState('overview');
  const [selectedGroupKey, setSelectedGroupKey] = useState(null);
  const [selectedGroupLabel, setSelectedGroupLabel] = useState('');
  const [selected, setSelected] = useState(null);
  const [diagnosis, setDiagnosis] = useState(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState('');
  const [highlightedFindingIndex, setHighlightedFindingIndex] = useState(0);
  const [focusedNode, setFocusedNode] = useState(null);
  const focusNode = useCallback((node) => {
    const nodeId = node?.id ? String(node.id) : null;
    if (!nodeId) return;
    setFocusedNode((current) => (current?.id === nodeId ? current : { id: nodeId }));
  }, []);

  const findings = diagnosis?.quality_findings || graphData?.quality_findings || [];
  const highlightedTaskIds = selectedTaskIdsFromFinding(findings, highlightedFindingIndex);
  const highlightedTaskIdsKey = taskIdsKey(highlightedTaskIds);

  const viewGraph = useMemo(() => {
    if (viewMode === 'diagnostics') {
      return graphDataToDiagnosticsFlow(graphData, highlightedTaskIds);
    }
    if (selectedGroupKey) {
      return graphDataToDetailFlow(graphData, selectedGroupKey);
    }
    return graphDataToGroupedFlow(graphData);
  }, [graphData, selectedGroupKey, viewMode, highlightedTaskIdsKey]);
  const styledGraph = useMemo(
    () => applyFocusStyling(viewGraph.nodes, viewGraph.edges, focusedNode, highlightedTaskIds),
    [viewGraph, focusedNode, highlightedTaskIdsKey]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(styledGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(styledGraph.edges);

  React.useEffect(() => {
    setViewMode('overview');
    setSelectedGroupKey(null);
    setSelectedGroupLabel('');
    setSelected(null);
    setDiagnosis(null);
    setDiagnosisError('');
    setHighlightedFindingIndex(0);
    setFocusedNode(null);
  }, [graphData]);

  React.useEffect(() => {
    setNodes(styledGraph.nodes);
    setEdges(styledGraph.edges);
  }, [styledGraph, setNodes, setEdges]);

  React.useEffect(() => {
    setSelected(null);
    setFocusedNode(null);
  }, [viewMode, selectedGroupKey, graphData]);

  React.useEffect(() => {
    const focusNodeIds = Array.isArray(viewGraph.focusNodeIds) ? viewGraph.focusNodeIds : [];
    if (focusNodeIds.length === 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      fitView({
        nodes: focusNodeIds.map((id) => ({ id })),
        padding: 0.26,
        minZoom: 0.12,
        maxZoom: 1.05,
        duration: 160,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, viewGraph.focusNodeIds]);

  const runDiagnostics = useCallback(async () => {
    if (!graphData) return;
    setDiagnosisLoading(true);
    setDiagnosisError('');
    try {
      const result = await diagnoseWorkflow(graphData);
      setDiagnosis(result);
      setHighlightedFindingIndex(0);
    } catch (error) {
      setDiagnosisError(error.message || '分析に失敗しました');
    } finally {
      setDiagnosisLoading(false);
    }
  }, [graphData]);

  const showOverview = () => {
    setViewMode('overview');
    setSelectedGroupKey(null);
    setSelectedGroupLabel('');
    setSelected(null);
    setFocusedNode(null);
  };

  const showDiagnostics = () => {
    setViewMode('diagnostics');
    setSelectedGroupKey(null);
    setSelectedGroupLabel('');
    setSelected(null);
    setFocusedNode(null);
    if (!diagnosis && !graphData?.quality_findings?.length) {
      runDiagnostics();
    }
  };

  const onNodeClick = useCallback((_, node) => {
    focusNode(node);
    if (node.data?.kind === 'group') {
      setViewMode('detail');
      setSelectedGroupKey(node.data.groupKey);
      setSelectedGroupLabel(node.data.groupLabel);
      setSelected(null);
      return;
    }
    if (node.data?.kind === 'task') {
      setSelected({ type: 'task', payload: node.data?.task });
    }
  }, [focusNode]);

  const onNodeMouseEnter = useCallback((_, node) => {
    if (node.data?.kind === 'task' || node.data?.kind === 'group') {
      focusNode(node);
    }
  }, [focusNode]);

  const onEdgeClick = useCallback((_, edge) => {
    if (edge.data?.kind === 'group-edge') {
      setSelected({ type: 'group-edge', payload: edge.data.rollup });
      return;
    }
    setSelected({ type: 'edge', payload: edge.data?.dep });
  }, []);

  if (!graphData || !Array.isArray(graphData.tasks) || graphData.tasks.length === 0) {
    return <div style={{ padding: '1rem', color: '#666' }}>タスクがないか、グラフデータがありません。</div>;
  }

  const taxonomies = workflowTaxonomies(graphData);
  const phaseNames = new Map(taxonomies.phases.map((item) => [item.id, item.label]));
  const workstreamNames = new Map(taxonomies.workstreams.map((item) => [item.id, item.label]));

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={workflowEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onPaneClick={() => setFocusedNode(null)}
        onEdgeClick={onEdgeClick}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.08, maxZoom: 1.2 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap zoomable pannable />
        <Controls />
        <Background />
        <Panel position="top-left">
          <div style={panelShellStyle}>
            <button type="button" onClick={showOverview} disabled={viewMode === 'overview'}>
              全体
            </button>
            {viewMode === 'detail' && (
              <strong title={selectedGroupLabel}>{truncateText(selectedGroupLabel, 30)}</strong>
            )}
            <button type="button" onClick={showDiagnostics} disabled={viewMode === 'diagnostics'}>
              分析
            </button>
            {viewMode === 'overview' && <strong>フェーズ × 業務テーマ</strong>}
            {viewMode === 'diagnostics' && (
              <strong>{diagnosisLoading ? '分析中' : `分析結果 ${findings.length}件`}</strong>
            )}
          </div>
        </Panel>

        {viewMode === 'diagnostics' && (
          <Panel position="top-right">
            <div style={{ ...panelBoxStyle, width: 360 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>MECE・表記ゆれ分析</strong>
                <button type="button" onClick={runDiagnostics} disabled={diagnosisLoading}>
                  再分析
                </button>
              </div>
              {diagnosisError && <div style={{ color: '#b91c1c', marginTop: 8 }}>{diagnosisError}</div>}
              {!diagnosisError && findings.length === 0 && !diagnosisLoading && (
                <div style={{ color: '#64748b', marginTop: 8 }}>指摘事項はありません。</div>
              )}
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {findings.map((finding, index) => (
                  <button
                    key={`${finding.type}-${index}`}
                    type="button"
                    onClick={() => {
                      setHighlightedFindingIndex(index);
                      setSelected({ type: 'finding', payload: finding });
                    }}
                    style={{
                      textAlign: 'left',
                      border: index === highlightedFindingIndex ? '2px solid #dc2626' : '1px solid #cbd5e1',
                      background: index === highlightedFindingIndex ? '#fff1f2' : '#fff',
                      borderRadius: 6,
                      padding: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {findingTypeLabels[finding.type] || finding.type} / {finding.severity}
                    </div>
                    <div>{truncateText(finding.summary, 46)}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {(finding.task_ids || []).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        )}

        {selected && viewMode !== 'diagnostics' && (
          <Panel position="top-right">
            <SelectionPanel
              selected={selected}
              phaseNames={phaseNames}
              workstreamNames={workstreamNames}
              onClose={() => setSelected(null)}
            />
          </Panel>
        )}

        {selected?.type === 'finding' && viewMode === 'diagnostics' && (
          <Panel position="bottom-right">
            <FindingPanel finding={selected.payload} onClose={() => setSelected(null)} />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function ReactFlowWorkflow({ graphData }) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas graphData={graphData} />
    </ReactFlowProvider>
  );
}

const panelShellStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};

const panelBoxStyle = {
  maxWidth: 380,
  maxHeight: 360,
  overflow: 'auto',
  background: '#fff',
  border: '1px solid #ccc',
  borderRadius: 6,
  padding: 10,
  fontSize: 13,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
};

function SelectionPanel({ selected, phaseNames, workstreamNames, onClose }) {
  return (
    <div style={panelBoxStyle}>
      {selected.type === 'task' && (
        <>
          <strong>{cleanTaskName(selected.payload?.name) || selected.payload?.id || 'タスク'}</strong>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 700 }}>分類: </span>
            {phaseNames.get(selected.payload?.__phase || selected.payload?.phase) || selected.payload?.phase || '不明'} /{' '}
            {workstreamNames.get(selected.payload?.__workstream || selected.payload?.workstream) ||
              selected.payload?.workstream ||
              '不明'}
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontWeight: 700 }}>担当: </span>
            {cleanText(selected.payload?.actor?.org_name_normalized) ||
              cleanText(selected.payload?.department) ||
              unknownDepartmentLabel}
            {' / '}
            {cleanText(selected.payload?.actor?.department_normalized) || cleanText(selected.payload?.department) || unknownDepartmentLabel}
          </div>
          {selected.payload?.description && <div style={{ marginTop: 6 }}>{selected.payload.description}</div>}
          {(selected.payload?.evidence || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 700 }}>根拠</div>
              <ul style={{ paddingLeft: 16, margin: '4px 0' }}>
                {(selected.payload.evidence || []).slice(0, 4).map((ev, idx) => (
                  <li key={idx} style={{ marginBottom: 4 }}>
                    <em>{ev.source_quote || '-'}</em>
                    {ev.page_start != null && <span style={{ color: '#666' }}> (p.{ev.page_start})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {selected.type === 'edge' && selected.payload && (
        <>
          <div>
            <strong>
              {selected.payload.from ?? selected.payload.source} → {selected.payload.to ?? selected.payload.target}
            </strong>
          </div>
          <div style={{ marginTop: 6 }}>
            {dependencyTypeLabels[selected.payload.dependency_type] || selected.payload.dependency_type || '依存'} /{' '}
            {selected.payload.confidence || 'medium'}
          </div>
          <div style={{ marginTop: 6 }}>{selected.payload.reason}</div>
        </>
      )}
      {selected.type === 'group-edge' && selected.payload && (
        <>
          <strong>集約エッジの元依存</strong>
          <div style={{ marginTop: 6 }}>{selected.payload.dependencies.length}件の詳細依存があります。</div>
          <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
            {selected.payload.dependencies.slice(0, 20).map((item, idx) => (
              <li key={idx} style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>
                  {item.endpoints.from} → {item.endpoints.to}
                </div>
                <div>
                  {truncateText(item.fromTask?.name || item.endpoints.from, 18)} →{' '}
                  {truncateText(item.toTask?.name || item.endpoints.to, 18)}
                </div>
                {item.dep?.reason && <div style={{ color: '#64748b' }}>{truncateText(item.dep.reason, 44)}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={onClose} style={{ marginTop: 8 }}>
        閉じる
      </button>
    </div>
  );
}

function FindingPanel({ finding, onClose }) {
  return (
    <div style={panelBoxStyle}>
      <strong>
        {findingTypeLabels[finding.type] || finding.type} / {finding.severity}
      </strong>
      <div style={{ marginTop: 8 }}>{finding.summary}</div>
      <div style={{ marginTop: 8, fontWeight: 700 }}>対象タスク</div>
      <div>{(finding.task_ids || []).join(', ') || 'なし'}</div>
      {(finding.evidence || []).length > 0 && (
        <>
          <div style={{ marginTop: 8, fontWeight: 700 }}>根拠</div>
          <ul style={{ paddingLeft: 16, margin: '4px 0' }}>
            {finding.evidence.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {finding.suggested_fix && (
        <div style={{ marginTop: 8 }}>
          <span style={{ fontWeight: 700 }}>修正案: </span>
          {finding.suggested_fix}
        </div>
      )}
      <button type="button" onClick={onClose} style={{ marginTop: 8 }}>
        閉じる
      </button>
    </div>
  );
}

export default ReactFlowWorkflow;
