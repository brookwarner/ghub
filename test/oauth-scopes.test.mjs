import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAuthUrlFromCredentials } from '../dist/gmail-client.js';

const sampleCredentials = {
  installed: {
    client_id: 'client-id',
    client_secret: 'client-secret',
    redirect_uris: ['http://localhost'],
  },
};

test('begin auth requests Gmail, Drive, Sheets, Docs, and Calendar scopes', () => {
  const { authUrl } = generateAuthUrlFromCredentials(sampleCredentials);
  const url = new URL(authUrl);
  const scopes = url.searchParams.get('scope') ?? '';

  // Granular Gmail scopes replaced the broad mail.google.com scope in f5b926e.
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/gmail\.compose/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/drive(?:\s|$)/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/documents/);
  assert.match(scopes, /https:\/\/www\.googleapis\.com\/auth\/calendar/);
  assert.notEqual(url.searchParams.get('include_granted_scopes'), 'true');
});
