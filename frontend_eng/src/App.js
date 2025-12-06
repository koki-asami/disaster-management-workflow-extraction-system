import React, { useState, useEffect } from 'react';
import UploadPdf from './components/UploadPdf';
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

// Function to set favicon
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
    const [chatHistory, setChatHistory] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [backendStatus, setBackendStatus] = useState({ status: 'checking', message: 'Checking backend connection...' });
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [showSavedFlowcharts, setShowSavedFlowcharts] = useState(false);
    const [savedFlowcharts, setSavedFlowcharts] = useState([]);
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

    // Check backend health
    useEffect(() => {
        const checkHealth = async () => {
        console.log('Checking backend health...');
        setBackendStatus({ status: 'checking', message: 'Checking backend connection...' });
        
        try {
            const health = await checkBackendHealth();
            setBackendStatus(health);
            
            if (health.status === 'error') {
            setError(`Backend connection error: ${health.message}`);
            console.error('Backend health check failed:', health.message);
            } else {
            console.log('Backend health check passed');
            }
        } catch (err) {
            const errorMsg = `Error occurred while checking backend connection: ${err.message}`;
            setBackendStatus({ status: 'error', message: errorMsg });
            setError(errorMsg);
            console.error('Health check error:', err);
        }
        };
        
        checkHealth();
        
        // Check health periodically (every 10 minutes)
        const intervalId = setInterval(checkHealth, 600000);
        
        // Cleanup function
        return () => clearInterval(intervalId);
    }, []);

    const handlePdfUpload = async (file) => {
        // Check backend connection status
        if (backendStatus.status !== 'ok') {
          setError(`Cannot connect to backend server: ${backendStatus.message}`);
          return;
        }
        
        console.log(`PDF upload initiated: ${file.name}`);
        setIsLoading(true);
        setError(null);
        
        // Start timing
        const startTime = performance.now();
        
        try {
          const result = await analyzePdf(file);
          
          if (result.flowchart) {
            console.log('Flowchart received from backend');
            // Extract Mermaid notation
            const mermaidPattern = /```mermaid\s*([\s\S]*?)\s*```/;
            const match = result.flowchart.match(mermaidPattern);
            
            let extractedChart = "";
            let textContent = result.flowchart;
            
            if (match) {
              console.log('Mermaid syntax found in response');
              extractedChart = match[1];
              textContent = result.flowchart.replace(mermaidPattern, '').trim();
            } else {
              console.log('No mermaid syntax found, using full response');
              extractedChart = result.flowchart;
              textContent = "Flowchart has been generated.";
            }
            
            console.log('Setting flowchart and updating chat history');
            setChartCode(extractedChart);
            console.log('Current fileId before setting:', fileId);
            setFileId(result.file_id);
            console.log('New fileId set from PDF analysis:', result.file_id);
            
            // Add to chat history
            setChatHistory([
              { role: 'user', content: 'Please generate a disaster response flowchart from the PDF' },
              { role: 'assistant', content: textContent, chart: extractedChart }
            ]);
            
            // Calculate and log elapsed time
            const endTime = performance.now();
            const elapsedTime = (endTime - startTime) / 1000; // Convert to seconds
            console.log(`Time taken to process PDF and display flowchart: ${elapsedTime.toFixed(2)} seconds`);
          }
        } catch (err) {
          console.error('PDF analysis error', err);
          setError(`Failed to analyze PDF: ${err.message}`);
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
          setError(`Failed to fetch flowcharts: ${err.message}`);
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

    // Chat update processing
    const handleChatUpdate = async (instruction) => {
        try {
            console.log('Starting chat update with fileId:', fileId);
            setIsLoading(true);
            
            // Add user message to chat history
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
                throw new Error('API request failed');
            }
            
            const data = await response.json();
            
            // Add API response to chat history
            if (data.message) {
                const newMessage = {
                    role: 'assistant',
                    content: data.message,
                    chart: data.flowchart || null
                };
                
                setChatHistory([...updatedHistory, newMessage]);
                
                // Set flowchart if available
                if (data.flowchart) {
                    console.log('Updating chart code from chat response:', data.flowchart);
                    // Pass updated history to handleCodeUpdate
                    const fullUpdatedHistory = [...updatedHistory, newMessage];
                    handleCodeUpdate(data.flowchart, fullUpdatedHistory);
                }
            }
            
            setIsLoading(false);
        } catch (error) {
            console.error('Chat update error:', error);
            setIsLoading(false);
            setError(`Error occurred during chat update: ${error.message}`);
        }
    };
    
    // Mermaid rendering error retry handler
  const handleChartRetry = async (error) => {
    console.log('Retrying chart generation due to error:', error);
    
    try {
      setIsLoading(true);
      
      // Get last user message
      const lastUserMessage = chatHistory
        .filter(msg => msg.role === 'user')
        .pop();
      
      if (!lastUserMessage) {
        throw new Error('User message not found');
      }
      
      const response = await fetch(`${API_ENDPOINT}/chat_update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: `${lastUserMessage.content}\n\nAdditional information: The previous flowchart had Mermaid syntax errors. Please regenerate with valid Mermaid syntax.`,
          history: chatHistory.slice(0, -1) // Exclude last assistant message
        }),
      });
      
      if (!response.ok) {
        throw new Error('API request failed');
      }
      
      const data = await response.json();
      
      // Update last assistant message
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
      
      // Set flowchart if available
      if (data.flowchart) {
        // Pass updated history to handleCodeUpdate
    }

      setIsLoading(false);
        } catch (error) {
        console.error('Chart retry error:', error);
        setIsLoading(false);
        setError(`Error occurred during flowchart regeneration: ${error.message}`);
        }
    };

    const handleCodeUpdate = (newCode, history = null) => {
        console.log('Updating chart code:', newCode);
        setChartCode(newCode);
        
        // Update chart in last assistant message
        // Use chatHistory if history is not specified
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
            <h1>Disaster Response Flowchart Generator</h1>
            <div className="header-buttons">
              <button 
                type="button"
                className="saved-flowcharts-btn"
                onClick={toggleSavedFlowcharts}
              >
                {showSavedFlowcharts ? 'Back' : 'Saved Flowcharts'}
              </button>
              <div className={`backend-status ${backendStatus.status}`}>
                Backend: {
                  backendStatus.status === 'ok' ? 'Connected' : 
                  backendStatus.status === 'checking' ? 'Checking connection...' : 
                  'Connection Error'
                }
              </div>
            </div>
          </header>
          
          <main className="app-main">
            {showSavedFlowcharts ? (
              <SavedFlowcharts 
                onSelectFlowchart={(chartData) => {
                  // Set chart code
                  setChartCode(chartData.chart_code);

                  // Set selected flowchart as current savedChart
                  setSavedChart(chartData);
                  
                  // Set file_id if it exists
                  if (chartData.file_id) {
                    setFileId(chartData.file_id);
                    console.log('Loaded file_id from saved flowchart:', chartData.file_id);
                  } else {
                    console.log('No file_id found in saved flowchart');
                  }
                  
                  // Add selected flowchart to chat history
                  const newMessage = {
                    role: 'assistant',
                    content: `Displayed flowchart for "${chartData.title || `${chartData.location_name} Disaster Response Plan`}".`,
                    chart: chartData.chart_code
                  };
                  
                  setChatHistory(prevHistory => [...prevHistory, newMessage]);
                  setShowSavedFlowcharts(false);
                }}
              />
            ) : (
              <>
                <div className="left-panel">
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
              aria-label="Dismiss error"
            >×</button>
          </div>
        )}
        
        {isLoading && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-spinner" />
            <div>Processing...</div>
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
