import React, { useState } from 'react';
import './SaveFlowchartModal.css';
import { saveFlowchart } from '../config';

const SaveFlowchartModal = ({ show, handleClose, chartCode, onSave, fileId }) => {
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
            setError('Please enter a location name');
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
            // Check if chart code is too large (400KB)
            const chartCodeSize = new Blob([chartCode]).size;
            if (chartCodeSize > 400 * 1024) {
                setError('Flowchart size is too large. Please simplify the chart or save it using another method.');
                setIsLoading(false);
                return;
            }

            const data = await saveFlowchart(
                chartCode,
                locationType,
                locationName,
                title,
                null, // chartId
                fileId
            );

            if (onSave) {
                onSave(data);
            }
            handleClose();
        } catch (err) {
            console.error('Save flowchart error:', err);
            setError(err.message || 'Failed to save flowchart');
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
                <h2>Save Flowchart</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="locationType">Location Type</label>
                        <select
                            id="locationType"
                            value={locationType}
                            onChange={(e) => setLocationType(e.target.value)}
                            required
                        >
                            <option value="prefecture">Prefecture</option>
                            <option value="city">City/Municipality</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="locationName">Location Name</label>
                        <input
                            type="text"
                            id="locationName"
                            value={locationName}
                            onChange={(e) => setLocationName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="title">Title</label>
                        <input
                            type="text"
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>fileId: {fileId || 'None'}</label>
                    </div>
                    {error && <div className="error-message">{error}</div>}
                    <div className="modal-buttons">
                        <button type="button" onClick={handleClose}>
                            Cancel
                        </button>
                        <button type="submit" disabled={isLoading}>
                            {isLoading ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SaveFlowchartModal;
