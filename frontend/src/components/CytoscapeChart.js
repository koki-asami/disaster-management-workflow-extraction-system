import React, { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';

cytoscape.use(dagre);
cytoscape.use(fcose);

// 画面幅に応じてフォントやノードサイズをスケールさせる簡易ヘルパー
function getScale() {
  if (typeof window === 'undefined') return 1;
  const baseWidth = 1440;
  const w = window.innerWidth || baseWidth;
  const raw = w / baseWidth;
  return Math.min(Math.max(raw, 0.7), 1.2);
}

// カテゴリの色を自動生成する関数
function generateCategoryColors(categories) {
  const colors = {};
  const totalCategories = categories.length;
  
  categories.forEach((category, index) => {
    const hue = (index * 360 / totalCategories) % 360;
    const saturation = 80;
    const lightness = 45;
    
    const h = hue / 360;
    const s = saturation / 100;
    const l = lightness / 100;
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = x => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    colors[category] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  });
  
  return colors;
}

// パステルカラーに変換する関数
function toPastelColor(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  
  const pastelFactor = 0.9;
  const pr = Math.round(r + (255 - r) * pastelFactor);
  const pg = Math.round(g + (255 - g) * pastelFactor);
  const pb = Math.round(b + (255 - b) * pastelFactor);
  
  const toHex = x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(pr)}${toHex(pg)}${toHex(pb)}`;
}

function getLayoutOptions(useDagreLayout = false) {
  if (useDagreLayout) {
    return {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 80,
      rankSep: 120,
      edgeSep: 20,
      ranker: 'tight-tree',
      fit: true,
      padding: 80,
    };
  }

  return {
    name: 'fcose',
    quality: 'proof',
    randomize: false,
    animate: true,
    animationDuration: 1000,
    fit: true,
    padding: 80,
    nodeDimensionsIncludeLabels: true,
    packComponents: true,
    step: 'all',
    // 矢印の重なりを減らすために距離と反発を強めに設定
    nodeRepulsion: 9000,
    idealEdgeLength: 160,
    edgeElasticity: 0.5,
    nestingFactor: 0.1,
    gravity: 0.25,
    gravityRangeCompound: 1.8,
    gravityCompound: 1.0,
    gravityRange: 4.0,
    initialEnergyOnIncremental: 0.3,
    tile: true,
    tilingPaddingVertical: 40,
    tilingPaddingHorizontal: 40
  };
}

function buildElementsFromGraphData(graphData) {
  if (
    !graphData ||
    typeof graphData !== 'object' ||
    !Array.isArray(graphData.tasks)
  ) {
    return { elements: [], categories: [], categoryColors: {} };
  }

  const tasks = graphData.tasks || [];
  const dependencies = graphData.dependencies || [];

  // カテゴリ一覧を抽出（なければ「その他」にまとめる）
  const categoriesSet = new Set();
  tasks.forEach((t) => {
    if (t.category) {
      categoriesSet.add(t.category);
    }
  });
  if (categoriesSet.size === 0) {
    categoriesSet.add('その他');
  }

  const categories = Array.from(categoriesSet);
  const categoryColors = generateCategoryColors(categories);

  const elements = [];

  // 1. カテゴリノード
  categories.forEach((cat) => {
    elements.push({
      group: 'nodes',
      data: {
        id: `category_${cat}`,
        label: cat,
        color: categoryColors[cat],
        isCategory: true,
        type: 'category',
      },
      classes: 'category-node',
    });
  });

  // 2. タスクコンテナ + 詳細ノード
  tasks.forEach((task) => {
    const category = task.category || 'その他';
    const categoryId = `category_${category}`;
    const color = categoryColors[category] || '#4a6fa5';
    const taskId = task.id || task.name || `task_${Math.random().toString(36).slice(2)}`;
    const safeTaskId = String(taskId);

    // タスクコンテナ
    elements.push({
      group: 'nodes',
      data: {
        id: safeTaskId,
        label: task.name || safeTaskId,
        parent: categoryId,
        color: color,
        type: 'task-container',
      },
      classes: 'task-container',
    });

    // 説明ノード
    if (task.description) {
      elements.push({
        group: 'nodes',
        data: {
          id: `${safeTaskId}_desc`,
          label: task.description,
          parent: safeTaskId,
          color: color,
          type: 'description',
        },
        classes: 'detail-node description',
      });
    }

    // 部署ノード
    if (task.department) {
      elements.push({
        group: 'nodes',
        data: {
          id: `${safeTaskId}_dept`,
          label: `担当: ${task.department}`,
          parent: safeTaskId,
          color: color,
          type: 'department',
        },
        classes: 'detail-node department',
      });
    }
  });

  // 3. 依存関係エッジ
  dependencies.forEach((dep) => {
    if (!dep || !dep.from || !dep.to) return;
    const from = String(dep.from);
    const to = String(dep.to);
    const edgeId = `${from}->${to}`;
    elements.push({
      group: 'edges',
      data: {
        id: edgeId,
        source: from,
        target: to,
        reason: dep.reason || '',
      },
    });
  });

  return { elements, categories, categoryColors };
}

function parseMermaidToElements(mermaidCode) {
  if (!mermaidCode || typeof mermaidCode !== 'string') return { elements: [], categories: [], categoryColors: {} };

  // コードフェンスとコメントを除去
  let code = mermaidCode
    .replace(/```mermaid|```/g, '')
    .replace(/%%[^\n]*/g, '');

  const lines = code.split('\n');
  const stack = []; // { name, indent, type } - type: 'category' | 'task'
  const categoriesSet = new Set();
  const tasks = new Map(); // taskId -> { label, category, desc, dept }
  const compoundNodes = new Map(); // taskId -> { label, category } (for 2nd level task containers)
  const edges = [];

  const baseId = (id) => cleanName(id).replace(/_(desc|dept|label)$/, '').replace(/^description_|^department_/, '');

  // 矢印トークンを除去してタスク名をクリーンにするヘルパー
  const cleanName = (name) => name.replace(/\s*-{2,3}>\s*/g, ' ').trim();

  const ensureTaskContainer = (id, label, category) => {
    const key = baseId(id);
    if (!compoundNodes.has(key)) {
      compoundNodes.set(key, { 
        id: key, 
        label: label || key, 
        category: category 
      });
    }
  };

  lines.forEach((rawLine) => {
    const indent = rawLine.match(/^\s*/)?.[0].length || 0;
    const line = rawLine.trim();
    if (!line) return;

    // diagram 宣言や方向指定は無視
    if (/^(flowchart-elk|flowchart|graph)\b/i.test(line)) return;
    if (/^direction\s+/i.test(line)) return;

    // インデントに基づき stack を調整
    if (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
    }

    // subgraph 開始
    const subMatch = line.match(/^subgraph\s+(.+)$/i);
    if (subMatch) {
      const name = subMatch[1].trim();
      const type = stack.length === 0 ? 'category' : 'task';
      
      stack.push({ name, indent, type });
      
      if (type === 'category') {
        categoriesSet.add(name);
      } else {
        // 2階層目はタスクコンテナとして登録
        const category = stack[0].name;
        ensureTaskContainer(name, name, category);
      }
      return;
    }

    // subgraph 終了
    if (/^end$/i.test(line)) {
      stack.pop();
      return;
    }

    const currentCategory = stack.find(s => s.type === 'category')?.name || null;
    const currentTask = stack.find(s => s.type === 'task')?.name || null;

    // エッジ: A --> B
    const edgeMatch = line.match(/^\s*(.+?)\s*-{2,3}>\s*(.+?)\s*$/);
    if (edgeMatch) {
      const srcRaw = edgeMatch[1].trim();
      const tgtRaw = edgeMatch[2].trim();
      if (srcRaw && tgtRaw) {
        const src = baseId(srcRaw);
        const tgt = baseId(tgtRaw);
        
        // エッジの両端はタスクコンテナとして扱う
        if (!compoundNodes.has(src)) ensureTaskContainer(src, src, currentCategory);
        if (!compoundNodes.has(tgt)) ensureTaskContainer(tgt, tgt, currentCategory);
        
        const edgeId = `${src}->${tgt}`;
        if (!edges.find((e) => e.data.id === edgeId)) {
          edges.push({ data: { id: edgeId, source: src, target: tgt } });
        }
      }
      return;
    }

    // ノード定義: タスク / 説明 / 担当
    // eslint-disable-next-line no-useless-escape
    const nodeMatch = line.match(/^([^\s\[\]"=]+)\s*(?:\[|\(|\{|\(\()?\s*["']?([^"\])}]*)["']?\s*(?:\]|\)|\}|\)\))?/);
    if (nodeMatch && nodeMatch[1]) {
      const idRaw = cleanName(nodeMatch[1].trim());
      const label = (nodeMatch[2] || '').trim();
      const key = baseId(idRaw);

      // description_XX や department_XX は子ノードとして扱う
      if (/_desc$/.test(idRaw) || /^description_/.test(idRaw)) {
        // 説明ノード (統合処理)
        const taskId = currentTask || key;
        ensureTaskContainer(taskId, taskId, currentCategory);
        
        const existingTask = tasks.get(`${taskId}_desc`) || {
          id: `${taskId}_desc`,
          label: '',
          parent: taskId,
          type: 'description',
          category: currentCategory
        };
        
        // 既存の説明があれば改行で結合
        existingTask.label = existingTask.label ? `${existingTask.label}\n${label}` : label;
        tasks.set(`${taskId}_desc`, existingTask);

      } else if (/_dept$/.test(idRaw) || /^department_/.test(idRaw)) {
        // 担当ノード (統合処理)
        const taskId = currentTask || key;
        ensureTaskContainer(taskId, taskId, currentCategory);
        
        const deptText = label.replace(/^担当[:：]\s*/, '');
        const existingTask = tasks.get(`${taskId}_dept`) || {
          id: `${taskId}_dept`,
          label: '',
          parent: taskId,
          type: 'department',
          category: currentCategory
        };

        // 既存の担当があればカンマなどで結合するか、あるいは改行で結合
        existingTask.label = existingTask.label 
          ? `${existingTask.label}、${deptText}` 
          : `担当: ${deptText}`;
        tasks.set(`${taskId}_dept`, existingTask);

      } else {
        // 通常ノード定義（タスクコンテナのラベル更新など）
        if (currentTask) {
           // currentTask内にある別名ノードなら、それはコンテナの一部とはみなさず、単純な情報ノードとするか、
           // あるいはMermaidの記述的にタスク名そのものの定義である場合が多い
           ensureTaskContainer(currentTask, label || currentTask, currentCategory);
        } else {
           ensureTaskContainer(key, label || key, currentCategory);
        }
      }
      return;
    }
  });

  const categories = Array.from(categoriesSet);
  const categoryColors = generateCategoryColors(categories);
  const elements = [];

  // 1. カテゴリノード (最上位)
  categories.forEach((cat) => {
    elements.push({
      group: 'nodes',
      data: {
        id: cat,
        label: cat,
        color: categoryColors[cat],
        isCategory: true,
        type: 'category'
      },
      classes: 'category-node'
    });
  });

  // 2. タスクコンテナノード (2階層目)
  compoundNodes.forEach((node) => {
    const parent = node.category;
    const color = parent ? categoryColors[parent] : '#00205B';
    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.label,
        parent: parent,
        color: color,
        type: 'task-container'
      },
      classes: 'task-container'
    });
  });

  // 3. 詳細ノード (説明・担当)
  tasks.forEach((task) => {
    const parent = task.parent; // タスクコンテナID
    // 親が存在しない場合は追加しない（孤立ノード回避）
    if (!parent || !compoundNodes.has(parent)) return;

    const category = task.category;
    const color = category ? categoryColors[category] : '#00205B';
    
    elements.push({
      group: 'nodes',
      data: {
        id: task.id,
        label: task.label,
        parent: parent,
        color: color,
        type: task.type
      },
      classes: `detail-node ${task.type}`
    });
  });

  // エッジ
  edges.forEach((edge) => elements.push(edge));

  return { elements, categories, categoryColors };
}

export default function CytoscapeChart({ mermaidCode, graphData, useDagreLayout = false }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [hoveredEdgeInfo, setHoveredEdgeInfo] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // JSONグラフデータがある場合は優先して使用し、なければMermaidをパース
    const {
      elements,
      categories,
      categoryColors,
      // eslint-disable-next-line no-unused-vars
    } = graphData && Array.isArray(graphData.tasks)
      ? buildElementsFromGraphData(graphData)
      : parseMermaidToElements(mermaidCode);

    // 要素が取れない場合は簡易プレースホルダーを表示
    if (!elements || elements.length === 0) {
      containerRef.current.innerHTML = '<div style="padding:16px;color:#666;font-size:24px;">表示できるノードがありません（Mermaidコードを確認してください）</div>';
      return () => {};
    }

    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const scale = getScale();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      pixelRatio: window.devicePixelRatio || 1,
      renderer: {
        name: 'canvas',
        options: {
          highQuality: true,
          pixelRatio: window.devicePixelRatio || 1
        }
      },
      style: [
        {
          selector: 'node.category-node',
          style: {
            'background-color': '#f8f9fa',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 4 * scale,
            'text-valign': 'top',
            'text-halign': 'center',
            'font-weight': 'bold',
            'font-size': 36 * scale,
            'padding': 28 * scale
          }
        },
        {
          selector: 'node.task-container',
          style: {
            'background-color': function(ele) {
              const color = ele.data('color') || '#00205B';
              return toPastelColor(color);
            },
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 2 * scale,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': 26 * scale,
            'font-weight': 'bold',
            'padding': 10 * scale,
            'min-width': 240 * scale,
            'min-height': 70 * scale,
            'text-margin-y': -8 * scale
          }
        },
        {
          selector: ':parent',
          style: {
            'background-color': '#f8f9fa',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 4 * scale,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-weight': 'bold',
            'font-size': 30 * scale,
            'padding': 20 * scale,
            'text-margin-y': -16 * scale
          }
        },
        {
          selector: 'node.detail-node',
          style: {
            'background-color': 'white',
            'background-opacity': 0.9,
            'border-width': 0,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': 600 * scale,
            'font-size': 20 * scale,
            'color': '#333333',
            'text-outline-width': 0,
            'text-background-opacity': 0,
            'shape': 'rectangle',
            'width': 'label',
            'height': 'label',
            'padding': 16 * scale
          }
        },
        {
          selector: 'node.description',
          style: {
            'font-weight': 'normal',
            'font-size': 18 * scale,
            'line-height': 1.4
          }
        },
        {
          selector: 'node.department',
          style: {
            'font-weight': 'bold',
            'font-size': 16 * scale,
            'color': '#555555'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 6 * scale,
            'line-color': function(ele) {
              const sourceNode = ele.source();
              return sourceNode.data('color') || '#00205B';
            },
            'target-arrow-color': function(ele) {
              const sourceNode = ele.source();
              return sourceNode.data('color') || '#00205B';
            },
            'target-arrow-shape': 'triangle',
            'curve-style': 'unbundled-bezier',
            'edge-distances': 'node-position',
            'control-point-step-size': 40 * scale,
            'arrow-scale': 1.4 * scale,
            'line-cap': 'round',
            'line-join': 'round'
          }
        },
        {
          selector: ':parent',
          style: {
            'background-color': '#f8f9fa',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 6 * scale,
            'text-valign': 'top',
            'text-halign': 'center',
            'text-max-width': 1200 * scale,
            'width': 1200 * scale,
            'font-weight': 'bold',
            'font-size': 24 * scale,
            'padding': 40 * scale,
            'text-margin-y': 12 * scale,
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': 16 * scale,
            'text-border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'text-border-width': 2 * scale,
            'text-border-opacity': 1,
            'text-outline-width': 0,
            'text-outline-color': 'transparent',
            'text-transform': 'none',
            'font-family': 'Arial, sans-serif',
            'font-style': 'normal',
            'text-margin-x': 16 * scale
          }
        },
        {
          selector: ':selected',
          style: {
            'border-width': 4,
            'border-color': '#2563EB',
            'line-color': '#2563EB',
            'target-arrow-color': '#2563EB'
          }
        }
      ],
      layout: getLayoutOptions(useDagreLayout),
      wheelSensitivity: 0.5, // 感度を上げてトラックパッドでのズームをしやすくする
      userZoomingEnabled: true,
      zoomingEnabled: true,
      userPanningEnabled: true,
      panningEnabled: true,
      boxSelectionEnabled: false,
      selectionType: 'single',
      touchTapThreshold: 8,
      desktopTapThreshold: 4,
      autolock: false,
      autoungrabify: false,
      autounselectify: false
    });

    cy.one('render', () => {
      try {
        cy.fit(undefined, 50);
      } catch (e) {}
    });

    // トラックパッドでのズーム対応
    const container = containerRef.current;
    const handleWheel = (e) => {
      // Macのトラックパッド等では、ピンチ操作はctrlKey+wheelとして検知されることが多い
      // または、単純な2本指スクロールもwheelとして来る
      // ここではブラウザのスクロールを防いでCytoscapeのズームを適用する
      e.preventDefault();
      
      const zoom = cy.zoom();
      const delta = e.deltaY;
      
      // 感度調整: 小さなdeltaでも反応するように
      const sensitivity = 0.001;
      const factor = 1 - delta * sensitivity;
      
      const newZoom = zoom * factor;
      
      // ズーム範囲制限
      if (newZoom > 0.1 && newZoom < 10) {
        cy.zoom({
          level: newZoom,
          renderedPosition: { x: e.offsetX, y: e.offsetY }
        });
      }
    };

    // コンテナに直接イベントリスナーを追加 (passive: false で preventDefault を有効化)
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    // エッジホバー時の理由ツールチップ表示
    const handleEdgeMouseOver = (event) => {
      const edge = event.target;
      const reason = edge.data('reason');
      if (!reason) return;
      const fromLabel = edge.source().data('label') || edge.data('source');
      const toLabel = edge.target().data('label') || edge.data('target');
      setHoveredEdgeInfo({
        fromLabel,
        toLabel,
        reason,
      });
    };

    const handleEdgeMouseOut = () => {
      setHoveredEdgeInfo(null);
    };

    cy.on('mouseover', 'edge', handleEdgeMouseOver);
    cy.on('mouseout', 'edge', handleEdgeMouseOut);

    cyRef.current = cy;
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
      if (cyRef.current) {
        cyRef.current.off('mouseover', 'edge', handleEdgeMouseOver);
        cyRef.current.off('mouseout', 'edge', handleEdgeMouseOut);
      }
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [mermaidCode, graphData]);

  return (
    <div
      className="cyto-display"
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '70vh', 
        background: '#fff', 
        border: '1px solid #e0e0e0', 
        borderRadius: 4,
        fontFamily: 'Arial, sans-serif',
        fontSize: '1rem',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale'
      }}
    >
      {hoveredEdgeInfo && (
        <div className="edge-reason-tooltip">
          <div className="edge-reason-title">
            依存関係: {hoveredEdgeInfo.fromLabel} → {hoveredEdgeInfo.toLabel}
          </div>
          <div className="edge-reason-body">
            理由: {hoveredEdgeInfo.reason}
          </div>
        </div>
      )}
    </div>
  );
}


