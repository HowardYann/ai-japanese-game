"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listNpcIds, getNpcDisplayName, getNpcConfig, defaultParticipantsFor } from "@/lib/npc/registry";
import type { EventScenario, NewNpcDraft } from "@/lib/db/types";

// v1：先用几条写死的推荐场景跑通闭环，不接真实推荐算法（对照V2文档第5节，
// mock数据够用）。结构和 /api/scenario/generate 的返回一致，
// 所以可以直接复用同一个Preview屏幕，不用为"推荐"单独做一套UI。
const RECOMMENDED: { label: string; scenario: EventScenario }[] = [
  {
    label: "和瑞希去咖啡店聊聊最近看的电影",
    scenario: {
      goal: "自然地和日本人聊最近看的一部电影，并分享观后感与对方的兴趣点",
      participants: "IT公司行政瑞希（みずき），温暖健谈的东京本地人",
      environment: "在一家舒适的咖啡店里，背景有轻柔的音乐和淡淡的咖啡香，氛围轻松友好",
      possibleTasks: [
        "自我介绍并说明自己最近看了哪部电影",
        "描述电影的剧情、喜欢的角色或场景",
        "回答瑞希关于电影类型、导演或演员的追问",
        "询问瑞希最近看过的电影并进行对比讨论",
        "在对话结束时礼貌地表达期待下次交流的愿望",
      ],
      suggestedNpcId: "mizuki",
      needsNewNpc: false,
      newNpcDraft: null,
    },
  },
  {
    label: "下班路上去大将的定食屋，点一道没吃过的菜",
    scenario: {
      goal: "走进熟悉的定食屋，点一道之前没吃过的菜，并和老板聊几句",
      participants: "定食屋「なかむら」老板大将，看似话少但耐心温和",
      environment: "下町路地裏的小店，柜台只有5个座位，晚饭时间，店里有其他熟客",
      possibleTasks: [
        "问大将今天有什么推荐",
        "点一道没吃过的菜，简单描述自己的口味喜好",
        "回应大将随口的关心或追问",
        "结束用餐时自然地道别",
      ],
      suggestedNpcId: "taisho",
      needsNewNpc: false,
      newNpcDraft: null,
    },
  },
];

type Screen =
  | { name: "entry" }
  | { name: "generating" }
  | { name: "preview"; scenario: EventScenario; sourceLabel?: string }
  | { name: "starting" };

// /api/npc/list 返回的单条动态NPC——只列必要的展示字段，跟NpcRow不是同一个类型
type MyNpc = {
  id: string;
  displayName: string;
  identity: string;
};

function isUnauthenticated(res: Response) {
  return res.status === 401;
}

