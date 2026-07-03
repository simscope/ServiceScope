// client/src/api/notifications.js
import { supabase } from '../supabaseClient';

/** Список моих уведомлений по чату (новые сверху) */
export async function listMyNotifications({ chatId, limit = 100 } = {}) {
  const q = supabase
    .from('notifications')
    .select('id, user_id, chat_id, type, payload, read_at, created_at')
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (chatId) q.eq('chat_id', chatId);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Подписка на мои новые уведомления (опционально по чату) */
export function subscribeMyNotifications({ chatId, onInsert }) {
  const uid = supabase.auth.getUser().then(r => r.data.user?.id ?? null);
  const ch = supabase.channel('notif-my');
  Promise.resolve(uid).then((userId) => {
    if (!userId) return;
    ch.on('postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: chatId ? `user_id=eq.${userId},chat_id=eq.${chatId}` : `user_id=eq.${userId}`,
      },
      (p) => onInsert?.(p.new)
    ).subscribe();
  });
  return () => supabase.removeChannel(ch);
}

/** Пометить все мои уведомления по чату прочитанными */
export async function markChatRead({ chatId }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !chatId) return;

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('chat_id', chatId)
    .is('read_at', null);

  if (error) throw error;
}

/** Утилита для создания уведомления (если делаешь это с фронта) */
export async function createNotif({ toUserId, chatId, type, payload }) {
  const { error } = await supabase
    .from('notifications')
    .insert([{ user_id: toUserId, chat_id: chatId, type, payload }]);
  if (error) throw error;
}
