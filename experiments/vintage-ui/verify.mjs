import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
window.document.write(html);
await window.happyDOM.whenAsyncComplete();
const $ = selector => window.document.querySelector(selector);
for (const concept of ['platinum', 'workbench', 'navigator']) {
  $(`[data-concept="${concept}"]`).click();
  assert.equal($('.browser').className, `browser ${concept}`);
  assert.equal($(`[data-concept="${concept}"]`).getAttribute('aria-pressed'), 'true');
}
$('[data-story]').click();
assert.equal($('#page-title').textContent, 'A walk along the coast');
assert.equal($('#back').disabled, false);
$('#back').click();
assert.equal($('#page-title').textContent, 'A small window on the web.');
$('#forward').click();
assert.equal($('#page-title').textContent, 'A walk along the coast');
$('#settings-toggle').click();
assert.equal($('#settings').hidden, false);
$('#style').value = 'Custom';
$('#style').dispatchEvent(new window.Event('change'));
assert.equal($('#custom-style').hidden, false);
$('[data-billing="API credits"]').click();
assert.equal($('#billing-status').textContent, 'API credits');
assert.match($('#status').textContent, /billed separately/);
$('#url').value = 'preview://example';
$('.address').dispatchEvent(new window.Event('submit', { cancelable: true }));
assert.equal($('#url').value, 'preview://example');
assert.equal(window.document.querySelectorAll('script[src],link[href],img[src],iframe').length, 0);
await window.happyDOM.close();
console.log('Offline preview checks passed: concepts, history, settings, style, billing, address, self-contained assets.');
