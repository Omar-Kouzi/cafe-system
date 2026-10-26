
const UNIT_GROUPS = {
  g: { group: "weight", factor: 1 },
  gram: { group: "weight", factor: 1 },
  grams: { group: "weight", factor: 1 },
  kg: { group: "weight", factor: 1000 },
  kilogram: { group: "weight", factor: 1000 },
  kilograms: { group: "weight", factor: 1000 },
  mg: { group: "weight", factor: 0.001 },

  ml: { group: "volume", factor: 1 },
  milliliter: { group: "volume", factor: 1 },
  milliliters: { group: "volume", factor: 1 },
  l: { group: "volume", factor: 1000 },
  liter: { group: "volume", factor: 1000 },
  liters: { group: "volume", factor: 1000 },

  pcs: { group: "count", factor: 1 },
  pc: { group: "count", factor: 1 },
  piece: { group: "count", factor: 1 },
  pieces: { group: "count", factor: 1 },
  each: { group: "count", factor: 1 },
};

function normalizeUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

function convertQuantity(value, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  const amount = Number(value);

  if (
    !from ||
    !to ||
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(amount)
  ) {
    return null;
  }

  if (from === to) return amount;

  const a = UNIT_GROUPS[from];
  const b = UNIT_GROUPS[to];

  if (!a || !b || a.group !== b.group) return null;

  return (amount * a.factor) / b.factor;
}

