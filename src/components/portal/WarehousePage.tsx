import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Box, Boxes, ChevronDown, Droplet, Fan, Folder, Forklift, GripVertical, History, Home, MapPin, Package, Pencil, Plus, Settings, Snowflake, Trash2, Truck, Utensils, Warehouse, Wrench, Zap } from 'lucide-react';
import {
  cancelInventoryReceipt,
  createInventoryCategory,
  createInventoryItem,
  createInventoryReceipt,
  createInventoryReceiptLine,
  createInventorySupplier,
  createInventoryWarehouse,
  deleteInventoryCategory,
  deleteInventoryReceiptLine,
  importInventoryProductUrl,
  issueInventoryPartToJob,
  listWarehouseSnapshot,
  moveInventoryStock,
  normalizeSupplierUrl,
  postInventoryReceipt,
  receiveImportedProductToStock,
  reorderInventoryCategories,
  returnInventoryJobPart,
  setInventoryItemCategory,
  updateInventoryCategory,
  updateInventoryReceipt,
  updateInventoryReceiptLine,
  warehouseErrorMessage,
  type ImportedInventoryProduct,
  type InventoryCategory,
  type InventoryCategoryDraft,
  type InventoryItem,
  type InventoryItemDraft,
  type InventoryReceiptDraft,
  type InventoryReceiptLineDraft,
  type InventoryMoveDraft,
  type InventorySupplierDraft,
  type InventoryWarehouseDraft,
  type InventoryJobIssueDraft,
  type InventoryJobReturnDraft,
  type InventoryStockReceipt,
  type InventoryStockReceiptLine,
  type WarehouseSnapshot,
} from '../../services/warehouseStore';
import { money } from '../../utils/format';

type WarehouseTab = 'parts' | 'purchases' | 'activity' | 'settings';

type WarehousePageProps = {
  companyId: string;
  onMaterialsChanged?: () => Promise<void> | void;
};

type WarehouseFormMode = 'none' | 'warehouse' | 'item' | 'supplier' | 'stock' | 'jobIssue' | 'jobReturn' | 'move';
type PartsStatusFilter = 'all' | 'in' | 'low' | 'out';
type ActivityFilter = 'all' | 'received' | 'used' | 'moved' | 'adjustments';

const emptySnapshot: WarehouseSnapshot = {
  warehouses: [],
  bins: [],
  items: [],
  categories: [],
  suppliers: [],
  supplierLinks: [],
  jobs: [],
  stockBalances: [],
  movements: [],
  receipts: [],
  receiptLines: [],
};

const emptyWarehouseDraft: InventoryWarehouseDraft = {
  name: '',
  type: 'main',
  location: '',
  technicianId: null,
  notes: '',
};

const emptyItemDraft: InventoryItemDraft = {
  internalName: '',
  category: '',
  categoryId: null,
  manufacturer: '',
  oem: '',
  partNumber: '',
  alternatePartNumber: '',
  description: '',
  unit: 'pcs',
  minimumQuantity: 0,
  notes: '',
};

const emptyCategoryDraft: InventoryCategoryDraft = {
  name: '',
  parentId: null,
  icon: '',
};

const categoryIconOptions = ['snowflake', 'home', 'utensils', 'forklift', 'zap', 'wrench', 'box', 'droplet', 'fan', 'settings'] as const;

const emptySupplierDraft: InventorySupplierDraft = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  address: '',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyReceiptDraft = (): InventoryReceiptDraft => ({
  supplierId: null,
  warehouseId: '',
  binId: null,
  receiptDate: todayIso(),
  poNumber: '',
  invoiceNumber: '',
  notes: '',
});

const emptyReceiptLineDraft = (receiptId = ''): InventoryReceiptLineDraft => ({
  receiptId,
  itemId: '',
  quantity: 1,
  unitCost: 0,
  extraCost: 0,
  currency: 'USD',
});

const tabs: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'parts', label: 'Parts' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
];

const emptyQuickStockDraft = () => ({
  itemId: '',
  quantity: 1,
  unitCost: 0,
  warehouseId: '',
  supplierId: '',
  binId: '',
  extraCost: 0,
  invoiceNumber: '',
  poNumber: '',
  receiptDate: todayIso(),
  notes: '',
  showMore: false,
});

type ProductImportDraft = {
  idempotencyKey: string;
  productUrl: string;
  preview: ImportedInventoryProduct | null;
  matchItemId: string;
  weakMatchItemIds: string[];
  createNewPart: boolean;
  packagesReceived: number;
  unitsPerPackage: number;
  packagePrice: number;
  shippingCost: number;
  taxCost: number;
  otherCost: number;
  supplierName: string;
  sourceUrl: string;
  categoryId: string | null;
  verified: boolean;
};

const emptyProductImportDraft = (): ProductImportDraft => ({
  idempotencyKey: crypto.randomUUID(),
  productUrl: '',
  preview: null,
  matchItemId: '',
  weakMatchItemIds: [],
  createNewPart: false,
  packagesReceived: 1,
  unitsPerPackage: 1,
  packagePrice: 0,
  shippingCost: 0,
  taxCost: 0,
  otherCost: 0,
  supplierName: '',
  sourceUrl: '',
  categoryId: null,
  verified: false,
});

const emptyJobIssueDraft = (): InventoryJobIssueDraft => ({
  itemId: '',
  jobId: '',
  warehouseId: '',
  binId: '',
  quantity: 1,
  notes: '',
});

const emptyJobReturnDraft = (): InventoryJobReturnDraft => ({
  movementId: '',
  warehouseId: '',
  binId: '',
  quantity: 1,
  notes: '',
});

const emptyMoveDraft = (): InventoryMoveDraft => ({
  itemId: '',
  fromWarehouseId: '',
  fromBinId: '',
  toWarehouseId: '',
  toBinId: '',
  quantity: 1,
  notes: '',
});

