import { describe, expect, it } from 'vitest';
import { expandWeeks, formatWeekPattern, formatWeeks, maskToWeeks, patternToMask, weeksToMask } from '../week.js';

describe('weeks', () => {
  it('展开单周', () => {
    expect(expandWeeks({ from: 1, to: 9, parity: 'odd' })).toEqual([1, 3, 5, 7, 9]);
  });

  it('展开双周并忽略越界周次', () => {
    expect(expandWeeks({ from: 14, to: 20, parity: 'even' })).toEqual([14, 16, 18, 20]);
  });

  it('显式周次优先于区间', () => {
    expect(expandWeeks({ from: 1, to: 16, parity: 'all', explicit: [1, 2, 10] })).toEqual([1, 2, 10]);
  });

  it('掩码与周次可互转', () => {
    const weeks = [1, 4, 16];
    expect(maskToWeeks(weeksToMask(weeks))).toEqual(weeks);
  });

  it('掩码求交能识别单双周不冲突', () => {
    const odd = patternToMask({ from: 1, to: 16, parity: 'odd' });
    const even = patternToMask({ from: 1, to: 16, parity: 'even' });
    expect(odd & even).toBe(0);
  });

  it('周次文本压缩为区间', () => {
    expect(formatWeeks([1, 2, 3, 4, 6, 7])).toBe('1-4,6-7周');
  });

  it('单周文本带标注', () => {
    expect(formatWeekPattern({ from: 1, to: 16, parity: 'odd' })).toBe('1-16周（单周）');
  });
});
