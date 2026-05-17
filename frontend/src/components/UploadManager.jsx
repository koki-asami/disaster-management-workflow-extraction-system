import React, { useEffect, useRef, useState } from 'react';
import { presignUpload, completeUpload, fetchUploads, deleteUpload } from '../config';
import './UploadPdf.css';

function bytesToMB(bytes) {
  if (!bytes && bytes !== 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function uploadStatusLabel(status) {
  switch (status) {
    case 'preparing':
      return 'アップロード準備中';
    case 'uploading':
      return 'S3へアップロード中';
    case 'completing':
      return '登録中';
    case 'refreshing':
      return '一覧を更新中';
    case 'refresh_failed':
      return '一覧更新失敗';
    case 'uploaded':
      return 'アップロード完了';
    case 'pending':
      return 'アップロード中';
    case 'processing':
      return '処理中';
    case 'error':
      return 'エラー';
    default:
      return status || '-';
  }
}

function isLocalUploadActive(upload) {
  return ['preparing', 'uploading', 'completing', 'refreshing'].includes(upload.status);
}

function UploadManager({
  disabled,
  onRunExtraction,
  onImportJson,
  onUploadsChange,
  onSelectionChange,
  isJobRunning,
}) {
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const [localUploads, setLocalUploads] = useState([]); // クライアント側の進捗付き状態
  const [serverUploads, setServerUploads] = useState([]); // /uploads から取得した一覧
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isLoadingList, setIsLoadingList] = useState(false);

  const loadUploads = async () => {
    try {
      setIsLoadingList(true);
      const uploads = await fetchUploads();
      setServerUploads(uploads);
      return uploads;
    } catch (e) {
      console.error('Failed to fetch uploads', e);
      return null;
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadUploads();
  }, []);

  useEffect(() => {
    if (onUploadsChange) {
      onUploadsChange(serverUploads);
    }
  }, [serverUploads, onUploadsChange]);

  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(Array.from(selectedIds));
    }
  }, [selectedIds, onSelectionChange]);

  const startUpload = async (file) => {
    const tempId = `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${Math.random()}`;

    setLocalUploads((prev) => [
      ...prev,
      {
        tempId,
        filename: file.name,
        sizeBytes: file.size,
        status: 'preparing',
        progress: 0,
        uploadId: null,
        errorMessage: null,
      },
    ]);

    try {
      const { upload_id, upload_url } = await presignUpload(file.name, 'application/pdf');

      // サーバー側レコード（pending）と紐づけできるよう uploadId を保持
      setLocalUploads((prev) =>
        prev.map((u) =>
          u.tempId === tempId
            ? {
                ...u,
                uploadId: upload_id,
                status: 'uploading',
              }
            : u
        )
      );

      // XHR で PUT しつつ進捗を反映
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', 'application/pdf');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setLocalUploads((prev) =>
              prev.map((u) =>
                u.tempId === tempId
                  ? {
                      ...u,
                      progress: percent,
                    }
                  : u
              )
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error during upload'));
        };

        xhr.send(file);
      });

      setLocalUploads((prev) =>
        prev.map((u) =>
          u.tempId === tempId
            ? {
                ...u,
                status: 'completing',
                progress: 100,
              }
            : u
        )
      );

      // 完了をバックエンドに通知
      await completeUpload(upload_id, file.size);

      setLocalUploads((prev) =>
        prev.map((u) =>
          u.tempId === tempId
            ? {
                ...u,
                status: 'refreshing',
                progress: 100,
              }
            : u
        )
      );

      // 一覧をリロード
      const refreshedUploads = await loadUploads();
      if (!refreshedUploads) {
        setLocalUploads((prev) =>
          prev.map((u) =>
            u.tempId === tempId
              ? {
                  ...u,
                  status: 'refresh_failed',
                  progress: 100,
                  errorMessage:
                    'アップロードは完了しましたが、一覧の更新に失敗しました。画面を再読み込みしてください。',
                }
              : u
          )
        );
        return;
      }

      // ローカルの進捗行は完了後に消す（サーバー一覧に反映されるため）
      setLocalUploads((prev) => prev.filter((u) => u.tempId !== tempId));
    } catch (e) {
      console.error('Upload failed', e);
      setLocalUploads((prev) =>
        prev.map((u) =>
          u.tempId === tempId
            ? {
                ...u,
                status: 'error',
                errorMessage: e.message || 'アップロードに失敗しました。',
              }
            : u
        )
      );
    }
  };

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type === 'application/pdf');

    if (files.length === 0 && fileList.length > 0) {
      alert('PDFファイルのみアップロード可能です。');
      return;
    }

    files.forEach((file) => {
      if (disabled) return;
      startUpload(file);
    });
  };

  const handleFileChange = (e) => {
    if (disabled) return;
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  const handleButtonClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleJsonButtonClick = () => {
    if (jsonInputRef.current) {
      jsonInputRef.current.click();
    }
  };

  const handleJsonFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onImportJson) {
      onImportJson(file);
    }
    e.target.value = '';
  };

  const toggleSelect = (uploadId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uploadId)) {
        next.delete(uploadId);
      } else {
        next.add(uploadId);
      }
      return next;
    });
  };

  const handleDelete = async (uploadId) => {
    if (!window.confirm('このアップロードを削除しますか？')) return;
    try {
      await deleteUpload(uploadId);
      await loadUploads();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(uploadId);
        return next;
      });
    } catch (e) {
      console.error('Failed to delete upload', e);
      alert('削除に失敗しました。コンソールログを確認してください。');
    }
  };

  const handleRunExtraction = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      alert('抽出対象のPDFを少なくとも1つ選択してください。');
      return;
    }
    if (onRunExtraction) {
      onRunExtraction(ids);
    }
  };

  const localByUploadId = new Map(
    localUploads.filter((u) => u.uploadId).map((u) => [u.uploadId, u])
  );
  const activeLocalUploads = localUploads.filter(isLocalUploadActive);
  const hasActiveUploads = activeLocalUploads.length > 0;

  const renderProgress = (progress, status) => {
    const normalizedProgress =
      status === 'uploaded' ? 100 : Math.max(0, Math.min(100, Number(progress) || 0));
    return (
      <div className="upload-progress-cell">
        <div
          className={`upload-progress-bar ${
            status === 'error' || status === 'refresh_failed' ? 'error' : ''
          }`}
          aria-label={`アップロード進捗 ${normalizedProgress}%`}
        >
          <div style={{ width: `${normalizedProgress}%` }} />
        </div>
        <span className="upload-progress-text">
          {status === 'preparing' ? '待機中' : `${normalizedProgress}%`}
        </span>
      </div>
    );
  };

  return (
    <div className={`upload-container ${disabled ? 'disabled' : ''}`}>
      <h2>PDFアップロード & 抽出ジョブ管理</h2>

      <div
        className="upload-area"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileChange}
          ref={fileInputRef}
          style={{ display: 'none' }}
          disabled={disabled}
        />
        <button
          onClick={handleButtonClick}
          disabled={disabled}
          className="upload-button"
        >
          PDFを選択してアップロード（複数可）
        </button>
        <p>または、ここにPDFファイルをドラッグ&ドロップ</p>
      </div>

      <div className="workflow-json-import">
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleJsonFileChange}
          ref={jsonInputRef}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={handleJsonButtonClick}
          className="upload-button upload-json-button"
        >
          分析用JSONを読み込んで表示
        </button>
      </div>

      <div className="upload-status-section">
        <div className="upload-status-header">
          {hasActiveUploads && (
            <span className="upload-status-pill active">
              アップロード中 {activeLocalUploads.length}件
            </span>
          )}
          {isLoadingList && <span className="upload-status-pill">更新中...</span>}
        </div>

        {localUploads.length === 0 && serverUploads.length === 0 && !isLoadingList && (
          <p className="upload-status-empty">まだアップロードされたPDFはありません。</p>
        )}

        {(localUploads.length > 0 || serverUploads.length > 0) && (
          <>
            <table className="upload-status-table">
              <thead>
                <tr>
                  <th className="upload-status-col-select">抽出対象</th>
                  <th className="upload-status-col-name">ファイル名</th>
                  <th className="upload-status-col-size">サイズ</th>
                  <th className="upload-status-col-state">状態</th>
                  <th className="upload-status-col-progress">アップロード</th>
                  <th className="upload-status-col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {localUploads.map((u) => (
                  <tr
                    key={u.tempId}
                    className={`upload-status-local-row ${
                      u.status === 'error' || u.status === 'refresh_failed' ? 'error' : ''
                    }`}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={false}
                        disabled
                        aria-label="アップロード完了後に選択できます"
                      />
                    </td>
                    <td>
                      <div className="upload-file-name">{u.filename}</div>
                      {u.errorMessage && (
                        <div className="upload-error-message">{u.errorMessage}</div>
                      )}
                    </td>
                    <td>{bytesToMB(u.sizeBytes)}</td>
                    <td>{uploadStatusLabel(u.status)}</td>
                    <td>{renderProgress(u.progress, u.status)}</td>
                    <td>
                      {u.status === 'error' || u.status === 'refresh_failed' ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLocalUploads((prev) =>
                              prev.filter((item) => item.tempId !== u.tempId)
                            )
                          }
                          aria-label="アップロード失敗行を閉じる"
                          title="閉じる"
                          className="upload-status-delete-button"
                        >
                          ×
                        </button>
                      ) : (
                        <span className="upload-status-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {serverUploads.map((u) => (
                  <tr key={u.upload_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.upload_id)}
                        onChange={() => toggleSelect(u.upload_id)}
                        disabled={u.status !== 'uploaded'}
                        aria-label="抽出対象として選択"
                      />
                    </td>
                    <td>{u.filename}</td>
                    <td>{bytesToMB(u.size_bytes)}</td>
                    <td>{uploadStatusLabel(u.status)}</td>
                    <td>
                      {u.status === 'uploaded'
                        ? renderProgress(100, 'uploaded')
                        : u.status === 'pending'
                          ? renderProgress(localByUploadId.get(u.upload_id)?.progress ?? 0, 'pending')
                          : '-'}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDelete(u.upload_id)}
                        aria-label="アップロードを削除"
                        title="削除"
                        className="upload-status-delete-button"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="upload-status-footer">
              <button
                type="button"
                className="upload-button"
                onClick={handleRunExtraction}
                disabled={selectedIds.size === 0 || isJobRunning || hasActiveUploads}
              >
                選択したPDFで抽出を開始
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default UploadManager;
