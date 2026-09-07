"use client";

import { FormEvent, useState } from "react";

const countries = [
  ["MW", "🇲🇼", "Malawi"],
  ["ZM", "🇿🇲", "Zambia"],
  ["ZW", "🇿🇼", "Zimbabwe"],
  ["MZ", "🇲🇿", "Mozambique"],
  ["TZ", "🇹🇿", "Tanzania"],
  ["ZA", "🇿🇦", "South Africa"],
  ["BW", "🇧🇼", "Botswana"],
  ["NA", "🇳🇦", "Namibia"],
] as const;

export default function Home() {
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          country: form.get("country"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to create your account.");
      }

      setSubmitted(true);
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Unable to create your account.");
    }
  }

  return (
    <main className="signup-shell">
      <section className="signup-panel" aria-labelledby="signup-title">
        <div className="brand-mark" aria-label="Lumticket">lumticket<span>.</span></div>
        <div className="intro">
          <p className="eyebrow">Welcome aboard</p>
          <h1 id="signup-title">Create your account</h1>
          <p>Book bus tickets, buy event tickets, and send parcels in minutes.</p>
        </div>

        <div className="social-buttons">
          <button type="button" className="social-button" disabled aria-disabled="true">
            <span className="google-mark">G</span> Sign up with Google
          </button>
          <button type="button" className="social-button" disabled aria-disabled="true">
            <span className="apple-mark">●</span> Sign up with Apple
          </button>
        </div>

        <div className="divider"><span>or with email</span></div>

        <form onSubmit={handleSubmit} className="signup-form">
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" type="text" placeholder="Enter your full name" autoComplete="name" required />

          <label htmlFor="country">Country</label>
          <select id="country" name="country" defaultValue="" required>
            <option value="" disabled>Select your country</option>
            {countries.map(([code, flag, name]) => <option value={code} key={code}>{flag} {name}</option>)}
          </select>

          <label htmlFor="email">Email or mobile number</label>
          <input id="email" name="email" type="text" placeholder="you@example.com or +265 888 123 456" autoComplete="username" required />

          <div className="password-label">
            <label htmlFor="password">Password</label>
            <span>8+ characters</span>
          </div>
          <input id="password" name="password" type="password" placeholder="Create a password" autoComplete="new-password" minLength={8} required />

          <label className="terms-row">
            <input type="checkbox" required />
            <span>I agree to the <a href="https://solid-robot-vpqr5rx5wvx42xp7j-3000.app.github.dev/legal/terms">Terms of service</a> and <a href="https://solid-robot-vpqr5rx5wvx42xp7j-3000.app.github.dev/legal/privacy">Privacy policy</a></span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          {submitted && <p className="form-success" role="status">Your account has been created.</p>}
          <button className="submit-button" type="submit">Create account <span aria-hidden="true">→</span></button>
        </form>

        <p className="login-prompt">Already have an account? <a href="https://solid-robot-vpqr5rx5wvx42xp7j-3000.app.github.dev/login">Log in</a></p>
      </section>
    </main>
  );
}
