// lib/npc/types.ts
//
// 设计原则（对照 MVP交接文档 第五节 "安全纪律 #3"）：
// NPC 配置字段要区分"该不该进 prompt"——
//   - persona: 玩家可见人设，会被组装进 Claude 的 system prompt
//   - hidden: 纯后端用途，未来解锁条件等，MVP 阶段基本为空，但先把口子留好，
//             这样 buildContext 时永远是"白名单选字段"，不会不小心把 hidden 丢进 prompt。

export type RelationshipStage = "初识" | "熟悉中" | "熟悉" | "亲近";

export interface NpcPersona {
  /** 一句话身份，比如 "IT公司行政（事務），东京本地人" */
  identity: string;
  /** 性格关键词/描述 */
  personality: string;
  /** 背景故事，越具体越好，用来让NPC言之有物 */
  background: string;
  /** 兴趣爱好列表 */
  interests: string[];
  /** 说话方式/语域描述，直接指导Claude怎么"演" —— 例如敬语程度、口头禅、语速 */
  speechStyle: string;
  /**
   * 纠错风格说明：这个NPC会怎样自然地纠正玩家的日语。
   * 对照 product_vision 原则五「沉浸优先」——绝不是弹窗纠错，
   * 而是写清楚"这个角色会用什么方式在对话里带出纠正"。
   */
  correctionStyle: string;
}

export interface NpcHidden {
  /** MVP阶段留空，未来可能放解锁条件等纯后端字段，禁止进入 prompt */
  unlockConditions?: string[];
}

export interface NpcConfig {
  id: string;
  /** 显示名，含假名标注，例如 "瑞希（みずき）" */
  displayName: string;
  persona: NpcPersona;
  hidden: NpcHidden;
}
