// Preloaded (node --import) into a server under test, for http-limits.test.ts:
// - On any Node version, it does what Node 22 does with a response that waits behind another
//   when its connection closes: the response never gets 'close' (nodejs/node#62534). Node 24.16
//   and later 24.x, and 26.1 and later, destroy such a response, which emits 'close'. Here
//   destroy() does what Node 22's does for a response without a socket: it marks the response
//   destroyed and waits for a socket, which a closed connection never gives it.
// - It writes "[test] unended answers: N" to stderr whenever N changes: how many answers have
//   their head written and haven't ended. Every answer the server sends is begun with writeHead.
import { OutgoingMessage, ServerResponse } from 'node:http';

const destroy = OutgoingMessage.prototype.destroy;
OutgoingMessage.prototype.destroy = function (error) {
  if (this.socket || this.destroyed) return destroy.call(this, error);
  this.destroyed = true;
  this.once('socket', (socket) => socket.destroy(error));
  return this;
};

const unended = new Set();
const report = () => process.stderr.write(`[test] unended answers: ${unended.size}\n`);
const { writeHead, end } = ServerResponse.prototype;
ServerResponse.prototype.writeHead = function (...args) {
  if (!unended.has(this)) {
    unended.add(this);
    report();
  }
  return writeHead.apply(this, args);
};
ServerResponse.prototype.end = function (...args) {
  if (unended.delete(this)) report();
  return end.apply(this, args);
};
