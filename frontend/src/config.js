// API: FastAPI は /api/v1 プレフィックス。ヘルスはルート /health。
const viteOrigin =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_ORIGIN;
const vitePrefix =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_PREFIX;
const viteEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

const CRA_ORIGIN = typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_ORIGIN;
const CRA_PREFIX =
  typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_PREFIX;

const _defaultOrigin =
  typeof window !== 'undefined' &&
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV
    ? ''
    : 'http://localhost:8000';

export const API_ORIGIN = String(viteOrigin || CRA_ORIGIN || _defaultOrigin).replace(/\/$/, '');
export const API_PREFIX = String(vitePrefix || CRA_PREFIX || '/api/v1');
const prefixNorm = API_PREFIX.startsWith('/') ? API_PREFIX : `/${API_PREFIX}`;
export const API_ENDPOINT = `${API_ORIGIN}${prefixNorm}`.replace(/\/$/, '');

const TOKEN_KEY = 'dmwe_access_token';
const TOKEN_EXPIRES_AT_KEY = 'dmwe_access_token_expires_at';

const cognitoDomainRaw = viteEnv.VITE_COGNITO_DOMAIN || '';
const cognitoClientId = viteEnv.VITE_COGNITO_APP_CLIENT_ID || '';
const cognitoRedirectUri = viteEnv.VITE_COGNITO_REDIRECT_URI || (
  typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''
);
const cognitoLogoutUri = viteEnv.VITE_COGNITO_LOGOUT_URI || (
  typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''
);
const authDisabled = String(viteEnv.VITE_AUTH_DISABLED || '').toLowerCase();
export const FRONTEND_AUTH_DISABLED = ['1', 'true', 'yes'].includes(authDisabled);
export const DEV_TOKEN_INPUT_ENABLED =
  !!viteEnv.DEV || String(viteEnv.VITE_ENABLE_DEV_TOKEN || '').toLowerCase() === 'true';

function cognitoDomain() {
  if (!cognitoDomainRaw) return '';
  return cognitoDomainRaw.startsWith('http')
    ? cognitoDomainRaw.replace(/\/$/, '')
    : `https://${cognitoDomainRaw}`.replace(/\/$/, '');
}

export function isCognitoConfigured() {
  return !!cognitoDomain() && !!cognitoClientId && !!cognitoRedirectUri;
}

export function isAuthRequired() {
  return !FRONTEND_AUTH_DISABLED && isCognitoConfigured();
}

export function getAccessToken() {
  if (typeof window === 'undefined') return null;
  const expiresAt = Number(window.sessionStorage.getItem(TOKEN_EXPIRES_AT_KEY) || 0);
  if (expiresAt && Date.now() >= expiresAt) {
    setAccessToken(null);
    return null;
  }
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token, expiresInSeconds = null) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    if (expiresInSeconds) {
      window.sessionStorage.setItem(
        TOKEN_EXPIRES_AT_KEY,
        String(Date.now() + Number(expiresInSeconds) * 1000)
      );
    }
  } else {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
  }
}

export function authHeaders() {
  const t = getAccessToken();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export function consumeCognitoRedirect() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash?.startsWith('#')
    ? window.location.hash.substring(1)
    : '';
  const params = new URLSearchParams(hash);
  const token = params.get('access_token') || params.get('id_token');
  if (!token) return null;
  setAccessToken(token, params.get('expires_in'));
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return token;
}

export function redirectToCognitoLogin() {
  if (!isCognitoConfigured()) {
    throw new Error('Cognito Hosted UI is not configured');
  }
  const params = new URLSearchParams({
    client_id: cognitoClientId,
    response_type: 'token',
    scope: 'openid email profile',
    redirect_uri: cognitoRedirectUri,
  });
  window.location.assign(`${cognitoDomain()}/login?${params.toString()}`);
}

export function logoutFromCognito() {
  const hadCognito = isCognitoConfigured();
  setAccessToken(null);
  if (!hadCognito || typeof window === 'undefined') return;
  const params = new URLSearchParams({
    client_id: cognitoClientId,
    logout_uri: cognitoLogoutUri,
  });
  window.location.assign(`${cognitoDomain()}/logout?${params.toString()}`);
}

