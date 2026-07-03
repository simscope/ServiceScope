// src/utils/nyDatetime.js
import dayjs, { NY_TZ } from '../dayjs-setup';

// ISO (UTC/любая зона) -> строка для инпута в НЬЮ-ЙОРКЕ: 'YYYY-MM-DDTHH:mm'
export function isoToNYInput(iso) {
  if (!iso) return '';
  return dayjs(iso).tz(NY_TZ).format('YYYY-MM-DDTHH:mm');
}

// строка из инпута (трактуем как NY-время) -> ISO UTC
export function nyInputToIso(nyLocalStr) {
  if (!nyLocalStr) return null;
  return dayjs.tz(nyLocalStr, 'YYYY-MM-DDTHH:mm', NY_TZ).utc().toISOString();
}

// Форматирование для чтения (списки/подписи): ISO -> 'DD.MM.YYYY HH:mm' (NY)
export function formatNY(iso, mask = 'DD.MM.YYYY HH:mm') {
  if (!iso) return '';
  return dayjs(iso).tz(NY_TZ).format(mask);
}
