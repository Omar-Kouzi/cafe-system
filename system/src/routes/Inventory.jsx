import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  FiAlertTriangle,
  FiCalendar,
  FiChevronDown,
  FiDownload,
  FiEdit2,
  FiFilter,
  FiClock,
  FiPackage,
  FiPlus,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";

import { db } from "../assets/firebase/config";
import "../styles/Inventory.css";

const ITEMS_COLLECTION = "inventoryItems";
const MOVEMENTS_COLLECTION = "inventoryMovements";

const CATEGORIES = [
  "Ingredients",
  "Packaging",
  "Cleaning supplies",
  "Finished products",
];

const UNITS = [
  "kg",
  "g",
  "L",
  "ml",
  "pieces",
  "cans",
  "jars",
  "cartons",
  "packs",
  "boxes",
  "bags",
  "bottles",
  "rolls",
];

const EMPTY_FORM = {
  name: "",
  category: "Ingredients",
  quantity: "0",
  unit: "kg",
  packageContentsAmount: "",
  packageContentsUnit: "g",
  minStock: "1",
  unitCost: "0",
  supplier: "",
  expiryDate: "",
  notes: "",
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatQuantity(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(toNumber(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function getStockStatus(item) {
  const quantity = toNumber(item.quantity);
  const minimum = toNumber(item.minStock);

  if (quantity <= 0) {
    return { label: "Out of stock", className: "out" };
  }

  if (quantity <= minimum) {
    return { label: "Low stock", className: "low" };
  }

  return { label: "In stock", className: "good" };
}

function getExpiryStatus(item) {
  if (!item.expiryDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(`${item.expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;

  const days = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);

  if (days < 0) {
    return { label: "Expired", className: "expired", days };
  }

  if (days <= 7) {
    return {
      label: days === 0 ? "Expires today" : `Expires in ${days}d`,
      className: "expiring",
      days,
    };
  }

  return { label: "Valid", className: "good", days };
}

function dateFromTimestamp(timestamp) {
  if (!timestamp) return "—";

  const date =
    typeof timestamp.toDate === "function"
      ? timestamp.toDate()
      : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString();
}

function downloadCSV(filename, rows) {
  if (!rows.length) {
    window.alert("There is no data to export.");
    return;
  }

  const escapeCSV = (value) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = rows.map((row) => row.map(escapeCSV).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Inventory() {
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [sortBy, setSortBy] = useState("name");

  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [movementItem, setMovementItem] = useState(null);
  const [movementType, setMovementType] = useState("received");
  const [movementDirection, setMovementDirection] = useState("add");
  const [movementQuantity, setMovementQuantity] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  const [historyItem, setHistoryItem] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [movementToDelete, setMovementToDelete] = useState(null);
  const [historyDeletePasscode, setHistoryDeletePasscode] = useState("");
  const [historyDeleteError, setHistoryDeleteError] = useState("");
  const [deletingHistory, setDeletingHistory] = useState(false);

  useEffect(() => {
    let firstSnapshot = true;

    const unsubscribeItems = onSnapshot(
      collection(db, ITEMS_COLLECTION),
      (snapshot) => {
        setItems(
          snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })),
        );
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Inventory subscription failed:", err);
        setError(
          "Could not load inventory. Check your internet connection and Firestore security rules.",
        );
        setLoading(false);
      },
    );

    const unsubscribeMovements = onSnapshot(
      collection(db, MOVEMENTS_COLLECTION),
      (snapshot) => {
        setMovements(
          snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })),
        );
        firstSnapshot = false;
      },
      (err) => {
        console.error("Movement subscription failed:", err);
        if (firstSnapshot) {
          setError(
            (current) =>
              current ||
              "Inventory loaded, but movement history could not be loaded. Check Firestore permissions.",
          );
        }
      },
    );

    return () => {
      unsubscribeItems();
      unsubscribeMovements();
    };
  }, []);

  const filteredItems = useMemo(() => {
    const searchText = search.trim().toLowerCase();

    const result = items.filter((item) => {
      const matchesSearch = (item.name || "")
        .toLowerCase()
        .includes(searchText);

      const matchesCategory =
        categoryFilter === "All categories" || item.category === categoryFilter;

      const stockStatus = getStockStatus(item);
      const expiryStatus = getExpiryStatus(item);

      let matchesStatus = true;

      if (statusFilter === "Low stock") {
        matchesStatus = stockStatus.className === "low";
      } else if (statusFilter === "Out of stock") {
        matchesStatus = stockStatus.className === "out";
      } else if (statusFilter === "Expiring soon") {
        matchesStatus = expiryStatus?.className === "expiring";
      } else if (statusFilter === "Expired") {
        matchesStatus = expiryStatus?.className === "expired";
      }

      return matchesSearch && matchesCategory && matchesStatus;
    });

    result.sort((a, b) => {
      if (sortBy === "quantity-low") {
        return toNumber(a.quantity) - toNumber(b.quantity);
      }

      if (sortBy === "quantity-high") {
        return toNumber(b.quantity) - toNumber(a.quantity);
      }

      if (sortBy === "expiry") {
        const dateA = a.expiryDate || "9999-12-31";
        const dateB = b.expiryDate || "9999-12-31";
        return dateA.localeCompare(dateB);
      }

      if (sortBy === "category") {
        return (a.category || "").localeCompare(b.category || "");
      }

      return (a.name || "").localeCompare(b.name || "");
    });

    return result;
  }, [items, search, categoryFilter, statusFilter, sortBy]);

  const lowStockCount = items.filter(
    (item) => getStockStatus(item).className === "low",
  ).length;

  const outOfStockCount = items.filter(
    (item) => getStockStatus(item).className === "out",
  ).length;

  const expiringCount = items.filter((item) => {
    const status = getExpiryStatus(item);
    return status?.className === "expiring";
  }).length;

  const expiredCount = items.filter((item) => {
    const status = getExpiryStatus(item);
    return status?.className === "expired";
  }).length;

  const totalInventoryValue = items.reduce(
    (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitCost),
    0,
  );

  function openAddForm() {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setShowItemForm(true);
  }

  function openEditForm(item) {
    setEditingItem(item);
    setForm({
      name: item.name || "",
      category: item.category || "Ingredients",
      quantity: String(item.quantity ?? 0),
      unit: item.unit || "kg",
      packageContentsAmount: String(item.packageContentsAmount ?? ""),
      packageContentsUnit: item.packageContentsUnit || "g",
      minStock: String(item.minStock ?? 1),
      unitCost: String(item.unitCost ?? 0),
      supplier: item.supplier || "",
      expiryDate: item.expiryDate || "",
      notes: item.notes || "",
    });
    setShowItemForm(true);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSaveItem(event) {
    event.preventDefault();

    if (saving) return;

    const name = form.name.trim();
    const quantity = Number(form.quantity);
    const minStock = Number(form.minStock);
    const unitCost = Number(form.unitCost);

    if (!name) {
      window.alert("Enter an item name.");
      return;
    }

    if (
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isFinite(minStock) ||
      minStock < 0 ||
      !Number.isFinite(unitCost) ||
      unitCost < 0
    ) {
      window.alert(
        "Quantity, minimum stock, and cost must be valid non-negative numbers.",
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      const itemData = {
        name,
        category: form.category,
        quantity,
        unit: form.unit,
        packageContentsAmount:
          Number(form.packageContentsAmount) > 0
            ? Number(form.packageContentsAmount)
            : 0,
        packageContentsUnit: form.packageContentsUnit || "",
        minStock,
        unitCost,
        supplier: form.supplier.trim(),
        expiryDate: form.expiryDate || "",
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingItem) {
        const previousQuantity = toNumber(editingItem.quantity);
        const difference = quantity - previousQuantity;

        const batch = writeBatch(db);
        batch.update(doc(db, ITEMS_COLLECTION, editingItem.id), itemData);

        if (difference !== 0) {
          const movementRef = doc(collection(db, MOVEMENTS_COLLECTION));

          batch.set(movementRef, {
            itemId: editingItem.id,
            itemName: name,
            type: "adjustment",
            quantityChange: difference,
            unit: form.unit,
            quantityBefore: previousQuantity,
            quantityAfter: quantity,
            note: "Quantity changed while editing inventory item.",
            createdAt: serverTimestamp(),
          });
        }

        await batch.commit();
      } else {
        const itemRef = doc(collection(db, ITEMS_COLLECTION));
        const batch = writeBatch(db);

        batch.set(itemRef, {
          ...itemData,
          createdAt: serverTimestamp(),
        });

        if (quantity > 0) {
          const movementRef = doc(collection(db, MOVEMENTS_COLLECTION));

          batch.set(movementRef, {
            itemId: itemRef.id,
            itemName: name,
            type: "received",
            quantityChange: quantity,
            unit: form.unit,
            quantityBefore: 0,
            quantityAfter: quantity,
            note: "Opening stock",
            createdAt: serverTimestamp(),
          });
        }

        await batch.commit();
      }

      setShowItemForm(false);
      setEditingItem(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error("Saving inventory item failed:", err);
      setError(
        "Could not save the item. Check your Firestore permissions and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(item) {
    const confirmed = window.confirm(
      `Delete "${item.name}" from inventory? Its movement history will remain, but the item will no longer appear in the inventory list.`,
    );

    if (!confirmed) return;

    try {
      const batch = writeBatch(db);

      batch.set(doc(collection(db, MOVEMENTS_COLLECTION)), {
        itemId: item.id,
        itemName: item.name,
        type: "deleted",
        quantityChange: 0,
        unit: item.unit || "",
        quantityBefore: toNumber(item.quantity),
        quantityAfter: 0,
        note: "Inventory item deleted.",
        createdAt: serverTimestamp(),
      });

      batch.delete(doc(db, ITEMS_COLLECTION, item.id));
      await batch.commit();
    } catch (err) {
      console.error("Deleting inventory item failed:", err);
      setError("Could not delete the item. Check your Firestore permissions.");
    }
  }

  function openMovement(item) {
    setMovementItem(item);
    setMovementType("received");
    setMovementDirection("add");
    setMovementQuantity("");
    setMovementNote("");
  }

  async function handleSaveMovement(event) {
    event.preventDefault();

    if (!movementItem || savingMovement) return;

    const amount = Number(movementQuantity);

    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("Enter a quantity greater than zero.");
      return;
    }

    const currentQuantity = toNumber(movementItem.quantity);

    let difference = amount;

    if (movementType === "used" || movementType === "waste") {
      difference = -amount;
    } else if (
      movementType === "adjustment" &&
      movementDirection === "remove"
    ) {
      difference = -amount;
    }

    const nextQuantity = currentQuantity + difference;

    if (nextQuantity < 0) {
      window.alert(
        "This movement would make stock negative. Check the available quantity.",
      );
      return;
    }

    setSavingMovement(true);
    setError("");

    try {
      const batch = writeBatch(db);

      batch.update(doc(db, ITEMS_COLLECTION, movementItem.id), {
        quantity: nextQuantity,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(collection(db, MOVEMENTS_COLLECTION)), {
        itemId: movementItem.id,
        itemName: movementItem.name,
        type: movementType,
        quantityChange: difference,
        unit: movementItem.unit || "",
        quantityBefore: currentQuantity,
        quantityAfter: nextQuantity,
        note: movementNote.trim(),
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setMovementItem(null);
    } catch (err) {
      console.error("Saving stock movement failed:", err);
      setError(
        "Could not save the stock movement. Check your Firestore permissions.",
      );
    } finally {
      setSavingMovement(false);
    }
  }

  function exportInventory() {
    const rows = [
      [
        "Item",
        "Category",
        "Quantity",
        "Unit",
        "Minimum Stock",
        "Stock Status",
        "Unit Cost (USD)",
        "Stock Value (USD)",
        "Supplier",
        "Expiry Date",
        "Notes",
      ],
      ...filteredItems.map((item) => [
        item.name,
        item.category,
        item.quantity,
        item.unit,
        item.minStock,
        getStockStatus(item).label,
        item.unitCost,
        toNumber(item.quantity) * toNumber(item.unitCost),
        item.supplier,
        item.expiryDate,
        item.notes,
      ]),
    ];

    const month = new Date().toISOString().slice(0, 7);
    downloadCSV(`cafe-inventory-${month}.csv`, rows);
  }

  function exportMovements() {
    const sorted = [...movements].sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;
      return dateB - dateA;
    });

    const rows = [
      [
        "Date",
        "Item",
        "Movement",
        "Quantity Change",
        "Unit",
        "Quantity Before",
        "Quantity After",
        "Note",
      ],
      ...sorted.map((movement) => [
        dateFromTimestamp(movement.createdAt),
        movement.itemName,
        movement.type,
        movement.quantityChange,
        movement.unit,
        movement.quantityBefore,
        movement.quantityAfter,
        movement.note,
      ]),
    ];

    const month = new Date().toISOString().slice(0, 7);
    downloadCSV(`cafe-stock-movements-${month}.csv`, rows);
  }

  function openDeleteMovement(movement) {
    setMovementToDelete(movement);
    setHistoryDeletePasscode("");
    setHistoryDeleteError("");
  }

  async function handleDeleteMovement(event) {
    event.preventDefault();
    if (!movementToDelete || deletingHistory) return;

    if (historyDeletePasscode !== "1234") {
      setHistoryDeleteError("Incorrect passcode. Please try again.");
      return;
    }

    setDeletingHistory(true);
    setHistoryDeleteError("");
    try {
      await deleteDoc(doc(db, MOVEMENTS_COLLECTION, movementToDelete.id));
      setMovementToDelete(null);
      setHistoryDeletePasscode("");
    } catch (err) {
      console.error("Deleting inventory history failed:", err);
      setHistoryDeleteError(
        "Could not delete this history entry. Check your Firestore permissions and try again.",
      );
    } finally {
      setDeletingHistory(false);
    }
  }

  const visibleMovements = useMemo(() => {
    return movements
      .filter((movement) => {
        if (historyItem && movement.itemId !== historyItem.id) return false;
        return true;
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toMillis?.() || 0;
        const dateB = b.createdAt?.toMillis?.() || 0;
        return dateB - dateA;
      });
  }, [movements, historyItem]);

  return (
    <div className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="inventory-eyebrow">CAFÉ OPERATIONS</p>
          <h1>Inventory</h1>
          <p className="inventory-subtitle">
            Track supplies, monitor stock, and stay ahead of expiry dates.
          </p>
        </div>

        <div className="inventory-header-actions">
          <button
            type="button"
            className="inventory-button inventory-button-secondary"
            onClick={exportInventory}
          >
            <FiDownload /> Export inventory
          </button>

          <button
            type="button"
            className="inventory-button inventory-button-primary"
            onClick={openAddForm}
          >
            <FiPlus /> Add item
          </button>
        </div>
      </header>

      {error && (
        <div className="inventory-error" role="alert">
          <FiAlertTriangle />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <FiX />
          </button>
        </div>
      )}

      <section className="inventory-stats">
        <article className="inventory-stat-card">
          <div className="inventory-stat-icon">
            <FiPackage />
          </div>
          <div>
            <span>Total items</span>
            <strong>{items.length}</strong>
            <small>Across all categories</small>
          </div>
        </article>

        <article className="inventory-stat-card">
          <div className="inventory-stat-icon inventory-icon-warning">
            <FiAlertTriangle />
          </div>
          <div>
            <span>Low stock</span>
            <strong>{lowStockCount}</strong>
            <small>Needs restocking</small>
          </div>
        </article>

        <article className="inventory-stat-card">
          <div className="inventory-stat-icon inventory-icon-danger">
            <FiX />
          </div>
          <div>
            <span>Out of stock</span>
            <strong>{outOfStockCount}</strong>
            <small>Currently unavailable</small>
          </div>
        </article>

        <article className="inventory-stat-card">
          <div className="inventory-stat-icon inventory-icon-expiry">
            <FiCalendar />
          </div>
          <div>
            <span>Expiry alerts</span>
            <strong>{expiringCount + expiredCount}</strong>
            <small>
              {expiredCount} expired · {expiringCount} expiring soon
            </small>
          </div>
        </article>
      </section>

      <section className="inventory-value-strip">
        <div>
          <span>Estimated stock value</span>
          <strong>{formatMoney(totalInventoryValue)}</strong>
        </div>
        <p>Calculated from quantity × unit cost, using USD as the currency.</p>
      </section>

      <section className="inventory-content">
        <div className="inventory-section-heading">
          <div>
            <h2>All items</h2>
            <p>Search and manage everything your café keeps in stock.</p>
          </div>
          <span className="inventory-result-count">
            {filteredItems.length}{" "}
            {filteredItems.length === 1 ? "item" : "items"}
          </span>
        </div>

        <div className="inventory-toolbar">
          <label className="inventory-search">
            <FiSearch />
            <input
              type="search"
              placeholder="Search by item name..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <FiX />
              </button>
            )}
          </label>

          <label className="inventory-select-wrap">
            <FiFilter />
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter by category"
            >
              <option>All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <FiChevronDown className="inventory-select-chevron" />
          </label>

          <label className="inventory-select-wrap">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option>All statuses</option>
              <option>Low stock</option>
              <option>Out of stock</option>
              <option>Expiring soon</option>
              <option>Expired</option>
            </select>
            <FiChevronDown className="inventory-select-chevron" />
          </label>

          <label className="inventory-select-wrap inventory-sort">
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              aria-label="Sort inventory"
            >
              <option value="name">Name A–Z</option>
              <option value="category">Category</option>
              <option value="quantity-low">Quantity: low to high</option>
              <option value="quantity-high">Quantity: high to low</option>
              <option value="expiry">Expiry: soonest first</option>
            </select>
            <FiChevronDown className="inventory-select-chevron" />
          </label>
        </div>

        {loading ? (
          <div className="inventory-loading">Loading inventory...</div>
        ) : filteredItems.length === 0 ? (
          <div className="inventory-empty">
            <div className="inventory-empty-icon">
              <FiPackage />
            </div>
            <h3>
              {items.length ? "No matching items" : "Your inventory is empty"}
            </h3>
            <p>
              {items.length
                ? "Try another search or change your filters."
                : "Add your first ingredient, packaging item, cleaning supply, or finished product."}
            </p>
            {items.length === 0 && (
              <button
                type="button"
                className="inventory-button inventory-button-primary"
                onClick={openAddForm}
              >
                <FiPlus /> Add your first item
              </button>
            )}
          </div>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>Stock status</th>
                  <th>Expiry</th>
                  <th>Stock value</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((item) => {
                  const stockStatus = getStockStatus(item);
                  const expiryStatus = getExpiryStatus(item);

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="inventory-item-name">{item.name}</div>
                        {Number(item.packageContentsAmount) > 0 &&
                          item.packageContentsUnit && (
                            <div className="inventory-item-meta">
                              1 {item.unit || "unit"} = {formatQuantity(item.packageContentsAmount)} {item.packageContentsUnit}
                            </div>
                          )}
                        {item.supplier && (
                          <div className="inventory-item-meta">
                            Supplier: {item.supplier}
                          </div>
                        )}
                      </td>

                      <td>
                        <span className="inventory-category">
                          {item.category}
                        </span>
                      </td>

                      <td>
                        <strong className="inventory-quantity">
                          {formatQuantity(item.quantity)}
                        </strong>{" "}
                        <span className="inventory-unit">{item.unit}</span>
                        <div className="inventory-item-meta">
                          Minimum: {formatQuantity(item.minStock)} {item.unit}
                        </div>
                      </td>

                      <td>
                        <span
                          className={`inventory-status inventory-status-${stockStatus.className}`}
                        >
                          <span />
                          {stockStatus.label}
                        </span>
                      </td>

                      <td>
                        {expiryStatus ? (
                          <div className="inventory-expiry-cell">
                            <span
                              className={`inventory-expiry inventory-expiry-${expiryStatus.className}`}
                            >
                              {expiryStatus.label}
                            </span>
                            <small>{item.expiryDate}</small>
                          </div>
                        ) : (
                          <span className="inventory-muted">Not set</span>
                        )}
                      </td>

                      <td>
                        {formatMoney(
                          toNumber(item.quantity) * toNumber(item.unitCost),
                        )}
                      </td>

                      <td>
                        <div className="inventory-row-actions">
                          <button
                            type="button"
                            className="inventory-icon-button"
                            title="Record stock movement"
                            aria-label={`Record stock movement for ${item.name}`}
                            onClick={() => openMovement(item)}
                          >
                            <FiPlus />
                          </button>

                          <button
                            type="button"
                            className="inventory-icon-button"
                            title="View stock history"
                            aria-label={`View history for ${item.name}`}
                            onClick={() => {
                              setHistoryItem(item);
                              setShowAllHistory(false);
                            }}
                          >
                            <FiClock />
                          </button>

                          <button
                            type="button"
                            className="inventory-icon-button"
                            title="Edit item"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => openEditForm(item)}
                          >
                            <FiEdit2 />
                          </button>

                          <button
                            type="button"
                            className="inventory-icon-button inventory-icon-delete"
                            title="Delete item"
                            aria-label={`Delete ${item.name}`}
                            onClick={() => handleDeleteItem(item)}
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="inventory-history-preview">
        <div className="inventory-section-heading">
          <div>
            <h2>Recent stock movements</h2>
            <p>Receipts, usage, waste, and manual adjustments.</p>
          </div>
          <button
            type="button"
            className="inventory-button inventory-button-secondary"
            onClick={exportMovements}
          >
            <FiDownload /> Export history
          </button>
        </div>

        {movements.length === 0 ? (
          <p className="inventory-history-empty">
            No stock movements have been recorded yet.
          </p>
        ) : (
          <div className="inventory-movements">
            {[...movements]
              .sort(
                (a, b) =>
                  (b.createdAt?.toMillis?.() || 0) -
                  (a.createdAt?.toMillis?.() || 0),
              )
              .slice(0, 5)
              .map((movement) => (
                <div className="inventory-movement-row" key={movement.id}>
                  <div className="inventory-movement-symbol">
                    {movement.type === "waste" ? (
                      <FiTrash2 />
                    ) : movement.type === "received" ? (
                      <FiPlus />
                    ) : (
                      <FiClock />
                    )}
                  </div>

                  <div className="inventory-movement-info">
                    <strong>{movement.itemName || "Unknown item"}</strong>
                    <span>
                      {movement.type} · {dateFromTimestamp(movement.createdAt)}
                    </span>
                  </div>

                  <strong
                    className={
                      toNumber(movement.quantityChange) < 0
                        ? "inventory-change-negative"
                        : "inventory-change-positive"
                    }
                  >
                    {toNumber(movement.quantityChange) > 0 ? "+" : ""}
                    {formatQuantity(movement.quantityChange)} {movement.unit}
                  </strong>
                </div>
              ))}
          </div>
        )}

        <button
          type="button"
          className="inventory-text-button"
          onClick={() => {
            setHistoryItem(null);
            setShowAllHistory(true);
          }}
        >
          View complete history
        </button>
      </section>

      {/* ADD / EDIT ITEM MODAL */}
      {showItemForm && (
        <div
          className="inventory-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setShowItemForm(false);
            }
          }}
        >
          <section
            className="inventory-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-item-modal-title"
          >
            <header className="inventory-modal-header">
              <div>
                <p className="inventory-eyebrow">INVENTORY ITEM</p>
                <h2 id="inventory-item-modal-title">
                  {editingItem ? "Edit item" : "Add new item"}
                </h2>
              </div>
              <button
                type="button"
                className="inventory-icon-button"
                aria-label="Close"
                disabled={saving}
                onClick={() => setShowItemForm(false)}
              >
                <FiX />
              </button>
            </header>

            <form onSubmit={handleSaveItem}>
              <div className="inventory-form-grid">
                <label className="inventory-form-field inventory-form-full">
                  Item name *
                  <input
                    autoFocus
                    required
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="e.g. Granulated sugar"
                  />
                </label>

                <label className="inventory-form-field">
                  Category *
                  <select
                    value={form.category}
                    onChange={(event) =>
                      updateForm("category", event.target.value)
                    }
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>

                <label className="inventory-form-field">
                  Unit *
                  <select
                    value={form.unit}
                    onChange={(event) => updateForm("unit", event.target.value)}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>

                <label className="inventory-form-field">
                  Package contains
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.packageContentsAmount}
                    onChange={(event) =>
                      updateForm("packageContentsAmount", event.target.value)
                    }
                    placeholder="Optional, e.g. 500 or 14"
                  />
                  <small>
                    Set this for packaged stock, such as 500 g per can or 14 pieces per bag.
                  </small>
                </label>

                <label className="inventory-form-field">
                  Contents unit
                  <select
                    value={form.packageContentsUnit}
                    onChange={(event) =>
                      updateForm("packageContentsUnit", event.target.value)
                    }
                  >
                    {["g", "kg", "ml", "L", "pieces"].map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                  <small>
                    Leave Package contains empty if the stock unit itself is the recipe unit.
                  </small>
                </label>

                <label className="inventory-form-field">
                  Current quantity *
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.quantity}
                    onChange={(event) =>
                      updateForm("quantity", event.target.value)
                    }
                  />
                </label>

                <label className="inventory-form-field">
                  Minimum stock level *
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.minStock}
                    onChange={(event) =>
                      updateForm("minStock", event.target.value)
                    }
                  />
                  <small>Warn when stock reaches this quantity.</small>
                </label>

                <label className="inventory-form-field">
                  Unit cost (USD) *
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.unitCost}
                    onChange={(event) =>
                      updateForm("unitCost", event.target.value)
                    }
                  />
                  <small>
                    Cost per selected unit, not per package unless the unit is a
                    package.
                  </small>
                </label>

                <label className="inventory-form-field">
                  Supplier
                  <input
                    value={form.supplier}
                    onChange={(event) =>
                      updateForm("supplier", event.target.value)
                    }
                    placeholder="Optional"
                  />
                </label>

                <label className="inventory-form-field">
                  Expiry date
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(event) =>
                      updateForm("expiryDate", event.target.value)
                    }
                  />
                  <small>Leave empty if expiry does not apply.</small>
                </label>

                <label className="inventory-form-field inventory-form-full">
                  Notes
                  <textarea
                    rows="3"
                    value={form.notes}
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    placeholder="Storage location, brand, size, or other details..."
                  />
                </label>
              </div>

              <footer className="inventory-modal-actions">
                <button
                  type="button"
                  className="inventory-button inventory-button-secondary"
                  disabled={saving}
                  onClick={() => setShowItemForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inventory-button inventory-button-primary"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingItem
                      ? "Save changes"
                      : "Add to inventory"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* STOCK MOVEMENT MODAL */}
      {movementItem && (
        <div className="inventory-modal-backdrop">
          <section
            className="inventory-modal inventory-modal-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-movement-title"
          >
            <header className="inventory-modal-header">
              <div>
                <p className="inventory-eyebrow">STOCK CONTROL</p>
                <h2 id="inventory-movement-title">Update stock</h2>
                <p className="inventory-modal-description">
                  {movementItem.name} · Currently{" "}
                  {formatQuantity(movementItem.quantity)} {movementItem.unit}
                </p>
              </div>
              <button
                type="button"
                className="inventory-icon-button"
                aria-label="Close"
                disabled={savingMovement}
                onClick={() => setMovementItem(null)}
              >
                <FiX />
              </button>
            </header>

            <form onSubmit={handleSaveMovement}>
              <div className="inventory-form-grid">
                <label className="inventory-form-field inventory-form-full">
                  Movement type
                  <select
                    value={movementType}
                    onChange={(event) => setMovementType(event.target.value)}
                  >
                    <option value="received">
                      Stock received / purchased (+)
                    </option>
                    <option value="used">Stock used (−)</option>
                    <option value="waste">Waste / spoiled (−)</option>
                    <option value="adjustment">Stock correction (+ / −)</option>
                  </select>
                </label>

                <label className="inventory-form-field inventory-form-full">
                  Quantity ({movementItem.unit})
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    required
                    value={movementQuantity}
                    onChange={(event) =>
                      setMovementQuantity(event.target.value)
                    }
                    placeholder="Enter quantity"
                  />
                </label>

                {movementType === "adjustment" && (
                  <>
                    <label className="inventory-form-field inventory-form-full">
                      Correction direction
                      <select
                        value={movementDirection}
                        onChange={(event) =>
                          setMovementDirection(event.target.value)
                        }
                      >
                        <option value="add">Add to stock (+)</option>
                        <option value="remove">Remove from stock (−)</option>
                      </select>
                    </label>
                    <p className="inventory-form-help inventory-form-full">
                      Enter the amount to add or remove from the current
                      quantity.
                    </p>
                  </>
                )}

                <label className="inventory-form-field inventory-form-full">
                  Note
                  <textarea
                    rows="3"
                    value={movementNote}
                    onChange={(event) => setMovementNote(event.target.value)}
                    placeholder={
                      movementType === "waste"
                        ? "Reason for waste or spoilage..."
                        : "Optional details..."
                    }
                  />
                </label>
              </div>

              <footer className="inventory-modal-actions">
                <button
                  type="button"
                  className="inventory-button inventory-button-secondary"
                  disabled={savingMovement}
                  onClick={() => setMovementItem(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inventory-button inventory-button-primary"
                  disabled={savingMovement}
                >
                  {savingMovement ? "Saving..." : "Save movement"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* MOVEMENT HISTORY MODAL */}
      {(historyItem || showAllHistory) && (
        <div
          className="inventory-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setHistoryItem(null);
              setShowAllHistory(false);
            }
          }}
        >
          <section
            className="inventory-modal inventory-history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-history-title"
          >
            <header className="inventory-modal-header">
              <div>
                <p className="inventory-eyebrow">AUDIT TRAIL</p>
                <h2 id="inventory-history-title">Stock movement history</h2>
                <p className="inventory-modal-description">
                  {historyItem ? historyItem.name : "All inventory items"}
                </p>
              </div>
              <button
                type="button"
                className="inventory-icon-button"
                aria-label="Close history"
                onClick={() => {
                  setHistoryItem(null);
                  setShowAllHistory(false);
                }}
              >
                <FiX />
              </button>
            </header>

            <div className="inventory-history-list">
              {visibleMovements.length === 0 ? (
                <div className="inventory-history-empty">
                  No movements recorded for this selection.
                </div>
              ) : (
                visibleMovements.map((movement) => (
                  <article
                    className="inventory-history-entry"
                    key={movement.id}
                  >
                    <div className="inventory-history-entry-top">
                      <strong>{movement.itemName || "Unknown item"}</strong>
                      <div
                        className="inventory-history-entry-actions"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          className={`inventory-history-type inventory-history-type-${movement.type}`}
                        >
                          {movement.type}
                        </span>
                        <button
                          type="button"
                          className="inventory-icon-button inventory-history-delete-button"
                          style={{
                            width: "30px",
                            height: "30px",
                            padding: "6px",
                          }}
                          title="Delete history entry"
                          aria-label={`Delete ${movement.itemName || "inventory"} history entry`}
                          onClick={() => openDeleteMovement(movement)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    </div>
                    <div className="inventory-history-entry-bottom">
                      <span>{dateFromTimestamp(movement.createdAt)}</span>
                      <strong>
                        {toNumber(movement.quantityChange) > 0 ? "+" : ""}
                        {formatQuantity(movement.quantityChange)}{" "}
                        {movement.unit}
                      </strong>
                    </div>
                    {movement.note && (
                      <p className="inventory-history-note">{movement.note}</p>
                    )}
                    <p className="inventory-history-balance">
                      Before: {formatQuantity(movement.quantityBefore)} · After:{" "}
                      {formatQuantity(movement.quantityAfter)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {movementToDelete && (
        <div
          className="inventory-modal-backdrop inventory-history-delete-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingHistory) {
              setMovementToDelete(null);
              setHistoryDeletePasscode("");
              setHistoryDeleteError("");
            }
          }}
        >
          <section
            className="inventory-modal inventory-history-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-history-delete-title"
          >
            <header className="inventory-modal-header">
              <div>
                <p className="inventory-eyebrow">CONFIRM DELETION</p>
                <h2 id="inventory-history-delete-title">
                  Delete history entry?
                </h2>
                <p className="inventory-modal-description">
                  This removes the history record only. It will not change the
                  current stock quantity.
                </p>
              </div>
              <button
                type="button"
                className="inventory-icon-button"
                aria-label="Cancel deletion"
                disabled={deletingHistory}
                onClick={() => {
                  setMovementToDelete(null);
                  setHistoryDeletePasscode("");
                  setHistoryDeleteError("");
                }}
              >
                <FiX />
              </button>
            </header>
            <form onSubmit={handleDeleteMovement}>
              <div className="inventory-form-grid">
                <label className="inventory-field inventory-field-full">
                  <span>Enter passcode</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={historyDeletePasscode}
                    onChange={(event) =>
                      setHistoryDeletePasscode(event.target.value)
                    }
                    placeholder="4-digit passcode"
                    maxLength={4}
                    autoFocus
                    required
                  />
                </label>
              </div>
              {historyDeleteError && (
                <p className="inventory-form-error" role="alert">
                  {historyDeleteError}
                </p>
              )}
              <footer className="inventory-modal-footer">
                <button
                  type="button"
                  className="inventory-button inventory-button-secondary"
                  disabled={deletingHistory}
                  onClick={() => {
                    setMovementToDelete(null);
                    setHistoryDeletePasscode("");
                    setHistoryDeleteError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inventory-button inventory-button-danger"
                  disabled={
                    deletingHistory || historyDeletePasscode.length !== 4
                  }
                >
                  <FiTrash2 />{" "}
                  {deletingHistory ? "Deleting..." : "Confirm delete"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default Inventory;
