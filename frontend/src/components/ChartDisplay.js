import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import html2canvas from 'html2canvas';
import './ChartDisplay.css';
import SaveFlowchartModal from './SaveFlowchartModal';
import CytoscapeChart from './CytoscapeChart';

// Mermaidの初期化設定
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
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

function ChartDisplay({ chartCode, onRetryRequest, onCodeUpdate, savedChart, fileId}) {
  const chartRef = useRef(null);
  const panZoomRef = useRef(null);
  const cleanupRef = useRef(null);
  const [isRendered, setIsRendered] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [activeTab, setActiveTab] = useState('cyto'); // chart
  const [editableCode, setEditableCode] = useState('');
  const [isMounted, setIsMounted] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [svgContent, setSvgContent] = useState(null);

  // クリーンアップ関数の設定
  const setupCleanup = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    cleanupRef.current = () => {
      if (panZoomRef.current) {
        try {
          panZoomRef.current.destroy();
        } catch (e) {
          console.warn('Failed to destroy pan-zoom instance:', e);
        }
        panZoomRef.current = null;
      }
      setSvgContent(null);
    };
  }, []);

  // SVGのパンズーム機能を初期化する関数
  const initPanZoom = useCallback((svgElement) => {
    if (!svgElement || !isMounted) return null;
    
    try {
      const bbox = svgElement.getBBox();
      if (bbox.width === 0 || bbox.height === 0) {
        console.warn('SVG has zero dimensions, skipping pan-zoom initialization');
        return null;
      }
      
      const viewBox = svgElement.getAttribute('viewBox');
      if (!viewBox) {
        const width = Math.max(100, bbox.width + 10);
        const height = Math.max(100, bbox.height + 10);
        svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }
      
      const pz = svgPanZoom(svgElement, {
        zoomEnabled: true,
        controlIconsEnabled: true,
        fit: true,
        center: true,
        minZoom: 0.1,
        maxZoom: 10,
        zoomScaleSensitivity: 0.3,
        beforeZoom: () => {
          try {
            const ctm = svgElement.getCTM();
            if (ctm && (ctm.a === 0 || ctm.d === 0)) {
              console.warn('Invalid CTM detected, resetting view');
              return false;
            }
          } catch (e) {
            console.warn('Error checking CTM:', e);
            return false;
          }
          return true;
        }
      });
      
      setTimeout(() => {
        if (pz && isMounted) {
          try {
            pz.resize();
            pz.fit();
            pz.center();
          } catch (e) {
            console.warn('Error during initial pan-zoom setup:', e);
          }
        }
      }, 200);
      
      return pz;
    } catch (error) {
      console.error('SVG Pan Zoom initialization error:', error);
      return null;
    }
  }, [isMounted]);

  // チャートをレンダリングする関数
  const renderChart = useCallback(async (code) => {
    if (!code || !isMounted) return;

    try {
      
      setupCleanup();
      console.log("renderChart");
      // 横長になりにくいようにレイアウト/方向を補正
      const normalize = (src) => {
        let t = src || '';
        t = t.replace(/^\s*flowchart-elk\b/mi, 'flowchart');
        t = t.replace(/^\s*(graph|flowchart)\s+(LR|RL)\b/mi, (_m, g1) => `${g1} TB`);
        t = t.replace(/^\s*direction\s+(LR|RL)\b/mi, 'direction TB');
        return t;
      };
      const normalized = normalize(code);
      const { svg } = await mermaid.render('mermaid-chart', normalized);
      setSvgContent(svg);
      
      setIsRendered(true);
      setRenderError(null);
      setRetryCount(0);
    } catch (error) {
      console.error('Mermaid rendering error:', error);
      if (isMounted) {
        setRenderError(error);
        setIsRendered(false);
        
        if (retryCount < 3 && onRetryRequest) {
          setRetryCount(prevCount => prevCount + 1);
          console.log(`Retrying chart generation (attempt ${retryCount + 1}/3)...`);
          onRetryRequest(error);
        } else {
          setSvgContent(`
            <div class="chart-error">
              <h3>ワークフローの描画に失敗しました</h3>
              <p>エラー: ${error.message}</p>
              <pre>${code}</pre>
            </div>
          `);
        }
      }
    }
  }, [isMounted, onRetryRequest, retryCount, setupCleanup]);

  // SVGコンテンツが変更されたときにパンズームを初期化
  useEffect(() => {
    if (!svgContent || !chartRef.current || !isMounted) return;

    const container = chartRef.current;
    container.innerHTML = svgContent;
    
    const svgElement = container.querySelector('svg');
    if (svgElement) {
      // SVGの寸法を確実に設定
      const bbox = svgElement.getBBox();
      if (bbox.width === 0 || bbox.height === 0) {
        console.warn('SVG has zero dimensions, skipping pan-zoom initialization');
        return;
      }

      // viewBoxが設定されていない場合は設定
      if (!svgElement.getAttribute('viewBox')) {
        const width = Math.max(100, bbox.width + 10);
        const height = Math.max(100, bbox.height + 10);
        svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      svgElement.style.width = '100%';
      svgElement.style.height = '100%';
      svgElement.style.maxWidth = '100%';
      
      // 既存のパンズームインスタンスを破棄
      if (panZoomRef.current) {
        try {
          panZoomRef.current.destroy();
        } catch (e) {
          console.warn('Failed to destroy pan-zoom instance:', e);
        }
        panZoomRef.current = null;
      }

      // 新しいパンズームインスタンスを作成
      try {
        const panZoomInstance = svgPanZoom(svgElement, {
          zoomEnabled: true,
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.1,
          maxZoom: 10,
          zoomScaleSensitivity: 0.3,
          beforeZoom: () => {
            try {
              const ctm = svgElement.getCTM();
              if (ctm && (ctm.a === 0 || ctm.d === 0)) {
                console.warn('Invalid CTM detected, resetting view');
                return false;
              }
            } catch (e) {
              console.warn('Error checking CTM:', e);
              return false;
            }
            return true;
          }
        });

        // インスタンスが正しく作成されたことを確認
        if (panZoomInstance && typeof panZoomInstance.resize === 'function') {
          panZoomRef.current = panZoomInstance;
          
          // 初期表示の調整
          requestAnimationFrame(() => {
            if (isMounted && panZoomRef.current) {
              try {
                panZoomRef.current.resize();
                panZoomRef.current.fit();
                panZoomRef.current.center();
              } catch (e) {
                console.warn('Error during initial pan-zoom setup:', e);
              }
            }
          });
        } else {
          console.error('Failed to create valid pan-zoom instance');
        }
      } catch (error) {
        console.error('SVG Pan Zoom initialization error:', error);
      }
    }
  }, [svgContent, isMounted]);

  // コンポーネントのマウント状態を追跡
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  // チャートコードが変更されたら編集可能なコードも更新
  useEffect(() => {
    if (chartCode) {
      console.log("chartCode changed, updating chart:", chartCode);
      setEditableCode(chartCode);
      
      // SVGコンテンツをクリアして再レンダリングを強制
      setSvgContent(null);
      setIsRendered(false);
      
      // 少し遅延させてからレンダリングを実行
      setTimeout(() => {
        renderChart(chartCode);
      }, 100);
    }
  }, [chartCode, renderChart]);

  // 保存済みチャートが選択されたときにレンダリングを実行
  useEffect(() => {
    if (savedChart?.chart_code) {
      setEditableCode(savedChart.chart_code);
      renderChart(savedChart.chart_code);
    }
  }, [savedChart, renderChart]);

  // ウィンドウリサイズ時にSVGを再フィット
  useEffect(() => {
    if (activeTab === 'code' || !isMounted) return;

    const handleResize = () => {
      if (panZoomRef.current) {
        try {
          panZoomRef.current.resize();
          panZoomRef.current.fit();
          panZoomRef.current.center();
        } catch (e) {
          console.warn('Failed to resize pan-zoom instance:', e);
          const svgElement = chartRef.current?.querySelector('svg');
          if (svgElement) {
            if (panZoomRef.current) {
              try {
                panZoomRef.current.destroy();
              } catch (e) {}
            }
            panZoomRef.current = initPanZoom(svgElement);
          }
        }
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [activeTab, isMounted, initPanZoom]);

  const handleCodeChange = (e) => {
    setEditableCode(e.target.value);
  };

  const handleApplyChanges = () => {
    if (editableCode && editableCode !== chartCode) {
      // まずコードを更新
      if (onCodeUpdate) {
        onCodeUpdate(editableCode);
      }
      
      // SVGコンテンツをクリアして再レンダリングを強制
      setSvgContent(null);
      setIsRendered(false);
      
      // 少し遅延させてからレンダリングを実行
      setTimeout(() => {
        renderChart(editableCode);
      }, 100);
      
      setActiveTab('chart');
    }
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
  };

  // 保存モーダルを開く関数
  const handleOpenSaveModal = () => {
    setShowSaveModal(true);
  };

  // 保存モーダルを閉じる関数
  const handleCloseSaveModal = () => {
    setShowSaveModal(false);
  };

  const saveAsImage = () => {
    if (chartRef.current) {
      const svgElement = chartRef.current.querySelector('svg');
      if (svgElement) {
        const bbox = svgElement.getBBox();
        const width = bbox.width;
        const height = bbox.height;

        html2canvas(chartRef.current, {
          scale: 5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: width,
          height: height,
          windowWidth: width * 11,
          windowHeight: height * 11,
          logging: false,
          onclone: (clonedDoc) => {
            const clonedSvg = clonedDoc.querySelector('svg');
            if (clonedSvg) {
              clonedSvg.style.width = `${width}px`;
              clonedSvg.style.height = `${height}px`;
              clonedSvg.setAttribute('width', width);
              clonedSvg.setAttribute('height', height);
            }
          }
        }).then(canvas => {
          const link = document.createElement('a');
          link.download = 'flowchart.png';
          link.href = canvas.toDataURL('image/png', 1.0);
          link.click();
        });
      }
    }
  };

  // 重複したuseEffectを削除 (上のuseEffectで既にeditableCodeを設定しているため)

  return (
    <div className="chart-container">
      {/* <h2>防災計画ワークフロー</h2> */}
      
      {chartCode && (
        <div className="tabs">
          <div className="tab-list" role="tablist">
            <button
              type="button"
              className={`tab-item ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => handleTabClick('chart')}
              onKeyDown={(e) => e.key === 'Enter' && handleTabClick('chart')}
              role="tab"
              aria-selected={activeTab === 'chart'}
              tabIndex={0}
            >
              チャート表示
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'cyto' ? 'active' : ''}`}
              onClick={() => handleTabClick('cyto')}
              onKeyDown={(e) => e.key === 'Enter' && handleTabClick('cyto')}
              role="tab"
              aria-selected={activeTab === 'cyto'}
              tabIndex={0}
            >
              チャート表示v2
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => handleTabClick('code')}
              onKeyDown={(e) => e.key === 'Enter' && handleTabClick('code')}
              role="tab"
              aria-selected={activeTab === 'code'}
              tabIndex={0}
            >
              コード編集
            </button>
          </div>
          
          <div className="tab-content">
            <div 
              className={`tab-panel ${activeTab === 'chart' ? 'active' : ''}`}
              role="tabpanel"
              aria-hidden={activeTab !== 'chart'}
            >
              <div className="chart-display" ref={chartRef} style={{ width: '100%', height: '600px' }}>
                {!isRendered && !renderError && (
                  <div className="chart-loading">
                    ワークフローを生成中...
                  </div>
                )}
                {renderError && retryCount > 0 && retryCount < 3 && (
                  <div className="chart-retry-message">
                    ワークフローの生成を再試行中です... (試行 {retryCount}/3)
                  </div>
                )}
              </div>
              
              {isRendered && (
                <div className="chart-controls">
                  <p className="zoom-instructions">
                    <span className="control-icon">🔍</span> ズーム: マウスホイールまたは右上のコントロールを使用
                    <span className="control-icon">✋</span> 移動: ドラッグして表示位置を調整
                  </p>
                  <div className="button-group">
                    <button 
                      type="button"
                      className="save-chart-button" 
                      onClick={handleOpenSaveModal}
                      disabled={!isRendered || renderError}
                    >
                      ワークフローを保存
                    </button>
                    <button 
                      type="button"
                      className="save-image-button" 
                      onClick={saveAsImage}
                      disabled={!isRendered || renderError}
                    >
                      画像として保存
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div 
              className={`tab-panel ${activeTab === 'cyto' ? 'active' : ''}`}
              role="tabpanel"
              aria-hidden={activeTab !== 'cyto'}
            >
              <CytoscapeChart mermaidCode={editableCode || chartCode} />
            </div>
            
            <div 
              className={`tab-panel ${activeTab === 'code' ? 'active' : ''}`}
              role="tabpanel"
              aria-hidden={activeTab !== 'code'}
            >
              <div className="chart-editor">
                <textarea
                  value={editableCode}
                  onChange={handleCodeChange}
                  className="mermaid-editor"
                  placeholder="Mermaidコードを入力してください"
                />
                <div className="editor-controls">
                  <button 
                    type="button"
                    onClick={handleApplyChanges} 
                    className="apply-button"
                    disabled={!editableCode || editableCode === chartCode}
                  >
                    変更を適用
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {!chartCode && (
        <div className="chart-placeholder">
          <p>PDFをアップロードするとワークフローが表示されます</p>
        </div>
      )}
      <SaveFlowchartModal 
        show={showSaveModal} 
        handleClose={handleCloseSaveModal} 
        chartCode={chartCode} 
        fileId={fileId}
      />
    </div>
  );
}

export default ChartDisplay;
