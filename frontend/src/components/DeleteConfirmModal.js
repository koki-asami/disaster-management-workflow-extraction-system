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
      
      // 削除成功後のコールバックを呼び出す
      if (onDeleteSuccess) {
        onDeleteSuccess(flowchart.id);
      }
      
      handleClose();
    } catch (err) {
      setError(`削除に失敗しました: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>フローチャートの削除</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        
        <p>以下のフローチャートを削除しますか？</p>
        
        {flowchart && (
          <div className="flowchart-info">
            <p><strong>タイトル:</strong> {flowchart.title || `${flowchart.location_name} 防災計画`}</p>
            <p>
              <strong>{flowchart.location_type === 'prefecture' ? '都道府県' : '市区町村'}:</strong> {flowchart.location_name}
            </p>
            <p><strong>作成日:</strong> {new Date(flowchart.created_at).toLocaleString('ja-JP')}</p>
          </div>
        )}
        
        <Alert variant="warning">
          <strong>注意:</strong> この操作は取り消せません。削除したフローチャートは復元できません。
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={isDeleting}>
          キャンセル
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
              削除中...
            </>
          ) : '削除する'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DeleteConfirmModal;