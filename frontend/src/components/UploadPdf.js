import React, { useRef, useState } from 'react';
import './UploadPdf.css';

function UploadPdf({ onUpload, disabled }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setFileName(file.name);
      onUpload(file);
    } else if (file) {
      alert('PDFファイルのみアップロード可能です。');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      setFileName(file.name);
      console.log("Uploading file to OpenAI API: %s", file);
      onUpload(file);
    } else if (file) {
      alert('PDFファイルのみアップロード可能です。');
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current.click();
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
          PDFを選択
        </button>
        <p>または、ここにPDFファイルをドラッグ&ドロップ</p>
        {fileName && (
          <div className="file-info">
            <p>選択されたファイル: {fileName}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadPdf;