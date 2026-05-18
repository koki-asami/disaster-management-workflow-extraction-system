import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';

// graphData: { tasks, dependencies, ... }
function buildNodesAndEdgesFromGraphData(graphData) {
  if (
    !graphData ||
    typeof graphData !== 'object' ||
    !Array.isArray(graphData.tasks)
  ) {
    return { nodes: [], edges: [] };
  }

  const tasks = graphData.tasks || [];
  const dependencies = graphData.dependencies || [];

  // カテゴリごとに行を分けた簡易グリッドレイアウト
  const categoryOrder = [];
  const categoryRowIndex = {};

  tasks.forEach((t) => {
    const cat = t.category || 'その他';
    if (!categoryRowIndex.hasOwnProperty(cat)) {
      categoryRowIndex[cat] = categoryOrder.length;
      categoryOrder.push(cat);
    }
  });

  const NODE_X_GAP = 400;
  const NODE_Y_GAP = 260;

  const nodes = tasks.map((task, index) => {
    const category = task.category || 'その他';
    const row = categoryRowIndex[category] ?? 0;
    const col = index; // 簡易的にインデックスで横に並べる

    const id = String(task.id || task.name || `task_${index}`);

    return {
      id,
      position: {
        x: col * NODE_X_GAP,
        y: row * NODE_Y_GAP,
      },
      data: {
        label: task.name || id,
        description: task.description || '',
        department: task.department || '',
        category,
      },
      type: 'default',
    };
  });

  const edges = [];

  dependencies.forEach((dep, index) => {
    if (!dep || !dep.from || !dep.to) return;
    const source = String(dep.from);
    const target = String(dep.to);
    const id = `edge-${source}-${target}-${index}`;

    edges.push({
      id,
      source,
      target,
      type: 'step',
      animated: false,
      data: {
        reason: dep.reason || '',
      },
    });
  });

  return { nodes, edges };
}

export default function ReactFlowChart({ graphData }) {
  const { nodes, edges } = useMemo(
    () => buildNodesAndEdgesFromGraphData(graphData),
    [graphData]
  );

  if (!nodes.length && !edges.length) {
    return (
      <div style={{ padding: 16, color: '#666', fontSize: 16 }}>
        表示できるノードがありません（タスク・依存関係を確認してください）
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', background: '#ffffff' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e0e0e0" />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}

