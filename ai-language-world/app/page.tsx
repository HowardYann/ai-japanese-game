"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 用「6位数字验证码」而不是邮件链接登录。
// 原因：Codespaces 的转发端口默认私有，邮件链接是跨域跳转，
// 会撞上 GitHub 的端口鉴权/隧道逻辑，容易失败或触发莫名下载。
// 验证码全程在同一个页面完成，没有跨域跳转，能绕开这个问题。
export default function LoginPage() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();
  const router = useRouter();

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    // 不传 emailRedirectTo，就不会触发magic link跳转，
    // 配合Supabase后台把邮件模板改成显示{{ .Token }}，发的就是6位验证码
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    setStatus("idle");
    setStep("code");
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }

    router.push("/world");
    router.refresh();
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

        {step === "email" ? (
          <form onSubmit={handleSendCode} className="space-y-3">
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
              disabled={status === "loading"}
              className="w-full rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {status === "loading" ? "发送中…" : "发送验证码"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-400">{errorMsg}</p>
            )}
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <p className="text-sm text-neutral-400">
              验证码已发到 <span className="font-medium">{email}</span>
            </p>
            <input
              type="text"
              required
              inputMode="numeric"
              placeholder="6位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tracking-widest outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              {status === "loading" ? "验证中…" : "登录"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-400">{errorMsg}</p>
            )}
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setStatus("idle");
                setErrorMsg("");
              }}
              className="w-full text-xs text-neutral-500 hover:text-neutral-300"
            >
              换个邮箱 / 重新发送
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