export async function analyzePdf(filesInput) {
  const files = Array.isArray(filesInput) ? filesInput : [filesInput];

  if (!files || files.length === 0) {
    throw new Error('解析対象のPDFファイルが指定されていません');
  }

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

  const payloadFiles = await Promise.all(files.map(readFileAsBase64));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);

  try {
    const response = await fetch(`${API_ENDPOINT}/analyze_pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ files: payloadFiles }),
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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

    return response.json();
  } catch (fetchError) {
    if (fetchError.name === 'AbortError') {
      throw new Error('リクエストがタイムアウトしました。サーバーの応答がありません。');
    }
    throw fetchError;
  }
}

export async function chatUpdate(history, message, fileId, graphData = null) {
  const formattedHistory = history.map((entry) => ({
    role: entry.role,
    content: entry.content,
    chart: entry.chart || null,
  }));

  const payload = {
    instruction: message,
    history: formattedHistory,
    file_id: fileId,
    graph_data: graphData,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);

  const response = await fetch(`${API_ENDPOINT}/chat_update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
    mode: 'cors',
    credentials: 'omit',
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

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

  return response.json();
}

export async function presignUpload(filename, contentType = 'application/pdf') {
  const response = await fetch(`${API_ENDPOINT}/uploads/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ filename, content_type: contentType }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`プリサインURLの取得に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function completeUpload(uploadId, sizeBytes) {
  const response = await fetch(`${API_ENDPOINT}/uploads/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ upload_id: uploadId, size_bytes: sizeBytes }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`アップロード完了の登録に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function fetchUploads() {
  const response = await fetch(`${API_ENDPOINT}/uploads`, {
    method: 'GET',
    headers: { ...authHeaders() },
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
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`アップロードの削除に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function createExtractionJob(uploadIds) {
  const response = await fetch(`${API_ENDPOINT}/extractions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ upload_ids: uploadIds }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`抽出ジョブの作成に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function getExtractionJob(jobId) {
  const response = await fetch(`${API_ENDPOINT}/extractions/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`抽出ジョブ情報の取得に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function cancelExtractionJob(jobId) {
  const response = await fetch(`${API_ENDPOINT}/extractions/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`キャンセルに失敗しました: ${errorText}`);
  }
  return response.json();
}

export async function diagnoseWorkflow(graphData) {
  const response = await fetch(`${API_ENDPOINT}/plan/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ graph_data: graphData || {} }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`分析の実行に失敗しました: ${errorText}`);
  }

  return response.json();
}

export async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${API_ORIGIN}/health`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        status: 'error',
        message: `バックエンドサーバーからエラーレスポンス: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    return { status: 'ok', message: 'バックエンドサーバーに接続できました', data };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        status: 'error',
        message: 'バックエンドサーバーへの接続がタイムアウトしました',
      };
    }
    return {
      status: 'error',
      message: `バックエンドサーバーに接続できません: ${error.message}`,
    };
  }
}

export const saveFlowchart = async (
  chartCode,
  locationType,
  locationName,
  title = '',
  chartId = null,
  fileId = null,
  graphData = null
) => {
  const response = await fetch(`${API_ENDPOINT}/save_flowchart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      chart_code: chartCode,
      location_type: locationType,
      location_name: locationName,
      title: title,
      chart_id: chartId,
      file_id: fileId,
      graph_data: graphData,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to save flowchart');
  }

  return response.json();
};

export const listFlowcharts = async (locationType = null, locationName = null) => {
  let url = `${API_ENDPOINT}/list_flowcharts`;
  const params = new URLSearchParams();
  if (locationType) params.append('location_type', locationType);
  if (locationName) params.append('location_name', locationName);
  const queryString = params.toString();
  if (queryString) url += `?${queryString}`;

  const response = await fetch(url, { headers: { ...authHeaders() } });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch flowcharts');
  }

  const data = await response.json();
  return data.flowcharts || [];
};

export const getFlowchart = async (chartId) => {
  const response = await fetch(`${API_ENDPOINT}/get_flowchart/${chartId}`, {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch flowchart');
  }

  return response.json();
};

export const deleteFlowchart = async (chartId) => {
  const response = await fetch(`${API_ENDPOINT}/delete_flowchart/${chartId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to delete flowchart');
  }

  return response.json();
};
