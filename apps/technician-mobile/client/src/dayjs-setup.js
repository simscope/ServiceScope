// src/dayjs-setup.js
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Константа с TZ Нью-Йорка
export const NY_TZ = 'America/New_York';

export default dayjs;
