
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import {
  FiAlertCircle,
  FiSearch,
  FiPackage,
  FiPlus,
  FiMinus,
  FiTrash2,
  FiShoppingCart,
  FiCheckCircle,
} from "react-icons/fi";

import { db } from "../assets/firebase/config";
import { addOrder } from "../assets/firebase/firestore";
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

export default function PublicMenu() {
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showUnavailable, setShowUnavailable] = useState(false);

  const [cart, setCart] = useState([]);
  const [orderNotes, setOrderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let recipesLoaded = false;
    let itemsLoaded = false;
    let active = true;

    const finishLoading = () => {
      if (active) setLoading(!(recipesLoaded && itemsLoaded));
    };

    const unsubRecipes = onSnapshot(
      collection(db, RECIPES),
      (snapshot) => {
        if (!active) return;
        setRecipes(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        })));
        recipesLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Menu recipes load failed:", err);
        if (active) setError("The menu could not be loaded.");
        recipesLoaded = true;
        finishLoading();
      }
    );

    const unsubItems = onSnapshot(
      collection(db, ITEMS),
      (snapshot) => {
        if (!active) return;
        setItems(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        })));
        itemsLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Menu inventory load failed:", err);
        if (active) setError("Ingredient availability could not be checked.");
        itemsLoaded = true;
        finishLoading();
      }
    );

    return () => {
      active = false;
      unsubRecipes();
      unsubItems();
    };
  }, []);

  const products = useMemo(
    () =>
      recipes
        .filter(
          (recipe) =>
            recipe.recipeType === "product" &&
            recipe.archived !== true &&
            recipe.menuActive === true
        )
        .map((recipe) => {
          const availability = checkRecipeAvailability(recipe, recipes, items);

          return {
            ...recipe,
            available: availability.status === "available",
            availabilityStatus: availability.status,
            availabilityMessage: availability.message,
            maxPortions: availability.maxPortions,
            portionUnit: availability.portionUnit,
            displayCategory: String(
              recipe.menuCategory || recipe.categories?.[0] || "Other"
            ).trim(),
            displayDescription:
              recipe.menuDescription || recipe.description || "",
          };
        })
        .sort((a, b) =>
          String(a.title || "").localeCompare(String(b.title || ""))
        ),
    [recipes, items]
  );

  const categories = useMemo(
    () =>
      [...new Set(products.map((p) => p.displayCategory))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [products]
  );

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter((product) => {
      const text =
        `${product.title || ""} ${product.displayDescription} ${product.displayCategory}`.toLowerCase();

      return (
        text.includes(term) &&
        (category === "all" || product.displayCategory === category) &&
        (showUnavailable || product.available)
      );
    });
  }, [products, search, category, showUnavailable]);

  const addToCart = (product) => {
    setSuccessMessage("");
    setError("");

    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);

      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...current,
        {
          productId: product.id,
          name: product.title || "Menu item",
          unitPrice: number(product.sellingPrice),
          quantity: 1,
        },
      ];
    });
  };

  const changeQuantity = (productId, amount) => {
    setCart((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + amount }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId) => {
    setCart((current) =>
      current.filter((item) => item.productId !== productId)
    );
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const createOrder = async () => {
    if (!cart.length || submitting) return;

    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const createdAt = new Date();
      const receiptNumber = `R-${createdAt.getTime()}`;

      const order = {
        receiptNumber,
        items: cart.map((item) => ({
          productId: item.productId,
          name: item.name,
          unitPrice: number(item.unitPrice),
          quantity: item.quantity,
          lineTotal: number(item.unitPrice) * item.quantity,
        })),
        subtotal: total,
        total,
        currency: "USD",
        notes: orderNotes.trim(),
        complaint: "",
        status: "open",
        paymentStatus: "unpaid",
        source: "menu",
        createdAt,
        updatedAt: createdAt,
      };

      await addOrder(order);

      setCart([]);
      setOrderNotes("");
      setSuccessMessage(
        `Receipt ${receiptNumber} created successfully. Open Sales to manage it.`
      );
    } catch (err) {
      console.error("Could not create receipt:", err);
      setError(
        "The receipt could not be saved. Check your Firestore permissions and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="matrix-public-menu">
      <header className="matrix-public-menu-hero">
        <div className="matrix-public-menu-kicker">
          MADE FRESH · SERVED WITH CARE
        </div>
        <h1>Our Menu</h1>
        <p>
          Select items to build a receipt. Submit the order when you're ready.
        </p>

        <label className="matrix-public-menu-search">
          <FiSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
          />
        </label>
      </header>

      {error && (
        <div className="matrix-menu-alert error">
          <FiAlertCircle />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="matrix-menu-alert success">
          <FiCheckCircle />
          <span>{successMessage}</span>
        </div>
      )}

      <section className="matrix-public-menu-content">
        <div className="matrix-public-menu-toolbar">
          <div className="matrix-public-menu-categories">
            <button
              type="button"
              className={category === "all" ? "active" : ""}
              onClick={() => setCategory("all")}
            >
              All
            </button>
            {categories.map((value) => (
              <button
                type="button"
                key={value}
                className={category === value ? "active" : ""}
                onClick={() => setCategory(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <label className="matrix-public-menu-unavailable">
            <input
              type="checkbox"
              checked={showUnavailable}
              onChange={(e) => setShowUnavailable(e.target.checked)}
            />
            Show unavailable
          </label>
        </div>

        {loading ? (
          <div className="matrix-menu-empty">Loading menu…</div>
        ) : visibleProducts.length === 0 ? (
          <div className="matrix-menu-empty">
            <FiPackage />
            <h3>No menu items to show</h3>
            <p>Try another category or search term.</p>
          </div>
        ) : (
          <div className="matrix-public-menu-grid">
            {visibleProducts.map((product) => {
              const inCart = cart.find(
                (item) => item.productId === product.id
              );

              return (
                <article
                  key={product.id}
                  className={`matrix-public-menu-card ${
                    product.available ? "" : "unavailable"
                  }`}
                >
                  <div className="matrix-public-menu-card-top">
                    <span className="matrix-public-menu-category">
                      {product.displayCategory}
                    </span>
                    <span
                      className={`matrix-public-menu-availability ${
                        product.available ? "available" : "unavailable"
                      }`}
                      title={product.availabilityMessage}
                    >
                      {product.availabilityStatus === "available"
                        ? "Available"
                        : product.availabilityStatus === "unavailable"
                          ? "Out of stock"
                          : "Check availability"}
                    </span>
                  </div>

                  <div className="matrix-public-menu-card-body">
                    <h2>{product.title || "Menu item"}</h2>
                    <p>
                      {product.displayDescription || "Made with care."}
                    </p>
                  </div>

                  <div className="matrix-public-menu-stock">
                    <FiPackage />
                    <span>
                      {product.maxPortions != null
                        ? `${product.maxPortions} ${product.portionUnit} estimated`
                        : "Quantity unavailable"}
                    </span>
                  </div>

                  <div className="matrix-public-menu-card-footer">
                    <strong>{money(product.sellingPrice)}</strong>
                    <button
                      type="button"
                      className="matrix-menu-btn primary"
                      disabled={!product.available}
                      onClick={() => addToCart(product)}
                    >
                      <FiPlus /> {inCart ? `Add more (${inCart.quantity})` : "Add to receipt"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="matrix-receipt-builder" id="receipt-builder">
        <div className="matrix-receipt-builder-heading">
          <div>
            <span className="matrix-menu-eyebrow">
              <FiShoppingCart /> CURRENT ORDER
            </span>
            <h2>Build a receipt</h2>
          </div>
          <span className="matrix-menu-count">
            {cartCount} {cartCount === 1 ? "item" : "items"}
          </span>
        </div>

        {!cart.length ? (
          <div className="matrix-menu-empty">
            <FiShoppingCart />
            <h3>Your receipt is empty</h3>
            <p>Press “Add to receipt” on any available menu item.</p>
          </div>
        ) : (
          <>
            <div className="matrix-receipt-lines">
              {cart.map((item) => (
                <div className="matrix-receipt-line" key={item.productId}>
                  <div className="matrix-receipt-line-name">
                    <strong>{item.name}</strong>
                    <span>{money(item.unitPrice)} each</span>
                  </div>

                  <div className="matrix-receipt-line-controls">
                    <button
                      type="button"
                      aria-label={`Decrease ${item.name}`}
                      onClick={() => changeQuantity(item.productId, -1)}
                    >
                      <FiMinus />
                    </button>
                    <strong>{item.quantity}</strong>
                    <button
                      type="button"
                      aria-label={`Increase ${item.name}`}
                      onClick={() => changeQuantity(item.productId, 1)}
                    >
                      <FiPlus />
                    </button>
                    <button
                      type="button"
                      className="remove"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeFromCart(item.productId)}
                    >
                      <FiTrash2 />
                    </button>
                  </div>

                  <strong className="matrix-receipt-line-total">
                    {money(item.unitPrice * item.quantity)}
                  </strong>
                </div>
              ))}
            </div>

            <label className="matrix-receipt-notes">
              <span>Order note (optional)</span>
              <textarea
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Special requests or details…"
                rows={3}
              />
            </label>

            <div className="matrix-receipt-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>

            <button
              type="button"
              className="matrix-menu-btn primary matrix-receipt-submit"
              disabled={submitting || !cart.length}
              onClick={createOrder}
            >
              {submitting ? "Creating receipt…" : "Create Order / Receipt"}
            </button>
          </>
        )}
      </section>

      <footer className="matrix-public-menu-footer">
        Prices are shown in USD. Orders are saved as receipts for staff to
        manage from the Sales page.
      </footer>
    </main>
  );
}
