import { describe, expect, it } from 'vitest';
import { KKAUPPA_EVENT_PERIOD_TICKS, KKAUPPA_TELEGRAPH_TICKS, kkauppaTelegraphActive } from './arenaTelegraph';

describe('K-kauppa presentation-only telegraph timing', () => {
  it('rattles only during the final three seconds of each 45-second cycle', () => {
    expect(KKAUPPA_EVENT_PERIOD_TICKS).toBe(2700);
    expect(KKAUPPA_TELEGRAPH_TICKS).toBe(180);
    expect(kkauppaTelegraphActive(0)).toBe(false);
    expect(kkauppaTelegraphActive(2519)).toBe(false);
    expect(kkauppaTelegraphActive(2520)).toBe(true);
    expect(kkauppaTelegraphActive(2699)).toBe(true);
    expect(kkauppaTelegraphActive(2700)).toBe(false);
    expect(kkauppaTelegraphActive(5220)).toBe(true);
    expect(kkauppaTelegraphActive(-1)).toBe(false);
    expect(kkauppaTelegraphActive(Number.NaN)).toBe(false);
  });
});
