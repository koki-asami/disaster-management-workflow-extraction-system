import React, { useState, useEffect } from 'react';
import UploadManager from './components/UploadManager';
import ChartDisplay from './components/ChartDisplay';
import ChatUI from './components/ChatUI';
import SavedFlowcharts from './components/SavedFlowcharts';
import {
  API_ENDPOINT,
  checkBackendHealth,
  listFlowcharts,
  createExtractionJob,
  getExtractionJob,
} from './config';
import logo from './assets/icons8-ai-96.png';
import './App.css';
import SaveFlowchartModal from './components/SaveFlowchartModal';

// ファビコンを設定する関数
const setFavicon = (url) => {
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) {
      favicon.href = url;
    } else {
      const newFavicon = document.createElement("link");
      newFavicon.rel = "icon";
      newFavicon.href = url;
      document.head.appendChild(newFavicon);
    }
};

function App() {
    useEffect(() => {
        document.title = "AI Disaster Response Chatbot";
        setFavicon(logo);
    }, []);

    const [chartCode, setChartCode] = useState('');
    const [graphData, setGraphData] = useState(null); // { tasks, dependencies }
    const [chatHistory, setChatHistory] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: 'バックエンド接続を確認中...' });
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [showSavedFlowcharts, setShowSavedFlowcharts] = useState(false);
    const [, setSavedFlowcharts] = useState([]);
    const [savedChart, setSavedChart] = useState(null);
    const [fileId, setFileId] = useState(null);
  const [activeJob, setActiveJob] = useState(null); // { jobId, status, progress, processedPages, totalPages, summary }
  const [uploads, setUploads] = useState([]); // server uploads list
  const [selectedUploadIds, setSelectedUploadIds] = useState([]);
  const [rightTab, setRightTab] = useState('status'); // 'status' | 'workflow'

  const activeJobId = activeJob?.jobId;
  const activeJobStatus = activeJob?.status;

    // Debug: Log fileId changes
    useEffect(() => {
        console.log('fileId state changed:', fileId);
    }, [fileId]);

    // Debug: Log when SaveFlowchartModal is opened
    useEffect(() => {
        if (showSaveModal) {
            console.log('SaveFlowchartModal opened with fileId:', fileId);
        }
    }, [showSaveModal, fileId]);

    // バックエンドの健全性をチェック
    useEffect(() => {
        const checkHealth = async () => {
        console.log('Checking backend health...');
        setBackendStatus({ status: 'checking', message: 'バックエンド接続を確認中...' });
        
        try {
            const health = await checkBackendHealth();
            setBackendStatus(health);
            
            if (health.status === 'error') {
            setError(`バックエンド接続エラー: ${health.message}`);
            console.error('Backend health check failed:', health.message);
            } else {
            console.log('Backend health check passed');
            }
        } catch (err) {
            const errorMsg = `バックエンド接続確認中にエラーが発生しました: ${err.message}`;
            setBackendStatus({ status: 'error', message: errorMsg });
            setError(errorMsg);
            console.error('Health check error:', err);
        }
        };
        
        checkHealth();
        
        // 定期的に健全性をチェック（10minごと）
        const intervalId = setInterval(checkHealth, 600000);
        
        // クリーンアップ関数
        return () => clearInterval(intervalId);
    }, []);

    // Fetch saved flowcharts when component mounts
    useEffect(() => {
      const fetchSavedFlowcharts = async () => {
        try {
          const flowcharts = await listFlowcharts();
          console.log("Fetched flowcharts:", flowcharts);
          setSavedFlowcharts(flowcharts);
        } catch (err) {
          console.error('Error fetching saved flowcharts:', err);
          setError(`フローチャートの取得に失敗しました: ${err.message}`);
        }
      };
      
      fetchSavedFlowcharts();
    }, []);

    // 抽出ジョブのポーリング
    useEffect(() => {
      if (!activeJobId) return;
      if (activeJobStatus === 'completed' || activeJobStatus === 'failed') return;

      let cancelled = false;

      const poll = async () => {
        try {
          const data = await getExtractionJob(activeJobId);
          if (cancelled) return;

          setActiveJob((prev) => ({
            ...(prev || {}),
            jobId: data.job_id,
            status: data.status,
            progress: Math.min(100, Math.max(0, Number(data.progress) || 0)),
            processedPages: data.processed_pages ?? 0,
            totalPages: data.total_pages ?? 0,
            summary: data.summary || null,
            phase: data.phase || null,
            detail: data.detail || null,
            phaseCurrent: data.phase_current ?? null,
            phaseTotal: data.phase_total ?? null,
            phaseUnit: data.phase_unit ?? null,
          }));

          // 完了時は結果を取り込み
          if (data.status === 'completed' && data.result) {
            const tasks = data.result.tasks || [];
            const dependencies = data.result.dependencies || [];
            const resultFileId = data.result.file_id || null;

            // グラフデータに file_id も保持しておく（JSONエクスポート時に利用）
            setGraphData({ tasks, dependencies, file_id: resultFileId });
            setChartCode('');
            setRightTab('workflow');

            // OpenAI にアップロードした PDF の file_id を state に保存（チャット用）
            if (resultFileId) {
              setFileId(resultFileId);
              console.log('Set fileId from extraction result:', resultFileId);
            }
          }
        } catch (err) {
          console.error('Error polling extraction job:', err);
          if (!cancelled) {
            setActiveJob((prev) => prev ? { ...prev, status: 'failed' } : null);
          }
        }
      };

      const intervalId = setInterval(poll, 1500);
      // すぐ一回実行
      poll();

      return () => {
        cancelled = true;
        clearInterval(intervalId);
      };
    }, [activeJobId, activeJobStatus]);
    
    // Update saved flowcharts list after successful save
    const handleSaveModalClose = (success) => {
      console.log('Closing SaveFlowchartModal, current fileId:', fileId);
      setShowSaveModal(false);
      if (success) {
        // Refresh the flowcharts list
        listFlowcharts().then(flowcharts => {
          setSavedFlowcharts(flowcharts);
        }).catch(err => {
          console.error('Error refreshing flowcharts:', err);
        });
      }
    };

    // チャット更新処理
    const handleChatUpdate = async (instruction) => {
        try {
            console.log('Starting chat update with fileId:', fileId);
            setIsLoading(true);
            
            // ユーザーメッセージをチャット履歴に追加
            const updatedHistory = [
                ...chatHistory,
                { role: 'user', content: instruction }
            ];
            setChatHistory(updatedHistory);
            
            const response = await fetch(`${API_ENDPOINT}/chat_update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    instruction: instruction,
                    history: chatHistory,
                    file_id: fileId,
                    graph_data: graphData,
                }),
            });
            
            if (!response.ok) {
                throw new Error('APIリクエストに失敗しました');
            }
            
            const data = await response.json();
            
            // APIからの応答をチャット履歴に追加
            if (data.message) {
                const newMessage = {
                    role: 'assistant',
                    content: data.message,
                    chart: null
                };
                
                setChatHistory([...updatedHistory, newMessage]);
            }

            // updated_workflow によるグラフ更新
            if (data.graph_data && Array.isArray(data.graph_data.tasks) && Array.isArray(data.graph_data.dependencies)) {
                console.log('Updating graph data from chat response');
                setGraphData({
                  tasks: data.graph_data.tasks,
                  dependencies: data.graph_data.dependencies,
                });
                setChartCode('');
                setRightTab('workflow');
            }
            
            setIsLoading(false);
        } catch (error) {
            console.error('Chat update error:', error);
            setIsLoading(false);
            setError(`チャット更新中にエラーが発生しました: ${error.message}`);
        }
    };
    
    // Mermaidレンダリングエラー時の再試行ハンドラー
  const handleChartRetry = async (error) => {
    console.log('Retrying chart generation due to error:', error);
    
    try {
      setIsLoading(true);
      
      // 最後のユーザーメッセージを取得
      const lastUserMessage = chatHistory
        .filter(msg => msg.role === 'user')
        .pop();
      
      if (!lastUserMessage) {
        throw new Error('ユーザーメッセージが見つかりません');
      }
      
      const response = await fetch(`${API_ENDPOINT}/chat_update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: `${lastUserMessage.content}\n\n追加情報: 前回のフローチャートにはMermaid構文エラーがありました。有効なMermaid構文で再生成してください。`,
          history: chatHistory.slice(0, -1), // 最後のアシスタントメッセージを除外
          file_id: fileId,
          graph_data: graphData,
        }),
      });
      
      if (!response.ok) {
        throw new Error('APIリクエストに失敗しました');
      }
      
      const data = await response.json();
      
      // 最後のアシスタントメッセージを更新
      if (data.message) {
        const updatedHistory = [...chatHistory];
        const lastAssistantIndex = updatedHistory
          .map((msg, index) => ({ index, role: msg.role }))
          .filter(item => item.role === 'assistant')
          .pop();
        
        if (lastAssistantIndex) {
          updatedHistory[lastAssistantIndex.index] = {
            role: 'assistant',
            content: data.message,
            chart: null
          };
          setChatHistory(updatedHistory);
        }
      }
      
      if (data.graph_data && Array.isArray(data.graph_data.tasks) && Array.isArray(data.graph_data.dependencies)) {
        console.log('Updating graph data from chat retry response');
        setGraphData({
          tasks: data.graph_data.tasks,
          dependencies: data.graph_data.dependencies,
        });
        setChartCode('');
        setRightTab('workflow');
      }

      setIsLoading(false);
        } catch (error) {
        console.error('Chart retry error:', error);
        setIsLoading(false);
        setError(`フローチャート再生成中にエラーが発生しました: ${error.message}`);
        }
    };

    const toggleSavedFlowcharts = () => {
      console.log('Toggling saved flowcharts, current fileId:', fileId);
      setShowSavedFlowcharts(!showSavedFlowcharts);
    };

    // Add handleFlowchartUpdate function
    const handleFlowchartUpdate = (newChartCode) => {
        setChartCode(newChartCode);
        // Update the last assistant message in chat history with the new chart
        setChatHistory(prevHistory => {
            const updatedHistory = [...prevHistory];
            const lastAssistantIndex = updatedHistory
                .map((msg, index) => ({ index, role: msg.role }))
                .filter(item => item.role === 'assistant')
                .pop();
            
            if (lastAssistantIndex) {
                updatedHistory[lastAssistantIndex.index] = {
                    ...updatedHistory[lastAssistantIndex.index],
                    chart: newChartCode
                };
            }
            return updatedHistory;
        });
    };

    const handleRunExtractionFromUploads = async (uploadIds) => {
      if (backendStatus.status !== 'ok') {
        setError(`バックエンドサーバーに接続できません: ${backendStatus.message}`);
        return;
      }
      try {
        setError(null);
        const res = await createExtractionJob(uploadIds);
        setActiveJob({
          jobId: res.job_id,
          status: res.status || 'queued',
          progress: 0,
          processedPages: 0,
          totalPages: 0,
          summary: null,
          phase: null,
          detail: null,
        });
        setRightTab('status');
      } catch (err) {
        console.error('Failed to create extraction job:', err);
        setError(`抽出ジョブの作成に失敗しました: ${err.message}`);
      }
    };

    const phaseToStep = (phase) => {
      const order = ['queued', 'text_extraction', 'task_extraction', 'dependency_extraction', 'finalizing', 'completed'];
      const idx = order.indexOf(phase || '');
      const step = idx === -1 ? 1 : Math.min(idx + 1, 5);
      const total = 5;
      return { step, total };
    };

    const phaseLabel = (phase) => {
      switch (phase) {
        case 'queued':
          return '待機中';
        case 'text_extraction':
          return 'PDFテキスト抽出';
        case 'task_extraction':
          return 'タスク抽出';
        case 'dependency_extraction':
          return '依存関係抽出';
        case 'finalizing':
          return '可視化用データ整形';
        case 'completed':
          return '完了';
        default:
          return '処理中';
      }
    };

    const unitLabel = (unit) => {
      if (unit === 'tasks') return 'タスク';
      if (unit === 'pages') return 'ページ';
      return '';
    };

    const isJobRunning =
      !!activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing');

    const handleStopJob = () => {
      // 現状はフロント側の追跡のみ停止（バックエンドの処理は継続）
      setActiveJob(null);
    };

    return (
        <div className="app">
          <header className="app-header">
            <h1>防災計画フローチャート生成ツール</h1>
            <div className="header-buttons">
              <button 
                type="button"
                className="saved-flowcharts-btn"
                onClick={toggleSavedFlowcharts}
              >
                {showSavedFlowcharts ? '戻る' : '保存済みフローチャート'}
              </button>
              <div
                className={`backend-status ${backendStatus.status}`}
                title={
                  backendStatus.status === 'ok'
                    ? 'バックエンド接続済み'
                    : backendStatus.status === 'checking'
                      ? 'バックエンド接続確認中'
                      : 'バックエンド接続エラー'
                }
                aria-label="バックエンド接続状態"
              />
            </div>
          </header>
          
          <main className="app-main">
            {showSavedFlowcharts ? (
              <div className="saved-flowcharts-page">
                <SavedFlowcharts 
                  onSelectFlowchart={(chartData) => {
                    // Mermaidコード（あれば）を設定
                    setChartCode(chartData.chart_code || '');

                    // 抽出済みタスク／依存関係（graph_data）があれば、そのまま反映
                    if (chartData.graph_data) {
                      setGraphData(chartData.graph_data);
                      setRightTab('workflow');
                    }

                    // 選択したフローチャートを現在のsavedChartとして設定
                    setSavedChart(chartData);
                    
                    // file_idを設定（存在する場合）
                    if (chartData.file_id) {
                      setFileId(chartData.file_id);
                      console.log('Loaded file_id from saved flowchart:', chartData.file_id);
                    } else {
                      console.log('No file_id found in saved flowchart');
                    }
                    
                    // チャット履歴に選択したフローチャートを追加
                    const newMessage = {
                      role: 'assistant',
                      content: `「${chartData.title || `${chartData.location_name} 防災計画`}」のフローチャートを表示しました。`,
                      chart: chartData.chart_code || null,
                    };
                    
                    setChatHistory(prevHistory => [...prevHistory, newMessage]);
                    setShowSavedFlowcharts(false);

                    // 全体画面を一番上にスクロール
                    requestAnimationFrame(() => {
                      window.scrollTo(0, 0);
                    });
                  }}
                />
              </div>
            ) : (
              <>
                <div className="left-panel">
                  <UploadManager
                    disabled={backendStatus.status !== 'ok' || isLoading}
                    onRunExtraction={handleRunExtractionFromUploads}
                    onUploadsChange={setUploads}
                    onSelectionChange={setSelectedUploadIds}
                    isJobRunning={isJobRunning}
                  />
                  <ChatUI 
                      onSend={handleChatUpdate} 
                      history={chatHistory} 
                      disabled={isLoading} 
                  />
                </div>
                
                <div className="right-panel">
                  <div className="workflow-topbar">
                    <button
                      type="button"
                      className={`workflow-tab ${rightTab === 'status' ? 'active' : ''}`}
                      onClick={() => setRightTab('status')}
                    >
                      抽出状況
                    </button>
                    <button
                      type="button"
                      className={`workflow-tab ${rightTab === 'workflow' ? 'active' : ''}`}
                      onClick={() => setRightTab('workflow')}
                      disabled={!graphData}
                    >
                      ワークフロー
                    </button>
                  </div>

                  {rightTab === 'status' && (
                    <div className="workflow-status-panel">
                      <div className="status-section">
                        <div className="status-title">
                          対象PDF ({selectedUploadIds.length}/{uploads.length})
                        </div>
                        <div className="status-list">
                          {selectedUploadIds.length === 0 && (
                            <div className="status-muted">左でPDFを選択して「抽出を実行」を押してください。</div>
                          )}
                          {selectedUploadIds.length > 0 && (
                            <ul>
                              {uploads
                                .filter((u) => selectedUploadIds.includes(u.upload_id))
                                .map((u) => (
                                  <li key={u.upload_id}>
                                    {u.filename}（{u.status}）
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="status-section">
                        <div className="status-title">ジョブ進捗</div>
                        {!activeJob && (
                          <div className="status-muted">まだジョブは開始されていません。</div>
                        )}
                        {activeJob && (
                          <>
                            {(() => {
                              const { step, total } = phaseToStep(activeJob.phase);
                              const summary = activeJob.summary || {};
                              const totalPages = activeJob.totalPages ?? null;
                              const taskCount = summary.task_count ?? null;
                              const dependencyCount = summary.dependency_count ?? null;
                              return (
                                <div className="job-row">
                                  <div className="job-row-title">
                                    {phaseLabel(activeJob.phase)} ({step}/{total})
                                    {isJobRunning && (
                                      <button
                                        type="button"
                                        onClick={handleStopJob}
                                        className="job-stop-button"
                                      >
                                        停止
                                      </button>
                                    )}
                                  </div>
                                  <div className="job-progress-track">
                                    <div
                                      className={`job-progress-fill job-progress-fill-${activeJob.status}`}
                                      style={{ width: `${Math.min(100, Math.max(0, Number(activeJob.progress) || 0))}%` }}
                                    />
                                  </div>
                                  <div className="job-row-meta">
                                    {activeJob.phaseTotal != null && activeJob.phaseCurrent != null && activeJob.phaseUnit
                                      ? `${activeJob.phaseCurrent}/${activeJob.phaseTotal} ${unitLabel(activeJob.phaseUnit)}`
                                      : activeJob.totalPages
                                        ? `${activeJob.processedPages ?? 0}/${activeJob.totalPages} ページ`
                                        : '進捗を計測中...'}
                                  </div>
                                  {(totalPages != null || taskCount != null || dependencyCount != null) && (
                                    <div className="job-row-detail">
                                      {totalPages != null && `ページ: ${totalPages} `}
                                      {taskCount != null && `／ タスク: ${taskCount} `}
                                      {dependencyCount != null && `／ 依存関係: ${dependencyCount}`}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {rightTab === 'workflow' && (
                    <ChartDisplay 
                      chartCode={chartCode}
                      graphData={graphData}
                      savedChart={savedChart}
                      fileId={fileId}
                      onRetryRequest={handleChartRetry}
                      onCodeUpdate={handleFlowchartUpdate}
                      onSaveClick={() => {
                        console.log('Opening SaveFlowchartModal with fileId:', fileId);
                        setShowSaveModal(true);
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </main>
        
        {error && (
          <div className="error-notification">
            {error}
            <button 
              type="button"
              onClick={() => {
                console.log('Error notification dismissed');
                setError(null);
              }}
            >×</button>
          </div>
        )}

        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <div>処理中...</div>
          </div>
        )}

      <SaveFlowchartModal
        show={showSaveModal}
        handleClose={handleSaveModalClose}
        chartCode={chartCode}
        fileId={fileId}
        graphData={graphData}
        onSave={(data) => {
          console.log('Saving flowchart with fileId:', fileId);
          // Update the saved flowcharts list
          listFlowcharts().then(flowcharts => {
            setSavedFlowcharts(flowcharts);
          }).catch(err => {
            console.error('Error refreshing flowcharts:', err);
          });
        }}
      />
      </div>
    );
}
    
export default App;
