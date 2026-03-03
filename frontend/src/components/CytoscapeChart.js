import React, { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import coseBilkent from 'cytoscape-cose-bilkent';
import noOverlap from 'cytoscape-no-overlap';

cytoscape.use(dagre);
cytoscape.use(fcose);
cytoscape.use(coseBilkent);
if (typeof window !== 'undefined' && !window.__cytoscapeNoOverlapRegistered) {
  cytoscape.use(noOverlap);
  window.__cytoscapeNoOverlapRegistered = true;
}

// 画面幅に応じてフォントやノードサイズをスケールさせる簡易ヘルパー
function getScale() {
  if (typeof window === 'undefined') return 1;
  const baseWidth = 1440;
  const w = window.innerWidth || baseWidth;
  const raw = w / baseWidth;
  return Math.min(Math.max(raw, 0.7), 1.2);
}

// 線分とノード矩形（バウンディングボックス）の当たり判定用ヘルパー
function pointToSegmentDistanceSquared(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) {
    return wx * wx + wy * wy;
  }

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const dx = px - x2;
    const dy = py - y2;
    return dx * dx + dy * dy;
  }

  const b = c1 / c2;
  const bx = x1 + b * vx;
  const by = y1 + b * vy;
  const dx = px - bx;
  const dy = py - by;
  return dx * dx + dy * dy;
}

