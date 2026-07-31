revoke execute on function public.company_ai_voice_text_valid(text, integer, boolean)
from public, anon;

revoke execute on function public.company_ai_voice_text_array_valid(text[], integer, integer)
from public, anon;

revoke execute on function public.company_ai_channel_defaults_valid(jsonb)
from public, anon;

grant execute on function public.company_ai_voice_text_valid(text, integer, boolean)
to authenticated, service_role;

grant execute on function public.company_ai_voice_text_array_valid(text[], integer, integer)
to authenticated, service_role;

grant execute on function public.company_ai_channel_defaults_valid(jsonb)
to authenticated, service_role;
