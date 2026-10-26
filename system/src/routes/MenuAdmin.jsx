
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiEye,
  FiEyeOff,
  FiFilter,
  FiSearch,
  FiTag,
  FiDollarSign,
  FiPackage,
} from "react-icons/fi";
import { db } from "../assets/firebase/config";
import { checkRecipeAvailability } from "../assets/firebase/menuAvailability";
import "../styles/Menu.css";

const RECIPES = "recipes";
const ITEMS = "inventoryItems";

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

export default function MenuAdmin() {
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let recipesLoaded = false;
    let itemsLoaded = false;

    const maybeLoaded = () => {
      setLoading(!(recipesLoaded && itemsLoaded));
    };

    const unsubscribeRecipes = onSnapshot(
      collection(db, RECIPES),
      (snapshot) => {
        const rows = snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        }));

        setRecipes(rows);

        setDrafts((current) => {
          const next = { ...current };

          rows.forEach((recipe) => {
            if (!next[recipe.id]) {
              next[recipe.id] = {
                sellingPrice:
                  recipe.sellingPrice === 0 || recipe.sellingPrice
                    ? String(recipe.sellingPrice)
                    : "",
                menuCategory:
                  recipe.menuCategory || recipe.categories?.[0] || "",
                menuDescription:
                  recipe.menuDescription || recipe.description || "",
                menuActive: recipe.menuActive === true,
              };
            }
          });

          return next;
        });

        recipesLoaded = true;
        maybeLoaded();
      },
      (err) => {
        console.error("Menu recipes load failed:", err);
        setError(
          "Could not load recipes. Check Firestore read permissions.",
        );
        recipesLoaded = true;
        maybeLoaded();
      },
    );

    const unsubscribeItems = onSnapshot(
      collection(db, ITEMS),
      (snapshot) => {
        setItems(
          snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })),
        );

        itemsLoaded = true;
        maybeLoaded();
      },
      (err) => {
        console.error("Menu ingredient inventory load failed:", err);
        setError(
          "Could not load ingredient inventory. Check Firestore read permissions.",
        );
        itemsLoaded = true;
        maybeLoaded();
      },
    );

    return () => {
      unsubscribeRecipes();
      unsubscribeItems();
    };
  }, []);

  const productRecipes = useMemo(
    () =>
      recipes
        .filter(
          (recipe) =>
            recipe.recipeType === "product" &&
            recipe.archived !== true,
        )
        .sort((a, b) =>
          String(a.title || "").localeCompare(
            String(b.title || ""),
          ),
        ),
    [recipes],
  );

  const categories = useMemo(() => {
    const values = new Set();

    productRecipes.forEach((recipe) => {
      const draft = drafts[recipe.id];

      const value = String(
        draft?.menuCategory ??
          recipe.menuCategory ??
          recipe.categories?.[0] ??
          "",
      ).trim();

      if (value) values.add(value);
    });

    return [...values].sort((a, b) => a.localeCompare(b));
  }, [productRecipes, drafts]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();

    return productRecipes.filter((recipe) => {
      const draft = drafts[recipe.id] || {};

      const category = String(
        draft.menuCategory ??
          recipe.menuCategory ??
          recipe.categories?.[0] ??
          "Uncategorized",
      ).trim();

      const published = draft.menuActive === true;
      const description =
        draft.menuDescription || recipe.description || "";

      const haystack =
        `${recipe.title || ""} ${description} ${category}`.toLowerCase();

      return (
        (!term || haystack.includes(term)) &&
        (categoryFilter === "all" ||
          category === categoryFilter) &&
        (statusFilter === "all" ||
          (statusFilter === "published" && published) ||
          (statusFilter === "hidden" && !published))
      );
    });
  }, [
    productRecipes,
    drafts,
    search,
    categoryFilter,
    statusFilter,
  ]);

  const publishedCount = productRecipes.filter(
    (recipe) => drafts[recipe.id]?.menuActive === true,
  ).length;

  const pricedCount = productRecipes.filter(
    (recipe) =>
      number(
        drafts[recipe.id]?.sellingPrice ?? recipe.sellingPrice,
      ) > 0,
  ).length;

  function changeDraft(recipeId, field, value) {
    setDrafts((current) => ({
      ...current,
      [recipeId]: {
        ...(current[recipeId] || {}),
        [field]: value,
      },
    }));
  }

  async function saveProduct(recipe) {
    const draft = drafts[recipe.id] || {};
    const priceText = String(draft.sellingPrice ?? "").trim();
    const price = Number(priceText);
    const category = String(draft.menuCategory || "").trim();

    if (
      priceText === "" ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      setError(
        `Enter a valid selling price for "${recipe.title}".`,
      );
      setNotice("");
      return;
    }

    if (!category) {
      setError(
        `Enter a menu category for "${recipe.title}".`,
      );
      setNotice("");
      return;
    }

    // Publishing no longer requires outputItemId or finished stock.
    if (
      draft.menuActive === true &&
      (!Array.isArray(recipe.ingredients) ||
        recipe.ingredients.length === 0)
    ) {
      setError(
        `"${recipe.title}" cannot be published because its recipe has no ingredients.`,
      );
      setNotice("");
      return;
    }

    setSavingId(recipe.id);
    setError("");
    setNotice("");

    try {
      await updateDoc(doc(db, RECIPES, recipe.id), {
        sellingPrice: price,
        menuCategory: category,
        menuDescription: String(
          draft.menuDescription || "",
        ).trim(),
        menuActive: draft.menuActive === true,
        updatedAt: serverTimestamp(),
      });

      setNotice(
        `Menu settings saved for "${recipe.title}".`,
      );
    } catch (err) {
      console.error("Saving menu settings failed:", err);

      setError(
        err?.message ||
          "Could not save menu settings. Check Firestore write permissions.",
      );
    } finally {
      setSavingId("");
    }
  }

  function getAvailability(recipe) {
    return checkRecipeAvailability(recipe, recipes, items);
  }

  return (
    <main className="matrix-menu-page">
      <header className="matrix-menu-header">
        <div>
          <div className="matrix-menu-eyebrow">
            <FiTag /> MENU MANAGEMENT
          </div>

          <h1>Menu</h1>

          <p>
            Publish product recipes, set selling prices, organize
            categories, and check ingredient availability.
          </p>
        </div>

        <div className="matrix-menu-header-count">
          <strong>{publishedCount}</strong>
          <span>published items</span>
        </div>
      </header>

      {error && (
        <div className="matrix-menu-alert error">
          <FiAlertCircle />
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            aria-label="Dismiss"
            type="button"
          >
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="matrix-menu-alert success">
          <FiCheckCircle />
          <span>{notice}</span>
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss"
            type="button"
          >
            ×
          </button>
        </div>
      )}

      <section className="matrix-menu-stats">
        <article>
          <span className="matrix-menu-stat-icon">
            <FiPackage />
          </span>
          <div>
            <small>Product recipes</small>
            <strong>{productRecipes.length}</strong>
          </div>
        </article>

        <article>
          <span className="matrix-menu-stat-icon green">
            <FiEye />
          </span>
          <div>
            <small>Published</small>
            <strong>{publishedCount}</strong>
          </div>
        </article>

        <article>
          <span className="matrix-menu-stat-icon purple">
            <FiDollarSign />
          </span>
          <div>
            <small>With a price</small>
            <strong>{pricedCount}</strong>
          </div>
        </article>

        <article>
          <span className="matrix-menu-stat-icon amber">
            <FiTag />
          </span>
          <div>
            <small>Categories</small>
            <strong>{categories.length}</strong>
          </div>
        </article>
      </section>

      <section className="matrix-menu-panel">
        <div className="matrix-menu-panel-heading">
          <div>
            <h2>Menu products</h2>
            <p>
              Only recipes with type “Product for sale” are
              shown here.
            </p>
          </div>

          <span className="matrix-menu-count">
            {visibleProducts.length} items
          </span>
        </div>

        <div className="matrix-menu-toolbar">
          <label className="matrix-menu-search">
            <FiSearch />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products or descriptions…"
            />
          </label>

          <label className="matrix-menu-select">
            <FiFilter />
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value)
              }
            >
              <option value="all">All categories</option>

              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <select
            className="matrix-menu-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>

        {loading ? (
          <div className="matrix-menu-empty">
            Loading recipes and ingredient inventory…
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="matrix-menu-empty">
            <FiPackage />
            <h3>No product recipes found</h3>
            <p>
              Create a recipe with type “Product for sale”
              in Recipes first.
            </p>
          </div>
        ) : (
          <div className="matrix-menu-admin-list">
            {visibleProducts.map((recipe) => {
              const draft = drafts[recipe.id] || {};
              const availability = getAvailability(recipe);
              const published = draft.menuActive === true;

              return (
                <article
                  className="matrix-menu-admin-card"
                  key={recipe.id}
                >
                  <div className="matrix-menu-admin-card-top">
                    <div className="matrix-menu-product-title">
                      <span
                        className={`matrix-menu-status ${
                          published ? "published" : "hidden"
                        }`}
                      >
                        {published ? "Published" : "Hidden"}
                      </span>

                      <h3>
                        {recipe.title || "Untitled product"}
                      </h3>

                      <p>
                        {draft.menuDescription ||
                          recipe.description ||
                          "No description added."}
                      </p>
                    </div>

                    <div
                      className={`matrix-menu-stock ${
                        availability.status === "available"
                          ? "in-stock"
                          : "out-stock"
                      }`}
                      title={availability.message}
                    >
                      <span className="matrix-menu-stock-dot" />

                      {availability.status === "available"
                        ? "Ingredients available"
                        : availability.status === "unavailable"
                          ? "Insufficient ingredients"
                          : "Availability needs review"}
                    </div>
                  </div>

                  <div className="matrix-menu-edit-grid">
                    <label>
                      <span>Selling price (USD)</span>

                      <div className="matrix-menu-price-input">
                        <b>$</b>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.sellingPrice ?? ""}
                          onChange={(e) =>
                            changeDraft(
                              recipe.id,
                              "sellingPrice",
                              e.target.value,
                            )
                          }
                          placeholder="0.00"
                        />
                      </div>
                    </label>

                    <label>
                      <span>Menu category</span>
                      <input
                        value={draft.menuCategory ?? ""}
                        onChange={(e) =>
                          changeDraft(
                            recipe.id,
                            "menuCategory",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. Desserts, Drinks"
                        list="matrix-menu-category-options"
                      />
                    </label>

                    <label className="matrix-menu-description-field">
                      <span>Customer-facing description</span>
                      <input
                        value={draft.menuDescription ?? ""}
                        onChange={(e) =>
                          changeDraft(
                            recipe.id,
                            "menuDescription",
                            e.target.value,
                          )
                        }
                        placeholder="Short description shown to customers"
                      />
                    </label>
                  </div>

                  <datalist id="matrix-menu-category-options">
                    {categories.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>

                  <div className="matrix-menu-admin-card-footer">
                    <label className="matrix-menu-publish-toggle">
                      <input
                        type="checkbox"
                        checked={published}
                        onChange={(e) =>
                          changeDraft(
                            recipe.id,
                            "menuActive",
                            e.target.checked,
                          )
                        }
                      />

                      <span>
                        {published ? <FiEye /> : <FiEyeOff />}
                      </span>

                      {published
                        ? "Visible on customer menu"
                        : "Hidden from customer menu"}
                    </label>

                    <div className="matrix-menu-admin-actions">
                      <span className="matrix-menu-price-preview">
                        {money(draft.sellingPrice)}
                      </span>

                      <button
                        className="matrix-menu-btn primary"
                        type="button"
                        onClick={() => saveProduct(recipe)}
                        disabled={savingId === recipe.id}
                      >
                        {savingId === recipe.id
                          ? "Saving…"
                          : "Save menu item"}
                      </button>
                    </div>
                  </div>

                  {published &&
                    availability.status !== "available" && (
                      <div className="matrix-menu-inline-warning">
                        <FiAlertCircle />
                        <span>{availability.message}</span>
                      </div>
                    )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className="matrix-menu-footnote">
        Availability is estimated from recipe ingredients and
        component recipes. Publishing does not require finished
        stock. Check ingredient quantities again when an order
        is placed.
      </p>
    </main>
  );
}
