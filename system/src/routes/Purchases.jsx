import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import {
  FiCheckCircle,
  FiChevronDown,
  FiClock,
  FiDollarSign,
  FiDownload,
  FiEye,
  FiPlus,
  FiSearch,
  FiShoppingBag,
  FiTrash2,
  FiTruck,
  FiX,
} from "react-icons/fi";

import { db } from "../assets/firebase/config";
import "../styles/Purchases.css";

const PURCHASES_COLLECTION = "purchases";
const ITEMS_COLLECTION = "inventoryItems";
const MOVEMENTS_COLLECTION = "inventoryMovements";

const EMPTY_LINE = { itemId: "", quantity: "1", unitCost: "0" };
const EMPTY_FORM = {
  supplierId: "",
  reference: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  notes: "",
  paymentStatus: "Unpaid",
  paymentAmount: "0",
  items: [{ ...EMPTY_LINE }],
};

const supplierName = (supplier) =>
  supplier?.name || supplier?.supplierName || supplier?.companyName || supplier?.businessName || supplier?.title || "Unnamed supplier";

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number(value));

const dateLabel = (value) => {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};

const timestampLabel = (value) => {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

function downloadCSV(rows) {
  if (!rows.length) return window.alert("There are no purchases to export.");
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "matrix-purchases.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [paymentFilter, setPaymentFilter] = useState("All payments");
  const [showForm, setShowForm] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [receivingId, setReceivingId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    const unsubscribePurchases = onSnapshot(
      collection(db, PURCHASES_COLLECTION),
      (snapshot) => {
        const rows = snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        }));
        rows.sort((a, b) => {
          const aDate =
            a.createdAt?.toMillis?.() ??
            new Date(a.purchaseDate || 0).getTime();
          const bDate =
            b.createdAt?.toMillis?.() ??
            new Date(b.purchaseDate || 0).getTime();
          return bDate - aDate;
        });
        setPurchases(rows);
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Loading purchases failed:", err);
        setError(
          "Could not load purchases. Check your Firestore rules and connection.",
        );
        setLoading(false);
      },
    );

    const unsubscribeItems = onSnapshot(
      collection(db, ITEMS_COLLECTION),
      (snapshot) => {
        setInventoryItems(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
        );
      },
      (err) => {
        console.error("Loading inventory for purchases failed:", err);
        setError("Could not load inventory items. Check your Firestore rules.");
      },
    );

    const unsubscribeSuppliers = onSnapshot(
      collection(db, "suppliers"),
      (snapshot) => {
        setSuppliers(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((a, b) => supplierName(a).localeCompare(supplierName(b))),
        );
      },
      (err) => {
        console.error("Loading suppliers failed:", err);
        setError("Could not load suppliers. Check your Firestore rules.");
      },
    );

    return () => {
      unsubscribePurchases();
      unsubscribeItems();
      unsubscribeSuppliers();
    };
  }, []);

  const inventoryById = useMemo(
    () => Object.fromEntries(inventoryItems.map((item) => [item.id, item])),
    [inventoryItems],
  );

  const supplierById = useMemo(
    () => Object.fromEntries(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const formTotal = useMemo(
    () =>
      form.items.reduce(
        (sum, line) => sum + number(line.quantity) * number(line.unitCost),
        0,
      ),
    [form.items],
  );

  const filteredPurchases = useMemo(() => {
    const term = search.trim().toLowerCase();
    return purchases.filter((purchase) => {
      const searchable = [
        purchase.supplier,
        purchase.reference,
        purchase.id,
        ...(purchase.items || []).map((line) => line.name),
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !term || searchable.includes(term);
      const matchesStatus =
        statusFilter === "All statuses" || purchase.status === statusFilter;
      const matchesPayment =
        paymentFilter === "All payments" ||
        purchase.paymentStatus === paymentFilter;
      return matchesSearch && matchesStatus && matchesPayment;
    });
  }, [purchases, search, statusFilter, paymentFilter]);

  const stats = useMemo(() => {
    const totalSpend = purchases
      .filter((purchase) => purchase.status === "Received")
      .reduce((sum, purchase) => sum + number(purchase.total), 0);
    const pending = purchases.filter(
      (purchase) => purchase.status !== "Received",
    ).length;
    const unpaid = purchases.reduce((sum, purchase) => {
      const paid = number(purchase.paymentAmount);
      return sum + Math.max(0, number(purchase.total) - paid);
    }, 0);
    return { totalSpend, pending, unpaid, count: purchases.length };
  }, [purchases]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLine(index, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((line, i) =>
        i === index ? { ...line, [field]: value } : line,
      ),
    }));
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      items: [...current.items, { ...EMPTY_LINE }],
    }));
  }

  function removeLine(index) {
    setForm((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, i) => i !== index),
    }));
  }

  function openNewPurchase() {
    setForm({
      ...EMPTY_FORM,
      purchaseDate: new Date().toISOString().slice(0, 10),
      items: [{ ...EMPTY_LINE }],
    });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  async function handleSavePurchase(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.supplierId || !supplierById[form.supplierId])
      return setError("Choose a supplier from your Suppliers list.");
    if (!form.purchaseDate) return setError("Choose the purchase date.");
    if (
      !form.items.length ||
      form.items.some(
        (line) =>
          !line.itemId ||
          number(line.quantity) <= 0 ||
          number(line.unitCost) < 0,
      )
    ) {
      return setError(
        "Choose an inventory item and enter a quantity greater than zero and a valid unit cost for every line.",
      );
    }

    const items = form.items.map((line) => {
      const inventoryItem = inventoryById[line.itemId];
      return {
        itemId: line.itemId,
        name: inventoryItem?.name || "Unknown item",
        category: inventoryItem?.category || "",
        unit: inventoryItem?.unit || "pieces",
        quantity: number(line.quantity),
        unitCost: number(line.unitCost),
        lineTotal: number(line.quantity) * number(line.unitCost),
      };
    });
    const total = items.reduce((sum, line) => sum + line.lineTotal, 0);
    const paymentAmount = Math.min(
      total,
      Math.max(0, number(form.paymentAmount)),
    );
    const paymentStatus =
      paymentAmount <= 0
        ? "Unpaid"
        : paymentAmount >= total
          ? "Paid"
          : "Partially paid";

    setSaving(true);
    try {
      await addDoc(collection(db, PURCHASES_COLLECTION), {
        supplierId: form.supplierId,
        supplier: supplierName(supplierById[form.supplierId]),
        reference: form.reference.trim(),
        purchaseDate: form.purchaseDate,
        expectedDate: form.expectedDate || "",
        notes: form.notes.trim(),
        items,
        total,
        paymentAmount,
        paymentStatus,
        status: "Ordered",
        stockApplied: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setNotice(
        "Purchase saved as Ordered. Inventory will update only when you mark it Received.",
      );
    } catch (err) {
      console.error("Saving purchase failed:", err);
      setError(
        "Saving purchase failed. Check your Firestore rules and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function markReceived(purchase) {
    if (purchase.status === "Received" || purchase.stockApplied) {
      setError("This purchase has already been applied to inventory.");
      return;
    }
    if (
      !window.confirm(
        `Mark purchase ${purchase.reference || purchase.id.slice(0, 8)} as received and add its quantities to inventory?`,
      )
    )
      return;

    setReceivingId(purchase.id);
    setError("");
    setNotice("");
    try {
      await runTransaction(db, async (transaction) => {
        const purchaseRef = doc(db, PURCHASES_COLLECTION, purchase.id);
        const freshPurchaseSnapshot = await transaction.get(purchaseRef);
        if (!freshPurchaseSnapshot.exists())
          throw new Error("This purchase no longer exists.");
        const freshPurchase = freshPurchaseSnapshot.data();
        if (freshPurchase.status === "Received" || freshPurchase.stockApplied) {
          throw new Error("This purchase has already been received.");
        }

        const lines = freshPurchase.items || [];
        const totalsByItem = new Map();
        lines.forEach((line) => {
          if (!line.itemId || number(line.quantity) <= 0) return;
          const current = totalsByItem.get(line.itemId) || {
            quantity: 0,
            lines: [],
          };
          current.quantity += number(line.quantity);
          current.lines.push(line);
          totalsByItem.set(line.itemId, current);
        });

        const itemSnapshots = new Map();
        for (const itemId of totalsByItem.keys()) {
          const itemRef = doc(db, ITEMS_COLLECTION, itemId);
          const itemSnapshot = await transaction.get(itemRef);
          if (!itemSnapshot.exists())
            throw new Error(
              `Inventory item ${itemId} was not found. No stock was changed.`,
            );
          itemSnapshots.set(itemId, { ref: itemRef, snapshot: itemSnapshot });
        }

        for (const [itemId, data] of totalsByItem.entries()) {
          const { ref, snapshot } = itemSnapshots.get(itemId);
          const currentItem = snapshot.data();
          const quantity = number(currentItem.quantity) + data.quantity;
          const lastLine = data.lines[data.lines.length - 1];
          const newUnitCost = number(lastLine.unitCost);
          transaction.update(ref, {
            quantity,
            unitCost: newUnitCost,
            updatedAt: serverTimestamp(),
          });

          const movementRef = doc(collection(db, MOVEMENTS_COLLECTION));
          transaction.set(movementRef, {
            itemId,
            itemName: currentItem.name || lastLine.name || "Inventory item",
            type: "received",
            quantity: data.quantity,
            difference: data.quantity,
            previousQuantity: number(currentItem.quantity),
            newQuantity: quantity,
            unit: currentItem.unit || lastLine.unit || "pieces",
            note: `Purchase received${freshPurchase.reference ? ` (${freshPurchase.reference})` : ""} — ${freshPurchase.supplier || "supplier"}`,
            supplier: freshPurchase.supplier || "",
            purchaseId: purchase.id,
            createdAt: serverTimestamp(),
          });
        }

        transaction.update(purchaseRef, {
          status: "Received",
          stockApplied: true,
          receivedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      setNotice("Purchase marked received and inventory quantities updated.");
    } catch (err) {
      console.error("Receiving purchase failed:", err);
      setError(
        err.message ||
          "Could not receive this purchase. Check Firestore rules.",
      );
    } finally {
      setReceivingId("");
    }
  }

  async function handleDeletePurchase(purchase) {
    const wasReceived =
      purchase.status === "Received" || Boolean(purchase.stockApplied);

    const confirmation = wasReceived
      ? "Delete this purchase from purchase history? This permanently removes the purchase record, but inventory quantities will NOT be changed and inventory movement history will remain. This cannot be undone."
      : "Delete this ordered purchase from purchase history? This cannot be undone.";

    if (!window.confirm(confirmation)) return;

    setDeletingId(purchase.id);
    setError("");
    setNotice("");

    try {
      await deleteDoc(doc(db, PURCHASES_COLLECTION, purchase.id));
      if (selectedPurchase?.id === purchase.id) setSelectedPurchase(null);
      setNotice(
        wasReceived
          ? "Purchase record deleted. Inventory quantities were not changed."
          : "Purchase deleted.",
      );
    } catch (err) {
      console.error("Deleting purchase failed:", err);
      setError("Could not delete this purchase. Check Firestore rules.");
    } finally {
      setDeletingId("");
    }
  }

  async function updatePayment(purchase, amountValue) {
    const paid = Math.min(
      number(purchase.total),
      Math.max(0, number(amountValue)),
    );
    const paymentStatus =
      paid <= 0
        ? "Unpaid"
        : paid >= number(purchase.total)
          ? "Paid"
          : "Partially paid";
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, PURCHASES_COLLECTION, purchase.id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error("Purchase not found.");
        transaction.update(ref, {
          paymentAmount: paid,
          paymentStatus,
          updatedAt: serverTimestamp(),
        });
      });
      setSelectedPurchase(null);
      setNotice("Payment details updated.");
      setError("");
    } catch (err) {
      console.error("Updating payment failed:", err);
      setError("Could not update payment. Check Firestore rules.");
    }
  }

  return (
    <div className="purchases-page">
      <div className="purchases-header">
        <div>
          <div className="purchases-eyebrow">
            <FiShoppingBag /> INVENTORY MANAGEMENT
          </div>
          <h1>Purchases</h1>
          <p>
            Record supplier orders, track payments, and receive stock into
            inventory.
          </p>
        </div>
        <div className="purchases-header-actions">
          <button
            type="button"
            className="purchases-btn purchases-btn-secondary"
            onClick={() =>
              downloadCSV(
                filteredPurchases.map((purchase) => [
                  purchase.reference,
                  purchase.supplier,
                  purchase.purchaseDate,
                  purchase.status,
                  purchase.paymentStatus,
                  purchase.total,
                  purchase.paymentAmount,
                  Math.max(
                    0,
                    number(purchase.total) - number(purchase.paymentAmount),
                  ),
                ]),
              )
            }
          >
            <FiDownload /> Export CSV
          </button>
          <button
            type="button"
            className="purchases-btn purchases-btn-primary"
            onClick={openNewPurchase}
          >
            <FiPlus /> New purchase
          </button>
        </div>
      </div>

      {error && (
        <div className="purchases-alert purchases-alert-error">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <FiX />
          </button>
        </div>
      )}
      {notice && (
        <div className="purchases-alert purchases-alert-success">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <FiX />
          </button>
        </div>
      )}

      <div className="purchases-stats-grid">
        <div className="purchases-stat-card">
          <span className="purchases-stat-icon">
            <FiShoppingBag />
          </span>
          <div>
            <span className="purchases-stat-label">All purchases</span>
            <strong>{stats.count}</strong>
            <small>Purchase records</small>
          </div>
        </div>
        <div className="purchases-stat-card">
          <span className="purchases-stat-icon amber">
            <FiClock />
          </span>
          <div>
            <span className="purchases-stat-label">Awaiting receipt</span>
            <strong>{stats.pending}</strong>
            <small>Stock not added yet</small>
          </div>
        </div>
        <div className="purchases-stat-card">
          <span className="purchases-stat-icon green">
            <FiDollarSign />
          </span>
          <div>
            <span className="purchases-stat-label">Received spend</span>
            <strong>{money(stats.totalSpend)}</strong>
            <small>Received purchases</small>
          </div>
        </div>
        <div className="purchases-stat-card">
          <span className="purchases-stat-icon red">
            <FiDollarSign />
          </span>
          <div>
            <span className="purchases-stat-label">Outstanding balance</span>
            <strong>{money(stats.unpaid)}</strong>
            <small>Across all purchases</small>
          </div>
        </div>
      </div>

      <section className="purchases-panel">
        <div className="purchases-panel-heading">
          <div>
            <h2>Purchase history</h2>
            <p>Track order status, supplier payments, and received stock.</p>
          </div>
          <span className="purchases-count-pill">
            {filteredPurchases.length} records
          </span>
        </div>
        <div className="purchases-toolbar">
          <label className="purchases-search">
            <FiSearch />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search supplier, reference, item..."
            />
          </label>
          <label className="purchases-select-wrap">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option>All statuses</option>
              <option>Ordered</option>
              <option>Received</option>
            </select>
            <FiChevronDown />
          </label>
          <label className="purchases-select-wrap">
            <select
              value={paymentFilter}
              onChange={(event) => setPaymentFilter(event.target.value)}
            >
              <option>All payments</option>
              <option>Unpaid</option>
              <option>Partially paid</option>
              <option>Paid</option>
            </select>
            <FiChevronDown />
          </label>
        </div>

        {loading ? (
          <div className="purchases-empty">
            <span className="purchases-spinner" />
            Loading purchases…
          </div>
        ) : filteredPurchases.length === 0 ? (
          <div className="purchases-empty">
            <span className="purchases-empty-icon">
              <FiShoppingBag />
            </span>
            <h3>No purchases found</h3>
            <p>
              Record your first supplier purchase to start tracking stock and
              payments.
            </p>
            <button
              type="button"
              className="purchases-btn purchases-btn-primary"
              onClick={openNewPurchase}
            >
              <FiPlus /> New purchase
            </button>
          </div>
        ) : (
          <div className="purchases-table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>
                      <div className="purchases-reference">
                        {purchase.reference ||
                          `PO-${purchase.id.slice(0, 6).toUpperCase()}`}
                      </div>
                      <small className="purchases-muted">
                        Added {timestampLabel(purchase.createdAt)}
                      </small>
                    </td>
                    <td>
                      <strong>{purchase.supplier || "—"}</strong>
                    </td>
                    <td>{dateLabel(purchase.purchaseDate)}</td>
                    <td>
                      <span className="purchases-items-count">
                        {(purchase.items || []).length}{" "}
                        {(purchase.items || []).length === 1 ? "item" : "items"}
                      </span>
                      <small className="purchases-muted purchases-item-preview">
                        {(purchase.items || [])
                          .slice(0, 2)
                          .map((item) => item.name)
                          .join(", ")}
                        {(purchase.items || []).length > 2 ? "…" : ""}
                      </small>
                    </td>
                    <td>
                      <strong>{money(purchase.total)}</strong>
                      <small className="purchases-muted">
                        Paid {money(purchase.paymentAmount)}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`purchases-status payment-${(purchase.paymentStatus || "Unpaid").toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {purchase.paymentStatus || "Unpaid"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`purchases-status status-${(purchase.status || "Ordered").toLowerCase()}`}
                      >
                        {purchase.status || "Ordered"}
                      </span>
                    </td>
                    <td>
                      <div className="purchases-row-actions">
                        <button
                          type="button"
                          className="purchases-icon-btn"
                          title="View purchase"
                          aria-label="View purchase"
                          onClick={() => setSelectedPurchase(purchase)}
                        >
                          <FiEye />
                        </button>
                        {purchase.status !== "Received" &&
                          !purchase.stockApplied && (
                            <button
                              type="button"
                              className="purchases-icon-btn purchases-receive-btn"
                              title="Receive into inventory"
                              aria-label="Receive into inventory"
                              disabled={receivingId === purchase.id}
                              onClick={() => markReceived(purchase)}
                            >
                              {receivingId === purchase.id ? (
                                <span className="purchases-mini-spinner" />
                              ) : (
                                <FiTruck />
                              )}
                            </button>
                          )}
                        <button
                          type="button"
                          className="purchases-icon-btn purchases-delete-btn"
                          title="Delete purchase from history"
                          aria-label={`Delete purchase ${purchase.reference || purchase.id}`}
                          disabled={deletingId === purchase.id}
                          onClick={() => handleDeletePurchase(purchase)}
                        >
                          {deletingId === purchase.id ? (
                            <span className="purchases-mini-spinner" />
                          ) : (
                            <FiTrash2 />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <div
          className="purchases-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              setShowForm(false);
          }}
        >
          <section
            className="purchases-modal purchases-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-form-title"
          >
            <div className="purchases-modal-header">
              <div>
                <span className="purchases-modal-kicker">NEW RECORD</span>
                <h2 id="purchase-form-title">Record a purchase</h2>
                <p>
                  Save it as an order, then mark it received when stock arrives.
                </p>
              </div>
              <button
                type="button"
                className="purchases-icon-btn"
                aria-label="Close"
                onClick={() => !saving && setShowForm(false)}
              >
                <FiX />
              </button>
            </div>
            <form onSubmit={handleSavePurchase}>
              <div className="purchases-form-grid">
                <label className="purchases-field">
                  <span>
                    Supplier <b>*</b>
                  </span>
                  <select
                    value={form.supplierId}
                    onChange={(event) =>
                      updateForm("supplierId", event.target.value)
                    }
                    required
                  >
                    <option value="">Choose supplier…</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplierName(supplier)}
                      </option>
                    ))}
                  </select>
                  {suppliers.length === 0 && (
                    <small className="purchases-muted">
                      No suppliers found. Add a supplier on the Suppliers page first.
                    </small>
                  )}
                </label>
                <label className="purchases-field">
                  <span>Reference / invoice no.</span>
                  <input
                    value={form.reference}
                    onChange={(event) =>
                      updateForm("reference", event.target.value)
                    }
                    placeholder="e.g. INV-1042"
                  />
                </label>
                <label className="purchases-field">
                  <span>
                    Purchase date <b>*</b>
                  </span>
                  <input
                    type="date"
                    value={form.purchaseDate}
                    onChange={(event) =>
                      updateForm("purchaseDate", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="purchases-field">
                  <span>Expected delivery</span>
                  <input
                    type="date"
                    value={form.expectedDate}
                    onChange={(event) =>
                      updateForm("expectedDate", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="purchases-lines-heading">
                <div>
                  <h3>Items purchased</h3>
                  <p>Select items already set up in Inventory.</p>
                </div>
                <button
                  type="button"
                  className="purchases-btn purchases-btn-secondary purchases-btn-small"
                  onClick={addLine}
                >
                  <FiPlus /> Add item
                </button>
              </div>
              {inventoryItems.length === 0 && (
                <div className="purchases-inline-warning">
                  No inventory items found. Add items in the Inventory page
                  before recording purchases.
                </div>
              )}
              <div className="purchases-line-list">
                {form.items.map((line, index) => {
                  const chosenItem = inventoryById[line.itemId];
                  return (
                    <div className="purchases-line-row" key={`line-${index}`}>
                      <label className="purchases-field purchases-line-item">
                        <span>Inventory item</span>
                        <select
                          value={line.itemId}
                          onChange={(event) => {
                            const nextId = event.target.value;
                            const item = inventoryById[nextId];
                            setForm((current) => ({
                              ...current,
                              items: current.items.map((currentLine, i) =>
                                i === index
                                  ? {
                                      ...currentLine,
                                      itemId: nextId,
                                      unitCost:
                                        item && currentLine.unitCost === "0"
                                          ? String(number(item.unitCost))
                                          : currentLine.unitCost,
                                    }
                                  : currentLine,
                              ),
                            }));
                          }}
                          required
                        >
                          <option value="">Choose item…</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {item.unit ? ` (${item.unit})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="purchases-field purchases-line-quantity">
                        <span>
                          Quantity{" "}
                          {chosenItem?.unit ? `(${chosenItem.unit})` : ""}
                        </span>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(index, "quantity", event.target.value)
                          }
                          required
                        />
                      </label>
                      <label className="purchases-field purchases-line-cost">
                        <span>Unit cost ($)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) =>
                            updateLine(index, "unitCost", event.target.value)
                          }
                          required
                        />
                      </label>
                      <div className="purchases-line-total">
                        <span>Line total</span>
                        <strong>
                          {money(number(line.quantity) * number(line.unitCost))}
                        </strong>
                      </div>
                      <button
                        type="button"
                        className="purchases-icon-btn purchases-delete-btn purchases-remove-line"
                        title="Remove item"
                        aria-label="Remove item"
                        onClick={() => removeLine(index)}
                        disabled={form.items.length === 1}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="purchases-form-bottom-grid">
                <label className="purchases-field">
                  <span>Amount paid now ($)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.paymentAmount}
                    onChange={(event) =>
                      updateForm("paymentAmount", event.target.value)
                    }
                  />
                </label>
                <label className="purchases-field purchases-notes-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={form.notes}
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    placeholder="Optional notes, delivery details, invoice info…"
                  />
                </label>
              </div>
              <div className="purchases-total-bar">
                <div>
                  <span>Purchase total</span>
                  <strong>{money(formTotal)}</strong>
                </div>
                <div>
                  <span>Balance after payment</span>
                  <strong>
                    {money(
                      Math.max(
                        0,
                        formTotal -
                          Math.min(
                            formTotal,
                            Math.max(0, number(form.paymentAmount)),
                          ),
                      ),
                    )}
                  </strong>
                </div>
              </div>
              <div className="purchases-modal-footer">
                <button
                  type="button"
                  className="purchases-btn purchases-btn-secondary"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="purchases-btn purchases-btn-primary"
                  disabled={saving || inventoryItems.length === 0}
                >
                  {saving ? "Saving…" : "Save purchase"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedPurchase && (
        <div
          className="purchases-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedPurchase(null);
          }}
        >
          <section
            className="purchases-modal purchases-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-detail-title"
          >
            <div className="purchases-modal-header">
              <div>
                <span className="purchases-modal-kicker">PURCHASE DETAILS</span>
                <h2 id="purchase-detail-title">
                  {selectedPurchase.reference ||
                    `PO-${selectedPurchase.id.slice(0, 6).toUpperCase()}`}
                </h2>
                <p>
                  {selectedPurchase.supplier} ·{" "}
                  {dateLabel(selectedPurchase.purchaseDate)}
                </p>
              </div>
              <button
                type="button"
                className="purchases-icon-btn"
                aria-label="Close"
                onClick={() => setSelectedPurchase(null)}
              >
                <FiX />
              </button>
            </div>
            <div className="purchases-detail-status-row">
              <span
                className={`purchases-status status-${(selectedPurchase.status || "Ordered").toLowerCase()}`}
              >
                {selectedPurchase.status || "Ordered"}
              </span>
              <span
                className={`purchases-status payment-${(selectedPurchase.paymentStatus || "Unpaid").toLowerCase().replace(/\s+/g, "-")}`}
              >
                {selectedPurchase.paymentStatus || "Unpaid"}
              </span>
            </div>
            <div className="purchases-detail-table-wrap">
              <table className="purchases-table purchases-detail-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Unit cost</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedPurchase.items || []).map((item, index) => (
                    <tr key={`${item.itemId}-${index}`}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
                      <td>{money(item.unitCost)}</td>
                      <td>
                        {money(
                          item.lineTotal ??
                            number(item.quantity) * number(item.unitCost),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="purchases-detail-totals">
              <div>
                <span>Total</span>
                <strong>{money(selectedPurchase.total)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong>{money(selectedPurchase.paymentAmount)}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong>
                  {money(
                    Math.max(
                      0,
                      number(selectedPurchase.total) -
                        number(selectedPurchase.paymentAmount),
                    ),
                  )}
                </strong>
              </div>
            </div>
            {selectedPurchase.notes && (
              <div className="purchases-detail-notes">
                <strong>Notes</strong>
                <p>{selectedPurchase.notes}</p>
              </div>
            )}
            <div className="purchases-payment-edit">
              <label className="purchases-field">
                <span>Update total amount paid ($)</span>
                <input
                  id="purchases-payment-amount"
                  type="number"
                  min="0"
                  max={number(selectedPurchase.total)}
                  step="0.01"
                  defaultValue={number(selectedPurchase.paymentAmount)}
                />
              </label>
              <button
                type="button"
                className="purchases-btn purchases-btn-secondary"
                onClick={() => {
                  const input = document.getElementById(
                    "purchases-payment-amount",
                  );
                  if (input) updatePayment(selectedPurchase, input.value);
                }}
              >
                Update payment
              </button>
            </div>
            {selectedPurchase.status !== "Received" &&
              !selectedPurchase.stockApplied && (
                <div className="purchases-detail-receive-note">
                  <FiTruck />
                  <span>
                    Stock has not been added yet. Use “Receive into inventory”
                    in the purchase list when the delivery arrives.
                  </span>
                </div>
              )}
            {selectedPurchase.status === "Received" && (
              <div className="purchases-detail-receive-note received">
                <FiCheckCircle />
                <span>
                  Received {timestampLabel(selectedPurchase.receivedAt)}.
                  Inventory stock was applied.
                </span>
              </div>
            )}
            <div className="purchases-modal-footer">
              <button
                type="button"
                className="purchases-btn purchases-btn-secondary"
                onClick={() => setSelectedPurchase(null)}
              >
                Close
              </button>
              {selectedPurchase.status !== "Received" &&
                !selectedPurchase.stockApplied && (
                  <button
                    type="button"
                    className="purchases-btn purchases-btn-primary"
                    disabled={receivingId === selectedPurchase.id}
                    onClick={async () => {
                      await markReceived(selectedPurchase);
                      setSelectedPurchase(null);
                    }}
                  >
                    <FiTruck />{" "}
                    {receivingId === selectedPurchase.id
                      ? "Receiving…"
                      : "Mark as received"}
                  </button>
                )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Purchases;
