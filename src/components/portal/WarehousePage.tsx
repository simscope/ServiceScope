import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ChevronDown, History, MapPin, Package, Plus, Settings, Truck, Warehouse } from 'lucide-react';
import {
  cancelInventoryReceipt,
  createInventoryItem,
  createInventoryReceipt,
  createInventoryReceiptLine,
  createInventorySupplier,
  createInventoryWarehouse,
  deleteInventoryReceiptLine,
  importInventoryProductUrl,
  issueInventoryPartToJob,
  listWarehouseSnapshot,
  normalizeSupplierUrl,
  postInventoryReceipt,
  returnInventoryJobPart,
  updateInventoryReceipt,
  updateInventoryReceiptLine,
  upsertInventoryItemSupplier,
  upsertInventorySupplierLink,
  warehouseErrorMessage,
  type ImportedInventoryProduct,
  type InventoryItem,
  type InventoryItemDraft,
  type InventoryReceiptDraft,
  type InventoryReceiptLineDraft,
  type InventorySupplierDraft,
  type InventoryWarehouseDraft,
  type InventoryJobIssueDraft,
  type InventoryJobReturnDraft,
  type InventoryStockReceipt,
  type InventoryStockReceiptLine,
  type InventorySupplier,
  type WarehouseSnapshot,
} from '../../services/warehouseStore';
import { money } from '../../utils/format';

type WarehouseTab = 'parts' | 'purchases' | 'activity' | 'settings';

type WarehousePageProps = {
  companyId: string;
};

type WarehouseFormMode = 'none' | 'warehouse' | 'item' | 'supplier' | 'stock' | 'jobIssue' | 'jobReturn';
type PartsFilter = 'all' | 'low' | 'out';
type ActivityFilter = 'all' | 'received' | 'used' | 'moved' | 'adjustments';

const emptySnapshot: WarehouseSnapshot = {
  warehouses: [],
  bins: [],
  items: [],
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
  manufacturer: '',
  oem: '',
  partNumber: '',
  alternatePartNumber: '',
  description: '',
  unit: 'pcs',
  minimumQuantity: 0,
  notes: '',
};

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
  productUrl: string;
  preview: ImportedInventoryProduct | null;
  matchItemId: string;
  createNewPart: boolean;
  packagesReceived: number;
  unitsPerPackage: number;
  packagePrice: number;
  shippingCost: number;
  taxCost: number;
  otherCost: number;
  supplierName: string;
  sourceUrl: string;
  verified: boolean;
};

