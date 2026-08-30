"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventFeedback } from "@/lib/db/types";

type Message = {
  role: "user" | "npc";
  content: string;
  // 组句辅助命中时才有：一组可点击复制的词块，渲染在这条NPC消息气泡下方
  wordChunks?: string[];
  suggestClose?: boolean;
  // Phase 7新增：Action Wheel——这场event启用了Task State时才有值，
  // 表示"当前可以采取的行动"，跟wordChunks（组句辅助）是两件独立的事，
  // 可以同时出现在同一条NPC消息下面。
  actions?: { label: string; phrase: string }[];
};

type Screen =
  | { name: "loading" }
  | { name: "chatting"; npcId: string; npcDisplayName: string; eventId: string }
  | {
      name: "closed";
      npcId: string;
      npcDisplayName: string;
      eventSummary: string;
      lifeCollectionTitle: string | null;
      feedback: EventFeedback | null;
      // Phase 6.1：只有source==='emergent'（对话中涌现出的新角色）才有值。
      // decided===false 时说明玩家还没对"留下这个人"做过明确选择，
      // 这种情况下才展示留下/不留了的按钮。
      npcSource: "created" | "emergent" | null;
      npcDecided: boolean | null;
    };

// 401统一处理：session过期/未登录，直接送回首页重新登录
function isUnauthenticated(res: Response) {
  return res.status === 401;
}


