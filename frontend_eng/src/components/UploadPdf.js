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
      alert('Only PDF files can be uploaded.');
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
      alert('Only PDF files can be uploaded.');
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
      <h2>Upload Disaster Response Plan PDF</h2>
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
          Select PDF
        </button>
        <p>Or drag and drop a PDF file here</p>
        {fileName && (
          <div className="file-info">
            <p>Selected file: {fileName}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadPdf;