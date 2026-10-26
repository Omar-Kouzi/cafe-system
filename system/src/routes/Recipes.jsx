import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import SecureLS from "secure-ls";
import {
  FiArchive,
  FiBookOpen,
  FiCheck,
  FiChevronDown,
  FiClock,
  FiEdit2,
  FiFilter,
  FiPackage,
  FiPlus,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";

import { db } from "../assets/firebase/config";
import "../styles/Recipes.css";

const RECIPES = "recipes";
const ITEMS = "inventoryItems";

const UNITS = [
  "kg",
  "g",
  "L",
  "ml",
  "cans",
  "jars",
  "cartons",
  "pieces",
  "packs",
  "boxes",
  "bags",
  "bottles",
  "rolls",
];

const MEASURE_UNITS = UNITS;

const TYPES = [
  { value: "food", label: "Food preparation" },
  { value: "product", label: "Product for sale" },
];

const EMPTY_INGREDIENT = {
  ingredientType: "inventory",
  itemId: "",
  recipeId: "",
  amount: "100",
  unit: "g",
};

const EMPTY_FORM = {
  title: "",
  description: "",
  recipeType: "product",
  categoriesText: "",
  prepTime: "",
  cookTime: "",
  difficulty: "Easy",
  yieldAmount: "1",
  yieldUnit: "pieces",
  notes: "",
  ingredients: [{ ...EMPTY_INGREDIENT }],
  steps: [""],
};

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n(value));

const quantityLabel = (value) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(n(value));

const safeError = (err, fallback) => {
  console.error(fallback, err);
  return err?.message || fallback;
};