function formatQty(value: number, unit = '') {
  const clean = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${clean} ${unit}` : clean;
}

const importPlaceholderValues = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not available', 'unavailable']);

function importMatchValue(value: string | null | undefined) {
  const clean = (value ?? '').trim().toLowerCase();
  return importPlaceholderValues.has(clean) ? '' : clean;
}

function categoryIcon(key: string, size = 16) {
  const props = { size, 'aria-hidden': true };
  if (key === 'snowflake') return <Snowflake {...props} />;
  if (key === 'home') return <Home {...props} />;
  if (key === 'utensils') return <Utensils {...props} />;
  if (key === 'forklift') return <Forklift {...props} />;
  if (key === 'zap') return <Zap {...props} />;
  if (key === 'wrench') return <Wrench {...props} />;
  if (key === 'box') return <Box {...props} />;
  if (key === 'droplet') return <Droplet {...props} />;
  if (key === 'fan') return <Fan {...props} />;
  if (key === 'settings') return <Settings {...props} />;
  return <Folder {...props} />;
}

function EmptyWarehouseState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="warehouse-empty-state">
      <Warehouse size={24} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function WarehousePage({ companyId, onMaterialsChanged }: WarehousePageProps) {
  const [activeTab, setActiveTab] = useState<WarehouseTab>('parts');
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [partsStatusFilter, setPartsStatusFilter] = useState<PartsStatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [snapshot, setSnapshot] = useState<WarehouseSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [formMode, setFormMode] = useState<WarehouseFormMode>('none');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [warehouseDraft, setWarehouseDraft] = useState<InventoryWarehouseDraft>(emptyWarehouseDraft);
  const [itemDraft, setItemDraft] = useState<InventoryItemDraft>(emptyItemDraft);
  const [categoryDraft, setCategoryDraft] = useState<InventoryCategoryDraft>(emptyCategoryDraft);
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [categoryPickerTarget, setCategoryPickerTarget] = useState<'settings' | 'item' | 'import'>('settings');
  const [categoryDraftOpen, setCategoryDraftOpen] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<InventorySupplierDraft>(emptySupplierDraft);
  const [receiptDraft, setReceiptDraft] = useState<InventoryReceiptDraft>(() => emptyReceiptDraft());
  const [receiptLineDraft, setReceiptLineDraft] = useState<InventoryReceiptLineDraft>(() => emptyReceiptLineDraft());
  const [quickStockDraft, setQuickStockDraft] = useState(() => emptyQuickStockDraft());
  const [productImportDraft, setProductImportDraft] = useState<ProductImportDraft>(() => emptyProductImportDraft());
  const [importPosting, setImportPosting] = useState(false);
  const [jobIssueDraft, setJobIssueDraft] = useState<InventoryJobIssueDraft>(() => emptyJobIssueDraft());
  const [jobReturnDraft, setJobReturnDraft] = useState<InventoryJobReturnDraft>(() => emptyJobReturnDraft());
  const [moveDraft, setMoveDraft] = useState<InventoryMoveDraft>(() => emptyMoveDraft());
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState<'all' | 'draft' | 'posted' | 'canceled'>('all');
  const [showAdvancedPurchaseEditor, setShowAdvancedPurchaseEditor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus('');

    listWarehouseSnapshot(companyId)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        setSnapshot(emptySnapshot);
        setStatus(warehouseErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function reloadWarehouse() {
    const nextSnapshot = await listWarehouseSnapshot(companyId);
    setSnapshot(nextSnapshot);
    if (selectedReceiptId && !nextSnapshot.receipts.some((receipt) => receipt.id === selectedReceiptId)) {
      setSelectedReceiptId('');
    }
  }

  async function saveWarehouseDraft() {
    if (!warehouseDraft.name.trim()) {
      setStatus('Warehouse name is required.');
      return;
    }
    setStatus('Saving warehouse...');
    try {
      await createInventoryWarehouse(companyId, warehouseDraft);
      setWarehouseDraft(emptyWarehouseDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Warehouse saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Warehouse could not be saved.');
    }
  }

  async function saveItemDraft() {
    if (!itemDraft.internalName.trim()) {
      setStatus('Item name is required.');
      return;
    }
    setStatus('Saving inventory item...');
    try {
      await createInventoryItem(companyId, itemDraft);
      setItemDraft(emptyItemDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Inventory item saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Inventory item could not be saved.');
    }
  }

  async function saveSupplierDraft() {
    if (!supplierDraft.name.trim()) {
      setStatus('Supplier name is required.');
      return;
    }
    setStatus('Saving supplier...');
    try {
      await createInventorySupplier(companyId, supplierDraft);
      setSupplierDraft(emptySupplierDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Supplier saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Supplier could not be saved.');
    }
  }

  async function saveReceiptDraft(): Promise<InventoryStockReceipt | null> {
    if (!receiptDraft.warehouseId) {
      setStatus('Warehouse is required.');
      return null;
    }
    if (receiptDraft.binId && !snapshot.bins.some((bin) => bin.id === receiptDraft.binId && bin.warehouseId === receiptDraft.warehouseId)) {
      setStatus('Selected bin does not belong to this warehouse.');
      return null;
    }
    if (receiptDraft.supplierId && !snapshot.suppliers.some((supplier) => supplier.id === receiptDraft.supplierId && supplier.isActive)) {
      setStatus('Select an active supplier or leave supplier empty.');
      return null;
    }

    setStatus('Saving receipt draft...');
    try {
      const saved = selectedReceiptId
        ? await updateInventoryReceipt(snapshot.receipts.find((receipt) => receipt.id === selectedReceiptId) as InventoryStockReceipt, receiptDraft)
        : await createInventoryReceipt(companyId, receiptDraft);
      setSelectedReceiptId(saved.id);
      await reloadWarehouse();
      setStatus('Receipt draft saved.');
      return saved;
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
      return null;
    }
  }

  async function addReceiptLine() {
    let receiptId = selectedReceiptId;
    if (!receiptId) {
      const savedReceipt = await saveReceiptDraft();
      if (!savedReceipt) return;
      receiptId = savedReceipt.id;
    }
    if (!receiptLineDraft.itemId) {
      setStatus('Select an item.');
      return;
    }
    if ((Number(receiptLineDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }
    if ((Number(receiptLineDraft.unitCost) || 0) < 0) {
      setStatus('Unit cost cannot be negative.');
      return;
    }
    if (snapshot.receiptLines.some((line) => line.receiptId === receiptId && line.itemId === receiptLineDraft.itemId)) {
      setStatus('This item is already on the receipt. Update the existing line instead.');
      return;
    }

    setStatus('Adding receipt line...');
    try {
      await createInventoryReceiptLine(companyId, { ...receiptLineDraft, receiptId });
      setReceiptLineDraft(emptyReceiptLineDraft(receiptId));
      await reloadWarehouse();
      setStatus('Receipt line added.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  function startReceiptForItem(item: InventoryItem) {
    const activeWarehouses = snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive);
    const preferredWarehouseId = warehouseFilter !== 'all'
      ? warehouseFilter
      : activeWarehouses.length === 1
        ? activeWarehouses[0].id
        : '';
    const neededQuantity = Math.max(1, Math.ceil(item.minimumQuantity - item.totalQuantity));

    setActiveTab('parts');
    setFormMode('stock');
    setSelectedReceiptId('');
    setQuickStockDraft({
      ...emptyQuickStockDraft(),
      itemId: item.id,
      quantity: neededQuantity,
      warehouseId: preferredWarehouseId,
    });
    setStatus(preferredWarehouseId
      ? 'Enter quantity and price, then add to stock.'
      : 'Select a location, quantity, and price, then add to stock.');
  }

  function preferredIssueLocation(item: InventoryItem) {
    const activeWarehouseIds = new Set(snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => warehouseRow.id));
    const selectedBalance = warehouseFilter !== 'all'
      ? snapshot.stockBalances.find((balance) => balance.itemId === item.id && balance.warehouseId === warehouseFilter && balance.quantity > 0 && activeWarehouseIds.has(balance.warehouseId))
      : null;
    const firstBalance = selectedBalance ?? snapshot.stockBalances.find((balance) => balance.itemId === item.id && balance.quantity > 0 && activeWarehouseIds.has(balance.warehouseId));
    return {
      warehouseId: firstBalance?.warehouseId ?? (warehouseFilter !== 'all' ? warehouseFilter : ''),
      binId: firstBalance?.binId ?? '',
      quantity: firstBalance ? Math.min(1, firstBalance.quantity) : 1,
    };
  }

  function startIssueForItem(item: InventoryItem) {
    const location = preferredIssueLocation(item);
    setActiveTab('parts');
    setFormMode('jobIssue');
    setJobIssueDraft({
      ...emptyJobIssueDraft(),
      itemId: item.id,
      warehouseId: location.warehouseId,
      binId: location.binId,
      quantity: location.quantity,
    });
    setStatus(location.warehouseId ? 'Select a Job and quantity to use this part.' : 'Add stock first, then choose a location for Job use.');
  }

  function startMoveForItem(item: InventoryItem) {
    const location = preferredIssueLocation(item);
    setActiveTab('parts');
    setFormMode('move');
    setMoveDraft({
      ...emptyMoveDraft(),
      itemId: item.id,
      fromWarehouseId: location.warehouseId,
      fromBinId: location.binId,
      quantity: location.quantity,
    });
    setStatus(location.warehouseId ? 'Choose the destination location and quantity to move.' : 'Add stock before moving this part.');
  }

  function startReturnForMovement(movement: WarehouseSnapshot['movements'][number]) {
    setActiveTab('activity');
    setFormMode('jobReturn');
    setJobReturnDraft({
      ...emptyJobReturnDraft(),
      movementId: movement.id,
      warehouseId: movement.fromWarehouseId ?? '',
      binId: movement.fromBinId ?? '',
      quantity: Math.min(1, movement.quantity),
    });
    setStatus('Enter the unused quantity to return to stock.');
  }

  function openQuickStock() {
    const activeWarehouses = snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive);
    setFormMode('stock');
    setQuickStockDraft({
      ...emptyQuickStockDraft(),
      warehouseId: warehouseFilter !== 'all' ? warehouseFilter : activeWarehouses.length === 1 ? activeWarehouses[0].id : '',
    });
  }

  async function addQuickStock() {
    if (!quickStockDraft.itemId) {
      setStatus('Select a part.');
      return;
    }
    if (!quickStockDraft.warehouseId) {
      setStatus('Select a location.');
      return;
    }
    if ((Number(quickStockDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }
    if ((Number(quickStockDraft.unitCost) || 0) < 0) {
      setStatus('Price each cannot be negative.');
      return;
    }
    if ((Number(quickStockDraft.unitCost) || 0) === 0) {
      const confirmedZeroCost = window.confirm('This stock has zero cost. Continue only for warranty, free replacement, donated stock, or opening correction.');
      if (!confirmedZeroCost) return;
    }

    setStatus('Adding stock...');
    try {
      const savedReceipt = await createInventoryReceipt(companyId, {
        supplierId: quickStockDraft.supplierId || null,
        warehouseId: quickStockDraft.warehouseId,
        binId: quickStockDraft.binId || null,
        receiptDate: quickStockDraft.receiptDate,
        poNumber: quickStockDraft.poNumber,
        invoiceNumber: quickStockDraft.invoiceNumber,
        notes: quickStockDraft.notes,
      });
      await createInventoryReceiptLine(companyId, {
        receiptId: savedReceipt.id,
        itemId: quickStockDraft.itemId,
        quantity: quickStockDraft.quantity,
        unitCost: quickStockDraft.unitCost,
        extraCost: quickStockDraft.extraCost,
        currency: 'USD',
      });
      await postInventoryReceipt(savedReceipt.id);
      setQuickStockDraft(emptyQuickStockDraft());
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Stock added.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  function findImportMatch(product: ImportedInventoryProduct) {
    const normalizedUrl = normalizeSupplierUrl(product.canonicalUrl || '');
    const externalId = importMatchValue(product.externalProductId);
    const asin = importMatchValue(product.asin);
    const ebayItemId = importMatchValue(product.ebayItemId);
    const linkedMatch = snapshot.supplierLinks.find((link) => {
      const linkExternal = importMatchValue(link.externalProductId);
      const linkAsin = importMatchValue(link.asin);
      const linkEbayItemId = importMatchValue(link.ebayItemId);
      return Boolean(
        (externalId && linkExternal === externalId) ||
        (asin && linkAsin === asin) ||
        (ebayItemId && linkEbayItemId === ebayItemId) ||
        (normalizedUrl && (link.canonicalUrlNormalized === normalizedUrl || link.sourceUrlNormalized === normalizedUrl)),
      );
    });
    if (linkedMatch) return linkedMatch.itemId;

    const partNumber = importMatchValue(product.partNumber);
    if (partNumber) {
      const partMatch = snapshot.items.find((item) => [item.partNumber, item.alternatePartNumber].some((value) => importMatchValue(value) === partNumber));
      if (partMatch) return partMatch.id;
    }
    return '';
  }

  async function saveCategoryDraft() {
    if (!categoryDraft.name.trim()) {
      setStatus('Category name is required.');
      return;
    }
    setStatus(editingCategoryId ? 'Saving category...' : 'Creating category...');
    try {
      const saved = editingCategoryId
        ? await updateInventoryCategory(editingCategoryId, { ...categoryDraft, isActive: true })
        : await createInventoryCategory(companyId, categoryDraft);
      setCategoryDraft(emptyCategoryDraft);
      setEditingCategoryId('');
      setCategoryDraftOpen(false);
      if (categoryPickerTarget === 'item') setItemDraft((draft) => ({ ...draft, categoryId: saved.id, category: saved.name }));
      if (categoryPickerTarget === 'import') setProductImportDraft((draft) => ({ ...draft, categoryId: saved.id, verified: false }));
      await reloadWarehouse();
      setStatus('Category saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function deleteCategory(category: InventoryCategory) {
    const confirmed = window.confirm(`Delete category "${category.name}"? This is only allowed when it is not used.`);
    if (!confirmed) return;
    setStatus('Deleting category...');
    try {
      await deleteInventoryCategory(category.id);
      await reloadWarehouse();
      setStatus('Category deleted.');
    } catch (error) {
      const message = warehouseErrorMessage(error);
      setStatus(message.includes('CATEGORY_USED_BY_ITEMS') || message.includes('CATEGORY_HAS_CHILDREN')
        ? 'This category is used by inventory parts or active subcategories and cannot be deleted. Move parts or deactivate the category.'
        : message);
    }
  }

  async function toggleCategory(category: InventoryCategory) {
    setStatus(category.isActive ? 'Deactivating category...' : 'Activating category...');
    try {
      await updateInventoryCategory(category.id, { name: category.name, icon: category.icon, isActive: !category.isActive });
      await reloadWarehouse();
      setStatus(category.isActive ? 'Category deactivated.' : 'Category activated.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function moveCategory(category: InventoryCategory, direction: -1 | 1) {
    const siblings = snapshot.categories
      .filter((row) => row.parentId === category.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const index = siblings.findIndex((row) => row.id === category.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    setStatus('Saving category order...');
    try {
      await reorderInventoryCategories(companyId, category.parentId, reordered.map((row) => row.id));
      await reloadWarehouse();
      setStatus('Category order saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  function findWeakImportMatches(product: ImportedInventoryProduct) {
    const model = importMatchValue(product.model || product.oem);
    const maker = importMatchValue(product.manufacturer || product.brand);
    const title = importMatchValue(product.title);
    const matches = new Set<string>();
    if (model && maker) {
      snapshot.items.forEach((item) => {
        if (importMatchValue(item.manufacturer) === maker && [item.oem, item.partNumber, item.alternatePartNumber].some((value) => importMatchValue(value) === model)) {
          matches.add(item.id);
        }
      });
    }
    if (title) {
      snapshot.items.forEach((item) => {
        if (importMatchValue(item.internalName) === title) matches.add(item.id);
      });
    }
    return Array.from(matches).slice(0, 5);
  }

  async function importProductLink(sourceUrl = productImportDraft.productUrl) {
    const cleanUrl = sourceUrl.trim();
    if (!cleanUrl) {
      setStatus('Paste a product link first.');
      return;
    }
    setStatus('Importing product details...');
    try {
      const preview = await importInventoryProductUrl(companyId, cleanUrl);
      if (preview.providerStatus === 'blocked') {
        setProductImportDraft({ ...emptyProductImportDraft(), productUrl: cleanUrl });
        setFormMode('stock');
        setStatus(preview.warnings?.[0] || 'Automatic product import was blocked. Enter the fields manually.');
        return;
      }
      const matchItemId = findImportMatch(preview);
      const weakMatchItemIds = matchItemId ? [] : findWeakImportMatches(preview);
      setProductImportDraft({
        ...emptyProductImportDraft(),
        productUrl: cleanUrl,
        sourceUrl: preview.canonicalUrl || cleanUrl,
        preview,
        matchItemId,
        weakMatchItemIds,
        createNewPart: !matchItemId,
        packagesReceived: 1,
        unitsPerPackage: Math.max(1, Number(preview.packQuantity) || 1),
        packagePrice: Math.max(0, Number(preview.vendorPrice) || 0),
        supplierName: preview.supplierName || preview.sourceDomain,
      });
      setQuickStockDraft((draft) => ({
        ...draft,
        quantity: Math.max(1, Number(preview.packQuantity) || 1),
        unitCost: preview.packQuantity > 0 ? Number(preview.vendorPrice) / Math.max(1, Number(preview.packQuantity) || 1) : Number(preview.vendorPrice) || 0,
      }));
      setFormMode('stock');
      setStatus(matchItemId ? 'Strong existing part match found. Review before adding stock.' : 'Review the imported product before adding stock.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function addImportedStock() {
    const product = productImportDraft.preview;
    if (!product) {
      setStatus('Import a product link first.');
      return;
    }
    const itemName = product.title.trim();
    if (!itemName) {
      setStatus('Product name is required.');
      return;
    }
    if (!quickStockDraft.warehouseId) {
      setStatus('Select a location.');
      return;
    }
    if ((Number(productImportDraft.packagesReceived) || 0) <= 0 || (Number(productImportDraft.unitsPerPackage) || 0) <= 0) {
      setStatus('Quantity received and units per pack must be greater than zero.');
      return;
    }
    if ((Number(productImportDraft.packagePrice) || 0) <= 0) {
      const confirmedZeroPrice = window.confirm('This imported product has zero price. Continue only for free replacement, warranty, donated stock, or opening correction.');
      if (!confirmedZeroPrice) return;
    }
    if (!productImportDraft.verified) {
      setStatus('Review and confirm the imported fields before adding stock.');
      return;
    }

    if (importPosting) return;
    setImportPosting(true);
    setStatus('Adding imported product to stock...');
    try {
      const result = await receiveImportedProductToStock(companyId, {
        idempotencyKey: productImportDraft.idempotencyKey,
        selectedItemId: productImportDraft.matchItemId || null,
        createNewPart: productImportDraft.createNewPart,
        warehouseId: quickStockDraft.warehouseId,
        binId: quickStockDraft.binId || null,
        title: product.title,
        brand: product.brand,
        manufacturer: product.manufacturer || product.brand,
        partNumber: product.partNumber,
        model: product.model,
        oem: product.oem,
        description: product.description,
        imageUrl: product.imageUrl,
        supplierName: productImportDraft.supplierName,
        sourceType: product.sourceType,
        sourceDomain: product.sourceDomain,
        sourceUrl: productImportDraft.productUrl,
        canonicalUrl: productImportDraft.sourceUrl || product.canonicalUrl || productImportDraft.productUrl,
        externalProductId: product.externalProductId,
        asin: product.asin,
        ebayItemId: product.ebayItemId,
        currency: product.currency || 'USD',
        packagesReceived: productImportDraft.packagesReceived,
        unitsPerPackage: productImportDraft.unitsPerPackage,
        packagePrice: productImportDraft.packagePrice,
        shippingCost: productImportDraft.shippingCost,
        taxCost: productImportDraft.taxCost,
        otherCost: productImportDraft.otherCost,
        receiptDate: quickStockDraft.receiptDate,
        poNumber: quickStockDraft.poNumber,
        invoiceNumber: quickStockDraft.invoiceNumber,
      });
      if (productImportDraft.categoryId) {
        await setInventoryItemCategory(result.item_id, productImportDraft.categoryId);
      }

      setProductImportDraft(emptyProductImportDraft());
      setQuickStockDraft(emptyQuickStockDraft());
      setFormMode('none');
      await reloadWarehouse();
      const warningText = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
      setStatus(`${result.idempotent_replay ? 'Import retry returned the original posted result.' : 'Imported product added to stock.'}${warningText}`);
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    } finally {
      setImportPosting(false);
    }
  }

  async function issuePartToJob() {
    if (!jobIssueDraft.itemId) {
      setStatus('Select a part.');
      return;
    }
    if (!jobIssueDraft.jobId) {
      setStatus('Select a Job.');
      return;
    }
    if (!jobIssueDraft.warehouseId) {
      setStatus('Select a location.');
      return;
    }
    if ((Number(jobIssueDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }

    setStatus('Using part on Job...');
    try {
      await issueInventoryPartToJob(jobIssueDraft);
      setJobIssueDraft(emptyJobIssueDraft());
      setFormMode('none');
      await reloadWarehouse();
      await onMaterialsChanged?.();
      setStatus('Part used on Job. Stock and Job material cost were posted.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function returnJobPart() {
    if (!jobReturnDraft.movementId) {
      setStatus('Select a Job issue movement.');
      return;
    }
    if ((Number(jobReturnDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }

    setStatus('Returning unused part...');
    try {
      await returnInventoryJobPart(jobReturnDraft);
      setJobReturnDraft(emptyJobReturnDraft());
      setFormMode('none');
      await reloadWarehouse();
      await onMaterialsChanged?.();
      setStatus('Unused part returned to stock.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function updateReceiptLine(line: InventoryStockReceiptLine, patch: Partial<InventoryReceiptLineDraft>) {
    setStatus('Saving line...');
    try {
      await updateInventoryReceiptLine(line, patch);
      await reloadWarehouse();
      setStatus('Receipt line saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function removeReceiptLine(line: InventoryStockReceiptLine) {
    setStatus('Removing line...');
    try {
      await deleteInventoryReceiptLine(line);
      await reloadWarehouse();
      setStatus('Receipt line removed.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function postReceipt(receipt: InventoryStockReceipt) {
    const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
    if (!lines.length) {
      setStatus('Add at least one line before posting.');
      return;
    }
    if (lines.some((line) => line.unitCost === 0)) {
      const confirmedZeroCost = window.confirm('This receipt includes zero-cost lines. Continue only for warranty, free replacement, donated stock, or opening correction.');
      if (!confirmedZeroCost) return;
    }
    const confirmed = window.confirm('This receipt will update stock balances and inventory cost. Posted receipts cannot be edited.');
    if (!confirmed) return;

    setStatus('Posting receipt...');
    try {
      await postInventoryReceipt(receipt.id);
      await reloadWarehouse();
      setStatus('Receipt posted. Stock balances and average cost were updated.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function cancelReceipt(receipt: InventoryStockReceipt) {
    const reason = window.prompt('Cancel reason');
    if (reason === null) return;
    setStatus('Canceling receipt...');
    try {
      await cancelInventoryReceipt(receipt.id, reason);
      await reloadWarehouse();
      setStatus('Receipt canceled.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  const itemById = useMemo(() => new Map(snapshot.items.map((item) => [item.id, item])), [snapshot.items]);
  const categoryById = useMemo(() => new Map(snapshot.categories.map((category) => [category.id, category])), [snapshot.categories]);
  const rootCategories = useMemo(
    () => snapshot.categories.filter((category) => !category.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [snapshot.categories],
  );
  const categoryChildrenByParent = useMemo(() => {
    const map = new Map<string, InventoryCategory[]>();
    snapshot.categories.forEach((category) => {
      if (!category.parentId) return;
      const rows = map.get(category.parentId) ?? [];
      rows.push(category);
      map.set(category.parentId, rows);
    });
    map.forEach((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
    return map;
  }, [snapshot.categories]);
  const warehouseById = useMemo(() => new Map(snapshot.warehouses.map((warehouse) => [warehouse.id, warehouse])), [snapshot.warehouses]);
  const supplierById = useMemo(() => new Map(snapshot.suppliers.map((supplier) => [supplier.id, supplier])), [snapshot.suppliers]);
  const jobById = useMemo(() => new Map(snapshot.jobs.map((job) => [job.id, job])), [snapshot.jobs]);
  const activeJobs = useMemo(
    () => snapshot.jobs.filter((job) => !['Completed', 'Cancelled', 'Archived'].includes(job.status)),
    [snapshot.jobs],
  );

  const stockRows = useMemo(() => snapshot.stockBalances.map((balance) => {
    const item = itemById.get(balance.itemId);
    const warehouseRow = warehouseById.get(balance.warehouseId);
    return {
      balance,
      item,
      warehouse: warehouseRow,
      value: balance.quantity * (item?.averageCost ?? 0),
      low: item ? item.minimumQuantity > 0 && balance.quantity > 0 && balance.quantity <= item.minimumQuantity : false,
    };
  }), [itemById, snapshot.stockBalances, warehouseById]);

  const selectedWarehouse = warehouseFilter === 'all' ? null : warehouseById.get(warehouseFilter) ?? null;

  function categoryPath(categoryId: string | null | undefined) {
    if (!categoryId) return 'Uncategorized';
    const category = categoryById.get(categoryId);
    if (!category) return 'Uncategorized';
    const parent = category.parentId ? categoryById.get(category.parentId) : null;
    return parent ? `${parent.name} / ${category.name}` : category.name;
  }

  async function moveStock() {
    if (!moveDraft.itemId) {
      setStatus('Select a part.');
      return;
    }
    if (!moveDraft.fromWarehouseId || !moveDraft.toWarehouseId) {
      setStatus('Select from and to locations.');
      return;
    }
    if (moveDraft.fromWarehouseId === moveDraft.toWarehouseId && (moveDraft.fromBinId || '') === (moveDraft.toBinId || '')) {
      setStatus('Choose a different destination location.');
      return;
    }
    if ((Number(moveDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }

    setStatus('Moving stock...');
    try {
      await moveInventoryStock(moveDraft);
      setMoveDraft(emptyMoveDraft());
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Stock moved. Transfer out and transfer in movements were posted.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  function categoryMatchesFilter(item: InventoryItem) {
    if (categoryFilter === 'all') return true;
    if (item.categoryId === categoryFilter) return true;
    const selected = categoryById.get(categoryFilter);
    if (selected && !selected.parentId) {
      const childIds = new Set((categoryChildrenByParent.get(selected.id) ?? []).map((child) => child.id));
      return Boolean(item.categoryId && childIds.has(item.categoryId));
    }
    return false;
  }

  function itemStockStatus(item: InventoryItem) {
    const quantity = itemDisplayQuantity(item);
    if (quantity <= 0) return 'out' as const;
    if (item.minimumQuantity > 0 && quantity <= item.minimumQuantity) return 'low' as const;
    return 'in' as const;
  }
  const itemQuantityBySelectedWarehouse = useMemo(() => {
    if (warehouseFilter === 'all') return new Map<string, number>();
    const quantities = new Map<string, number>();
    snapshot.stockBalances
      .filter((balance) => balance.warehouseId === warehouseFilter)
      .forEach((balance) => {
        quantities.set(balance.itemId, (quantities.get(balance.itemId) ?? 0) + balance.quantity);
      });
    return quantities;
  }, [snapshot.stockBalances, warehouseFilter]);

  function itemDisplayQuantity(item: InventoryItem) {
    return warehouseFilter === 'all'
      ? item.totalQuantity
      : itemQuantityBySelectedWarehouse.get(item.id) ?? 0;
  }

  function itemLocationSummary(item: InventoryItem) {
    const rows = stockRows.filter((row) => row.item?.id === item.id && row.balance.quantity > 0);
    if (!rows.length) return 'No stock yet';
    return rows
      .slice(0, 3)
      .map((row) => `${row.warehouse?.name ?? 'Unknown'} ${formatQty(row.balance.quantity, item.unit)}`)
      .join(' - ');
  }

  function itemSubtitle(item: InventoryItem) {
    return [item.partNumber, item.manufacturer || item.oem].filter(Boolean).join(' - ') || item.description || 'No part details';
  }

  function updateImportedProduct(patch: Partial<ImportedInventoryProduct>) {
    setProductImportDraft((draft) => draft.preview ? { ...draft, preview: { ...draft.preview, ...patch }, verified: false } : draft);
  }

  function renderCategorySelect(value: string | null, onChange: (categoryId: string | null) => void, includeInactiveSelected = false) {
    return (
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Uncategorized</option>
        {rootCategories.filter((category) => category.isActive || (includeInactiveSelected && category.id === value)).map((category) => (
          <optgroup label={category.name} key={category.id}>
            <option value={category.id}>{category.name}</option>
            {(categoryChildrenByParent.get(category.id) ?? [])
              .filter((child) => child.isActive || (includeInactiveSelected && child.id === value))
              .map((child) => (
                <option value={child.id} key={child.id}>{child.name}</option>
              ))}
          </optgroup>
        ))}
      </select>
    );
  }

  function renderCategoryDraftForm(compact = false) {
    return (
      <div className={compact ? 'warehouse-category-draft compact' : 'warehouse-category-draft'}>
        <label>Name<input value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /></label>
        <label>Icon
          <select value={categoryDraft.icon} onChange={(event) => setCategoryDraft({ ...categoryDraft, icon: event.target.value })}>
            <option value="">Default</option>
            {categoryIconOptions.map((icon) => <option value={icon} key={icon}>{icon}</option>)}
          </select>
        </label>
        <label>Parent category
          <select value={categoryDraft.parentId ?? ''} disabled={Boolean(editingCategoryId)} onChange={(event) => setCategoryDraft({ ...categoryDraft, parentId: event.target.value || null })}>
            <option value="">None - root category</option>
            {rootCategories.filter((category) => category.isActive).map((category) => (
              <option value={category.id} key={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <div className="warehouse-form-actions">
          <button className="secondary-button compact" type="button" onClick={() => { setCategoryDraft(emptyCategoryDraft); setEditingCategoryId(''); setCategoryDraftOpen(false); }}>Clear</button>
          <button className="primary-button compact" type="button" onClick={saveCategoryDraft}>{editingCategoryId ? 'Save category' : 'Create category'}</button>
        </div>
      </div>
    );
  }

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.items.filter((item) => {
      const haystack = [
        item.internalName,
        item.category,
        categoryPath(item.categoryId),
        item.manufacturer,
        item.oem,
        item.partNumber,
        item.alternatePartNumber,
        item.description,
      ].join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (!categoryMatchesFilter(item)) return false;
      const stockStatus = itemStockStatus(item);
      if (partsStatusFilter !== 'all' && stockStatus !== partsStatusFilter) return false;
      return true;
    });
  }, [categoryFilter, categoryById, categoryChildrenByParent, itemQuantityBySelectedWarehouse, partsStatusFilter, search, snapshot.items, warehouseFilter]);

  const filteredStockRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stockRows.filter(({ balance, item, warehouse: warehouseRow }) => {
      const matchesWarehouse = warehouseFilter === 'all' || balance.warehouseId === warehouseFilter;
      const haystack = `${item?.internalName ?? ''} ${item?.partNumber ?? ''} ${warehouseRow?.name ?? ''}`.toLowerCase();
      return matchesWarehouse && (!query || haystack.includes(query));
    });
  }, [search, stockRows, warehouseFilter]);

  const lowStockItems = useMemo(
    () => snapshot.items.filter((item) => itemStockStatus(item) === 'low'),
    [itemQuantityBySelectedWarehouse, snapshot.items, warehouseFilter],
  );

  const summary = useMemo(() => ({
    warehouses: snapshot.warehouses.filter((warehouse) => warehouse.isActive).length,
    items: snapshot.items.filter((item) => item.isActive).length,
    totalQuantity: snapshot.items.reduce((sum, item) => sum + item.totalQuantity, 0),
    inventoryValue: snapshot.items.reduce((sum, item) => sum + item.totalQuantity * item.averageCost, 0),
    lowStock: lowStockItems.length,
  }), [lowStockItems.length, snapshot.items, snapshot.warehouses]);

  const selectedReceipt = useMemo(() => snapshot.receipts.find((receipt) => receipt.id === selectedReceiptId), [selectedReceiptId, snapshot.receipts]);
  const selectedPart = useMemo(() => snapshot.items.find((item) => item.id === selectedPartId) ?? null, [selectedPartId, snapshot.items]);

  useEffect(() => {
    if (!selectedReceipt) return;
    setReceiptDraft({
      supplierId: selectedReceipt.supplierId,
      warehouseId: selectedReceipt.warehouseId,
      binId: selectedReceipt.binId,
      receiptDate: selectedReceipt.receiptDate,
      poNumber: selectedReceipt.poNumber,
      invoiceNumber: selectedReceipt.invoiceNumber,
      notes: selectedReceipt.notes,
    });
    setReceiptLineDraft((draft) => ({ ...draft, receiptId: selectedReceipt.id }));
  }, [selectedReceipt]);

  function renderDashboard() {
    return (
      <>
        <div className="warehouse-kpi-grid">
          <span><strong>{summary.warehouses}</strong> Active warehouses</span>
          <span><strong>{summary.items}</strong> Active items</span>
          <span><strong>{formatQty(summary.totalQuantity)}</strong> Total on hand</span>
          <span><strong>{money(summary.inventoryValue)}</strong> Inventory value</span>
          <span className={summary.lowStock ? 'warning' : ''}><strong>{summary.lowStock}</strong> Low stock</span>
        </div>

        <div className="warehouse-dashboard-grid">
          <section className="warehouse-panel">
            <div className="warehouse-panel-heading">
              <h2>Warehouses</h2>
              <MapPin size={18} aria-hidden="true" />
            </div>
            {snapshot.warehouses.length ? (
              <div className="warehouse-list">
                {snapshot.warehouses.map((warehouseRow) => (
                  <div className="warehouse-list-row" key={warehouseRow.id}>
                    <strong>{warehouseRow.name}</strong>
                    <span>{warehouseRow.type.replace(/_/g, ' ')} - {warehouseRow.location || 'No location'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyWarehouseState title="No warehouses yet" detail="Create main stock, office, and technician vehicle warehouses after applying the migration." />
            )}
          </section>

          <section className="warehouse-panel">
            <div className="warehouse-panel-heading">
              <h2>Recent movement</h2>
              <History size={18} aria-hidden="true" />
            </div>
            {snapshot.movements.length ? renderMovementTable(snapshot.movements.slice(0, 6)) : (
              <EmptyWarehouseState title="No movements yet" detail="Posted receipts will appear here after the warehouse migrations are applied." />
            )}
          </section>
        </div>
      </>
    );
  }

  function renderPartsList(items: InventoryItem[]) {
    if (!items.length) return <EmptyWarehouseState title="No parts found" detail="Add a part or clear the search and filters." />;

    return (
      <div className="warehouse-part-list">
        {items.map((item) => {
          const quantity = itemDisplayQuantity(item);
          const stockStatus = itemStockStatus(item);
          const isSelected = selectedPartId === item.id;
          return (
            <article className={`warehouse-part-card${isSelected ? ' selected' : ''}`} key={item.id}>
              <button className="warehouse-part-main" type="button" onClick={() => setSelectedPartId(isSelected ? '' : item.id)}>
                <span className="warehouse-part-photo">{item.internalName.slice(0, 1).toUpperCase()}</span>
                <span className="warehouse-part-copy">
                  <strong>{item.internalName}</strong>
                  <small>{[itemSubtitle(item), categoryPath(item.categoryId), itemLocationSummary(item)].filter(Boolean).join(' - ')}</small>
                </span>
                <span className={`warehouse-part-stock ${stockStatus}`}>
                  <small>{stockStatus === 'out' ? 'Out of stock' : stockStatus === 'low' ? `Low - ${formatQty(quantity, item.unit)} left` : 'In stock'}</small>
                  <strong>{formatQty(quantity, item.unit)}</strong>
                  <small>{stockStatus === 'low' ? `Min ${formatQty(item.minimumQuantity, item.unit)}` : selectedWarehouse ? selectedWarehouse.name : 'available'}</small>
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              <div className="warehouse-part-actions">
                <button className="primary-button compact" type="button" onClick={() => startReceiptForItem(item)}>Add stock</button>
                <button className="secondary-button compact" type="button" disabled={quantity <= 0} onClick={() => startIssueForItem(item)}>Use on Job</button>
                <button className="secondary-button compact" type="button" disabled={quantity <= 0} onClick={() => startMoveForItem(item)}>Move</button>
              </div>
              {isSelected ? renderPartDetails(item) : null}
            </article>
          );
        })}
      </div>
    );
  }

  function renderPartDetails(item: InventoryItem) {
    const itemRows = stockRows.filter((row) => row.item?.id === item.id);
    const recentMovements = snapshot.movements.filter((movement) => movement.itemId === item.id).slice(0, 5);
    return (
      <div className="warehouse-part-detail">
        <div>
          <h3>{item.internalName}</h3>
          <p>{item.description || item.notes || 'No description yet.'}</p>
          <div className="warehouse-detail-meta">
            <span>Part # {item.partNumber || '-'}</span>
            <span>{item.manufacturer || item.oem || 'No manufacturer'}</span>
            <span>{categoryPath(item.categoryId)}</span>
            <span>Min {formatQty(item.minimumQuantity, item.unit)}</span>
            <span>Avg cost {money(item.averageCost)}</span>
          </div>
        </div>
        <div className="warehouse-location-list">
          <strong>Locations</strong>
          {itemRows.length ? itemRows.map((row) => (
            <span key={row.balance.id}>{row.warehouse?.name ?? 'Unknown'} <b>{formatQty(row.balance.quantity, item.unit)}</b></span>
          )) : <span>No stock yet</span>}
        </div>
        <div className="warehouse-activity-list compact">
          <strong>Recent activity</strong>
          {recentMovements.length ? recentMovements.map((movement) => renderActivityRow(movement, true)) : <span>No activity yet</span>}
        </div>
      </div>
    );
  }

  function renderStockTable(onlyLow = false) {
    const rows = onlyLow ? filteredStockRows.filter((row) => row.low) : filteredStockRows;
    if (!rows.length) return <EmptyWarehouseState title={onlyLow ? 'No low stock rows' : 'No stock balances yet'} detail="Stock balances are controlled by the database and will appear after posted warehouse movements." />;

    return (
      <div className="warehouse-table-wrap">
        <table className="warehouse-table stock">
          <thead>
            <tr>
              <th>Item</th>
              <th>Warehouse</th>
              <th>Bin</th>
              <th>On hand</th>
              <th>Min</th>
              <th>Avg cost</th>
              <th>Value</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ balance, item, warehouse: warehouseRow, value, low }) => (
              <tr className={low ? 'low' : ''} key={balance.id}>
                <td><strong>{item?.internalName ?? 'Unknown item'}</strong><span>{item?.partNumber || item?.manufacturer || ''}</span></td>
                <td>{warehouseRow?.name ?? 'Unknown warehouse'}</td>
                <td>{snapshot.bins.find((bin) => bin.id === balance.binId)?.code ?? '-'}</td>
                <td><strong>{formatQty(balance.quantity, item?.unit)}</strong></td>
                <td>{formatQty(item?.minimumQuantity ?? 0, item?.unit)}</td>
                <td>{money(item?.averageCost ?? 0)}</td>
                <td>{money(value)}</td>
                <td>{balance.updatedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderMovementTable(rows = snapshot.movements) {
    if (!rows.length) return <EmptyWarehouseState title="No movement history yet" detail="Every posted receipt, transfer, adjustment, issue, and return will be stored here." />;

    return (
      <div className="warehouse-table-wrap">
        <table className="warehouse-table movement">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Cost</th>
              <th>Balance before</th>
              <th>Balance after</th>
              <th>Avg after</th>
              <th>From</th>
              <th>To</th>
              <th>Supplier</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((movement) => (
              <tr key={movement.id}>
                <td>{movement.createdAt.slice(0, 10)}</td>
                <td>{movement.movementType.replace(/_/g, ' ')}</td>
                <td>{itemById.get(movement.itemId)?.internalName ?? 'Unknown item'}</td>
                <td>{formatQty(movement.quantity, itemById.get(movement.itemId)?.unit)}</td>
                <td>{money(movement.totalCost)}</td>
                <td>{movement.balanceBefore == null ? '-' : formatQty(movement.balanceBefore, itemById.get(movement.itemId)?.unit)}</td>
                <td>{movement.balanceAfter == null ? '-' : formatQty(movement.balanceAfter, itemById.get(movement.itemId)?.unit)}</td>
                <td>{movement.averageCostAfter == null ? '-' : money(movement.averageCostAfter)}</td>
                <td>{movement.fromWarehouseId ? warehouseById.get(movement.fromWarehouseId)?.name ?? '-' : '-'}</td>
                <td>{movement.toWarehouseId ? warehouseById.get(movement.toWarehouseId)?.name ?? '-' : '-'}</td>
                <td>{movement.supplierId ? supplierById.get(movement.supplierId)?.name ?? '-' : '-'}</td>
                <td>{movement.referenceNumber || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function movementTitle(movement: WarehouseSnapshot['movements'][number]) {
    const item = itemById.get(movement.itemId);
    if (movement.movementType === 'receipt') return `Received ${formatQty(movement.quantity, item?.unit)}`;
    if (movement.movementType === 'job_issue') return `Used ${formatQty(Math.abs(movement.quantity), item?.unit)} on Job`;
    if (movement.movementType === 'transfer_out' || movement.movementType === 'transfer_in') return `Moved ${formatQty(Math.abs(movement.quantity), item?.unit)}`;
    if (movement.movementType === 'job_return') return `Returned ${formatQty(movement.quantity, item?.unit)}`;
    return `Adjusted ${formatQty(movement.quantity, item?.unit)}`;
  }

  function movementContext(movement: WarehouseSnapshot['movements'][number]) {
    const supplier = movement.supplierId ? supplierById.get(movement.supplierId)?.name : '';
    const from = movement.fromWarehouseId ? warehouseById.get(movement.fromWarehouseId)?.name : '';
    const to = movement.toWarehouseId ? warehouseById.get(movement.toWarehouseId)?.name : '';
    const job = movement.jobId ? jobById.get(movement.jobId) : null;
    if (movement.movementType === 'receipt') return [to, supplier].filter(Boolean).join(' - ') || 'Stock received';
    if (movement.movementType === 'job_issue') return [job ? `Job #${job.jobNumber}` : movement.referenceNumber, from].filter(Boolean).join(' - ');
    if (movement.movementType === 'job_return') return [job ? `Job #${job.jobNumber}` : movement.referenceNumber, to].filter(Boolean).join(' - ');
    if (from && to) return `${from} -> ${to}`;
    return from || to || movement.referenceNumber || 'Warehouse';
  }

  function renderActivityRow(movement: WarehouseSnapshot['movements'][number], compact = false) {
    const item = itemById.get(movement.itemId);
    return (
      <details className={`warehouse-activity-row${compact ? ' compact' : ''}`} key={movement.id}>
        <summary>
          <span>
            <strong>{movementTitle(movement)}</strong>
            <small>{item?.internalName ?? 'Unknown part'}</small>
          </span>
          <span>
            <small>{movementContext(movement)}</small>
            <small>{new Date(movement.createdAt).toLocaleString()}</small>
          </span>
        </summary>
        <div className="warehouse-activity-details">
          <span>Balance before: {movement.balanceBefore == null ? '-' : formatQty(movement.balanceBefore, item?.unit)}</span>
          <span>Balance after: {movement.balanceAfter == null ? '-' : formatQty(movement.balanceAfter, item?.unit)}</span>
          <span>Average before: {movement.averageCostBefore == null ? '-' : money(movement.averageCostBefore)}</span>
          <span>Average after: {movement.averageCostAfter == null ? '-' : money(movement.averageCostAfter)}</span>
          <span>Movement ID: {movement.id}</span>
          <span>Purchase ID: {movement.receiptId ?? '-'}</span>
          {movement.movementType === 'job_issue' ? (
            <button className="secondary-button compact" type="button" onClick={() => startReturnForMovement(movement)}>Return unused</button>
          ) : null}
        </div>
      </details>
    );
  }

  function renderActivity() {
    const rows = snapshot.movements.filter((movement) => {
      if (activityFilter === 'received') return movement.movementType === 'receipt';
      if (activityFilter === 'used') return movement.movementType === 'job_issue' || movement.movementType === 'job_return';
      if (activityFilter === 'moved') return movement.movementType === 'transfer_in' || movement.movementType === 'transfer_out';
      if (activityFilter === 'adjustments') return movement.movementType === 'adjustment';
      return true;
    });
    return (
      <section className="warehouse-panel">
        <div className="warehouse-filter-row">
          {(['all', 'received', 'used', 'moved', 'adjustments'] as ActivityFilter[]).map((filter) => (
            <button className={activityFilter === filter ? 'active' : ''} type="button" onClick={() => setActivityFilter(filter)} key={filter}>
              {filter === 'all' ? 'All' : filter === 'received' ? 'Received' : filter === 'used' ? 'Used on Jobs' : filter === 'moved' ? 'Moved' : 'Adjustments'}
            </button>
          ))}
        </div>
        {rows.length ? <div className="warehouse-activity-list">{rows.map((movement) => renderActivityRow(movement))}</div> : (
          <EmptyWarehouseState title="No activity yet" detail="Completed stock changes will appear here." />
        )}
      </section>
    );
  }

  function renderSuppliers() {
    if (!snapshot.suppliers.length) return <EmptyWarehouseState title="No suppliers yet" detail="Suppliers and item supplier prices will be stored in inventory_suppliers and inventory_item_suppliers." />;

    return (
      <div className="warehouse-card-grid">
        {snapshot.suppliers.map((supplier) => (
          <article className="warehouse-supplier-card" key={supplier.id}>
            <strong>{supplier.name}</strong>
            <span>{supplier.contactName || 'No contact'}</span>
            <span>{supplier.phone || supplier.email || 'No phone or email'}</span>
            <span>{supplier.website || supplier.address || 'No website or address'}</span>
          </article>
        ))}
      </div>
    );
  }

  function renderCategoryRow(category: InventoryCategory, isChild = false) {
    return (
      <div className={`warehouse-category-row${isChild ? ' child' : ''}${category.isActive ? '' : ' inactive'}`} key={category.id}>
        <span className="warehouse-category-handle"><GripVertical size={16} aria-hidden="true" /></span>
        <span className="warehouse-category-icon">{categoryIcon(category.icon)}</span>
        <span className="warehouse-category-name">
          <strong>{category.name}</strong>
          <small>{category.isActive ? (isChild ? 'Subcategory' : 'Root category') : 'Inactive'}</small>
        </span>
        <div className="warehouse-category-actions">
          <button className="secondary-button compact icon-button" type="button" title="Move up" onClick={() => moveCategory(category, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
          <button className="secondary-button compact icon-button" type="button" title="Move down" onClick={() => moveCategory(category, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
          <button className="secondary-button compact icon-button" type="button" title="Edit" onClick={() => { setCategoryPickerTarget('settings'); setEditingCategoryId(category.id); setCategoryDraft({ name: category.name, icon: category.icon, parentId: category.parentId }); setCategoryDraftOpen(true); }}><Pencil size={15} aria-hidden="true" /></button>
          {!isChild ? <button className="secondary-button compact" type="button" onClick={() => { setCategoryPickerTarget('settings'); setEditingCategoryId(''); setCategoryDraft({ ...emptyCategoryDraft, parentId: category.id }); setCategoryDraftOpen(true); }}>Add subcategory</button> : null}
          <button className="secondary-button compact" type="button" onClick={() => toggleCategory(category)}>{category.isActive ? 'Deactivate' : 'Activate'}</button>
          <button className="secondary-button compact danger-lite icon-button" type="button" title="Delete" onClick={() => deleteCategory(category)}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      </div>
    );
  }

  function renderCategoriesManager() {
    return (
      <section className="warehouse-panel warehouse-categories-panel">
        <div className="warehouse-panel-heading">
          <h2>Categories</h2>
          <Folder size={18} aria-hidden="true" />
        </div>
        {categoryDraftOpen && categoryPickerTarget === 'settings' ? renderCategoryDraftForm() : null}
        {snapshot.categories.length ? (
          <div className="warehouse-category-tree">
            {rootCategories.map((category) => (
              <div className="warehouse-category-group" key={category.id}>
                {renderCategoryRow(category)}
                {(categoryChildrenByParent.get(category.id) ?? []).map((child) => renderCategoryRow(child, true))}
              </div>
            ))}
          </div>
        ) : (
          <div>
            <EmptyWarehouseState title="No categories yet." detail="Use categories to organize parts by your type of service." />
            <div className="warehouse-form-actions">
              <button className="primary-button compact" type="button" onClick={() => { setCategoryPickerTarget('settings'); setCategoryDraft(emptyCategoryDraft); setEditingCategoryId(''); setCategoryDraftOpen(true); }}>Create category</button>
              <button className="secondary-button compact" type="button" disabled title="Starter templates will be added after category usage is validated.">Use starter template</button>
            </div>
          </div>
        )}
        {snapshot.categories.length ? (
          <button className="secondary-button compact" type="button" onClick={() => { setCategoryPickerTarget('settings'); setCategoryDraft(emptyCategoryDraft); setEditingCategoryId(''); setCategoryDraftOpen(true); }}>Create category</button>
        ) : null}
      </section>
    );
  }

  function purchaseStatusLabel(status: InventoryStockReceipt['status']) {
    if (status === 'draft') return 'Not finished';
    if (status === 'canceled') return 'Canceled';
    return 'Posted';
  }

  function receiptTotal(receipt: InventoryStockReceipt) {
    return snapshot.receiptLines
      .filter((line) => line.receiptId === receipt.id)
      .reduce((sum, line) => sum + line.quantity * line.unitCost + line.extraCost, 0);
  }

  function renderPurchases() {
    const selectedPurchase = selectedReceiptId ? snapshot.receipts.find((receipt) => receipt.id === selectedReceiptId) ?? null : null;
    const purchases = snapshot.receipts.filter((receipt) => receiptStatusFilter === 'all' || receipt.status === receiptStatusFilter);
    return (
      <div className="warehouse-purchases-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Purchases</h2>
            <select value={receiptStatusFilter} onChange={(event) => setReceiptStatusFilter(event.target.value as typeof receiptStatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Not finished</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <div className="warehouse-purchase-actions">
            <button className="primary-button compact" type="button" onClick={openQuickStock}>New purchase</button>
            <button className="secondary-button compact" type="button" onClick={() => { setShowAdvancedPurchaseEditor(true); setSelectedReceiptId(''); setReceiptDraft(emptyReceiptDraft()); setReceiptLineDraft(emptyReceiptLineDraft()); }}>
              Receive multiple items
            </button>
          </div>
          {purchases.length ? (
            <div className="warehouse-purchase-list">
              {purchases.map((receipt) => {
                const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
                const supplier = receipt.supplierId ? supplierById.get(receipt.supplierId)?.name : 'No supplier';
                const warehouseRow = warehouseById.get(receipt.warehouseId)?.name ?? 'Unknown location';
                return (
                  <button className={selectedReceiptId === receipt.id ? 'active' : ''} type="button" onClick={() => { setShowAdvancedPurchaseEditor(false); setSelectedReceiptId(receipt.id); }} key={receipt.id}>
                    <span>
                      <strong>{new Date(receipt.receiptDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong>
                      <small>{supplier}</small>
                    </span>
                    <span>
                      <strong>{lines.length} item{lines.length === 1 ? '' : 's'} - {money(receiptTotal(receipt))}</strong>
                      <small>{warehouseRow}</small>
                    </span>
                    <span className={`warehouse-status ${receipt.status}`}>{purchaseStatusLabel(receipt.status)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyWarehouseState title="No purchases yet" detail="Use Add stock or New purchase to receive parts." />
          )}
        </section>
        <section className="warehouse-panel">
          {showAdvancedPurchaseEditor ? renderReceipts() : selectedPurchase ? renderPurchaseDetail(selectedPurchase) : (
            <EmptyWarehouseState title="Select a purchase" detail="Open a purchase to see details, or use New purchase to add stock." />
          )}
        </section>
      </div>
    );
  }

  function renderPurchaseDetail(receipt: InventoryStockReceipt) {
    const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
    const supplier = receipt.supplierId ? supplierById.get(receipt.supplierId)?.name : 'No supplier';
    const warehouseRow = warehouseById.get(receipt.warehouseId)?.name ?? 'Unknown location';
    return (
      <div className="warehouse-purchase-detail">
        <div className="warehouse-panel-heading">
          <div>
            <h2>{receipt.invoiceNumber || receipt.poNumber || 'Purchase'}</h2>
            <p className="warehouse-note">{supplier} - {warehouseRow} - {receipt.receiptDate}</p>
          </div>
          <span className={`warehouse-status ${receipt.status}`}>{purchaseStatusLabel(receipt.status)}</span>
        </div>
        <div className="warehouse-purchase-lines">
          {lines.map((line) => {
            const item = itemById.get(line.itemId);
            return (
              <div className="warehouse-purchase-line" key={line.id}>
                <span>
                  <strong>{item?.internalName ?? 'Unknown part'}</strong>
                  <small>{formatQty(line.quantity, item?.unit)} - Price each {money(line.unitCost)}</small>
                </span>
                <strong>{money(line.quantity * line.unitCost + line.extraCost)}</strong>
              </div>
            );
          })}
        </div>
        <div className="warehouse-total-row">
          <span>Total</span>
          <strong>{money(receiptTotal(receipt))}</strong>
        </div>
        {receipt.status === 'posted' ? <button className="secondary-button compact danger-lite" type="button" onClick={() => cancelReceipt(receipt)}>Cancel purchase</button> : null}
      </div>
    );
  }

  function renderReceipts() {
    const filteredReceipts = snapshot.receipts.filter((receipt) => receiptStatusFilter === 'all' || receipt.status === receiptStatusFilter);
    const receiptLines = selectedReceipt ? snapshot.receiptLines.filter((line) => line.receiptId === selectedReceipt.id) : [];
    const receiptMovements = selectedReceipt ? snapshot.movements.filter((movement) => movement.receiptId === selectedReceipt.id) : [];
    const receiptTotal = receiptLines.reduce((sum, line) => sum + line.quantity * line.unitCost + line.extraCost, 0);
    const editable = !selectedReceipt || selectedReceipt.status === 'draft';
    const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === receiptDraft.warehouseId && bin.isActive);

    return (
      <div className="warehouse-receipts-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Purchases</h2>
            <select value={receiptStatusFilter} onChange={(event) => setReceiptStatusFilter(event.target.value as typeof receiptStatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => { setSelectedReceiptId(''); setReceiptDraft(emptyReceiptDraft()); setReceiptLineDraft(emptyReceiptLineDraft()); }}>
            New purchase
          </button>
          {filteredReceipts.length ? (
            <div className="warehouse-receipt-list">
              {filteredReceipts.map((receipt) => {
                const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
                const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCost + line.extraCost, 0);
                return (
                  <button className={selectedReceiptId === receipt.id ? 'active' : ''} type="button" onClick={() => setSelectedReceiptId(receipt.id)} key={receipt.id}>
                    <strong>{receipt.invoiceNumber || receipt.poNumber || `Purchase ${receipt.id.slice(0, 8)}`}</strong>
                    <span>{purchaseStatusLabel(receipt.status)} - {receipt.receiptDate} - {money(total)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyWarehouseState title="No purchases yet" detail="Create a purchase, add parts, then complete it." />
          )}
        </section>

        <section className="warehouse-panel warehouse-receipt-editor">
          <div className="warehouse-panel-heading">
            <h2>{selectedReceipt ? `Purchase ${selectedReceipt.invoiceNumber || selectedReceipt.poNumber || selectedReceipt.id.slice(0, 8)}` : 'New purchase'}</h2>
            {selectedReceipt ? <span className={`warehouse-status ${selectedReceipt.status}`}>{selectedReceipt.status}</span> : null}
          </div>

          <div className="warehouse-form-grid">
            <label>Supplier
              <select value={receiptDraft.supplierId ?? ''} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, supplierId: event.target.value || null })}>
                <option value="">No supplier</option>
                {snapshot.suppliers.filter((supplier) => supplier.isActive).map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label>Warehouse
              <select value={receiptDraft.warehouseId} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, warehouseId: event.target.value, binId: null })}>
                <option value="">Select warehouse</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>
                ))}
              </select>
            </label>
            <label>Bin
              <select value={receiptDraft.binId ?? ''} disabled={!editable || !receiptDraft.warehouseId} onChange={(event) => setReceiptDraft({ ...receiptDraft, binId: event.target.value || null })}>
                <option value="">No bin</option>
                {binsForWarehouse.map((bin) => (
                  <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                ))}
              </select>
            </label>
            <label>Date<input type="date" value={receiptDraft.receiptDate} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, receiptDate: event.target.value })} /></label>
            <label>PO #<input value={receiptDraft.poNumber} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, poNumber: event.target.value })} /></label>
            <label>Invoice #<input value={receiptDraft.invoiceNumber} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, invoiceNumber: event.target.value })} /></label>
            <label>Notes<input value={receiptDraft.notes} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, notes: event.target.value })} /></label>
          </div>

          <div className="warehouse-form-actions">
            {editable ? <button className="secondary-button compact" type="button" onClick={saveReceiptDraft}>Save purchase</button> : null}
            {selectedReceipt?.status === 'draft' ? <button className="primary-button" type="button" onClick={() => postReceipt(selectedReceipt)}>Complete purchase</button> : null}
            {selectedReceipt?.status === 'posted' ? <button className="secondary-button compact danger-lite" type="button" onClick={() => cancelReceipt(selectedReceipt)}>Cancel purchase</button> : null}
          </div>

          {selectedReceipt?.postedAt ? <p className="warehouse-note">Posted {selectedReceipt.postedAt.slice(0, 16).replace('T', ' ')}</p> : null}
          {selectedReceipt?.canceledAt ? <p className="warehouse-note">Canceled {selectedReceipt.canceledAt.slice(0, 16).replace('T', ' ')} - {selectedReceipt.cancelReason}</p> : null}

          <div className="warehouse-receipt-lines">
            <div className="warehouse-panel-heading">
              <h2>Parts</h2>
              <strong>{money(receiptTotal)}</strong>
            </div>
            {editable ? (
              <div className="warehouse-line-editor">
                <select value={receiptLineDraft.itemId} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, itemId: event.target.value })}>
                  <option value="">Select item</option>
                  {snapshot.items.filter((item) => item.isActive).map((item) => (
                    <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>
                  ))}
                </select>
                <input type="number" min="0" value={receiptLineDraft.quantity} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, quantity: Number(event.target.value) || 0 })} aria-label="Quantity" />
                <input type="number" min="0" value={receiptLineDraft.unitCost} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, unitCost: Number(event.target.value) || 0 })} aria-label="Price each" />
                <input type="number" min="0" value={receiptLineDraft.extraCost} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, extraCost: Number(event.target.value) || 0 })} aria-label="Extra cost" />
                <button className="secondary-button compact" type="button" onClick={addReceiptLine}>Add line</button>
              </div>
            ) : null}

            {receiptLines.length ? (
              <div className="warehouse-table-wrap">
                <table className="warehouse-table receipt-lines">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Price each</th>
                      <th>Extra</th>
                      <th>Actual cost each</th>
                      <th>Total</th>
                      <th>Admin details</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {receiptLines.map((line) => {
                      const item = itemById.get(line.itemId);
                      const movement = snapshot.movements.find((row) => row.receiptLineId === line.id && row.movementType === 'receipt');
                      const landedUnitCost = line.quantity > 0 ? line.unitCost + line.extraCost / line.quantity : line.unitCost;
                      return (
                        <tr key={line.id}>
                          <td>{item?.internalName ?? 'Unknown item'}</td>
                          <td>{editable ? <input type="number" min="0" defaultValue={line.quantity} onBlur={(event) => updateReceiptLine(line, { quantity: Number(event.target.value) || 0 })} /> : formatQty(line.quantity, item?.unit)}</td>
                          <td>{editable ? <input type="number" min="0" defaultValue={line.unitCost} onBlur={(event) => updateReceiptLine(line, { unitCost: Number(event.target.value) || 0 })} /> : money(line.unitCost)}</td>
                          <td>{editable ? <input type="number" min="0" defaultValue={line.extraCost} onBlur={(event) => updateReceiptLine(line, { extraCost: Number(event.target.value) || 0 })} /> : money(line.extraCost)}</td>
                          <td>{money(landedUnitCost)}</td>
                          <td>{money(line.quantity * line.unitCost + line.extraCost)}</td>
                          <td>{movement ? `${money(movement.averageCostBefore ?? 0)} -> ${money(movement.averageCostAfter ?? 0)}` : '-'}</td>
                          <td>{editable ? <button className="secondary-button compact danger-lite" type="button" onClick={() => removeReceiptLine(line)}>Remove</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyWarehouseState title="No receipt lines" detail="Add at least one active inventory item before posting." />
            )}
          </div>

          {receiptMovements.length ? (
            <div>
              <div className="warehouse-panel-heading">
                <h2>Posted movements</h2>
              </div>
              {renderMovementTable(receiptMovements)}
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="warehouse-settings-grid">
        {renderCategoriesManager()}
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Locations</h2>
            <Settings size={18} aria-hidden="true" />
          </div>
          {snapshot.warehouses.length ? (
            <div className="warehouse-list">
              {snapshot.warehouses.map((warehouseRow) => (
                <div className="warehouse-list-row" key={warehouseRow.id}>
                  <strong>{warehouseRow.name}</strong>
                  <span>{warehouseRow.type.replace(/_/g, ' ')} - {warehouseRow.location || 'No address'}</span>
                </div>
              ))}
            </div>
          ) : <EmptyWarehouseState title="No locations yet" detail="Add a main stock room, office, or van." />}
          <button className="secondary-button compact" type="button" onClick={() => setFormMode('warehouse')}>Add location</button>
        </section>
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Suppliers</h2>
            <Package size={18} aria-hidden="true" />
          </div>
          {snapshot.suppliers.length ? renderSuppliers() : <EmptyWarehouseState title="No suppliers yet" detail="Add suppliers when you want to track purchase source and last price." />}
          <button className="secondary-button compact" type="button" onClick={() => setFormMode('supplier')}>Add supplier</button>
        </section>
      </div>
    );
  }

  function renderActiveForm() {
    if (formMode === 'warehouse') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add location</h2>
          <div className="warehouse-form-grid">
            <label>Name<input value={warehouseDraft.name} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, name: event.target.value })} /></label>
            <label>Type
              <select value={warehouseDraft.type} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, type: event.target.value as InventoryWarehouseDraft['type'] })}>
                <option value="main">Main</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Location<input value={warehouseDraft.location} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, location: event.target.value })} /></label>
            <label>Notes<input value={warehouseDraft.notes} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, notes: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveWarehouseDraft}>Save location</button>
          </div>
        </section>
      );
    }

    if (formMode === 'item') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add part</h2>
          <div className="warehouse-form-grid wide">
            <label>Name<input value={itemDraft.internalName} onChange={(event) => setItemDraft({ ...itemDraft, internalName: event.target.value })} /></label>
            <label>Part #<input value={itemDraft.partNumber} onChange={(event) => setItemDraft({ ...itemDraft, partNumber: event.target.value })} /></label>
            <label>Category
              {renderCategorySelect(itemDraft.categoryId, (categoryId) => setItemDraft({ ...itemDraft, categoryId, category: categoryPath(categoryId) === 'Uncategorized' ? '' : categoryPath(categoryId) }))}
            </label>
            <label>Photo<input disabled placeholder="Photo upload coming soon" /></label>
            <button className="secondary-button compact" type="button" onClick={() => { setCategoryPickerTarget('item'); setEditingCategoryId(''); setCategoryDraft(emptyCategoryDraft); setCategoryDraftOpen(true); }}>
              <Plus size={15} aria-hidden="true" /> Add category
            </button>
            {categoryPickerTarget === 'item' && categoryDraftOpen ? renderCategoryDraftForm(true) : null}
            <details className="warehouse-more-fields">
              <summary>More details</summary>
              <div className="warehouse-form-grid wide">
                <label>Manufacturer<input value={itemDraft.manufacturer} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer: event.target.value })} /></label>
                <label>OEM<input value={itemDraft.oem} onChange={(event) => setItemDraft({ ...itemDraft, oem: event.target.value })} /></label>
                <label>Alt part #<input value={itemDraft.alternatePartNumber} onChange={(event) => setItemDraft({ ...itemDraft, alternatePartNumber: event.target.value })} /></label>
                <label>Legacy category<input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /></label>
                <label>Unit<input value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /></label>
                <label>Minimum stock<input type="number" min="0" value={itemDraft.minimumQuantity} onChange={(event) => setItemDraft({ ...itemDraft, minimumQuantity: Number(event.target.value) || 0 })} /></label>
                <label>Description<input value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
                <label>Notes<input value={itemDraft.notes} onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value })} /></label>
              </div>
            </details>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveItemDraft}>Save part</button>
          </div>
        </section>
      );
    }

    if (formMode === 'stock') {
      const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === quickStockDraft.warehouseId && bin.isActive);
      const importedProduct = productImportDraft.preview;
      const importTotalQuantity = productImportDraft.packagesReceived * productImportDraft.unitsPerPackage;
      const importUnitCost = productImportDraft.unitsPerPackage > 0 ? productImportDraft.packagePrice / productImportDraft.unitsPerPackage : 0;
      const importExtraCost = productImportDraft.shippingCost + productImportDraft.taxCost + productImportDraft.otherCost;
      const matchedItem = productImportDraft.matchItemId ? itemById.get(productImportDraft.matchItemId) : null;
      const weakMatchedItems = productImportDraft.weakMatchItemIds.map((id) => itemById.get(id)).filter(Boolean) as InventoryItem[];
      const providerStatus = importedProduct?.providerStatus ?? 'complete';
      const providerStatusLabel = providerStatus === 'complete' ? 'Complete' : providerStatus === 'partial' ? 'Partial - review required' : 'Blocked - manual entry required';
      return (
        <section className="warehouse-form-panel stock">
          <h2>Add stock</h2>
          <div className="warehouse-import-bar in-form">
            <input
              value={productImportDraft.productUrl}
              onChange={(event) => setProductImportDraft({ ...productImportDraft, productUrl: event.target.value })}
              placeholder="Paste Amazon, eBay, or supplier product link"
            />
            <button className="secondary-button compact" type="button" onClick={() => importProductLink()}>Import product</button>
          </div>
          {importedProduct ? (
            <div className="warehouse-import-preview">
              {importedProduct.imageUrl ? <img src={importedProduct.imageUrl} alt="" /> : <div className="warehouse-import-photo">No photo</div>}
              <div className="warehouse-import-fields">
                <div className="warehouse-panel-heading">
                  <h3>Review imported fields</h3>
                  <span>{importedProduct.sourceDomain}</span>
                  <span className={`warehouse-provider-status ${providerStatus}`}>{providerStatusLabel}</span>
                </div>
                {matchedItem ? (
                  <div className="warehouse-match-box">
                    <strong>Possible existing part found</strong>
                    <span>{matchedItem.internalName} {matchedItem.partNumber ? `- ${matchedItem.partNumber}` : ''}</span>
                    <div>
                      <button className={!productImportDraft.createNewPart ? 'primary-button compact' : 'secondary-button compact'} type="button" onClick={() => setProductImportDraft({ ...productImportDraft, createNewPart: false })}>Use existing part</button>
                      <button className={productImportDraft.createNewPart ? 'primary-button compact' : 'secondary-button compact'} type="button" onClick={() => setProductImportDraft({ ...productImportDraft, createNewPart: true })}>Create new part</button>
                    </div>
                  </div>
                ) : null}
                {!matchedItem && weakMatchedItems.length ? (
                  <div className="warehouse-match-box weak">
                    <strong>Weak suggestions only</strong>
                    <span>These are title/model similarities. Choose one manually only if it is truly the same part.</span>
                    <div>
                      {weakMatchedItems.map((item) => (
                        <button className="secondary-button compact" type="button" key={item.id} onClick={() => setProductImportDraft({ ...productImportDraft, matchItemId: item.id, createNewPart: false })}>
                          {item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="warehouse-form-grid wide">
                  <label>Product name<input value={importedProduct.title} onChange={(event) => updateImportedProduct({ title: event.target.value })} /></label>
                  <label>Manufacturer / brand<input value={importedProduct.manufacturer || importedProduct.brand} onChange={(event) => updateImportedProduct({ manufacturer: event.target.value, brand: event.target.value })} /></label>
                  <label>Part Number / MPN<input value={importedProduct.partNumber} onChange={(event) => updateImportedProduct({ partNumber: event.target.value })} /></label>
                  <label>OEM / model<input value={importedProduct.oem || importedProduct.model} onChange={(event) => updateImportedProduct({ oem: event.target.value, model: event.target.value })} /></label>
                  <label>Supplier<input value={productImportDraft.supplierName} onChange={(event) => setProductImportDraft({ ...productImportDraft, supplierName: event.target.value, verified: false })} /></label>
                  <label>Category
                    {renderCategorySelect(productImportDraft.categoryId, (categoryId) => setProductImportDraft({ ...productImportDraft, categoryId, verified: false }))}
                  </label>
                  <button className="secondary-button compact" type="button" onClick={() => { setCategoryPickerTarget('import'); setEditingCategoryId(''); setCategoryDraft(emptyCategoryDraft); setCategoryDraftOpen(true); }}>
                    <Plus size={15} aria-hidden="true" /> Add category
                  </button>
                  <label>Supplier product ID<input value={importedProduct.externalProductId} onChange={(event) => updateImportedProduct({ externalProductId: event.target.value })} /></label>
                  <label>Source URL<input value={productImportDraft.sourceUrl} onChange={(event) => setProductImportDraft({ ...productImportDraft, sourceUrl: event.target.value, verified: false })} /></label>
                  <label>Description<input value={importedProduct.description} onChange={(event) => updateImportedProduct({ description: event.target.value })} /></label>
                </div>
                {categoryPickerTarget === 'import' && categoryDraftOpen ? renderCategoryDraftForm(true) : null}
                <div className="warehouse-form-grid wide">
                  <label>Purchase format
                    <select value={productImportDraft.unitsPerPackage > 1 ? 'pack' : 'individual'} onChange={(event) => setProductImportDraft({ ...productImportDraft, unitsPerPackage: event.target.value === 'individual' ? 1 : Math.max(2, productImportDraft.unitsPerPackage), verified: false })}>
                      <option value="individual">Individual item</option>
                      <option value="pack">Pack / box / case / roll / set</option>
                    </select>
                  </label>
                  <label>Quantity received<input type="number" min="0" value={productImportDraft.packagesReceived} onChange={(event) => setProductImportDraft({ ...productImportDraft, packagesReceived: Number(event.target.value) || 0, verified: false })} /></label>
                  <label>Units per pack<input type="number" min="1" value={productImportDraft.unitsPerPackage} onChange={(event) => setProductImportDraft({ ...productImportDraft, unitsPerPackage: Math.max(1, Number(event.target.value) || 1), verified: false })} /></label>
                  <label>Total stock quantity<input disabled value={formatQty(importTotalQuantity, 'pcs')} /></label>
                  <label>Price per pack<input type="number" min="0" value={productImportDraft.packagePrice} onChange={(event) => setProductImportDraft({ ...productImportDraft, packagePrice: Number(event.target.value) || 0, verified: false })} /></label>
                  <label>Calculated unit price<input disabled value={money(importUnitCost)} /></label>
                  <label>Shipping cost<input type="number" min="0" value={productImportDraft.shippingCost} onChange={(event) => setProductImportDraft({ ...productImportDraft, shippingCost: Number(event.target.value) || 0, verified: false })} /></label>
                  <label>Tax cost<input type="number" min="0" value={productImportDraft.taxCost} onChange={(event) => setProductImportDraft({ ...productImportDraft, taxCost: Number(event.target.value) || 0, verified: false })} /></label>
                  <label>Other cost<input type="number" min="0" value={productImportDraft.otherCost} onChange={(event) => setProductImportDraft({ ...productImportDraft, otherCost: Number(event.target.value) || 0, verified: false })} /></label>
                  <label>Shipping/tax/other cost<input disabled value={money(importExtraCost)} /></label>
                </div>
                {importedProduct.warnings.length ? <div className="warehouse-import-warnings">{importedProduct.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
                <label className="warehouse-confirm-row">
                  <input type="checkbox" checked={productImportDraft.verified} onChange={(event) => setProductImportDraft({ ...productImportDraft, verified: event.target.checked })} />
                  I reviewed the imported data, pack quantity, and price.
                </label>
              </div>
            </div>
          ) : null}
          <div className="warehouse-form-grid">
            <label>Part
              <select value={importedProduct ? productImportDraft.matchItemId : quickStockDraft.itemId} disabled={Boolean(importedProduct && productImportDraft.createNewPart)} onChange={(event) => {
                if (importedProduct) setProductImportDraft({ ...productImportDraft, matchItemId: event.target.value, createNewPart: false });
                setQuickStockDraft({ ...quickStockDraft, itemId: event.target.value });
              }}>
                <option value="">Select part</option>
                {snapshot.items.filter((item) => item.isActive).map((item) => (
                  <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>
                ))}
              </select>
            </label>
            <label>Quantity<input type="number" min="0" value={quickStockDraft.quantity} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, quantity: Number(event.target.value) || 0 })} /></label>
            <label>Price each<input type="number" min="0" value={quickStockDraft.unitCost} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, unitCost: Number(event.target.value) || 0 })} /></label>
            <label>Location
              <select value={quickStockDraft.warehouseId} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, warehouseId: event.target.value, binId: '' })}>
                <option value="">Select location</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>
                ))}
              </select>
            </label>
          </div>
          <details className="warehouse-more-fields" open={quickStockDraft.showMore} onToggle={(event) => setQuickStockDraft({ ...quickStockDraft, showMore: event.currentTarget.open })}>
            <summary>More options</summary>
            <div className="warehouse-form-grid wide">
              <label>Supplier
                <select value={quickStockDraft.supplierId} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, supplierId: event.target.value })}>
                  <option value="">No supplier</option>
                  {snapshot.suppliers.filter((supplier) => supplier.isActive).map((supplier) => (
                    <option value={supplier.id} key={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <label>Exact location
                <select value={quickStockDraft.binId} disabled={!quickStockDraft.warehouseId} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, binId: event.target.value })}>
                  <option value="">No exact location</option>
                  {binsForWarehouse.map((bin) => (
                    <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                  ))}
                </select>
              </label>
              <label>Extra cost<input type="number" min="0" value={quickStockDraft.extraCost} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, extraCost: Number(event.target.value) || 0 })} /></label>
              <label>Invoice #<input value={quickStockDraft.invoiceNumber} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, invoiceNumber: event.target.value })} /></label>
              <label>PO #<input value={quickStockDraft.poNumber} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, poNumber: event.target.value })} /></label>
              <label>Date<input type="date" value={quickStockDraft.receiptDate} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, receiptDate: event.target.value })} /></label>
              <label>Notes<input value={quickStockDraft.notes} onChange={(event) => setQuickStockDraft({ ...quickStockDraft, notes: event.target.value })} /></label>
            </div>
          </details>
          <div className="warehouse-form-actions sticky">
            <button className="secondary-button compact" type="button" onClick={() => { setProductImportDraft(emptyProductImportDraft()); setFormMode('none'); }}>Cancel</button>
            <button className="primary-button" type="button" disabled={importPosting} onClick={importedProduct ? addImportedStock : addQuickStock}>
              {importPosting ? 'Adding...' : 'Add to stock'}
            </button>
          </div>
        </section>
      );
    }

    if (formMode === 'move') {
      const selectedItem = itemById.get(moveDraft.itemId);
      const fromBins = snapshot.bins.filter((bin) => bin.warehouseId === moveDraft.fromWarehouseId && bin.isActive);
      const toBins = snapshot.bins.filter((bin) => bin.warehouseId === moveDraft.toWarehouseId && bin.isActive);
      const availableQuantity = snapshot.stockBalances
        .filter((balance) => balance.itemId === moveDraft.itemId
          && balance.warehouseId === moveDraft.fromWarehouseId
          && (moveDraft.fromBinId ? balance.binId === moveDraft.fromBinId : balance.binId == null))
        .reduce((sum, balance) => sum + balance.quantity, 0);
      const sameLocation = Boolean(moveDraft.fromWarehouseId && moveDraft.toWarehouseId
        && moveDraft.fromWarehouseId === moveDraft.toWarehouseId
        && (moveDraft.fromBinId || '') === (moveDraft.toBinId || ''));
      return (
        <section className="warehouse-form-panel stock">
          <h2>Move between locations</h2>
          <div className="warehouse-form-grid">
            <label>Part
              <select value={moveDraft.itemId} onChange={(event) => {
                const item = itemById.get(event.target.value);
                const location = item ? preferredIssueLocation(item) : { warehouseId: '', binId: '', quantity: 1 };
                setMoveDraft({ ...moveDraft, itemId: event.target.value, fromWarehouseId: location.warehouseId, fromBinId: location.binId, quantity: location.quantity });
              }}>
                <option value="">Select part</option>
                {snapshot.items.filter((item) => item.isActive).map((item) => (
                  <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>
                ))}
              </select>
            </label>
            <label>From location
              <select value={moveDraft.fromWarehouseId} onChange={(event) => setMoveDraft({ ...moveDraft, fromWarehouseId: event.target.value, fromBinId: '' })}>
                <option value="">Select location</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}{warehouseRow.type === 'technician_vehicle' ? ' - technician vehicle' : ''}</option>
                ))}
              </select>
            </label>
            <label>To location
              <select value={moveDraft.toWarehouseId} onChange={(event) => setMoveDraft({ ...moveDraft, toWarehouseId: event.target.value, toBinId: '' })}>
                <option value="">Select location</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}{warehouseRow.type === 'technician_vehicle' ? ' - technician vehicle' : ''}</option>
                ))}
              </select>
            </label>
            <label>Quantity<input type="number" min="0" value={moveDraft.quantity} onChange={(event) => setMoveDraft({ ...moveDraft, quantity: Number(event.target.value) || 0 })} /></label>
          </div>
          <details className="warehouse-more-fields" open>
            <summary>Exact locations</summary>
            <div className="warehouse-form-grid wide">
              <label>From exact location
                <select value={moveDraft.fromBinId ?? ''} disabled={!moveDraft.fromWarehouseId} onChange={(event) => setMoveDraft({ ...moveDraft, fromBinId: event.target.value })}>
                  <option value="">No exact location</option>
                  {fromBins.map((bin) => (
                    <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                  ))}
                </select>
              </label>
              <label>To exact location
                <select value={moveDraft.toBinId ?? ''} disabled={!moveDraft.toWarehouseId} onChange={(event) => setMoveDraft({ ...moveDraft, toBinId: event.target.value })}>
                  <option value="">No exact location</option>
                  {toBins.map((bin) => (
                    <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                  ))}
                </select>
              </label>
              <label>Available<input disabled value={selectedItem ? formatQty(availableQuantity, selectedItem.unit) : 'Select part'} /></label>
              <label>Cost moved at<input disabled value={selectedItem ? money(selectedItem.averageCost) : '-'} /></label>
              <label>Notes<input value={moveDraft.notes ?? ''} onChange={(event) => setMoveDraft({ ...moveDraft, notes: event.target.value })} /></label>
            </div>
          </details>
          {sameLocation ? <p className="warehouse-note warning">Choose a different destination location before posting.</p> : null}
          <div className="warehouse-form-actions sticky">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" disabled={sameLocation} onClick={moveStock}>Move stock</button>
          </div>
        </section>
      );
    }

    if (formMode === 'jobIssue') {
      const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === jobIssueDraft.warehouseId && bin.isActive);
      const selectedItem = itemById.get(jobIssueDraft.itemId);
      const availableQuantity = snapshot.stockBalances
        .filter((balance) => balance.itemId === jobIssueDraft.itemId
          && balance.warehouseId === jobIssueDraft.warehouseId
          && (jobIssueDraft.binId ? balance.binId === jobIssueDraft.binId : balance.binId == null))
        .reduce((sum, balance) => sum + balance.quantity, 0);
      return (
        <section className="warehouse-form-panel stock">
          <h2>Use on Job</h2>
          <div className="warehouse-form-grid">
            <label>Part
              <select value={jobIssueDraft.itemId} onChange={(event) => {
                const item = itemById.get(event.target.value);
                const location = item ? preferredIssueLocation(item) : { warehouseId: '', binId: '', quantity: 1 };
                setJobIssueDraft({ ...jobIssueDraft, itemId: event.target.value, warehouseId: location.warehouseId, binId: location.binId, quantity: location.quantity });
              }}>
                <option value="">Select part</option>
                {snapshot.items.filter((item) => item.isActive).map((item) => (
                  <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>
                ))}
              </select>
            </label>
            <label>Job
              <select value={jobIssueDraft.jobId} onChange={(event) => setJobIssueDraft({ ...jobIssueDraft, jobId: event.target.value })}>
                <option value="">Select Job</option>
                {activeJobs.map((job) => (
                  <option value={job.id} key={job.id}>#{job.jobNumber} - {[job.system, job.issue, job.status].filter(Boolean).join(' - ')}</option>
                ))}
              </select>
            </label>
            <label>Location
              <select value={jobIssueDraft.warehouseId} onChange={(event) => setJobIssueDraft({ ...jobIssueDraft, warehouseId: event.target.value, binId: '' })}>
                <option value="">Select location</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}{warehouseRow.type === 'technician_vehicle' ? ' - technician vehicle' : ''}</option>
                ))}
              </select>
            </label>
            <label>Quantity<input type="number" min="0" value={jobIssueDraft.quantity} onChange={(event) => setJobIssueDraft({ ...jobIssueDraft, quantity: Number(event.target.value) || 0 })} /></label>
          </div>
          <details className="warehouse-more-fields">
            <summary>More options</summary>
            <div className="warehouse-form-grid wide">
              <label>Exact location
                <select value={jobIssueDraft.binId ?? ''} disabled={!jobIssueDraft.warehouseId} onChange={(event) => setJobIssueDraft({ ...jobIssueDraft, binId: event.target.value })}>
                  <option value="">No exact location</option>
                  {binsForWarehouse.map((bin) => (
                    <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                  ))}
                </select>
              </label>
              <label>Notes<input value={jobIssueDraft.notes ?? ''} onChange={(event) => setJobIssueDraft({ ...jobIssueDraft, notes: event.target.value })} /></label>
              <label>Available<input disabled value={selectedItem ? formatQty(availableQuantity, selectedItem.unit) : 'Select part'} /></label>
              <label>Cost locked at<input disabled value={selectedItem ? money(selectedItem.averageCost) : '-'} /></label>
            </div>
          </details>
          <div className="warehouse-form-actions sticky">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={issuePartToJob}>Post to Job</button>
          </div>
        </section>
      );
    }

    if (formMode === 'jobReturn') {
      const selectedMovement = snapshot.movements.find((movement) => movement.id === jobReturnDraft.movementId);
      const selectedItem = selectedMovement ? itemById.get(selectedMovement.itemId) : null;
      const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === jobReturnDraft.warehouseId && bin.isActive);
      return (
        <section className="warehouse-form-panel stock">
          <h2>Return unused part</h2>
          <div className="warehouse-form-grid">
            <label>Original issue
              <select value={jobReturnDraft.movementId} onChange={(event) => {
                const movement = snapshot.movements.find((row) => row.id === event.target.value);
                setJobReturnDraft({
                  ...jobReturnDraft,
                  movementId: event.target.value,
                  warehouseId: movement?.fromWarehouseId ?? '',
                  binId: movement?.fromBinId ?? '',
                });
              }}>
                <option value="">Select issue</option>
                {snapshot.movements.filter((movement) => movement.movementType === 'job_issue').map((movement) => {
                  const item = itemById.get(movement.itemId);
                  const job = movement.jobId ? jobById.get(movement.jobId) : null;
                  return (
                    <option value={movement.id} key={movement.id}>{item?.internalName ?? 'Part'} - Job #{job?.jobNumber ?? movement.referenceNumber}</option>
                  );
                })}
              </select>
            </label>
            <label>Return quantity<input type="number" min="0" value={jobReturnDraft.quantity} onChange={(event) => setJobReturnDraft({ ...jobReturnDraft, quantity: Number(event.target.value) || 0 })} /></label>
            <label>Return to
              <select value={jobReturnDraft.warehouseId ?? ''} onChange={(event) => setJobReturnDraft({ ...jobReturnDraft, warehouseId: event.target.value, binId: '' })}>
                <option value="">Original location</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}{warehouseRow.type === 'technician_vehicle' ? ' - technician vehicle' : ''}</option>
                ))}
              </select>
            </label>
            <label>Cost returned at<input disabled value={selectedMovement ? money(selectedMovement.unitCost) : '-'} /></label>
          </div>
          <details className="warehouse-more-fields">
            <summary>More options</summary>
            <div className="warehouse-form-grid wide">
              <label>Exact location
                <select value={jobReturnDraft.binId ?? ''} disabled={!jobReturnDraft.warehouseId} onChange={(event) => setJobReturnDraft({ ...jobReturnDraft, binId: event.target.value })}>
                  <option value="">No exact location</option>
                  {binsForWarehouse.map((bin) => (
                    <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                  ))}
                </select>
              </label>
              <label>Notes<input value={jobReturnDraft.notes ?? ''} onChange={(event) => setJobReturnDraft({ ...jobReturnDraft, notes: event.target.value })} /></label>
              <label>Part<input disabled value={selectedItem?.internalName ?? '-'} /></label>
            </div>
          </details>
          <div className="warehouse-form-actions sticky">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={returnJobPart}>Return to stock</button>
          </div>
        </section>
      );
    }

    if (formMode === 'supplier') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add supplier</h2>
          <div className="warehouse-form-grid">
            <label>Name<input value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })} /></label>
            <label>Contact<input value={supplierDraft.contactName} onChange={(event) => setSupplierDraft({ ...supplierDraft, contactName: event.target.value })} /></label>
            <label>Phone<input value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} /></label>
            <label>Email<input value={supplierDraft.email} onChange={(event) => setSupplierDraft({ ...supplierDraft, email: event.target.value })} /></label>
            <label>Website<input value={supplierDraft.website} onChange={(event) => setSupplierDraft({ ...supplierDraft, website: event.target.value })} /></label>
            <label>Address<input value={supplierDraft.address} onChange={(event) => setSupplierDraft({ ...supplierDraft, address: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveSupplierDraft}>Save supplier</button>
          </div>
        </section>
      );
    }

    return null;
  }

  return (
    <section className="warehouse-page">
      <div className="warehouse-header">
        <div>
          <p className="eyebrow">Inventory control</p>
          <h1>Warehouse</h1>
          {status ? <p className="access-status">{status}</p> : null}
        </div>
        <div className="warehouse-header-actions">
          <button className="secondary-button compact" type="button" onClick={openQuickStock}>
            <Plus size={16} aria-hidden="true" />
            Add stock
          </button>
          <button className="primary-button" type="button" onClick={() => setFormMode('item')}>
            <Boxes size={16} aria-hidden="true" />
            Add part
          </button>
        </div>
      </div>

      <div className="warehouse-tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab.key ? 'active' : ''} type="button" onClick={() => setActiveTab(tab.key)} key={tab.key}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'parts' ? (
        <>
          <div className="warehouse-toolbar simplified">
            <label>
              Search parts
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, part #, OEM, manufacturer, description" />
            </label>
            <label>
              Location
              <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)}>
                <option value="all">All locations</option>
                {snapshot.warehouses.map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">All categories</option>
                {rootCategories.map((category) => (
                  <optgroup label={category.name} key={category.id}>
                    <option value={category.id}>{category.name}</option>
                    {(categoryChildrenByParent.get(category.id) ?? []).map((child) => (
                      <option value={child.id} key={child.id}>{child.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={partsStatusFilter} onChange={(event) => setPartsStatusFilter(event.target.value as PartsStatusFilter)}>
                <option value="all">All statuses</option>
                <option value="in">In stock</option>
                <option value="low">Low</option>
                <option value="out">Out of stock</option>
              </select>
            </label>
            <span className="warehouse-load-state">{loading ? 'Loading...' : `${summary.items} parts`}</span>
          </div>
          <div className="warehouse-filter-row">
            <span><strong>All Parts</strong></span>
            <span><strong>{lowStockItems.length}</strong> low stock</span>
            <span><strong>{money(summary.inventoryValue)}</strong> inventory value</span>
          </div>
        </>
      ) : null}

      {renderActiveForm()}

      {activeTab === 'parts' ? renderPartsList(filteredItems) : null}
      {activeTab === 'purchases' ? renderPurchases() : null}
      {activeTab === 'activity' ? renderActivity() : null}
      {activeTab === 'settings' ? renderSettings() : null}

      <div className="warehouse-warning">
        <AlertTriangle size={17} aria-hidden="true" />
        <span>Receipts, moves, Job use, and Job returns post through PostgreSQL RPC with locks. Adjustments are reserved for a later stage.</span>
      </div>
    </section>
  );
}
