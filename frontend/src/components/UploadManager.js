import React, { useEffect, useRef, useState } from 'react';
import { presignUpload, completeUpload, fetchUploads, deleteUpload } from '../config';
import './UploadPdf.css';

function bytesToMB(bytes) {
  if (!bytes && bytes !== 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function UploadManager({ disabled }) {
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

      setLocalUploads((prev) =>
        prev.map((u) =>
          u.tempId === tempId
            ? {
                ...u,
                status: 'uploaded',
                progress: 100,
                uploadId: upload_id,
              }
            : u
        )
      );

      // 一覧をリロード
      await loadUploads();
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
    // TODO: 抽出ジョブ作成 API (/extractions など) との連携は別タスク(frontend-progress-and-visualize)で実装
    console.log('Run extraction for upload_ids:', ids);
    alert('抽出ジョブの実行はバックエンド/API連携側のタスクとして未実装です。');
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

      <div style={{ marginTop: '1rem' }}>
        <h3>アップロード状況</h3>
        {isLoadingList && <p>アップロード一覧を取得中...</p>}

        {localUploads.length === 0 && serverUploads.length === 0 && !isLoadingList && (
          <p>まだアップロードされたPDFはありません。</p>
        )}

        {(localUploads.length > 0 || serverUploads.length > 0) && (
          <>
            <table style={{ width: '100%', fontSize: '0.9rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '2rem' }}></th>
                  <th>ファイル名</th>
                  <th>サイズ</th>
                  <th>ステータス</th>
                  <th>進捗</th>
                  <th>操作</th>
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
                      />
                    </td>
                    <td>{u.filename}</td>
                    <td>{bytesToMB(u.size_bytes)}</td>
                    <td>{u.status}</td>
                    <td>
                      {u.status === 'uploaded' ? '100%' : u.status === 'pending' ? '0%' : '-'}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDelete(u.upload_id)}
                        style={{ fontSize: '0.8rem' }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
                {localUploads.map((u) => (
                  <tr key={u.tempId}>
                    <td></td>
                    <td>{u.filename}</td>
                    <td>{bytesToMB(u.sizeBytes)}</td>
                    <td>{u.status}</td>
                    <td>
                      {typeof u.progress === 'number' && (
                        <span>{u.progress}%</span>
                      )}
                    </td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
              <button
                type="button"
                className="upload-button"
                onClick={handleRunExtraction}
                disabled={selectedIds.size === 0}
              >
                選択したPDFで抽出を実行
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default UploadManager;

