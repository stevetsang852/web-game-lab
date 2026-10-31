import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startStaticServer } from './static-server.mjs';

/**
 * @param {number} port
 * @param {string} urlPath
 */
function rawGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const API_TOKEN = 'test-api-token';
const KEY_ID = 'test-key-id';

test('static server serves the demo and GET /turn without leaking env', async () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'chat-demo-'));
  const root = path.join(parent, 'public');
  mkdirSync(root);
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>demo</title>', 'utf8');
  writeFileSync(path.join(parent, 'secret.txt'), 'do-not-serve-via-traversal', 'utf8');

  const started = await startStaticServer({
    host: '127.0.0.1',
    port: 0,
    staticRoot: root,
    env: {
      TURN_PROVIDER: 'cloudflare',
      CF_TURN_KEY_ID: KEY_ID,
      CF_TURN_KEY_API_TOKEN: API_TOKEN,
    },
    fetchImpl: async () => Response.json({
      iceServers: [{
        urls: ['turn:turn.example.test:3478?transport=udp', 'turn:turn.example.test:53?transport=udp'],
        username: 'short-user',
        credential: 'short-credential',
      }],
    }, { status: 201 }),
  });

  try {
    const origin = `http://127.0.0.1:${started.port}`;
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /demo/);

    const turn = await fetch(`${origin}/turn`);
    assert.equal(turn.status, 200);
    assert.equal(turn.headers.get('cache-control'), 'no-store');
    const body = await turn.json();
    const urls = body.iceServers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
    assert.ok(urls.includes('turn:turn.example.test:3478?transport=udp'));
    assert.equal(urls.some((url) => url.includes(':53')), false);
    assert.equal(JSON.stringify(body).includes(API_TOKEN), false);

    const traversal = await rawGet(started.port, '/%2e%2e%2fsecret.txt');
    assert.equal(traversal.status, 404);
    assert.equal(traversal.body.includes('do-not-serve-via-traversal'), false);
    const encodedSlash = await rawGet(started.port, '/..%2fsecret.txt');
    assert.equal(encodedSlash.status, 404);
    assert.equal(encodedSlash.body.includes('do-not-serve-via-traversal'), false);
  } finally {
    await started.close();
  }
});

test('unconfigured /turn is JSON and does not echo the key id', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'chat-demo-'));
  writeFileSync(path.join(root, 'index.html'), 'ok', 'utf8');
  const started = await startStaticServer({
    host: '127.0.0.1',
    port: 0,
    staticRoot: root,
    env: { CF_TURN_KEY_ID: KEY_ID },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/turn`);
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.equal(text.includes(KEY_ID), false);
    assert.match(text, /not configured/);
  } finally {
    await started.close();
  }
});
