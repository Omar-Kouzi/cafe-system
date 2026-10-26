import { useLocation } from "react-router-dom";
import Navbar from "./components/Navbar/Navbar";
import Routes from "./components/Navbar/Routes";

function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  return (
    <div className={isLoginPage ? "App login-layout" : "App"}>
      {!isLoginPage && <Navbar />}

      <div className={isLoginPage ? "login-routes" : "Routes"}>
        <Routes />
      </div>
    </div>
  );
}

export default App;
