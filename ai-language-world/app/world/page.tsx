import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "./logout-button";
import { listRelationshipsForUser } from "@/lib/db/npcRelationships";
import { listEventsForUser } from "@/lib/db/events";
import { getNpcDisplayNameForUser } from "@/lib/npc/registryServer";

export default async function WorldPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // Day5-6：接入真实数据。两个查询互不依赖，并发拿。
  const [relationships, events] = await Promise.all([
    listRelationshipsForUser(user.id),
    listEventsForUser(user.id),
  ]);

  const lifeCollections = events.filter((e) => e.life_collection_title);

  // Phase 6.1：relationships/events里的npc_id现在也可能是玩家自建/涌现的动态NPC，
  // 静态registry查不到——世界档案页是服务端组件，可以放心用registryServer那套
  // 会查DB的函数（不像home-client.tsx/chat-client.tsx是客户端组件，不能碰这个）。
  // 提前把这一页会用到的npc_id去重、批量解析一次，避免同一个id重复查DB。
  const npcIds = Array.from(
    new Set([...relationships.map((r) => r.npc_id), ...events.map((e) => e.npc_id)])
  );
  const npcDisplayNameEntries = await Promise.all(
    npcIds.map(async (id) => [id, await getNpcDisplayNameForUser(id, user.id)] as const)
  );
  const npcDisplayNames = new Map(npcDisplayNameEntries);
  const displayNameFor = (npcId: string) => npcDisplayNames.get(npcId) ?? npcId;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">🌏 我的世界档案</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/home"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:text-neutral-100"
          >
            今天想做什么
          </Link>
          <LogoutButton />
        </div>
      </div>

      <p className="mb-6 text-sm text-neutral-400">已登录：{user.email}</p>

      <div className="space-y-4">
        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">
            👥 NPC 关系表
          </h2>
          {relationships.length === 0 ? (
            <p className="text-sm text-neutral-500">
              还没有认识任何人——去找瑞希或大将聊聊吧。
            </p>
          ) : (
            <ul className="space-y-3">
              {relationships.map((r) => (
                <li
                  key={r.npc_id}
                  className="rounded-md bg-neutral-900/60 p-3 text-sm"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-neutral-100">
                      {displayNameFor(r.npc_id)}
                    </span>
                    <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">
                      {r.stage}
                    </span>
                  </div>
                  <p className="text-neutral-400">
                    {r.summary || "（还没有共同经历）"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">
            🎬 事件时间线
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-neutral-500">还没有发生过任何事件。</p>
          ) : (
            <ul className="space-y-3">
              {events.map((e) => {
                const isUnfinished = !e.summary;
                const content = (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-neutral-200">
                        {displayNameFor(e.npc_id)}
                      </span>
                      <span className="whitespace-nowrap text-xs text-neutral-500">
                        {new Date(e.created_at).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <p className={isUnfinished ? "text-amber-500/80" : "text-neutral-400"}>
                      {isUnfinished ? "（对话未结束，点击继续）" : e.summary}
                    </p>
                  </>
                );
                return (
                  <li key={e.id} className="text-sm">
                    {isUnfinished ? (
                      <Link
                        href={`/chat?eventId=${e.id}`}
                        className="block rounded-md -m-2 p-2 hover:bg-neutral-900/60"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">
            🏆 人生收藏
          </h2>
          {lifeCollections.length === 0 ? (
            <p className="text-sm text-neutral-500">
              还没有值得收藏的高光时刻——它们会在对话中自然发生。
            </p>
          ) : (
            <ul className="space-y-2">
              {lifeCollections.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-sm"
                >
                  <p className="font-medium text-amber-200">
                    {e.life_collection_title}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {displayNameFor(e.npc_id)} ·{" "}
                    {new Date(e.created_at).toLocaleDateString("zh-CN")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}