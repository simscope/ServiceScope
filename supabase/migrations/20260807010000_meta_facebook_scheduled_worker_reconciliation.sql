-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_BEGIN

create or replace function public.reconcile_stale_scheduled_company_facebook_publications(
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  database_now timestamptz;
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  reconciled_count integer := 0;
begin
  database_now := clock_timestamp();

  if p_limit not between 1 and 20 then
    raise exception 'invalid scheduled publication reconciliation request';
  end if;

  for locked_publication in
    select publication.*
    from public.company_social_publications publication
    where publication.scheduled_for is not null
      and publication.status = 'publishing'
      and publication.attempts = 0
      and publication.provider_post_id is null
      and publication.provider_media_id is null
      and publication.updated_at < database_now - interval '10 minutes'
    order by publication.updated_at asc, publication.created_at asc, publication.id asc
    limit p_limit
    for update skip locked
  loop
    update public.company_social_publications
    set status = 'delivery_unknown',
        attempts = 1,
        provider_post_id = null,
        provider_media_id = null,
        provider_http_status = null,
        provider_error_code = null,
        provider_error_subcode = null,
        provider_error_category = 'DELIVERY_UNKNOWN',
        provider_is_transient = null,
        last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN',
        last_scheduler_error_code = null,
        claim_token = null,
        claimed_at = null,
        claim_expires_at = null,
        next_attempt_at = null,
        published_at = null,
        updated_at = database_now
    where id = locked_publication.id
    returning * into updated_publication;

    insert into public.audit_events (
      company_id, actor_user_id, actor_name, actor_role, category, action,
      resource_type, resource, resource_id, resource_label, details, metadata
    ) values (
      updated_publication.company_id,
      updated_publication.approved_by,
      updated_publication.scheduled_by_name,
      updated_publication.scheduled_by_role,
      'access',
      'meta_publication_delivery_unknown',
      'meta_social_publication',
      'Facebook publication',
      updated_publication.id::text,
      'Facebook publication',
      'Meta scheduled publication requires delivery reconciliation.',
      jsonb_build_object(
        'channel', 'Facebook',
        'status', 'delivery_unknown',
        'publicationKind', updated_publication.publication_kind,
        'mediaCount', updated_publication.media_count,
        'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
        'providerCallCount', 1,
        'deliveryUnknown', true,
        'repeatBlocked', true,
        'reconciliationRequired', true,
        'schedulerRecovery', true,
        'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
        'attempts', 1
      )
    );

    reconciled_count := reconciled_count + 1;
  end loop;

  return reconciled_count;
end;
$$;

revoke all on function public.reconcile_stale_scheduled_company_facebook_publications(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_stale_scheduled_company_facebook_publications(integer)
  to service_role;

comment on function public.reconcile_stale_scheduled_company_facebook_publications(integer) is
  'Conservatively marks stale scheduled publishing rows delivery_unknown without retrying Meta.';

-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_END
