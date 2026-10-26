import { NavLink } from "react-router-dom";
import { useState } from "react";
import {
  FiCoffee,
  FiHome,
  FiPackage,
  FiTruck,
  FiShoppingCart,
  FiBookOpen,
  FiLayers,
  FiClipboard,
  FiGrid,
  FiDollarSign,
  FiTrash2,
  FiBarChart2,
  FiSettings,
  FiChevronLeft,
  FiChevronRight,
  FiPlus,
  FiMenu,
} from "react-icons/fi";


const navigation = [
  {
    title: "Workspace",
    items: [{ label: "Dashboard", path: "/", icon: FiHome }],
  },
  {
    title: "Manage café",
    items: [
      { label: "Inventory", path: "/inventory", icon: FiPackage },
      { label: "Suppliers", path: "/suppliers", icon: FiTruck },
      { label: "Purchases", path: "/purchases", icon: FiShoppingCart },
      { label: "Recipes", path: "/recipes", icon: FiBookOpen },
      { label: "Production", path: "/production", icon: FiLayers },
      { label: "Menu", path: "/menu", icon: FiGrid },
    ],
  },
  {
    title: "Business",
    items: [
      { label: "Sales", path: "/sales", icon: FiDollarSign },
      { label: "Expenses", path: "/expenses", icon: FiClipboard },
      { label: "Waste", path: "/waste", icon: FiTrash2 },
      { label: "Stock counts", path: "/stock-counts", icon: FiPackage },
      { label: "Reports", path: "/reports", icon: FiBarChart2 },
    ],
  },
];

function Navbar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="sidebar-mobile-toggle"
        onClick={() => setMobileOpen((open) => !open)}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
      >
        <FiMenu />
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={[
          "cafe-sidebar",
          collapsed ? "is-collapsed" : "",
          mobileOpen ? "is-mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <FiCoffee />
          </div>

          {!collapsed && (
            <div className="sidebar-brand-text">
              <strong>Café Manager</strong>
              <span>Management workspace</span>
            </div>
          )}
        </div>
{/* 
        <NavLink
          to="/recipes/new"
          className="sidebar-new-button"
          onClick={() => setMobileOpen(false)}
          title="Create a new recipe"
        >
          <FiPlus />
          {!collapsed && <span>New recipe</span>}
        </NavLink> */}

        <nav className="sidebar-navigation">
          {navigation.map((section) => (
            <div className="sidebar-section" key={section.title}>
              {!collapsed && (
                <p className="sidebar-section-title">{section.title}</p>
              )}

              {section.items.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `sidebar-link${isActive ? " active" : ""}`
                    }
                  >
                    <Icon className="sidebar-link-icon" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink
            to="/settings"
            title={collapsed ? "Settings" : undefined}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `sidebar-link${isActive ? " active" : ""}`
            }
          >
            <FiSettings className="sidebar-link-icon" />
            {!collapsed && <span>Settings</span>}
          </NavLink>

          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Navbar;
