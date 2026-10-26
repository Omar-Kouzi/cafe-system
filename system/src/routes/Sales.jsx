
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import {
  FiAlertCircle,
  FiCheck,
  FiClock,
  FiEdit2,
  FiFileText,
  FiPlus,
  FiPrinter,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";

import { db } from "../assets/firebase/config";
import { getRecipes, updateOrder } from "../assets/firebase/firestore";
import "../styles/Sales.css";

const number = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number(value));

const dateValue = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = dateValue(value);

  return date
    ? date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Date unavailable";
};

const makeLine = (product) => ({
  productId: product.id,
  name: product.title || product.name || "Menu item",
  unitPrice: number(product.sellingPrice ?? product.price),
  quantity: 1,
  lineTotal: number(product.sellingPrice ?? product.price),
});

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

export default function Sales() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const [draft, setDraft] = useState(null);
  const [productToAdd, setProductToAdd] = useState("");
  const [complaintText, setComplaintText] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "orders"),
      (snapshot) => {
        setOrders(
          snapshot.docs
            .map((entry) => ({
              id: entry.id,
              ...entry.data(),
            }))
            .sort((a, b) => {
              const dateA = dateValue(a.createdAt)?.getTime() || 0;
              const dateB = dateValue(b.createdAt)?.getTime() || 0;
              return dateB - dateA;
            })
        );

        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Could not load sales:", err);
        setError(
          "Receipts could not be loaded. Check Firestore permissions."
        );
        setLoading(false);
      }
    );

    getRecipes()
      .then((allRecipes) => {
        setProducts(
          allRecipes.filter(
            (recipe) =>
              recipe.recipeType === "product" &&
              recipe.archived !== true
          )
        );
      })
      .catch((err) => {
        console.error("Could not load menu products:", err);
      });

    return unsubscribe;
  }, []);

  const selectedOrder = orders.find(
    (order) => order.id === selectedId
  );

  const visibleOrders = useMemo(() => {
    const term = search.trim().toLowerCase();

    return orders.filter((order) => {
      const receipt = String(
        order.receiptNumber || order.id
      ).toLowerCase();

      const itemText = (order.items || [])
        .map((item) => item.name || "")
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        receipt.includes(term) ||
        itemText.includes(term) ||
        String(order.complaint || "").toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter]);

  const todayOrders = useMemo(() => {
    const now = new Date();

    return orders.filter((order) => {
      const date = dateValue(order.createdAt);

      return (
        date &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    });
  }, [orders]);

  const todayTotal = todayOrders.reduce(
    (sum, order) =>
      order.status === "cancelled"
        ? sum
        : sum + number(order.total),
    0
  );

  const openEditor = (order) => {
    setSelectedId(order.id);

    setDraft({
      items: (order.items || []).map((item) => ({
        ...item,
        unitPrice: number(item.unitPrice),
        quantity: Math.max(1, number(item.quantity)),
      })),
      notes: order.notes || "",
      complaint: order.complaint || "",
      status: order.status || "open",
      paymentStatus: order.paymentStatus || "unpaid",
    });

    setComplaintText(order.complaint || "");
    setProductToAdd("");
    setNotice("");
    setError("");
  };

  const closeEditor = () => {
    setSelectedId(null);
    setDraft(null);
    setProductToAdd("");
    setComplaintText("");
  };

  const updateLine = (index, changes) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index ? { ...item, ...changes } : item
      ),
    }));
  };

  const addProduct = () => {
    if (!productToAdd) return;

    const product = products.find(
      (item) => item.id === productToAdd
    );

    if (!product) return;

    setDraft((current) => {
      const existing = current.items.find(
        (item) => item.productId === product.id
      );

      if (existing) {
        return {
          ...current,
          items: current.items.map((item) =>
            item.productId === product.id
              ? {
                  ...item,
                  quantity: number(item.quantity) + 1,
                }
              : item
          ),
        };
      }

      return {
        ...current,
        items: [...current.items, makeLine(product)],
      };
    });

    setProductToAdd("");
  };

  const draftTotal = (draft?.items || []).reduce(
    (sum, item) =>
      sum +
      number(item.unitPrice) *
        Math.max(0, number(item.quantity)),
    0
  );

  // Print a saved receipt or the current unsaved editor draft.
  const printReceipt = (order, items = order.items || []) => {
    const receiptNumber =
      order.receiptNumber ||
      `R-${String(order.id || "new").slice(0, 7)}`;

    const validItems = items || [];

    const subtotal = validItems.reduce(
      (sum, item) =>
        sum +
        number(item.unitPrice) *
          Math.max(0, number(item.quantity)),
      0
    );

    const printWindow = window.open(
      "",
      "_blank",
      "width=800,height=700"
    );

    if (!printWindow) {
      setError(
        "Printing was blocked. Allow pop-ups for this website and try again."
      );
      return;
    }

    const itemRows = validItems
      .map((item) => {
        const quantity = number(item.quantity);
        const unitPrice = number(item.unitPrice);
        const lineTotal = quantity * unitPrice;

        return `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td class="number">${quantity}</td>
            <td class="number">${money(unitPrice)}</td>
            <td class="number">${money(lineTotal)}</td>
          </tr>
        `;
      })
      .join("");

    const notes = order.notes
      ? `
        <section class="notes">
          <strong>Notes</strong>
          <p>${escapeHtml(order.notes)}</p>
        </section>
      `
      : "";

    const complaint = order.complaint
      ? `
        <section class="notes">
          <strong>Complaint / issue</strong>
          <p>${escapeHtml(order.complaint)}</p>
        </section>
      `
      : "";

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Receipt ${escapeHtml(receiptNumber)}</title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 28px;
              color: #202020;
              background: #fff;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 13px;
            }

            .receipt {
              width: 100%;
              max-width: 720px;
              margin: 0 auto;
            }

            .receipt-header {
              text-align: center;
              padding-bottom: 20px;
              margin-bottom: 22px;
              border-bottom: 2px solid #222;
            }

            .brand {
              margin: 0 0 7px;
              font-size: 28px;
              font-weight: 800;
              letter-spacing: 2px;
            }

            .receipt-title {
              margin: 0;
              font-size: 15px;
              font-weight: 600;
            }

            .receipt-number {
              margin-top: 8px;
              color: #666;
              font-size: 12px;
            }

            .details {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin-bottom: 24px;
            }

            .details p {
              margin: 5px 0;
              overflow-wrap: anywhere;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }

            th,
            td {
              padding: 11px 6px;
              border-bottom: 1px solid #ddd;
              text-align: left;
              overflow-wrap: anywhere;
            }

            th {
              border-top: 1px solid #222;
              border-bottom: 2px solid #222;
              font-size: 11px;
              text-transform: uppercase;
            }

            th:first-child,
            td:first-child {
              width: 42%;
            }

            .number {
              text-align: right;
              white-space: nowrap;
            }

            .totals {
              width: 260px;
              max-width: 100%;
              margin: 22px 0 0 auto;
            }

            .total-row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              padding: 7px 0;
            }

            .grand-total {
              margin-top: 6px;
              padding-top: 12px;
              border-top: 2px solid #222;
              font-size: 18px;
              font-weight: 800;
            }

            .notes {
              margin-top: 24px;
              padding-top: 12px;
              border-top: 1px solid #ddd;
              overflow-wrap: anywhere;
            }

            .notes p {
              margin-bottom: 0;
              white-space: pre-wrap;
            }

            .footer {
              margin-top: 40px;
              padding-top: 15px;
              border-top: 1px dashed #aaa;
              text-align: center;
              color: #555;
            }

            @page {
              size: auto;
              margin: 12mm;
            }

            @media print {
              body {
                padding: 0;
              }

              .receipt {
                max-width: none;
              }

              tr,
              .totals,
              .details {
                break-inside: avoid;
              }
            }

            @media screen {
              body {
                background: #f2f2f2;
              }

              .receipt {
                background: #fff;
                padding: 28px;
                box-shadow: 0 2px 14px #00000012;
              }
            }
          </style>
        </head>

        <body>
          <main class="receipt">
            <header class="receipt-header">
              <h1 class="brand">MATRIX</h1>
              <p class="receipt-title">Sales Receipt</p>
              <div class="receipt-number">
                Receipt ${escapeHtml(receiptNumber)}
              </div>
            </header>

            <section class="details">
              <div>
                <p><strong>Date:</strong> ${escapeHtml(
                  formatDate(order.createdAt)
                )}</p>
                <p><strong>Status:</strong> ${escapeHtml(
                  order.status || "open"
                )}</p>
              </div>

              <div>
                <p><strong>Payment:</strong> ${escapeHtml(
                  order.paymentStatus || "unpaid"
                )}</p>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="number">Qty</th>
                  <th class="number">Unit price</th>
                  <th class="number">Total</th>
                </tr>
              </thead>

              <tbody>
                ${
                  itemRows ||
                  '<tr><td colspan="4">No items</td></tr>'
                }
              </tbody>
            </table>

            <section class="totals">
              <div class="total-row">
                <span>Subtotal</span>
                <strong>${money(subtotal)}</strong>
              </div>

              <div class="total-row grand-total">
                <span>Total</span>
                <strong>${money(subtotal)}</strong>
              </div>
            </section>

            ${notes}
            ${complaint}

            <footer class="footer">
              Thank you!
            </footer>
          </main>

          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };

            window.onafterprint = function () {
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const saveReceipt = async () => {
    if (!selectedOrder || !draft || saving) return;

    if (!draft.items.length) {
      setError("A receipt must contain at least one item.");
      return;
    }

    if (
      draft.items.some(
        (item) =>
          !String(item.name || "").trim() ||
          number(item.quantity) <= 0 ||
          number(item.unitPrice) < 0
      )
    ) {
      setError(
        "Check item names, quantities, and prices before saving."
      );
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const items = draft.items.map((item) => ({
        productId: item.productId || "",
        name: String(item.name).trim(),
        unitPrice: number(item.unitPrice),
        quantity: number(item.quantity),
        lineTotal:
          number(item.unitPrice) * number(item.quantity),
      }));

      const subtotal = items.reduce(
        (sum, item) => sum + item.lineTotal,
        0
      );

      await updateOrder(selectedOrder.id, {
        items,
        subtotal,
        total: subtotal,
        notes: draft.notes.trim(),
        complaint: complaintText.trim(),
        status: draft.status,
        paymentStatus: draft.paymentStatus,
      });

      setNotice("Receipt saved successfully.");
      closeEditor();
    } catch (err) {
      console.error("Could not save receipt:", err);
      setError("The receipt could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (order) => {
    try {
      setError("");
      setNotice("");

      await updateOrder(order.id, {
        paymentStatus: "paid",
      });

      setNotice(
        `${order.receiptNumber || "Receipt"} marked as paid.`
      );
    } catch (err) {
      console.error("Could not update payment status:", err);
      setError("Payment status could not be updated.");
    }
  };

  return (
    <main className="matrix-sales-page">
      <header className="matrix-sales-header">
        <div>
          <span className="matrix-sales-eyebrow">
            MATRIX · MANAGEMENT
          </span>
          <h1>Sales &amp; Receipts</h1>
          <p>
            Review orders, update receipts, and keep track of complaints.
          </p>
        </div>

        <div className="matrix-sales-receipt-count">
          <strong>{orders.length}</strong>
          <span>Total receipts</span>
        </div>
      </header>

      {error && (
        <div className="matrix-sales-alert error" role="alert">
          <FiAlertCircle />
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

      {notice && (
        <div className="matrix-sales-alert success" role="status">
          <FiCheck />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            <FiX />
          </button>
        </div>
      )}

      <section className="matrix-sales-stats">
        <article className="matrix-sales-stat-card">
          <span className="matrix-sales-stat-icon">
            <FiFileText />
          </span>
          <div>
            <small>Today's receipts</small>
            <strong>{todayOrders.length}</strong>
          </div>
        </article>

        <article className="matrix-sales-stat-card">
          <span className="matrix-sales-stat-icon green">
            <FiCheck />
          </span>
          <div>
            <small>Today's order value</small>
            <strong>{money(todayTotal)}</strong>
          </div>
        </article>

        <article className="matrix-sales-stat-card">
          <span className="matrix-sales-stat-icon amber">
            <FiClock />
          </span>
          <div>
            <small>Open receipts</small>
            <strong>
              {
                orders.filter(
                  (order) => (order.status || "open") === "open"
                ).length
              }
            </strong>
          </div>
        </article>
      </section>

      <section className="matrix-sales-panel">
        <div className="matrix-sales-panel-heading">
          <div>
            <h2>Receipts</h2>
            <p>
              Select a receipt to edit items, quantities, notes, or
              complaints.
            </p>
          </div>

          <span className="matrix-sales-count">
            {visibleOrders.length} shown
          </span>
        </div>

        <div className="matrix-sales-toolbar">
          <label className="matrix-sales-search">
            <FiSearch />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search receipt, item, or complaint…"
              aria-label="Search receipts"
            />
            {search && (
              <button
                type="button"
                className="matrix-sales-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter receipts by status"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <div className="matrix-sales-empty">
            <span className="matrix-sales-spinner" />
            <p>Loading receipts…</p>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="matrix-sales-empty">
            <span className="matrix-sales-empty-icon">
              <FiFileText />
            </span>
            <h3>No receipts found</h3>
            <p>
              {search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create an order from the menu to see it here."}
            </p>
          </div>
        ) : (
          <div className="matrix-sales-list">
            {visibleOrders.map((order) => (
              <article className="matrix-sales-order" key={order.id}>
                <div className="matrix-sales-order-main">
                  <div className="matrix-sales-order-title">
                    <strong>
                      {order.receiptNumber ||
                        `R-${order.id.slice(0, 7)}`}
                    </strong>

                    <span
                      className={`matrix-sales-status ${
                        order.status || "open"
                      }`}
                    >
                      {order.status || "open"}
                    </span>

                    {order.complaint && (
                      <span className="matrix-sales-complaint-tag">
                        <FiAlertCircle />
                        Complaint
                      </span>
                    )}
                  </div>

                  <p className="matrix-sales-order-items">
                    {(order.items || [])
                      .map(
                        (item) =>
                          `${item.name} × ${item.quantity}`
                      )
                      .join(", ") || "No items"}
                  </p>

                  <span className="matrix-sales-order-date">
                    <FiClock />
                    {formatDate(order.createdAt)}
                  </span>
                </div>

                <div className="matrix-sales-order-side">
                  <strong className="matrix-sales-order-total">
                    {money(order.total)}
                  </strong>

                  <span
                    className={`matrix-sales-payment ${
                      order.paymentStatus || "unpaid"
                    }`}
                  >
                    {order.paymentStatus || "unpaid"}
                  </span>

                  <div className="matrix-sales-order-actions">
                    <button
                      type="button"
                      className="matrix-sales-btn"
                      onClick={() => printReceipt(order)}
                    >
                      <FiPrinter />
                      <span>Print</span>
                    </button>

                    <button
                      type="button"
                      className="matrix-sales-btn"
                      onClick={() => openEditor(order)}
                    >
                      <FiEdit2 />
                      <span>Edit</span>
                    </button>

                    {order.paymentStatus !== "paid" &&
                      order.status !== "cancelled" && (
                        <button
                          type="button"
                          className="matrix-sales-btn primary"
                          onClick={() => markPaid(order)}
                        >
                          <FiCheck />
                          <span>Mark paid</span>
                        </button>
                      )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedOrder && draft && (
        <div
          className="matrix-sales-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              closeEditor();
            }
          }}
        >
          <section
            className="matrix-sales-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="matrix-sales-editor-title"
          >
            <header className="matrix-sales-editor-header">
              <div>
                <span className="matrix-sales-eyebrow">
                  EDIT RECEIPT
                </span>
                <h2 id="matrix-sales-editor-title">
                  {selectedOrder.receiptNumber || selectedOrder.id}
                </h2>
                <p>
                  Created {formatDate(selectedOrder.createdAt)}
                </p>
              </div>

              <button
                type="button"
                className="matrix-sales-icon-btn"
                onClick={closeEditor}
                aria-label="Close editor"
                disabled={saving}
              >
                <FiX />
              </button>
            </header>

            <div className="matrix-sales-editor-content">
              <div className="matrix-sales-add-product">
                <select
                  value={productToAdd}
                  onChange={(event) =>
                    setProductToAdd(event.target.value)
                  }
                  aria-label="Choose product to add"
                >
                  <option value="">Add a menu product…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title || product.name} —{" "}
                      {money(product.sellingPrice ?? product.price)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="matrix-sales-btn primary"
                  disabled={!productToAdd}
                  onClick={addProduct}
                >
                  <FiPlus />
                  Add item
                </button>
              </div>

              <div className="matrix-sales-edit-lines">
                {draft.items.map((item, index) => (
                  <div
                    className="matrix-sales-edit-line"
                    key={`${item.productId || item.name}-${index}`}
                  >
                    <label className="matrix-sales-field item-name">
                      <span>Item</span>
                      <input
                        value={item.name}
                        onChange={(event) =>
                          updateLine(index, {
                            name: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className="matrix-sales-field">
                      <span>Qty</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(event) =>
                          updateLine(index, {
                            quantity: Math.max(
                              1,
                              number(event.target.value)
                            ),
                          })
                        }
                      />
                    </label>

                    <label className="matrix-sales-field">
                      <span>Unit price ($)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(event) =>
                          updateLine(index, {
                            unitPrice: Math.max(
                              0,
                              number(event.target.value)
                            ),
                          })
                        }
                      />
                    </label>

                    <strong className="matrix-sales-line-total">
                      {money(
                        number(item.unitPrice) *
                          number(item.quantity)
                      )}
                    </strong>

                    <button
                      type="button"
                      className="matrix-sales-icon-btn danger"
                      aria-label={`Remove ${item.name}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          items: current.items.filter(
                            (_, i) => i !== index
                          ),
                        }))
                      }
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                ))}
              </div>

              {draft.items.length === 0 && (
                <p className="matrix-sales-no-lines">
                  No items in this receipt. Add a product before saving.
                </p>
              )}

              <label className="matrix-sales-field">
                <span>Order notes</span>
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Order instructions or internal notes…"
                />
              </label>

              <label className="matrix-sales-field">
                <span>Complaint / issue</span>
                <textarea
                  rows={3}
                  value={complaintText}
                  onChange={(event) =>
                    setComplaintText(event.target.value)
                  }
                  placeholder="Record a complaint or leave empty…"
                />
              </label>

              <div className="matrix-sales-editor-selects">
                <label className="matrix-sales-field">
                  <span>Order status</span>
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="open">Open</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>

                <label className="matrix-sales-field">
                  <span>Payment status</span>
                  <select
                    value={draft.paymentStatus}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        paymentStatus: event.target.value,
                      }))
                    }
                  >
                    <option value="unpaid">Unpaid</option>
                    <option value="paid">Paid</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </label>
              </div>

              <div className="matrix-sales-editor-total">
                <span>Receipt total</span>
                <strong>{money(draftTotal)}</strong>
              </div>
            </div>

            <footer className="matrix-sales-editor-footer">
              <button
                type="button"
                className="matrix-sales-btn"
                onClick={() =>
                  printReceipt(
                    {
                      ...selectedOrder,
                      ...draft,
                    },
                    draft.items
                  )
                }
              >
                <FiPrinter />
                Print receipt
              </button>

              <div className="matrix-sales-editor-footer-right">
                <button
                  type="button"
                  className="matrix-sales-btn"
                  onClick={closeEditor}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="matrix-sales-btn primary"
                  onClick={saveReceipt}
                  disabled={saving}
                >
                  <FiCheck />
                  {saving ? "Saving…" : "Save receipt"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
