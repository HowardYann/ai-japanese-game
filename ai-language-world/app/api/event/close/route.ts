// app/api/event/close/route.ts
//
// Day5-6：触发时机 = 玩家主动结束这场对话（比如聊天UI里点"结束这次聊天"）。
// MVP阶段不做"自动判断对话该结束了"的智能逻辑——由前端明确调用这个接口触发，
// 这样行为可预期，也方便测试。
//
// 链路：
//   校验event归属 -> 取出这场event的完整turns + 关系旧状态
//   -> buildSummaryContext 组装"记录者"prompt（跳出角色扮演）
//   -> callClaude 拿到纯文本 -> parseSummaryResult 解析成结构化数据
//   -> 覆盖式更新 npc_relationships（stage/known_facts/summary）
//   -> 更新 events（summary + life_collection_title）
//   -> 返回给前端展示"这次经历被记录下来了"

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getNpcConfig } from "../../../../lib/npc/registry";
import {
  getOrCreateRelationship,
  updateRelationshipSummary,
} from "../../../../lib/db/npcRelationships";
import {
  getOwnedEvent,
  getTurnsForEvent,
  closeEvent,
  deleteTurnsForEvent,
} from "../../../../lib/db/events";
import {
  buildSummaryContext,
  parseSummaryResult,
  type SummaryResult,
} from "../../../../lib/context/buildSummaryContext";
import { callClaude } from "../../../../lib/claude/client";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const eventId = body?.eventId;

  if (!eventId || typeof eventId !== "string") {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  try {
    // 归属权校验，同时拿到这场事件是跟哪个NPC聊的
    const event = await getOwnedEvent(eventId, userId);

    // 已经关档过了（summary非空）就不重复生成，直接把已有结果原样返回，
    // 防止玩家重复点击"结束对话"重复消耗AI调用、甚至覆盖掉更早生成的结果
    if (event.summary) {
      return NextResponse.json({
        eventId: event.id,
        eventSummary: event.summary,
        lifeCollectionTitle: event.life_collection_title,
        alreadyClosed: true,
      });
    }

    const npc = getNpcConfig(event.npc_id);

    const [relationship, turns] = await Promise.all([
      getOrCreateRelationship(userId, event.npc_id),
      getTurnsForEvent(eventId, userId),
    ]);

    const { systemPrompt, userMessage } = buildSummaryContext(npc, relationship, turns);

    let result: SummaryResult;
    try {
      const raw = await callClaude(systemPrompt, [{ role: "user", content: userMessage }]);
      result = parseSummaryResult(raw);
    } catch (summaryErr) {
      // 兜底范围覆盖"AI这一步失败的任何原因"——网络问题、供应商返回空内容、
      // 限流、超时，或者格式对不上解析失败。不管是哪种，"结束对话"这个动作
      // 对玩家来说必须始终能成功，最坏情况给一个占位摘要，而不是让事件卡死打不开。
      console.error("生成摘要失败，使用兜底摘要", summaryErr);
      const fallbackEvent = await closeEvent(eventId, userId, {
        text: "这次对话已经结束，但记录整理时出了点小问题，暂时没有生成详细摘要。",
        lifeCollectionTitle: null,
      });
      revalidatePath("/world");
      await deleteTurnsForEvent(eventId, userId).catch((e) =>
        console.error("Failed to delete turns after degraded close", e)
      );
      return NextResponse.json({
        eventId: fallbackEvent.id,
        eventSummary: fallbackEvent.summary,
        lifeCollectionTitle: fallbackEvent.life_collection_title,
        alreadyClosed: false,
        summaryDegraded: true,
      });
    }

    const [updatedRelationship, updatedEvent] = await Promise.all([
      updateRelationshipSummary(userId, event.npc_id, {
        stage: result.relationshipStage,
        knownFacts: result.knownFacts,
        summary: result.relationshipSummary,
      }),
      closeEvent(eventId, userId, {
        text: result.eventSummary,
        lifeCollectionTitle: result.lifeCollectionTitle,
        languageObservations: result.languageObservations,
      }),
    ]);

    revalidatePath("/world");
    // 关档成功，summary/relationship已经记录了这次经历——原始turns不再需要保留
    await deleteTurnsForEvent(eventId, userId).catch((e) =>
      console.error("Failed to delete turns after close", e)
    );

    return NextResponse.json({
      eventId: updatedEvent.id,
      eventSummary: updatedEvent.summary,
      lifeCollectionTitle: updatedEvent.life_collection_title,
      relationshipStage: updatedRelationship.stage,
      alreadyClosed: false,
    });
  } catch (err) {
    console.error("Close event failed", err);
    return NextResponse.json({ error: "Close event failed" }, { status: 500 });
  }
}
