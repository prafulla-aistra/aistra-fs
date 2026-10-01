import type { TableBlockDto } from '@finance-close/shared';

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const newTableBlock = (): TableBlockDto => ({
  id: newId(),
  type: 'TABLE',
  label: '',
  columns: [
    { id: newId(), label: 'Nature', numeric: false, period: null },
    { id: newId(), label: '', numeric: true, period: 'CURRENT' },
    { id: newId(), label: '', numeric: true, period: 'COMPARATIVE' },
  ],
  rows: [{ id: newId(), cells: {} }],
  mode: 'MEMO',
  agreeLine: null,
});

export const newTextBlock = () => ({
  id: newId(),
  type: 'TEXT' as const,
  label: '',
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
});