export default function HomeClient() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ name: "entry" });
  const [freeInput, setFreeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // Phase 6.1：玩家自己创建/留下的动态NPC列表。null=还没加载完，
  // []=加载完但确实一个都没有——两种状态渲染不一样（后者不展示这个分区）。
  const [myNpcs, setMyNpcs] = useState<MyNpc[] | null>(null);

  // 只在首次进入entry屏时拉一次，不需要跟着screen切换反复请求
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/npc/list");
        if (isUnauthenticated(res)) {
          router.push("/");
          return;
        }
        if (!res.ok) return; // 拉取失败静默降级——这个分区本来就是锦上添花，不影响主流程
        const data = await res.json();
        if (cancelled) return;
        setMyNpcs(data.npcs ?? []);
      } catch {
        // 同上，静默降级
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleGenerate() {
    const input = freeInput.trim();
    if (!input) return;

    setErrorMsg("");
    setScreen({ name: "generating" });

    try {
      const res = await fetch("/api/scenario/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("场景生成失败了，可以换个说法再试一次。");
        setScreen({ name: "entry" });
        return;
      }
      const data = await res.json();
      setScreen({ name: "preview", scenario: data.scenario });
    } catch {
      setErrorMsg("网络出了点问题，场景没生成出来。");
      setScreen({ name: "entry" });
    }
  }

  function handlePickRecommended(item: { label: string; scenario: EventScenario }) {
    setErrorMsg("");
    setScreen({ name: "preview", scenario: item.scenario, sourceLabel: item.label });
  }

  // 浏览场景：v1先等于直接选NPC聊天，不带scenario——和现有chat页的select行为一致，
  // 只是入口挪到了这里
  async function handleBrowseNpc(npcId: string) {
    setErrorMsg("");
    setScreen({ name: "starting" });
    try {
      const res = await fetch("/api/event/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("开始对话失败，请重试。");
        setScreen({ name: "entry" });
        return;
      }
      const data = await res.json();
      const suffix = data.resumed ? "&resumed=1" : "";
      router.push(`/chat?eventId=${data.eventId}${suffix}`);
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
      setScreen({ name: "entry" });
    }
  }

  // Phase 6：npcId 现在可能是null——needsNewNpc路径下前端还没有npcId
  // （新角色要等event/start那边审核+落库后才会有id），这种情况下服务端
  // 会忽略/覆盖这个字段，自己用scenario.newNpcDraft生成一个，不需要前端瞎编。
  async function handleConfirmScenario(scenario: EventScenario, npcId: string | null) {
    setErrorMsg("");
    setScreen({ name: "starting" });
    try {
      const res = await fetch("/api/event/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId, scenario }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (!res.ok) {
        setErrorMsg("开始体验失败，请重试。");
        setScreen({ name: "preview", scenario });
        return;
      }
      const data = await res.json();
      const suffix = data.resumed ? "&resumed=1" : "";
      router.push(`/chat?eventId=${data.eventId}${suffix}`);
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
      setScreen({ name: "preview", scenario });
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">今天想做什么？</h1>
        <Link
          href="/world"
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
        >
          世界档案
        </Link>
      </div>

      {errorMsg && (
        <p className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {errorMsg}
        </p>
      )}

      {screen.name === "entry" && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">推荐给你</h2>
            <div className="space-y-3">
              {RECOMMENDED.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handlePickRecommended(item)}
                  className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
                >
                  <span className="text-neutral-100">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">浏览场景</h2>
            <div className="space-y-3">
              {listNpcIds().map((npcId) => (
                <button
                  key={npcId}
                  onClick={() => handleBrowseNpc(npcId)}
                  className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
                >
                  <span className="font-medium text-neutral-100">
                    去找 {getNpcDisplayName(npcId)} 聊聊
                  </span>
                </button>
              ))}
            </div>
          </section>

          {myNpcs !== null && myNpcs.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-neutral-300">你认识的人</h2>
              <div className="space-y-3">
                {myNpcs.map((npc) => (
                  <button
                    key={npc.id}
                    onClick={() => handleBrowseNpc(npc.id)}
                    className="block w-full rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-left text-sm hover:border-neutral-600"
                  >
                    <span className="font-medium text-neutral-100">
                      去找 {npc.displayName} 聊聊
                    </span>
                    <span className="ml-2 text-xs text-neutral-500">{npc.identity}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">
              或者，你自己想体验什么？
            </h2>
            <div className="space-y-2">
              <textarea
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                placeholder="例如：去居酒屋点菜 / 和同事聊周末 / 第一次参加日本人的聚会……"
                rows={3}
                maxLength={300}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
              <button
                onClick={handleGenerate}
                disabled={!freeInput.trim()}
                className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
              >
                开始体验
              </button>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-neutral-300">创造</h2>
            <Link
              href="/npc/new"
              className="block w-full rounded-md border border-dashed border-neutral-700 bg-neutral-900/30 p-4 text-left text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-100"
            >
              + 创建一个只有你能认识的人
            </Link>
          </section>
        </div>
      )}

      {screen.name === "generating" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在把这句话变成一个场景…</p>
        </div>
      )}

      {screen.name === "preview" && (
        <ScenarioPreview
          scenario={screen.scenario}
          sourceLabel={screen.sourceLabel}
          onBack={() => setScreen({ name: "entry" })}
          onConfirm={(npcId, effectiveScenario) => handleConfirmScenario(effectiveScenario, npcId)}
        />
      )}

      {screen.name === "starting" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在进入场景…</p>
        </div>
      )}
    </main>
  );
}

function ScenarioPreview({
  scenario,
  sourceLabel,
  onBack,
  onConfirm,
}: {
  scenario: EventScenario;
  sourceLabel?: string;
  onBack: () => void;
  onConfirm: (npcId: string | null, effectiveScenario: EventScenario) => void;
}) {
  // Phase 6.1：needsNewNpc=true时默认展示AI生成的新角色草案（可编辑），
  // 而不是像之前那样兜底退回选现有NPC。玩家仍然可以主动切换成"选一个
  // 已经认识的人"——mode只在needsNewNpc为true时才有切换的必要，
  // 普通场景（needsNewNpc=false）保持原来的行为不变，不引入这层UI。
  const [mode, setMode] = useState<"newNpc" | "existingNpc">(
    scenario.needsNewNpc ? "newNpc" : "existingNpc"
  );

  // ---------- existingNpc模式用 ----------
  const [npcId, setNpcId] = useState(scenario.suggestedNpcId ?? listNpcIds()[0]);

  // ---------- newNpc模式用：草案字段可编辑，跟独立创建页(npc-new-client.tsx)
  // 是同一套编辑体验，初始值来自scenario.newNpcDraft ----------
  const draftSeed = scenario.newNpcDraft;
  const [displayName, setDisplayName] = useState(draftSeed?.displayName ?? "");
  const [identity, setIdentity] = useState(draftSeed?.identity ?? "");
  const [personality, setPersonality] = useState(draftSeed?.personality ?? "");
  const [background, setBackground] = useState(draftSeed?.background ?? "");
  const [interestsText, setInterestsText] = useState((draftSeed?.interests ?? []).join("、"));
  const [speechStyle, setSpeechStyle] = useState(draftSeed?.speechStyle ?? "");
  const [correctionStyle, setCorrectionStyle] = useState(draftSeed?.correctionStyle ?? "");

  const canConfirmNewNpc =
    displayName.trim() &&
    identity.trim() &&
    personality.trim() &&
    background.trim() &&
    speechStyle.trim() &&
    correctionStyle.trim();

  function handleConfirm() {
    if (mode === "newNpc") {
      const interests = interestsText
        .split(/[、,，]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const draft: NewNpcDraft = {
        displayName: displayName.trim(),
        identity: identity.trim(),
        personality: personality.trim(),
        background: background.trim(),
        interests,
        speechStyle: speechStyle.trim(),
        correctionStyle: correctionStyle.trim(),
      };

      const effectiveScenario: EventScenario = {
        ...scenario,
        // 玩家可能编辑过身份/性格，"你会遇到"这段介绍性文字要跟着更新，
        // 不然会跟下面实际生效的角色对不上——写法跟defaultParticipantsFor
        // (针对静态NPC那个)保持同一种格式，方便以后维护时对照着改。
        participants: `${draft.identity}${draft.displayName}（${draft.displayName}），${draft.personality}`,
        suggestedNpcId: null,
        needsNewNpc: true,
        newNpcDraft: draft,
      };
      // npcId传null——这个新角色还没落库，没有真正的id。
      // event/start那边看到needsNewNpc+newNpcDraft会自己创建NPC、
      // 自己决定真正的npcId，不需要前端瞎编一个占位值。
      onConfirm(null, effectiveScenario);
      return;
    }

    const effectiveScenario: EventScenario =
      npcId === scenario.suggestedNpcId && !scenario.needsNewNpc
        ? scenario
        : {
            ...scenario,
            participants: defaultParticipantsFor(getNpcConfig(npcId)),
            suggestedNpcId: npcId,
            needsNewNpc: false,
            newNpcDraft: null,
          };
    onConfirm(npcId, effectiveScenario);
  }

  return (
    <div className="space-y-4">
      {sourceLabel && <p className="text-sm text-neutral-500">{sourceLabel}</p>}

      <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
        <p className="mb-3 text-sm text-neutral-100">{scenario.goal}</p>
        <p className="mb-1 text-xs text-neutral-500">场景</p>
        <p className="mb-3 text-sm text-neutral-300">{scenario.environment}</p>
        <p className="mb-1 text-xs text-neutral-500">你会遇到</p>
        <p className="text-sm text-neutral-300">{scenario.participants}</p>
      </div>

      {mode === "newNpc" ? (
        <div className="rounded-md border border-neutral-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              AI为这个场景设计了一个新角色，你可以直接改文字
            </p>
            {/* 只有needsNewNpc本来就是true（有draft兜底）才允许切换成选现有NPC；
                这个按钮不会在mode==="newNpc"但没有draft的情况下出现，因为
                只有needsNewNpc时mode初始值才会是"newNpc" */}
            <button
              onClick={() => setMode("existingNpc")}
              className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-300"
            >
              算了，选一个已经认识的人
            </button>
          </div>

          <div className="space-y-3">
            <PreviewField label="名字">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="身份">
              <input
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="性格">
              <textarea
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="背景故事">
              <textarea
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="兴趣爱好（用顿号、逗号分隔）">
              <input
                value={interestsText}
                onChange={(e) => setInterestsText(e.target.value)}
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="说话方式">
              <textarea
                value={speechStyle}
                onChange={(e) => setSpeechStyle(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
            <PreviewField label="纠错方式">
              <textarea
                value={correctionStyle}
                onChange={(e) => setCorrectionStyle(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              />
            </PreviewField>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-neutral-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-neutral-500">和谁一起体验这个场景</p>
            {scenario.needsNewNpc && (
              <button
                onClick={() => setMode("newNpc")}
                className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-300"
              >
                换成用AI帮你设计一个新角色
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {listNpcIds().map((id) => (
              <button
                key={id}
                onClick={() => setNpcId(id)}
                className={
                  id === npcId
                    ? "rounded-md border border-neutral-100 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900"
                    : "rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
                }
              >
                {getNpcDisplayName(id)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => handleConfirm()}
          disabled={mode === "newNpc" && !canConfirmNewNpc}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          开始体验
        </button>
        <button
          onClick={onBack}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
        >
          换一个
        </button>
      </div>
    </div>
  );
}

function PreviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">{label}</p>
      {children}
    </div>
  );
}