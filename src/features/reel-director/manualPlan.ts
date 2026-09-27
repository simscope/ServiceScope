import type { AssistantLocalFacts } from '../ai-assistant/assistantModel';
import type {
  ManualReelRole,
  ManualReelSceneInput,
  ReelCreativePlanV1,
  ReelSceneCategoryLabel,
} from './contracts';

export const MANUAL_REEL_CATEGORY_OPTIONS: Record<ManualReelRole, readonly ReelSceneCategoryLabel[]> = {
  problem: ['PROBLEM', 'DETAIL'],
  process: ['SERVICE', 'PROCESS'],
  result: ['RESULT'],
  supporting: ['FIELD NOTE', 'SUPPORTING'],
};
export const MANUAL_REEL_PRIMARY_MAX_LENGTH = 45;
export const MANUAL_REEL_SUPPORTING_MAX_LENGTH = 80;

const manualRoleBySceneRole: Record<string, ManualReelRole> = {
  detail: 'problem',
  repair_process: 'process',
  finished_result: 'result',
  supporting_image: 'supporting',
};

export function manualReelScenesFromPlan(plan: ReelCreativePlanV1): ManualReelSceneInput[] {
  return plan.scenes.map((scene) => {
    const role = manualRoleBySceneRole[scene.sceneRole];
    if (!role || !scene.categoryLabel) throw new Error('INVALID_REEL_PROVIDER_OUTPUT');
    return {
      attachmentId: scene.attachmentId,
      position: scene.position,
      role,
      categoryLabel: scene.categoryLabel,
      primaryText: scene.overlayText,
      supportingText: scene.secondaryText ?? '',
    };
  });
}

export function manualReelFacts(scenes: ManualReelSceneInput[]): AssistantLocalFacts {
  const problem = scenes.find((scene) => scene.role === 'problem');
  const process = scenes.find((scene) => scene.role === 'process');
  const result = scenes.find((scene) => scene.role === 'result');
  const supporting = scenes.find((scene) => scene.role === 'supporting');
  return {
    diagnosis: sceneFact(problem),
    repairPerformed: [sceneFact(process), sceneFact(result), sceneFact(supporting)].filter(Boolean).join('. '),
    finalResult: sceneFact(result),
  };
}

function sceneFact(scene: ManualReelSceneInput | undefined) {
  return scene ? [scene.primaryText, scene.supportingText].filter(Boolean).join('. ') : '';
}

export function applyManualReelDraft(plan: ReelCreativePlanV1, scenes: ManualReelSceneInput[]): ReelCreativePlanV1 {
  const sceneByAttachment = new Map(scenes.map((scene) => [scene.attachmentId, scene]));
  const problem = scenes.find((scene) => scene.role === 'problem');
  const process = scenes.find((scene) => scene.role === 'process');
  const result = scenes.find((scene) => scene.role === 'result');
  if (!problem || !process || !result) return plan;
  return {
    ...plan,
    hook: { ...plan.hook, text: problem.primaryText },
    cover: { ...plan.cover, title: problem.primaryText },
    scenes: plan.scenes.map((scene) => {
      const draft = sceneByAttachment.get(scene.attachmentId);
      return draft ? {
        ...scene,
        categoryLabel: draft.categoryLabel,
        overlayText: draft.primaryText,
        secondaryText: draft.supportingText || null,
      } : scene;
    }),
    caption: {
      ...plan.caption,
      text: `${problem.primaryText}. ${process.primaryText}. ${result.primaryText}.`,
    },
  };
}
