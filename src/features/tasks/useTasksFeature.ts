import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { TaskForm, TaskRow, TaskStatus, TaskStatusFilter } from '../../appTypes';
import type { MaterialRow, ServiceJob } from '../../types';
import { emptyTaskForm } from '../../appSeeds';
import {
  createManualTask as createManualTaskInBackend,
  listCompletedAutoTaskKeys,
  listManualTasks,
  saveAutoTaskStatus,
  updateManualTaskStatus,
} from './api';

type UseTasksFeatureParams = {
  companyId: string;
  jobs: ServiceJob[];
  materials: MaterialRow[];
  technicianNames: string[];
  canWrite: boolean;
  readOnlyMessage: string;
  setStatus: (message: string) => void;
};

export function useTasksFeature({
  companyId,
  jobs,
  materials,
  technicianNames,
  canWrite,
  readOnlyMessage,
  setStatus,
}: UseTasksFeatureParams) {
  const [manualTasks, setManualTasks] = useState<TaskRow[]>([]);
  const [completedAutoTaskIds, setCompletedAutoTaskIds] = useState<string[]>([]);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>('active');
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');

  useEffect(() => {
    if (!companyId) {
      setManualTasks([]);
      setCompletedAutoTaskIds([]);
      return undefined;
    }

    let cancelled = false;
    Promise.all([listManualTasks(companyId, jobs), listCompletedAutoTaskKeys(companyId)])
      .then(([tasks, completedAutoKeys]) => {
        if (cancelled) return;
        setManualTasks(tasks);
        setCompletedAutoTaskIds(completedAutoKeys);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load manual tasks', error);
        setManualTasks([]);
        setStatus(error instanceof Error ? error.message : 'Tasks could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, jobs, setStatus]);

  const jobMap = useMemo(() => new globalThis.Map(jobs.map((job) => [job.jobNumber, job])), [jobs]);

  const autoTasks = useMemo(() => jobs.flatMap((job) => {
    const rows: TaskRow[] = [];
    const jobMaterials = materials.filter((material) => material.jobNumber === job.jobNumber);
    const isClosedJob = job.status === 'Completed' || job.status === 'Cancelled' || job.status === 'Archived';
    const dueDate = job.appointment?.slice(0, 10) || job.createdAt;

    if (!job.scfPayment) {
      rows.push({
        id: `auto-${job.jobNumber}-scf`,
        title: 'Collect SCF payment',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Office' : job.assignee,
        dueDate,
        priority: 'Urgent',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-scf`) ? 'Done' : 'To do',
        notes: 'Service call fee is still unpaid.',
        source: 'Auto',
      });
    }

    if (!isClosedJob && job.assignee === 'No technician') {
      rows.push({
        id: `auto-${job.jobNumber}-assign-tech`,
        title: 'Assign technician',
        jobNumber: job.jobNumber,
        assignedTo: 'Dispatcher',
        dueDate,
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-assign-tech`) ? 'Done' : 'To do',
        notes: 'Job is active but has no technician.',
        source: 'Auto',
      });
    }

    if (!isClosedJob && jobMaterials.some((material) => material.status === 'Needed')) {
      rows.push({
        id: `auto-${job.jobNumber}-order-parts`,
        title: 'Order required parts',
        jobNumber: job.jobNumber,
        assignedTo: 'Office',
        dueDate,
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-order-parts`) ? 'Done' : 'To do',
        notes: 'One or more materials are marked as needed.',
        source: 'Auto',
      });
    }

    if (!isClosedJob && jobMaterials.some((material) => material.status === 'Received')) {
      rows.push({
        id: `auto-${job.jobNumber}-return-visit`,
        title: 'Schedule return visit',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Dispatcher' : job.assignee,
        dueDate,
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-return-visit`) ? 'Done' : 'To do',
        notes: 'Parts are received and the job is not completed yet.',
        source: 'Auto',
      });
    }

    return rows;
  }), [completedAutoTaskIds, jobs, materials]);

  const taskRows = useMemo(() => [...autoTasks, ...manualTasks], [autoTasks, manualTasks]);

  const filteredTaskRows = useMemo(() => taskRows.filter((task) => {
    const job = jobMap.get(task.jobNumber);
    const normalizedSearch = taskSearch.trim().toLowerCase();
    const haystack = [task.title, task.jobNumber, task.assignedTo, task.notes, job?.organization, job?.clientName, job?.issue]
      .join(' ')
      .toLowerCase();
    const matchesStatus = taskStatusFilter === 'active'
      ? task.status !== 'Done'
      : taskStatusFilter === 'all' || task.status === taskStatusFilter;
    const matchesOwner = taskOwnerFilter === 'all' || task.assignedTo === taskOwnerFilter;

    return matchesStatus && matchesOwner && (!normalizedSearch || haystack.includes(normalizedSearch));
  }), [jobMap, taskOwnerFilter, taskRows, taskSearch, taskStatusFilter]);

  const taskAssignees = useMemo(
    () => Array.from(new Set(['Office', 'Dispatcher', ...technicianNames, ...taskRows.map((task) => task.assignedTo)])).filter(Boolean),
    [taskRows, technicianNames],
  );

  const openTaskCount = taskRows.filter((task) => task.status !== 'Done').length;
  const autoTaskCount = autoTasks.filter((task) => task.status !== 'Done').length;
  const urgentTaskCount = taskRows.filter((task) => task.priority === 'Urgent' && task.status !== 'Done').length;

  const createManualTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite) {
      setStatus(`${readOnlyMessage} creating tasks.`);
      return;
    }
    if (!companyId || !taskForm.title.trim()) return;

    setStatus('Saving task...');
    createManualTaskInBackend(companyId, taskForm, jobs)
      .then((task) => {
        setManualTasks((tasks) => [task, ...tasks]);
        setTaskForm(emptyTaskForm);
        setStatus('Task saved.');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Task could not be saved.');
      });
  };

  const updateTaskStatus = (task: TaskRow, status: TaskStatus) => {
    if (!canWrite) {
      setStatus(`${readOnlyMessage} updating tasks.`);
      return;
    }

    if (task.source === 'Auto') {
      const previousIds = completedAutoTaskIds;
      setCompletedAutoTaskIds((ids) => (status === 'Done' ? Array.from(new Set([...ids, task.id])) : ids.filter((id) => id !== task.id)));
      saveAutoTaskStatus(companyId, task, status, jobs)
        .then(() => setStatus('Task updated.'))
        .catch((error) => {
          setCompletedAutoTaskIds(previousIds);
          setStatus(error instanceof Error ? error.message : 'Task could not be updated.');
        });
      return;
    }

    setManualTasks((tasks) => tasks.map((row) => (row.id === task.id ? { ...row, status } : row)));
    updateManualTaskStatus(companyId, task.id, status, jobs)
      .then((savedTask) => {
        setManualTasks((tasks) => tasks.map((row) => (row.id === savedTask.id ? savedTask : row)));
        setStatus('Task updated.');
      })
      .catch((error) => {
        setManualTasks((tasks) => tasks.map((row) => (row.id === task.id ? task : row)));
        setStatus(error instanceof Error ? error.message : 'Task could not be updated.');
      });
  };

  const resetTaskFilters = () => {
    setTaskStatusFilter('active');
    setTaskOwnerFilter('all');
    setTaskSearch('');
  };

  return {
    taskForm,
    setTaskForm,
    createManualTask,
    taskAssignees,
    taskStatusFilter,
    setTaskStatusFilter,
    taskOwnerFilter,
    setTaskOwnerFilter,
    taskSearch,
    setTaskSearch,
    resetTaskFilters,
    filteredTaskRows,
    jobMap,
    updateTaskStatus,
    openTaskCount,
    autoTaskCount,
    urgentTaskCount,
  };
}
