import type { Dispatch, DragEvent, PointerEvent, SetStateAction } from 'react';
import type { ServiceJob } from '../../types';
import { addDays, addMonths, parseLocalDate, toLocalIsoDate } from '../../utils/calendar';
import type { CalendarAssignment, CalendarResizeState, CalendarView, MonthDropRequest } from './useCalendarFeature';

type CalendarDropSlot = {
  key: string;
  hour: number;
  minute: number;
};

type CalendarJob = ServiceJob & {
  dayKey?: string;
  time?: string;
  durationMinutes: number;
};

type CalendarActionsInput = {
  calendarView: CalendarView;
  calendarAnchorDate: string;
  setCalendarAnchorDate: Dispatch<SetStateAction<string>>;
  activeCalendarTech: string;
  calendarAssignments: Record<string, CalendarAssignment>;
  setCalendarAssignments: Dispatch<SetStateAction<Record<string, CalendarAssignment>>>;
  draggingJobNumber: string;
  setDraggingJobNumber: Dispatch<SetStateAction<string>>;
  monthDropRequest: MonthDropRequest | null;
  setMonthDropRequest: Dispatch<SetStateAction<MonthDropRequest | null>>;
  setResizingJob: Dispatch<SetStateAction<CalendarResizeState | null>>;
  calendarDropSlots: CalendarDropSlot[];
  calendarJobs: CalendarJob[];
  stopCalendarWrite: (action: string) => boolean;
  setOpenedJob: Dispatch<SetStateAction<ServiceJob | null>>;
  persistCalendarAssignment: (
    jobNumber: string,
    assignee: string,
    dayKey: string,
    slotKey: string,
    durationMinutes: number,
  ) => void;
};

export function calendarAppointmentFromParts(dayKey: string, slotKey: string, calendarDropSlots: CalendarDropSlot[]) {
  const appointmentSlot = calendarDropSlots.find((slot) => slot.key === slotKey);
  if (!appointmentSlot) return '';

  return `${dayKey}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}`;
}

export function makeCalendarActions({
  calendarView,
  calendarAnchorDate,
  setCalendarAnchorDate,
  activeCalendarTech,
  calendarAssignments,
  setCalendarAssignments,
  draggingJobNumber,
  setDraggingJobNumber,
  monthDropRequest,
  setMonthDropRequest,
  setResizingJob,
  calendarDropSlots,
  calendarJobs,
  stopCalendarWrite,
  setOpenedJob,
  persistCalendarAssignment,
}: CalendarActionsInput) {
  function handleCalendarDragStart(event: DragEvent<HTMLElement>, jobNumber: string) {
    setDraggingJobNumber(jobNumber);
    event.dataTransfer.setData('text/plain', jobNumber);
    event.dataTransfer.effectAllowed = 'move';
  }

  function moveCalendar(direction: -1 | 1) {
    const anchor = parseLocalDate(calendarAnchorDate);
    const nextDate =
      calendarView === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (calendarView === 'week' ? 7 : 1));

    setCalendarAnchorDate(toLocalIsoDate(nextDate));
  }

  function showTodayInCalendar() {
    setCalendarAnchorDate(toLocalIsoDate(new Date()));
  }

  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {
    event.preventDefault();
    if (stopCalendarWrite('moving calendar appointments')) return;

    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;
    const appointment = calendarAppointmentFromParts(dayKey, slotKey, calendarDropSlots);
    const durationMinutes = calendarAssignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [jobNumber]: {
        assignee,
        dayKey,
        time: slotKey,
        durationMinutes,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === jobNumber ? { ...job, technician: assignee, appointment } : job);
    persistCalendarAssignment(jobNumber, assignee, dayKey, slotKey, durationMinutes);
    setDraggingJobNumber('');
  }

  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {
    event.preventDefault();
    if (stopCalendarWrite('moving calendar appointments')) return;

    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;

    setMonthDropRequest({
      jobNumber,
      assignee,
      dayKey,
      time: movedJob?.time ?? '9 AM:00',
      durationMinutes: calendarAssignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120,
    });
    setDraggingJobNumber('');
  }

  function confirmCalendarMonthDrop() {
    if (stopCalendarWrite('saving calendar appointments')) return;
    if (!monthDropRequest) return;
    const appointment = calendarAppointmentFromParts(monthDropRequest.dayKey, monthDropRequest.time, calendarDropSlots);

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [monthDropRequest.jobNumber]: {
        assignee: monthDropRequest.assignee,
        dayKey: monthDropRequest.dayKey,
        time: monthDropRequest.time,
        durationMinutes: monthDropRequest.durationMinutes,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === monthDropRequest.jobNumber ? { ...job, technician: monthDropRequest.assignee, appointment } : job);
    persistCalendarAssignment(
      monthDropRequest.jobNumber,
      monthDropRequest.assignee,
      monthDropRequest.dayKey,
      monthDropRequest.time,
      monthDropRequest.durationMinutes,
    );
    setMonthDropRequest(null);
  }

  function handleCalendarResizeStart(
    event: PointerEvent<HTMLSpanElement>,
    job: { jobNumber: string; assignee: string; dayKey?: string; time?: string; durationMinutes: number },
    edge: 'start' | 'end',
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (stopCalendarWrite('resizing calendar appointments')) return;

    if (!job.dayKey || !job.time) return;
    const startSlotIndex = calendarDropSlots.findIndex((slot) => slot.key === job.time);
    if (startSlotIndex < 0) return;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [job.jobNumber]: assignments[job.jobNumber] ?? {
        assignee: job.assignee,
        dayKey: job.dayKey ?? '',
        time: job.time ?? '',
        durationMinutes: job.durationMinutes,
      },
    }));
    setResizingJob({
      jobNumber: job.jobNumber,
      assignee: job.assignee,
      dayKey: job.dayKey,
      time: job.time,
      edge,
      startY: event.clientY,
      startDuration: job.durationMinutes,
      startSlotIndex,
    });
  }

  return {
    handleCalendarDragStart,
    moveCalendar,
    showTodayInCalendar,
    handleCalendarDrop,
    handleCalendarMonthDrop,
    confirmCalendarMonthDrop,
    handleCalendarResizeStart,
  };
}
