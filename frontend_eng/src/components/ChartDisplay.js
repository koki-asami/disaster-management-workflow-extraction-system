import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import html2canvas from 'html2canvas';
import './ChartDisplay.css';
import SaveFlowchartModal from './SaveFlowchartModal';

// Mermaid initialization settings
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: {
    htmlLabels: true,
    curve: 'basis'
  }
});

function ChartDisplay({ chartCode, onRetryRequest, onCodeUpdate, savedChart, fileId}) {
  const chartRef = useRef(null);
  const panZoomRef = useRef(null);
  const [isRendered, setIsRendered] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [activeTab, setActiveTab] = useState('chart');
  const [editableCode, setEditableCode] = useState('');
  const [isMounted, setIsMounted] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [svgString, setSvgString] = useState('');

  // Initialize SVG pan-zoom functionality with better error handling
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
      }, 100);
      
      return pz;
    } catch (e) {
      console.warn('Error initializing pan-zoom:', e);
      return null;
    }
  }, [isMounted]);

  // Render chart function with improved error handling
  const renderChart = useCallback(async (code) => {
    if (!code || !isMounted) return;
    
    try {
      setRenderError(null);
      setIsRendered(false);
      
      // Render with mermaid
      const { svg } = await mermaid.render('mermaid-chart', code);
      
      if (!isMounted) return;
      
      // Set SVG content using React state instead of direct DOM manipulation
      setSvgString(svg);
      setIsRendered(true);
      setRetryCount(0);
    } catch (error) {
      console.error('Chart rendering error:', error);
      if (isMounted) {
        setRenderError(error.message);
        setIsRendered(false);
        
        // Retry logic
        if (retryCount < 3) {
          setRetryCount(prev => prev + 1);
          setTimeout(() => {
            if (isMounted) {
              renderChart(code);
            }
          }, 1000);
        } else if (onRetryRequest) {
          onRetryRequest(error);
        }
      }
    }
  }, [isMounted, retryCount, onRetryRequest]);

  // Effect to render chart when chartCode changes
  useEffect(() => {
    if (chartCode) {
      renderChart(chartCode);
    } else {
      setIsRendered(false);
      setRenderError(null);
      setRetryCount(0);
      setSvgString('');
    }
  }, [chartCode, renderChart]);

  // Effect to update editable code when chartCode changes
  useEffect(() => {
    setEditableCode(chartCode || '');
  }, [chartCode]);

  // Effect to handle component mounting
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
      // Cleanup pan-zoom on unmount
      if (panZoomRef.current) {
        try {
          panZoomRef.current.destroy();
        } catch (e) {
          console.warn('Failed to destroy pan-zoom instance:', e);
        }
        panZoomRef.current = null;
      }
    };
  }, []);

  // Effect to handle window resize with better error handling
  useEffect(() => {
    const handleResize = () => {
      if (panZoomRef.current && isMounted) {
        try {
          panZoomRef.current.resize();
        } catch (e) {
          console.warn('Error resizing pan-zoom:', e);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMounted]);

  // Effect to handle tab changes with better error handling
  useEffect(() => {
    if (activeTab === 'chart' && isRendered && panZoomRef.current) {
      setTimeout(() => {
        if (isMounted && panZoomRef.current) {
          try {
            panZoomRef.current.resize();
            panZoomRef.current.fit();
          } catch (e) {
            console.warn('Error adjusting pan-zoom on tab change:', e);
          }
        }
      }, 100);
    }
  }, [activeTab, isMounted, isRendered, initPanZoom]);

  // Effect to initialize pan-zoom when SVG is rendered
  useEffect(() => {
    if (isRendered && svgString && chartRef.current && isMounted) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        if (isMounted && chartRef.current) {
          const svgElement = chartRef.current.querySelector('svg');
          if (svgElement) {
            // Destroy existing pan-zoom instance
            if (panZoomRef.current) {
              try {
                panZoomRef.current.destroy();
              } catch (e) {
                console.warn('Failed to destroy existing pan-zoom instance:', e);
              }
            }
            panZoomRef.current = initPanZoom(svgElement);
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isRendered, svgString, isMounted, initPanZoom]);

  const handleCodeChange = (e) => {
    setEditableCode(e.target.value);
  };

  const handleApplyChanges = () => {
    if (editableCode && editableCode !== chartCode) {
      // First update the code
      if (onCodeUpdate) {
        onCodeUpdate(editableCode);
      }
      
      // Clear SVG content to force re-rendering
      setIsRendered(false);
      setSvgString('');
      
      // Slight delay before rendering
      setTimeout(() => {
        renderChart(editableCode);
      }, 100);
      
      setActiveTab('chart');
    }
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
  };

  // Function to open save modal
  const handleOpenSaveModal = () => {
    setShowSaveModal(true);
  };

  // Function to close save modal
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

  return (
    <div className="chart-container">
      {/* <h2>Disaster Response Workflow</h2> */}
      
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
              Chart View
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
              Code Editor
            </button>
          </div>
          
          <div className="tab-content">
            <div 
              className={`tab-panel ${activeTab === 'chart' ? 'active' : ''}`}
              role="tabpanel"
              aria-hidden={activeTab !== 'chart'}
            >
              <div className="chart-display" ref={chartRef} style={{ width: '100%', height: '100%' }}>
                {!isRendered && !renderError && (
                  <div className="chart-loading">
                    Generating workflow...
                  </div>
                )}
                {renderError && retryCount > 0 && retryCount < 3 && (
                  <div className="chart-retry-message">
                    Retrying workflow generation... (Attempt {retryCount}/3)
                  </div>
                )}
                {isRendered && svgString && (
                  <div dangerouslySetInnerHTML={{ __html: svgString }} />
                )}
              </div>
              
              {isRendered && (
                <div className="chart-controls">
                  <p className="zoom-instructions">
                    <span className="control-icon">🔍</span> Zoom: Use mouse wheel or controls in top-right
                    <span className="control-icon">✋</span> Pan: Drag to adjust view position
                  </p>
                  <div className="button-group">
                    <button 
                      type="button"
                      className="save-chart-button" 
                      onClick={handleOpenSaveModal}
                      disabled={!isRendered || renderError}
                    >
                      Save Workflow
                    </button>
                    <button 
                      type="button"
                      className="save-image-button" 
                      onClick={saveAsImage}
                      disabled={!isRendered || renderError}
                    >
                      Save as Image
                    </button>
                  </div>
                </div>
              )}
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
                  placeholder="Enter Mermaid code here"
                />
                <div className="editor-controls">
                  <button 
                    type="button"
                    onClick={handleApplyChanges} 
                    className="apply-button"
                    disabled={!editableCode || editableCode === chartCode}
                  >
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {!chartCode && (
        <div className="chart-placeholder">
          <p>Workflow will be displayed when you upload a PDF</p>
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
