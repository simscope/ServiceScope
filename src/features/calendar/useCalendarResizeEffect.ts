import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CalendarDropSlot } from './calendarModel';
import type { CalendarAssignment, CalendarResizeState } from './useCalendarFeature';

type CalendarResizeInput = {
  resizingJob: CalendarResizeState | null;
  calendarDropSlotsRef: MutableRefObject<CalendarDropSlot[]>;
  setCalendarAssignments: Dispatch<SetStateAction<Record<string, CalendarAssignment>>>;
  setResizingJob: Dispatch<SetStateAction<CalendarResizeState | null>>;
  persistCalendarAssignmentRef: MutableRefObject<(
    jobNumber: string,
    assignee: string,
    dayKey: string,
    slotKey: string,
    durationMinutes: number,
  ) => void>;
};

export function useCalendarResizeEffect({
  resizingJob,
  calendarDropSlotsRef,
  setCalendarAssignments,
  setResizingJob,
  persistCalendarAssignmentRef,
}: CalendarResizeInput) {
  useEffect(() => {
    if (!resizingJob) return undefined;
    const activeResize = resizingJob;

    function getResizedAssignment(clientY: number) {
      const calendarDropSlots = calendarDropSlotsRef.current;
      const deltaSlots = Math.round((clientY - activeResize.startY) / 32);
      const startDurationSlots = Math.max(1, Math.round(activeResize.startDuration / 30));
      const lastStartSlot = Math.max(0, activeResize.startSlotIndex + startDurationSlots - 1);
      const maxDurationSlots = Math.max(1, calendarDropSlots.length - activeResize.startSlotIndex);
      let nextSlotIndex = activeResize.startSlotIndex;
      let durationSlots = startDurationSlots;

      if (activeResize.edge === 'start') {
        nextSlotIndex = Math.min(lastStartSlot, Math.max(0, activeResize.startSlotIndex + deltaSlots));
        durationSlots = startDurationSlots + (activeResize.startSlotIndex - nextSlotIndex);
      } else {
        durationSlots = Math.min(maxDurationSlots, Math.max(1, startDurationSlots + deltaSlots));
      }

      const nextSlot = calendarDropSlots[nextSlotIndex];

      return {
        durationMinutes: durationSlots * 30,
        time: nextSlot?.key ?? activeResize.time,
      };
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const resized = getResizedAssignment(event.clientY);

      setCalendarAssignments((assignments) => {
        const assignment = assignments[activeResize.jobNumber] ?? {
          assignee: activeResize.assignee,
          dayKey: activeResize.dayKey,
          time: activeResize.time,
          durationMinutes: activeResize.startDuration,
        };

        return {
          ...assignments,
          [activeResize.jobNumber]: {
            ...assignment,
            time: resized.time,
            durationMinutes: resized.durationMinutes,
          },
        };
      });
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const resized = getResizedAssignment(event.clientY);
      persistCalendarAssignmentRef.current(
        activeResize.jobNumber,
        activeResize.assignee,
        activeResize.dayKey,
        resized.time,
        resized.durationMinutes,
      );
      setResizingJob(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingJob, calendarDropSlotsRef, persistCalendarAssignmentRef, setCalendarAssignments, setResizingJob]);
}
