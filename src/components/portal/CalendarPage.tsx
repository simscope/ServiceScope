import type { DragEvent, PointerEvent } from 'react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { CompanyOnboardingProfile, CompanyPaymentMethod, MaterialRow, ServiceJobStatus } from '../../types';
import { googleRouteUrl, statusClassName } from '../../utils/format';

type CalendarDay = {
  key: string;
  label: string;
  date: string;
  isoDate: string;
  day: number;
  month: number;
};

type CalendarSlot = {
  key: string;
  label: string;
  hour: number;
  minute: number;
};

type CalendarJob = JobCardData & {
  dayKey?: string;
  time?: string;
  durationMinutes: number;
};

type MonthDropRequest = {
  jobNumber: string;
  assignee: string;
  dayKey: string;
  durationMinutes: number;
  time: string;
};

export function CalendarPage({
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  calendarRangeTitle,
  onMoveCalendar,
  onShowToday,
  activeCalendarTech,
  onActiveCalendarTechChange,
  calendarView,
  onCalendarViewChange,
  unassignedCalendarJobs,
  onCalendarDragStart,
  onOpenJob,
  calendarMonthDays,
  visibleCalendarJobs,
  calendarAnchor,
  onCalendarMonthDrop,
  visibleCalendarDays,
  calendarSlots,
  calendarDropSlots,
  onCalendarDrop,
  onCalendarResizeStart,
  jobStatusFilters,
  monthDropRequest,
  allCalendarDays,
  onMonthDropRequestChange,
  onConfirmCalendarMonthDrop,
}: {
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  calendarRangeTitle: string;
  onMoveCalendar: (direction: -1 | 1) => void;
  onShowToday: () => void;
  activeCalendarTech: string;
  onActiveCalendarTechChange: (technician: string) => void;
  calendarView: 'month' | 'week' | 'day';
  onCalendarViewChange: (view: 'month' | 'week' | 'day') => void;
  unassignedCalendarJobs: CalendarJob[];
  onCalendarDragStart: (event: DragEvent<HTMLElement>, jobNumber: string) => void;
  onOpenJob: (job: CalendarJob) => void;
  calendarMonthDays: CalendarDay[];
  visibleCalendarJobs: CalendarJob[];
  calendarAnchor: Date;
  onCalendarMonthDrop: (event: DragEvent<HTMLDivElement>, dayKey: string) => void;
  visibleCalendarDays: CalendarDay[];
  calendarSlots: string[];
  calendarDropSlots: CalendarSlot[];
  onCalendarDrop: (event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) => void;
  onCalendarResizeStart: (event: PointerEvent<HTMLElement>, job: CalendarJob) => void;
  jobStatusFilters: ServiceJobStatus[];
  monthDropRequest: MonthDropRequest | null;
  allCalendarDays: CalendarDay[];
  onMonthDropRequestChange: (request: MonthDropRequest | null) => void;
  onConfirmCalendarMonthDrop: () => void;
}) {
  if (openedJob) {
    return (
      <section className="calendar-page">
        <JobDetailPanel
          job={openedJob}
          technicians={profile.technicians.map((technician) => technician.name)}
          systems={profile.jobTypes.map((jobType) => jobType.name)}
          paymentMethods={paymentMethodOptions}
          materials={materials.filter((material) => material.jobNumber === openedJob.jobNumber)}
          currentUser={currentPortalUser}
          onClose={onCloseJob}
          onSave={onSaveJob}
          onSaveMaterials={onSaveMaterials}
        />
      </section>
    );
  }

  return (
    <section className="calendar-page">
      <div className="calendar-header">
        <div>
          <p className="eyebrow">Dispatch calendar</p>
          <h1>Calendar</h1>
          <p className="calendar-range-title">{calendarRangeTitle}</p>
        </div>
        <div className="calendar-controls">
          <div className="calendar-nav-buttons" aria-label="Calendar navigation">
            <button type="button" onClick={() => onMoveCalendar(-1)} aria-label="Previous period">
              &lt;
            </button>
            <button type="button" onClick={onShowToday}>
              Today
            </button>
            <button type="button" onClick={() => onMoveCalendar(1)} aria-label="Next period">
              &gt;
            </button>
          </div>
          <select value={activeCalendarTech} onChange={(event) => onActiveCalendarTechChange(event.target.value)}>
            <option value="all">All technicians</option>
            {profile.technicians.map((technician) => (
              <option value={technician.name} key={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
          <input placeholder="Search job, client, address" />
          <div className="calendar-view-toggle" aria-label="Calendar view">
            {(['month', 'week', 'day'] as const).map((view) => (
              <button className={calendarView === view ? 'active' : ''} type="button" onClick={() => onCalendarViewChange(view)} key={view}>
                {view}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="calendar-unassigned">
        <div>
          <h2>Unassigned</h2>
          <p>{activeCalendarTech === 'all' ? 'Select a technician before assigning unassigned jobs. Scheduled jobs can be moved between days and times.' : `Drag jobs onto ${activeCalendarTech}'s calendar.`}</p>
        </div>
        <div className="unassigned-job-list">
          {unassignedCalendarJobs.map((job) => (
            <button
              className="unassigned-job-card"
              type="button"
              draggable
              onDragStart={(event) => onCalendarDragStart(event, job.jobNumber)}
              onDoubleClick={() => onOpenJob(job)}
              key={job.jobNumber}
            >
              <strong>#{job.jobNumber} - {job.organization}</strong>
              <span>{job.issue}</span>
            </button>
          ))}
          {unassignedCalendarJobs.length === 0 ? <span className="empty-inline">No unassigned jobs.</span> : null}
        </div>
      </section>

      <div className="calendar-tech-tabs">
        <button className={activeCalendarTech === 'all' ? 'active' : ''} type="button" onClick={() => onActiveCalendarTechChange('all')}>
          All techs
        </button>
        {profile.technicians.map((technician) => (
          <button className={activeCalendarTech === technician.name ? 'active' : ''} type="button" onClick={() => onActiveCalendarTechChange(technician.name)} key={technician.id}>
            {technician.name}
          </button>
        ))}
      </div>

      {calendarView === 'month' ? (
        <div className="calendar-month-grid">
          {calendarMonthDays.map((calendarDay) => {
            const jobs = visibleCalendarJobs.filter((job) => job.dayKey === calendarDay.key);

            return (
              <div
                className={`calendar-month-day drop-enabled ${calendarDay.month !== calendarAnchor.getMonth() ? 'outside-month' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  onCalendarMonthDrop(event, calendarDay.key);
                }}
                key={calendarDay.key}
              >
                <strong>{calendarDay.day}</strong>
                {jobs.slice(0, 2).map((job) => (
                  <button
                    className={`calendar-month-job ${statusClassName(job.status)} ${!job.scfPayment ? 'unpaid' : ''}`}
                    type="button"
                    draggable
                    onDragStart={(event) => onCalendarDragStart(event, job.jobNumber)}
                    onDoubleClick={() => onOpenJob(job)}
                    key={job.jobNumber}
                  >
                    #{job.jobNumber} {job.organization}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="calendar-board" style={{ gridTemplateColumns: `76px repeat(${visibleCalendarDays.length}, minmax(180px, 1fr))` }}>
          <div className="calendar-corner">Time</div>
          {visibleCalendarDays.map((day) => {
            const dayJobs = visibleCalendarJobs.filter((job) => job.dayKey === day.key);
            const routeUrl = googleRouteUrl(dayJobs.map((job) => job.address));

            return (
              <div className="calendar-day-head" key={day.key}>
                <strong>{day.label}</strong>
                <span>{day.date}</span>
                {routeUrl ? (
                  <a className="calendar-route-link" href={routeUrl} target="_blank" rel="noreferrer">
                    Route
                  </a>
                ) : null}
              </div>
            );
          })}
          <div className="calendar-time-column">
            {calendarSlots.map((slot) => (
              <div className="calendar-time-cell" key={slot}>{slot}</div>
            ))}
          </div>
          {visibleCalendarDays.map((day) => {
            const jobs = visibleCalendarJobs.filter((job) => job.dayKey === day.key);

            return (
              <div className="calendar-day-column" key={day.key}>
                <div className="calendar-day-grid-lines">
                  {calendarSlots.map((slot) => (
                    <div className="calendar-slot-line" key={slot} />
                  ))}
                </div>
                <div className="calendar-drop-grid">
                  {calendarDropSlots.map((slot) => (
                    <div
                      className="calendar-drop-slot"
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => onCalendarDrop(event, day.key, slot.key)}
                      title={slot.label}
                      key={slot.key}
                    />
                  ))}
                </div>
                {jobs.map((job) => {
                  const startIndex = Math.max(0, calendarDropSlots.findIndex((slot) => slot.key === job.time));
                  const startTop = startIndex * 32 + 6;

                  return (
                    <button
                      className={`calendar-job-card ${statusClassName(job.status)} ${!job.scfPayment ? 'unpaid' : ''}`}
                      type="button"
                      draggable
                      style={{
                        top: `${startTop}px`,
                        height: `${Math.max(54, (job.durationMinutes / 60) * 64 - 10)}px`,
                      }}
                      onDragStart={(event) => onCalendarDragStart(event, job.jobNumber)}
                      onDoubleClick={() => onOpenJob(job)}
                      key={job.jobNumber}
                    >
                      <span>{calendarDropSlots.find((slot) => slot.key === job.time)?.label ?? job.time}</span>
                      <strong>#{job.jobNumber} {job.organization}</strong>
                      <small>{job.address}</small>
                      <em>{job.technician}</em>
                      <span
                        className="calendar-resize-handle"
                        onPointerDown={(event) => onCalendarResizeStart(event, job)}
                        aria-label={`Resize job ${job.jobNumber}`}
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="calendar-legend">
        {jobStatusFilters.filter((status) => status !== 'Warranty').map((status) => (
          <span className={`calendar-legend-item ${statusClassName(status)}`} key={status}>
            {status}
          </span>
        ))}
        <p>Unpaid jobs use a dashed border.</p>
      </div>

      {monthDropRequest ? (
        <div className="calendar-modal-backdrop" role="dialog" aria-modal="true" aria-label="Schedule job time">
          <div className="calendar-time-modal">
            <h2>Set appointment time</h2>
            <p>
              Job #{monthDropRequest.jobNumber} for {allCalendarDays.find((day) => day.key === monthDropRequest.dayKey)?.date}
            </p>
            <label>
              Time
              <select value={monthDropRequest.time} onChange={(event) => onMonthDropRequestChange({ ...monthDropRequest, time: event.target.value })}>
                {calendarDropSlots.map((slot) => (
                  <option value={slot.key} key={slot.key}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="calendar-time-modal-actions">
              <button className="secondary-button compact" type="button" onClick={() => onMonthDropRequestChange(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={onConfirmCalendarMonthDrop}>
                Set appointment
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
