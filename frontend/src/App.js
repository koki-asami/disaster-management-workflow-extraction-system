import React, { useState, useEffect } from 'react';
import UploadPdf from './components/UploadPdf';
import UploadManager from './components/UploadManager';
import ChartDisplay from './components/ChartDisplay';
import ChatUI from './components/ChatUI';
import SavedFlowcharts from './components/SavedFlowcharts';
import {
  API_ENDPOINT,
  analyzePdf,
  checkBackendHealth,
  listFlowcharts
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

    const handlePdfUpload = async (files) => {
        // バックエンド接続状態を確認
        if (backendStatus.status !== 'ok') {
          setError(`バックエンドサーバーに接続できません: ${backendStatus.message}`);
          return;
        }
        
        const fileArray = Array.isArray(files) ? files : [files];
        if (fileArray.length === 0) {
          setError('PDFファイルが選択されていません');
          return;
        }

        console.log(
          `PDF upload initiated for ${fileArray.length} file(s): ${fileArray
            .map((f) => f.name)
            .join(', ')}`
        );
        setIsLoading(true);
        setError(null);
        
        // Start timing
        const startTime = performance.now();
        
        try {
          const result = await analyzePdf(fileArray);

          const tasks = result.tasks || [];
          const dependencies = result.dependencies || [];

          setGraphData({ tasks, dependencies });

          // 互換性のため、最初のファイルIDを state に保持
          console.log('Current fileId before setting:', fileId);
          setFileId(result.file_id || null);
          console.log('New fileId set from PDF analysis:', result.file_id);

          const tasksCount = tasks.length;
          const depsCount = dependencies.length;

          // チャートコードはMermaid経由ではなく、JSONベース可視化に切り替えるため空のまま保持
          setChartCode('');

          // チャット履歴に結果サマリを追加
          setChatHistory([
            { role: 'user', content: 'PDFから防災計画のワークフローを生成してください' },
            {
              role: 'assistant',
              content: `アップロードされたPDFからタスクを${tasksCount}件、依存関係を${depsCount}件抽出しました。右側のワークフロー図を確認してください。`,
              chart: null,
            },
          ]);

          // Calculate and log elapsed time
          const endTime = performance.now();
          const elapsedTime = (endTime - startTime) / 1000; // Convert to seconds
          console.log(
            `Time taken to process PDF(s) and build workflow: ${elapsedTime.toFixed(
              2
            )} seconds`
          );
        } catch (err) {
          console.error('PDF analysis error', err);
          setError(`PDFの解析に失敗しました: ${err.message}`);
        } finally {
          console.log('PDF upload process completed');
          setIsLoading(false);
        }
    };

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
                    file_id: fileId
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
                    chart: data.flowchart || null
                };
                
                setChatHistory([...updatedHistory, newMessage]);
                
                // フローチャートがある場合は設定
                if (data.flowchart) {
                    console.log('Updating chart code from chat response:', data.flowchart);
                    // 更新された履歴を渡してhandleCodeUpdateを呼び出す
                    const fullUpdatedHistory = [...updatedHistory, newMessage];
                    handleCodeUpdate(data.flowchart, fullUpdatedHistory);
                }
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
          history: chatHistory.slice(0, -1) // 最後のアシスタントメッセージを除外
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
            chart: data.flowchart || null
          };
          setChatHistory(updatedHistory);
        }
      }
      
      // フローチャートがある場合は設定
      if (data.flowchart) {
        // 更新された履歴を渡してhandleCodeUpdateを呼び出す
    }

      setIsLoading(false);
        } catch (error) {
        console.error('Chart retry error:', error);
        setIsLoading(false);
        setError(`フローチャート再生成中にエラーが発生しました: ${error.message}`);
        }
    };

    const handleCodeUpdate = (newCode, history = null) => {
        console.log('Updating chart code:', newCode);
        setChartCode(newCode);
        
        // 最後のアシスタントメッセージのチャートも更新
        // historyが指定されていない場合はchatHistoryを使用
        const currentHistory = history || chatHistory;
        
        if (currentHistory.length > 0) {
          const updatedHistory = [...currentHistory];
          const lastAssistantIndex = updatedHistory
            .map((msg, index) => ({ index, role: msg.role }))
            .filter(item => item.role === 'assistant')
            .pop();
          
          if (lastAssistantIndex) {
            updatedHistory[lastAssistantIndex.index] = {
              ...updatedHistory[lastAssistantIndex.index],
              chart: newCode
            };
            setChatHistory(updatedHistory);
          }
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
              <div className={`backend-status ${backendStatus.status}`}>
                バックエンド: {
                  backendStatus.status === 'ok' ? '接続済み' : 
                  backendStatus.status === 'checking' ? '接続確認中...' : 
                  '接続エラー'
                }
              </div>
            </div>
          </header>
          
          <main className="app-main">
            {showSavedFlowcharts ? (
              <SavedFlowcharts 
                onSelectFlowchart={(chartData) => {
                  // チャートコードを設定
                  setChartCode(chartData.chart_code);

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
                    chart: chartData.chart_code
                  };
                  
                  setChatHistory(prevHistory => [...prevHistory, newMessage]);
                  setShowSavedFlowcharts(false);
                }}
              />
            ) : (
              <>
                <div className="left-panel">
                  {/* 既存の同期解析用 UploadPdf は残しつつ、新しい UploadManager を上に追加 */}
                  <UploadManager disabled={backendStatus.status !== 'ok' || isLoading} />
                  <hr style={{ margin: '1rem 0' }} />
                  <UploadPdf 
                    onUpload={handlePdfUpload} 
                    disabled={backendStatus.status !== 'ok' || isLoading}
                  />
                  <ChatUI 
                      onSend={handleChatUpdate} 
                      history={chatHistory} 
                      disabled={isLoading} 
                  />
                </div>
                
                <div className="right-panel">
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