function edgeIntersectsNodeRough(edge, node, padding = 20) {
  const srcPos = edge.source().position();
  const tgtPos = edge.target().position();
  const bb = node.boundingBox();

  const cx = (bb.x1 + bb.x2) / 2;
  const cy = (bb.y1 + bb.y2) / 2;
  const dist2 = pointToSegmentDistanceSquared(
    cx,
    cy,
    srcPos.x,
    srcPos.y,
    tgtPos.x,
    tgtPos.y
  );
  return dist2 <= padding * padding;
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

function getLayoutOptions(useDagreLayout = false) {
  // 画面幅に応じてレイアウト距離・余白をスケーリング
  if (useDagreLayout) {
    return {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 80,
      rankSep: 120,
      edgeSep: 20,
      ranker: 'tight-tree',
      fit: true,
      padding: 10,
      nodeDimensionsIncludeLabels: true,
    };
  }

  // デフォルト: fcose（同一カテゴリ内のノードを近づけ、エッジを短く）
  return {
    name: 'fcose',
    animate: true,
    randomize: false,
    fit: true,
    padding: 30,
    idealEdgeLength: 80,
    nodeRepulsion: 600,
    nodeSeparation: 50,
    packComponents: true,
    nodeDimensionsIncludeLabels: true,
    // 同一カテゴリ（compound）内のノードを密に配置してエッジを短く
    nestingFactor: 1,
    compoundGravity: 2,
    compoundGravityRange: 1.5,
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
  const dependencies = Array.isArray(graphData.dependencies)
    ? graphData.dependencies
    : [];

  // カテゴリ一覧とカテゴリごとのタスク数を集計
  const categoriesSet = new Set();
  const categoryCounts = {};
  tasks.forEach((t) => {
    const cat = t.category || 'その他';
    categoriesSet.add(cat);
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  if (categoriesSet.size === 0) {
    categoriesSet.add('その他');
    categoryCounts['その他'] = 0;
  }

  const categories = Array.from(categoriesSet);
  const categoryColors = generateCategoryColors(categories);

  const elements = [];

  // 1. カテゴリノード（タスクが1つ以上あれば枠を描画）
  categories.forEach((cat) => {
    if ((categoryCounts[cat] || 0) < 1) {
      return;
    }
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

  // 2. タスクコンテナ（カテゴリ枠内に配置）
  tasks.forEach((task) => {
    const category = task.category || 'その他';
    const categoryId = `category_${category}`;
    const color = categoryColors[category] || '#4a6fa5';
    const taskId = task.id || task.name || `task_${Math.random().toString(36).slice(2)}`;
    const safeTaskId = String(taskId);

    // タスクコンテナ（ホバー用に説明・担当を data に保持）、タスク名は10文字区切りで改行
    elements.push({
      group: 'nodes',
      data: {
        id: safeTaskId,
        label: wrapTextEveryN(task.name || safeTaskId, 10),
        parent: categoryId,
        color: color,
        type: 'task-container',
        description: task.description || '',
        department: task.department || '',
      },
      classes: 'task-container',
    });
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

// 指定文字数ごとに改行を挿入
function wrapTextEveryN(text, n) {
  if (!text || typeof text !== 'string') return text;
  const chars = Array.from(text);
  const lines = [];
  for (let i = 0; i < chars.length; i += n) {
    lines.push(chars.slice(i, i + n).join(''));
  }
  return lines.join('\n');
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

  // 2. タスクコンテナノード (2階層目)、タスク名は10文字区切りで改行
  compoundNodes.forEach((node) => {
    const parent = node.category;
    const color = parent ? categoryColors[parent] : '#00205B';
    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: wrapTextEveryN(node.label, 10),
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

// デフォルトは fcose（力学系）レイアウト
export default function CytoscapeChart({ mermaidCode, graphData, useDagreLayout = false }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [hoveredEdgeInfo, setHoveredEdgeInfo] = useState(null);
  const [hoveredTaskInfo, setHoveredTaskInfo] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    // JSONグラフデータがある場合は優先して使用し、なければMermaidをパース
    const { elements } = graphData && Array.isArray(graphData.tasks)
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
            'shape': 'rectangle',
            'background-color': '#f8f9fa',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 4 * scale,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-weight': 'bold',
            'font-size': 22,
            'padding': 28 * scale
          }
        },
        {
          selector: 'node.task-container',
          style: {
            'shape': 'rectangle',
            'background-color': '#ffffff',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 2 * scale,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 17,
            'font-weight': 'bold',
            'color': '#111827',
            'padding': 14 * scale,
            'width': 200 * scale,
            'height': 'label',
            'text-wrap': 'wrap',
            'text-max-width': 172 * scale,
            'line-height': 1.4
          }
        },
        {
          selector: 'node.detail-node',
          style: {
            // タスクの説明・担当部署ノードはレイアウト計算用／データ保持用に残しつつ、
            // 画面上には表示しない
            'display': 'none'
          }
        },
        {
          selector: 'node.description',
          style: {
            'font-weight': 'normal',
            'font-size': 20 * scale,
            'line-height': 1.5
          }
        },
        {
          selector: 'node.department',
          style: {
            'font-weight': 'bold',
            'font-size': 18 * scale,
            'color': '#555555'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2 * scale,
            'line-color': '#d1d5db',
            'target-arrow-color': '#d1d5db',
            'target-arrow-shape': 'triangle',
            'curve-style': 'straight',
            'arrow-scale': 1.4 * scale,
            'line-cap': 'round'
          }
        },
        {
          selector: 'edge.edge-hovered',
          style: {
            'line-color': function(ele) {
              const sourceNode = ele.source();
              return sourceNode.data('color') || '#00205B';
            },
            'target-arrow-color': function(ele) {
              const sourceNode = ele.source();
              return sourceNode.data('color') || '#00205B';
            }
          }
        },
        {
          // ノードを避ける必要があるエッジのみ折れ線にする
          selector: 'edge[avoid = "true"]',
          style: {
            'curve-style': 'segments',
            'segment-distances': [-40 * scale, 40 * scale],
            'segment-weights': [0.25, 0.75]
          }
        },
        {
          selector: ':parent',
          style: {
            'shape': 'rectangle',
            'background-color': '#f8f9fa',
            'border-color': function(ele) {
              return ele.data('color') || '#00205B';
            },
            'border-width': 4 * scale,
            'text-valign': 'top',
            'text-halign': 'center',
            'padding': 28 * scale,
            'font-weight': 'bold',
            'font-size': 22
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

    const recomputeAvoidEdges = () => {
      try {
        const nodes = cy.nodes();
        const nodeArr = nodes.toArray();
        cy.edges().forEach((edge) => {
          // いったんリセット
          edge.data('avoid', 'false');
          const srcId = edge.source().id();
          const tgtId = edge.target().id();
          for (let i = 0; i < nodeArr.length; i += 1) {
            const n = nodeArr[i];
            const nid = n.id();
            // 始点・終点とカテゴリノード（大きな枠）は対象外にする
            if (nid === srcId || nid === tgtId) continue;
            if (n.hasClass('category-node')) continue;
            if (edgeIntersectsNodeRough(edge, n, 30)) {
              edge.data('avoid', 'true');
              break;
            }
          }
        });
      } catch (e) {
        // 失敗しても描画自体には影響しないので握りつぶす
      }
    };

    let userHasMovedNodes = false;
    cy.on('grab', 'node', () => { userHasMovedNodes = true; });

    const applyNoOverlap = () => {
      if (userHasMovedNodes) return;
      try {
        const movable = cy.nodes();
        if (typeof movable.noOverlap === 'function') {
          movable.noOverlap({ padding: 20 * scale, iterations: 100 });
        }
      } catch (e) {
        // 拡張未登録時などは握りつぶす
      }
    };

    const applyCategoryPositioning = () => {
      try {
        const taskToCategory = new Map();
        cy.nodes('.task-container').forEach((n) => {
          const parent = n.parent();
          if (parent && parent.length > 0) {
            const pid = parent.id();
            if (pid.startsWith('category_')) {
              taskToCategory.set(n.id(), pid);
            }
          }
        });

        const getCategory = (nodeId) => {
          const pid = taskToCategory.get(nodeId);
          return pid ? pid.replace(/^category_/, '') : null;
        };

        const internalOutdegree = new Map();
        const externalDegree = new Map();
        cy.edges().forEach((e) => {
          const src = e.source().id();
          const tgt = e.target().id();
          const srcCat = getCategory(src);
          const tgtCat = getCategory(tgt);
          if (!srcCat || !tgtCat) return;

          const sameCat = srcCat === tgtCat;
          if (sameCat) {
            internalOutdegree.set(src, (internalOutdegree.get(src) || 0) + 1);
          } else {
            externalDegree.set(src, (externalDegree.get(src) || 0) + 1);
            externalDegree.set(tgt, (externalDegree.get(tgt) || 0) + 1);
          }
        });

        cy.nodes('.category-node').forEach((catNode) => {
          const children = catNode.children('.task-container');
          if (children.length === 0) return;

          const bb = catNode.boundingBox();
          const pad = 30 * scale;

          const scored = children.toArray().map((n) => {
            const id = n.id();
            const internal = internalOutdegree.get(id) || 0;
            const external = externalDegree.get(id) || 0;
            const edgeRatio = external / (internal + external + 1);
            return { node: n, internal, external, edgeRatio };
          });

          scored.sort((a, b) => {
            if (Math.abs(a.edgeRatio - b.edgeRatio) < 0.01) {
              return b.internal - a.internal;
            }
            return a.edgeRatio - b.edgeRatio;
          });

          const centerCount = Math.max(1, Math.floor(scored.length * 0.4));
          const centerNodes = scored.slice(0, centerCount);
          const edgeNodes = scored.slice(centerCount);

          const nodeW = 220 * scale;
          const nodeH = 48 * scale;
          const gap = 24 * scale;
          const centerCols = Math.max(1, Math.ceil(Math.sqrt(centerCount)));
          const centerW = nodeW + gap;
          const edgeCols = edgeNodes.length || 1;
          const edgeW = edgeNodes.length > 0 ? (bb.w - pad * 2) / edgeCols : centerW;

          centerNodes.forEach((s, i) => {
            const col = i % centerCols;
            const row = Math.floor(i / centerCols);
            const nx = bb.x1 + pad + centerW * col + nodeW / 2;
            const ny = bb.y1 + pad + (nodeH + gap) * row + nodeH / 2;
            s.node.position({ x: nx, y: ny });
          });

          const bottomY = bb.y2 - pad - nodeH / 2;
          edgeNodes.forEach((s, i) => {
            const nx = bb.x1 + pad + edgeW * i + edgeW / 2;
            s.node.position({ x: nx, y: bottomY });
          });
        });
      } catch (e) {
        // 失敗時は握りつぶす
      }
    };

    const applyViewportPosition = () => {
      if (!containerRef.current) return;
      const eles = cy.elements();
      // extent（縦横の最大最小）から中心を算出してfitで配置
      const padding = Math.round(10 * scale);
      const topPadding = Math.round(10 * scale);
      const bottomPadding = Math.round(30 * scale);
      cy.fit(eles, padding);
      const panY = (bottomPadding - topPadding) / 2;
      cy.panBy({ x: 0, y: panY });
    };

    cy.one('render', () => {
      try {
        const padding = Math.round(5 * scale);
        cy.fit(undefined, padding);
        recomputeAvoidEdges();
        applyNoOverlap();
        applyCategoryPositioning();
        cy.fit(undefined, padding);
        requestAnimationFrame(() => {
          requestAnimationFrame(applyViewportPosition);
        });
      } catch (e) {}
    });

    cy.on('layoutstop', () => {
      recomputeAvoidEdges();
    });

    const updateTooltipPosition = (event) => {
      const ev = event.originalEvent;
      const c = containerRef.current;
      if (!ev || !c) return;
      const rect = c.getBoundingClientRect();
      setTooltipPosition({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
      });
    };

    const handleNodeMouseOver = (event) => {
      const node = event.target;
      const type = node.data('type');
      if (type !== 'task-container') return;
      updateTooltipPosition(event);
      setHoveredTaskInfo({
        label: node.data('label') || node.id(),
        description: node.data('description') || '',
        department: node.data('department') || '',
      });
    };

    const handleNodeMouseOut = (event) => {
      const node = event.target;
      const type = node.data('type');
      if (type !== 'task-container') return;
      setHoveredTaskInfo(null);
    };

    cy.on('mouseover', 'node', handleNodeMouseOver);
    cy.on('mouseout', 'node', handleNodeMouseOut);

    // トラックパッドでのズーム対応
    const container = containerRef.current;
    const handleWheel = (e) => {
      e.preventDefault();
      
      const zoom = cy.zoom();
      const delta = e.deltaY;
      const sensitivity = 0.001;
      const factor = 1 - delta * sensitivity;
      const newZoom = zoom * factor;
      
      // ズーム中心をコンテナ基準で算出（ウィンドウサイズに応じてスケール）
      const rect = container?.getBoundingClientRect();
      const zoomCenterYOffset = 50 * getScale(); // ズーム中心を少し下に
      const px = rect ? e.clientX - rect.left : e.offsetX;
      const py = rect ? e.clientY - rect.top + zoomCenterYOffset : e.offsetY + zoomCenterYOffset;
      
      if (newZoom > 0.1 && newZoom < 10) {
        cy.zoom({
          level: newZoom,
          renderedPosition: { x: px, y: py }
        });
      }
    };

    // コンテナに直接イベントリスナーを追加 (passive: false で preventDefault を有効化)
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    // エッジホバー時の色変更と理由ツールチップ表示
    const handleEdgeMouseOver = (event) => {
      const edge = event.target;
      edge.addClass('edge-hovered');
      const reason = edge.data('reason');
      if (!reason) return;
      updateTooltipPosition(event);
      const fromLabel = edge.source().data('label') || edge.data('source');
      const toLabel = edge.target().data('label') || edge.data('target');
      setHoveredEdgeInfo({
        fromLabel,
        toLabel,
        reason,
      });
    };

    const handleEdgeMouseOut = (event) => {
      event.target.removeClass('edge-hovered');
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
        cyRef.current.off('mouseover', 'node', handleNodeMouseOver);
        cyRef.current.off('mouseout', 'node', handleNodeMouseOut);
      }
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [mermaidCode, graphData, useDagreLayout]);

  return (
    <div
      className="cyto-display"
      style={{ 
        position: 'relative',
        width: '100%', 
        height: '85vh', 
        background: '#fff', 
        border: '1px solid #e0e0e0', 
        borderRadius: 4,
        fontFamily: 'Arial, sans-serif',
        fontSize: '1rem',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale'
      }}
    >
      {/* Cytoscape専用コンテナ（Reactは子を描画しない） */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* ツールチップはCytoscapeコンテナ外でReactが管理 */}
      {hoveredEdgeInfo && (
        <div
          className="edge-reason-tooltip"
          style={{
            left: tooltipPosition.x + 12,
            top: tooltipPosition.y + 12,
          }}
        >
          <div className="edge-reason-title">
            依存関係: {hoveredEdgeInfo.fromLabel} → {hoveredEdgeInfo.toLabel}
          </div>
          <div className="edge-reason-body">
            理由: {hoveredEdgeInfo.reason}
          </div>
        </div>
      )}
      {hoveredTaskInfo && (
        <div
          className="edge-reason-tooltip"
          style={{
            left: tooltipPosition.x + 12,
            top: tooltipPosition.y + 12,
          }}
        >
          <div className="edge-reason-title">
            タスク概要: {hoveredTaskInfo.label}
          </div>
          <div className="edge-reason-body">
            {hoveredTaskInfo.description && (
              <>
                <strong>説明:</strong> {hoveredTaskInfo.description}
                {hoveredTaskInfo.department && <br />}
              </>
            )}
            {hoveredTaskInfo.department && (
              <><strong>担当:</strong> {hoveredTaskInfo.department}</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


