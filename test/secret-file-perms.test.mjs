import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeSecretFile, mkdirSecret, ensureConfigLayout } from '../dist/config.js';

async function tmpdir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'ghub-perms-'));
}

const mode = async (p) => (await fs.stat(p)).mode & 0o777;

test('writeSecretFile creates token files owner-only', async () => {
  const dir = await tmpdir();
  const f = path.join(dir, 'token.json');
  await writeSecretFile(f, '{"refresh_token":"x"}\n');
  assert.equal(await mode(f), 0o600, 'new secret file must be 0600');
  assert.equal(await fs.readFile(f, 'utf8'), '{"refresh_token":"x"}\n');
});

test('writeSecretFile tightens an ALREADY world-readable file', async () => {
  // The regression this guards: writeFile's `mode` applies only on creation, so
  // rewriting an existing 0644 token.json silently kept it world-readable. Both
  // re-authentication and every silent token refresh take this path.
  const dir = await tmpdir();
  const f = path.join(dir, 'token.json');
  await fs.writeFile(f, 'old', { mode: 0o644 });
  await fs.chmod(f, 0o644);
  assert.equal(await mode(f), 0o644, 'precondition: file starts world-readable');

  await writeSecretFile(f, 'new');
  assert.equal(await mode(f), 0o600, 'rewrite must tighten permissions, not inherit them');
});

test('mkdirSecret creates account directories owner-only', async () => {
  const dir = await tmpdir();
  const d = path.join(dir, 'accounts', 'Personal');
  await mkdirSecret(d);
  assert.equal(await mode(d), 0o700, 'account dir must be 0700');
});

test('mkdirSecret tightens an already-permissive directory', async () => {
  const dir = await tmpdir();
  const d = path.join(dir, 'accounts');
  await fs.mkdir(d, { recursive: true });
  await fs.chmod(d, 0o755);
  await mkdirSecret(d);
  assert.equal(await mode(d), 0o700, 'existing dir must be tightened');
});

test('ensureConfigLayout leaves the accounts dir owner-only', async () => {
  const root = await tmpdir();
  await ensureConfigLayout(root);
  assert.equal(await mode(path.join(root, 'accounts')), 0o700);
});
