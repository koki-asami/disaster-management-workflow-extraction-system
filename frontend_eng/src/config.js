// APIエンドポイントを環境変数から取得するか、デフォルト値を使用
export const API_ENDPOINT = process.env.REACT_APP_API_ENDPOINT || "http://localhost:8081";

export async function analyzePdf(file) {
  console.log(`Analyzing PDF: ${file.name}, size: ${file.size} bytes`);
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Base64エンコードされたPDFデータを取得
        const base64Data = reader.result.split(',')[1];
        
        console.log('Sending PDF data to backend for analysis');
        
        try {
          // タイムアウト処理を追加
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000000); // 60秒タイムアウト
          
          const response = await fetch(`${API_ENDPOINT}/analyze_pdf`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pdf_data: base64Data, filename: file.name }),
            mode: 'cors',
            credentials: 'omit',
            signal: controller.signal
          });
          
          clearTimeout(timeoutId); // タイムアウトをクリア
          console.log('Received response from backend:', response);
          
          if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = 'PDF解析に失敗しました';
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.error || errorMessage;
            } catch (e) {
              errorMessage = `${errorMessage}: ${errorText.substring(0, 100)}...`;
            }
            throw new Error(errorMessage);
          }
          
          const data = await response.json();
          console.log('PDF analysis completed successfully');
          resolve(data);
        } catch (fetchError) {
          if (fetchError.name === 'AbortError') {
            reject(new Error('リクエストがタイムアウトしました。サーバーの応答がありません。'));
          } else {
            reject(fetchError);
          }
        }
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => {
      reject(new Error('ファイルの読み込みに失敗しました'));
    };
    reader.readAsDataURL(file);
  });
}

export async function chatUpdate(history, message, fileId) {
  console.log(`Sending chat update with message: ${message.substring(0, 50)}...`);
  
  try {
    // 履歴データを整形
    const formattedHistory = history.map(entry => ({
      role: entry.role,
      content: entry.content,
      chart: entry.chart || null
    }));

    console.log('on chatUpdate, fileId:', fileId);
    
    const payload = {
      instruction: message,
      history: formattedHistory,
      file_id: fileId
    };
    
    // タイムアウト処理を追加
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 60秒タイムアウト
    
    const response = await fetch(`${API_ENDPOINT}/chat_update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId); // タイムアウトをクリア
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'チャット更新に失敗しました';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        errorMessage = `${errorMessage}: ${errorText.substring(0, 100)}...`;
      }
      throw new Error(errorMessage);
    }
    
    const data = await response.json();
    console.log('Chat update completed successfully');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('リクエストがタイムアウトしました。サーバーの応答がありません。');
    }
    throw error;
  }
}

// ヘルスチェック関数
export async function checkBackendHealth() {
  try {
    // タイムアウト処理を追加
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒タイムアウト
    
    const response = await fetch(`${API_ENDPOINT}/health`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId); // タイムアウトをクリア
    
    if (!response.ok) {
      return { 
        status: 'error', 
        message: `バックエンドサーバーからエラーレスポンス: ${response.status} ${response.statusText}` 
      };
    }
    
    const data = await response.json();
    return { status: 'ok', message: 'バックエンドサーバーに接続できました', data };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { 
        status: 'error', 
        message: 'バックエンドサーバーへの接続がタイムアウトしました' 
      };
    } 
    else {
      return { 
        status: 'error', 
        message: `バックエンドサーバーに接続できません: ${error.message}` 
      };
    }
  }
}

// Save flowchart to database
export const saveFlowchart = async (chartCode, locationType, locationName, title = '', chartId = null, fileId = null) => {
  try {
    const response = await fetch(`${API_ENDPOINT}/save_flowchart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chart_code: chartCode,
        location_type: locationType,
        location_name: locationName,
        title: title,
        chart_id: chartId,
        file_id: fileId
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save flowchart');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving flowchart:', error);
    throw error;
  }
};

// List all flowcharts
export const listFlowcharts = async (locationType = null, locationName = null) => {
  try {
    let url = `${API_ENDPOINT}/list_flowcharts`;
    
    // Add query parameters if provided
    const params = new URLSearchParams();
    if (locationType) params.append('location_type', locationType);
    if (locationName) params.append('location_name', locationName);
    
    // Append params to URL if any exist
    const queryString = params.toString();
    if (queryString) url += `?${queryString}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch flowcharts');
    }
    
    const data = await response.json();
    return data.flowcharts || [];
  } catch (error) {
    console.error('Error listing flowcharts:', error);
    throw error;
  }
};

// Get a specific flowchart by ID
export const getFlowchart = async (chartId) => {
  try {
    const response = await fetch(`${API_ENDPOINT}/get_flowchart/${chartId}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch flowchart');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting flowchart:', error);
    throw error;
  }
};

// フローチャートを削除する関数
export const deleteFlowchart = async (chartId) => {
  try {
    const response = await fetch(`${API_ENDPOINT}/delete_flowchart/${chartId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to delete flowchart');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error deleting flowchart:', error);
    throw error;
  }
};
