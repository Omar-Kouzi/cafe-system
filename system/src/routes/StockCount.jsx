import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import SecureLS from "secure-ls";
import {
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiCopy,
  FiPackage,
  FiPlus,
  FiPrinter,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import { db } from "../assets/firebase/config";
import "../styles/StockCount.css";

const RECIPES = "recipes";
const PLANS = "preparationPlans";
const WEIGHT_UNITS = ["g", "kg", "ml", "L"];

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(dateKey) {
  if (!dateKey) return "";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatQuantity(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(Number(value) || 0);
}

function normalizePreparationItem(item) {
  return {
    ...item,
    actualQuantity: item.actualQuantity ?? "",
    actualUnit: item.actualUnit || item.targetUnit || "portions",
    wasteQuantity: item.wasteQuantity ?? "",
    wasteUnit: item.wasteUnit || item.targetUnit || "portions",
    productionNotes: item.productionNotes || "",
  };
}

function createItem(recipe) {
  const unit = String(recipe.yieldUnit || "pieces");
  const isWeight = WEIGHT_UNITS.includes(unit);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    recipeId: recipe.id,
    name: recipe.title || "Untitled recipe",
    recipeType: recipe.recipeType || "food",
    targetType: isWeight ? "weight" : "portions",
    targetQuantity: "",
    targetUnit: isWeight ? unit : "portions",
    completed: false,
    actualQuantity: "",
    actualUnit: isWeight ? unit : "portions",
    wasteQuantity: "",
    wasteUnit: isWeight ? unit : "portions",
    productionNotes: "",
  };
}

export default function StockCount() {
  const ls = useMemo(() => new SecureLS({ encodingType: "aes" }), []);
  const uid = ls.get("uid");

  const [recipes, setRecipes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [items, setItems] = useState([]);
  const [dateKey, setDateKey] = useState(() => localDateKey());
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingResults, setSavingResults] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, RECIPES),
      (snapshot) => {
        setRecipes(
          snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError("Could not load recipes. Check Firestore permissions.");
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, PLANS),
      (snapshot) => {
        setPlans(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((entry) => !uid || entry.createdBy === uid)
            .sort((a, b) =>
              String(b.dateKey || "").localeCompare(String(a.dateKey || "")),
            ),
        );
      },
      (err) => {
        console.error(err);
        setError(
          "Could not load preparation history. Check Firestore permissions.",
        );
      },
    );
    return unsubscribe;
  }, [uid]);

  const plan = plans.find((entry) => entry.dateKey === dateKey);

  // Load a plan when its date/identity changes, not on every live snapshot update.
  // This prevents Firestore snapshots from overwriting edits while you type.
  useEffect(() => {
    setItems((plan?.items || []).map(normalizePreparationItem));
    setLastSaved(plan?.updatedAt || null);
    setError("");
    setNotice("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, plan?.id]);

  const activePlan = plan || null;
  const isTransferred =
    activePlan?.status === "transferred" ||
    activePlan?.status === "ready_for_production";

  const availableRecipes = useMemo(() => {
    return recipes
      .filter((recipe) => showArchived || !recipe.archived)
      .filter((recipe) =>
        `${recipe.title || ""} ${recipe.description || ""} ${(recipe.categories || []).join(" ")}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
      .sort((a, b) =>
        String(a.title || "").localeCompare(String(b.title || "")),
      );
  }, [recipes, search, showArchived]);

  const selectedRecipeIds = new Set(items.map((item) => item.recipeId));

  function addRecipe(recipe) {
    if (isTransferred) {
      setError("This plan has already been sent to Production.");
      return;
    }
    if (selectedRecipeIds.has(recipe.id)) {
      setNotice("This recipe is already on this day's checklist.");
      return;
    }
    setItems((current) => [...current, createItem(recipe)]);
    setNotice("");
    setError("");
  }

  function updateItem(id, changes) {
    if (isTransferred) return;
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  function updateProductionResult(id, changes) {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...normalizePreparationItem(item), ...changes }
          : item,
      ),
    );
  }

  function removeItem(id) {
    if (isTransferred) return;
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function validateTargets() {
    for (const item of items) {
      const amount = Number(item.targetQuantity);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(`Enter a valid target quantity for ${item.name}.`);
        return false;
      }
      if (item.targetType === "portions" && !Number.isInteger(amount)) {
        setError(`The portion target for ${item.name} must be a whole number.`);
        return false;
      }
      if (!item.targetUnit) {
        setError(`Choose a unit for ${item.name}.`);
        return false;
      }
    }
    return true;
  }

  async function savePlan() {
    if (!uid) {
      setError("Your user session was not found. Please sign in again.");
      return;
    }
    if (isTransferred) {
      setError(
        "This plan has already been sent to Production. You can still save actual results below.",
      );
      return;
    }
    if (!items.length) {
      setError("Add at least one item before saving the checklist.");
      return;
    }
    if (!validateTargets()) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setDoc(
        doc(db, PLANS, dateKey),
        {
          dateKey,
          items: items.map(normalizePreparationItem),
          status: activePlan?.status || "draft",
          createdBy: uid,
          updatedAt: serverTimestamp(),
          ...(activePlan ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      setLastSaved(new Date());
      setNotice("Preparation checklist saved.");
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not save the preparation checklist.");
    } finally {
      setSaving(false);
    }
  }

  async function sendToProduction() {
    if (!uid) {
      setError("Please sign in again before transferring this plan.");
      return;
    }
    if (!items.length) {
      setError("Add at least one recipe before transferring the plan.");
      return;
    }
    if (isTransferred) {
      setError("This plan has already been transferred.");
      return;
    }
    if (!validateTargets()) return;

    if (
      !window.confirm(
        "Mark this checklist as ready for Production? This does not record actual output or deduct ingredients.",
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setDoc(
        doc(db, PLANS, dateKey),
        {
          dateKey,
          items: items.map(normalizePreparationItem),
          status: "ready_for_production",
          createdBy: uid,
          transferredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(activePlan ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      setNotice(
        "Checklist marked ready for Production. This does not deduct ingredients or record completed production.",
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not transfer the checklist.");
    } finally {
      setSaving(false);
    }
  }

  async function saveActualResults() {
    if (!uid) {
      setError("Your user session was not found. Please sign in again.");
      return;
    }
    if (!items.length) {
      setError("There are no items to record results for.");
      return;
    }

    for (const item of items) {
      const actual = String(item.actualQuantity ?? "").trim();
      const waste = String(item.wasteQuantity ?? "").trim();
      if (
        actual !== "" &&
        (!Number.isFinite(Number(actual)) || Number(actual) < 0)
      ) {
        setError(
          `Enter a valid actual quantity for ${item.name}, or leave it blank.`,
        );
        return;
      }
      if (
        waste !== "" &&
        (!Number.isFinite(Number(waste)) || Number(waste) < 0)
      ) {
        setError(
          `Enter a valid waste quantity for ${item.name}, or leave it blank.`,
        );
        return;
      }
    }

    setSavingResults(true);
    setError("");
    setNotice("");
    try {
      await setDoc(
        doc(db, PLANS, dateKey),
        {
          dateKey,
          items: items.map(normalizePreparationItem),
          createdBy: uid,
          resultsSavedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(activePlan
            ? {}
            : { createdAt: serverTimestamp(), status: "draft" }),
        },
        { merge: true },
      );
      setLastSaved(new Date());
      setNotice(
        "Actual production results saved to this day's preparation history. No inventory was deducted.",
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not save actual production results.");
    } finally {
      setSavingResults(false);
    }
  }

  function printProductionSheet() {
    if (!items.length) {
      setError("Add items to the checklist before printing.");
      return;
    }
    setError("");
    window.print();
  }

  const completedCount = items.filter((item) => item.completed).length;
  const resultCount = items.filter(
    (item) => String(item.actualQuantity ?? "").trim() !== "",
  ).length;

  return (
    <main className="stock-count-page">
      <header className="sc-header sc-no-print">
        <div>
          <div className="sc-eyebrow">
            <FiCalendar /> OPERATIONS / PREPARATION
          </div>
          <h1>Daily Preparation</h1>
          <p>
            Plan what the kitchen needs to prepare, print a worksheet, and
            record actual output at the end of the day.
          </p>
        </div>
        <div className="sc-header-actions">
          <label className="sc-date-field">
            <span>Preparation date</span>
            <input
              type="date"
              value={dateKey}
              onChange={(event) => setDateKey(event.target.value)}
            />
          </label>
          <span
            className={`sc-status ${isTransferred ? "is-transferred" : ""}`}
          >
            {isTransferred ? "Sent to Production" : "Draft"}
          </span>
        </div>
      </header>

      <section className="sc-print-sheet">
        <div className="sc-print-topline">
          <div className="sc-print-brand">
            MATRIX <span>KITCHEN OPERATIONS</span>
          </div>
          <div className="sc-print-doc-code">
            DAILY SHEET · PREP / PRODUCTION
          </div>
        </div>
        <div className="sc-print-heading">
          <h1>DAILY PREPARATION &amp; PRODUCTION RECORD</h1>
          <div className="sc-print-meta">
            <div>
              <b>DATE</b>
              <span>{formatDate(dateKey)}</span>
            </div>
            <div>
              <b>SHIFT</b>
              <span></span>
            </div>
            <div>
              <b>PREPARED BY</b>
              <span></span>
            </div>
            <div>
              <b>SUPERVISOR</b>
              <span></span>
            </div>
          </div>
          <p className="sc-print-instructions">
            Write actual quantities after preparation. Record any waste,
            shortage, quality issue, or follow-up in the last column.
          </p>
        </div>
        <table className="sc-print-table">
          <thead>
            <tr>
              <th className="sc-print-check-col">Done</th>
              <th className="sc-print-item-col">Item / recipe</th>
              <th className="sc-print-target-col">Planned target</th>
              <th className="sc-print-actual-col">Actual made</th>
              <th className="sc-print-waste-col">Waste / shortage</th>
              <th className="sc-print-notes-col">Quality check / notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td className="sc-print-checkbox">
                  <span></span>
                </td>
                <td>
                  <small>{String(index + 1).padStart(2, "0")}</small>{" "}
                  <strong>{item.name}</strong>
                </td>
                <td className="sc-print-target-value">
                  {item.targetQuantity || "—"} {item.targetUnit || ""}
                </td>
                <td>
                  <span className="sc-print-blank">
                    {item.actualQuantity !== ""
                      ? `${item.actualQuantity} ${item.actualUnit || ""}`
                      : ""}
                  </span>
                </td>
                <td>
                  <span className="sc-print-blank">
                    {item.wasteQuantity !== ""
                      ? `${item.wasteQuantity} ${item.wasteUnit || ""}`
                      : ""}
                  </span>
                </td>
                <td>
                  <span className="sc-print-blank">
                    {item.productionNotes || ""}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr className="sc-print-empty-row">
                <td colSpan="6">No items added to this preparation plan.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="sc-print-bottom-grid">
          <div className="sc-print-notes">
            <strong>End-of-day notes / items to carry forward</strong>
            <div></div>
            <div></div>
          </div>
          <div className="sc-print-signoff">
            <div>
              <b>Prepared by</b>
              <span></span>
            </div>
            <div>
              <b>Checked by</b>
              <span></span>
            </div>
            <div>
              <b>Time completed</b>
              <span></span>
            </div>
          </div>
        </div>
        <div className="sc-print-footer">
          <span>Matrix · Daily preparation record</span>
          <span>
            Complete all quantities and flag any variance before signing off.
          </span>
        </div>
      </section>

      {error && (
        <div className="sc-alert sc-alert-error sc-no-print">
          <FiX />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="sc-alert sc-alert-success sc-no-print">
          <FiCheckCircle />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}

      <section className="sc-stats sc-no-print">
        <article className="sc-stat">
          <span className="sc-stat-icon">
            <FiPackage />
          </span>
          <div>
            <span>Planned items</span>
            <strong>{items.length}</strong>
          </div>
        </article>
        <article className="sc-stat">
          <span className="sc-stat-icon">
            <FiCheckCircle />
          </span>
          <div>
            <span>Checked off</span>
            <strong>{completedCount}</strong>
          </div>
        </article>
        <article className="sc-stat">
          <span className="sc-stat-icon">
            <FiClock />
          </span>
          <div>
            <span>Actuals entered</span>
            <strong>{resultCount}</strong>
          </div>
        </article>
      </section>

      <div className="sc-layout sc-no-print">
        <section className="sc-panel sc-selected-panel">
          <div className="sc-panel-header">
            <div>
              <h2>Preparation checklist</h2>
              <p>{formatDate(dateKey)}</p>
            </div>
            <span className="sc-count">{items.length} items</span>
          </div>

          {items.length === 0 ? (
            <div className="sc-empty">
              <FiPackage />
              <h3>No preparation items yet</h3>
              <p>
                Choose recipes from the library to start this day's checklist.
              </p>
            </div>
          ) : (
            <div className="sc-items">
              {items.map((item) => (
                <article className="sc-item" key={item.id}>
                  <div className="sc-item-heading">
                    <label className="sc-check">
                      <input
                        type="checkbox"
                        checked={Boolean(item.completed)}
                        disabled={isTransferred}
                        onChange={(event) =>
                          updateItem(item.id, {
                            completed: event.target.checked,
                          })
                        }
                      />
                      <span className="sc-custom-check">
                        <FiCheck />
                      </span>
                    </label>
                    <div className="sc-item-title">
                      <h3 className={item.completed ? "is-complete" : ""}>
                        {item.name}
                      </h3>
                      <span>
                        {item.recipeType === "product"
                          ? "Product recipe"
                          : "Preparation recipe"}
                      </span>
                    </div>
                    {!isTransferred && (
                      <button
                        className="sc-icon-btn danger"
                        type="button"
                        title="Remove item"
                        onClick={() => removeItem(item.id)}
                      >
                        <FiTrash2 />
                      </button>
                    )}
                  </div>
                  <div className="sc-target-fields">
                    <label className="sc-field">
                      <span>Target type</span>
                      <select
                        value={item.targetType}
                        disabled={isTransferred}
                        onChange={(event) => {
                          const type = event.target.value;
                          updateItem(item.id, {
                            targetType: type,
                            targetUnit:
                              type === "portions"
                                ? "portions"
                                : WEIGHT_UNITS.includes(item.targetUnit)
                                  ? item.targetUnit
                                  : "g",
                            actualUnit:
                              type === "portions"
                                ? "portions"
                                : WEIGHT_UNITS.includes(item.actualUnit)
                                  ? item.actualUnit
                                  : "g",
                            wasteUnit:
                              type === "portions"
                                ? "portions"
                                : WEIGHT_UNITS.includes(item.wasteUnit)
                                  ? item.wasteUnit
                                  : "g",
                          });
                        }}
                      >
                        <option value="weight">Weight / volume</option>
                        <option value="portions">Portions</option>
                      </select>
                    </label>
                    <label className="sc-field">
                      <span>Target quantity</span>
                      <input
                        type="number"
                        min="0.001"
                        step={item.targetType === "portions" ? "1" : "any"}
                        value={item.targetQuantity}
                        placeholder={
                          item.targetType === "portions"
                            ? "e.g. 30"
                            : "e.g. 2000"
                        }
                        disabled={isTransferred}
                        onChange={(event) =>
                          updateItem(item.id, {
                            targetQuantity: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="sc-field">
                      <span>Unit</span>
                      <select
                        value={item.targetUnit}
                        disabled={
                          isTransferred || item.targetType === "portions"
                        }
                        onChange={(event) =>
                          updateItem(item.id, {
                            targetUnit: event.target.value,
                          })
                        }
                      >
                        {WEIGHT_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                      {item.targetType === "portions" && (
                        <small>Portions</small>
                      )}
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="sc-panel-footer">
            <span className="sc-save-status">
              {saving
                ? "Saving..."
                : lastSaved
                  ? "Saved plan loaded"
                  : "Not saved yet"}
            </span>
            <div className="sc-footer-actions">
              <button
                className="sc-btn sc-btn-secondary"
                type="button"
                onClick={() => {
                  setItems((plan?.items || []).map(normalizePreparationItem));
                  setError("");
                  setNotice("Unsaved changes discarded.");
                }}
                disabled={saving || isTransferred}
              >
                <FiRefreshCw /> Revert
              </button>
              <button
                className="sc-btn sc-btn-primary"
                type="button"
                onClick={savePlan}
                disabled={saving || isTransferred}
              >
                <FiCheck /> {saving ? "Saving..." : "Save checklist"}
              </button>
            </div>
          </div>

          <div className="sc-print-actions">
            <div>
              <h3>Print and finish today's preparation</h3>
              <p>
                Print the target quantities to write on during the shift. Enter
                actual quantities below later.
              </p>
            </div>
            <button
              className="sc-btn sc-btn-secondary"
              type="button"
              onClick={printProductionSheet}
              disabled={items.length === 0}
            >
              <FiPrinter /> Print Production Sheet
            </button>
          </div>

          <div className="sc-transfer">
            <div>
              <h3>Ready for production?</h3>
              <p>
                Marks the plan as ready. It does not record actual output or
                deduct stock.
              </p>
            </div>
            <button
              className="sc-btn sc-btn-primary"
              type="button"
              onClick={sendToProduction}
              disabled={saving || isTransferred || items.length === 0}
            >
              <FiCopy />{" "}
              {isTransferred ? "Already transferred" : "Copy to Production"}
            </button>
          </div>
        </section>

        <aside className="sc-panel sc-library-panel">
          <div className="sc-panel-header">
            <div>
              <h2>Recipe library</h2>
              <p>Add recipes to this day's preparation.</p>
            </div>
          </div>
          <label className="sc-search">
            <FiSearch />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipes..."
            />
          </label>
          <label className="sc-archive-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{" "}
            Include archived recipes
          </label>
          {loading ? (
            <div className="sc-empty">Loading recipes...</div>
          ) : availableRecipes.length === 0 ? (
            <div className="sc-empty">
              <h3>No recipes found</h3>
              <p>Try another search or create a recipe first.</p>
            </div>
          ) : (
            <div className="sc-library-list">
              {availableRecipes.map((recipe) => {
                const alreadyAdded = selectedRecipeIds.has(recipe.id);
                return (
                  <article className="sc-library-recipe" key={recipe.id}>
                    <div>
                      <h3>{recipe.title || "Untitled recipe"}</h3>
                      <p>
                        Yield:{" "}
                        {formatQuantity(
                          recipe.yieldAmount ?? recipe.servings ?? 1,
                        )}{" "}
                        {recipe.yieldUnit || "pieces"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="sc-add-btn"
                      disabled={alreadyAdded || isTransferred}
                      onClick={() => addRecipe(recipe)}
                      title={
                        alreadyAdded ? "Already added" : "Add to preparation"
                      }
                    >
                      {alreadyAdded ? <FiCheck /> : <FiPlus />}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      <section className="sc-panel sc-results-panel sc-no-print">
        <div className="sc-panel-header">
          <div>
            <h2>Enter actual production</h2>
            <p>
              Fill this in from your paper at the end of the day. Saving results
              does not deduct ingredients.
            </p>
          </div>
          <span className="sc-count">
            {resultCount} / {items.length} actuals entered
          </span>
        </div>
        {items.length === 0 ? (
          <div className="sc-empty">
            <h3>No planned items</h3>
            <p>Select a saved preparation date to enter its results.</p>
          </div>
        ) : (
          <>
            <div className="sc-results-list">
              {items.map((rawItem) => {
                const item = normalizePreparationItem(rawItem);
                const units =
                  item.targetType === "portions" ? ["portions"] : WEIGHT_UNITS;
                return (
                  <article className="sc-result-item" key={item.id}>
                    <div className="sc-result-name">
                      <strong>{item.name}</strong>
                      <small>
                        Target: {item.targetQuantity || "—"}{" "}
                        {item.targetUnit || ""}
                      </small>
                    </div>
                    <div className="sc-result-fields">
                      <label className="sc-field">
                        <span>Actual quantity made</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.actualQuantity}
                          placeholder="Enter actual"
                          onChange={(event) =>
                            updateProductionResult(item.id, {
                              actualQuantity: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="sc-field">
                        <span>Actual unit</span>
                        <select
                          value={item.actualUnit}
                          onChange={(event) =>
                            updateProductionResult(item.id, {
                              actualUnit: event.target.value,
                            })
                          }
                        >
                          {units.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="sc-field">
                        <span>Waste / shortage</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.wasteQuantity}
                          placeholder="Optional"
                          onChange={(event) =>
                            updateProductionResult(item.id, {
                              wasteQuantity: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="sc-field">
                        <span>Waste unit</span>
                        <select
                          value={item.wasteUnit}
                          onChange={(event) =>
                            updateProductionResult(item.id, {
                              wasteUnit: event.target.value,
                            })
                          }
                        >
                          {units.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="sc-field sc-result-notes">
                        <span>Notes</span>
                        <input
                          value={item.productionNotes}
                          onChange={(event) =>
                            updateProductionResult(item.id, {
                              productionNotes: event.target.value,
                            })
                          }
                          placeholder="e.g. short by 200 g, batch overcooked"
                        />
                      </label>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="sc-panel-footer">
              <span className="sc-save-status">
                Results are stored with the selected day's plan.
              </span>
              <button
                className="sc-btn sc-btn-primary"
                type="button"
                onClick={saveActualResults}
                disabled={savingResults || saving}
              >
                <FiSave />{" "}
                {savingResults ? "Saving results..." : "Save Daily Results"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="sc-panel sc-history-panel sc-no-print">
        <div className="sc-panel-header">
          <div>
            <h2>Preparation history</h2>
            <p>
              Open a previous day's checklist and results without deleting its
              record.
            </p>
          </div>
        </div>
        {plans.length === 0 ? (
          <div className="sc-empty">
            <FiCalendar />
            <h3>No saved plans yet</h3>
            <p>Your saved daily checklists will appear here.</p>
          </div>
        ) : (
          <div className="sc-history-list">
            {plans.map((entry) => {
              const savedItems = (entry.items || []).map(
                normalizePreparationItem,
              );
              const actuals = savedItems.filter(
                (item) => String(item.actualQuantity ?? "").trim() !== "",
              ).length;
              return (
                <button
                  type="button"
                  key={entry.id}
                  className={`sc-history-row ${entry.dateKey === dateKey ? "is-current" : ""}`}
                  onClick={() => setDateKey(entry.dateKey)}
                >
                  <span className="sc-history-icon">
                    <FiCalendar />
                  </span>
                  <span className="sc-history-main">
                    <strong>{formatDate(entry.dateKey)}</strong>
                    <small>
                      {savedItems.length} planned items · {actuals} actuals
                      entered
                    </small>
                  </span>
                  <span
                    className={`sc-status ${entry.status === "ready_for_production" || entry.status === "transferred" ? "is-transferred" : ""}`}
                  >
                    {entry.status === "ready_for_production" ||
                    entry.status === "transferred"
                      ? "Transferred"
                      : "Draft"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
