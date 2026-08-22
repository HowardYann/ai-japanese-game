// app/api/event/[eventId]/route.ts
//
// 支持"继续未结束的对话"：/world页面点进一个summary为空的事件时，
// 前端需要先拿到这场事件属于哪个NPC、以及已经聊过的turns，
// 才能把chat界面恢复到离开时的状态。
//
// 只读接口，不修改任何数据。归属权校验和其它路由一致。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getOwnedEvent, getTurnsForEvent } from "../../../../lib/db/events";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { eventId } = await params;

  try {
    // 归属权校验：不是自己的事件、或者事件不存在，统一400，不泄露"这个id存不存在"
    const event = await getOwnedEvent(eventId, userId);
    const turns = await getTurnsForEvent(eventId, userId);

    return NextResponse.json({
      eventId: event.id,
      npcId: event.npc_id,
      closed: !!event.summary,
      eventSummary: event.summary,
      lifeCollectionTitle: event.life_collection_title,
      feedback: event.feedback,
      turns: turns.map((t) => ({ role: t.role, content: t.content })),
    });
  } catch {
    return NextResponse.json({ error: "Event not found" }, { status: 400 });
  }
}
