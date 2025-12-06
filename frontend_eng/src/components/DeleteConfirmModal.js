import React, { useState } from 'react';
import { Modal, Button, Alert, Spinner } from 'react-bootstrap';
import { deleteFlowchart } from '../config';

const DeleteConfirmModal = ({ show, handleClose, flowchart, onDeleteSuccess }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    if (!flowchart || !flowchart.id) return;
    
    setIsDeleting(true);
    setError(null);
    
    try {
      await deleteFlowchart(flowchart.id);
      
      // Call callback after successful deletion
      if (onDeleteSuccess) {
        onDeleteSuccess(flowchart.id);
      }
      
      handleClose();
    } catch (err) {
      setError(`Failed to delete: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Delete Flowchart</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        
        <p>Are you sure you want to delete the following flowchart?</p>
        
        {flowchart && (
          <div className="flowchart-info">
            <p><strong>Title:</strong> {flowchart.title || `${flowchart.location_name} Disaster Response Plan`}</p>
            <p>
              <strong>{flowchart.location_type === 'prefecture' ? 'Prefecture' : 'City/Municipality'}:</strong> {flowchart.location_name}
            </p>
            <p><strong>Created:</strong> {new Date(flowchart.created_at).toLocaleString('en-US')}</p>
          </div>
        )}
        
        <Alert variant="warning">
          <strong>Warning:</strong> This action cannot be undone. Deleted flowcharts cannot be recovered.
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={isDeleting}>
          Cancel
        </Button>
        <Button 
          variant="danger" 
          onClick={handleDelete} 
          disabled={isDeleting}
        >
          {isDeleting ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Deleting...
            </>
          ) : 'Delete'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DeleteConfirmModal;