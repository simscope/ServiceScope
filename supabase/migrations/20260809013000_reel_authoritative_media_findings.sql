create table public.company_media_analysis_content_findings (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  attachment_result_id uuid not null references public.company_media_analysis_attachment_results(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  finding_id text not null,
  finding_category text not null,
  evidence_type text not null,
  confidence double precision not null,
  explanation text not null,
  risk_level text not null,
  requires_user_approval boolean not null,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_content_findings_result_finding_unique
    unique (attachment_result_id, finding_id),
  constraint company_media_analysis_content_findings_id_check
    check (char_length(finding_id) between 1 and 120 and finding_id ~ '^[A-Za-z0-9_.:-]+$'),
  constraint company_media_analysis_content_findings_category_check
    check (finding_category in (
      'equipment_overview',
      'possible_problem_detail',
      'repair_process',
      'replacement_part',
      'finished_result',
      'low_information',
      'duplicate_candidate',
      'unclear'
    )),
  constraint company_media_analysis_content_findings_evidence_type_check
    check (evidence_type in ('visual_suggestion', 'metadata_only')),
  constraint company_media_analysis_content_findings_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint company_media_analysis_content_findings_explanation_check
    check (
      explanation = btrim(explanation)
      and char_length(explanation) between 1 and 180
      and explanation !~ '[[:cntrl:]<>]'
    ),
  constraint company_media_analysis_content_findings_risk_check
    check (risk_level in ('low', 'medium', 'high'))
);

create index company_media_analysis_content_findings_authority_idx
  on public.company_media_analysis_content_findings
  (company_id, job_id, attachment_id, attachment_result_id);

alter table public.company_media_analysis_content_findings enable row level security;
revoke all on public.company_media_analysis_content_findings from public, anon, authenticated;
grant select, insert on public.company_media_analysis_content_findings to service_role;

create or replace function public.record_company_media_analysis_result(
  p_run_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_correlation_id text,
  p_status text,
  p_provider text,
  p_model text,
  p_analysis_version text,
  p_attachments jsonb,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  analysis_run_id uuid,
  attachment_result_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  finding jsonb;
  content_findings jsonb;
  result_id uuid;
  attachment_row public.job_attachments%rowtype;
  privacy_count integer;
  content_count integer;
  total_finding_count integer := 0;
  seen_attachment_ids text[] := array[]::text[];
  seen_finding_ids text[];
  item_keys text[];
  finding_keys text[];
  attachment_id_text text;
  checksum_text text;
  detected_mime text;
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 8 and 160 or p_correlation_id ~ '[[:cntrl:]<>]'
    or p_provider is null or char_length(p_provider) not between 1 and 120 or p_provider ~ '[[:cntrl:]<>]'
    or (p_model is not null and (char_length(p_model) > 120 or p_model ~ '[[:cntrl:]<>]'))
    or p_analysis_version <> 'media-analysis-v1'
    or p_timestamp is null
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 4 then
    raise exception 'invalid media analysis persistence request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found then raise exception 'invalid media analysis job'; end if;

  insert into public.company_media_analysis_runs (
    id, company_id, job_id, correlation_id, status, provider, model, analysis_version,
    completed_at, created_at, updated_at
  ) values (
    p_run_id, p_company_id, p_job_id, p_correlation_id, p_status, p_provider, p_model, p_analysis_version,
    p_timestamp, p_timestamp, p_timestamp
  );

  for item in select value from jsonb_array_elements(p_attachments) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    content_findings := coalesce(item->'contentFindings', '[]'::jsonb);
    attachment_id_text := item->>'attachmentId';
    checksum_text := item->>'attachmentSha256';
    detected_mime := lower(item->>'detectedMimeType');
    if jsonb_typeof(item) <> 'object'
      or (
        item_keys <> array['analysisStatus','attachmentId','attachmentSha256','detectedMimeType','privacyFindings']
        and item_keys <> array['analysisStatus','attachmentId','attachmentSha256','contentFindings','detectedMimeType','privacyFindings']
      )
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or attachment_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or attachment_id_text = any(seen_attachment_ids)
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or checksum_text !~ '^\\x[0-9a-f]{64}$'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or detected_mime not in ('image/jpeg','image/png','image/webp')
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review')
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_typeof(content_findings) <> 'array'
      or jsonb_array_length(item->'privacyFindings') + jsonb_array_length(content_findings) > 6 then
      raise exception 'invalid media analysis attachment payload';
    end if;
    select * into attachment_row
    from public.job_attachments
    where id = attachment_id_text::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or attachment_row.kind::text <> 'photo'
      or lower(attachment_row.mime_type) <> detected_mime
      or attachment_row.size_bytes not between 1 and 12000000
      or attachment_row.storage_bucket is null
      or attachment_row.storage_path is null then
      raise exception 'invalid media analysis attachment';
    end if;

    seen_attachment_ids := array_append(seen_attachment_ids, attachment_id_text);
    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    content_count := jsonb_array_length(content_findings);
    total_finding_count := total_finding_count + privacy_count + content_count;
    if total_finding_count > 24 then
      raise exception 'invalid media analysis finding payload';
    end if;
    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(checksum_text from 3), 'hex'),
      detected_mime, item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    seen_finding_ids := array[]::text[];
    for finding in select value from jsonb_array_elements(content_findings) value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['confidence','evidenceType','explanation','findingCategory','findingId','requiresUserApproval','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'evidenceType') <> 'string'
        or jsonb_typeof(finding->'confidence') <> 'number'
        or jsonb_typeof(finding->'explanation') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or jsonb_typeof(finding->'requiresUserApproval') <> 'boolean'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'equipment_overview','possible_problem_detail','repair_process','replacement_part',
          'finished_result','low_information','duplicate_candidate','unclear'
        )
        or (finding->>'evidenceType') not in ('visual_suggestion','metadata_only')
        or (finding->>'confidence')::double precision < 0
        or (finding->>'confidence')::double precision > 1
        or finding->>'explanation' <> btrim(finding->>'explanation')
        or char_length(finding->>'explanation') not between 1 and 180
        or (finding->>'explanation') ~ '[[:cntrl:]<>]'
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis content finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_content_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, evidence_type, confidence, explanation,
        risk_level, requires_user_approval, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'evidenceType',
        (finding->>'confidence')::double precision, finding->>'explanation',
        finding->>'riskLevel', (finding->>'requiresUserApproval')::boolean, p_timestamp
      );
    end loop;

    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['findingCategory','findingId','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'possible_face','possible_address','possible_phone_or_email','possible_license_plate',
          'possible_customer_document','possible_screen','possible_barcode',
          'possible_serial_or_nameplate','possible_personal_identifier','unknown_privacy_risk'
        )
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis privacy finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_privacy_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, risk_level, resolved_as_false_positive, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'riskLevel', false, p_timestamp
      );
    end loop;

    attachment_id := attachment_row.id;
    analysis_run_id := p_run_id;
    attachment_result_id := result_id;
    return next;
  end loop;
