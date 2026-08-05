import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LogoutButton from "./logout-button";

export default async function WorldPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">🌏 我的世界档案</h1>
        <LogoutButton />
      </div>

      <p className="mb-6 text-sm text-neutral-400">
        已登录：{user.email}
      </p>

      {/* Day 1-2 占位：先证明鉴权+路由链路通了。
          之后接 npc_relationships / events 表，在这里渲染 NPC关系表 + 事件时间线 + 人生收藏 */}
      <div className="space-y-4">
        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-1 text-sm font-medium text-neutral-300">
            👥 NPC 关系表
          </h2>
          <p className="text-sm text-neutral-500">（待接入 npc_relationships 表）</p>
        </section>

        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-1 text-sm font-medium text-neutral-300">
            🎬 事件时间线
          </h2>
          <p className="text-sm text-neutral-500">（待接入 events 表）</p>
        </section>

        <section className="rounded-md border border-neutral-800 p-4">
          <h2 className="mb-1 text-sm font-medium text-neutral-300">
            🏆 人生收藏
          </h2>
          <p className="text-sm text-neutral-500">
            （待接入 events.life_collection_title）
          </p>
        </section>
      </div>
    </main>
  );
}
