"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">AI Language World</h1>
          <p className="text-sm text-neutral-400">
            一个可以安全体验另一种人生的世界
          </p>
        </div>

        {status === "sent" ? (
          <p className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
            登录链接已发到 <span className="font-medium">{email}</span>
            ，去邮箱点一下就能进入。
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="你的邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {status === "sending" ? "发送中…" : "发送登录链接"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-400">{errorMsg}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
