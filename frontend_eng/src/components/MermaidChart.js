import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import './MermaidChart.css';

// Mermaidの初期設定
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: '"Noto Sans JP", sans-serif',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis'
  }
});

const MermaidChart = ({ chartCode, onError }) => {
  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
        const { svg } = await mermaid.render(id, chartCode);
        
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