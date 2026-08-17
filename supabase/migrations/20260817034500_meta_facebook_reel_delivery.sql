-- META_FACEBOOK_REEL_DELIVERY_BEGIN

create unique index if not exists company_reel_render_jobs_publication_identity_uidx
  on public.company_reel_render_jobs (id, company_id, job_id);

alter table public.company_social_publications
  add column render_job_id uuid,
  add column reel_video_sha256 bytea,
  add column reel_video_bytes bigint,
  add column reel_provider_media_id text,
  add column provider_delivery_stage text,
  add column provider_call_count smallint not null default 0,
  add column provider_status_checks smallint not null default 0,
  add column provider_last_checked_at timestamptz,
  add constraint company_social_publications_render_identity_fk
    foreign key (render_job_id, company_id, job_id)
    references public.company_reel_render_jobs (id, company_id, job_id) on delete restrict;

alter table public.company_social_publications
  drop constraint if exists company_social_publications_kind_check,
  drop constraint if exists company_social_publications_media_count_check,
  drop constraint if exists company_social_publications_error_category_check,
  drop constraint if exists company_social_publications_state_shape_check;

alter table public.company_social_publications
  add constraint company_social_publications_kind_check
    check (publication_kind in ('text_only', 'single_photo', 'reel_video')),
  add constraint company_social_publications_media_count_check check (
    (publication_kind = 'text_only' and media_count = 0 and attachment_id is null and safe_mime_type is null)
    or (publication_kind = 'single_photo' and media_count = 1 and attachment_id is not null and safe_mime_type in ('image/jpeg', 'image/png'))
    or (publication_kind = 'reel_video' and media_count = 1 and attachment_id is null and safe_mime_type = 'video/mp4')
  ),
  add constraint company_social_publications_error_category_check check (
    provider_error_category is null or provider_error_category in (
      'INVALID_TOKEN','MISSING_PERMISSION','PAGE_UNAVAILABLE','RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR','PROVIDER_REJECTED','DELIVERY_UNKNOWN',
      'RESPONSE_MISSING_POST_ID','RESPONSE_MISSING_MEDIA_ID','REEL_PROCESSING_FAILED'
    )
  ),
  add constraint company_social_publications_reel_shape_check check (
    (publication_kind <> 'reel_video'
      and render_job_id is null and reel_video_sha256 is null and reel_video_bytes is null
      and reel_provider_media_id is null and provider_delivery_stage is null
      and provider_call_count = 0 and provider_status_checks = 0 and provider_last_checked_at is null)
    or (publication_kind = 'reel_video'
      and render_job_id is not null
      and octet_length(reel_video_sha256) = 32
      and reel_video_bytes between 1 and 25000000
      and provider_call_count between 0 and 6
      and provider_status_checks between 0 and 3
      and provider_post_id is null
      and scheduled_for is null and scheduled_timezone is null
      and scheduled_attachment_sha256 is null and scheduled_analysis_run_id is null
      and scheduled_attachment_result_id is null and scheduled_approval_id is null
      and scheduled_facebook_page_id is null and scheduled_by_name is null and scheduled_by_role is null
      and claim_token is null and claimed_at is null and claim_expires_at is null and next_attempt_at is null
      and cancelled_at is null and cancelled_by is null
      and (
        (status = 'publishing' and provider_delivery_stage in ('upload_initializing','uploading','finalizing','provider_processing')
          and ((provider_delivery_stage = 'upload_initializing' and reel_provider_media_id is null)
            or (provider_delivery_stage <> 'upload_initializing' and reel_provider_media_id is not null)))
        or (status = 'published' and provider_delivery_stage = 'published'
          and reel_provider_media_id is not null and provider_media_id = reel_provider_media_id)
        or (status = 'failed' and provider_delivery_stage = 'failed' and reel_provider_media_id is null)
        or (status = 'delivery_unknown' and provider_delivery_stage = 'delivery_unknown')
      ))
  ),
  add constraint company_social_publications_state_shape_check check (
    (status = 'scheduled'
      and attempts = 0 and provider_post_id is null and provider_media_id is null and published_at is null
      and provider_http_status is null and provider_error_code is null and provider_error_subcode is null
      and provider_error_category is null and provider_is_transient is null and last_error_code is null
      and last_scheduler_error_code is null and scheduled_for is not null and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null and scheduled_by_name is not null and scheduled_by_role is not null
      and cancelled_at is null and cancelled_by is null and next_attempt_at is not null
      and ((publication_kind = 'text_only' and attachment_id is null and safe_mime_type is null and media_count = 0
            and scheduled_attachment_sha256 is null and scheduled_analysis_run_id is null
            and scheduled_attachment_result_id is null and scheduled_approval_id is null)
        or (publication_kind = 'single_photo' and attachment_id is not null and safe_mime_type in ('image/jpeg','image/png')
            and media_count = 1 and scheduled_attachment_sha256 is not null and scheduled_analysis_run_id is not null
            and scheduled_attachment_result_id is not null and scheduled_approval_id is not null)))
    or (status = 'publishing'
      and attempts = 0 and provider_post_id is null and provider_media_id is null and published_at is null
      and provider_http_status is null and provider_error_code is null and provider_error_subcode is null
      and provider_error_category is null and provider_is_transient is null and last_error_code is null
      and last_scheduler_error_code is null and claim_token is null and claimed_at is null and claim_expires_at is null
      and next_attempt_at is null and cancelled_at is null and cancelled_by is null)
    or (status = 'published'
      and attempts = 1 and published_at is not null and provider_http_status is null and provider_error_code is null
      and provider_error_subcode is null and provider_error_category is null and provider_is_transient is null
      and last_error_code is null and last_scheduler_error_code is null and claim_token is null and claimed_at is null
      and claim_expires_at is null and next_attempt_at is null and cancelled_at is null and cancelled_by is null
      and ((publication_kind = 'text_only' and provider_post_id is not null and provider_media_id is null)
        or (publication_kind in ('single_photo','reel_video') and provider_post_id is null and provider_media_id is not null)))
    or (status = 'failed'
      and provider_post_id is null and provider_media_id is null and published_at is null
      and claim_token is null and claimed_at is null and claim_expires_at is null and next_attempt_at is null
      and cancelled_at is null and cancelled_by is null
      and ((attempts = 1 and provider_error_category is not null and last_error_code is not null and last_scheduler_error_code is null)
        or (attempts = 0 and scheduled_for is not null and provider_http_status is null and provider_error_code is null
          and provider_error_subcode is null and provider_error_category is null and provider_is_transient is null
          and last_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'
          and last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED')))
    or (status = 'delivery_unknown'
      and attempts = 1 and provider_post_id is null and provider_media_id is null and published_at is null
      and provider_error_category = 'DELIVERY_UNKNOWN' and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN'
      and last_scheduler_error_code is null and claim_token is null and claimed_at is null and claim_expires_at is null
      and next_attempt_at is null and cancelled_at is null and cancelled_by is null)
    or (status = 'cancelled'
      and attempts = 0 and provider_post_id is null and provider_media_id is null and published_at is null
      and provider_http_status is null and provider_error_code is null and provider_error_subcode is null
      and provider_error_category is null and provider_is_transient is null and last_error_code is null
      and last_scheduler_error_code is null and scheduled_for is not null and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null and cancelled_at is not null and cancelled_by is not null
      and claim_token is null and claimed_at is null and claim_expires_at is null and next_attempt_at is null)
  );

create index company_social_publications_reel_render_idx
  on public.company_social_publications (company_id, render_job_id, created_at desc)
  where publication_kind = 'reel_video';

create or replace function public.begin_company_facebook_reel_publication(
  p_publication_id uuid, p_company_id uuid, p_connection_id uuid, p_job_id uuid,
  p_render_job_id uuid, p_idempotency_key uuid, p_approved_message text,
  p_message_sha256 bytea, p_publication_intent_sha256 bytea,
  p_video_sha256 text, p_video_bytes bigint,
  p_actor_id uuid, p_actor_name text, p_actor_role text, p_timestamp timestamptz
)
returns table (
  publication_id uuid, publication_status text, publication_approved_at timestamptz,
  publication_published_at timestamptz, publication_last_error_code text,
  provider_delivery_stage text, should_publish boolean
)
language plpgsql security definer set search_path = ''
as $$
declare selected_connection public.company_social_connections%rowtype;
declare selected_render public.company_reel_render_jobs%rowtype;
declare existing_publication public.company_social_publications%rowtype;
declare created_publication public.company_social_publications%rowtype;
begin
  if p_publication_id is null or p_company_id is null or p_connection_id is null or p_job_id is null
    or p_render_job_id is null or p_idempotency_key is null or p_actor_id is null or p_timestamp is null
    or p_approved_message is null or char_length(p_approved_message) not between 1 and 5000
    or octet_length(p_message_sha256) <> 32 or octet_length(p_publication_intent_sha256) <> 32
    or p_video_sha256 !~ '^[0-9a-f]{64}$' or p_video_bytes not between 1 and 25000000
    or p_actor_name is null or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid reel publication request';
  end if;

  select * into selected_connection from public.company_social_connections
  where id=p_connection_id and company_id=p_company_id and provider='meta-facebook-login'
    and status='connected' and facebook_page_id is not null
    and granted_scopes @> array['pages_show_list','pages_read_engagement','pages_manage_posts']::text[];
  if not found then raise exception 'invalid reel connection'; end if;

  select * into selected_render from public.company_reel_render_jobs
  where id=p_render_job_id and company_id=p_company_id and job_id=p_job_id and status='completed'
    and output_bucket='company-reel-renders' and video_object_path=p_company_id::text||'/'||p_render_job_id::text||'/reel.mp4'
    and file_size=p_video_bytes and video_sha256=p_video_sha256
    and duration_ms between 3000 and 90000 and width=1080 and height=1920 and fps between 24 and 60
    and video_codec='h264' and pixel_format='yuv420p' and audio_streams=0 and faststart=true;
  if not found
    or not exists (select 1 from storage.buckets where id='company-reel-renders' and public=false)
    or not exists (select 1 from storage.objects where bucket_id='company-reel-renders' and name=selected_render.video_object_path) then
    raise exception 'invalid completed reel';
  end if;

  select * into existing_publication from public.company_social_publications
  where company_id=p_company_id and (idempotency_key=p_idempotency_key or publication_intent_sha256=p_publication_intent_sha256)
  order by created_at asc, id asc limit 1 for update;
  if found then
    if existing_publication.connection_id<>p_connection_id or existing_publication.job_id<>p_job_id
      or existing_publication.approved_by<>p_actor_id or existing_publication.publication_kind<>'reel_video'
      or existing_publication.render_job_id<>p_render_job_id or existing_publication.message_sha256<>p_message_sha256
      or existing_publication.reel_video_sha256<>decode(p_video_sha256,'hex')
      or existing_publication.reel_video_bytes<>p_video_bytes then
      raise exception 'reel publication idempotency conflict';
    end if;
    return query select existing_publication.id,existing_publication.status,existing_publication.approved_at,
      existing_publication.published_at,existing_publication.last_error_code,existing_publication.provider_delivery_stage,false;
    return;
  end if;

  begin
    insert into public.company_social_publications (
      id,company_id,connection_id,job_id,provider,channel,status,idempotency_key,
      approved_message,message_sha256,publication_intent_sha256,publication_kind,
      attachment_id,safe_mime_type,media_count,approved_by,approved_at,created_at,updated_at,
      render_job_id,reel_video_sha256,reel_video_bytes,provider_delivery_stage
    ) values (
      p_publication_id,p_company_id,p_connection_id,p_job_id,'meta-facebook-login','Facebook','publishing',p_idempotency_key,
      p_approved_message,p_message_sha256,p_publication_intent_sha256,'reel_video',
      null,'video/mp4',1,p_actor_id,p_timestamp,p_timestamp,p_timestamp,
      p_render_job_id,decode(p_video_sha256,'hex'),p_video_bytes,'upload_initializing'
    ) returning * into created_publication;
  exception when unique_violation then
    select * into existing_publication from public.company_social_publications
    where company_id=p_company_id and (idempotency_key=p_idempotency_key or publication_intent_sha256=p_publication_intent_sha256)
    order by created_at asc,id asc limit 1 for update;
    if not found then raise; end if;
    if existing_publication.connection_id<>p_connection_id or existing_publication.job_id<>p_job_id
      or existing_publication.approved_by<>p_actor_id or existing_publication.publication_kind<>'reel_video'
      or existing_publication.render_job_id<>p_render_job_id or existing_publication.message_sha256<>p_message_sha256
      or existing_publication.reel_video_sha256<>decode(p_video_sha256,'hex')
      or existing_publication.reel_video_bytes<>p_video_bytes then
      raise exception 'reel publication idempotency conflict';
    end if;
    return query select existing_publication.id,existing_publication.status,existing_publication.approved_at,
      existing_publication.published_at,existing_publication.last_error_code,existing_publication.provider_delivery_stage,false;
    return;
  end;

  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_reel_publication_requested',
    'meta_social_publication','Facebook Reel publication',created_publication.id::text,'Facebook Reel publication',
    'Explicit Facebook Reel publication request accepted.',jsonb_build_object(
      'channel','Facebook','publicationKind','reel_video','status','publishing','providerStage','upload_initializing',
      'mediaCount',1,'messageCharacterCount',char_length(p_approved_message),
      'renderJobId',p_render_job_id::text,'videoByteSize',p_video_bytes,
      'videoHashPrefix',substring(p_video_sha256 from 1 for 16),'providerCallCount',0));

  return query select created_publication.id,created_publication.status,created_publication.approved_at,
    created_publication.published_at,created_publication.last_error_code,created_publication.provider_delivery_stage,true;
end;
$$;

create or replace function public.advance_company_facebook_reel_publication(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,
  p_expected_stage text,p_next_stage text,p_provider_media_id text,p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql security definer set search_path = ''
as $$
declare updated public.company_social_publications%rowtype;
begin
  if (p_expected_stage,p_next_stage) not in (('upload_initializing','uploading'),('uploading','finalizing'),('finalizing','provider_processing'))
    or p_provider_media_id is null or char_length(btrim(p_provider_media_id)) not between 1 and 200
    or p_provider_media_id ~ '[[:cntrl:]]' then raise exception 'invalid reel stage transition'; end if;
  update public.company_social_publications set
    reel_provider_media_id=btrim(p_provider_media_id),provider_delivery_stage=p_next_stage,
    provider_call_count=provider_call_count+1,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status='publishing' and provider_delivery_stage=p_expected_stage
    and provider_call_count<6 returning * into updated;
  if not found then raise exception 'invalid reel stage transition'; end if;
  return next updated;
end;
$$;

create or replace function public.record_company_facebook_reel_processing(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,p_timestamp timestamptz
)
returns setof public.company_social_publications language plpgsql security definer set search_path=''
as $$ declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set status='publishing',attempts=0,provider_delivery_stage='provider_processing',
    provider_call_count=provider_call_count+1,provider_status_checks=provider_status_checks+1,provider_last_checked_at=p_timestamp,
    provider_error_category=null,last_error_code=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id and publication_kind='reel_video'
    and status in ('publishing','delivery_unknown') and reel_provider_media_id is not null
    and provider_call_count<6 and provider_status_checks<3 returning * into updated;
  if not found then raise exception 'reel status check limit reached'; end if;
  return next updated;
end; $$;

create or replace function public.complete_company_facebook_reel_publication(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,p_timestamp timestamptz
)
returns setof public.company_social_publications language plpgsql security definer set search_path=''
as $$ declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set status='published',attempts=1,provider_media_id=reel_provider_media_id,
    provider_delivery_stage='published',provider_call_count=provider_call_count+1,provider_status_checks=provider_status_checks+1,
    provider_last_checked_at=p_timestamp,provider_error_category=null,last_error_code=null,published_at=p_timestamp,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id and publication_kind='reel_video'
    and status in ('publishing','delivery_unknown') and reel_provider_media_id is not null
    and provider_call_count<6 and provider_status_checks<3 returning * into updated;
  if not found then raise exception 'invalid reel completion'; end if;
  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_published',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication completed.',jsonb_build_object(
      'channel','Facebook','status','published','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'messageCharacterCount',char_length(updated.approved_message),'attempts',1));
  return next updated;
end; $$;

create or replace function public.fail_company_facebook_reel_publication(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,
  p_provider_http_status integer,p_provider_error_code integer,p_provider_error_subcode integer,
  p_provider_error_category text,p_provider_is_transient boolean,p_last_error_code text,
  p_call_was_sent boolean,p_timestamp timestamptz
)
returns setof public.company_social_publications language plpgsql security definer set search_path=''
as $$ declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set status='failed',attempts=1,provider_media_id=null,reel_provider_media_id=null,
    provider_delivery_stage='failed',provider_call_count=provider_call_count+case when p_call_was_sent then 1 else 0 end,
    provider_http_status=p_provider_http_status,provider_error_code=p_provider_error_code,
    provider_error_subcode=p_provider_error_subcode,provider_error_category=coalesce(p_provider_error_category,'PROVIDER_REJECTED'),
    provider_is_transient=p_provider_is_transient,last_error_code=p_last_error_code,published_at=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id and publication_kind='reel_video'
    and status in ('publishing','delivery_unknown') and provider_call_count+case when p_call_was_sent then 1 else 0 end<=6
  returning * into updated;
  if not found then raise exception 'invalid reel failure'; end if;
  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_failed',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication failed.',jsonb_build_object(
      'channel','Facebook','status','failed','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'providerCategory',updated.provider_error_category,'attempts',1));
  return next updated;
end; $$;

create or replace function public.mark_company_facebook_reel_unknown(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,
  p_provider_media_id text,p_call_was_sent boolean,p_timestamp timestamptz
)
returns setof public.company_social_publications language plpgsql security definer set search_path=''
as $$ declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set status='delivery_unknown',attempts=1,provider_media_id=null,
    reel_provider_media_id=coalesce(reel_provider_media_id,nullif(btrim(p_provider_media_id),'')),
    provider_delivery_stage='delivery_unknown',provider_call_count=provider_call_count+case when p_call_was_sent then 1 else 0 end,
    provider_http_status=null,provider_error_code=null,provider_error_subcode=null,
    provider_error_category='DELIVERY_UNKNOWN',provider_is_transient=null,
    last_error_code='META_PUBLICATION_DELIVERY_UNKNOWN',published_at=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id and publication_kind='reel_video'
    and status in ('publishing','delivery_unknown') and provider_call_count+case when p_call_was_sent then 1 else 0 end<=6
  returning * into updated;
  if not found then raise exception 'invalid reel unknown transition'; end if;
  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_delivery_unknown',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication requires provider status reconciliation.',jsonb_build_object(
      'channel','Facebook','status','delivery_unknown','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'deliveryUnknown',true,'repeatBlocked',true,'reconciliationRequired',true,'attempts',1));
  return next updated;
end; $$;

revoke all on function public.begin_company_facebook_reel_publication(uuid,uuid,uuid,uuid,uuid,uuid,text,bytea,bytea,text,bigint,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.advance_company_facebook_reel_publication(uuid,uuid,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_company_facebook_reel_processing(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_company_facebook_reel_publication(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_company_facebook_reel_publication(uuid,uuid,uuid,text,text,integer,integer,integer,text,boolean,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.mark_company_facebook_reel_unknown(uuid,uuid,uuid,text,text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_company_facebook_reel_publication(uuid,uuid,uuid,uuid,uuid,uuid,text,bytea,bytea,text,bigint,uuid,text,text,timestamptz) to service_role;
grant execute on function public.advance_company_facebook_reel_publication(uuid,uuid,uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.record_company_facebook_reel_processing(uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.complete_company_facebook_reel_publication(uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.fail_company_facebook_reel_publication(uuid,uuid,uuid,text,text,integer,integer,integer,text,boolean,text,boolean,timestamptz) to service_role;
grant execute on function public.mark_company_facebook_reel_unknown(uuid,uuid,uuid,text,text,text,boolean,timestamptz) to service_role;

-- META_FACEBOOK_REEL_DELIVERY_END
