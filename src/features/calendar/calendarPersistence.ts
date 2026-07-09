import type { Dispatch, SetStateAction } from 'react';
import type { ServiceJob } from '../../types';
import { saveJobAppointment } from '../../services/jobsStore';
import { calendarAppointmentFromParts } from './calendarActions';
import type { CalendarDropSlot } from './calendarModel';
import type { CalendarAssignment } from './useCalendarFeature';

type CalendarPersistenceInput = {
  companyId: string;
  jobs: ServiceJob[];
  calendarDropSlots: CalendarDropSlot[];
  setJobs: Dispatch<SetStateAction<ServiceJob[]>>;
  setOpenedJob: Dispatch<SetStateAction<ServiceJob | null>>;
  setCalendarAssignments: Dispatch<SetStateAction<Record<string, CalendarAssignment>>>;
  setStatus: Dispatch<SetStateAction<string>>;
  stopCalendarWrite: (action: string) => boolean;
};

export function makeCalendarPersistence({
  companyId,
  jobs,
  calendarDropSlots,
  setJobs,
  setOpenedJob,
  setCalendarAssignments,
  setStatus,
  stopCalendarWrite,
}: CalendarPersistenceInput) {
  function persistCalendarAssignment(jobNumber: string, assignee: string, dayKey: string, slotKey: string, durationMinutes: number) {
    if (stopCalendarWrite('saving calendar appointments')) return;

    const baseJob = jobs.find((job) => job.jobNumber === jobNumber);
    const appointment = calendarAppointmentFromParts(dayKey, slotKey, calendarDropSlots);
    if (!baseJob || !appointment) return;

    const nextJob = {
      ...baseJob,
      technician: assignee,
      assignee,
      appointment,
      calendarDurationMinutes: durationMinutes,
    };

    setJobs((currentJobs) => currentJobs.map((job) => (job.id === nextJob.id ? nextJob : job)));
    setOpenedJob((job) => job?.id === nextJob.id ? { ...job, ...nextJob } : job);
    setStatus('Saving calendar appointment...');

    saveJobAppointment(companyId, nextJob, appointment, durationMinutes)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === savedJob.id ? savedJob : job)));
        setOpenedJob((job) => job?.id === savedJob.id ? { ...job, ...savedJob } : job);
        setCalendarAssignments((assignments) => ({
          ...assignments,
          [savedJob.jobNumber]: {
            assignee: savedJob.assignee,
            dayKey,
            time: slotKey,
            durationMinutes: savedJob.calendarDurationMinutes ?? durationMinutes,
          },
        }));
        setStatus('Calendar appointment saved.');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Calendar appointment could not be saved.');
      });
  }

  return {
    persistCalendarAssignment,
  };
}
