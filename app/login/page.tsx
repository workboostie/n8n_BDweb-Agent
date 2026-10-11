import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSessionToken, sessionMaxAge } from "@/lib/session";
import { Icon } from "@/components/Icon";

async function login(form: FormData) {
  "use server";
  const expected = process.env.DASHBOARD_PASSWORD;
  await new Promise((r) => setTimeout(r, 400));
  if (!expected || String(form.get("password") || "") !== expected) redirect("/login?error=1");
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAge,
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form action={login} className="panel w-full max-w-sm space-y-5 p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <Icon name="logo" className="size-6" />
          </span>
          <div>
            <h1 className="font-semibold">WebShop for business</h1>
            <p className="text-sm muted">Post review dashboard</p>
          </div>
        </div>
        <input type="password" name="password" placeholder="Password" autoFocus required className="input py-2.5" />
        {error && <p className="text-sm text-red-600 dark:text-red-400">Wrong password.</p>}
        <button className="btn btn-primary w-full py-2.5">Log in</button>
      </form>
    </main>
  );
}
