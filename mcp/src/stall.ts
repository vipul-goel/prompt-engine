// The --http server's stall check (see STALL_LIMIT_MS in cli.ts): which connections to close
// because the answer being written has waited for the client too long. Pure, and reads only the
// counts below, so test/stall.test.ts can check the rule without a real socket or clock.

/** What the check reads of a connection's socket; Node's net.Socket has all three. */
export interface StallSocket {
  readonly bytesWritten: number;
  readonly writableLength: number;
  readonly writableNeedDrain: boolean;
}

/** What the check remembers about a connection from one check to the next. */
export interface StallRecord {
  /** How many bytes the socket had handed on to the operating system. */
  handedOn: number;
  /** When that count was first seen. */
  since: number;
}

/**
 * One check of one connection: the record to keep (undefined to forget the connection) and
 * whether to close it. It counts the bytes the socket has handed on, not the length of its buffer,
 * which the next write can refill to the same length while the client reads.
 */
export function stallStep(
  seen: StallRecord | undefined,
  socket: StallSocket,
  now: number,
  limitMs: number,
): { record: StallRecord | undefined; close: boolean } {
  if (!socket.writableNeedDrain) return { record: undefined, close: false };
  // What the socket has been given, less what still waits in it.
  const handedOn = socket.bytesWritten - socket.writableLength;
  if (seen?.handedOn !== handedOn) return { record: { handedOn, since: now }, close: false };
  return { record: seen, close: now - seen.since >= limitMs };
}

/**
 * Runs stallStep on the connection of each response being written (a response waiting behind
 * another on the same connection has no socket yet), updates `records`, and returns the
 * connections to close.
 */
export function stalledSockets<S extends StallSocket & object>(
  responses: Iterable<{ socket: S | null }>,
  records: WeakMap<S, StallRecord>,
  now: number,
  limitMs: number,
): S[] {
  const stalled: S[] = [];
  for (const { socket } of responses) {
    if (!socket) continue;
    const { record, close } = stallStep(records.get(socket), socket, now, limitMs);
    if (record) records.set(socket, record);
    else records.delete(socket);
    if (close) stalled.push(socket);
  }
  return stalled;
}
