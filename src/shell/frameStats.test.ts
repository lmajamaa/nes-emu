import { expect, test } from 'bun:test';
import { FrameStats } from './frameStats';

test('frame stats cover the last second', () => {
    const stats = new FrameStats();
    expect([stats.framesPerSecond, stats.averageMs, stats.slowestMs]).toEqual([0, 0, 0]);
    stats.record(0, 9);
    for (let at = 500; at < 1500; at += 20) stats.record(at, 4);
    // The frame at 0 is more than a second before the last one
    expect(stats.framesPerSecond).toBe(50);
    expect(stats.averageMs).toBe(4);
    expect(stats.slowestMs).toBe(4);
    stats.record(1500, 12);
    expect(stats.slowestMs).toBe(12);
    stats.clear();
    expect(stats.framesPerSecond).toBe(0);
});
