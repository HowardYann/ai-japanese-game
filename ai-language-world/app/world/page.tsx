import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "./logout-button";
import { listRelationshipsForUser } from "@/lib/db/npcRelationships";
import { listEventsForUser } from "@/lib/db/events";
import { getNpcDisplayName } from "@/lib/npc/registry";

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

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">🌏 我的世界档案</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/chat"
            className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
          >
            去聊天
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
                      {getNpcDisplayName(r.npc_id)}
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
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-neutral-200">
                      {getNpcDisplayName(e.npc_id)}
                    </span>
                    <span className="whitespace-nowrap text-xs text-neutral-500">
                      {new Date(e.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <p className="text-neutral-400">
                    {e.summary || "（这场对话还没结束/还没生成摘要）"}
                  </p>
                </li>
              ))}
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
                    {getNpcDisplayName(e.npc_id)} ·{" "}
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
