import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRawEmailMessage } from '../dist/gmail-client.js';

// buildRawEmailMessage returns base64url; decode back to the raw RFC 822 message.
async function rawMessage(input) {
  const encoded = await buildRawEmailMessage(input);
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

const base = { to: 'someone@example.com', body: 'hello' };

test('leaves plain ASCII subjects unencoded', async () => {
  const raw = await rawMessage({ ...base, subject: 'Weekly report' });
  assert.match(raw, /^Subject: Weekly report$/m);
});

// Without RFC 2047 encoded-word syntax, UTF-8 bytes in a subject reach the
// client as Mojibake.
test('RFC 2047 encodes non-ASCII subjects', async () => {
  const subject = 'Café — résumé';
  const raw = await rawMessage({ ...base, subject });

  const match = raw.match(/^Subject: (.+)$/m);
  assert.ok(match, 'subject header present');
  assert.match(match[1], /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);

  const payload = match[1].slice('=?UTF-8?B?'.length, -'?='.length);
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), subject);
});

// The multipart branch builds its own header block, so it needs its own guard.
test('encodes the subject on the multipart (with-attachments) path too', async () => {
  const file = path.join(os.tmpdir(), `subject-encoding-${process.pid}.txt`);
  await fs.writeFile(file, 'attachment body');

  try {
    const subject = 'Facturé';
    const raw = await rawMessage({ ...base, subject, attachments: [{ path: file }] });

    assert.match(raw, /^Content-Type: multipart\/mixed/m, 'took the multipart path');

    const match = raw.match(/^Subject: (.+)$/m);
    assert.ok(match, 'subject header present');
    const payload = match[1].slice('=?UTF-8?B?'.length, -'?='.length);
    assert.equal(Buffer.from(payload, 'base64').toString('utf8'), subject);
  } finally {
    await fs.rm(file, { force: true });
  }
});

// A bare CR/LF in a subject would otherwise terminate the header and let the
// caller inject arbitrary headers (e.g. an extra Bcc) into the outgoing message.
test('strips CR/LF so a subject cannot inject extra headers', async () => {
  const raw = await rawMessage({
    ...base,
    subject: 'Hi\r\nBcc: attacker@evil.com',
  });

  assert.doesNotMatch(raw, /^Bcc: attacker@evil\.com$/m, 'no injected Bcc header');
  // \r and \n each become a space, so the folded subject carries both.
  assert.match(raw, /^Subject: Hi\s+Bcc: attacker@evil\.com$/m, 'newline neutralised to spaces');
});
