import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ChatClient from "./chat-client";

// 和 app/world/page.tsx 一样的模式：服务端组件先做鉴权检查，
// 真正的交互（选NPC/发消息/结束对话）都是client组件的事。
//
// 支持从 /world 页面带着 ?eventId=xxx 跳进来，恢复一场未结束的对话
// （真正的归属权校验在 /api/event/[eventId] 里做，这里只是透传）
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { eventId } = await searchParams;

  return <ChatClient initialEventId={eventId ?? null} />;
}
