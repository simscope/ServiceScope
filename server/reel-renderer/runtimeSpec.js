import { reelPresentationSpec } from '../../src/features/reel-director/presentationSpec.js';

export const reelWorkingRaster = Object.freeze({ width: 1440, height: 2560 });

export function assertReelWorkingRasterGeometry() {
  const output = reelPresentationSpec;
  if (reelWorkingRaster.width < output.width || reelWorkingRaster.height < output.height
    || reelWorkingRaster.width * output.height !== reelWorkingRaster.height * output.width) {
    throw new Error('REEL_RENDER_WORKING_RASTER_INVALID');
  }

  let combinations = 0;
  let minimumSampleWidth = Infinity;
  let minimumSampleHeight = Infinity;
  for (const crop of Object.values(output.crops)) {
    for (const motion of Object.values(output.motions)) {
      combinations += 1;
      for (let step = 0; step <= 20; step += 1) {
        const progress = step / 20;
        const zoom = crop.scale * interpolate(motion.startScale, motion.endScale, progress);
        const sampleWidth = reelWorkingRaster.width / zoom;
        const sampleHeight = reelWorkingRaster.height / zoom;
        const desiredX = 0.5 - (1 / (2 * zoom)) - (crop.x + interpolate(motion.startX, motion.endX, progress));
        const desiredY = 0.5 - (1 / (2 * zoom)) - (crop.y + interpolate(motion.startY, motion.endY, progress));
        const maxX = 1 - (1 / zoom);
        const maxY = 1 - (1 / zoom);
        const x = clamp(desiredX, 0, maxX);
        const y = clamp(desiredY, 0, maxY);
        if (!Number.isFinite(zoom) || zoom < 1 || sampleWidth < output.width || sampleHeight < output.height
          || x < 0 || y < 0 || x + (1 / zoom) > 1 + Number.EPSILON || y + (1 / zoom) > 1 + Number.EPSILON) {
          throw new Error('REEL_RENDER_WORKING_RASTER_INVALID');
        }
        minimumSampleWidth = Math.min(minimumSampleWidth, sampleWidth);
        minimumSampleHeight = Math.min(minimumSampleHeight, sampleHeight);
      }
    }
  }
  return Object.freeze({ combinations, minimumSampleWidth, minimumSampleHeight });
}

export const reelWorkingGeometry = assertReelWorkingRasterGeometry();

function interpolate(start, end, progress) {
  return start + ((end - start) * progress);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
