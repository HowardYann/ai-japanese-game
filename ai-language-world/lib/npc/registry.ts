// lib/npc/registry.ts
import type { NpcConfig } from "./types";
import { mizuki } from "./data/mizuki";
import { taisho } from "./data/taisho";

const NPC_REGISTRY: Record<string, NpcConfig> = {
  mizuki,
  taisho,
};

// ---------- 静态内置NPC：同步函数，签名不变 ----------
// 注意：home-client.tsx 是客户端组件，直接同步调用这几个函数渲染NPC选择列表，
// 不能改成异步/接数据库——Phase 6加的动态NPC能力全部走下面新增的
// 异步函数，两边并存，不改动这几个已有调用方。

export function getNpcConfig(npcId: string): NpcConfig {
  const npc = NPC_REGISTRY[npcId];
  if (!npc) {
    throw new Error(`Unknown npcId: ${npcId}`);
  }
  return npc;
}

export function listNpcIds(): string[] {
  return Object.keys(NPC_REGISTRY);
}

/** 世界档案页用：容错版取displayName，NPC配置万一被删掉也不会让页面崩溃 */
export function getNpcDisplayName(npcId: string): string {
  return NPC_REGISTRY[npcId]?.displayName ?? npcId;
}

export function defaultParticipantsFor(npc: NpcConfig): string {
  return `${npc.persona.identity}${npc.displayName}（${npc.displayName}），${npc.persona.personality}`;
}

// ---------- Phase 6：玩家自建/场景涌现的动态NPC ----------
// getNpcConfigForUser / getNpcDisplayNameForUser 已经搬到 lib/npc/registryServer.ts。
//
// 原因：这个文件（registry.ts）被 home-client.tsx / chat-client.tsx 这两个
// "use client" 组件直接 import，用来同步渲染NPC选择列表。哪怕只是在这里用
// await import("../db/npcs") 做"动态引入"，webpack 在打客户端bundle时依然会
// 把这条依赖链解析进去（动态import只是切chunk，不代表脱离客户端构建图），
// 而 lib/db/npcs.ts → lib/supabase/server.ts 用了 next/headers，
// 于是触发 "You're importing a module that depends on next/headers...
// only available in Server Components" 的构建错误。
//
// 结论：任何会碰到 supabase/server.ts（next/headers）的函数，都不能待在
// 这个会被客户端组件引用的文件里，哪怕用动态import包一层也不行。
// 需要调用这两个函数的服务端route（event/start、event/close、chat等），
// 请改从 "../npc/registryServer" import。