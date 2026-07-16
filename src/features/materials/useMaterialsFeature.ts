import { useState } from 'react';
import { emptyMaterialDraft } from '../../appTypes';
import type { MaterialRow, ServiceJobStatus } from '../../types';

export type MaterialJobStatusFilter = 'active' | 'all' | ServiceJobStatus;

export function isReturnedWarehouseMaterial(material: MaterialRow) {
  return (material.sourceType === 'warehouse' || Boolean(material.inventoryMovementId))
    && material.status === 'Returned';
}

export function normalizeMaterialRows(jobNumber: string, rows: MaterialRow[]) {
  return rows
    .filter((row) => row.name.trim() || row.supplier.trim())
    .map((row) => ({
      ...row,
      jobNumber,
      name: row.name.trim(),
      supplier: row.supplier.trim(),
      quantity: row.sourceType === 'warehouse' || row.inventoryMovementId
        ? Math.max(0, Number(row.quantity) || 0)
        : Math.max(1, Number(row.quantity) || 1),
      price: Math.max(0, Number(row.price) || 0),
    }));
}

export function useMaterialsFeature(initialRows: MaterialRow[]) {
  const [materials, setMaterials] = useState<MaterialRow[]>(initialRows);
  const [materialJobStatusFilter, setMaterialJobStatusFilter] = useState<MaterialJobStatusFilter>('active');
  const [materialStatusFilter, setMaterialStatusFilter] = useState<'all' | MaterialRow['status']>('all');
  const [materialTechFilter, setMaterialTechFilter] = useState('all');
  const [materialSearch, setMaterialSearch] = useState('');
  const [editingMaterialsJobNumber, setEditingMaterialsJobNumber] = useState('');
  const [materialDraftRows, setMaterialDraftRows] = useState<MaterialRow[]>([]);

  const resetMaterialFilters = () => {
    setMaterialJobStatusFilter('active');
    setMaterialStatusFilter('all');
    setMaterialTechFilter('all');
    setMaterialSearch('');
  };

  const openMaterialEditor = (jobNumber: string) => {
    const existingRows = materials.filter((material) => material.jobNumber === jobNumber && !isReturnedWarehouseMaterial(material));
    setEditingMaterialsJobNumber(jobNumber);
    setMaterialDraftRows(existingRows.length ? existingRows.map((material) => ({ ...material })) : [emptyMaterialDraft(jobNumber)]);
  };

  const closeMaterialEditor = () => {
    setEditingMaterialsJobNumber('');
    setMaterialDraftRows([]);
  };

  const updateMaterialDraft = (rowId: string, patch: Partial<MaterialRow>) => {
    setMaterialDraftRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const addMaterialDraftRow = () => {
    if (!editingMaterialsJobNumber) return;
    setMaterialDraftRows((rows) => [...rows, emptyMaterialDraft(editingMaterialsJobNumber)]);
  };

  const removeMaterialDraftRow = (rowId: string) => {
    setMaterialDraftRows((rows) => rows.filter((row) => row.id !== rowId));
  };

  return {
    materials,
    setMaterials,
    materialJobStatusFilter,
    setMaterialJobStatusFilter,
    materialStatusFilter,
    setMaterialStatusFilter,
    materialTechFilter,
    setMaterialTechFilter,
    materialSearch,
    setMaterialSearch,
    editingMaterialsJobNumber,
    materialDraftRows,
    setMaterialDraftRows,
    resetMaterialFilters,
    openMaterialEditor,
    closeMaterialEditor,
    updateMaterialDraft,
    addMaterialDraftRow,
    removeMaterialDraftRow,
  };
}
