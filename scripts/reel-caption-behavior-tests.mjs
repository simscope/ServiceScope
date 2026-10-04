import assert from 'node:assert/strict';
import { newCaptionReview, captionReview } from '../src/features/meta-publishing/reelCaptionReview.js';
export function checkCaptionBehavior() {
  let s = newCaptionReview('company/job/render');
  assert.equal(s.captionDraft, ''); assert.equal(s.confirmed, false);
  s = captionReview(s, { type: 'sync', scope: s.scope, initialCaption: 'Facebook caption only' });
  assert.equal(s.captionDraft, 'Facebook caption only'); assert.equal(s.confirmed, false);
  s = captionReview(s, { type: 'open' });
  assert.equal(s.reviewedCaption, 'Facebook caption only');
  s = captionReview(s, { type: 'confirm', value: true });
  s = captionReview(s, { type: 'sync', scope: s.scope, initialCaption: 'Late caption must not replace viewed text' });
  assert.equal(s.reviewedCaption, 'Facebook caption only');
  s = captionReview(s, { type: 'edit', value: 'Manual edit' });
  assert.equal(s.confirmed, false);
  s = captionReview(s, { type: 'sync', scope: s.scope, initialCaption: 'Async update' });
  assert.equal(s.captionDraft, 'Manual edit');
  assert.strictEqual(captionReview(s, { type: 'sync', scope: s.scope, initialCaption: 'Async update' }), s);
  s = captionReview(s, { type: 'normalize', value: 'Normalized edit' });
  assert.equal(s.confirmed, false);
  for (const scope of ['other-company/job/render', 'company/other-job/render', 'company/job/other-render']) {
    const changed = captionReview(s, { type: 'sync', scope, initialCaption: 'New object caption' });
    assert.equal(changed.captionDraft, 'New object caption'); assert.equal(changed.reviewedCaption, '');
    assert.equal(changed.confirmed, false); assert.equal(changed.open, false); assert.equal(changed.edited, false);
  }
  s = captionReview(s, { type: 'close' }); assert.equal(s.confirmed, false);
  // Exercised pure transitions cannot invoke publication/reconciliation/provider APIs.
  assert.deepEqual(Object.keys(s).sort(), ['captionDraft','confirmed','edited','open','reviewedCaption','scope','viewed'].sort());
}
checkCaptionBehavior();
console.log('PASS caption behavior A–G: empty/default, exact caption, scope reset, async/manual/viewed protection, confirmation reset; no dispatch.');
