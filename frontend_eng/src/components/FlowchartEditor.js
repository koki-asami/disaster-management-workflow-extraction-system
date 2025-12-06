import React, { useEffect, useState } from 'react';

const FlowchartEditor = () => {
  const [chartId, setChartId] = useState(null);
  const [flowchartData, setFlowchartData] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);

  useEffect(() => {
    const fetchFlowchart = async () => {
      if (!chartId) return;

      try {
        const response = await fetch(`${API_URL}/flowcharts/${chartId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch flowchart');
        }
        const data = await response.json();
        
        // Set flowchart data
        setFlowchartData(data);
        
        // If there's a PDF URL, set it as the default PDF
        if (data.pdf_url) {
          setPdfUrl(data.pdf_url);
        } else {
          // Try to get the default PDF for this location
          const defaultPdfResponse = await fetch(
            `${API_URL}/flowcharts/default-pdf?location_name=${encodeURIComponent(data.location_name)}`
          );
          if (defaultPdfResponse.ok) {
            const defaultPdfData = await defaultPdfResponse.json();
            if (defaultPdfData.pdf_url) {
              setPdfUrl(defaultPdfData.pdf_url);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching flowchart:', error);
      }
    };

    fetchFlowchart();
  }, [chartId]);

  return (
    <div>
      {/* Render your component content here */}
    </div>
  );
};

export default FlowchartEditor; 