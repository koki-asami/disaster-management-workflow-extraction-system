import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import './MermaidChart.css';

// Mermaidの初期設定
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: '"Noto Sans JP", sans-serif',
  themeVariables: {
    fontFamily: '"Noto Sans JP", sans-serif',
    fontSize: '18px'
  },
  flowchart: {
    defaultRenderer: 'dagre', // ELK を使わない
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
    nodeSpacing: 30,
    rankSpacing: 50
  }
});

const MermaidChart = ({ chartCode, onError }) => {
  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 横長になりにくいようにレイアウト/方向を補正
  const sanitizeMermaidCode = (code) => {
    if (!code) return code;
    let result = code;
    // flowchart-elk を flowchart に置換
    result = result.replace(/^\s*flowchart-elk\b/mi, 'flowchart');
    // LR/RL を TB/TD に置換（縦方向）
    result = result.replace(/^\s*(graph|flowchart)\s+(LR|RL)\b/mi, (_m, g1) => `${g1} TB`);
    // 明示的な direction 指定を TB に統一
    result = result.replace(/^\s*direction\s+(LR|RL)\b/mi, 'direction TB');
    return result;
  };

  useEffect(() => {
    if (!chartCode || !containerRef.current) return;

    setIsLoading(true);
    setRenderError(null);

    const renderChart = async () => {
      try {
        // コンテナをクリア
        containerRef.current.innerHTML = '';
        
        // ユニークなID生成
        const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
        
        // Mermaidでレンダリング
        const normalized = sanitizeMermaidCode(chartCode);
        const { svg } = await mermaid.render(id, normalized);
        
        // SVGを挿入
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          
          // SVG要素のサイズを調整
          const svgElement = containerRef.current.querySelector('svg');
          if (svgElement) {
            svgElement.style.width = '100%';
            svgElement.style.height = 'auto';
            svgElement.setAttribute('width', '100%');
            svgElement.setAttribute('height', 'auto');
          }
        }
        
        setRenderError(null);
      } catch (error) {
        console.error('Mermaid rendering error:', error);
        setRenderError(error.message || 'フローチャートの描画に失敗しました');
        
        // エラーコールバックがあれば呼び出し
        if (onError) {
          onError(error);
        }
      } finally {
        setIsLoading(false);
      }
    };

    renderChart();
  }, [chartCode, onError]);

  return (
    <div className="mermaid-chart">
      {isLoading && (
        <div className="mermaid-loading">
          <div className="mermaid-spinner"></div>
          <p>フローチャートを描画中...</p>
        </div>
      )}
      
      {renderError && (
        <div className="mermaid-error">
          <p>エラー: {renderError}</p>
          {onError && (
            <button 
              className="retry-button"
              onClick={() => onError(new Error(renderError))}
            >
              再生成
            </button>
          )}
        </div>
      )}
      
      <div 
        ref={containerRef} 
        className={`mermaid-container ${renderError ? 'has-error' : ''}`}
      ></div>
    </div>
  );
};

export default MermaidChart;