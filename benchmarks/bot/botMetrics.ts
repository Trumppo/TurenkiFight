import { nearestRank } from '../local/statistics';

/**
 * Client-side measurement for the headless bot.
 *
 * Everything here is observed on this bot's own socket: pong round trips,
 * snapshot arrival times and UTF-8 frame sizes. It never estimates, smooths or
 * fills in a missing sample; an empty sample set becomes `NOT_MEASURED` with a
 * reason instead of a fabricated zero.
 *
 * Averages and percentiles are nearest-rank over actually observed samples.
 * Byte rates are the counted bytes divided by the measured wall-clock window,
 * in the same process, with a monotonic timer.
 */

export const MEASURED = 'MEASURED' as const;
export const NOT_MEASURED = 'NOT_MEASURED' as const;

export type BotDistribution = {
  readonly status: typeof MEASURED;
  readonly unit: 'milliseconds';
  readonly sampleCount: number;
  readonly min: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
};

export type BotSnapshotInterArrival = BotDistribution & {
  /** The largest observed gap; identical to `max` but named for the schema. */
  readonly maxGapMs: number;
};

export type BotNotMeasured = {
  readonly status: typeof NOT_MEASURED;
  readonly reason: string;
};

export type BotPerSecondSample = {
  /** 0-based elapsed second within the measured window. */
  readonly second: number;
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly sentMessages: number;
  readonly receivedMessages: number;
  readonly snapshots: number;
  readonly pongs: number;
  readonly inputsSubmitted: number;
};

export type BotBandwidth = {
  readonly status: typeof MEASURED;
  /** Monotonic wall-clock window: socket open to completion. */
  readonly windowMs: number;
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly sentBytesPerSecond: number;
  readonly receivedBytesPerSecond: number;
  readonly sentMessages: number;
  readonly receivedMessages: number;
  readonly perSecond: BotPerSecondSample[];
};

export type BotInputCounts = {
  readonly submitted: number;
  /** `submitted - denied`: the server does not acknowledge accepted input. */
  readonly accepted: number;
  readonly acceptedBasis: 'submitted-minus-observed-denials';
  readonly lateTicks: number;
  readonly denied: number;
  readonly denials: Record<string, number>;
};

export type BotDisconnects = {
  readonly observed: number;
  readonly sessionClosedReasons: string[];
  readonly transportClosed: boolean;
  readonly transportErrors: number;
};

export type BotMetricsSnapshot = {
  readonly rtt: BotDistribution | BotNotMeasured;
  readonly snapshotInterArrival: BotSnapshotInterArrival | BotNotMeasured;
  readonly bandwidth: BotBandwidth | BotNotMeasured;
  readonly inputs: BotInputCounts;
  readonly disconnects: BotDisconnects;
};

export type BotClock = () => number;

/**
 * Monotonic millisecond clock. `process.hrtime.bigint()` is unaffected by wall
 * clock changes, so a measured window cannot become negative or jump.
 */
export function monotonicClock(): BotClock {
  const origin = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - origin) / 1e6;
}

function summarize(samples: readonly number[]): BotDistribution {
  const values = [...samples].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    status: MEASURED,
    unit: 'milliseconds',
    sampleCount: values.length,
    min: values[0],
    mean: total / values.length,
    p50: nearestRank(values, 50),
    p95: nearestRank(values, 95),
    p99: nearestRank(values, 99),
    max: values[values.length - 1],
  };
}

function notMeasured(reason: string): BotNotMeasured {
  return { status: NOT_MEASURED, reason };
}

type Bucket = {
  sentBytes: number;
  receivedBytes: number;
  sentMessages: number;
  receivedMessages: number;
  snapshots: number;
  pongs: number;
  inputsSubmitted: number;
};

const emptyBucket = (): Bucket => ({
  sentBytes: 0,
  receivedBytes: 0,
  sentMessages: 0,
  receivedMessages: 0,
  snapshots: 0,
  pongs: 0,
  inputsSubmitted: 0,
});

export class BotMetrics {
  private readonly clock: BotClock;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private readonly buckets = new Map<number, Bucket>();
  private readonly rttSamples: number[] = [];
  private readonly pendingPings = new Map<number, number>();
  private readonly interArrival: number[] = [];
  private readonly denials = new Map<string, number>();
  private readonly sessionClosedReasons: string[] = [];
  private sentBytes = 0;
  private receivedBytes = 0;
  private sentMessages = 0;
  private receivedMessages = 0;
  private submittedInputs = 0;
  private lateTicks = 0;
  private pongs = 0;
  private snapshots = 0;
  private transportClosed = false;
  private transportErrors = 0;
  private lastSnapshotTime: number | null = null;

  constructor(clock: BotClock = monotonicClock()) {
    if (typeof clock !== 'function') throw new Error('Bot metrics require a clock');
    this.clock = clock;
  }

  /** Starts the measured window; idempotent so an early note cannot reset it. */
  start(at: number = this.clock()): void {
    if (this.startedAt !== null) return;
    if (!Number.isFinite(at)) throw new Error('Invalid metric start time');
    this.startedAt = at;
  }

  elapsed(): number {
    return (this.finishedAt ?? this.clock()) - (this.startedAt ?? this.clock());
  }

  private bucket(): Bucket {
    const elapsed = this.elapsed();
    const second = Math.max(0, Math.floor(elapsed / 1000));
    let bucket = this.buckets.get(second);
    if (!bucket) {
      bucket = emptyBucket();
      this.buckets.set(second, bucket);
    }
    return bucket;
  }