const emptyProductImportDraft = (): ProductImportDraft => ({
  productUrl: '',
  preview: null,
  matchItemId: '',
  createNewPart: false,
  packagesReceived: 1,
  unitsPerPackage: 1,
  packagePrice: 0,
  shippingCost: 0,
  taxCost: 0,
  otherCost: 0,
  supplierName: '',
  sourceUrl: '',
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

function formatQty(value: number, unit = '') {
  const clean = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${clean} ${unit}` : clean;
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

export function WarehousePage({ companyId }: WarehousePageProps) {
  const [activeTab, setActiveTab] = useState<WarehouseTab>('parts');
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [partsFilter, setPartsFilter] = useState<PartsFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [snapshot, setSnapshot] = useState<WarehouseSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [formMode, setFormMode] = useState<WarehouseFormMode>('none');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [warehouseDraft, setWarehouseDraft] = useState<InventoryWarehouseDraft>(emptyWarehouseDraft);
  const [itemDraft, setItemDraft] = useState<InventoryItemDraft>(emptyItemDraft);
  const [supplierDraft, setSupplierDraft] = useState<InventorySupplierDraft>(emptySupplierDraft);
  const [receiptDraft, setReceiptDraft] = useState<InventoryReceiptDraft>(() => emptyReceiptDraft());
  const [receiptLineDraft, setReceiptLineDraft] = useState<InventoryReceiptLineDraft>(() => emptyReceiptLineDraft());
  const [quickStockDraft, setQuickStockDraft] = useState(() => emptyQuickStockDraft());
  const [productImportDraft, setProductImportDraft] = useState<ProductImportDraft>(() => emptyProductImportDraft());
  const [jobIssueDraft, setJobIssueDraft] = useState<InventoryJobIssueDraft>(() => emptyJobIssueDraft());
  const [jobReturnDraft, setJobReturnDraft] = useState<InventoryJobReturnDraft>(() => emptyJobReturnDraft());
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
    const normalizedUrl = normalizeSupplierUrl(product.canonicalUrl || product.sourceDomain || product.title);
    const externalId = (product.externalProductId || product.asin || product.ebayItemId || '').trim().toLowerCase();
    const linkedMatch = snapshot.supplierLinks.find((link) => {
      const linkExternal = (link.externalProductId || link.asin || link.ebayItemId).trim().toLowerCase();
      return Boolean(
        (externalId && linkExternal === externalId) ||
        (normalizedUrl && (link.canonicalUrlNormalized === normalizedUrl || link.sourceUrlNormalized === normalizedUrl)),
      );
    });
    if (linkedMatch) return linkedMatch.itemId;

    const partNumber = product.partNumber.trim().toLowerCase();
    if (partNumber) {
      const partMatch = snapshot.items.find((item) => [item.partNumber, item.alternatePartNumber, item.oem].some((value) => value.trim().toLowerCase() === partNumber));
      if (partMatch) return partMatch.id;
    }

    const model = (product.model || product.oem).trim().toLowerCase();
    const maker = (product.manufacturer || product.brand).trim().toLowerCase();
    if (model && maker) {
      const modelMatch = snapshot.items.find((item) => (item.manufacturer || '').trim().toLowerCase() === maker && [item.oem, item.partNumber, item.alternatePartNumber].some((value) => value.trim().toLowerCase() === model));
      if (modelMatch) return modelMatch.id;
    }

    const normalizedName = product.title.trim().toLowerCase();
    if (normalizedName) {
      const nameMatch = snapshot.items.find((item) => item.internalName.trim().toLowerCase() === normalizedName);
      if (nameMatch) return nameMatch.id;
    }
    return '';
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
      const matchItemId = findImportMatch(preview);
      setProductImportDraft({
        ...emptyProductImportDraft(),
        productUrl: cleanUrl,
        sourceUrl: preview.canonicalUrl || cleanUrl,
        preview,
        matchItemId,
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
      setStatus(matchItemId ? 'Possible existing part found. Review the imported product before adding stock.' : 'Review the imported product before adding stock.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function ensureImportSupplier(name: string, product: ImportedInventoryProduct): Promise<InventorySupplier | null> {
    const cleanName = name.trim();
    if (!cleanName) return null;
    const existing = snapshot.suppliers.find((supplier) => supplier.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (existing) return existing;
    return createInventorySupplier(companyId, {
      name: cleanName,
      contactName: '',
      phone: '',
      email: '',
      website: product.canonicalUrl || product.sourceDomain,
      address: '',
    });
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
      setStatus('Price per pack is required.');
      return;
    }
    if (!productImportDraft.verified) {
      setStatus('Review and confirm the imported fields before adding stock.');
      return;
    }

    const totalQuantity = Number(productImportDraft.packagesReceived) * Number(productImportDraft.unitsPerPackage);
    const unitCost = Number(productImportDraft.packagePrice) / Number(productImportDraft.unitsPerPackage);
    const extraCost = Number(productImportDraft.shippingCost) + Number(productImportDraft.taxCost) + Number(productImportDraft.otherCost);

    setStatus('Adding imported product to stock...');
    try {
      let itemId = productImportDraft.matchItemId;
      if (!itemId || productImportDraft.createNewPart) {
        const exactExisting = findImportMatch(product);
        if (exactExisting && !productImportDraft.createNewPart) {
          itemId = exactExisting;
        } else {
          const created = await createInventoryItem(companyId, {
            internalName: itemName,
            category: '',
            manufacturer: product.manufacturer || product.brand,
            oem: product.oem || product.model,
            partNumber: product.partNumber,
            alternatePartNumber: product.asin || product.ebayItemId || '',
            description: product.description,
            unit: 'pcs',
            minimumQuantity: 0,
            notes: product.imageUrl ? `Imported image source: ${product.imageUrl}` : '',
          });
          itemId = created.id;
        }
      }

      const supplier = await ensureImportSupplier(productImportDraft.supplierName, product);
      const savedReceipt = await createInventoryReceipt(companyId, {
        supplierId: supplier?.id ?? null,
        warehouseId: quickStockDraft.warehouseId,
        binId: quickStockDraft.binId || null,
        receiptDate: quickStockDraft.receiptDate,
        poNumber: quickStockDraft.poNumber,
        invoiceNumber: quickStockDraft.invoiceNumber,
        notes: `Imported from ${productImportDraft.sourceUrl || product.canonicalUrl || productImportDraft.productUrl}`,
      });
      await createInventoryReceiptLine(companyId, {
        receiptId: savedReceipt.id,
        itemId,
        quantity: totalQuantity,
        unitCost,
        extraCost,
        currency: product.currency || 'USD',
      });
      await postInventoryReceipt(savedReceipt.id);
      if (supplier) {
        await upsertInventoryItemSupplier(companyId, itemId, supplier.id, {
          supplierPartNumber: product.partNumber || product.externalProductId,
          supplierDescription: product.title,
          lastUnitCost: unitCost,
          currency: product.currency || 'USD',
          productUrl: productImportDraft.sourceUrl || product.canonicalUrl || productImportDraft.productUrl,
        });
      }
      await upsertInventorySupplierLink(companyId, {
        itemId,
        supplierId: supplier?.id ?? null,
        sourceType: product.sourceType,
        sourceDomain: product.sourceDomain,
        sourceUrl: productImportDraft.productUrl,
        canonicalUrl: productImportDraft.sourceUrl || product.canonicalUrl || productImportDraft.productUrl,
        externalProductId: product.externalProductId,
        asin: product.asin,
        ebayItemId: product.ebayItemId,
        supplierPartNumber: product.partNumber,
        lastTitle: product.title,
        lastImageUrl: product.imageUrl,
        lastVendorPrice: Number(productImportDraft.packagePrice),
        currency: product.currency || 'USD',
        packQuantity: Number(productImportDraft.unitsPerPackage),
      });

      setProductImportDraft(emptyProductImportDraft());
      setQuickStockDraft(emptyQuickStockDraft());
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Imported product added to stock.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
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
      low: item ? balance.quantity <= item.minimumQuantity : false,
    };
  }), [itemById, snapshot.stockBalances, warehouseById]);

  const selectedWarehouse = warehouseFilter === 'all' ? null : warehouseById.get(warehouseFilter) ?? null;
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

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.items.filter((item) => {
      const haystack = [
        item.internalName,
        item.category,
        item.manufacturer,
        item.oem,
        item.partNumber,
        item.alternatePartNumber,
        item.description,
      ].join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      const quantity = itemDisplayQuantity(item);
      if (partsFilter === 'low') return item.minimumQuantity > 0 && quantity <= item.minimumQuantity;
      if (partsFilter === 'out') return quantity <= 0;
      return true;
    });
  }, [itemQuantityBySelectedWarehouse, partsFilter, search, snapshot.items, warehouseFilter]);

  const filteredStockRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stockRows.filter(({ balance, item, warehouse: warehouseRow }) => {
      const matchesWarehouse = warehouseFilter === 'all' || balance.warehouseId === warehouseFilter;
      const haystack = `${item?.internalName ?? ''} ${item?.partNumber ?? ''} ${warehouseRow?.name ?? ''}`.toLowerCase();
      return matchesWarehouse && (!query || haystack.includes(query));
    });
  }, [search, stockRows, warehouseFilter]);

  const lowStockItems = useMemo(
    () => snapshot.items.filter((item) => item.minimumQuantity > 0 && itemDisplayQuantity(item) <= item.minimumQuantity),
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
          const isOut = quantity <= 0;
          const isLow = item.minimumQuantity > 0 && quantity <= item.minimumQuantity;
          const isSelected = selectedPartId === item.id;
          return (
            <article className={`warehouse-part-card${isSelected ? ' selected' : ''}`} key={item.id}>
              <button className="warehouse-part-main" type="button" onClick={() => setSelectedPartId(isSelected ? '' : item.id)}>
                <span className="warehouse-part-photo">{item.internalName.slice(0, 1).toUpperCase()}</span>
                <span className="warehouse-part-copy">
                  <strong>{item.internalName}</strong>
                  <small>{itemSubtitle(item)}</small>
                  <small>{itemLocationSummary(item)}</small>
                </span>
                <span className="warehouse-part-stock">
                  <strong>{formatQty(quantity, item.unit)}</strong>
                  <small>{selectedWarehouse ? selectedWarehouse.name : 'available'}</small>
                </span>
                {isOut ? <span className="warehouse-pill danger">Out</span> : isLow ? <span className="warehouse-pill warning">Low</span> : null}
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              <div className="warehouse-part-actions">
                <button className="primary-button compact" type="button" onClick={() => startReceiptForItem(item)}>Add stock</button>
                <button className="secondary-button compact" type="button" disabled={quantity <= 0} onClick={() => startIssueForItem(item)}>Use on Job</button>
                <button className="secondary-button compact" type="button" disabled title="Transfers are Stage 3">Move</button>
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
            <label>Photo<input disabled placeholder="Photo upload coming soon" /></label>
            <details className="warehouse-more-fields">
              <summary>More details</summary>
              <div className="warehouse-form-grid wide">
                <label>Manufacturer<input value={itemDraft.manufacturer} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer: event.target.value })} /></label>
                <label>OEM<input value={itemDraft.oem} onChange={(event) => setItemDraft({ ...itemDraft, oem: event.target.value })} /></label>
                <label>Alt part #<input value={itemDraft.alternatePartNumber} onChange={(event) => setItemDraft({ ...itemDraft, alternatePartNumber: event.target.value })} /></label>
                <label>Category<input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /></label>
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
                <div className="warehouse-form-grid wide">
                  <label>Product name<input value={importedProduct.title} onChange={(event) => updateImportedProduct({ title: event.target.value })} /></label>
                  <label>Manufacturer / brand<input value={importedProduct.manufacturer || importedProduct.brand} onChange={(event) => updateImportedProduct({ manufacturer: event.target.value, brand: event.target.value })} /></label>
                  <label>Part Number / MPN<input value={importedProduct.partNumber} onChange={(event) => updateImportedProduct({ partNumber: event.target.value })} /></label>
                  <label>OEM / model<input value={importedProduct.oem || importedProduct.model} onChange={(event) => updateImportedProduct({ oem: event.target.value, model: event.target.value })} /></label>
                  <label>Supplier<input value={productImportDraft.supplierName} onChange={(event) => setProductImportDraft({ ...productImportDraft, supplierName: event.target.value, verified: false })} /></label>
                  <label>Supplier product ID<input value={importedProduct.externalProductId} onChange={(event) => updateImportedProduct({ externalProductId: event.target.value })} /></label>
                  <label>Source URL<input value={productImportDraft.sourceUrl} onChange={(event) => setProductImportDraft({ ...productImportDraft, sourceUrl: event.target.value, verified: false })} /></label>
                  <label>Description<input value={importedProduct.description} onChange={(event) => updateImportedProduct({ description: event.target.value })} /></label>
                </div>
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
            <button className="primary-button" type="button" onClick={importedProduct ? addImportedStock : addQuickStock}>Add to stock</button>
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
            <span className="warehouse-load-state">{loading ? 'Loading...' : `${summary.items} parts`}</span>
          </div>
          <div className="warehouse-filter-row">
            {(['all', 'low', 'out'] as PartsFilter[]).map((filter) => (
              <button className={partsFilter === filter ? 'active' : ''} type="button" onClick={() => setPartsFilter(filter)} key={filter}>
                {filter === 'all' ? 'All' : filter === 'low' ? 'Low stock' : 'Out of stock'}
              </button>
            ))}
            <span><strong>{lowStockItems.length}</strong> low stock</span>
            <span><strong>{money(summary.inventoryValue)}</strong> inventory value</span>
          </div>
          <div className="warehouse-import-bar">
            <input
              value={productImportDraft.productUrl}
              onChange={(event) => setProductImportDraft({ ...productImportDraft, productUrl: event.target.value })}
              placeholder="Paste Amazon, eBay, or supplier product link"
            />
            <button className="secondary-button compact" type="button" onClick={() => importProductLink()}>Import product</button>
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
        <span>Receipts, Job use, and Job returns post through PostgreSQL RPC with locks. Moves and adjustments are reserved for later stages.</span>
      </div>
    </section>
  );
}
