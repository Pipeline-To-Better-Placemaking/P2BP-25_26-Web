import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../lib/env";
import { Button, Card, Message, Password } from "../components/prime";

/**
 * The original Angular app has no reset page; this is what the server's reset email links to.
 * Styled after the original forgot-password page (same card/layout/components).
 */
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");

    if (!token) {
      setErrorMessage("This reset link is missing its token. Request a new one.");
      return;
    }
    if (!newPassword) {
      setErrorMessage("Password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/password/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const text = await res.text();
      if (!res.ok) {
        setErrorMessage(text || "Invalid or expired token");
        return;
      }
      setSuccess(true);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center surface-ground p-4">
      <Card
        className="w-full max-w-md bp-auth-card"
        titleTemplate={
          <div className="text-center">
            <div className="text-2xl font-semibold text-ink">Reset Password</div>
            <div className="mt-1 text-sm font-normal text-ink-muted">Choose a new password</div>
          </div>
        }
      >
        <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
          {!success && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="reset-password">New password</label>
                <Password inputId="reset-password" value={newPassword} onChange={setNewPassword} feedback={false} toggleMask className="w-full" inputStyleClass="w-full" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="reset-confirm">Confirm new password</label>
                <Password inputId="reset-confirm" value={confirmPassword} onChange={setConfirmPassword} feedback={false} toggleMask className="w-full" inputStyleClass="w-full" />
              </div>
              <Button type="submit" label="Update Password" loading={submitting} disabled={submitting} className="w-full" />
            </>
          )}

          {success && <Message severity="success" text="Your password has been updated." />}
          {errorMessage && <Message severity="error" text={errorMessage} />}

          <div className="text-center text-sm">
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-600/80">Back to sign in</Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