end;
$$;

create or replace function public.list_company_reel_media_analysis_candidates(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_ids uuid[]
)
returns table (
  requested_position integer,
  attachment_id uuid,
  attachment_result_id uuid,
  analysis_run_id uuid,
  attachment_sha256 text,
  detected_mime_type text,
  analysis_status text,
  privacy_review_status text,
  excluded boolean,
  analysis_completed_at timestamptz,
  storage_bucket text,
  storage_path text,
  finding_id text,
  finding_category text,
  evidence_type text,
  confidence double precision,
  explanation text,
  risk_level text,
  requires_user_approval boolean,
  unresolved_privacy_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) not between 1 and 4
    or exists (select 1 from unnest(p_attachment_ids) value where value is null)
    or cardinality(p_attachment_ids) <> (select count(distinct value) from unnest(p_attachment_ids) value) then
    raise exception 'invalid Reel media candidate request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id;
  if not found then raise exception 'invalid Reel media candidate job'; end if;

  return query
  with requested as (
    select value as attachment_id, position::integer as requested_position
    from unnest(p_attachment_ids) with ordinality requested(value, position)
  ),
  latest_completed as (
    select distinct on (result.attachment_id)
      requested.requested_position,
      result.*,
      run.completed_at
    from requested
    join public.company_media_analysis_attachment_results result
      on result.attachment_id = requested.attachment_id
      and result.company_id = p_company_id
      and result.job_id = p_job_id
    join public.company_media_analysis_runs run
      on run.id = result.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    order by result.attachment_id, result.created_at desc, result.id desc
  )
  select
    latest.requested_position,
    latest.attachment_id,
    latest.id,
    latest.analysis_run_id,
    ('\\x' || encode(latest.attachment_sha256, 'hex')),
    latest.detected_mime_type,
    latest.analysis_status,
    latest.privacy_review_status,
    latest.excluded,
    latest.completed_at,
    attachment.storage_bucket,
    attachment.storage_path,
    content.finding_id,
    content.finding_category,
    content.evidence_type,
    content.confidence,
    content.explanation,
    content.risk_level,
    content.requires_user_approval,
    coalesce(privacy.unresolved_count, 0)
  from latest_completed latest
  join public.job_attachments attachment
    on attachment.id = latest.attachment_id
    and attachment.company_id = p_company_id
    and attachment.job_id = p_job_id
    and attachment.kind::text <> 'video'
    and lower(attachment.mime_type) in ('image/jpeg','image/png','image/webp')
    and attachment.size_bytes between 1 and 12000000
    and attachment.storage_bucket is not null
    and attachment.storage_path is not null
  left join public.company_media_analysis_content_findings content
    on content.attachment_result_id = latest.id
    and content.analysis_run_id = latest.analysis_run_id
    and content.company_id = p_company_id
    and content.job_id = p_job_id
    and content.attachment_id = latest.attachment_id
  left join lateral (
    select count(*)::bigint as unresolved_count
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = latest.id
      and finding.analysis_run_id = latest.analysis_run_id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = latest.attachment_id
      and finding.resolved_as_false_positive = false
  ) privacy on true
  order by latest.requested_position, content.finding_category, content.finding_id;
end;
$$;

revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
revoke all on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) to service_role;

comment on table public.company_media_analysis_content_findings is
  'Server-authoritative non-privacy media-analysis findings. Historical results are intentionally not backfilled.';
comment on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) is
  'Returns latest completed server-authoritative Reel analysis evidence without requiring Facebook publication approval.';
