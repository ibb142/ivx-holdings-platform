import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatListData, chatScrollMetrics, scrollChatToLatest } from '../src/modules/chat/chatListLayout';

test('web reads oldest to newest while native retains newest-first data', () => {
  const messages = ['old', 'middle', 'new'];
  assert.deepEqual(chatListData(messages, false), messages);
  assert.deepEqual(chatListData(messages, true), ['new', 'middle', 'old']);
  assert.deepEqual(messages, ['old', 'middle', 'new']);
});

test('web latest and older-page boundaries follow normal browser scrolling', () => {
  assert.equal(chatScrollMetrics(800, 1000, 200, false).distanceFromLatest, 0);
  assert.equal(chatScrollMetrics(0, 1000, 200, false).atOlderEdge, true);
  assert.equal(chatScrollMetrics(800, 1000, 200, false).atOlderEdge, false);
  assert.equal(chatScrollMetrics(-20, 1000, 200, false).atOlderEdge, true);
  assert.equal(chatScrollMetrics(0, 100, 200, false).atOlderEdge, false);
});

test('native scroll boundaries retain inverted semantics', () => {
  assert.equal(chatScrollMetrics(0, 1000, 200, true).distanceFromLatest, 0);
  assert.equal(chatScrollMetrics(800, 1000, 200, true).atOlderEdge, true);
});

test('jump to latest targets the browser end and native offset zero', () => {
  const calls: unknown[] = [];
  const list = {
    scrollToOffset: (o: unknown) => calls.push(['offset', o]),
    scrollToEnd: (o: unknown) => calls.push(['end', o]),
  };
  scrollChatToLatest(list, false, true);
  scrollChatToLatest(list, true, false);
  scrollChatToLatest(null, false, false);
  assert.deepEqual(calls, [['end', { animated: true }], ['offset', { offset: 0, animated: false }]]);
});