  noteOutbound(bytes: number): void {
    if (this.finishedAt !== null) return;
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Invalid outbound byte count');
    this.start();
    this.sentBytes += bytes;
    this.sentMessages += 1;
    this.bucket().sentBytes += bytes;
    this.bucket().sentMessages += 1;
  }

  noteInbound(bytes: number): void {
    if (this.finishedAt !== null) return;
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Invalid inbound byte count');
    this.start();
    this.receivedBytes += bytes;
    this.receivedMessages += 1;
    this.bucket().receivedBytes += bytes;
    this.bucket().receivedMessages += 1;
  }

  notePing(sequence: number, at: number = this.clock()): void {
    if (this.finishedAt !== null) return;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid ping sequence');
    this.start();
    if (this.pendingPings.has(sequence)) throw new Error('Duplicate ping sequence');
    this.pendingPings.set(sequence, at);
  }

  notePong(sequence: number, at: number = this.clock()): void {
    if (this.finishedAt !== null) return;
    const sentAt = this.pendingPings.get(sequence);
    if (sentAt === undefined) return; // Unmatched pong: ignored, never guessed.
    this.pendingPings.delete(sequence);
    const sample = at - sentAt;
    if (!Number.isFinite(sample) || sample < 0) return;
    this.rttSamples.push(sample);
    this.pongs += 1;
    this.bucket().pongs += 1;
  }

  noteSnapshot(at: number = this.clock()): void {
    if (this.finishedAt !== null) return;
    this.start();
    this.snapshots += 1;
    this.bucket().snapshots += 1;
    if (this.lastSnapshotTime !== null) this.interArrival.push(at - this.lastSnapshotTime);
    this.lastSnapshotTime = at;
  }

  noteInputSubmitted(): void {
    if (this.finishedAt !== null) return;
    this.start();
    this.submittedInputs += 1;
    this.bucket().inputsSubmitted += 1;
  }

  noteDenial(code: string): void {
    if (this.finishedAt !== null) return;
    if (typeof code !== 'string' || code.length === 0) throw new Error('Invalid denial code');
    this.start();
    this.denials.set(code, (this.denials.get(code) ?? 0) + 1);
    if (code === 'late-tick') this.lateTicks += 1;
  }

  noteSessionClosed(reason: string): void {
    if (this.finishedAt !== null) return;
    this.start();
    this.sessionClosedReasons.push(reason);
  }

  noteTransportClosed(): void {
    if (this.finishedAt !== null) return;
    this.start();
    this.transportClosed = true;
  }

  noteTransportError(): void {
    if (this.finishedAt !== null) return;
    this.start();
    this.transportErrors += 1;
  }

  /** Number of scheduled fixture ticks that were not in a submitted envelope. */
  finish(at: number = this.clock()): void {
    this.start();
    if (this.finishedAt !== null) return;
    if (!Number.isFinite(at)) throw new Error('Invalid metric finish time');
    this.finishedAt = at;
  }

  get snapshotCount(): number { return this.snapshots; }
  get submittedCount(): number { return this.submittedInputs; }

  build(): BotMetricsSnapshot {
    if (this.startedAt === null || this.finishedAt === null) {
      throw new Error('Metrics must be finished before they can be summarized');
    }
    const denied = [...this.denials.values()].reduce((sum, count) => sum + count, 0);
    if (denied > this.submittedInputs) {
      throw new Error('Observed denials exceed submitted inputs; the run is not measurable');
    }
    const windowMs = this.finishedAt - this.startedAt;
    const perSecond = this.buildPerSecond(windowMs);

    return {
      rtt: this.rttSamples.length > 0
        ? summarize(this.rttSamples)
        : notMeasured('no ping/pong round trip completed within the measured window'),
      snapshotInterArrival: this.interArrival.length > 0
        ? { ...summarize(this.interArrival), maxGapMs: Math.max(...this.interArrival) }
        : notMeasured('fewer than two snapshots arrived within the measured window'),
      bandwidth: windowMs > 0
        ? {
            status: MEASURED,
            windowMs,
            sentBytes: this.sentBytes,
            receivedBytes: this.receivedBytes,
            sentBytesPerSecond: (this.sentBytes * 1000) / windowMs,
            receivedBytesPerSecond: (this.receivedBytes * 1000) / windowMs,
            sentMessages: this.sentMessages,
            receivedMessages: this.receivedMessages,
            perSecond,
          }
        : notMeasured('the measured window had zero duration'),
      inputs: {
        submitted: this.submittedInputs,
        accepted: this.submittedInputs - denied,
        acceptedBasis: 'submitted-minus-observed-denials',
        lateTicks: this.lateTicks,
        denied,
        denials: Object.fromEntries(
          [...this.denials.entries()].sort(([left], [right]) => left.localeCompare(right)),
        ),
      },
      disconnects: {
        observed: this.sessionClosedReasons.length + (this.transportClosed ? 1 : 0),
        sessionClosedReasons: [...this.sessionClosedReasons],
        transportClosed: this.transportClosed,
        transportErrors: this.transportErrors,
      },
    };
  }

  private buildPerSecond(windowMs: number): BotPerSecondSample[] {
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    const samples: BotPerSecondSample[] = [];
    for (let second = 0; second < seconds; second++) {
      const bucket = this.buckets.get(second) ?? emptyBucket();
      samples.push({ second, ...bucket });
    }
    // Every counted frame must belong to exactly one published bucket.
    if (samples.reduce((sum, sample) => sum + sample.sentBytes, 0) !== this.sentBytes ||
        samples.reduce((sum, sample) => sum + sample.receivedBytes, 0) !== this.receivedBytes) {
      throw new Error('Per-second byte buckets do not match the measured totals');
    }
    return samples;
  }
}
