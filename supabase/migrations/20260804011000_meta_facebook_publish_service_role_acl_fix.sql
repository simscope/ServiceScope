-- META_FACEBOOK_PUBLISH_ACL_FIX_BEGIN
revoke all privileges
on table public.company_social_publications
from service_role;

grant select, insert, update
on table public.company_social_publications
to service_role;

revoke all privileges
on table public.company_social_publications
from public, anon, authenticated;
-- META_FACEBOOK_PUBLISH_ACL_FIX_END
