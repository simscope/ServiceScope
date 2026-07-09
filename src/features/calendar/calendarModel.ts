import type { ServiceJob } from '../../types';
import { addDays, formatCalendarDay, parseLocalDate, startOfWeek, toLocalIsoDate } from '../../utils/calendar';
import type { CalendarAssignment, CalendarView } from './useCalendarFeature';

export type CalendarDropSlot = {
  key: string;
  label: string;
  hour: number;
  minute: number;
};

type CalendarModelInput = {
  calendarAnchorDate: string;
  calendarView: CalendarView;
  activeCalendarTech: string;
  calendarAssignments: Record<string, CalendarAssignment>;
  activeJobsRows: ServiceJob[];
};

export function makeCalendarModel({
  calendarAnchorDate,
  calendarView,
  activeCalendarTech,
  calendarAssignments,
  activeJobsRows,
}: CalendarModelInput) {
  const calendarAnchor = parseLocalDate(calendarAnchorDate);
  const calendarWeekStart = startOfWeek(calendarAnchor);
  const calendarDays = Array.from({ length: 7 }, (_, index) => formatCalendarDay(addDays(calendarWeekStart, index)));
  const calendarMonthStart = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), 1, 12);
  const calendarMonthGridStart = startOfWeek(calendarMonthStart);
  const calendarMonthDays = Array.from({ length: 42 }, (_, index) => formatCalendarDay(addDays(calendarMonthGridStart, index)));
  const allCalendarDays = Array.from(new globalThis.Map([...calendarMonthDays, ...calendarDays, formatCalendarDay(calendarAnchor)].map((day) => [day.key, day])).values());
  const calendarRangeTitle =
    calendarView === 'month'
      ? calendarAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : calendarView === 'day'
        ? calendarAnchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : `${calendarDays[0].date} - ${calendarDays[6].date}, ${calendarDays[6].isoDate.slice(0, 4)}`;
  const calendarSlots = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'];
  const calendarSlotHours: Record<string, number> = {
    '8 AM': 8,
    '9 AM': 9,
    '10 AM': 10,
    '11 AM': 11,
    '12 PM': 12,
    '1 PM': 13,
    '2 PM': 14,
    '3 PM': 15,
    '4 PM': 16,
    '5 PM': 17,
    '6 PM': 18,
    '7 PM': 19,
    '8 PM': 20,
  };
  const calendarDropSlots: CalendarDropSlot[] = calendarSlots.slice(0, -1).flatMap((slot) => [
    { key: `${slot}:00`, label: slot, hour: calendarSlotHours[slot], minute: 0 },
    { key: `${slot}:30`, label: slot.replace(/\s/, ':30 '), hour: calendarSlotHours[slot], minute: 30 },
  ]);
  const calendarAssignmentFromJob = (job: ServiceJob) => {
    if (!job.appointment) return undefined;
    const appointmentDate = new Date(job.appointment);
    if (Number.isNaN(appointmentDate.getTime())) return undefined;
    const slot = calendarDropSlots.find((dropSlot) => dropSlot.hour === appointmentDate.getHours() && dropSlot.minute === appointmentDate.getMinutes());

    return {
      assignee: job.assignee,
      dayKey: toLocalIsoDate(appointmentDate),
      time: slot?.key ?? `${appointmentDate.getHours()}:00`,
      durationMinutes: job.calendarDurationMinutes ?? 120,
    };
  };
  const calendarJobs = activeJobsRows.map((job) => {
    const assignment = calendarAssignments[job.jobNumber] ?? calendarAssignmentFromJob(job);
    const appointmentDay = allCalendarDays.find((day) => day.key === assignment?.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === assignment?.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : job.appointment;

    return {
      ...job,
      technician: assignment?.assignee ?? job.technician,
      assignee: assignment?.assignee ?? job.assignee,
      dayKey: assignment?.dayKey,
      time: assignment?.time,
      durationMinutes: assignment?.durationMinutes ?? job.calendarDurationMinutes ?? 120,
      appointment,
    };
  });
  const scheduledJobs = calendarJobs.filter((job) => job.dayKey && job.time && job.assignee !== 'No technician');
  const unassignedCalendarJobs = calendarJobs.filter((job) => !job.dayKey || job.assignee === 'No technician');
  const visibleCalendarJobs = scheduledJobs.filter((job) => activeCalendarTech === 'all' || job.assignee === activeCalendarTech);
  const visibleCalendarDays = calendarView === 'day' ? [formatCalendarDay(calendarAnchor)] : calendarDays;

  return {
    calendarAnchor,
    calendarDays,
    calendarMonthDays,
    allCalendarDays,
    calendarRangeTitle,
    calendarSlots,
    calendarDropSlots,
    calendarJobs,
    scheduledJobs,
    unassignedCalendarJobs,
    visibleCalendarJobs,
    visibleCalendarDays,
  };
}
