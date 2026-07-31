create or replace function public.company_ai_voice_text_valid(
  value text,
  max_length integer,
  contact_free boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    char_length(value) <= max_length
    and value !~ '[<>]'
    and value !~* '(api[_ -]?key|authorization|bearer|oauth|password|refresh[_ -]?token|secret|session[_ -]?token)'
    and value !~* '(provider|model|temperature|top[_ -]?p|max[_ -]?tokens?|response[_ -]?format|tool[_ -]?choice)[[:space:]]*[:=]'
    and value !~* '(https?://|www\.)'
    and (
      not contact_free
      or (
        value !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
        and value !~ '(\+?[0-9][0-9 .()\-]{7,}[0-9])'
        and value !~* '[0-9]{1,6}[[:space:]]+[A-Z0-9.'' -]{2,}[[:space:]]+(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\y'
      )
    );
$$;

create or replace function public.company_ai_voice_text_array_valid(
  value text[],
  max_items integer,
  max_item_length integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(cardinality(value), 0) <= max_items
    and coalesce((
      select bool_and(
        item = btrim(item)
        and item <> ''
        and public.company_ai_voice_text_valid(item, max_item_length, true)
      )
      from unnest(value) as item
    ), true);
$$;

create or replace function public.company_ai_channel_defaults_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  channel_key text;
  settings jsonb;
  hashtag_item jsonb;
begin
  if jsonb_typeof(value) <> 'object' then
    return false;
  end if;

  for channel_key, settings in select key, val from jsonb_each(value) as entry(key, val)
  loop
    if channel_key not in ('Instagram', 'Facebook', 'LinkedIn', 'Google Business', 'Blog / Case Study', 'Short Video') then
      return false;
    end if;
    if jsonb_typeof(settings) <> 'object' then
      return false;
    end if;
    if settings - array['enabled', 'defaultTone', 'defaultLocale', 'callToActionGuidance', 'hashtagGuidance']::text[] <> '{}'::jsonb then
      return false;
    end if;
    if settings ? 'enabled' and jsonb_typeof(settings->'enabled') <> 'boolean' then
      return false;
    end if;
    if settings ? 'defaultTone' and (
      jsonb_typeof(settings->'defaultTone') <> 'string'
      or settings->>'defaultTone' not in ('Professional', 'Friendly', 'Technical', 'Educational', 'Marketing')
    ) then
      return false;
    end if;
    if settings ? 'defaultLocale' and (
      jsonb_typeof(settings->'defaultLocale') <> 'string'
      or char_length(settings->>'defaultLocale') > 35
      or settings->>'defaultLocale' !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    ) then
      return false;
    end if;
    if settings ? 'callToActionGuidance' and (
      jsonb_typeof(settings->'callToActionGuidance') <> 'string'
      or not public.company_ai_voice_text_valid(settings->>'callToActionGuidance', 160, true)
    ) then
      return false;
    end if;
    if settings ? 'hashtagGuidance' then
      if jsonb_typeof(settings->'hashtagGuidance') <> 'array'
        or jsonb_array_length(settings->'hashtagGuidance') > 20 then
        return false;
      end if;
      for hashtag_item in select item from jsonb_array_elements(settings->'hashtagGuidance') as item
      loop
        if jsonb_typeof(hashtag_item) <> 'string'
          or not public.company_ai_voice_text_valid(hashtag_item #>> '{}', 40, true) then
          return false;
        end if;
      end loop;
    end if;
  end loop;

  return true;
end;
$$;

alter table public.company_profiles
  add column if not exists ai_voice_enabled boolean not null default false,
  add column if not exists ai_public_display_name text not null default '',
  add column if not exists ai_default_tone text not null default 'Professional',
  add column if not exists ai_custom_voice_guidance text not null default '',
  add column if not exists ai_service_areas text[] not null default '{}'::text[],
  add column if not exists ai_public_location_wording text not null default '',
  add column if not exists ai_cta_guidance text not null default '',
  add column if not exists ai_hashtag_guidance text[] not null default '{}'::text[],
  add column if not exists ai_channel_defaults jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_public_display_name_length') then
    alter table public.company_profiles add constraint company_profiles_ai_public_display_name_length
      check (public.company_ai_voice_text_valid(ai_public_display_name, 80, false));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_default_tone_valid') then
    alter table public.company_profiles add constraint company_profiles_ai_default_tone_valid
      check (ai_default_tone in ('Professional', 'Friendly', 'Technical', 'Educational', 'Marketing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_custom_voice_guidance_length') then
    alter table public.company_profiles add constraint company_profiles_ai_custom_voice_guidance_length
      check (public.company_ai_voice_text_valid(ai_custom_voice_guidance, 1000, true));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_service_areas_valid') then
    alter table public.company_profiles add constraint company_profiles_ai_service_areas_valid
      check (public.company_ai_voice_text_array_valid(ai_service_areas, 20, 80));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_public_location_wording_length') then
    alter table public.company_profiles add constraint company_profiles_ai_public_location_wording_length
      check (public.company_ai_voice_text_valid(ai_public_location_wording, 160, true));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_cta_guidance_length') then
    alter table public.company_profiles add constraint company_profiles_ai_cta_guidance_length
      check (public.company_ai_voice_text_valid(ai_cta_guidance, 160, true));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_hashtag_guidance_valid') then
    alter table public.company_profiles add constraint company_profiles_ai_hashtag_guidance_valid
      check (public.company_ai_voice_text_array_valid(ai_hashtag_guidance, 20, 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_ai_channel_defaults_valid') then
    alter table public.company_profiles add constraint company_profiles_ai_channel_defaults_valid
      check (public.company_ai_channel_defaults_valid(ai_channel_defaults));
  end if;
end;
$$;

comment on column public.company_profiles.ai_custom_voice_guidance is
  'Untrusted company-authored style data. It must never be treated as a system prompt.';

revoke all on function public.company_ai_voice_text_valid(text, integer, boolean) from public;
revoke all on function public.company_ai_voice_text_array_valid(text[], integer, integer) from public;
revoke all on function public.company_ai_channel_defaults_valid(jsonb) from public;
grant execute on function public.company_ai_voice_text_valid(text, integer, boolean) to authenticated, service_role;
grant execute on function public.company_ai_voice_text_array_valid(text[], integer, integer) to authenticated, service_role;
grant execute on function public.company_ai_channel_defaults_valid(jsonb) to authenticated, service_role;
