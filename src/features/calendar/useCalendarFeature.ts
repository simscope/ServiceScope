import { useState } from 'react';
import { toLocalIsoDate } from '../../utils/calendar';

export type CalendarView = 'month' | 'week' | 'day';

export type CalendarAssignment = {
  assignee: string;
  dayKey: string;
  time: string;
  durationMinutes: number;
};

export type CalendarResizeState = Omit<CalendarAssignment, 'durationMinutes'> & {
  jobNumber: string;
  edge: 'start' | 'end';
  startY: number;
  startDuration: number;
  startSlotIndex: number;
};

export type MonthDropRequest = CalendarAssignment & {
  jobNumber: string;
};

export function useCalendarFeature() {
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => toLocalIsoDate(new Date()));
  const [activeCalendarTech, setActiveCalendarTech] = useState('all');
  const [calendarAssignments, setCalendarAssignments] = useState<Record<string, CalendarAssignment>>({});
  const [draggingJobNumber, setDraggingJobNumber] = useState('');
  const [resizingJob, setResizingJob] = useState<CalendarResizeState | null>(null);
  const [monthDropRequest, setMonthDropRequest] = useState<MonthDropRequest | null>(null);

  return {
    calendarView,
    setCalendarView,
    calendarAnchorDate,
    setCalendarAnchorDate,
    activeCalendarTech,
    setActiveCalendarTech,
    calendarAssignments,
    setCalendarAssignments,
    draggingJobNumber,
    setDraggingJobNumber,
    resizingJob,
    setResizingJob,
    monthDropRequest,
    setMonthDropRequest,
  };
}