function ingredientAmount(ingredient) {
  const value = ingredient.amount ?? ingredient.quantity;

  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getPackageContents(item) {
  const amount = Number(
    item.packageContentsAmount ??
      item.packageContains ??
      item.packageSize ??
      item.packageQuantity
  );

  const unit = normalizeUnit(
    item.packageContentsUnit ??
      item.contentsUnit ??
      item.packageContentsUnit
  );

  if (!Number.isFinite(amount) || amount <= 0 || !unit) {
    return null;
  }

  return { amount, unit };
}

function convertIngredientToInventoryUnits(amount, recipeUnit, item) {
  const inventoryUnit = normalizeUnit(item.unit);

  if (!inventoryUnit) return null;

  const direct = convertQuantity(amount, recipeUnit, inventoryUnit);

  if (direct !== null) return direct;

  const packageContents = getPackageContents(item);

  if (!packageContents) return null;

  const amountInContentsUnit = convertQuantity(
    amount,
    recipeUnit,
    packageContents.unit
  );

  if (amountInContentsUnit === null) return null;

  // Example: 14 g / 28 g per can = 0.5 cans.
  return amountInContentsUnit / packageContents.amount;
}

/**
 * Returns the inventory requirements for one full recipe batch.
 * Component recipes are expanded into their underlying ingredients.
 */
function getRecipeRequirements(recipe, recipes, items) {
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const requirements = new Map();

  let error = "";

  function addIngredients(currentRecipe, multiplier, visited = new Set()) {
    if (!currentRecipe) {
      error = "A required component recipe could not be found.";
      return;
    }

    if (visited.has(currentRecipe.id)) {
      error = "A circular component-recipe reference was found.";
      return;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(currentRecipe.id);

    if (
      !Array.isArray(currentRecipe.ingredients) ||
      currentRecipe.ingredients.length === 0
    ) {
      error = `Recipe "${currentRecipe.title || "Untitled"}" has no ingredients to check.`;
      return;
    }

    for (const ingredient of currentRecipe.ingredients) {
      const amount = ingredientAmount(ingredient);
      const unit = ingredient.unit || ingredient.inventoryUnit;

      if (amount === null || !unit) {
        error = `An ingredient in "${currentRecipe.title || "recipe"}" has a missing quantity or unit.`;
        continue;
      }

      const requiredAmount = amount * multiplier;
      const type = String(ingredient.ingredientType || "inventory").toLowerCase();

      if (type === "recipe" || ingredient.recipeId) {
        const component = recipeById.get(ingredient.recipeId);

        const yieldAmount = Number(
          ingredient.componentYieldAmount ?? component?.yieldAmount
        );

        const yieldUnit =
          ingredient.componentYieldUnit ?? component?.yieldUnit;

        if (
          !component ||
          !Number.isFinite(yieldAmount) ||
          yieldAmount <= 0 ||
          !yieldUnit
        ) {
          error = `Component recipe "${ingredient.name || component?.title || "unknown"}" has no valid yield amount or unit.`;
          continue;
        }

        const amountInYieldUnit = convertQuantity(
          requiredAmount,
          unit,
          yieldUnit
        );

        if (amountInYieldUnit === null) {
          error = `The unit for component "${ingredient.name || component.title}" cannot be matched to its recipe yield (${unit} to ${yieldUnit}).`;
          continue;
        }

        addIngredients(
          component,
          amountInYieldUnit / yieldAmount,
          nextVisited
        );

        continue;
      }

      const itemId = ingredient.itemId || ingredient.inventoryItemId;
      const item = itemId ? itemById.get(itemId) : null;

      if (!item) {
        error = `Ingredient "${ingredient.name || "unnamed ingredient"}" is not linked to an inventory item.`;
        continue;
      }

      const inventoryUnit = item.unit || ingredient.inventoryUnit;

      const converted = convertIngredientToInventoryUnits(
        requiredAmount,
        unit,
        { ...item, unit: inventoryUnit }
      );

      if (converted === null) {
        error = `The units for "${ingredient.name || item.name || "ingredient"}" cannot be converted (${unit} to ${inventoryUnit || "unknown"}). Check the inventory item's package contents and contents unit.`;
        continue;
      }

      const key = `${itemId}::${normalizeUnit(inventoryUnit)}`;
      const existing = requirements.get(key);

      requirements.set(key, {
        item,
        unit: inventoryUnit,
        required: (existing?.required || 0) + converted,
      });
    }
  }

  addIngredients(recipe, 1);

  return {
    requirements: [...requirements.values()],
    error,
  };
}

/**
 * Checks stock for one recipe batch and calculates maximum portions.
 *
 * yieldAmount should represent the number of portions produced by one
 * complete recipe batch. For example, yieldAmount: 12, yieldUnit: "pieces".
 *
 * If the recipe does not specify a valid yield, the result is reported
 * in complete batches instead of guessing the number of portions.
 */
export function checkRecipeAvailability(recipe, recipes = [], items = []) {
  const { requirements, error } = getRecipeRequirements(
    recipe,
    recipes,
    items
  );

  if (error) {
    return {
      status: "unknown",
      message: error,
      maxPortions: null,
      maxBatches: null,
      portionUnit: "portions",
    };
  }

  if (requirements.length === 0) {
    return {
      status: "unknown",
      message: "No inventory ingredients could be checked.",
      maxPortions: null,
      maxBatches: null,
      portionUnit: "portions",
    };
  }

  let maxBatches = Infinity;
  let limitingItem = null;

  for (const { item, unit, required } of requirements) {
    const available = Number(item.quantity);

    if (
      item.quantity === null ||
      item.quantity === undefined ||
      item.quantity === "" ||
      !Number.isFinite(available) ||
      available < 0
    ) {
      return {
        status: "unknown",
        message: `Stock quantity for "${item.name || "an ingredient"}" is missing or invalid.`,
        maxPortions: null,
        maxBatches: null,
        portionUnit: "portions",
      };
    }

    // A zero-quantity ingredient makes the recipe unavailable.
    if (required > 0) {
      const possibleBatches = available / required;

      if (possibleBatches < maxBatches) {
        maxBatches = possibleBatches;
        limitingItem = item.name || "an ingredient";
      }
    }
  }

  // Recipes made entirely from zero-quantity requirements are unusual;
  // don't display an infinite quantity.
  if (!Number.isFinite(maxBatches)) {
    return {
      status: "unknown",
      message: "A maximum quantity could not be calculated from the recipe.",
      maxPortions: null,
      maxBatches: null,
      portionUnit: "portions",
    };
  }

  // Tiny floating-point errors should not reduce a whole batch.
  const safeBatches = Math.max(0, maxBatches);

  const yieldAmount = Number(recipe.yieldAmount);
  const yieldUnit = String(recipe.yieldUnit || "").trim();

  const hasPortionYield =
    Number.isFinite(yieldAmount) &&
    yieldAmount > 0 &&
    Boolean(yieldUnit);

  const maxPortions = hasPortionYield
    ? Math.floor(safeBatches * yieldAmount + 1e-9)
    : Math.floor(safeBatches + 1e-9);

  const portionUnit = hasPortionYield
    ? yieldUnit
    : "batches";

  const status = maxPortions > 0 ? "available" : "unavailable";

  return {
    status,
    message:
      maxPortions > 0
        ? `Up to ${maxPortions} ${portionUnit} can be prepared with current stock.`
        : `Not enough ingredients to prepare a complete ${hasPortionYield ? "portion" : "batch"}.`,
    maxPortions,
    maxBatches: safeBatches,
    portionUnit,
    limitingItem,
  };
}
