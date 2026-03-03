import React, { useState } from 'react';
import './SaveFlowchartModal.css';
import { saveFlowchart } from '../config';

const SaveFlowchartModal = ({ show, handleClose, chartCode, onSave, fileId, graphData }) => {
    const [locationType, setLocationType] = useState('prefecture');
    const [locationName, setLocationName] = useState('');
    const [title, setTitle] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        // Validate required fields
        if (!locationName.trim()) {
            setError('場所の名前を入力してください');
            setIsLoading(false);
            return;
        }

        // if (!fileId) {
        //     setError('ファイルIDがありません。PDFを再度アップロードしてください。');
        //     setIsLoading(false);
        //     return;
        // }

        console.log('fileId:', fileId);

        try {
            // chartCode も graphData もない場合は保存できない
            if (!chartCode && !graphData) {
                setError('保存できるフローチャートデータがありません（タスク抽出後にお試しください）');
                setIsLoading(false);
                return;
            }

            // Check if chart code is too large (400KB) — chartCode がある場合のみ
            if (chartCode) {
                const chartCodeSize = new Blob([chartCode]).size;
                if (chartCodeSize > 400 * 1024) {
                    setError('フローチャートのサイズが大きすぎます。チャートを簡略化するか、別の方法で保存してください。');
                    setIsLoading(false);
                    return;
                }
            }

            const data = await saveFlowchart(
                chartCode || '',
                locationType,
                locationName,
                title,
                null, // chartId
                fileId,
                graphData || null,
            );

            if (onSave) {
                onSave(data);
            }
            handleClose();
        } catch (err) {
            console.error('Save flowchart error:', err);
            setError(err.message || 'フローチャートの保存に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    if (!show) {
        return null;
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>フローチャートを保存</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="locationType">場所の種類</label>
                        <select
                            id="locationType"
                            value={locationType}
                            onChange={(e) => setLocationType(e.target.value)}
                            required
                        >
                            <option value="prefecture">都道府県</option>
                            <option value="city">市区町村</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="locationName">場所の名前</label>
                        <input
                            type="text"
                            id="locationName"
                            value={locationName}
                            onChange={(e) => setLocationName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="title">タイトル</label>
                        <input
                            type="text"
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>fileId: {fileId || 'なし'}</label>
                    </div>
                    {error && <div className="error-message">{error}</div>}
                    <div className="modal-buttons">
                        <button type="button" onClick={handleClose}>
                            キャンセル
                        </button>
                        <button type="submit" disabled={isLoading}>
                            {isLoading ? '保存中...' : '保存'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SaveFlowchartModal;
