// client/src/api/chat.js
import { supabase } from '../supabaseClient';

/**
 * Гарантируем членство в чате: если нет записи в chat_members, добавим.
 * chat_members.member_id должен быть auth.uid()
 */
export async function addSelfToChat(chatId) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) throw new Error('Not authenticated');

  // есть ли уже членство?
  const { data: exists, error: selErr } = await supabase
    .from('chat_members')
    .select('chat_id')
    .eq('chat_id', chatId)
    .eq('member_id', user.id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (exists) return true;

  // добавим
  const { error: insErr } = await supabase
    .from('chat_members')
    .insert({ chat_id: chatId, member_id: user.id, last_read_at: new Date().toISOString() });
  if (insErr) throw insErr;
  return true;
}

/**
 * Отправка текстового сообщения (без файлов).
 * Возвращает вставленную строку.
 */
export async function sendTextMessage(chatId, text) {
  const body = String(text || '').trim();
  if (!chatId) throw new Error('chatId is required');
  if (!body) throw new Error('Пустое сообщение');

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) throw new Error('Not authenticated');

  // гарантируем членство
  await addSelfToChat(chatId);

  // обычный insert (RLS пропустит благодаря политикам выше)
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      chat_id: chatId,
      author_id: user.id,
      body,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Загрузка файла в bucket и привязка к сообщению.
 * Возвращает обновлённую строку сообщения.
 */
export async function attachFirstFileToMessage(msgId, chatId, file) {
  if (!file) return null;

  const clean = file.name.replace(/[^0-9A-Za-z._-]+/g, '_');
  const path = `${chatId}/${msgId}/${Date.now()}_${clean}`;

  const up = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;

  const { data, error } = await supabase
    .from('chat_messages')
    .update({ file_url: path, file_name: clean, file_type: file.type, file_size: file.size })
    .eq('id', msgId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
