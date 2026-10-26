import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { FiCoffee, FiLock, FiMail, FiEye, FiEyeOff } from "react-icons/fi";

import { auth } from "../assets/firebase/config";
import { login } from "../assets/firebase/auth";


function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState(auth.currentUser);
  const [error, setError] = useState("");

  // Listen for changes in Firebase authentication.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setCheckingAuth(false);
    });

    return unsubscribe;
  }, []);

  // Show a loading message while Firebase checks the session.
  if (checkingAuth) {
    return <div className="login-loading">Loading your workspace...</div>;
  }

  // Redirect authenticated users to the dashboard.
  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    try {
      await login(email.trim(), password);

      // The authentication listener updates the user
      // and redirects to the dashboard automatically.
    } catch (err) {
      console.error("Login failed:", err.code, err.message);

      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/user-not-found"
      ) {
        setError("Incorrect email or password.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (err.code === "auth/network-request-failed") {
        setError("Network error. Please check your internet connection.");
      } else if (err.code === "auth/operation-not-allowed") {
        setError(
          "Email and password login is not enabled in Firebase Authentication.",
        );
      } else {
        setError(
          "Unable to sign in. Please check your credentials and try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-brand-icon">
            <FiCoffee />
          </div>

          <span>CAFÉ MANAGER</span>
        </div>

        <div className="login-heading">
          <p className="login-eyebrow">YOUR WORKSPACE</p>
          <h1>Welcome back.</h1>
          <p>Sign in to manage your café.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-email">Email address</label>

            <div className="login-input-wrap">
              <FiMail className="login-input-icon" />

              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>

            <div className="login-input-wrap">
              <FiLock className="login-input-icon" />

              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />

              <button
                className="login-password-toggle"
                type="button"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                disabled={loading}
              >
                {showPassword ? <FiEyeOff /> : <FiEye />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in to your workspace"}
          </button>
        </form>

        <div className="login-footer">
          <span className="login-status-dot" />
          Private workspace · Authorized access only
        </div>
      </section>

      <aside className="login-visual">
        <div className="login-visual-overlay" />

        <div className="login-visual-content">
          <span className="login-visual-tag">YOUR BUSINESS, ORGANIZED</span>

          <h2>
            Every detail
            <br />
            <em>under control.</em>
          </h2>

          <p>
            Track ingredients, calculate recipe costs, manage production, and
            keep your café running smoothly.
          </p>

          <div className="login-visual-line" />

          <span className="login-visual-caption">
            INGREDIENTS · RECIPES · PRODUCTION · COSTS
          </span>
        </div>
      </aside>
    </main>
  );
}

export default Login;
