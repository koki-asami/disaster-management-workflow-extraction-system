import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import './ChartDisplay.css';
import SaveFlowchartModal from './SaveFlowchartModal';
import CytoscapeChart from './CytoscapeChart';

function ChartDisplay({ chartCode, graphData, onRetryRequest, onCodeUpdate, savedChart, fileId}) {
  const chartRef = useRef(null);
  const [showSaveModal, setShowSaveModal] = useState(false);

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

  const exportJson = () => {
    if (!graphData) return;

    // @Users/kokiasami/.Trash/workflow.json と同じ形式に揃えつつ、
    // 必要であれば chat 用の file_id も一緒に保存する
    // {
    //   "tasks": [...],
    //   "dependencies": [...],
    //   "file_id": "..."
    // }
    const payload = {
      tasks: Array.isArray(graphData.tasks) ? graphData.tasks : [],
      dependencies: Array.isArray(graphData.dependencies)
        ? graphData.dependencies
        : [],
      // graphData 内に file_id があればそれを優先し、なければ現在の state の fileId を使う
      file_id: graphData.file_id || fileId || null,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'workflow.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="chart-container">
      {/* <h2>防災計画ワークフロー</h2> */}
      
      {(chartCode || graphData) && (
        <div className="tabs">
          <div className="tab-content">
            <div 
              className="tab-panel active"
              role="tabpanel"
              aria-hidden={false}
            >
              <div className="chart-display" ref={chartRef} style={{ width: '100%', height: '600px' }}>
                <CytoscapeChart graphData={graphData} />
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
                    disabled={!chartCode && !graphData}
                  >
                    ワークフローを保存
                  </button>
                  <button 
                    type="button"
                    className="save-image-button" 
                    onClick={saveAsImage}
                    disabled={!chartCode && !graphData}
                  >
                    PNG画像として保存
                  </button>
                  <button 
                    type="button"
                    className="save-chart-button" 
                    onClick={exportJson}
                    disabled={!graphData}
                  >
                    分析用JSONをダウンロード
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
        graphData={graphData}
      />
    </div>
  );
}

export default ChartDisplay;
