import { useState, useCallback } from "react";
import Login from "./Login.jsx";
import StakeholderTranslator from "./StakeholderTranslator.jsx";
import { loadSession, saveSession, clearSession } from "../auth.js";

export default function App() {
  const [user, setUser] = useState(loadSession);

  const handleAuth = useCallback((u) => {
    saveSession(u);
    setUser(u);
  }, []);

  const handleSignOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  if (!user) return <Login onAuth={handleAuth} />;
  return <StakeholderTranslator user={user} onSignOut={handleSignOut} />;
}
