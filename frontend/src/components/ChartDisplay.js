import React, { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import './ChartDisplay.css';
import SaveFlowchartModal from './SaveFlowchartModal';
import CytoscapeChart from './CytoscapeChart';

function ChartDisplay({ chartCode, graphData, onRetryRequest, onCodeUpdate, savedChart, fileId}) {
  const chartRef = useRef(null);
  const [activeTab, setActiveTab] = useState('cyto'); // Cytoscapeをデフォルト表示
  const [editableCode, setEditableCode] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  // チャートコードが変更されたら編集可能なコードも更新
  useEffect(() => {
    if (chartCode) {
      console.log("chartCode changed, updating chart:", chartCode);
      setEditableCode(chartCode);
    }
  }, [chartCode]);

  // 保存済みチャートが選択されたときにレンダリングを実行
  useEffect(() => {
    if (savedChart?.chart_code) {
      setEditableCode(savedChart.chart_code);
    }
  }, [savedChart]);

  const handleCodeChange = (e) => {
    setEditableCode(e.target.value);
  };

  const handleApplyChanges = () => {
    if (editableCode && editableCode !== chartCode) {
      if (onCodeUpdate) {
        onCodeUpdate(editableCode);
      }

      setActiveTab('cyto');
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
      html2canvas(chartRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'flowchart.png';
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
      });
    }
  };

  const taskCount = graphData?.tasks?.length || 0;
  const dependencyCount = graphData?.dependencies?.length || 0;
  const hasStats = !!graphData && (taskCount > 0 || dependencyCount > 0);

  return (
    <div className="chart-container">
      {/* <h2>防災計画ワークフロー</h2> */}
      
      {(chartCode || graphData) && (
        <div className="tabs">
          <div className="tab-list" role="tablist">
            <button
              type="button"
              className={`tab-item ${activeTab === 'cyto' ? 'active' : ''}`}
              onClick={() => handleTabClick('cyto')}
              onKeyDown={(e) => e.key === 'Enter' && handleTabClick('cyto')}
              role="tab"
              aria-selected={activeTab === 'cyto'}
              tabIndex={0}
            >
              チャート表示
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
              className={`tab-panel ${activeTab === 'cyto' ? 'active' : ''}`}
              role="tabpanel"
              aria-hidden={activeTab !== 'cyto'}
            >
              <div className="chart-display" ref={chartRef} style={{ width: '100%', height: '600px' }}>
                <CytoscapeChart 
                  mermaidCode={editableCode || chartCode} 
                  graphData={graphData}
                />
                {hasStats && (
                  <div className="chart-stats-overlay">
                    <div className="chart-stats-item">タスク数: {taskCount}</div>
                    <div className="chart-stats-item">依存関係数: {dependencyCount}</div>
                  </div>
                )}
              </div>

              <div className="chart-controls">
                <p className="zoom-instructions">
                  <span className="control-icon">🔍</span> ズーム: トラックパッドやマウスホイールで操作できます
                  <span className="control-icon">✋</span> 移動: ノードや空白部分をドラッグして調整できます
                </p>
                <div className="button-group">
                  <button 
                    type="button"
                    className="save-chart-button" 
                    onClick={handleOpenSaveModal}
                    disabled={!editableCode && !chartCode && !graphData}
                  >
                    ワークフローを保存
                  </button>
                  <button 
                    type="button"
                    className="save-image-button" 
                    onClick={saveAsImage}
                    disabled={!editableCode && !chartCode && !graphData}
                  >
                    画像として保存
                  </button>
                </div>
              </div>
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
      
      {!chartCode && !graphData && (
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
