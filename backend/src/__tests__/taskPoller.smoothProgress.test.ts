import { smoothProgress } from '../services/taskPoller';

describe('taskPoller smoothProgress preservation', () => {
  it('creeps by at most 2 points per poll when the target does not advance', () => {
    const taskId = `task-creep-${Date.now()}`;

    let settled = smoothProgress(taskId, 17);
    while (settled < 17) {
      settled = smoothProgress(taskId, 17);
    }
    const second = smoothProgress(taskId, 17);
    const third = smoothProgress(taskId, 17);

    expect(settled).toBe(17);
    expect(second - settled).toBeLessThanOrEqual(2);
    expect(third - second).toBeLessThanOrEqual(2);
    expect(third).toBeLessThanOrEqual(95);
  });

  it('stays monotonic and capped at 95 when targets keep increasing', () => {
    const taskId = `task-ramp-${Date.now()}`;
    const targets = [17, 34, 51, 68, 85, 100];
    const outputs = targets.map((target) => smoothProgress(taskId, target));

    for (let index = 1; index < outputs.length; index += 1) {
      expect(outputs[index]).toBeGreaterThanOrEqual(outputs[index - 1]);
      expect(outputs[index]).toBeLessThanOrEqual(95);
    }

  });
});
