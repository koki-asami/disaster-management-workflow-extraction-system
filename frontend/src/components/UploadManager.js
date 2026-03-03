import React, { useEffect, useRef, useState } from 'react';
import { presignUpload, completeUpload, fetchUploads, deleteUpload } from '../config';
import './UploadPdf.css';

function bytesToMB(bytes) {
  if (!bytes && bytes !== 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function UploadManager({ disabled, onRunExtraction, onUploadsChange, onSelectionChange, isJobRunning }) {
  const fileInputRef = useRef(null);
  const [localUploads, setLocalUploads] = useState([]); // クライアント側の進捗付き状態
  const [serverUploads, setServerUploads] = useState([]); // /uploads から取得した一覧
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isLoadingList, setIsLoadingList] = useState(false);

  const loadUploads = async () => {
    try {
      setIsLoadingList(true);
      const uploads = await fetchUploads();
      setServerUploads(uploads);
    } catch (e) {
      console.error('Failed to fetch uploads', e);
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
    const tempId = `${file.name}-${file.size}-${file.lastModified}`;

    setLocalUploads((prev) => [
      ...prev,
      {
        tempId,
        filename: file.name,
        sizeBytes: file.size,
        status: 'uploading',
        progress: 0,
        uploadId: null,
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

      // 完了をバックエンドに通知
      await completeUpload(upload_id, file.size);

      // 一覧をリロード
      await loadUploads();

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

      <div className="upload-status-section">
        <div className="upload-status-header">
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
                    <td>
                      {u.status === 'uploaded'
                        ? 'アップロード完了'
                        : u.status === 'pending'
                          ? 'アップロード中'
                          : u.status === 'processing'
                            ? '処理中'
                            : u.status === 'error'
                              ? 'エラー'
                              : u.status}
                    </td>
                    <td>
                      {u.status === 'uploaded'
                        ? '100%'
                        : u.status === 'pending'
                          ? `${localByUploadId.get(u.upload_id)?.progress ?? 0}%`
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
                disabled={selectedIds.size === 0 || isJobRunning}
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

