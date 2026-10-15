import { describe, expect, it } from 'vitest';
import { cellChipBudget } from './monthCellLayout';

/**
 * DP-165. Row heights are the ones the month grid computes: 114px at 390×844,
 * 73px at 360×640, and 95px／61px for the same phones in the fixed six-row grid.
 * Whether those chips really fit is checked in a browser by
 * `e2e/month-cell-fit.spec.ts`.
 */
describe('cellChipBudget', () => {
  it('keeps the原檔 three chips and +1 where the row is tall enough', () => {
    expect(cellChipBudget(114, 4, null)).toEqual({ shown: 3, hidden: 1 });
    expect(cellChipBudget(114, 2, null)).toEqual({ shown: 2, hidden: 0 });
    expect(cellChipBudget(95, 5, null)).toEqual({ shown: 3, hidden: 2 });
  });

  it('draws fewer whole chips in a short row instead of squeezing three', () => {
    // Three alone still fit at 73px; three and a +1 line do not.
    expect(cellChipBudget(73, 3, null)).toEqual({ shown: 3, hidden: 0 });
    expect(cellChipBudget(73, 4, null)).toEqual({ shown: 2, hidden: 2 });
    expect(cellChipBudget(61, 2, null)).toEqual({ shown: 2, hidden: 0 });
    expect(cellChipBudget(61, 4, null)).toEqual({ shown: 1, hidden: 3 });
  });

  it('leaves one line for the stickers pinned to the bottom', () => {
    expect(cellChipBudget(95, 3, 19)).toEqual({ shown: 3, hidden: 0 });
    expect(cellChipBudget(95, 4, 19)).toEqual({ shown: 2, hidden: 2 });
  });

  it('keeps the count when not even one chip fits', () => {
    expect(cellChipBudget(58, 1, 19)).toEqual({ shown: 0, hidden: 1 });
    expect(cellChipBudget(58, 0, 19)).toEqual({ shown: 0, hidden: 0 });
  });
});
