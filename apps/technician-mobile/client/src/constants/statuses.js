export const STATUS = {
  RECALL: 'recall',
  DIAGNOSTICS: 'diagnostics',
  IN_PROGRESS: 'in_progress',
  PARTS_ORDERED: 'parts_ordered',
  WAITING_PARTS: 'waiting_parts',
  TO_FINISH: 'to_finish',
  FINISHED: 'finished',
};

export const STATUS_ORDER = [
  STATUS.RECALL,
  STATUS.DIAGNOSTICS,
  STATUS.TO_FINISH,
  STATUS.WAITING_PARTS,
  STATUS.PARTS_ORDERED,
  STATUS.IN_PROGRESS,
  STATUS.FINISHED,
];

export const STATUS_LABELS = {
  [STATUS.RECALL]: 'ReCall',
  [STATUS.DIAGNOSTICS]: 'Диагностика',
  [STATUS.IN_PROGRESS]: 'В работе',
  [STATUS.PARTS_ORDERED]: 'Заказ деталей',
  [STATUS.WAITING_PARTS]: 'Ожидание',
  [STATUS.TO_FINISH]: 'К финишу',
  [STATUS.FINISHED]: 'Завершено',
};

// Классы Tailwind для бейджа статуса
export const STATUS_COLORS = {
  [STATUS.RECALL]: 'bg-red-100 text-red-700 ring-red-300',
  [STATUS.DIAGNOSTICS]: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  [STATUS.TO_FINISH]: 'bg-amber-50 text-amber-700 ring-amber-200',
  [STATUS.WAITING_PARTS]: 'bg-violet-50 text-violet-700 ring-violet-200',
  [STATUS.PARTS_ORDERED]: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  [STATUS.IN_PROGRESS]: 'bg-sky-50 text-sky-700 ring-sky-200',
  [STATUS.FINISHED]: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
