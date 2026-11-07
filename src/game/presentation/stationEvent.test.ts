import { describe, expect, it } from 'vitest';
import {
  STATION_EVENT_PASS_TICKS,
  STATION_EVENT_PERIOD_TICKS,
  STATION_EVENT_WARNING_TICKS,
  stationEventAtTick,
} from './stationEvent';

describe('tick-derived station event presentation schedule', () => {
  it('has a 60-second period, five-second warning and three-second pass', () => {
    expect(STATION_EVENT_PERIOD_TICKS).toBe(3600);
    expect(STATION_EVENT_WARNING_TICKS).toBe(300);
    expect(STATION_EVENT_PASS_TICKS).toBe(180);
    expect(stationEventAtTick(0)).toBeNull();
    expect(stationEventAtTick(3299)).toBeNull();
    expect(stationEventAtTick(3300)).toEqual({ phase: 'warning', cycle: 1, phaseTick: 0 });
    expect(stationEventAtTick(3599)).toEqual({ phase: 'warning', cycle: 1, phaseTick: 299 });
    expect(stationEventAtTick(3600)).toEqual({ phase: 'passing', cycle: 1, phaseTick: 300 });
    expect(stationEventAtTick(3779)).toEqual({ phase: 'passing', cycle: 1, phaseTick: 479 });
    expect(stationEventAtTick(3780)).toBeNull();
    expect(stationEventAtTick(6900)).toEqual({ phase: 'warning', cycle: 2, phaseTick: 0 });
    expect(stationEventAtTick(7200)).toEqual({ phase: 'passing', cycle: 2, phaseTick: 300 });
  });

  it('rejects negative, fractional and unsafe ticks', () => {
    expect(stationEventAtTick(-1)).toBeNull();
    expect(stationEventAtTick(3300.5)).toBeNull();
    expect(stationEventAtTick(Number.NaN)).toBeNull();
    expect(stationEventAtTick(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});
