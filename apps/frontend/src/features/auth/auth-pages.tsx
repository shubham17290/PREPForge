"use client";
// PG-AUTH-LGN / PG-AUTH-RGN / PG-AUTH-RST — centered auth card forms (Phase 5 §4.2).
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authService } from "@/services";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/field";
import { useAuth } from "@/hooks/use-auth";

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg2 border border-line bg-surface p-6 shadow-low sm:p-8">
        <h1 className="mb-6 text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.push(next.startsWith("/") ? next : "/dashboard");
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setFormError(error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors["email"]}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors["password"]}
          autoComplete="current-password"
        />
        {formError && (
          <p role="alert" className="rounded-md2 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={loading}>Log in</Button>
      </form>
      <div className="mt-4 rounded-md2 border border-accent/40 bg-accent-soft px-3 py-2.5 text-sm">
        <p className="font-semibold text-accent-ink">Demo access</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Seed account for the demo:
          <br />
          <code className="font-mono font-medium text-accent-ink">dev-seed@gate-pyq.local</code> ·{" "}
          <code className="font-mono font-medium text-accent-ink">dev-passw0rd-1</code>
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/reset-password" className="text-muted hover:text-primary">Forgot password?</Link>
        <Link href="/register" className="font-medium text-primary">Create account</Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register, login } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError("");
    setLoading(true);
    try {
      await register({ email: email.trim(), password, full_name: fullName.trim() });
      // Auto-login right after successful registration.
      await login(email.trim(), password);
      router.push("/dashboard");
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setFormError(error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Create your free account">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Full name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={errors["full_name"]}
          hint="2–80 characters"
          autoComplete="name"
        />
        <Input
          label="Email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors["email"]}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors["password"]}
          hint="8–72 characters with at least 1 letter and 1 digit"
          autoComplete="new-password"
        />
        {formError && (
          <p role="alert" className="rounded-md2 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={loading}>Create account</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary">Log in</Link>
      </p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authService.resetPassword(email.trim());
      setSent(true);
    } catch (error_) {
      setError(error_ instanceof ApiError ? error_.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <p role="status" className="rounded-md2 bg-success-soft px-3 py-3 text-sm text-success">
          If an account exists for that email, a reset link has been generated. Check your inbox.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" loading={loading}>Send reset link</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-primary">Back to log in</Link>
      </p>
    </AuthCard>
  );
}
