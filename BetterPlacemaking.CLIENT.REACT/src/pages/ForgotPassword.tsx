import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../lib/env";
import { Button, Card, InputText, Message } from "../components/prime";

const GENERIC_MESSAGE = "If an account exists for that email, a password reset link has been sent.";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSuccessMessage("");
    setErrorMessage("");

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage("Email is required.");
      return;
    }

    setSubmitting(true);
    try {
      await fetch(`${API_BASE_URL}/api/password/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
    } catch {
      /* same message either way, as the original */
    } finally {
      setSubmitting(false);
      setSuccessMessage(GENERIC_MESSAGE);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center surface-ground p-4">
      <Card
        className="w-full max-w-md bp-auth-card"
        titleTemplate={
          <div className="text-center">
            <div className="text-2xl font-semibold text-ink">Forgot Password</div>
            <div className="mt-1 text-sm font-normal text-ink-muted">Request a reset link by email</div>
          </div>
        }
      >
        <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="forgot-email">Email</label>
            <InputText id="forgot-email" type="email" autoComplete="email" name="email" className="w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <Button type="submit" label="Send Reset Link" loading={submitting} disabled={submitting} className="w-full" />

          {successMessage && <Message severity="success" text={successMessage} />}
          {errorMessage && <Message severity="error" text={errorMessage} />}

          <div className="text-center text-sm">
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-600/80">Back to sign in</Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
