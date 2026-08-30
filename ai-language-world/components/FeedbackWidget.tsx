"use client";

// components/FeedbackWidget.tsx
//
// 挂在 app/layout.tsx 里，所以每个页面右下角都会出现这个"提建议"入口。
// 提交只是POST到 /api/feedback/create，不在客户端直连Supabase——
// 跟其它写操作一样，DB访问统一走服务端路由（安全非负项第2条）。

import { useState } from "react";
import { usePathname } from "next/navigation";

type Status = "idle" | "sending" | "sent" | "error";

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  function reset() {
    setOpen(false);
    setContent("");
    setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || status === "sending") return;

    setStatus("sending");
    try {
      const res = await fetch("/api/feedback/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, pagePath: pathname }),
      });
      if (!res.ok) throw new Error("submit failed");
      setStatus("sent");
      setTimeout(reset, 1500);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <form
          onSubmit={handleSubmit}
          className="w-72 space-y-2 rounded-md border border-neutral-800 bg-neutral-900 p-3 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-100">提个建议</span>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              关闭
            </button>
          </div>

          {status === "sent" ? (
            <p className="text-sm text-neutral-300">谢谢反馈，已经收到啦 🙏</p>
          ) : (
            <>
              <textarea
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="有什么想法、bug、想要的功能，都可以写在这里"
                rows={4}
                maxLength={2000}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
              {status === "error" && (
                <p className="text-xs text-red-300">提交失败，再试一次？</p>
              )}
              <button
                type="submit"
                disabled={!content.trim() || status === "sending"}
                className="w-full rounded-md bg-neutral-100 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
              >
                {status === "sending" ? "提交中..." : "提交"}
              </button>
            </>
          )}
        </form>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 shadow-lg hover:text-neutral-100"
        >
          💬 提建议
        </button>
      )}
    </div>
  );
}