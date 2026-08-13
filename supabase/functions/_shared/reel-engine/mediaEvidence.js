const rolePriority = Object.freeze({
  overview: 0,
  detail: 1,
  repair_process: 2,
  replacement_part: 3,
  finished_result: 4,
  supporting_image: 5,
});

const meaningfulCategories = new Set([
  'equipment_overview',
  'possible_problem_detail',
  'repair_process',
  'replacement_part',
  'finished_result',
]);
const weakCategories = new Set(['low_information', 'duplicate_candidate', 'unclear']);

export function roleForContentFinding(category) {
  if (category === 'equipment_overview') return 'overview';
  if (category === 'possible_problem_detail') return 'detail';
  if (category === 'repair_process') return 'repair_process';
  if (category === 'replacement_part') return 'replacement_part';
  if (category === 'finished_result') return 'finished_result';
  return 'supporting_image';
}

export function reconstructAuthoritativeReelMedia(requestMedia, rows) {
  const rowsByAttachment = new Map();
  for (const row of rows) {
    const attachmentId = String(row.attachment_id ?? row.attachmentId ?? '');
    if (!attachmentId) continue;
    const current = rowsByAttachment.get(attachmentId) ?? [];
    current.push(row);
    rowsByAttachment.set(attachmentId, current);
  }

  const safeMedia = requestMedia.map((requested) => {
    const attachmentRows = rowsByAttachment.get(requested.attachmentId);
    if (!attachmentRows?.length) throw mediaError('REEL_ANALYSIS_REQUIRED');
    const authority = attachmentRows[0];
    if (authority.excluded === true) throw mediaError('REEL_MEDIA_UNAVAILABLE');
    if (!['passed', 'resolved_false_positive'].includes(String(authority.privacy_review_status ?? ''))
      || Number(authority.unresolved_privacy_count ?? 0) > 0) {
      throw mediaError('REEL_PRIVACY_REVIEW_REQUIRED');
    }
    if (String(authority.analysis_status ?? '') !== 'analyzed') throw mediaError('REEL_ANALYSIS_REQUIRED');
    if (authority.current_checksum_matches !== true) throw mediaError('REEL_ANALYSIS_STALE');
    const findings = attachmentRows
      .filter((row) => row.finding_id && row.finding_category && row.explanation)
      .map((row) => ({
        findingId: String(row.finding_id),
        category: String(row.finding_category),
        evidenceType: String(row.evidence_type),
        confidence: Number(row.confidence),
        explanation: String(row.explanation).trim(),
        riskLevel: String(row.risk_level),
        requiresUserApproval: row.requires_user_approval === true,
      }))
      .sort(compareFindings);
    if (!findings.length) throw mediaError('REEL_ANALYSIS_REQUIRED');
    const finding = findings[0];
    const role = roleForContentFinding(finding.category);
    return {
      attachmentId: requested.attachmentId,
      position: requested.position,
      role,
      evidenceFindingId: finding.findingId,
      evidenceCategory: finding.category,
      evidenceText: finding.explanation,
      confidence: finding.confidence,
      privacyStatus: String(authority.privacy_review_status) === 'passed' ? 'passed' : 'reviewed',
      evidenceId: `media:${requested.attachmentId}:${finding.findingId}`,
      analysisRunId: String(authority.analysis_run_id),
      attachmentResultId: String(authority.attachment_result_id),
      attachmentSha256: String(authority.attachment_sha256),
      meaningful: isMeaningfulCategory(finding.category),
    };
  });

  const meaningful = safeMedia.filter((item) => item.meaningful);
  return meaningful.length >= 2 ? meaningful : safeMedia;
}

function compareFindings(left, right) {
  return Number(isMeaningfulCategory(right.category)) - Number(isMeaningfulCategory(left.category))
    || right.confidence - left.confidence
    || rolePriority[roleForContentFinding(left.category)] - rolePriority[roleForContentFinding(right.category)]
    || left.findingId.localeCompare(right.findingId);
}

function isMeaningfulCategory(category) {
  return meaningfulCategories.has(category) && !weakCategories.has(category);
}

function mediaError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
