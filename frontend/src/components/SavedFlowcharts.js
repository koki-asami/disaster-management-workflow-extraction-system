import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, InputGroup } from 'react-bootstrap';
import { listFlowcharts, getFlowchart } from '../config';
import DeleteConfirmModal from './DeleteConfirmModal';
import './SavedFlowcharts.css';

const SavedFlowcharts = ({ onSelectFlowchart }) => {
  const [flowcharts, setFlowcharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocationType, setSelectedLocationType] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [flowchartToDelete, setFlowchartToDelete] = useState(null);
  const [selectLoading, setSelectLoading] = useState(false);
  const [selectError, setSelectError] = useState(null);

  // Fetch flowcharts on component mount
  useEffect(() => {
    fetchFlowcharts();
  }, []);

  const fetchFlowcharts = async () => {
    try {
      setLoading(true);
      const data = await listFlowcharts();
      console.log("Fetched flowcharts:", data);
      setFlowcharts(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching flowcharts:', err);
      setError(`フローチャートの取得に失敗しました: ${err.message}`);
      setFlowcharts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (flowchart, e) => {
    e.stopPropagation(); // Prevent card click
    setFlowchartToDelete(flowchart);
    setShowDeleteModal(true);
  };

  const handleDeleteSuccess = (deletedId) => {
    // Remove the deleted flowchart from the list
    setFlowcharts(prevFlowcharts => 
      prevFlowcharts.filter(chart => chart.id !== deletedId)
    );
  };

  const handleSelectFlowchart = async (chart) => {
    try {
      setSelectLoading(true);
      setSelectError(null);
      
      // If the chart already has complete data including chart_code, use it directly
      if (chart.chart_code) {
        console.log("Using existing chart data with chart_code:", chart.chart_code);
        onSelectFlowchart(chart);
        return;
      }
      
      // Otherwise, fetch the complete flowchart data
      console.log(`Fetching complete data for flowchart ID: ${chart.id}`);
      const completeChart = await getFlowchart(chart.id);
      console.log("Fetched complete chart data:", completeChart);
      
      // Ensure chart_code exists in the complete chart data
      if (!completeChart.chart_code) {
        console.error("Fetched chart data does not contain chart_code:", completeChart);
        setSelectError("フローチャートデータにコードが含まれていません");
        return;
      }
      
      // Pass the complete chart data to the parent component
      onSelectFlowchart(completeChart);
    } catch (err) {
      console.error('Error selecting flowchart:', err);
      setSelectError(`フローチャートの選択に失敗しました: ${err.message}`);
    } finally {
      setSelectLoading(false);
    }
  };

  // Filter flowcharts based on search term and location type
  const filteredFlowcharts = flowcharts.filter(chart => {
    const matchesSearch = searchTerm === '' || 
      (chart.title && chart.title.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (chart.location_name && chart.location_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesType = selectedLocationType === '' || 
      chart.location_type === selectedLocationType;
    
    return matchesSearch && matchesType;
  });

  return (
    <Container className="py-4">
      <h2 className="mb-4">保存済みフローチャート</h2>
      
      <Row className="mb-4">
        <Col md={8}>
          <InputGroup>
            <Form.Control
              placeholder="タイトルまたは場所で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </InputGroup>
        </Col>
        <Col md={4}>
          <Form.Select
            value={selectedLocationType}
            onChange={(e) => setSelectedLocationType(e.target.value)}
          >
            <option value="">すべての場所タイプ</option>
            <option value="prefecture">都道府県</option>
            <option value="city">市区町村</option>
          </Form.Select>
        </Col>
      </Row>

      {selectError && (
        <div className="alert alert-danger mb-4">{selectError}</div>
      )}

      <div className="saved-flowcharts-scroll">
        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-2">フローチャートを読み込み中...</p>
          </div>
        ) : error ? (
          <div className="alert alert-danger">{error}</div>
        ) : filteredFlowcharts.length === 0 ? (
          <div className="flowchart-info">
            <p className="mb-0">保存されたフローチャートがありません。</p>
          </div>
        ) : (
          <Row>
            {filteredFlowcharts.map(chart => (
              <Col key={chart.id} md={6} lg={4} className="mb-4">
                <Card 
                  className={`h-100 flowchart-card ${selectLoading ? 'disabled' : ''}`}
                  onClick={() => !selectLoading && handleSelectFlowchart(chart)}
                >
                  <Card.Body>
                    <Card.Title>{chart.title || `${chart.location_name} 防災計画`}</Card.Title>
                    <Card.Subtitle className="mb-2 text-muted">
                      {chart.location_type === 'prefecture' ? '都道府県' : '市区町村'}: {chart.location_name}
                    </Card.Subtitle>
                    <Card.Text>
                      作成日: {new Date(chart.created_at).toLocaleDateString('ja-JP')}
                    </Card.Text>
                  </Card.Body>
                  <Card.Footer className="d-flex justify-content-between align-items-center">
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectFlowchart(chart);
                      }}
                      disabled={selectLoading}
                    >
                      {selectLoading ? '読み込み中...' : '選択'}
                    </Button>
                    <Button 
                      variant="outline-danger" 
                      size="sm"
                      onClick={(e) => handleDeleteClick(chart, e)}
                      disabled={selectLoading}
                    >
                      削除
                    </Button>
                  </Card.Footer>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      <DeleteConfirmModal
        show={showDeleteModal}
        handleClose={() => setShowDeleteModal(false)}
        flowchart={flowchartToDelete}
        onDeleteSuccess={handleDeleteSuccess}
      />
    </Container>
  );
};

export default SavedFlowcharts;