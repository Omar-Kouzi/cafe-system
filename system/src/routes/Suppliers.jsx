import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiDownload,
  FiEdit2,
  FiMail,
  FiMapPin,
  FiPhone,
  FiPlus,
  FiSearch,
  FiTruck,
  FiUser,
  FiX,
  FiGlobe,
  FiTrash2,
} from "react-icons/fi";
import { db } from "../assets/firebase/config";
import "../styles/Suppliers.css";

const SUPPLIERS_COLLECTION = "suppliers";
const CATEGORIES = [
  "Ingredients",
  "Packaging",
  "Cleaning",
  "Equipment",
  "Other",
];
const EMPTY_FORM = {
  name: "",
  category: "Ingredients",
  contactPerson: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  paymentTerms: "",
  notes: "",
  active: true,
};

function csvDownload(rows) {
  if (!rows.length) {
    window.alert("There are no suppliers to export.");
    return;
  }
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    [
      "Supplier",
      "Category",
      "Contact person",
      "Phone",
      "Email",
      "Website",
      "Address",
      "Payment terms",
      "Status",
      "Notes",
    ],
    ...rows.map((s) => [
      s.name,
      s.category,
      s.contactPerson,
      s.phone,
      s.email,
      s.website,
      s.address,
      s.paymentTerms,
      s.active === false ? "Inactive" : "Active",
      s.notes,
    ]),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "suppliers.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [statusFilter, setStatusFilter] = useState("All suppliers");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, SUPPLIERS_COLLECTION),
      (snapshot) => {
        setSuppliers(
          snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        );
        setLoading(false);
        setError("");
      },
      (err) => {
        console.error("Loading suppliers failed:", err);
        setError(
          "Could not load suppliers. Check your Firestore rules and connection.",
        );
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers
      .filter((supplier) => {
        const haystack = [
          supplier.name,
          supplier.category,
          supplier.contactPerson,
          supplier.phone,
          supplier.email,
          supplier.address,
          supplier.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const matchesSearch = !query || haystack.includes(query);
        const matchesCategory =
          categoryFilter === "All categories" ||
          supplier.category === categoryFilter;
        const active = supplier.active !== false;
        const matchesStatus =
          statusFilter === "All suppliers" ||
          (statusFilter === "Active" ? active : !active);
        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [suppliers, search, categoryFilter, statusFilter]);

  const activeCount = suppliers.filter(
    (supplier) => supplier.active !== false,
  ).length;
  const inactiveCount = suppliers.length - activeCount;
  const categoriesUsed = new Set(
    suppliers.map((supplier) => supplier.category).filter(Boolean),
  ).size;

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openNewSupplier() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditSupplier(supplier) {
    setEditing(supplier);
    setForm({ ...EMPTY_FORM, ...supplier, active: supplier.active !== false });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  async function saveSupplier(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Enter a supplier name.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const data = {
      name,
      category: form.category,
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      website: form.website.trim(),
      address: form.address.trim(),
      paymentTerms: form.paymentTerms.trim(),
      notes: form.notes.trim(),
      active: Boolean(form.active),
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, SUPPLIERS_COLLECTION, editing.id), data);
        setNotice(`${name} updated successfully.`);
      } else {
        await addDoc(collection(db, SUPPLIERS_COLLECTION), {
          ...data,
          createdAt: serverTimestamp(),
        });
        setNotice(`${name} added successfully.`);
      }
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      console.error("Saving supplier failed:", err);
      setError(
        err.message || "Could not save supplier. Check Firestore permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(supplier) {
    if (
      !window.confirm(
        `Delete ${supplier.name || "this supplier"}? Existing purchase records will not be deleted.`,
      )
    )
      return;
    setDeletingId(supplier.id);
    setError("");
    setNotice("");
    try {
      await deleteDoc(doc(db, SUPPLIERS_COLLECTION, supplier.id));
      setNotice(
        `${supplier.name || "Supplier"} deleted. Existing purchase history was kept.`,
      );
    } catch (err) {
      console.error("Deleting supplier failed:", err);
      setError(
        err.message ||
          "Could not delete supplier. Check Firestore permissions.",
      );
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className="suppliers-page">
      <header className="suppliers-header">
        <div>
          <div className="suppliers-eyebrow">
            <FiTruck /> INVENTORY MANAGEMENT
          </div>
          <h1>Suppliers</h1>
          <p>
            Keep supplier contacts, categories, and payment terms organized in
            one place.
          </p>
        </div>
        <div className="suppliers-header-actions">
          <button
            type="button"
            className="suppliers-btn suppliers-btn-secondary"
            onClick={() => csvDownload(filteredSuppliers)}
          >
            <FiDownload /> Export CSV
          </button>
          <button
            type="button"
            className="suppliers-btn suppliers-btn-primary"
            onClick={openNewSupplier}
          >
            <FiPlus /> Add supplier
          </button>
        </div>
      </header>

      {error && (
        <div className="suppliers-alert suppliers-alert-error">
          <FiAlertCircle />
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
        <div className="suppliers-alert suppliers-alert-success">
          <FiCheckCircle />
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

      <section className="suppliers-stats-grid">
        <article className="suppliers-stat-card">
          <span className="suppliers-stat-icon">
            <FiTruck />
          </span>
          <div>
            <span className="suppliers-stat-label">Total suppliers</span>
            <strong>{suppliers.length}</strong>
            <small>Saved contacts</small>
          </div>
        </article>
        <article className="suppliers-stat-card">
          <span className="suppliers-stat-icon green">
            <FiCheckCircle />
          </span>
          <div>
            <span className="suppliers-stat-label">Active suppliers</span>
            <strong>{activeCount}</strong>
            <small>Available to order from</small>
          </div>
        </article>
        <article className="suppliers-stat-card">
          <span className="suppliers-stat-icon amber">
            <FiUser />
          </span>
          <div>
            <span className="suppliers-stat-label">Inactive</span>
            <strong>{inactiveCount}</strong>
            <small>Archived from active use</small>
          </div>
        </article>
        <article className="suppliers-stat-card">
          <span className="suppliers-stat-icon purple">
            <FiMapPin />
          </span>
          <div>
            <span className="suppliers-stat-label">Categories</span>
            <strong>{categoriesUsed}</strong>
            <small>Supplier types represented</small>
          </div>
        </article>
      </section>

      <section className="suppliers-panel">
        <div className="suppliers-panel-heading">
          <div>
            <h2>Supplier directory</h2>
            <p>View and manage your supplier contact details.</p>
          </div>
          <span className="suppliers-count-pill">
            {filteredSuppliers.length} shown
          </span>
        </div>
        <div className="suppliers-toolbar">
          <label className="suppliers-search">
            <FiSearch />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, contact, phone, email…"
            />
          </label>
          <label className="suppliers-select-wrap">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option>All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="suppliers-select-wrap">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option>All suppliers</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="suppliers-empty">
            <span className="suppliers-spinner" />
            Loading suppliers…
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="suppliers-empty">
            <span className="suppliers-empty-icon">
              <FiTruck />
            </span>
            <h3>
              {suppliers.length
                ? "No suppliers match your filters"
                : "No suppliers yet"}
            </h3>
            <p>
              {suppliers.length
                ? "Try a different search or filter."
                : "Add your first supplier to start building your directory."}
            </p>
            {!suppliers.length && (
              <button
                type="button"
                className="suppliers-btn suppliers-btn-primary"
                onClick={openNewSupplier}
              >
                <FiPlus /> Add supplier
              </button>
            )}
          </div>
        ) : (
          <div className="suppliers-table-wrap">
            <table className="suppliers-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact details</th>
                  <th>Category</th>
                  <th>Payment terms</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="suppliers-name-cell">
                        <span className="suppliers-avatar">
                          {String(supplier.name || "S")
                            .trim()
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                        <div>
                          <strong>{supplier.name || "Unnamed supplier"}</strong>
                          {supplier.address && (
                            <small>
                              <FiMapPin /> {supplier.address}
                            </small>
                          )}
                          {supplier.notes && (
                            <small className="suppliers-notes-preview">
                              {supplier.notes}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="suppliers-contact-cell">
                        {supplier.contactPerson && (
                          <span>
                            <FiUser /> {supplier.contactPerson}
                          </span>
                        )}
                        {supplier.phone && (
                          <a href={`tel:${supplier.phone}`}>
                            <FiPhone /> {supplier.phone}
                          </a>
                        )}
                        {supplier.email && (
                          <a href={`mailto:${supplier.email}`}>
                            <FiMail /> {supplier.email}
                          </a>
                        )}
                        {supplier.website && (
                          <a
                            href={
                              /^(https?:)?\/\//i.test(supplier.website)
                                ? supplier.website
                                : `https://${supplier.website}`
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FiGlobe /> Website
                          </a>
                        )}
                        {!supplier.contactPerson &&
                          !supplier.phone &&
                          !supplier.email &&
                          !supplier.website && (
                            <span className="suppliers-muted">
                              No contact details
                            </span>
                          )}
                      </div>
                    </td>
                    <td>
                      <span className="suppliers-category-pill">
                        {supplier.category || "Other"}
                      </span>
                    </td>
                    <td>
                      {supplier.paymentTerms || (
                        <span className="suppliers-muted">Not specified</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`suppliers-status ${supplier.active === false ? "inactive" : "active"}`}
                      >
                        <i />
                        {supplier.active === false ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td>
                      <div className="suppliers-row-actions">
                        <button
                          type="button"
                          className="suppliers-icon-btn"
                          title="Edit supplier"
                          aria-label={`Edit ${supplier.name}`}
                          onClick={() => openEditSupplier(supplier)}
                        >
                          <FiEdit2 />
                        </button>
                        <button
                          type="button"
                          className="suppliers-icon-btn danger"
                          title="Delete supplier"
                          aria-label={`Delete ${supplier.name}`}
                          onClick={() => deleteSupplier(supplier)}
                          disabled={deletingId === supplier.id}
                        >
                          {deletingId === supplier.id ? "…" : <FiTrash2 />}
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
          className="suppliers-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              setShowForm(false);
          }}
        >
          <section
            className="suppliers-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-form-title"
          >
            <header className="suppliers-modal-header">
              <div>
                <span className="suppliers-modal-kicker">
                  SUPPLIER DIRECTORY
                </span>
                <h2 id="supplier-form-title">
                  {editing ? "Edit supplier" : "Add supplier"}
                </h2>
                <p>Contact information and ordering preferences.</p>
              </div>
              <button
                type="button"
                className="suppliers-icon-btn"
                aria-label="Close"
                onClick={() => !saving && setShowForm(false)}
              >
                <FiX />
              </button>
            </header>
            <form onSubmit={saveSupplier}>
              <div className="suppliers-form-grid">
                <label className="suppliers-field full">
                  <span>
                    Supplier / company name <b>*</b>
                  </span>
                  <input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="e.g. Beirut Food Supply"
                    required
                    autoFocus
                  />
                </label>
                <label className="suppliers-field">
                  <span>Category</span>
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
                <label className="suppliers-field">
                  <span>Contact person</span>
                  <input
                    value={form.contactPerson}
                    onChange={(event) =>
                      updateForm("contactPerson", event.target.value)
                    }
                    placeholder="Name of your contact"
                  />
                </label>
                <label className="suppliers-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(event) =>
                      updateForm("phone", event.target.value)
                    }
                    placeholder="+961 …"
                  />
                </label>
                <label className="suppliers-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      updateForm("email", event.target.value)
                    }
                    placeholder="supplier@example.com"
                  />
                </label>
                <label className="suppliers-field">
                  <span>Website</span>
                  <input
                    value={form.website}
                    onChange={(event) =>
                      updateForm("website", event.target.value)
                    }
                    placeholder="www.example.com"
                  />
                </label>
                <label className="suppliers-field">
                  <span>Payment terms</span>
                  <input
                    value={form.paymentTerms}
                    onChange={(event) =>
                      updateForm("paymentTerms", event.target.value)
                    }
                    placeholder="e.g. Cash on delivery, 30 days"
                  />
                </label>
                <label className="suppliers-field full">
                  <span>Address</span>
                  <input
                    value={form.address}
                    onChange={(event) =>
                      updateForm("address", event.target.value)
                    }
                    placeholder="Area, city, delivery address"
                  />
                </label>
                <label className="suppliers-field full">
                  <span>Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    rows="3"
                    placeholder="Delivery schedule, minimum order, preferred products…"
                  />
                </label>
                <label className="suppliers-active-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(form.active)}
                    onChange={(event) =>
                      updateForm("active", event.target.checked)
                    }
                  />
                  <span>
                    <strong>Active supplier</strong>
                    <small>
                      Inactive suppliers remain in the directory but are marked
                      unavailable for new orders.
                    </small>
                  </span>
                </label>
              </div>
              <footer className="suppliers-modal-footer">
                <button
                  type="button"
                  className="suppliers-btn suppliers-btn-secondary"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="suppliers-btn suppliers-btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : editing
                      ? "Save changes"
                      : "Add supplier"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
