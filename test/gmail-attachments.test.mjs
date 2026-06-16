import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadAttachmentsFromPayload } from '../dist/gmail-client.js';

// base64url-encode a string the way Gmail returns attachment data.
function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a message payload shaped like users.messages.get(format:'full').
function payload(parts) {
  return { mimeType: 'multipart/mixed', parts };
}

function filePart(id, filename, size = 100) {
  return {
    filename,
    mimeType: 'application/pdf',
    body: { attachmentId: id, size },
  };
}

test('downloads every non-inline attachment using ids from the same payload', async () => {
  const p = payload([
    filePart('live-1', 'a.pdf'),
    filePart('live-2', 'b.pdf'),
  ]);

  const seenIds = [];
  const { downloaded, errors } = await downloadAttachmentsFromPayload(p, async (id) => {
    seenIds.push(id);
    return b64url(`bytes-of-${id}`);
  });

  assert.equal(errors.length, 0);
  assert.deepEqual(seenIds, ['live-1', 'live-2'], 'fetches ids straight from the payload');
  assert.equal(downloaded.length, 2);
  assert.equal(downloaded[0].metadata.filename, 'a.pdf');
  assert.equal(downloaded[0].bytes.toString('utf8'), 'bytes-of-live-1');
});

test('skips inline parts (e.g. embedded images)', async () => {
  const inline = filePart('inline-1', 'logo.png');
  inline.headers = [{ name: 'Content-Disposition', value: 'inline' }];
  const p = payload([inline, filePart('live-1', 'doc.pdf')]);

  const { downloaded } = await downloadAttachmentsFromPayload(p, async (id) =>
    b64url(`bytes-of-${id}`),
  );

  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].metadata.filename, 'doc.pdf');
});

test('records a per-attachment error without aborting the batch', async () => {
  const p = payload([filePart('ok', 'good.pdf'), filePart('bad', 'broken.pdf')]);

  const { downloaded, errors } = await downloadAttachmentsFromPayload(p, async (id) => {
    if (id === 'bad') throw new Error('boom');
    return b64url('ok-bytes');
  });

  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].metadata.filename, 'good.pdf');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].metadata.filename, 'broken.pdf');
  assert.match(errors[0].error, /boom/);
});

// Regression: Gmail mints fresh attachment ids per fetch for some messages.
// Modelling Google as accepting ONLY the ids minted in the current fetch,
// the download must use the payload's own (same-fetch) ids — never a stale id
// carried over from a prior fetch (which is what caused "not found" before).
test('same-fetch ids succeed where cross-fetch (stale) ids would 404', async () => {
  // Google only resolves ids it minted for THIS fetch.
  const currentFetchIds = new Set(['fresh-1', 'fresh-2']);
  const google = async (id) => {
    if (!currentFetchIds.has(id)) throw new Error(`Attachment ${id} not found (stale id).`);
    return b64url(`bytes-of-${id}`);
  };

  // The payload from the same fetch carries the fresh ids -> all succeed.
  const fresh = payload([filePart('fresh-1', 'a.pdf'), filePart('fresh-2', 'b.pdf')]);
  const okRun = await downloadAttachmentsFromPayload(fresh, google);
  assert.equal(okRun.downloaded.length, 2);
  assert.equal(okRun.errors.length, 0);

  // A payload built from a PRIOR fetch (stale ids) is exactly the old bug:
  // every byte fetch 404s. This guards against reintroducing id reuse.
  const stale = payload([filePart('old-1', 'a.pdf'), filePart('old-2', 'b.pdf')]);
  const badRun = await downloadAttachmentsFromPayload(stale, google);
  assert.equal(badRun.downloaded.length, 0);
  assert.equal(badRun.errors.length, 2);
});
