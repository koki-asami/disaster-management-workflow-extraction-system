import React, { useRef, useState } from 'react';
import './UploadPdf.css';

function UploadPdf({ onUpload, disabled }) {
  const fileInputRef = useRef(null);
  const [fileNames, setFileNames] = useState([]);

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(
      (file) => file.type === 'application/pdf'
    );

    if (files.length === 0 && fileList.length > 0) {
      alert('PDFファイルのみアップロード可能です。');
      return;
    }

    if (files.length > 0) {
      setFileNames(files.map((f) => f.name));
      onUpload(files);
    }
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

  return (
    <div
      className={`upload-container ${disabled ? 'disabled' : ''}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <h2>防災計画PDFをアップロード</h2>
      <div className="upload-area">
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
          PDFを選択（複数可）
        </button>
        <p>または、ここにPDFファイルをドラッグ&ドロップ</p>
        {fileNames.length > 0 && (
          <div className="file-info">
            <p>選択されたファイル:</p>
            <ul>
              {fileNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadPdf;