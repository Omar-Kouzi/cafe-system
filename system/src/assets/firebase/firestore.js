import { db } from "./config";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  runTransaction,
} from "firebase/firestore";

/* =========================
   GENERIC HELPERS
========================= */

const getCollectionRef = (name) => collection(db, name);
const getDocRef = (name, id) => doc(db, name, id);

export const addDocument = async (collectionName, data) => {
  try {
    const docRef = await addDoc(getCollectionRef(collectionName), {
      ...data,
      createdAt: data.createdAt ?? serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error(`Error adding to ${collectionName}:`, error);
    throw error;
  }
};

export const getDocument = async (collectionName, docId) => {
  try {
    const snapshot = await getDoc(getDocRef(collectionName, docId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    console.error(`Error fetching from ${collectionName}:`, error);
    throw error;
  }
};

export const getAllDocuments = async (collectionName) => {
  try {
    const snapshot = await getDocs(getCollectionRef(collectionName));
    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
  } catch (error) {
    console.error(`Error fetching ${collectionName}:`, error);
    throw error;
  }
};

export const updateDocument = async (collectionName, docId, data) => {
  try {
    const ref = getDocRef(collectionName, docId);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      await updateDoc(ref, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...data,
        createdAt: data.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error(`Error updating ${collectionName}/${docId}:`, error);
    throw error;
  }
};

export const deleteDocument = async (collectionName, docId) => {
  try {
    await deleteDoc(getDocRef(collectionName, docId));
  } catch (error) {
    console.error(`Error deleting ${collectionName}/${docId}:`, error);
    throw error;
  }
};

export const setDocument = async (
  collectionName,
  docId,
  data,
  merge = false,
) => {
  try {
    await setDoc(
      getDocRef(collectionName, docId),
      {
        ...data,
        updatedAt: serverTimestamp(),
      },
      { merge },
    );
  } catch (error) {
    console.error(`Error setting ${collectionName}/${docId}:`, error);
    throw error;
  }
};

/* =========================
   REUSABLE COLLECTION CRUD
========================= */

const createCollectionHelpers = (collectionName) => ({
  add: (data) => addDocument(collectionName, data),
  get: (id) => getDocument(collectionName, id),
  getAll: () => getAllDocuments(collectionName),
  update: (id, data) => updateDocument(collectionName, id, data),
  delete: (id) => deleteDocument(collectionName, id),
  set: (id, data, merge = false) =>
    setDocument(collectionName, id, data, merge),
});

/* =========================
   USERS
========================= */

export const setUserWithId = (uid, data) => setDocument("users", uid, data);

export const addUser = (data) => addDocument("users", data);
export const getUser = (uid) => getDocument("users", uid);
export const getUsers = () => getAllDocuments("users");
export const updateUser = (uid, data) => updateDocument("users", uid, data);
export const deleteUser = (uid) => deleteDocument("users", uid);

/* =========================
   RECIPES
========================= */

export const addRecipe = (data) => addDocument("recipes", data);
export const getRecipe = (id) => getDocument("recipes", id);
export const getRecipes = () => getAllDocuments("recipes");
export const updateRecipe = (id, data) => updateDocument("recipes", id, data);
export const deleteRecipe = (id) => deleteDocument("recipes", id);

/* =========================
   RECIPE CATEGORIES
========================= */

export const addCategory = (data) => addDocument("categories", data);
export const getCategory = (id) => getDocument("categories", id);
export const getCategories = () => getAllDocuments("categories");
export const updateCategory = (id, data) =>
  updateDocument("categories", id, data);
export const deleteCategory = (id) => deleteDocument("categories", id);

/* =========================
   HOME / ABOUT SETTINGS
========================= */

export const getHomeSettings = () => getDocument("settings", "home");

export const updateHomeSettings = (data) =>
  updateDocument("settings", "home", data);

export const setHomeSettings = (data) => setDocument("settings", "home", data);

export const getAboutSettings = () => getDocument("settings", "about");

export const updateAboutSettings = (data) =>
  updateDocument("settings", "about", data);

export const setAboutSettings = (data) =>
  setDocument("settings", "about", data);

/* =========================
   INVENTORY ITEMS
========================= */

const inventoryHelpers = createCollectionHelpers("inventory");

export const addInventoryItem = inventoryHelpers.add;
export const getInventoryItem = inventoryHelpers.get;
export const getInventoryItems = inventoryHelpers.getAll;
export const updateInventoryItem = inventoryHelpers.update;
export const deleteInventoryItem = inventoryHelpers.delete;

/* =========================
   INVENTORY STOCK MOVEMENTS
========================= */

// Each movement stores the change in stock and the reason.
export const getInventoryMovements = async (itemId = null) => {
  const movements = await getAllDocuments("inventoryMovements");

  return movements
    .filter((movement) => !itemId || movement.itemId === itemId)
    .sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() ?? 0;
      const dateB = b.createdAt?.toMillis?.() ?? 0;
      return dateB - dateA;
    });
};

/**
 * Change inventory stock safely using a Firestore transaction.
 *
 * quantityChange:
 *   Positive number = stock received
 *   Negative number = stock used, wasted, or removed
 *
 * The item must already exist.
 */
export const adjustInventoryStock = async (
  itemId,
  quantityChange,
  reason = "Manual adjustment",
) => {
  if (!itemId) throw new Error("An inventory item ID is required.");

  if (
    typeof quantityChange !== "number" ||
    !Number.isFinite(quantityChange) ||
    quantityChange === 0
  ) {
    throw new Error("Stock change must be a non-zero number.");
  }

  const itemRef = getDocRef("inventory", itemId);
  const movementRef = doc(collection(db, "inventoryMovements"));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef);

    if (!snapshot.exists()) {
      throw new Error("Inventory item not found.");
    }

    const item = snapshot.data();
    const previousQuantity = Number(item.quantity ?? 0);
    const newQuantity = previousQuantity + quantityChange;

    if (newQuantity < 0) {
      throw new Error("Stock cannot be less than zero.");
    }

    transaction.update(itemRef, {
      quantity: newQuantity,
      updatedAt: serverTimestamp(),
    });

    transaction.set(movementRef, {
      itemId,
      itemName: item.name ?? "Unnamed item",
      type: quantityChange > 0 ? "stock-in" : "stock-out",
      quantityChange,
      previousQuantity,
      newQuantity,
      reason,
      createdAt: serverTimestamp(),
    });

    return {
      movementId: movementRef.id,
      previousQuantity,
      newQuantity,
    };
  });
};

/* =========================
   INVENTORY CATEGORIES
   Separate from recipe categories.
========================= */

const inventoryCategoryHelpers = createCollectionHelpers("inventoryCategories");

export const addInventoryCategory = inventoryCategoryHelpers.add;
export const getInventoryCategory = inventoryCategoryHelpers.get;
export const getInventoryCategories = inventoryCategoryHelpers.getAll;
export const updateInventoryCategory = inventoryCategoryHelpers.update;
export const deleteInventoryCategory = inventoryCategoryHelpers.delete;

/* =========================
   SUPPLIERS
========================= */

const supplierHelpers = createCollectionHelpers("suppliers");

export const addSupplier = supplierHelpers.add;
export const getSupplier = supplierHelpers.get;
export const getSuppliers = supplierHelpers.getAll;
export const updateSupplier = supplierHelpers.update;
export const deleteSupplier = supplierHelpers.delete;

/* =========================
   PURCHASES / STOCK RECEIVING
========================= */

const purchaseHelpers = createCollectionHelpers("purchases");

export const addPurchase = purchaseHelpers.add;
export const getPurchase = purchaseHelpers.get;
export const getPurchases = purchaseHelpers.getAll;
export const updatePurchase = purchaseHelpers.update;
export const deletePurchase = purchaseHelpers.delete;

/* =========================
   EXPENSES
========================= */

const expenseHelpers = createCollectionHelpers("expenses");

export const addExpense = expenseHelpers.add;
export const getExpense = expenseHelpers.get;
export const getExpenses = expenseHelpers.getAll;
export const updateExpense = expenseHelpers.update;
export const deleteExpense = expenseHelpers.delete;

/* =========================
   SALES
========================= */

const saleHelpers = createCollectionHelpers("sales");

export const addSale = saleHelpers.add;
export const getSale = saleHelpers.get;
export const getSales = saleHelpers.getAll;
export const updateSale = saleHelpers.update;
export const deleteSale = saleHelpers.delete;

/* =========================
   ORDERS
========================= */

const orderHelpers = createCollectionHelpers("orders");

export const addOrder = orderHelpers.add;
export const getOrder = orderHelpers.get;
export const getOrders = orderHelpers.getAll;
export const updateOrder = orderHelpers.update;
export const deleteOrder = orderHelpers.delete;

/* =========================
   CUSTOMERS
========================= */

const customerHelpers = createCollectionHelpers("customers");

export const addCustomer = customerHelpers.add;
export const getCustomer = customerHelpers.get;
export const getCustomers = customerHelpers.getAll;
export const updateCustomer = customerHelpers.update;
export const deleteCustomer = customerHelpers.delete;

/* =========================
   STAFF
========================= */

const staffHelpers = createCollectionHelpers("staff");

export const addStaffMember = staffHelpers.add;
export const getStaffMember = staffHelpers.get;
export const getStaffMembers = staffHelpers.getAll;
export const updateStaffMember = staffHelpers.update;
export const deleteStaffMember = staffHelpers.delete;

/* =========================
   REPORTS / SNAPSHOTS
========================= */

const reportHelpers = createCollectionHelpers("reports");

export const addReport = reportHelpers.add;
export const getReport = reportHelpers.get;
export const getReports = reportHelpers.getAll;
export const updateReport = reportHelpers.update;
export const deleteReport = reportHelpers.delete;
