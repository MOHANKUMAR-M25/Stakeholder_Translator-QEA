import { useState, useEffect, useRef, useCallback } from "react";
import {
  GOOGLE_CLIENT_ID,
  isValidEmail,
  decodeJwt,
  loadGoogleIdentity,
} from "../auth.js";
import "./Login.css";

export default function Login({ onAuth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [googleError, setGoogleError] = useState("");
  const googleBtnRef = useRef(null);

  const handleGoogleCredential = useCallback(
    (response) => {
      const claims = decodeJwt(response.credential);
      if (!claims?.email) {
        setGoogleError("Could not read your Google account. Try again.");
        return;
      }
      onAuth({
        email: claims.email,
        name: claims.name || claims.email.split("@")[0],
        picture: claims.picture || "",
        provider: "google",
      });
    },
    [onAuth]
  );

  
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !googleBtnRef.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        });
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          width: 320,
        });
      })
      .catch((e) => setGoogleError(e.message));
    return () => {
      cancelled = true;
    };
  }, [handleGoogleCredential]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    onAuth({
      email,
      name: email.split("@")[0],
      picture: "",
      provider: "password",
    });
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <span className="auth__logo-frame">
          <img className="auth__logo" src="/logo.png" alt="" width="56" height="56" />
        </span>
        <h1 className="auth__title">Stakeholder Translator (QEA)</h1>
        <p className="auth__sub">Sign in to turn test reports into stakeholder-ready narratives.</p>

        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {error && <p className="status status--bad auth__error">{error}</p>}

          <button className="btn btn--primary btn--block" type="submit">
            Sign in
          </button>
        </form>

        <div className="auth__divider">
          <span>or</span>
        </div>

        {GOOGLE_CLIENT_ID ? (
          <div className="auth__google" ref={googleBtnRef} />
        ) : (
          <button
            className="btn btn--ghost btn--block btn--google"
            type="button"
            onClick={() =>
              setGoogleError(
                "Google sign-in needs a client ID. Set VITE_GOOGLE_CLIENT_ID in a .env file (see .env.example)."
              )
            }
          >
            <GoogleGlyph />
            Continue with Google
          </button>
        )}

        {googleError && <p className="status status--warn auth__error">{googleError}</p>}

        <p className="auth__foot">
          Prototype sign-in: this front-end gate is for demonstration. In production, credentials
          would be verified by a backend and Google OAuth would use your organisation's client ID.
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
