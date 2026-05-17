import React, { useEffect, useRef } from 'react';

function loadX6() {
  if (window.X6 && window.X6.Graph) return Promise.resolve(window.X6);
  if (window.__x6LoadingPromise) return window.__x6LoadingPromise;

  window.__x6LoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-x6-script="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.X6));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.dataset.x6Script = 'true';
    script.async = true;
    script.src = 'https://unpkg.com/@antv/x6@3.1.6/dist/x6.min.js';
    script.onload = () => resolve(window.X6);
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });

  return window.__x6LoadingPromise;
}

function buildX6ModelFromGraphData(graphData) {
  if (
    !graphData ||
    typeof graphData !== 'object' ||
    !Array.isArray(graphData.tasks)
  ) {
    return { nodes: [], edges: [] };
  }

  const tasks = graphData.tasks || [];
  const dependencies = Array.isArray(graphData.dependencies)
    ? graphData.dependencies
    : [];

  // カテゴリごとに行を分ける簡易レイアウト
  const categoryOrder = [];
  const categoryRowIndex = {};

  tasks.forEach((t) => {
    const cat = t.category || 'その他';
    if (!Object.prototype.hasOwnProperty.call(categoryRowIndex, cat)) {
      categoryRowIndex[cat] = categoryOrder.length;
      categoryOrder.push(cat);
    }
  });

  const NODE_X_GAP = 320;
  const NODE_Y_GAP = 220;
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 80;

  const nodes = tasks.map((task, index) => {
    const category = task.category || 'その他';
    const row = categoryRowIndex[category] ?? 0;
    const col = index; // 簡易的にインデックスで横に配置

    const id = String(task.id || task.name || `task_${index}`);

    return {
      id,
      shape: 'rect',
      x: col * NODE_X_GAP,
      y: row * NODE_Y_GAP,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      attrs: {
        body: {
          stroke: '#00205B',
          fill: '#f5f7fb',
          rx: 8,
          ry: 8,
        },
        label: {
          text: task.name || id,
          fontSize: 14,
          fontWeight: 'bold',
          fill: '#111827',
        },
      },
      data: {
        description: task.description || '',
        department: task.department || '',
        category,
      },
    };
  });

  const edges = [];

  dependencies.forEach((dep, index) => {
    if (!dep || !dep.from || !dep.to) return;
    const source = String(dep.from);
    const target = String(dep.to);

    edges.push({
      id: `edge-${source}-${target}-${index}`,
      shape: 'edge',
      source: { cell: source },
      target: { cell: target },
      router: { name: 'manhattan' }, // 直交ルーティングでノードを避けやすくする
      connector: { name: 'rounded' },
      attrs: {
        line: {
          stroke: '#00205B',
          strokeWidth: 2,
          targetMarker: 'classic',
        },
      },
      data: {
        reason: dep.reason || '',
      },
    });
  });

  return { nodes, edges };
}

export default function X6Chart({ graphData }) {
  const containerRef = useRef(null);
  const graphRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    (async () => {
      const X6 = await loadX6();
      if (disposed) return;

      // 初期化（初回のみ）
      if (!graphRef.current) {
        graphRef.current = new X6.Graph({
          container: containerRef.current,
          grid: {
            size: 10,
            visible: true,
          },
          panning: {
            enabled: true,
          },
          mousewheel: {
            enabled: true,
            modifiers: ['ctrl', 'meta'],
          },
          connecting: {
            router: 'manhattan',
            connector: 'rounded',
            allowBlank: false,
            allowLoop: false,
            snap: true,
          },
          interacting: {
            nodeMovable: true,
          },
        });
      }

      const graph = graphRef.current;
      const { nodes, edges } = buildX6ModelFromGraphData(graphData);

      graph.clearCells();
      if (nodes.length || edges.length) {
        graph.fromJSON({ nodes, edges });
        graph.zoomToFit({ padding: 40 });
      }
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('Failed to load X6:', e);
    });

    return () => {
      disposed = true;
    };
  }, [graphData]);

  if (!graphData || !Array.isArray(graphData.tasks) || graphData.tasks.length === 0) {
    return (
      <div style={{ padding: 16, color: '#666', fontSize: 16 }}>
        表示できるノードがありません（タスク・依存関係を確認してください）
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#ffffff',
        borderRadius: 4,
      }}
    />
  );
}

