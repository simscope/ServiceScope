import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReelManagerEditor } from './components/portal/ReelManagerEditor';
import type { EditorBackend, EditorMedia } from './features/reel-editor/types';
// This entry point is served exclusively by the explicit loopback demo script.
const jobId = '11111111-1111-4111-8111-111111111111';
const media: EditorMedia[] = [1, 2, 3].map(i => ({ attachmentId: `fixture-${i}`, name: `Grid fixture ${i}`, url: `/__reel-editor/media/${i}`, width: 1600, height: 1200, privacy: 'passed' }));
async function call(operation: string, body: Record<string, unknown> = {}) {
  const response = await fetch('/__reel-editor/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, jobId, ...body }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.code); return value;
}
const backend: EditorBackend = { load: () => call('load'), save: (draft, expectedRevision, confirmBrief) => call('save', { draft, expectedRevision, confirmBrief }), approve: expectedRevision => call('approve', { expectedRevision }), render: approval => call('render', { approval }) };
createRoot(document.getElementById('root')!).render(<React.StrictMode><ReelManagerEditor jobId={jobId} media={media} backend={backend} localDemo /></React.StrictMode>);
