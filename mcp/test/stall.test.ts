// The stall check's decision (src/stall.ts), with sockets described by the two counts it reads,
// so the rule is tested without a real socket or wall-clock time. http-limits.test.ts runs the
// check on real connections.

import { describe, expect, it } from 'vitest';
import { stalledSockets, stallStep, type StallRecord, type StallSocket } from '../src/stall.js';

const LIMIT = 15_000;
const CHECK = 5_000;

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
    expect(closesAt(Array.from({ length: 12 }, (_, i) => ({ bytesWritten: 100_000 + i * 50_000, writableLength: 70_000 })))).toBe(-1);
  });

  it('closes a connection whose waiting answer hands nothing on for 15 s', () => {
    expect(closesAt(Array.from({ length: 6 }, () => ({ bytesWritten: 600_000, writableLength: 70_000 })))).toBe(3);
    // Progress restarts the 15 s.
    const stuck = { bytesWritten: 600_000, writableLength: 70_000 };
    const moved = { bytesWritten: 610_000, writableLength: 70_000 };
    expect(closesAt([stuck, stuck, moved, moved, moved, moved])).toBe(5);
  });

  // An answer smaller than the socket's high-water mark (64 KiB) waits in its buffer below the
  // mark once the operating system's buffers are full, so Node never sets writableNeedDrain.
  it('closes a connection whose waiting answer is smaller than the high-water mark, however few bytes wait', () => {
    expect(closesAt(Array.from({ length: 6 }, () => ({ bytesWritten: 600_000, writableLength: 22_987 })))).toBe(3);
    expect(closesAt(Array.from({ length: 6 }, () => ({ bytesWritten: 600_000, writableLength: 170 })))).toBe(3);
  });

  it('forgets a connection once nothing waits in its buffer', () => {
    const stuck = { bytesWritten: 600_000, writableLength: 10_000 };
    const drained = { bytesWritten: 600_000, writableLength: 0 };
    expect(closesAt([stuck, stuck, drained, stuck, stuck, stuck])).toBe(-1);
    expect(closesAt(Array.from({ length: 6 }, () => drained))).toBe(-1);
  });
});

describe('stalledSockets', () => {
  // Only the response being written has a socket of its own; those behind it on the same
  // connection get it later. The one being written may hold no slot at all (a 404 or a refusal),
  // so the check reaches each connection through its requests.
  it('checks the connection of every request in flight, also while the answer being written holds no slot', () => {
    const stuck = { bytesWritten: 600_000, writableLength: 170 };
    const reading = { bytesWritten: 600_000, writableLength: 30_000 };
    const records = new WeakMap<StallSocket, StallRecord>();
    const responses = [stuck, stuck, reading, stuck].map((socket) => ({ socket: null, req: { socket } }));
    for (const now of [0, 5_000, 10_000]) {
      expect(stalledSockets(responses, records, now, LIMIT)).toEqual([]);
      reading.bytesWritten += 20_000;
    }
    // Each connection once, however many of its requests are in flight.
    expect(stalledSockets(responses, records, 15_000, LIMIT)).toEqual([stuck]);
  });
});
