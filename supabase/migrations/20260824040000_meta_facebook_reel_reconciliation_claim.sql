begin;

-- META_FACEBOOK_REEL_RECONCILIATION_CLAIM_BEGIN

create or replace function public.claim_company_facebook_reel_status_check(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql security definer set search_path=''
as $$
declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set
    status='publishing',attempts=0,provider_delivery_stage='provider_processing',
    provider_call_count=provider_call_count+1,provider_status_checks=provider_status_checks+1,
    provider_last_checked_at=p_timestamp,provider_http_status=null,provider_error_code=null,
    provider_error_subcode=null,provider_error_category=null,provider_is_transient=null,
    last_error_code=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status='delivery_unknown'
    and provider_delivery_stage='delivery_unknown' and reel_provider_media_id is not null
    and provider_call_count<6 and provider_status_checks<3
  returning * into updated;
  if not found then raise exception 'reel status check limit reached'; end if;
  return next updated;
end;
$$;

create or replace function public.complete_company_facebook_reel_reconciliation(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql security definer set search_path=''
as $$
declare updated public.company_social_publications%rowtype;
begin
  update public.company_social_publications set
    status='published',attempts=1,provider_media_id=reel_provider_media_id,
    provider_delivery_stage='published',provider_error_category=null,last_error_code=null,
    published_at=p_timestamp,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status='publishing'
    and provider_delivery_stage='provider_processing' and reel_provider_media_id is not null
    and provider_call_count between 1 and 6 and provider_status_checks between 1 and 3
  returning * into updated;
  if not found then raise exception 'invalid reel reconciliation completion'; end if;
  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_published',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication completed.',jsonb_build_object(
      'channel','Facebook','status','published','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'messageCharacterCount',char_length(updated.approved_message),'attempts',1));
  return next updated;
end;
$$;

create or replace function public.mark_company_facebook_reel_unknown(
  p_publication_id uuid,p_company_id uuid,p_actor_id uuid,p_actor_name text,p_actor_role text,
  p_provider_media_id text,p_call_was_sent boolean,p_status_was_checked boolean,p_timestamp timestamptz
)
returns setof public.company_social_publications language plpgsql security definer set search_path=''
as $$
declare
  existing public.company_social_publications%rowtype;
  updated public.company_social_publications%rowtype;
begin
  select * into existing from public.company_social_publications
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id
    and publication_kind='reel_video' and status='delivery_unknown'
    and provider_delivery_stage='delivery_unknown' and updated_at=p_timestamp
  for update;
  if found then
    return next existing;
    return;
  end if;

  update public.company_social_publications set status='delivery_unknown',attempts=1,provider_media_id=null,
    reel_provider_media_id=coalesce(reel_provider_media_id,nullif(btrim(p_provider_media_id),'')),
    provider_delivery_stage='delivery_unknown',provider_call_count=provider_call_count+case when p_call_was_sent then 1 else 0 end,
    provider_status_checks=provider_status_checks+case when p_status_was_checked then 1 else 0 end,
    provider_last_checked_at=case when p_status_was_checked then p_timestamp else provider_last_checked_at end,
    provider_http_status=null,provider_error_code=null,provider_error_subcode=null,
    provider_error_category='DELIVERY_UNKNOWN',provider_is_transient=null,
    last_error_code='META_PUBLICATION_DELIVERY_UNKNOWN',published_at=null,updated_at=p_timestamp
  where id=p_publication_id and company_id=p_company_id and approved_by=p_actor_id and publication_kind='reel_video'
    and status in ('publishing','delivery_unknown')
    and provider_call_count+case when p_call_was_sent then 1 else 0 end<=6
    and provider_status_checks+case when p_status_was_checked then 1 else 0 end<=3
  returning * into updated;
  if not found then raise exception 'invalid reel unknown transition'; end if;
  insert into public.audit_events (company_id,actor_user_id,actor_name,actor_role,category,action,
    resource_type,resource,resource_id,resource_label,details,metadata)
  values (p_company_id,p_actor_id,btrim(p_actor_name),btrim(p_actor_role),'access','meta_publication_delivery_unknown',
    'meta_social_publication','Facebook Reel publication',updated.id::text,'Facebook Reel publication',
    'Facebook Reel publication requires provider status reconciliation.',jsonb_build_object(
      'channel','Facebook','status','delivery_unknown','publicationKind','reel_video','mediaCount',1,
      'renderJobId',updated.render_job_id::text,'providerCallCount',updated.provider_call_count,
      'providerStatusChecks',updated.provider_status_checks,
      'reconciliationExhausted',updated.provider_status_checks=3,
      'deliveryUnknown',true,'repeatBlocked',true,'reconciliationRequired',true,'attempts',1));
  return next updated;
end;
$$;

revoke all on function public.claim_company_facebook_reel_status_check(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_company_facebook_reel_reconciliation(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_company_facebook_reel_status_check(uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.complete_company_facebook_reel_reconciliation(uuid,uuid,uuid,text,text,timestamptz) to service_role;

-- META_FACEBOOK_REEL_RECONCILIATION_CLAIM_END

commit;
