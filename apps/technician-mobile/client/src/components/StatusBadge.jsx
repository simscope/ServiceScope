import { STATUS_COLORS, STATUS_LABELS } from '../constants/statuses';

export default function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 ring-gray-200';
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colors}`}>
      {label}
    </span>
  );
}
