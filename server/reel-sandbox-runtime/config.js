import { Sandbox } from '@vercel/sandbox';
import { RenderJobError } from '../reel-render-jobs/contracts.js';
import { createSandboxRenderAdapter } from './renderer.js';
import { assertImmutableSandboxImage } from './contracts.js';

export function createProductionReelRenderer(env, { createSandbox = (options) => Sandbox.create(options) } = {}) {
  if (env?.REEL_RENDER_RUNTIME !== 'sandbox') {
    throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
  }
  let image;
  try {
    image = assertImmutableSandboxImage(env.REEL_RENDER_SANDBOX_IMAGE);
  } catch {
    throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
  }
  return createSandboxRenderAdapter({ image, createSandbox });
}