export default function ChatClient({
  initialEventId,
  resumed = false,
}: {
  initialEventId: string;
  resumed?: boolean;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // "留下这个人"/"不留了"按钮的loading态，避免重复点击
  const [decidingNpc, setDecidingNpc] = useState(false);
  // 记录刚被点击复制的词块（用消息索引+词块索引拼key），短暂显示"已复制"再恢复
  const [copiedChunkKey, setCopiedChunkKey] = useState<string | null>(null);
  // Phase 7新增：Action Wheel里刚被点击的那个行动，短暂高亮反馈用；
  // 跟copiedChunkKey分开一个state，避免两套key格式凑巧撞在一起时互相影响
  const [usedActionKey, setUsedActionKey] = useState<string | null>(null);
  // 假名标注toggle：开着的时候才去请求/api/furigana，关着完全不发请求
  const [showFurigana, setShowFurigana] = useState(false);
  // 按NPC消息原文缓存转换结果，同样的文本只转一次；toggle关了缓存也保留，
  // 下次开回来不用重新请求
  const [furiganaCache, setFuriganaCache] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  function handleInsertChunk(key: string, chunk: string) {
    const el = inputRef.current;
    if (!el) {
      setInput((prev) => prev + chunk);
      return;
    }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + chunk + input.slice(end);
    setInput(next);
    setCopiedChunkKey(key);
    setTimeout(() => setCopiedChunkKey((c) => (c === key ? null : c)), 1200);

    const pos = start + chunk.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  // Phase 7新增：Action Wheel里的行动被点击——跟词块（插入光标处）不一样，
  // 这里直接把整句建议表达替换进输入框（玩家可以直接发、可以改、也可以
  // 无视它自己重新打字），然后选中全文方便玩家立刻改写。
  function handleUseAction(key: string, phrase: string) {
    if (!phrase) return; // phrase允许是空字符串（纯粹的行动，没有具体建议表达）
    setInput(phrase);
    setUsedActionKey(key);
    setTimeout(() => setUsedActionKey((k) => (k === key ? null : k)), 1200);

    const el = inputRef.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.select();
    });
  }

  // 消息列表变化（新消息 / 发送中占位出现）时自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // toggle开着时，把还没转换过的NPC消息原文批量发去/api/furigana换取ruby HTML
  useEffect(() => {
    if (!showFurigana) return;

    const npcTexts = Array.from(
      new Set(messages.filter((m) => m.role === "npc").map((m) => m.content))
    );
    const missing = npcTexts.filter((text) => !(text in furiganaCache));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        missing.map(async (text) => {
          try {
            const res = await fetch("/api/furigana", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            });
            if (isUnauthenticated(res)) {
              router.push("/");
              return [text, null] as const;
            }
            if (!res.ok) return [text, null] as const;
            const data = await res.json();
            return [text, typeof data.html === "string" ? data.html : null] as const;
          } catch {
            return [text, null] as const;
          }
        })
      );
      if (cancelled) return;
      setFuriganaCache((prev) => {
        const next = { ...prev };
        for (const [text, html] of results) {
          if (html) next[text] = html;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [showFurigana, messages, furiganaCache, router]);

  // 带着eventId进来（从/home开完场景，或从/world点了"未结束的对话"）：
  // 拉取历史turns恢复现场。event/start已经把NPC的开场白存进turns了，
  // 所以这里拉到的消息列表天然就是"NPC先开口"的效果，不需要额外处理。
  useEffect(() => {
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
          router.push("/home");
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (data.closed) {
          // 理论上/world只会把未关档的事件做成链接，这里是防御性兜底
          setScreen({
            name: "closed",
            npcId: data.npcId,
            npcDisplayName: data.npcDisplayName ?? data.npcId,
            eventSummary: data.eventSummary,
            lifeCollectionTitle: data.lifeCollectionTitle ?? null,
            feedback: data.feedback ?? null,
            npcSource: data.npcSource ?? null,
            npcDecided: data.npcDecided ?? null,
          });
          return;
        }

        setMessages(
          (() => {
            const turnMessages: Message[] = data.turns.map(
              (t: { role: "user" | "npc"; content: string }) => ({
                role: t.role,
                content: t.content,
              })
            );
            // Phase 7：latestActions只对应"最近一条NPC消息"，挂在turns数组
            // 最后一项上——如果最后一条恰好是NPC消息的话（正常情况下续聊时
            // 应该总是这样，因为对话总是以NPC回应结束）
            const lastIdx = turnMessages.length - 1;
            if (data.latestActions && lastIdx >= 0 && turnMessages[lastIdx].role === "npc") {
              turnMessages[lastIdx] = { ...turnMessages[lastIdx], actions: data.latestActions };
            }
            return turnMessages;
          })()
        );
        setScreen({
          name: "chatting",
          npcId: data.npcId,
          npcDisplayName: data.npcDisplayName ?? data.npcId,
          eventId: data.eventId,
        });
      } catch {
        if (cancelled) return;
        setErrorMsg("网络出了点问题，没能恢复这场对话。");
        router.push("/home");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialEventId, router]);

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
      setMessages((prev) => [
        ...prev,
        {
          role: "npc",
          content: data.reply,
          wordChunks: data.wordChunks ?? undefined,
          suggestClose: data.suggestClose,
          actions: data.actions ?? undefined,
        },
      ]);
    } catch {
      setErrorMsg("网络出了点问题，这条消息没发出去。");
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    if (screen.name !== "chatting" || closing) return;
    const { npcId, npcDisplayName } = screen;

    setClosing(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/event/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: screen.eventId }),
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
        npcDisplayName: data.npcDisplayName ?? npcDisplayName,
        eventSummary: data.eventSummary,
        lifeCollectionTitle: data.lifeCollectionTitle ?? null,
        feedback: data.feedback ?? null,
        npcSource: data.npcSource ?? null,
        npcDecided: data.npcDecided ?? null,
      });
    } catch {
      setErrorMsg("网络出了点问题，对话还没结束，可以再试一次。");
    } finally {
      setClosing(false);
    }
  }

  // Phase 6.1：涌现出的新角色，聊完之后玩家要么"留下"（进入自己的人物列表，
  // 以后能在/home浏览场景里选到TA），要么"不留了"（status变成discarded，
  // 不再出现在任何列表里，但数据不删）。不管选哪个，都要调一次这个接口——
  // "decided"字段记录的是"玩家有没有做过这个选择"本身。
  async function handleDecideNpc(status: "active" | "discarded") {
    if (screen.name !== "closed" || decidingNpc) return;
    const { npcId } = screen;

    setDecidingNpc(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/npc/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId, status }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("这个选择没保存成功，可以再试一次。");
        return;
      }
      setScreen((prev) =>
        prev.name === "closed" ? { ...prev, npcDecided: true } : prev
      );
    } catch {
      setErrorMsg("网络出了点问题，这个选择没保存成功。");
    } finally {
      setDecidingNpc(false);
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

      {screen.name === "chatting" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-neutral-400">
              正在和 {screen.npcDisplayName} 聊天
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFurigana((v) => !v)}
                className={
                  showFurigana
                    ? "rounded-md border border-neutral-500 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100"
                    : "rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
                }
              >
                かな {showFurigana ? "开" : "关"}
              </button>
              <button
                onClick={handleClose}
                disabled={closing}
                className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 disabled:opacity-50"
              >
                {closing ? "结束中…" : "结束对话"}
              </button>
            </div>
          </div>

          {resumed && (
            <p className="mb-3 text-xs text-neutral-500">
              继续你和 {screen.npcDisplayName} 之前没聊完的对话
            </p>
          )}
          
          <div className="mb-4 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-neutral-800 p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-neutral-500">
                还没有消息，先打个招呼吧。
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className="space-y-1.5">
                  <div
                    className={
                      m.role === "user"
                        ? "ml-auto max-w-[80%] rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
                        : "mr-auto max-w-[80%] rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100"
                    }
                  >
                    {m.role === "npc" && showFurigana && furiganaCache[m.content] ? (
                      // 转换结果是可信来源（我们自己的/api/furigana接口生成，
                      // 且toRubyHtml对文本做了HTML转义），dangerouslySetInnerHTML
                      // 只用来渲染<ruby>/<rt>标签，不是回显任意用户输入
                      <span
                        className="furigana-text"
                        dangerouslySetInnerHTML={{ __html: furiganaCache[m.content] }}
                      />
                    ) : (
                      m.content
                    )}
                  </div>

                  {/* Phase 7新增：Action Wheel——只在最新一条NPC消息上展示，
                      避免玩家对着已经过时的行动选项发呆（对话往前推进后，
                      旧的行动大概率已经不再适用）。 */}
                  {m.role === "npc" &&
                    i === messages.length - 1 &&
                    m.actions &&
                    m.actions.length > 0 && (
                      <div className="mr-auto max-w-[80%] rounded-md border border-neutral-800 bg-neutral-900/40 p-2.5">
                        <p className="mb-1.5 text-xs text-neutral-500">现在可以做的事</p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.actions.map((action, ai) => {
                            const key = `${i}-${ai}`;
                            const isUsed = usedActionKey === key;
                            return (
                              <button
                                key={ai}
                                type="button"
                                onClick={() => handleUseAction(key, action.phrase)}
                                title={action.phrase || undefined}
                                className={
                                  isUsed
                                    ? "rounded border border-emerald-800 bg-emerald-950/40 px-2.5 py-1.5 text-xs text-emerald-300"
                                    : "rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 hover:border-neutral-500 hover:bg-neutral-700"
                                }
                              >
                                {isUsed ? "✓ 已填入" : action.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* 组句辅助命中时才出现：接在NPC消息后面的独立提示区块，词块可点击复制 */}
                  {m.role === "npc" && m.wordChunks && m.wordChunks.length > 0 && (
                    <div className="mr-auto max-w-[80%] rounded-md border border-neutral-800 bg-neutral-900/40 p-2.5">
                      <p className="mb-1.5 text-xs text-neutral-500">
                        试着自己拼出来 · 点词块复制
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.wordChunks.map((chunk, ci) => {
                          const key = `${i}-${ci}`;
                          const isCopied = copiedChunkKey === key;
                          return (
                            <button
                              key={ci}
                              type="button"
                              onClick={() => handleInsertChunk(key, chunk)}
                              className={
                                isCopied
                                  ? "rounded border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300"
                                  : "rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:border-neutral-500 hover:bg-neutral-700"
                              }
                            >
                              {isCopied ? "✓ 已复制" : chunk}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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

        {messages.length > 0 &&
          messages[messages.length - 1].role === "npc" &&
          messages[messages.length - 1].suggestClose && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
              <span>这次的事看起来已经聊定了，要不要在这里先告一段落？</span>
              <button
                onClick={handleClose}
                className="ml-3 shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-neutral-200 hover:border-neutral-500"
              >
                结束对话
              </button>
            </div>
          )}
          
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
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
              和 {screen.npcDisplayName} 的这次对话
            </p>
            <p className="text-sm text-neutral-200">{screen.eventSummary}</p>
          </div>

          {screen.npcSource === "emergent" && screen.npcDecided === false && (
            <div className="rounded-md border border-neutral-700 bg-neutral-900/40 p-4">
              <p className="mb-3 text-sm text-neutral-200">
                要把 {screen.npcDisplayName} 留下，变成你认识的人吗？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDecideNpc("active")}
                  disabled={decidingNpc}
                  className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
                >
                  留下这个人
                </button>
                <button
                  onClick={() => handleDecideNpc("discarded")}
                  disabled={decidingNpc}
                  className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100 disabled:opacity-50"
                >
                  不留了
                </button>
              </div>
            </div>
          )}

          {screen.npcSource === "emergent" && screen.npcDecided === true && (
            <p className="text-xs text-neutral-500">
              已经记下你的选择了。
            </p>
          )}

          {screen.feedback && screen.feedback.achievements.length > 0 && (
            <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 p-4">
              <p className="mb-2 text-xs font-medium text-emerald-400">
                刚才你做到了什么？
              </p>
              <ul className="space-y-1">
                {screen.feedback.achievements.map((a, i) => (
                  <li key={i} className="text-sm text-emerald-200/90">
                    ✓ {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {screen.feedback && screen.feedback.struggles.length > 0 && (
            <div className="rounded-md border border-amber-900/40 bg-amber-950/10 p-4">
              <p className="mb-2 text-xs font-medium text-amber-500">
                你在哪里遇到了困难？
              </p>
              <ul className="space-y-1">
                {screen.feedback.struggles.map((s, i) => (
                  <li key={i} className="text-sm text-amber-200/80">
                    △ {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {screen.feedback && screen.feedback.nextStepSuggestion && (
            <div className="rounded-md border border-neutral-700 bg-neutral-900/40 p-4">
              <p className="mb-1 text-xs text-neutral-500">下一步建议</p>
              <p className="text-sm text-neutral-200">
                {screen.feedback.nextStepSuggestion}
              </p>
            </div>
          )}

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
              onClick={() => router.push("/home")}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
            >
              开始新的体验
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