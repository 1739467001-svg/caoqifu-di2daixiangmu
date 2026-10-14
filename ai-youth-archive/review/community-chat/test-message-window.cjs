/* Reproduce returning to a chat after more messages than one API page. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.resolve(__dirname, '../../dist/app.js'), 'utf8');
const start = app.indexOf('function reconcileChatMessages(');
const end = app.indexOf('\nasync function refreshChats(', start);
assert.ok(start >= 0 && end > start);
const reconcile = vm.runInNewContext(app.slice(start,end) + '\nreconcileChatMessages');
const range = (first,last) => Array.from({length:last-first+1},(_,i)=>({seq:first+i,body:'test'}));
const seqs = result => Array.from(result.messages,m=>m.seq);

const gap = reconcile(range(1,10),range(26,85),null,26);
assert.deepEqual(seqs(gap),range(26,85).map(m=>m.seq));
assert.equal(gap.olderCursor,26, 'Earlier messages must remain reachable after a long absence');
const restored = [...range(1,25),...gap.messages];
assert.deepEqual(restored.map(m=>m.seq),range(1,85).map(m=>m.seq));

const overlapping = reconcile(range(1,65),range(20,79),null,20);
assert.deepEqual(seqs(overlapping),range(1,79).map(m=>m.seq));
assert.equal(overlapping.olderCursor,null, 'Already loaded history should remain intact');
const loadedHistory = reconcile(range(20,99),range(80,139),20,80);
assert.deepEqual(seqs(loadedHistory),range(20,139).map(m=>m.seq));
assert.equal(loadedHistory.olderCursor,20);
const lateSnapshot = reconcile(range(1,80),range(1,60),null,null);
assert.deepEqual(seqs(lateSnapshot),range(1,80).map(m=>m.seq));
const initial = reconcile([],range(41,100),null,41);
assert.equal(initial.olderCursor,41);
console.log('Message window checks passed: missed-page recovery, pagination, deduplication and late snapshots.');
