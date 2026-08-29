begin;

-- META_FACEBOOK_REEL_LOCAL_CLOSURE_BEGIN

lock table public.company_social_publications in share row exclusive mode;

alter table public.company_social_publications
  drop constraint company_social_publications_reel_shape_check,
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
        or (status = 'failed' and provider_delivery_stage = 'failed'
          and (reel_provider_media_id is null
            or (reel_provider_media_id is not null
              and provider_error_category = 'DELIVERY_UNKNOWN'
              and last_error_code = 'META_REEL_PUBLICATION_ABANDONED'
              and provider_status_checks = 3)))
        or (status = 'delivery_unknown' and provider_delivery_stage = 'delivery_unknown')
      ))
  );

create or replace function public.close_exhausted_company_facebook_reel_publication(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,
  p_expected_updated_at timestamptz,p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql security definer set search_path=''
as $$
declare
  existing public.company_social_publications%rowtype;
  updated public.company_social_publications%rowtype;
begin
  if p_publication_id is null or p_company_id is null or p_actor_id is null
    or p_actor_name is null or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_expected_updated_at is null or p_timestamp is null or p_timestamp < p_expected_updated_at then
    raise exception 'invalid exhausted reel local closure';
  end if;

  select * into existing from public.company_social_publications
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status='failed' and provider_delivery_stage='failed'
    and reel_provider_media_id is not null and provider_call_count between 3 and 6
    and provider_status_checks=3 and provider_error_category='DELIVERY_UNKNOWN'
    and last_error_code='META_REEL_PUBLICATION_ABANDONED'
  for update;
  if found then
    return next existing;
    return;
  end if;

  update public.company_social_publications set
    status='failed',attempts=1,provider_delivery_stage='failed',
    provider_error_category='DELIVERY_UNKNOWN',last_error_code='META_REEL_PUBLICATION_ABANDONED',
    published_at=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status in ('publishing','delivery_unknown')
    and provider_delivery_stage in ('provider_processing','delivery_unknown')
    and reel_provider_media_id is not null and provider_call_count between 3 and 6
    and provider_status_checks=3 and updated_at=p_expected_updated_at
  returning * into updated;
  if not found then raise exception 'invalid exhausted reel local closure'; end if;

  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_failed',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication closed locally after status reconciliation budget exhaustion.',jsonb_build_object(
      'channel','Facebook','status','failed','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'providerStatusChecks',updated.provider_status_checks,'reconciliationExhausted',true,
      'localClosure',true,'providerCallMade',false,'statusCheckMade',false,
      'providerAuthorityRetained',true,'published',false,'repeatBlocked',true,'attempts',1));
  return next updated;
end;
$$;

revoke all on function public.close_exhausted_company_facebook_reel_publication(uuid,uuid,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.close_exhausted_company_facebook_reel_publication(uuid,uuid,uuid,text,text,timestamptz,timestamptz) to service_role;

-- META_FACEBOOK_REEL_LOCAL_CLOSURE_END

commit;
