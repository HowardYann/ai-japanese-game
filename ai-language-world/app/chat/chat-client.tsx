"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listNpcIds, getNpcDisplayName } from "@/lib/npc/registry";

type Message = { role: "user" | "npc"; content: string };

type Screen =
  | { name: "select" }
  | { name: "loading" }
  | { name: "chatting"; npcId: string; eventId: string }
  | {
      name: "closed";
      npcId: string;
      eventSummary: string;
      lifeCollectionTitle: string | null;
    };

// 401统一处理：session过期/未登录，直接送回首页重新登录
function isUnauthenticated(res: Response) {
  return res.status === 401;
}

export default function ChatClient({
  initialEventId,
}: {
  initialEventId?: string | null;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(
    initialEventId ? { name: "loading" } : { name: "select" }
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 消息列表变化（新消息 / 发送中占位出现）时自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // 带着eventId进来（从/world点了"未结束的对话"）：拉取历史turns恢复现场
  useEffect(() => {
    if (!initialEventId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/event/${initialEventId}`);
        if (isUnauthenticated(res)) {
          router.push("/");
          return;
        }
        if (!res.ok) {
          if (cancelled) return;
          setErrorMsg("这场对话找不到了，可能已经不存在。");
          setScreen({ name: "select" });
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (data.closed) {
          // 理论上/world只会把未关档的事件做成链接，这里是防御性兜底
          setScreen({
            name: "closed",
            npcId: data.npcId,
            eventSummary: data.eventSummary,
            lifeCollectionTitle: data.lifeCollectionTitle ?? null,
          });
          return;
        }

        setMessages(
          data.turns.map((t: { role: "user" | "npc"; content: string }) => ({
            role: t.role,
            content: t.content,
          }))
        );
        setScreen({
          name: "chatting",
          npcId: data.npcId,
          eventId: data.eventId,
        });
      } catch {
        if (cancelled) return;
        setErrorMsg("网络出了点问题，没能恢复这场对话。");
        setScreen({ name: "select" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialEventId, router]);

  async function handleSelectNpc(npcId: string) {
    setErrorMsg("");
    try {
      const res = await fetch("/api/event/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("开始对话失败，请重试。");
        return;
      }
      const data = await res.json();
      setMessages([]);
      setScreen({ name: "chatting", npcId, eventId: data.eventId });
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
    }
  }

  async function handleSend() {
    if (screen.name !== "chatting" || !input.trim() || sending) return;
    const text = input.trim();
    const eventId = screen.eventId;

    setInput("");
    setErrorMsg("");
    setSending(true);
    // 乐观更新：先把玩家发的消息显示出来
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, message: text }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("这条消息没发出去，可以再试一次。");
        return;
      }
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "npc", content: data.reply }]);
    } catch {
      setErrorMsg("网络出了点问题，这条消息没发出去。");
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    if (screen.name !== "chatting" || closing) return;
    const { npcId, eventId } = screen;

    setClosing(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/event/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("结束对话时出了点问题，请重试。");
        return;
      }
      const data = await res.json();
      setScreen({
        name: "closed",
        npcId,
        eventSummary: data.eventSummary,
        lifeCollectionTitle: data.lifeCollectionTitle ?? null,
      });
    } catch {
      setErrorMsg("网络出了点问题，对话还没结束，可以再试一次。");
    } finally {
      setClosing(false);
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col overflow-hidden p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">💬 聊天</h1>
        <Link
          href="/world"
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
        >
          世界档案
        </Link>
      </div>

      {errorMsg && (
        <p className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {errorMsg}
        </p>
      )}

      {screen.name === "loading" && (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-neutral-500">正在恢复对话…</p>
        </div>
      )}

      {screen.name === "select" && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <p className="text-sm text-neutral-400">找谁聊聊？</p>
          {listNpcIds().map((npcId) => (
            <button
              key={npcId}
              onClick={() => handleSelectNpc(npcId)}
              className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
            >
              <span className="font-medium text-neutral-100">
                {getNpcDisplayName(npcId)}
              </span>
            </button>
          ))}
        </div>
      )}

      {screen.name === "chatting" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-neutral-400">
              正在和 {getNpcDisplayName(screen.npcId)} 聊天
            </p>
            <button
              onClick={handleClose}
              disabled={closing}
              className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 disabled:opacity-50"
            >
              {closing ? "结束中…" : "结束对话"}
            </button>
          </div>

          <div className="mb-4 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-neutral-800 p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-neutral-500">
                还没有消息，先打个招呼吧。
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[80%] rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
                      : "mr-auto max-w-[80%] rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
                  }
                >
                  {m.content}
                </div>
              ))
            )}
            {sending && (
              <div className="mr-auto max-w-[80%] rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-500">
                …
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息…"
              disabled={sending}
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
            >
              发送
            </button>
          </form>
        </div>
      )}

      {screen.name === "closed" && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
            <p className="mb-1 text-xs text-neutral-500">
              和 {getNpcDisplayName(screen.npcId)} 的这次对话
            </p>
            <p className="text-sm text-neutral-200">{screen.eventSummary}</p>
          </div>

          {screen.lifeCollectionTitle && (
            <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-4">
              <p className="mb-1 text-xs text-amber-400">🏆 新的人生收藏</p>
              <p className="text-sm font-medium text-amber-200">
                {screen.lifeCollectionTitle}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setScreen({ name: "select" })}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
            >
              开始新的对话
            </button>
            <Link
              href="/world"
              className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:text-neutral-100"
            >
              查看世界档案
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
