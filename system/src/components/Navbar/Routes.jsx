import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../assets/firebase/config";
import NormalRoutes from "./NormalRouter";

function Routes() {
  const [user, setUser] = useState(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return <div className="page">Loading your workspace...</div>;
  }

  // Send logged-out users to login.
  if (!user && location.pathname !== "/login") {
    return <Navigate to="/login" replace />;
  }

  // Send logged-in users away from login.
  if (user && location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return <NormalRoutes />;
}

export default Routes;
