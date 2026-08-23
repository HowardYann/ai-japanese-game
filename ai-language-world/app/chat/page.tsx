import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ChatClient from "./chat-client";

// 和 app/world/page.tsx 一样的模式：服务端组件先做鉴权检查，
// 真正的交互（发消息/结束对话）都是client组件的事。
//
// Phase 4改动：/chat 不再承担"选NPC开始新对话"的入口职责，
// 这个职责统一挪到 /home（今天想做什么）。/chat 现在只服务于
// 带着 ?eventId=xxx 进来的场景——要么是 /home 开完场景之后跳转过来，
// 要么是从 /world 点"未完成的对话"续聊。没带eventId直接打开/chat，
// 说明走错了入口，直接送去/home，避免两条选NPC的路径同时存在。
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; resumed?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { eventId, resumed } = await searchParams;

  if (!eventId) {
    redirect("/home");
  }
  return <ChatClient initialEventId={eventId} resumed={resumed === "1"} />;
  
}