// Converts quantities within compatible dimensions.
function convertQuantity(amount, fromUnit, toUnit) {
  const weight = { g: 1, kg: 1000 };
  const volume = { ml: 1, L: 1000 };

  const count = [
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

  if (fromUnit === toUnit) return n(amount);

  if (weight[fromUnit] && weight[toUnit]) {
    return (n(amount) * weight[fromUnit]) / weight[toUnit];
  }

  if (volume[fromUnit] && volume[toUnit]) {
    return (n(amount) * volume[fromUnit]) / volume[toUnit];
  }

  throw new Error(
    `Cannot convert ${fromUnit} to ${toUnit}. Choose compatible units.`,
  );
}

// Inventory quantity is stored in the item's stock unit.
// Package example: 1 can contains 500 g.
function recipeAmountToStockUnit(amount, fromUnit, item) {
  const stockUnit = item.unit || "pieces";

  if (fromUnit === stockUnit) return n(amount);

  const packageAmount = n(item.packageContentsAmount);
  const packageUnit = item.packageContentsUnit;

  if (packageAmount > 0 && packageUnit) {
    const contentAmount = convertQuantity(amount, fromUnit, packageUnit);

    return contentAmount / packageAmount;
  }

  return convertQuantity(amount, fromUnit, stockUnit);
}

function compatibleWithItem(fromUnit, item) {
  if (!item) return true;

  try {
    recipeAmountToStockUnit(1, fromUnit, item);
    return true;
  } catch {
    return false;
  }
}

function parseRecipe(recipe) {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
    : [];

  return {
    ...EMPTY_FORM,
    ...recipe,
    recipeType: recipe.recipeType || "food",

    categoriesText: Array.isArray(recipe.categories)
      ? recipe.categories.join(", ")
      : "",

    yieldAmount: String(recipe.yieldAmount ?? recipe.servings ?? 1),

    yieldUnit: recipe.yieldUnit || "pieces",

    ingredients: ingredients.length
      ? ingredients.map((item) => {
          const rawQuantity = item.amount ?? item.quantity ?? "";
          const parsedAmount = Number.parseFloat(rawQuantity);

          const detectedUnit =
            typeof rawQuantity === "string"
              ? rawQuantity.match(
                  /(?:^|\s)(kg|g|L|ml|pieces|cans|jars|cartons|packs|boxes|bags|bottles|rolls)\s*$/i,
                )?.[1] || ""
              : "";

          return {
            ingredientType:
              item.ingredientType || (item.recipeId ? "recipe" : "inventory"),

            itemId: item.itemId || "",
            recipeId: item.recipeId || "",

            amount: String(Number.isFinite(parsedAmount) ? parsedAmount : ""),

            unit: item.unit || detectedUnit || "g",
          };
        })
      : [{ ...EMPTY_INGREDIENT }],

    steps:
      Array.isArray(recipe.steps) && recipe.steps.length ? recipe.steps : [""],
  };
}

function Recipes() {
  const ls = useMemo(() => new SecureLS({ encodingType: "aes" }), []);

  const uid = ls.get("uid");

  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ingredients: [{ ...EMPTY_INGREDIENT }],
    steps: [""],
  });
  const [saving, setSaving] = useState(false);

  // Load recipes and inventory in real time.
  useEffect(() => {
    const unsubscribers = [];
    const loaded = { recipes: false, items: false };

    const maybeLoaded = () => {
      setLoading(!(loaded.recipes && loaded.items));
    };

    unsubscribers.push(
      onSnapshot(
        collection(db, RECIPES),
        (snapshot) => {
          setRecipes(
            snapshot.docs.map((entry) => ({
              id: entry.id,
              ...entry.data(),
            })),
          );

          loaded.recipes = true;
          maybeLoaded();
        },
        (err) => {
          setError(
            "Could not load recipes. Check Firestore permissions for the recipes collection.",
          );

          console.error("Loading recipes failed:", err);
          loaded.recipes = true;
          maybeLoaded();
        },
      ),
    );

    unsubscribers.push(
      onSnapshot(
        collection(db, ITEMS),
        (snapshot) => {
          setItems(
            snapshot.docs.map((entry) => ({
              id: entry.id,
              ...entry.data(),
            })),
          );

          loaded.items = true;
          maybeLoaded();
        },
        (err) => {
          setError(
            "Could not load inventory items. Check Firestore permissions for inventoryItems.",
          );

          console.error("Loading recipe inventory failed:", err);
          loaded.items = true;
          maybeLoaded();
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const itemById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );

  const ingredientItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.category !== "Finished products" &&
          item.category !== "Cleaning supplies",
      ),
    [items],
  );

  // Calculate recipe costs recursively, including other recipes
  // used as components. The visited set prevents infinite loops.
  function getRecipeCost(recipe, visited = new Set()) {
    if (!recipe || visited.has(recipe.id)) return 0;

    const nextVisited = new Set(visited);

    if (recipe.id) {
      nextVisited.add(recipe.id);
    }

    return (recipe.ingredients || []).reduce((total, ingredient) => {
      const isRecipeIngredient =
        ingredient.ingredientType === "recipe" || Boolean(ingredient.recipeId);

      if (isRecipeIngredient) {
        const component = recipes.find(
          (entry) => entry.id === ingredient.recipeId,
        );

        if (!component || nextVisited.has(component.id)) {
          return total;
        }

        const componentYield = n(
          component.yieldAmount ?? component.servings ?? 1,
        );

        if (componentYield <= 0) return total;

        try {
          const amount = convertQuantity(
            ingredient.amount ?? ingredient.quantity,
            ingredient.unit || component.yieldUnit || "pieces",
            component.yieldUnit || "pieces",
          );

          const componentCost = getRecipeCost(component, nextVisited);

          return total + (componentCost / componentYield) * amount;
        } catch {
          return total;
        }
      }

      const item = itemById[ingredient.itemId];

      if (!item) return total;

      try {
        const amount = recipeAmountToStockUnit(
          ingredient.amount ?? ingredient.quantity,
          ingredient.unit || item.unit || "pieces",
          item,
        );

        return total + amount * n(item.unitCost);
      } catch {
        return total;
      }
    }, 0);
  }

  const filteredRecipes = useMemo(() => {
    const term = search.trim().toLowerCase();

    return recipes
      .filter((recipe) => showArchived || recipe.archived !== true)
      .filter(
        (recipe) =>
          typeFilter === "all" || (recipe.recipeType || "food") === typeFilter,
      )
      .filter((recipe) =>
        [recipe.title, recipe.description, ...(recipe.categories || [])]
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
      .sort((a, b) =>
        String(a.title || "").localeCompare(String(b.title || "")),
      );
  }, [recipes, search, typeFilter, showArchived]);

  const stats = useMemo(() => {
    const active = recipes.filter((recipe) => !recipe.archived);

    return {
      recipes: active.length,
      sellable: active.filter(
        (recipe) => (recipe.recipeType || "food") === "product",
      ).length,
    };
  }, [recipes]);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateIngredient(index, field, value) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, i) =>
        i === index ? { ...ingredient, [field]: value } : ingredient,
      ),
    }));
  }

  function addIngredient() {
    setForm((current) => ({
      ...current,
      ingredients: [...current.ingredients, { ...EMPTY_INGREDIENT }],
    }));
  }

  function removeIngredient(index) {
    setForm((current) => ({
      ...current,
      ingredients:
        current.ingredients.length === 1
          ? current.ingredients
          : current.ingredients.filter((_, i) => i !== index),
    }));
  }

  function updateStep(index, value) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? value : step)),
    }));
  }

  function addStep() {
    setForm((current) => ({
      ...current,
      steps: [...current.steps, ""],
    }));
  }

  function removeStep(index) {
    setForm((current) => ({
      ...current,
      steps:
        current.steps.length === 1
          ? current.steps
          : current.steps.filter((_, i) => i !== index),
    }));
  }

  function openNewRecipe() {
    setEditing(null);

    setForm({
      ...EMPTY_FORM,
      ingredients: [{ ...EMPTY_INGREDIENT }],
      steps: [""],
    });

    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditRecipe(recipe) {
    setEditing(recipe);
    setForm(parseRecipe(recipe));
    setError("");
    setNotice("");
    setShowForm(true);
  }

  // Detect circular recipe dependencies before saving.
  function recipeContainsTarget(recipe, targetId, visited = new Set()) {
    if (!recipe || visited.has(recipe.id)) return false;
    if (recipe.id === targetId) return true;

    const nextVisited = new Set(visited);
    nextVisited.add(recipe.id);

    return (recipe.ingredients || []).some((ingredient) => {
      const isRecipeIngredient =
        ingredient.ingredientType === "recipe" || Boolean(ingredient.recipeId);

      if (!isRecipeIngredient) return false;

      const nestedRecipe = recipes.find(
        (entry) => entry.id === ingredient.recipeId,
      );

      return nestedRecipe
        ? recipeContainsTarget(nestedRecipe, targetId, nextVisited)
        : false;
    });
  }

  async function saveRecipe(event) {
    event.preventDefault();

    setError("");
    setNotice("");

    if (!form.title.trim()) {
      setError("Enter a recipe name.");
      return;
    }

    if (n(form.yieldAmount) <= 0) {
      setError("Recipe yield must be greater than zero.");
      return;
    }

    let cleanedIngredients;

    try {
      cleanedIngredients = form.ingredients
        .filter((line) => {
          const hasSelection =
            line.ingredientType === "recipe" ? line.recipeId : line.itemId;

          return hasSelection && n(line.amount) > 0;
        })
        .map((line) => {
          if (line.ingredientType === "recipe") {
            const component = recipes.find(
              (recipe) => recipe.id === line.recipeId,
            );

            if (!component) {
              throw new Error(
                "One of the selected component recipes no longer exists.",
              );
            }

            if (editing && component.id === editing.id) {
              throw new Error(
                "A recipe cannot contain itself as an ingredient.",
              );
            }

            if (component.archived) {
              throw new Error(
                `"${component.title}" is archived. Restore it before using it.`,
              );
            }

            const componentYield = n(
              component.yieldAmount ?? component.servings ?? 1,
            );

            if (componentYield <= 0) {
              throw new Error(
                `"${component.title}" must have a valid recipe yield.`,
              );
            }

            if (editing && recipeContainsTarget(component, editing.id)) {
              throw new Error(
                "This would create a circular recipe dependency. Choose another component.",
              );
            }

            try {
              convertQuantity(
                n(line.amount),
                line.unit,
                component.yieldUnit || "pieces",
              );
            } catch {
              throw new Error(
                `The amount unit for "${component.title}" must be compatible with its yield unit (${component.yieldUnit || "pieces"}).`,
              );
            }

            return {
              ingredientType: "recipe",
              recipeId: component.id,
              name: component.title || "Recipe component",
              amount: n(line.amount),
              unit: line.unit,
              quantity: `${n(line.amount)} ${line.unit}`,
              componentYieldAmount: componentYield,
              componentYieldUnit: component.yieldUnit || "pieces",
            };
          }

          const item = itemById[line.itemId];

          if (!item) {
            throw new Error(
              "One of the selected inventory ingredients no longer exists.",
            );
          }

          if (!compatibleWithItem(line.unit, item)) {
            throw new Error(
              `The recipe unit for ${item.name} is incompatible with its inventory unit or package contents.`,
            );
          }

          return {
            ingredientType: "inventory",
            itemId: item.id,
            name: item.name || "Ingredient",
            amount: n(line.amount),
            unit: line.unit,
            quantity: `${n(line.amount)} ${line.unit}`,
            inventoryUnit: item.unit || "pieces",
            packageContentsAmount: n(item.packageContentsAmount) || 0,
            packageContentsUnit: item.packageContentsUnit || "",
          };
        });
    } catch (err) {
      setError(err.message || "Check the recipe ingredient units.");
      return;
    }

    if (!cleanedIngredients.length) {
      setError("Add at least one inventory item or existing recipe.");
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      recipeType: form.recipeType,

      categories: form.categoriesText
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),

      prepTime: form.prepTime.trim(),
      cookTime: form.cookTime.trim(),
      difficulty: form.difficulty,

      servings: n(form.yieldAmount),
      yieldAmount: n(form.yieldAmount),
      yieldUnit: form.yieldUnit,

      notes: form.notes.trim(),
      ingredients: cleanedIngredients,
      steps: form.steps.map((step) => step.trim()).filter(Boolean),

      createdBy: editing?.createdBy || uid || "",
      authorId: editing?.authorId || uid || "",
      updatedAt: serverTimestamp(),
      archived: false,
    };

    setSaving(true);

    try {
      if (editing) {
        await updateDoc(doc(db, RECIPES, editing.id), payload);

        setNotice("Recipe updated.");
      } else {
        await addDoc(collection(db, RECIPES), {
          ...payload,
          saves: 0,
          images: [],
          createdAt: serverTimestamp(),
        });

        setNotice(
          "Recipe saved. Ingredient costs use the latest inventory and component recipe costs.",
        );
      }

      setShowForm(false);
      setEditing(null);
    } catch (err) {
      setError(
        safeError(err, "Could not save recipe. Check Firestore permissions."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function archiveRecipe(recipe) {
    if (
      !window.confirm(
        `Archive "${recipe.title}"? It will be hidden from the active recipe list.`,
      )
    ) {
      return;
    }

    try {
      await updateDoc(doc(db, RECIPES, recipe.id), {
        archived: true,
        updatedAt: serverTimestamp(),
      });

      setNotice("Recipe archived.");
      setError("");
    } catch (err) {
      setError(safeError(err, "Could not archive recipe."));
    }
  }

  async function restoreRecipe(recipe) {
    try {
      await updateDoc(doc(db, RECIPES, recipe.id), {
        archived: false,
        updatedAt: serverTimestamp(),
      });

      setNotice("Recipe restored.");
      setError("");
    } catch (err) {
      setError(safeError(err, "Could not restore recipe."));
    }
  }

  function getIngredientLineCost(ingredient) {
    if (ingredient.ingredientType === "recipe" && ingredient.recipeId) {
      const component = recipes.find(
        (recipe) => recipe.id === ingredient.recipeId,
      );

      if (!component) return 0;

      const componentYield = n(
        component.yieldAmount ?? component.servings ?? 1,
      );

      if (componentYield <= 0) return 0;

      try {
        const amount = convertQuantity(
          n(ingredient.amount),
          ingredient.unit,
          component.yieldUnit || "pieces",
        );

        return (getRecipeCost(component) / componentYield) * amount;
      } catch {
        return 0;
      }
    }

    const item = itemById[ingredient.itemId];

    if (!item || !compatibleWithItem(ingredient.unit, item)) {
      return 0;
    }

    try {
      return (
        recipeAmountToStockUnit(n(ingredient.amount), ingredient.unit, item) *
        n(item.unitCost)
      );
    } catch {
      return 0;
    }
  }

  return (
    <div className="recipes-page">
      <header className="recipes-header">
        <div>
          <div className="recipes-eyebrow">
            <FiBookOpen /> RECIPE MANAGEMENT
          </div>

          <h1>Recipes</h1>

          <p>
            Connect recipes to inventory and calculate ingredient costs using
            the latest purchase prices.
          </p>
        </div>

        <div className="recipes-header-actions">
          <button
            type="button"
            className="recipes-btn recipes-btn-primary"
            onClick={openNewRecipe}
          >
            <FiPlus /> New recipe
          </button>
        </div>
      </header>

      {error && (
        <div className="recipes-alert recipes-alert-error">
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
        <div className="recipes-alert recipes-alert-success">
          <span>{notice}</span>

          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <FiX />
          </button>
        </div>
      )}

      <div className="recipes-stats">
        <div className="recipes-stat">
          <span className="recipes-stat-icon">
            <FiBookOpen />
          </span>

          <div>
            <span>Active recipes</span>
            <strong>{stats.recipes}</strong>
          </div>
        </div>

        <div className="recipes-stat">
          <span className="recipes-stat-icon purple">
            <FiPackage />
          </span>

          <div>
            <span>Products for sale</span>
            <strong>{stats.sellable}</strong>
          </div>
        </div>
      </div>

      <section className="recipes-panel">
        <div className="recipes-panel-head">
          <div>
            <h2>Recipe library</h2>
            <p>
              Costs refresh from linked inventory items and component recipes.
            </p>
          </div>

          <span className="recipes-count">
            {filteredRecipes.length} recipes
          </span>
        </div>

        <div className="recipes-toolbar">
          <label className="recipes-search">
            <FiSearch />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipes or categories…"
            />
          </label>

          <label className="recipes-select">
            <FiFilter />

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="all">All recipe types</option>
              <option value="food">Food preparation</option>
              <option value="product">Products for sale</option>
            </select>

            <FiChevronDown />
          </label>

          <label className="recipes-archive-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{" "}
            Include archived
          </label>
        </div>

        {loading ? (
          <div className="recipes-empty">Loading recipes and inventory…</div>
        ) : filteredRecipes.length === 0 ? (
          <div className="recipes-empty">
            <span className="recipes-empty-icon">
              <FiBookOpen />
            </span>

            <h3>No recipes yet</h3>

            <p>
              Create a recipe, link each ingredient to Inventory or an existing
              recipe, and Matrix will calculate its current cost.
            </p>

            <button
              type="button"
              className="recipes-btn recipes-btn-primary"
              onClick={openNewRecipe}
            >
              <FiPlus /> Create first recipe
            </button>
          </div>
        ) : (
          <div className="recipes-grid">
            {filteredRecipes.map((recipe) => {
              const cost = getRecipeCost(recipe);

              const yieldAmount = n(recipe.yieldAmount ?? recipe.servings ?? 1);

              const isArchived = recipe.archived === true;

              const missingIngredients = (recipe.ingredients || []).filter(
                (ingredient) => {
                  if (
                    ingredient.ingredientType === "recipe" ||
                    ingredient.recipeId
                  ) {
                    return !recipes.some(
                      (entry) => entry.id === ingredient.recipeId,
                    );
                  }

                  return !itemById[ingredient.itemId];
                },
              ).length;

              return (
                <article
                  className={`recipes-card${isArchived ? " is-archived" : ""}`}
                  key={recipe.id}
                >
                  <div className="recipes-card-top">
                    <span
                      className={`recipes-type ${
                        recipe.recipeType === "product" ? "product" : "food"
                      }`}
                    >
                      {recipe.recipeType === "product"
                        ? "Product for sale"
                        : "Food preparation"}
                    </span>

                    {isArchived && (
                      <span className="recipes-archived-label">Archived</span>
                    )}
                  </div>

                  <h3>{recipe.title || "Untitled recipe"}</h3>

                  <p className="recipes-card-description">
                    {recipe.description || "No description added."}
                  </p>

                  <div className="recipes-card-meta">
                    <span>
                      <FiClock /> {recipe.prepTime || "—"} prep
                    </span>

                    <span>
                      <FiPackage /> Yield {quantityLabel(yieldAmount)}{" "}
                      {recipe.yieldUnit || "pieces"}
                    </span>
                  </div>

                  <div className="recipes-cost">
                    <div>
                      <span>Ingredient cost</span>
                      <strong>{money(cost)}</strong>
                    </div>

                    <div>
                      <span>Cost per yield unit</span>
                      <strong>
                        {yieldAmount > 0 ? money(cost / yieldAmount) : money(0)}
                      </strong>
                    </div>
                  </div>

                  {missingIngredients > 0 && (
                    <div className="recipes-inline-warning">
                      {missingIngredients} ingredient link
                      {missingIngredients === 1 ? "" : "s"} missing from
                      Inventory or Recipes.
                    </div>
                  )}

                  {recipe.categories?.length > 0 && (
                    <div className="recipes-tags">
                      {recipe.categories.map((category) => (
                        <span key={category}>{category}</span>
                      ))}
                    </div>
                  )}

                  <div className="recipes-card-actions">
                    <button
                      type="button"
                      className="recipes-btn recipes-btn-secondary"
                      onClick={() => openEditRecipe(recipe)}
                    >
                      <FiEdit2 /> Edit
                    </button>

                    {isArchived ? (
                      <button
                        type="button"
                        className="recipes-icon-btn"
                        title="Restore recipe"
                        aria-label="Restore recipe"
                        onClick={() => restoreRecipe(recipe)}
                      >
                        <FiArchive />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="recipes-icon-btn danger"
                        title="Archive recipe"
                        aria-label="Archive recipe"
                        onClick={() => archiveRecipe(recipe)}
                      >
                        <FiTrash2 />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showForm && (
        <div
          className="recipes-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setShowForm(false);
            }
          }}
        >
          <section
            className="recipes-modal recipes-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipes-form-title"
          >
            <div className="recipes-modal-head">
              <div>
                <span className="recipes-eyebrow">RECIPE DETAILS</span>

                <h2 id="recipes-form-title">
                  {editing ? "Edit recipe" : "Create recipe"}
                </h2>

                <p>
                  Choose inventory ingredients or use recipes you have already
                  created.
                </p>
              </div>

              <button
                type="button"
                className="recipes-icon-btn"
                aria-label="Close"
                onClick={() => !saving && setShowForm(false)}
              >
                <FiX />
              </button>
            </div>

            <form onSubmit={saveRecipe}>
              <div className="recipes-form-grid">
                <label className="recipes-field full">
                  <span>Recipe name *</span>

                  <input
                    value={form.title}
                    onChange={(event) =>
                      updateForm("title", event.target.value)
                    }
                    required
                    placeholder="e.g. Mango sorbet"
                  />
                </label>

                <label className="recipes-field full">
                  <span>Description</span>

                  <textarea
                    rows="2"
                    value={form.description}
                    onChange={(event) =>
                      updateForm("description", event.target.value)
                    }
                    placeholder="Short description or intended use"
                  />
                </label>

                <label className="recipes-field">
                  <span>Recipe type</span>

                  <select
                    value={form.recipeType}
                    onChange={(event) =>
                      updateForm("recipeType", event.target.value)
                    }
                  >
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="recipes-field">
                  <span>Difficulty</span>

                  <select
                    value={form.difficulty}
                    onChange={(event) =>
                      updateForm("difficulty", event.target.value)
                    }
                  >
                    <option>Easy</option>
                    <option>Medium</option>
                    <option>Hard</option>
                  </select>
                </label>

                <label className="recipes-field">
                  <span>Prep time</span>

                  <input
                    value={form.prepTime}
                    onChange={(event) =>
                      updateForm("prepTime", event.target.value)
                    }
                    placeholder="e.g. 15 min"
                  />
                </label>

                <label className="recipes-field">
                  <span>Cook / freeze time</span>

                  <input
                    value={form.cookTime}
                    onChange={(event) =>
                      updateForm("cookTime", event.target.value)
                    }
                    placeholder="e.g. 4 hours"
                  />
                </label>

                <label className="recipes-field">
                  <span>Recipe yield *</span>

                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={form.yieldAmount}
                    onChange={(event) =>
                      updateForm("yieldAmount", event.target.value)
                    }
                    required
                  />
                </label>

                <label className="recipes-field">
                  <span>Yield unit</span>

                  <select
                    value={form.yieldUnit}
                    onChange={(event) =>
                      updateForm("yieldUnit", event.target.value)
                    }
                  >
                    {MEASURE_UNITS.map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>

                <label className="recipes-field full">
                  <span>Categories (comma-separated)</span>

                  <input
                    value={form.categoriesText}
                    onChange={(event) =>
                      updateForm("categoriesText", event.target.value)
                    }
                    placeholder="Desserts, Frozen, Signature"
                  />
                </label>
              </div>

              <div className="recipes-subsection-head">
                <div>
                  <h3>Ingredients</h3>

                  <p>
                    Select an inventory item or an existing recipe, then enter
                    the quantity used.
                  </p>
                </div>

                <button
                  type="button"
                  className="recipes-btn recipes-btn-secondary"
                  onClick={addIngredient}
                >
                  <FiPlus /> Add ingredient
                </button>
              </div>

              <div className="recipes-ingredient-list">
                {form.ingredients.map((ingredient, index) => {
                  const selected =
                    ingredient.ingredientType === "inventory"
                      ? itemById[ingredient.itemId]
                      : null;

                  const selectedRecipe =
                    ingredient.ingredientType === "recipe"
                      ? recipes.find(
                          (recipe) => recipe.id === ingredient.recipeId,
                        )
                      : null;

                  const lineCost = getIngredientLineCost(ingredient);

                  let currentUnitCost = 0;

                  if (selected) {
                    currentUnitCost = n(selected.unitCost);
                  } else if (selectedRecipe) {
                    const componentYield = n(
                      selectedRecipe.yieldAmount ??
                        selectedRecipe.servings ??
                        1,
                    );

                    if (componentYield > 0) {
                      currentUnitCost =
                        getRecipeCost(selectedRecipe) / componentYield;
                    }
                  }

                  return (
                    <div
                      className="recipes-ingredient-row"
                      key={`ingredient-${index}`}
                    >
                      <label className="recipes-field ingredient-name">
                        <span>Inventory item or recipe</span>

                        <select
                          value={
                            ingredient.ingredientType === "recipe"
                              ? ingredient.recipeId
                                ? `recipe:${ingredient.recipeId}`
                                : ""
                              : ingredient.itemId
                                ? `item:${ingredient.itemId}`
                                : ""
                          }
                          onChange={(event) => {
                            const value = event.target.value;

                            if (value.startsWith("recipe:")) {
                              const recipeId = value.slice("recipe:".length);

                              const component = recipes.find(
                                (recipe) => recipe.id === recipeId,
                              );

                              updateIngredient(
                                index,
                                "ingredientType",
                                "recipe",
                              );

                              updateIngredient(index, "itemId", "");

                              updateIngredient(index, "recipeId", recipeId);

                              if (component) {
                                updateIngredient(
                                  index,
                                  "unit",
                                  component.yieldUnit || "pieces",
                                );
                              }
                            } else {
                              const itemId = value.startsWith("item:")
                                ? value.slice("item:".length)
                                : "";

                              const item = itemById[itemId];

                              updateIngredient(
                                index,
                                "ingredientType",
                                "inventory",
                              );

                              updateIngredient(index, "recipeId", "");

                              updateIngredient(index, "itemId", itemId);

                              if (
                                item &&
                                !compatibleWithItem(ingredient.unit, item)
                              ) {
                                const suggested = ["kg", "g"].includes(
                                  item.unit,
                                )
                                  ? "g"
                                  : ["L", "ml"].includes(item.unit)
                                    ? "ml"
                                    : item.unit || "pieces";

                                updateIngredient(index, "unit", suggested);
                              }
                            }
                          }}
                          required
                        >
                          <option value="">Select ingredient or recipe…</option>

                          <optgroup label="Inventory items">
                            {ingredientItems.map((item) => (
                              <option key={item.id} value={`item:${item.id}`}>
                                {item.name} ({quantityLabel(item.quantity)}{" "}
                                {item.unit || "pieces"} in stock
                                {n(item.packageContentsAmount) > 0 &&
                                item.packageContentsUnit
                                  ? ` · 1 ${item.unit || "unit"} = ${quantityLabel(item.packageContentsAmount)} ${item.packageContentsUnit}`
                                  : ""}
                                )
                              </option>
                            ))}
                          </optgroup>

                          <optgroup label="Existing recipes">
                            {recipes
                              .filter(
                                (recipe) =>
                                  !recipe.archived && recipe.id !== editing?.id,
                              )
                              .sort((a, b) =>
                                String(a.title || "").localeCompare(
                                  String(b.title || ""),
                                ),
                              )
                              .map((recipe) => (
                                <option
                                  key={recipe.id}
                                  value={`recipe:${recipe.id}`}
                                >
                                  {recipe.title} — yield{" "}
                                  {quantityLabel(
                                    recipe.yieldAmount ?? recipe.servings ?? 1,
                                  )}{" "}
                                  {recipe.yieldUnit || "pieces"}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </label>

                      <label className="recipes-field ingredient-amount">
                        <span>Amount</span>

                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={ingredient.amount}
                          onChange={(event) =>
                            updateIngredient(
                              index,
                              "amount",
                              event.target.value,
                            )
                          }
                          required
                        />
                      </label>

                      <label className="recipes-field ingredient-unit">
                        <span>Unit</span>

                        <select
                          value={ingredient.unit}
                          onChange={(event) =>
                            updateIngredient(index, "unit", event.target.value)
                          }
                        >
                          {MEASURE_UNITS.map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                      </label>

                      <div className="recipes-ingredient-cost">
                        <span>Latest cost</span>
                        <strong>{money(lineCost)}</strong>

                        {(selected || selectedRecipe) && (
                          <small>
                            {money(currentUnitCost)} /{" "}
                            {selected
                              ? selected.unit || "pieces"
                              : selectedRecipe.yieldUnit || "pieces"}
                          </small>
                        )}
                      </div>

                      <button
                        type="button"
                        className="recipes-icon-btn danger remove-ingredient"
                        title="Remove ingredient"
                        aria-label="Remove ingredient"
                        onClick={() => removeIngredient(index)}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="recipes-subsection-head">
                <div>
                  <h3>Preparation steps</h3>
                  <p>Optional instructions for the kitchen team.</p>
                </div>

                <button
                  type="button"
                  className="recipes-btn recipes-btn-secondary"
                  onClick={addStep}
                >
                  <FiPlus /> Add step
                </button>
              </div>

              <div className="recipes-steps-list">
                {form.steps.map((step, index) => (
                  <div className="recipes-step-row" key={`step-${index}`}>
                    <span>{index + 1}</span>

                    <textarea
                      rows="2"
                      value={step}
                      onChange={(event) =>
                        updateStep(index, event.target.value)
                      }
                      placeholder={`Step ${index + 1}`}
                    />

                    <button
                      type="button"
                      className="recipes-icon-btn danger"
                      aria-label="Remove step"
                      onClick={() => removeStep(index)}
                    >
                      <FiX />
                    </button>
                  </div>
                ))}
              </div>

              <label className="recipes-field full">
                <span>Internal notes</span>

                <textarea
                  rows="2"
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                  placeholder="Storage, packaging, handling, or other notes"
                />
              </label>

              <div className="recipes-form-footer">
                <div>
                  <span>Estimated recipe ingredient cost</span>

                  <strong>
                    {money(
                      form.ingredients.reduce(
                        (sum, ingredient) =>
                          sum + getIngredientLineCost(ingredient),
                        0,
                      ),
                    )}
                  </strong>
                </div>

                <button
                  type="button"
                  className="recipes-btn recipes-btn-secondary"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="recipes-btn recipes-btn-primary"
                  disabled={saving}
                >
                  {saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <FiCheck /> {editing ? "Save changes" : "Save recipe"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default Recipes;
