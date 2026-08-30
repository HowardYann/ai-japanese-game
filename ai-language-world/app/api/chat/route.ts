// app/api/chat/route.ts
//
// 核心链路：
// 玩家发消息 -> 拿到 event归属校验 + relationship + 最近turns
//           -> buildChatContext 白名单组装 prompt
//           -> callClaude 只吃文本不吃tool
//           -> 把 user消息 和 NPC回应 都存进 conversation_turns
//           -> 把NPC回应返回前端

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../lib/supabase/requireUserId";
import { getNpcConfigForUser } from "../../../lib/npc/registryServer";
import { getOrCreateRelationship } from "../../../lib/db/npcRelationships";
import { getTurnsForEvent, appendTurn, getOwnedEvent, updateTaskProgress } from "../../../lib/db/events";
import { buildChatContext } from "../../../lib/context/buildContext";
import { callClaude } from "../../../lib/claude/client";
import { extractWordChunks } from "../../../lib/chat/extractWordChunks";
import { extractActionsAndState } from "../../../lib/chat/extractActions";
import type { TaskState } from "../../../lib/db/types";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const eventId = body?.eventId;
  const message = body?.message;

  if (!eventId || typeof eventId !== "string") {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    // 归属权校验 + 拿出这场事件是跟哪个NPC聊的
    const event = await getOwnedEvent(eventId, userId);
    const npc = await getNpcConfigForUser(event.npc_id, userId);

    const [relationship, recentTurns] = await Promise.all([
      getOrCreateRelationship(userId, event.npc_id),
      getTurnsForEvent(eventId, userId),
    ]);

    const { systemPrompt, messages } = buildChatContext(
      npc,
      relationship,
      recentTurns,
      message,
      event.scenario,
      event.task_state
    );

    const rawReply = await callClaude(systemPrompt, messages);
    // 组句辅助命中时，AI会把词块放进回应末尾的[[CHUNKS: ...]]标记里，
    // 这里把它跟角色台词拆开——DB和对话气泡里只留纯台词，词块单独返回给前端渲染
    const { reply: afterChunks, wordChunks, suggestClose } = extractWordChunks(rawReply);
    // Phase 7：Task State启用时，AI还会在末尾追加ACTIONS/STATE标记——
    // 同样跟台词分开，台词部分继续走原有流程（存DB、显示气泡），
    // actions单独返给前端渲染Action Wheel，stateUpdate用来推进task_state。
    const { reply: npcReply, actions, stateUpdate } = extractActionsAndState(afterChunks);

    // 先存玩家发言，再存NPC回应，保持时间顺序
    await appendTurn(eventId, userId, "user", message);
    await appendTurn(eventId, userId, "npc", npcReply);

    // 只有这场event本来就启用了Task State（event.task_state非null）才需要
    // 持久化更新——没启用的event，AI这轮也不会被要求输出STATE标记，
    // stateUpdate自然是null，不会误把某场老流程的event写出task_state。
    let newTaskState: TaskState | null = event.task_state;
    if (event.task_state) {
      if (stateUpdate) {
        newTaskState = {
          stages: stateUpdate.newStages ?? event.task_state.stages,
          completedStageIds: stateUpdate.completedStageIds,
          currentStageId: stateUpdate.currentStageId,
          activeSubTask: stateUpdate.activeSubTask,
          diverged: stateUpdate.diverged || event.task_state.diverged,
        };
      }
      await updateTaskProgress(eventId, userId, { taskState: newTaskState, latestActions: actions });
    }

    return NextResponse.json({
      reply: npcReply,
      wordChunks,
      suggestClose,
      actions: event.task_state ? actions : undefined,
    });
  } catch (err) {
    console.error("Chat turn failed", err);
    return NextResponse.json({ error: "Chat turn failed" }, { status: 500 });
  }
}
