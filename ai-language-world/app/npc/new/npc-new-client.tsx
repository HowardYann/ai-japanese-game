"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NpcPersona } from "@/lib/npc/types";

// Phase 6：独立创建NPC入口。
// 链路：自由输入 -> /api/npc/generate 生成草案（不落库）-> 预览/编辑
//      -> /api/npc/create（真正落库，且对最终版本重新过一次审核）
// 跟 home-client.tsx 的场景生成是同一种"两段式"设计：生成步骤不写DB，
// 避免玩家生成了但没用的草稿变成脏数据。

type Draft = {
  displayName: string;
  persona: NpcPersona;
};

type Screen =
  | { name: "input" }
  | { name: "generating" }
  | { name: "preview"; draft: Draft }
  | { name: "creating"; draft: Draft }
  | { name: "created"; npcId: string; displayName: string }
  | { name: "starting" };

function isUnauthenticated(res: Response) {
  return res.status === 401;
}

// 后端generatePersona.ts对边界内容会自动改写成安全版本、不会报错，
// 422只会在/create那一步对"玩家手动改过的最终内容"审核不通过时出现——
// 提示语故意不透露具体原因，跟enforcePersonaSafety.ts的设计一致。
const REJECTED_MESSAGE = "这个人设暂时无法创建，换个描述试试。";

export default function NpcNewClient() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ name: "input" });
  const [freeInput, setFreeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleGenerate() {
    const input = freeInput.trim();
    if (!input) return;

    setErrorMsg("");
    setScreen({ name: "generating" });

    try {
      const res = await fetch("/api/npc/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (res.status === 422) {
        setErrorMsg(REJECTED_MESSAGE);
        setScreen({ name: "input" });
        return;
      }
      if (!res.ok) {
        setErrorMsg("人设生成失败了，可以换个说法再试一次。");
        setScreen({ name: "input" });
        return;
      }
      const data = await res.json();
      setScreen({ name: "preview", draft: data.draft });
    } catch {
      setErrorMsg("网络出了点问题，人设没生成出来。");
      setScreen({ name: "input" });
    }
  }

  async function handleCreate(draft: Draft) {
    setErrorMsg("");
    setScreen({ name: "creating", draft });

    try {
      const res = await fetch("/api/npc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName,
          persona: draft.persona,
          rawInput: freeInput.trim(),
        }),
      });
      if (isUnauthenticated(res)) {
        router.push("/");
        return;
      }
      if (res.status === 422) {
        setErrorMsg(REJECTED_MESSAGE);
        setScreen({ name: "preview", draft });
        return;
      }
      if (!res.ok) {
        setErrorMsg("创建失败了，请重试。");
        setScreen({ name: "preview", draft });
        return;
      }
      const data = await res.json();
      setScreen({ name: "created", npcId: data.npcId, displayName: draft.displayName });
    } catch {
      setErrorMsg("网络出了点问题，没能创建成功。");
      setScreen({ name: "preview", draft });
    }
  }

  async function handleStartChat(npcId: string) {
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
        setScreen({ name: "created", npcId, displayName: "" });
        return;
      }
      const data = await res.json();
      router.push(`/chat?eventId=${data.eventId}`);
    } catch {
      setErrorMsg("网络出了点问题，请重试。");
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">创建一个新的人物</h1>
        <Link
          href="/home"
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
        >
          返回
        </Link>
      </div>

      {errorMsg && (
        <p className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {errorMsg}
        </p>
      )}

      {screen.name === "input" && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">
            描述一下你想认识的人——不用写得很正式，一两句话就够。AI会帮你把TA设计成一个具体的角色。
          </p>
          <textarea
            value={freeInput}
            onChange={(e) => setFreeInput(e.target.value)}
            placeholder="例如：一个在花店打工的大学生，喜欢摇滚乐 / 严厉但很照顾人的健身教练……"
            rows={4}
            maxLength={300}
            className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={handleGenerate}
            disabled={!freeInput.trim()}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            生成人设
          </button>
        </div>
      )}

      {screen.name === "generating" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在把这句话设计成一个人…</p>
        </div>
      )}

      {screen.name === "preview" && (
        <PersonaPreview
          draft={screen.draft}
          onBack={() => setScreen({ name: "input" })}
          onRegenerate={handleGenerate}
          onConfirm={handleCreate}
        />
      )}

      {screen.name === "creating" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在创建这个人…</p>
        </div>
      )}

      {screen.name === "created" && (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 p-4">
            <p className="text-sm text-emerald-200">
              {screen.displayName} 已经创建好了，只有你能和TA聊天。
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handleStartChat(screen.npcId)}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
            >
              现在就去找TA聊天
            </button>
            <Link
              href="/home"
              className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:text-neutral-100"
            >
              回到首页
            </Link>
          </div>
        </div>
      )}

      {screen.name === "starting" && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-neutral-500">正在进入对话…</p>
        </div>
      )}
    </main>
  );
}

function PersonaPreview({
  draft,
  onBack,
  onRegenerate,
  onConfirm,
}: {
  draft: Draft;
  onBack: () => void;
  onRegenerate: () => void;
  onConfirm: (draft: Draft) => void;
}) {
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [identity, setIdentity] = useState(draft.persona.identity);
  const [personality, setPersonality] = useState(draft.persona.personality);
  const [background, setBackground] = useState(draft.persona.background);
  const [interestsText, setInterestsText] = useState(draft.persona.interests.join("、"));
  const [speechStyle, setSpeechStyle] = useState(draft.persona.speechStyle);
  const [correctionStyle, setCorrectionStyle] = useState(draft.persona.correctionStyle);

  function handleConfirm() {
    const interests = interestsText
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onConfirm({
      displayName: displayName.trim(),
      persona: {
        identity: identity.trim(),
        personality: personality.trim(),
        background: background.trim(),
        interests,
        speechStyle: speechStyle.trim(),
        correctionStyle: correctionStyle.trim(),
      },
    });
  }

  const canConfirm =
    displayName.trim() &&
    identity.trim() &&
    personality.trim() &&
    background.trim() &&
    speechStyle.trim() &&
    correctionStyle.trim();

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">
        看看这个人设怎么样，随时可以直接改文字，改好了再确认。
      </p>

      <Field label="名字">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="身份">
        <input
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="性格">
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="背景故事">
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="兴趣爱好（用顿号、逗号分隔）">
        <input
          value={interestsText}
          onChange={(e) => setInterestsText(e.target.value)}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="说话方式">
        <textarea
          value={speechStyle}
          onChange={(e) => setSpeechStyle(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <Field label="纠错方式">
        <textarea
          value={correctionStyle}
          onChange={(e) => setCorrectionStyle(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </Field>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          确认，创建这个人
        </button>
        <button
          onClick={onRegenerate}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
        >
          重新生成
        </button>
        <button
          onClick={onBack}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-100"
        >
          换个描述
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">{label}</p>
      {children}
    </div>
  );
}
