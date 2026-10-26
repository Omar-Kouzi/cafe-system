import { Routes, Route, Navigate } from "react-router-dom";
import Login from "../../routes/Login";
import Home from "../../routes/Home";
import Inventory from "../../routes/Inventory";
import Purchases from "../../routes/Purchases";
import Recipes from "../../routes/Recipes";
import Production from "../../routes/Production";
import Suppliers from "../../routes/Suppliers";
import PublicMenu from "../../routes/PublicMenu";
import MenuAdmin from "../../routes/MenuAdmin";
import Sales from "../../routes/Sales";
import StockCount from "../../routes/StockCount";
const pageNames = {
  inventory: "Inventory",
  suppliers: "Suppliers",
  purchases: "Purchases",
  recipes: "Recipes",
  production: "Production",
  menu: "Menu",
  sales: "Sales",
  expenses: "Expenses",
  waste: "Waste Records",
  "stock-counts": "Stock Counts",
  reports: "Reports",
  settings: "Settings",
  backup: "Backup and Restore",
};

function PlaceholderPage({ title }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p>This page is ready to be implemented.</p>
    </section>
  );
}

function NormalRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route path="/purchases" element={<Purchases />} />

      <Route path="/inventory" element={<Inventory />} />
      <Route path="/recipes" element={<Recipes />} />
      <Route path="/production" element={<Production />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/menu" element={<PublicMenu />} />
      <Route path="/menu-admin" element={<MenuAdmin />} />
      <Route path="/sales" element={<Sales />} />
      <Route path="/stock-counts" element={<StockCount />} />
      {Object.entries(pageNames).map(([path, title]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={<PlaceholderPage title={title} />}
        />
      ))}

      <Route
        path="/recipes/new"
        element={<PlaceholderPage title="New Recipe" />}
      />
      <Route
        path="/recipes/:id"
        element={<PlaceholderPage title="Recipe Details and Costing" />}
      />
      <Route
        path="/production/new"
        element={<PlaceholderPage title="Record Production" />}
      />
      <Route
        path="/sales/new"
        element={<PlaceholderPage title="Record Sale" />}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default NormalRoutes;
