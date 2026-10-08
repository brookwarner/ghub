import test from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from '../dist/attachments.js';
import { fileURLToPath } from 'node:url';
for (const [ext, mime] of [['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']]) {
  test(`patched ${ext} parser extracts attachment text`, async () => {
    const result = await extractText(fileURLToPath(new URL(`./fixtures/security-parser.${ext}`, import.meta.url)), mime);
    assert.equal(result.extractionError, undefined);
    assert.match(result.text, /Security parser smoke test/);
  });
}
