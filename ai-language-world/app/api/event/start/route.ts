// app/api/event/start/route.ts
//
// 玩家点击"去找瑞希聊天"时，前端先调这个接口拿到 eventId，
// 再用这个 eventId 去调 /api/chat 发消息。
//
// Phase 1改动：body可以多带一个可选的 scenario 对象——来自
// /api/scenario/generate 的返回结果，玩家在Scenario Preview页确认后，
// 连同（可能被玩家手动改过的）npcId一起传进来。scenario本身不再重新
// 校验内容合法性（信任它是刚从我们自己的生成接口原样传回来的），
// 但npcId仍然照旧走白名单校验，不因为多了scenario就放松。
//
// Phase 6改动：npcId现在也可能是npcs表里的动态NPC，走getNpcConfigForUser解析。
// 更关键的一点：如果确认的scenario里needsNewNpc=true，说明玩家没有一个
// 现成的npcId可传——这时候body带的是newNpcDraft而不是npcId，这里要先把
// 这份草案过一遍安全审核、insert成一个真正的npcs行，拿到npcId后再往下走
// 和"选了现有NPC"完全一样的流程。这一步和 app/api/npc/create/route.ts
// 共用同一个 enforcePersonaSafety 关卡，不是各写各的审核逻辑。

import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "../../../../lib/supabase/requireUserId";
import { getNpcConfigForUser } from "../../../../lib/npc/registryServer";
import { createNpc } from "../../../../lib/db/npcs";
import { enforcePersonaSafety, PersonaRejectedError } from "../../../../lib/npc/enforcePersonaSafety";
import { createEvent, getOpenEventForNpc, appendTurn } from "../../../../lib/db/events";
import { getOrCreateRelationship } from "../../../../lib/db/npcRelationships";
import { buildOpeningContext } from "../../../../lib/context/buildContext";
import { callClaude } from "../../../../lib/claude/client";
import { extractWordChunks } from "../../../../lib/chat/extractWordChunks";
import type { EventScenario, NewNpcDraft } from "../../../../lib/db/types";
import type { NpcPersona } from "../../../../lib/npc/types";

function isValidNewNpcDraft(d: unknown): d is NewNpcDraft {
  if (typeof d !== "object" || d === null) return false;
  const obj = d as Record<string, unknown>;
  return (
    typeof obj.displayName === "string" &&
    typeof obj.identity === "string" &&
    typeof obj.personality === "string" &&
    typeof obj.background === "string" &&
    Array.isArray(obj.interests) &&
    typeof obj.speechStyle === "string" &&
    typeof obj.correctionStyle === "string"
  );
}

function isValidScenario(s: unknown): s is EventScenario {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  const baseValid =
    typeof obj.goal === "string" &&
    typeof obj.participants === "string" &&
    typeof obj.environment === "string" &&
    Array.isArray(obj.possibleTasks) &&
    typeof obj.needsNewNpc === "boolean";

  if (!baseValid) return false;

  if (obj.needsNewNpc) {
    return obj.suggestedNpcId === null && isValidNewNpcDraft(obj.newNpcDraft);
  }
  return typeof obj.suggestedNpcId === "string" && obj.newNpcDraft === null;
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  let npcId = body?.npcId;
  const scenarioInput = body?.scenario;

  // scenario是可选的——老的"直接选NPC聊天"流程不带这个字段，行为不变
  let scenario: EventScenario | null = null;
  if (scenarioInput !== undefined && scenarioInput !== null) {
    if (!isValidScenario(scenarioInput)) {
      return NextResponse.json({ error: "Invalid scenario payload" }, { status: 400 });
    }
    scenario = scenarioInput;
  }

  // Phase 6：needsNewNpc时没有现成npcId，先把草案落库（过审核）才能拿到一个
  try {
    if (scenario?.needsNewNpc && scenario.newNpcDraft) {
      const draft = scenario.newNpcDraft;
      const persona: NpcPersona = {
        identity: draft.identity,
        personality: draft.personality,
        background: draft.background,
        interests: draft.interests,
        speechStyle: draft.speechStyle,
        correctionStyle: draft.correctionStyle,
      };

      await enforcePersonaSafety({
        userId,
        rawInput: scenario.goal, // 场景涌现路径没有独立的"原始输入"，用goal兜底给审核/留底一点上下文
        displayName: draft.displayName,
        persona,
      });

      const npcRow = await createNpc(userId, draft.displayName, persona, "emergent");
      npcId = npcRow.id;
    }
  } catch (err) {
    if (err instanceof PersonaRejectedError) {
      return NextResponse.json(
        { error: "这个人设暂时无法创建，换个描述试试" },
        { status: 422 }
      );
    }
    console.error("Emergent NPC creation failed", err);
    return NextResponse.json({ error: "Failed to start event" }, { status: 500 });
  }

  if (!npcId || typeof npcId !== "string") {
    return NextResponse.json({ error: "npcId is required" }, { status: 400 });
  }

  let npc;
  try {
    // 校验npcId合法（静态注册表查不到时会去查这个用户名下的动态NPC；两边都查不到会抛错）
    npc = await getNpcConfigForUser(npcId, userId);
  } catch {
    return NextResponse.json({ error: "Unknown npcId" }, { status: 400 });
  }

  try {
    // 确保关系记录存在（首次见面自动初始化）
    const relationship = await getOrCreateRelationship(userId, npcId);
    // 有未结束的对话就续聊，不新开一个——避免堆积一堆待续事件
    const openEvent = await getOpenEventForNpc(userId, npcId);
    if (openEvent) {
      return NextResponse.json({
        eventId: openEvent.id,
        npcId,
        npcDisplayName: npc.displayName,
        resumed: true,       // 前端可选：用这个字段提示"继续上次的对话"
        openingMessage: null,
        openingWordChunks: undefined,
      });
    }
    const event = await createEvent(userId, npcId, scenario);

    // Phase 4：NPC先开口。这一步失败不应该让"开始体验"整体失败——
    // 最坏情况就是退回旧行为（玩家进聊天页看到的是空消息列表，自己先打招呼），
    // 事件本身已经创建成功，不能因为开场白生成失败就前功尽弃。
    let openingMessage: string | null = null;
    let openingWordChunks: string[] | undefined;
    try {
      const { systemPrompt, messages } = buildOpeningContext(npc, relationship, scenario);
      const raw = await callClaude(systemPrompt, messages);
      const { reply, wordChunks } = extractWordChunks(raw);
      await appendTurn(event.id, userId, "npc", reply);
      openingMessage = reply;
      openingWordChunks = wordChunks ?? undefined;
    } catch (openingErr) {
      console.error("生成开场白失败，退回玩家先开口", openingErr);
    }

    return NextResponse.json({
      eventId: event.id,
      npcId,
      npcDisplayName: npc.displayName,
      openingMessage,
      openingWordChunks,
    });
  } catch (err) {
    console.error("Failed to start event", err);
    return NextResponse.json(
      { error: "Failed to start event" },
      { status: 500 }
    );
  }
}