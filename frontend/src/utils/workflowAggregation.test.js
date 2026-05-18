import { describe, expect, it } from 'vitest';
import {
  buildWorkflowOverview,
  laneInfoForTask,
  normalizeWorkflowData,
} from './workflowAggregation.js';

const graphData = {
  schema_version: '2.0',
  tasks: [
    {
      id: 't001',
      name: '災害対策本部を設置する',
      phase: 'initial_response',
      workstream: 'command',
      department: '奈良県 防災統括室',
    },
    {
      id: 't002',
      name: '避難所を開設する',
      phase: 'emergency_response',
      workstream: 'evacuation',
      department: '県庁 防災統括室',
    },
    {
      id: 't003',
      name: '物資を配送する',
      phase: 'emergency_response',
      workstream: 'logistics',
      department: '奈良市 防災課',
    },
  ],
  dependencies: [
    {
      from: 't001',
      to: 't002',
      reason: '本部設置後に避難所開設を判断する',
      dependency_type: 'decision',
    },
    {
      from: 't001',
      to: 't003',
      reason: '本部で物資配送を調整する',
      dependency_type: 'resource_flow',
    },
  ],
};

describe('workflowAggregation', () => {
  it('aggregates detail tasks into phase x workstream overview nodes and edge rollups', () => {
    const overview = buildWorkflowOverview(graphData);

    expect(overview.overviewNodes.map((node) => node.key)).toEqual([
      'initial_response:command',
      'emergency_response:evacuation',
      'emergency_response:logistics',
    ]);
    expect(overview.overviewEdges).toHaveLength(2);
    expect(overview.overviewEdges[0].dependencies).toHaveLength(1);
    expect(overview.overviewEdges.map((edge) => edge.dependencies[0].dep.dependency_type)).toEqual([
      'decision',
      'resource_flow',
    ]);
  });

  it('normalizes prefecture and municipality lanes for detail views', () => {
    const workflow = normalizeWorkflowData(graphData);
    const lanes = workflow.tasks.map((task) => laneInfoForTask(task, graphData));

    expect(lanes[0].org).toBe('県');
    expect(lanes[1].org).toBe('県');
    expect(lanes[2].org).toBe('市町村');
    expect(lanes.map((lane) => lane.orgOrder)).toEqual([10, 10, 20]);
  });

  it('keeps v1 JSON displayable by inferring phase and workstream', () => {
    const overview = buildWorkflowOverview({
      tasks: [
        {
          id: 't001',
          name: '避難所開設',
          department: '市町村 防災課',
          description: '避難所を開設し避難者を受け入れる',
        },
      ],
      dependencies: [],
    });

    expect(overview.overviewNodes[0].key).toBe('emergency_response:evacuation');
    expect(overview.overviewNodes[0].tasks).toHaveLength(1);
  });
});
