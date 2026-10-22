'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, filterProfanity, RateLimiter } = require('../server/chat');
const { parseMessage } = require('../server/rooms');

test('chat text validation', () => {
  assert.equal(cleanText('  hello   world '), 'hello world');
  assert.equal(cleanText(''), null);
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText('x'.repeat(301)), null);
  assert.equal(cleanText('x'.repeat(300)).length, 300);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText('a\u202eb\u0000c'), 'a b c');
  // HTML is kept as literal text (the client renders with textContent, never innerHTML)
  assert.equal(cleanText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});

test('profanity filter', () => {
  assert.equal(filterProfanity('what the fuck'), 'what the f***');
  assert.equal(filterProfanity('Shitty tiles'), 'S***** tiles');
  assert.equal(filterProfanity('class assessment scunthorpe'), 'class assessment scunthorpe');
});

test('rate limiter: 5 per 5s', () => {
  const r = new RateLimiter(5, 5000);
  for (let i = 0; i < 5; i++) assert.ok(r.allow(1000 + i));
  assert.equal(r.allow(1010), false);
  assert.ok(r.allow(6001));
});

test('websocket payload validation', () => {
  assert.equal(parseMessage('not json'), null);
  assert.equal(parseMessage('[]'), null);
  assert.equal(parseMessage('{"t":"hack"}'), null);
  assert.equal(parseMessage('{"t":"chat","text":5}'), null);
  assert.equal(parseMessage('{"t":"chat","text":"hi","__proto__":{"x":1}}'), null);
  assert.equal(parseMessage('{"t":"act","a":"discard","tile":99}'), null);
  assert.equal(parseMessage('{"t":"act","a":"discard","tile":1.5}'), null);
  assert.equal(parseMessage('{"t":"rejoin","code":"ABCDEF","token":"short"}'), null);
  assert.equal(parseMessage('{"t":"settings","minFaan":5}'), null);
  assert.equal(parseMessage('{"t":"mute","seat":7,"muted":true}'), null);
  assert.ok(parseMessage('{"t":"act","a":"claim","claim":"chow","chow":3}'));
  assert.ok(parseMessage('{"t":"chat","text":"hello"}'));
  assert.equal(parseMessage('x'.repeat(5000)), null);
});
