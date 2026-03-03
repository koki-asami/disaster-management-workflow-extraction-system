// APIエンドポイントを環境変数から取得するか、デフォルト値を使用
export const API_ENDPOINT = process.env.REACT_APP_API_ENDPOINT || "http://localhost:8081";

export async function analyzePdf(filesInput) {
  const files = Array.isArray(filesInput) ? filesInput : [filesInput];

  if (!files || files.length === 0) {
    throw new Error('解析対象のPDFファイルが指定されていません');
  }

  console.log(
    `Analyzing ${files.length} PDF(s): ${files
      .map((f) => `${f.name} (${f.size} bytes)`)
      .join(', ')}`
  );

  // File を Base64 に変換するヘルパー
  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = reader.result;
          const base64Data = typeof result === 'string' ? result.split(',')[1] : null;
          if (!base64Data) {
            reject(new Error('ファイルのBase64変換に失敗しました'));
            return;
          }
          resolve({ filename: file.name, pdf_data: base64Data });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => {
        reject(new Error('ファイルの読み込みに失敗しました'));
      };
      reader.readAsDataURL(file);
    });

  // すべてのファイルをBase64に変換
  const payloadFiles = await Promise.all(files.map(readFileAsBase64));

  console.log('Sending PDF data to backend for analysis');

  // タイムアウト処理を追加
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 600秒タイムアウト

  try {
    const response = await fetch(`${API_ENDPOINT}/analyze_pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: payloadFiles }),
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
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
    return data;
  } catch (fetchError) {
    if (fetchError.name === 'AbortError') {
      throw new Error('リクエストがタイムアウトしました。サーバーの応答がありません。');
    }
    throw fetchError;
  }
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

// ===== Uploads API (S3 プリサイン付きアップロード用) =====

export async function presignUpload(filename, contentType = 'application/pdf') {
  const response = await fetch(`${API_ENDPOINT}/uploads/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content_type: contentType }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`プリサインURLの取得に失敗しました: ${errorText}`);
  }

  return response.json(); // { upload_id, object_key, upload_url }
}

export async function completeUpload(uploadId, sizeBytes) {
  const response = await fetch(`${API_ENDPOINT}/uploads/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, size_bytes: sizeBytes }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`アップロード完了の登録に失敗しました: ${errorText}`);
  }

  return response.json(); // { upload: {...} }
}

export async function fetchUploads() {
  const response = await fetch(`${API_ENDPOINT}/uploads`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`アップロード一覧の取得に失敗しました: ${errorText}`);
  }

  const data = await response.json();
  return data.uploads || [];
}

export async function deleteUpload(uploadId) {
  const response = await fetch(`${API_ENDPOINT}/uploads/${encodeURIComponent(uploadId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`アップロードの削除に失敗しました: ${errorText}`);
  }

  return response.json();
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
