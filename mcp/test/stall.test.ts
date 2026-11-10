// The stall check's decision (src/stall.ts), with sockets described by the two counts it reads,
// so the rule is tested without a real socket or wall-clock time. http-limits.test.ts runs the
// check on real connections.

import { describe, expect, it } from 'vitest';
import { stalledSockets, stallStep, type StallRecord, type StallSocket } from '../src/stall.js';

const LIMIT = 15_000;
const CHECK = 5_000;

type State = Omit<StallSocket, 'writableNeedDrain'>;
/** Above the socket's high-water mark, so Node sets writableNeedDrain. */
const waiting = (state: State): StallSocket => ({ ...state, writableNeedDrain: true });

/** Runs stallStep every 5 s over these socket states; returns the index of the check that closes, or -1. */
function closesAt(states: StallSocket[]): number {
  let seen: StallRecord | undefined;
  for (const [i, state] of states.entries()) {
    const step = stallStep(seen, state, i * CHECK, LIMIT);
    if (step.close) return i;
    seen = step.record;
  }
  return -1;
}

describe('stallStep', () => {
  // As the client reads, the operating system takes the bytes in bursts, and the next write
  // refills the socket's buffer, often to the same length. Comparing that length closed a client
  // reading a 2.2 MB answer at 50 KB/s after about 35 s; the bytes handed on still grow.
  it('never closes a connection that hands bytes on, even when its buffer is the same length at every check', () => {
    expect(closesAt(Array.from({ length: 12 }, (_, i) => waiting({ bytesWritten: 100_000 + i * 50_000, writableLength: 70_000 })))).toBe(-1);
  });

  it('closes a connection whose waiting answer hands nothing on for 15 s', () => {
    expect(closesAt(Array.from({ length: 6 }, () => waiting({ bytesWritten: 600_000, writableLength: 70_000 })))).toBe(3);
    // Progress restarts the 15 s.
    const stuck = waiting({ bytesWritten: 600_000, writableLength: 70_000 });
    const moved = waiting({ bytesWritten: 610_000, writableLength: 70_000 });
    expect(closesAt([stuck, stuck, moved, moved, moved, moved])).toBe(5);
  });

  it('forgets a connection once nothing waits in its buffer', () => {
    const stuck = waiting({ bytesWritten: 600_000, writableLength: 70_000 });
    const drained: StallSocket = { bytesWritten: 600_000, writableLength: 0, writableNeedDrain: false };
    expect(closesAt([stuck, stuck, drained, stuck, stuck, stuck])).toBe(-1);
  });
});

describe('stalledSockets', () => {
  const socket = (bytesWritten: number, writableLength: number) => waiting({ bytesWritten, writableLength });

  it('checks the connection of each response being written, and keeps its record from one check to the next', () => {
    const stuck = socket(600_000, 70_000);
    const reading = socket(600_000, 70_000);
    const records = new WeakMap<StallSocket, StallRecord>();
    const responses = [{ socket: stuck }, { socket: null }, { socket: reading }];
    for (const now of [0, 5_000, 10_000]) {
      expect(stalledSockets(responses, records, now, LIMIT)).toEqual([]);
      (reading as { bytesWritten: number }).bytesWritten += 20_000;
    }
    expect(stalledSockets(responses, records, 15_000, LIMIT)).toEqual([stuck]);
  });
});
