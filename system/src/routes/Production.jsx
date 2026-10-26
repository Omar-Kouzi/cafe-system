import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import SecureLS from "secure-ls";
import {
  FiActivity,
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiPackage,
  FiPlay,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiZap,
  FiPrinter,
} from "react-icons/fi";
import { db } from "../assets/firebase/config";
import "../styles/Production.css";

const RECIPES = "recipes";
const ITEMS = "inventoryItems";
const MOVEMENTS = "inventoryMovements";
const BATCHES = "productionBatches";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num(v));

const qty = (v) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(num(v));

const dateText = (v) => {
  if (!v) return "—";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

function normalizeUnit(unit) {
  const raw = String(unit || "").trim();
  const key = raw.toLowerCase().replace(/\s+/g, "");

  const aliases = {
    g: "g",
    kg: "kg",
    ml: "ml",
    l: "L",
    gram: "g",
    grams: "g",
    gr: "g",
    kilogram: "kg",
    kilograms: "kg",
    kilo: "kg",
    kilos: "kg",
    milliliter: "ml",
    milliliters: "ml",
    millilitre: "ml",
    millilitres: "ml",
    liter: "L",
    liters: "L",
    litre: "L",
    litres: "L",
    piece: "pieces",
    unit: "pieces",
    units: "pieces",
    pc: "pieces",
    pcs: "pieces",
    pack: "packs",
    box: "boxes",
    bag: "bags",
    bottle: "bottles",
    roll: "rolls",
    can: "cans",
    jar: "jars",
    carton: "cartons",
  };

  return aliases[key] || raw;
}

function convert(amount, from, to, item = null) {
  const value = num(amount);
  const source = normalizeUnit(from);
  const target = normalizeUnit(to);

  if (source === target) return value;

  const weight = { g: 1, kg: 1000 };
  const volume = { ml: 1, L: 1000 };

  if (weight[source] && weight[target]) {
    return (value * weight[source]) / weight[target];
  }

  if (volume[source] && volume[target]) {
    return (value * volume[source]) / volume[target];
  }

  if (item) {
    const stockUnit = normalizeUnit(item.unit || "");
    const packageUnit = normalizeUnit(item.packageContentsUnit || "");
    const packageAmount = num(item.packageContentsAmount);

    if (packageAmount > 0 && packageUnit) {
      if (target === stockUnit && source === packageUnit) {
        return value / packageAmount;
      }
      if (source === stockUnit && target === packageUnit) {
        return value * packageAmount;
      }
    }
  }

  throw new Error(
    `Cannot convert ${from || "unknown unit"} to ${to || "unknown unit"}. Check the item's stock unit and package contents.`,
  );
}

/**
 * Calculate all stock requirements for a recipe.
 *
 * Inventory ingredient:
 *   Deducts the linked inventory item.
 *
 * Recipe ingredient:
 *   If the component recipe has a valid outputItemId, consume that stored
 *   stock. Otherwise, expand the component recipe into its raw ingredients.
 *
 * Every missing link or conversion problem blocks production.
 */
function calculateProductionNeeds(recipe, multiplier, recipes, itemMap) {
  const recipeMap = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const requirements = new Map();
  const details = [];
  const problems = [];

  function addItem(item, amount, unit, name, path) {
    const stockUnit = item.unit || "pieces";
    const stockAmount = convert(amount, unit || stockUnit, stockUnit, item);

    const current = requirements.get(item.id) || {
      id: item.id,
      name: item.name || name || "Ingredient",
      needed: 0,
      available: num(item.quantity),
      unit: stockUnit,
      unitCost: num(item.unitCost),
    };

    current.needed += stockAmount;
    requirements.set(item.id, current);

    details.push({
      itemId: item.id,
      name: item.name || name || "Ingredient",
      amount: num(amount),
      unit: unit || stockUnit,
      stockAmount,
      stockUnit,
      unitCostAtProduction: num(item.unitCost),
      lineCost: stockAmount * num(item.unitCost),
      sourceRecipePath: path,
    });
  }

  function walk(currentRecipe, factor, path = []) {
    if (!currentRecipe) {
      problems.push("A component recipe could not be found.");
      return;
    }

    if (path.includes(currentRecipe.id)) {
      problems.push(
        `Circular recipe dependency detected at "${currentRecipe.title || currentRecipe.id}".`,
      );
      return;
    }

    const nextPath = [...path, currentRecipe.id];
    const ingredients = Array.isArray(currentRecipe.ingredients)
      ? currentRecipe.ingredients
      : [];

    if (!ingredients.length) {
      problems.push(
        `Recipe "${currentRecipe.title || "Untitled"}" has no ingredients.`,
      );
      return;
    }

    for (const ingredient of ingredients) {
      const amount = num(ingredient.amount ?? ingredient.quantity) * factor;

      if (amount <= 0) {
        problems.push(
          `${ingredient.name || "An ingredient"} in "${currentRecipe.title || "a recipe"}" has an invalid quantity.`,
        );
        continue;
      }

      const isRecipe =
        ingredient.ingredientType === "recipe" || Boolean(ingredient.recipeId);

      if (isRecipe) {
        const component = recipeMap[ingredient.recipeId];

        if (!component) {
          problems.push(
            `${ingredient.name || "A component recipe"} in "${currentRecipe.title}" is not linked to an existing recipe.`,
          );
          continue;
        }

        if (component.archived) {
          problems.push(`Component recipe "${component.title}" is archived.`);
          continue;
        }

        const componentYield = num(
          component.yieldAmount ?? component.servings ?? 1,
        );

        if (componentYield <= 0) {
          problems.push(`"${component.title}" has an invalid recipe yield.`);
          continue;
        }

        const storedComponent = component.outputItemId
          ? itemMap[component.outputItemId]
          : null;

        // Stored prepared component: consume its current inventory stock.
        if (storedComponent) {
          try {
            addItem(
              storedComponent,
              amount,
              ingredient.unit || component.yieldUnit || "pieces",
              component.title,
              nextPath,
            );
          } catch (e) {
            problems.push(`${component.title}: ${e.message}`);
          }
          continue;
        }

        // No linked prepared stock: calculate the required raw ingredients.
        try {
          const componentAmount = convert(
            amount,
            ingredient.unit || component.yieldUnit || "pieces",
            component.yieldUnit || "pieces",
          );

          walk(component, componentAmount / componentYield, nextPath);
        } catch (e) {
          problems.push(`${component.title}: ${e.message}`);
        }

        continue;
      }

      const item = itemMap[ingredient.itemId];

      if (!item) {
        problems.push(
          `${ingredient.name || "An ingredient"} in "${currentRecipe.title || "a recipe"}" is not linked to an existing inventory item.`,
        );
        continue;
      }

      try {
        addItem(
          item,
          amount,
          ingredient.unit || item.unit || "pieces",
          ingredient.name,
          nextPath,
        );
      } catch (e) {
        problems.push(
          `${item.name || ingredient.name || "Ingredient"}: ${e.message}`,
        );
      }
    }
  }

  walk(recipe, multiplier);

  const requirementList = [...requirements.values()];

  for (const requirement of requirementList) {
    if (requirement.available < requirement.needed) {
      problems.push(
        `${requirement.name}: need ${qty(requirement.needed)} ${requirement.unit}, have ${qty(requirement.available)} ${requirement.unit}.`,
      );
    }
  }

  const cost = requirementList.reduce(
    (sum, requirement) => sum + requirement.needed * requirement.unitCost,
    0,
  );

  return {
    requirements: requirementList,
    details,
    problems: [...new Set(problems)],
    cost,
  };
}

export default function Production() {
  const ls = useMemo(() => new SecureLS({ encodingType: "aes" }), []);
  const uid = ls.get("uid");

  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [batchCount, setBatchCount] = useState("1");
  const [actualOutput, setActualOutput] = useState("");
  const [actualPortions, setActualPortions] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let loaded = 0;

    const markLoaded = () => {
      loaded += 1;
      if (loaded >= 3) setLoading(false);
    };

    const unsubscribers = [
      onSnapshot(
        collection(db, RECIPES),
        (snapshot) => {
          setRecipes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          markLoaded();
        },
        (err) => {
          console.error(err);
          setError("Could not load recipes. Check Firestore rules.");
          markLoaded();
        },
      ),
      onSnapshot(
        collection(db, ITEMS),
        (snapshot) => {
          setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          markLoaded();
        },
        (err) => {
          console.error(err);
          setError("Could not load inventory. Check Firestore rules.");
          markLoaded();
        },
      ),
      onSnapshot(
        collection(db, BATCHES),
        (snapshot) => {
          setBatches(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          markLoaded();
        },
        (err) => {
          console.error(err);
          setError("Could not load production history. Check Firestore rules.");
          markLoaded();
        },
      ),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const activeRecipes = useMemo(
    () =>
      recipes
        .filter((r) => !r.archived)
        .sort((a, b) =>
          String(a.title || "").localeCompare(String(b.title || "")),
        ),
    [recipes],
  );

  const selectedRecipe = activeRecipes.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    setActualOutput("");
    setActualPortions("");
  }, [selectedId, batchCount]);

  const itemMap = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );

  const preview = useMemo(() => {
    if (!selectedRecipe) {
      return {
        cost: 0,
        output: 0,
        requirements: [],
        problems: ["Choose a recipe to see the production requirements."],
      };
    }

    const count = num(batchCount);
    const problems = [];

    if (!Number.isInteger(count) || count < 1) {
      problems.push("Enter a whole number of batches greater than zero.");
    }

    const result = calculateProductionNeeds(
      selectedRecipe,
      Math.max(0, count),
      recipes,
      itemMap,
    );

    return {
      cost: result.cost,
      output:
        num(selectedRecipe.yieldAmount ?? selectedRecipe.servings ?? 1) *
        Math.max(0, count),
      requirements: result.requirements,
      problems: [...new Set([...problems, ...result.problems])],
    };
  }, [selectedRecipe, batchCount, recipes, itemMap]);

  async function startProduction(event) {
    event.preventDefault();
    if (!selectedRecipe || busy) return;

    const count = num(batchCount);
    const actualAmount = Number(actualOutput);
    const portions = Number(actualPortions);

    if (!Number.isInteger(count) || count < 1) {
      setError("Enter a whole number of batches greater than zero.");
      return;
    }

    if (
      actualOutput.trim() === "" ||
      !Number.isFinite(actualAmount) ||
      actualAmount < 0
    ) {
      setError(
        "Enter the actual total output. Use 0 if the entire batch was lost.",
      );
      return;
    }

    if (
      actualPortions.trim() === "" ||
      !Number.isInteger(portions) ||
      portions < 0
    ) {
      setError(
        "Enter the actual number of portions as a whole number (0 or more).",
      );
      return;
    }

    if ((actualAmount === 0) !== (portions === 0)) {
      setError(
        "If no output was recovered, enter 0 portions too. If you recovered output, enter at least 1 portion.",
      );
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const recipeRef = doc(db, RECIPES, selectedRecipe.id);
      const batchRef = doc(collection(db, BATCHES));
      const newOutputRef = doc(collection(db, ITEMS));

      const result = await runTransaction(db, async (tx) => {
        // Read recipe, recipe components and inventory before making writes.
        const recipeSnap = await tx.get(recipeRef);

        if (!recipeSnap.exists()) {
          throw new Error("This recipe no longer exists.");
        }

        const recipe = { id: recipeSnap.id, ...recipeSnap.data() };

        if (recipe.archived) {
          throw new Error("This recipe is archived.");
        }

        // Use the recipes and inventory already loaded by the page.
        // Individual inventory documents are read and validated below
        // inside the transaction before any writes are made.
        const latestRecipes = recipes;
        const latestItems = items;

        const latestItemMap = Object.fromEntries(
          latestItems.map((item) => [item.id, item]),
        );

        const calculation = calculateProductionNeeds(
          recipe,
          count,
          latestRecipes,
          latestItemMap,
        );

        if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
          throw new Error("This recipe has no ingredients.");
        }

        if (calculation.problems.length) {
          throw new Error(calculation.problems.join("\n"));
        }

        const needed = new Map(calculation.requirements.map((r) => [r.id, r]));

        if (recipe.outputItemId && needed.has(recipe.outputItemId)) {
          throw new Error(
            "The finished product cannot also be one of its own ingredients.",
          );
        }

        const itemRefs = new Map();
        const itemSnaps = new Map();

        for (const id of needed.keys()) {
          const ref = doc(db, ITEMS, id);
          const snap = await tx.get(ref);

          if (!snap.exists()) {
            throw new Error(
              `Ingredient inventory record (${id}) no longer exists.`,
            );
          }

          itemRefs.set(id, ref);
          itemSnaps.set(id, snap);
        }

        let outputRef = newOutputRef;
        let outputSnap = null;

        if (recipe.outputItemId) {
          const linkedRef = doc(db, ITEMS, recipe.outputItemId);
          const linkedSnap = await tx.get(linkedRef);

          if (linkedSnap.exists()) {
            outputRef = linkedRef;
            outputSnap = linkedSnap;
          }
        }

        if (needed.has(outputRef.id)) {
          throw new Error(
            "The finished product cannot also be consumed as an ingredient.",
          );
        }

        let totalCost = 0;

        for (const [id, requirement] of needed) {
          const data = itemSnaps.get(id).data();

          if (num(data.quantity) < requirement.needed) {
            throw new Error(
              `Not enough ${data.name || requirement.name}: need ${qty(requirement.needed)} ${requirement.unit}, have ${qty(data.quantity)} ${data.unit || requirement.unit}.`,
            );
          }

          totalCost += requirement.needed * num(data.unitCost);
        }

        const expectedAmount =
          num(recipe.yieldAmount ?? recipe.servings ?? 1) * count;
        const recipeUnit = recipe.yieldUnit || "pieces";
        const outputUnit = outputSnap?.data().unit || recipeUnit;

        const expectedOutputQuantity = convert(
          expectedAmount,
          recipeUnit,
          outputUnit,
        );

        const outputQuantity = convert(actualAmount, recipeUnit, outputUnit);
        const actualPortionSize = portions > 0 ? actualAmount / portions : 0;
        const outputName =
          outputSnap?.data().name || recipe.title || "Finished product";

        // Inventory deductions.
        for (const [id, requirement] of needed) {
          const ref = itemRefs.get(id);
          const snap = itemSnaps.get(id);
          const data = snap.data();
          const before = num(data.quantity);
          const after = before - requirement.needed;

          tx.update(ref, {
            quantity: after,
            updatedAt: serverTimestamp(),
          });

          tx.set(doc(collection(db, MOVEMENTS)), {
            itemId: id,
            itemName: data.name || requirement.name,
            type: "used",
            quantityChange: -requirement.needed,
            unit: data.unit || requirement.unit,
            quantityBefore: before,
            quantityAfter: after,
            note: `Production: ${recipe.title}${note.trim() ? ` — ${note.trim()}` : ""}`,
            recipeId: recipeSnap.id,
            recipeName: recipe.title || "",
            productionBatchId: batchRef.id,
            createdAt: serverTimestamp(),
          });
        }

        // Finished stock additions.
        if (outputSnap) {
          const data = outputSnap.data();
          const before = num(data.quantity);
          const after = before + outputQuantity;
          const nextUnitCost =
            after > 0 ? (before * num(data.unitCost) + totalCost) / after : 0;

          tx.update(outputRef, {
            quantity: after,
            unitCost: nextUnitCost,
            updatedAt: serverTimestamp(),
          });

          tx.set(doc(collection(db, MOVEMENTS)), {
            itemId: outputRef.id,
            itemName: outputName,
            type: "received",
            quantityChange: outputQuantity,
            unit: outputUnit,
            quantityBefore: before,
            quantityAfter: after,
            note: `Produced from recipe: ${recipe.title}`,
            recipeId: recipeSnap.id,
            recipeName: recipe.title || "",
            productionBatchId: batchRef.id,
            createdAt: serverTimestamp(),
          });
        } else {
          tx.set(outputRef, {
            name: outputName,
            category: "Finished products",
            quantity: outputQuantity,
            unit: outputUnit,
            minStock: 0,
            unitCost: outputQuantity > 0 ? totalCost / outputQuantity : 0,
            supplier: "",
            expiryDate: "",
            notes: `Created automatically from recipe "${recipe.title}".`,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          tx.set(doc(collection(db, MOVEMENTS)), {
            itemId: outputRef.id,
            itemName: outputName,
            type: "received",
            quantityChange: outputQuantity,
            unit: outputUnit,
            quantityBefore: 0,
            quantityAfter: outputQuantity,
            note: `Initial finished stock from recipe: ${recipe.title}`,
            recipeId: recipeSnap.id,
            recipeName: recipe.title || "",
            productionBatchId: batchRef.id,
            createdAt: serverTimestamp(),
          });
        }

        tx.set(batchRef, {
          recipeId: recipeSnap.id,
          recipeName: recipe.title || "",
          recipeType: recipe.recipeType || "food",
          batchCount: count,
          ingredientCost: totalCost,
          outputItemId: outputRef.id,
          outputItemName: outputName,
          expectedOutputQuantity,
          actualOutputQuantity: outputQuantity,
          outputQuantity,
          outputUnit,
          actualPortions: portions,
          actualPortionSize,
          actualPortionUnit: recipeUnit,
          ingredients: calculation.details.map((line) => ({
            ...line,
            unitCostAtProduction: num(
              itemSnaps.get(line.itemId)?.data()?.unitCost,
            ),
          })),
          note: note.trim(),
          producedBy: uid || "",
          producedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });

        tx.update(recipeRef, {
          lastProducedAt: serverTimestamp(),
          lastBatchCost: totalCost,
          lastBatchCount: count,
          outputItemId: outputRef.id,
          updatedAt: serverTimestamp(),
        });

        return {
          outputName,
          outputQuantity,
          outputUnit,
          totalCost,
          portions,
        };
      });

      setNotice(
        `Production completed: ${qty(result.outputQuantity)} ${result.outputUnit} of ${result.outputName}; ${qty(result.portions)} portions recorded. Actual ingredient cost: ${money(result.totalCost)}.`,
      );

      setBatchCount("1");
      setActualOutput("");
      setActualPortions("");
      setNote("");
    } catch (e) {
      console.error("Production failed:", e);
      setError(e.message || "Production failed. Check Firestore permissions.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBatch(batch) {
    const passcode = window.prompt(
      `Enter the passcode to delete the production history record for “${batch.recipeName || "Recipe"}”.`,
    );

    if (passcode === null) return;

    if (passcode !== "1234") {
      setError("Incorrect passcode.");
      return;
    }

    if (
      !window.confirm(
        "Delete this history record only? Inventory quantities and movement records will NOT be changed.",
      )
    )
      return;

    setDeletingId(batch.id);
    setError("");
    setNotice("");

    try {
      await deleteDoc(doc(db, BATCHES, batch.id));
      setNotice(
        "Production history record deleted. Inventory was not changed.",
      );
    } catch (e) {
      console.error(e);
      setError(
        e.message ||
          "Could not delete production history. Check Firestore rules.",
      );
    } finally {
      setDeletingId("");
    }
  }

  const visibleBatches = useMemo(
    () =>
      batches
        .filter((b) =>
          `${b.recipeName || ""} ${b.note || ""} ${b.outputItemName || ""}`
            .toLowerCase()
            .includes(search.toLowerCase().trim()),
        )
        .sort((a, b) => {
          const time = (v) =>
            v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0;
          return (
            time(b.producedAt || b.createdAt) -
            time(a.producedAt || a.createdAt)
          );
        }),
    [batches, search],
  );

  const totalOutput = batches.reduce(
    (sum, b) => sum + num(b.actualOutputQuantity ?? b.outputQuantity),
    0,
  );
  const totalCost = batches.reduce((sum, b) => sum + num(b.ingredientCost), 0);

  const dayBatches = useMemo(
    () =>
      batches
        .filter((b) => {
          const raw = b.producedAt || b.createdAt;
          const d = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
          if (!d || Number.isNaN(d.getTime())) return false;

          const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return localDate === reportDate;
        })
        .sort((a, b) => {
          const time = (v) =>
            v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0;
          return (
            time(a.producedAt || a.createdAt) -
            time(b.producedAt || b.createdAt)
          );
        }),
    [batches, reportDate],
  );

  const dayOutputByUnit = dayBatches.reduce((totals, b) => {
    const unit = b.outputUnit || "units";
    totals[unit] =
      (totals[unit] || 0) + num(b.actualOutputQuantity ?? b.outputQuantity);
    return totals;
  }, {});

  const dayOutputLabel =
    Object.entries(dayOutputByUnit)
      .map(([unit, amount]) => `${qty(amount)} ${unit}`)
      .join(" + ") || "0";

  const dayPortions = dayBatches.reduce(
    (sum, b) => sum + num(b.actualPortions),
    0,
  );
  const dayCost = dayBatches.reduce((sum, b) => sum + num(b.ingredientCost), 0);

  const reportDateLabel = reportDate
    ? new Date(`${reportDate}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Selected date";

  return (
    <main className="production-page">
      <header className="production-header">
        <div>
          <div className="production-eyebrow">
            <FiActivity /> OPERATIONS / PRODUCTION
          </div>
          <h1>Production</h1>
          <p>
            Turn recipes into finished stock while tracking ingredient usage and
            production costs.
          </p>
        </div>
        <button
          className="production-btn production-btn-light"
          type="button"
          onClick={() => {
            setError("");
            setNotice("");
          }}
        >
          <FiRefreshCw /> Clear messages
        </button>
      </header>

      {error && (
        <div className="production-alert production-alert-error">
          <FiAlertCircle />
          <span style={{ whiteSpace: "pre-line" }}>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="production-alert production-alert-success">
          <FiCheckCircle />
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}

      <section className="production-stats">
        <article className="production-stat">
          <span className="production-stat-icon">
            <FiZap />
          </span>
          <div>
            <small>Production batches</small>
            <strong>{batches.length}</strong>
          </div>
        </article>
        <article className="production-stat">
          <span className="production-stat-icon purple">
            <FiPackage />
          </span>
          <div>
            <small>Total output recorded</small>
            <strong>{qty(totalOutput)}</strong>
          </div>
        </article>
        <article className="production-stat">
          <span className="production-stat-icon green">
            <FiActivity />
          </span>
          <div>
            <small>Recorded ingredient cost</small>
            <strong>{money(totalCost)}</strong>
          </div>
        </article>
        <article className="production-stat">
          <span className="production-stat-icon amber">
            <FiClock />
          </span>
          <div>
            <small>Available recipes</small>
            <strong>{activeRecipes.length}</strong>
          </div>
        </article>
      </section>

      <section className="production-panel">
        <div className="production-panel-head">
          <div>
            <h2>Start production</h2>
            <p>
              Select a saved recipe and review stock requirements before
              confirming.
            </p>
          </div>
          <span className="production-live">
            <i /> Inventory connected
          </span>
        </div>

        {loading ? (
          <div className="production-empty">
            Loading recipes, inventory, and production history…
          </div>
        ) : (
          <form onSubmit={startProduction} className="production-form">
            <label className="production-field">
              <span>Recipe</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                required
              >
                <option value="">Choose a recipe…</option>
                {activeRecipes.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.title || "Untitled recipe"}{" "}
                    {r.recipeType === "product"
                      ? "— Product for sale"
                      : "— Food preparation"}
                  </option>
                ))}
              </select>
            </label>

            <div className="production-form-row">
              <label className="production-field">
                <span>Number of batches</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  required
                />
              </label>
              <label className="production-field">
                <span>Production note (optional)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Morning batch, order number"
                />
              </label>
            </div>

            {selectedRecipe && (
              <>
                <div className="production-recipe-summary">
                  <div>
                    <small>Expected output</small>
                    <strong>
                      {qty(preview.output)}{" "}
                      {selectedRecipe.yieldUnit || "pieces"}
                    </strong>
                  </div>
                  <div>
                    <small>Estimated ingredient cost</small>
                    <strong>{money(preview.cost)}</strong>
                  </div>
                  <div>
                    <small>Expected cost per output unit</small>
                    <strong>
                      {preview.output > 0
                        ? money(preview.cost / preview.output)
                        : money(0)}
                    </strong>
                  </div>
                </div>

                <div className="production-actual-output">
                  <h3>Record actual results</h3>
                  <p>
                    Enter what you really recovered after spills, blender
                    residue, or other production loss. Inventory will increase
                    by the actual total output.
                  </p>
                  <div className="production-form-row">
                    <label className="production-field">
                      <span>
                        Actual total output (
                        {selectedRecipe.yieldUnit || "pieces"})
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={actualOutput}
                        onChange={(e) => setActualOutput(e.target.value)}
                        placeholder={`Expected: ${qty(preview.output)}`}
                        required
                      />
                    </label>
                    <label className="production-field">
                      <span>Actual number of portions</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={actualPortions}
                        onChange={(e) => setActualPortions(e.target.value)}
                        placeholder="e.g. 17"
                        required
                      />
                    </label>
                  </div>

                  {actualOutput !== "" &&
                    actualPortions !== "" &&
                    num(actualPortions) > 0 && (
                      <div className="production-actual-hint">
                        Average actual portion size:{" "}
                        <strong>
                          {qty(num(actualOutput) / num(actualPortions))}{" "}
                          {selectedRecipe.yieldUnit || "pieces"}
                        </strong>
                        {num(actualOutput) < preview.output && (
                          <span>
                            {" "}
                            · Output loss:{" "}
                            {qty(preview.output - num(actualOutput))}{" "}
                            {selectedRecipe.yieldUnit || "pieces"} (
                            {preview.output > 0
                              ? qty(
                                  ((preview.output - num(actualOutput)) /
                                    preview.output) *
                                    100,
                                )
                              : 0}
                            %)
                          </span>
                        )}
                      </div>
                    )}
                </div>

                <div className="production-requirements">
                  <h3>Ingredient stock check</h3>
                  {preview.requirements.length ? (
                    <div className="production-requirement-list">
                      {preview.requirements.map((r) => (
                        <div className="production-requirement" key={r.id}>
                          <div>
                            <strong>{r.name}</strong>
                            <small>
                              Available: {qty(r.available)} {r.unit}
                            </small>
                          </div>
                          <div
                            className={
                              r.available < r.needed ? "shortage" : "enough"
                            }
                          >
                            <small>Required</small>
                            <strong>
                              {qty(r.needed)} {r.unit}
                            </strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="production-empty-inline">
                      No linked ingredients found on this recipe.
                    </p>
                  )}

                  {preview.problems.length > 0 && (
                    <div className="production-problems">
                      <strong>
                        <FiAlertCircle /> Cannot produce yet
                      </strong>
                      <ul>
                        {preview.problems.map((p, i) => (
                          <li key={`${p}-${i}`}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="production-form-footer">
              <p>
                <FiAlertCircle /> Stock deductions and finished stock additions
                are saved together. If validation fails, no inventory changes
                are committed.
              </p>
              <button
                className="production-btn production-btn-primary"
                type="submit"
                disabled={
                  busy || !selectedRecipe || preview.problems.length > 0
                }
              >
                {busy ? (
                  "Recording production…"
                ) : (
                  <>
                    <FiPlay /> Confirm production
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="production-panel">
        <div className="production-panel-head">
          <div>
            <h2>Production history</h2>
            <p>Recent completed batches and their ingredient costs.</p>
          </div>
          <span className="production-count">
            {visibleBatches.length} records
          </span>
        </div>

        <div className="production-report-controls">
          <label className="production-field">
            <span>Daily report date</span>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </label>
          <div className="production-report-summary">
            <strong>{dayBatches.length} batches</strong>
            <span>
              {qty(dayPortions)} portions · {money(dayCost)}
            </span>
          </div>
          <button
            className="production-btn production-btn-primary"
            type="button"
            onClick={() => window.print()}
            disabled={!reportDate || dayBatches.length === 0}
          >
            <FiPrinter /> Print daily production
          </button>
        </div>

        <label className="production-search">
          <FiSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipe, finished product, or note…"
          />
        </label>

        {loading ? (
          <div className="production-empty">Loading history…</div>
        ) : visibleBatches.length === 0 ? (
          <div className="production-empty">
            <span className="production-empty-icon">
              <FiPackage />
            </span>
            <h3>No production records</h3>
            <p>
              Once you confirm production, completed batches will appear here.
            </p>
          </div>
        ) : (
          <div className="production-table-wrap">
            <table className="production-table">
              <thead>
                <tr>
                  <th>Recipe / Note</th>
                  <th>Finished product</th>
                  <th>Actual output / portions</th>
                  <th>Batches</th>
                  <th>Ingredient cost</th>
                  <th>Recorded at</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleBatches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.recipeName || "Recipe"}</strong>
                      <small>{b.note || "No note"}</small>
                    </td>
                    <td>{b.outputItemName || "—"}</td>
                    <td>
                      <strong>
                        {qty(b.actualOutputQuantity ?? b.outputQuantity)}{" "}
                        {b.outputUnit || ""}
                      </strong>
                      <small>
                        {qty(b.actualPortions ?? 0)} portions
                        {b.expectedOutputQuantity != null
                          ? ` · Expected ${qty(b.expectedOutputQuantity)} ${b.outputUnit || ""}`
                          : ""}
                      </small>
                    </td>
                    <td>{b.batchCount || 1}</td>
                    <td>
                      <strong>{money(b.ingredientCost)}</strong>
                    </td>
                    <td>{dateText(b.producedAt || b.createdAt)}</td>
                    <td>
                      <button
                        className="production-delete"
                        type="button"
                        title="Delete history record"
                        onClick={() => deleteBatch(b)}
                        disabled={deletingId === b.id}
                      >
                        <FiTrash2 />{" "}
                        {deletingId === b.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="production-print-report" aria-hidden="true">
        <header className="production-print-header">
          <div>
            <h1>Daily Production Report</h1>
            <p>{reportDateLabel}</p>
          </div>
          <div className="production-print-brand">Production Record</div>
        </header>
        <div className="production-print-metrics">
          <div>
            <span>Total batches</span>
            <strong>{dayBatches.length}</strong>
          </div>
          <div>
            <span>Total actual output</span>
            <strong>{dayOutputLabel}</strong>
          </div>
          <div>
            <span>Total portions</span>
            <strong>{qty(dayPortions)}</strong>
          </div>
          <div>
            <span>Ingredient cost</span>
            <strong>{money(dayCost)}</strong>
          </div>
        </div>

        {dayBatches.length === 0 ? (
          <p>No production was recorded for this date.</p>
        ) : (
          <table className="production-print-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Recipe / product</th>
                <th>Expected output</th>
                <th>Actual output</th>
                <th>Portions</th>
                <th>Batches</th>
                <th>Ingredient cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {dayBatches.map((b, index) => (
                <tr key={b.id}>
                  <td>{index + 1}</td>
                  <td>{dateText(b.producedAt || b.createdAt)}</td>
                  <td>{b.recipeName || b.outputItemName || "Recipe"}</td>
                  <td>
                    {qty(b.expectedOutputQuantity)} {b.outputUnit || ""}
                  </td>
                  <td>
                    {qty(b.actualOutputQuantity ?? b.outputQuantity)}{" "}
                    {b.outputUnit || ""}
                  </td>
                  <td>{qty(b.actualPortions)}</td>
                  <td>{b.batchCount || 1}</td>
                  <td>{money(b.ingredientCost)}</td>
                  <td>{b.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="production-print-footer">
          <span>Printed on {new Date().toLocaleString()}</span>
          <span>Prepared by: ____________________</span>
          <span>Checked by: ____________________</span>
        </footer>
      </section>
    </main>
  );
}
