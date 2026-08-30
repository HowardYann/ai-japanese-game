// lib/chat/extractActions.ts
//
// Phase 7新增：跟 extractWordChunks.ts 是同一种模式——AI在回复里用隐藏标记
// 携带结构化信息，这个模块负责把它摘出来解析。
//
// 跟CHUNKS/SUGGEST_CLOSE不一样的地方：ACTIONS和STATE携带的是JSON
// （不是简单的竖线分隔列表），所以不能用CHUNKS那种"找到 [[MARKER: ...]]
// 再看右括号在哪"的单行正则——JSON数组/对象自己就带 ] 和 }，很容易跟
// 标记本身的收尾 ]] 搞混。改用明确的 START/END 一对标签包裹整段JSON，
// 中间内容不管多长、内部有多少层括号，都能用非贪婪匹配准确截出来。

import type { TaskStage } from "../db/types";

export interface ActionItem {
  label: string;
  phrase: string;
}

/** AI这一轮判断出的task_state更新。除了stages字段外基本对应TaskState，
 *  但换了个名字（newStages）明确表达"只有AI主动给出时才整体替换旧的
 *  stages数组，没给就沿用原来的"，跟其它必填字段（currentStageId等）
 *  语义不一样，不能直接照抄TaskState类型。 */
export interface StateUpdate {
  currentStageId: string | null;
  completedStageIds: string[];
  activeSubTask: string | null;
  diverged: boolean;
  /** 非null时代表AI判断玩家的行为已经让原路径不再适用，整体给出一条
   *  新路径替换旧的stages。null就沿用调用方传入的原stages不变。 */
  newStages: TaskStage[] | null;
}

export interface ExtractedActionsAndState {
  reply: string;
  actions: ActionItem[] | null;
  stateUpdate: StateUpdate | null;
}

const ACTIONS_RE = /\[\[ACTIONS_START\]\]([\s\S]*?)\[\[ACTIONS_END\]\]/i;
const STATE_RE = /\[\[STATE_START\]\]([\s\S]*?)\[\[STATE_END\]\]/i;

function stripJsonFence(s: string): string {
  return s
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseActions(raw: string): ActionItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const items: ActionItem[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.label !== "string" || !e.label.trim()) continue;
    if (typeof e.phrase !== "string") continue;
    items.push({ label: e.label.trim(), phrase: e.phrase.trim() });
  }
  return items.length > 0 ? items : null;
}

function parseStageArray(raw: unknown): TaskStage[] | null {
  if (!Array.isArray(raw)) return null;
  const seenIds = new Set<string>();
  const stages: TaskStage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id.trim()) continue;
    if (typeof s.label !== "string" || !s.label.trim()) continue;
    if (seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    stages.push({ id: s.id.trim(), label: s.label.trim(), required: s.required !== false });
  }
  return stages.length > 0 ? stages : null;
}

function parseStateUpdate(raw: string): StateUpdate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  const completedStageIds = Array.isArray(p.completedStageIds)
    ? p.completedStageIds.filter((x): x is string => typeof x === "string")
    : [];

  return {
    currentStageId: typeof p.currentStageId === "string" ? p.currentStageId : null,
    completedStageIds,
    activeSubTask: typeof p.activeSubTask === "string" && p.activeSubTask.trim() ? p.activeSubTask.trim() : null,
    diverged: p.diverged === true,
    newStages: parseStageArray(p.newStages),
  };
}

/**
 * 从AI原始回复里摘出ACTIONS/STATE标记，返回去掉标记后的纯台词
 * 以及各自解析结果（解析失败或没触发都是null，调用方按"这轮没有"处理，
 * 不应该因为这两个可选增强字段解析失败就影响台词本身的展示）。
 */
export function extractActionsAndState(rawText: string): ExtractedActionsAndState {
  let text = rawText;

  let actions: ActionItem[] | null = null;
  const actionsMatch = text.match(ACTIONS_RE);
  if (actionsMatch) {
    actions = parseActions(actionsMatch[1]);
    text = (text.slice(0, actionsMatch.index) + text.slice((actionsMatch.index ?? 0) + actionsMatch[0].length));
  }

  let stateUpdate: StateUpdate | null = null;
  const stateMatch = text.match(STATE_RE);
  if (stateMatch) {
    stateUpdate = parseStateUpdate(stateMatch[1]);
    text = (text.slice(0, stateMatch.index) + text.slice((stateMatch.index ?? 0) + stateMatch[0].length));
  }

  return { reply: text.trim(), actions, stateUpdate };
}
