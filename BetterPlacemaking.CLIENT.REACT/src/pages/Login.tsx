import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { sanitizeReturnUrl } from "../routes/sanitizeReturnUrl";
import { Button, Card, InputText, Password, useToast } from "../components/prime";
import { toggleDarkMode, useIsDark } from "../theme/themeService";

// Angular's Validators.email pattern.
const EMAIL_RE =
  /^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function Login() {
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const isDark = useIsDark();
  const [searchParams] = useSearchParams();
  const returnUrl = sanitizeReturnUrl(searchParams.get("returnUrl"));

  const [isSignup, setIsSignup] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (...names: string[]) => setTouched((t) => ({ ...t, ...Object.fromEntries(names.map((n) => [n, true])) }));

  useEffect(() => {
    if (isAuthenticated) navigate(returnUrl ?? "/projects", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const emailInvalid = !email || !EMAIL_RE.test(email);
  const passwordInvalid = !password;

  function showError(detail: string) {
    toast.add({ severity: "error", summary: "Error", detail, life: 6000 });
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (emailInvalid || passwordInvalid) {
      touch("login-email", "login-password");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await login(email, password);
      if (!resp.Success) return;
      navigate(returnUrl ?? "/projects", { replace: true });
    } catch {
      showError("Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSignup(e: FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName || emailInvalid || passwordInvalid) {
      touch("signup-email", "signup-password");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await register(firstName, lastName, email, password);
      if (!resp.Success) {
        showError("Signup failed");
        return;
      }
      setIsSignup(false);
    } catch {
      showError("Signup failed");
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
            <div className="text-2xl font-semibold text-ink">Better Placemaking</div>
            <div className="mt-1 text-sm font-normal text-ink-muted">{isSignup ? "Create an account" : "Sign in"}</div>
          </div>
        }
      >
        {!isSignup ? (
          <form noValidate onSubmit={submitLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="login-email">Email</label>
              <InputText
                id="login-email"
                type="email"
                autoComplete="email"
                className="w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => touch("login-email")}
              />
              {touched["login-email"] && emailInvalid && <div className="text-xs text-red-600">Enter a valid email.</div>}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="login-password">Password</label>
              <Password
                inputId="login-password"
                value={password}
                onChange={setPassword}
                onBlur={() => touch("login-password")}
                feedback={false}
                toggleMask
                className="w-full"
                inputStyleClass="w-full"
              />
              {touched["login-password"] && passwordInvalid && <div className="text-xs text-red-600">Password is required.</div>}
            </div>

            <Button type="submit" label="Sign in" loading={submitting} disabled={submitting} className="w-full" />

            <div className="text-center text-sm">
              <button type="button" className="font-medium text-brand-600 hover:text-brand-600/80" onClick={() => setIsSignup(true)}>Create an account</button>
            </div>
          </form>
        ) : (
          <form noValidate onSubmit={submitSignup} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="signup-first">First name</label>
                <InputText id="signup-first" type="text" className="w-full" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="signup-last">Last name</label>
                <InputText id="signup-last" type="text" className="w-full" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="signup-email">Email</label>
              <InputText
                id="signup-email"
                type="email"
                autoComplete="email"
                className="w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => touch("signup-email")}
              />
              {touched["signup-email"] && emailInvalid && <div className="text-xs text-red-600">Enter a valid email.</div>}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="signup-password">Password</label>
              <Password inputId="signup-password" value={password} onChange={setPassword} feedback={false} toggleMask className="w-full" inputStyleClass="w-full" />
            </div>

            <Button type="submit" label="Create account" loading={submitting} disabled={submitting} className="w-full" />

            <div className="text-center text-sm">
              <button type="button" className="font-medium text-brand-600 hover:text-brand-600/80" onClick={() => setIsSignup(false)}>Back to sign in</button>
            </div>
          </form>
        )}
      </Card>

      <Button
        icon={isDark ? "pi pi-sun" : "pi pi-moon"}
        rounded
        text
        severity="secondary"
        onClick={toggleDarkMode}
        hostClassName="fixed bottom-4 right-4"
      />
    </div>
  );
}
