import type { Bot } from "grammy";
import { Cache } from "./Caches";
import { Utils } from "./Utils";
import type {
  ButtonPayload,
  ClientRef,
  MessagePayload,
  WorkerManager,
} from "../Workers/WorkerManager";

export interface ClickCtx {
  manager: WorkerManager;
  ref: ClientRef;
}

const ALLOWED_TARGET_ROLES = [
  // EN
  "townie",
  "suicide",
  "lucky",
  // ID
  "warga",
  "bunuh diri",
];

const isCallback = (b: ButtonPayload) =>
  b.type?.className === "InlineButtonTypeCallback" && !!b.type?.data;

const pickRandom = <T>(arr: T[]): T | undefined =>
  arr[Math.floor(Math.random() * arr.length)];

const has = (text: string, ...phrases: string[]) =>
  phrases.some((p) => text.includes(p));

const parseCsvMap = (list: string): Record<string, string> =>
  Object.fromEntries(
    list.split(",").map((pair) => {
      const [id, value] = pair.split(":");
      return [id.trim(), (value ?? "").trim()];
    }),
  );

const upsertCsv = (key: string, userId: string, value: string) => {
  const current = Cache.get(key);
  const entryRegex = new RegExp(`(^|,)${userId}:[^,]*`);
  if (!current) Cache.set(key, `${userId}:${value}`);
  else if (entryRegex.test(String(current)))
    Cache.set(key, String(current).replace(entryRegex, `$1${userId}:${value}`));
  else Cache.set(key, `${current},${userId}:${value}`);
};

interface AfkRule {
  triggers: string[];
  enabled?: () => boolean;
  pick: () => ButtonPayload | undefined;
}

export class UserBots {
  private static getTarget(roleList: string, nameList: string): string | null {
    const roles = parseCsvMap(roleList);
    const names = parseCsvMap(nameList);

    const candidates = Object.entries(roles)
      .filter(([, role]) => ALLOWED_TARGET_ROLES.includes(role.toLowerCase()))
      .map(([id]) => names[id])
      .filter(Boolean);

    const existing = Cache.get(`target`);
    if (existing) return String(existing);

    const target = pickRandom(candidates);
    if (!target) return null;
    Cache.set(`target`, target);
    return target;
  }

  static clickButton(
    ctx: ClickCtx,
    msg: MessagePayload,
    btn: ButtonPayload | undefined,
    delay = 500,
    retriesLeft = 2,
  ) {
    if (!btn) return;
    setTimeout(() => {
      ctx.manager.clickButton(ctx.ref, msg, btn).catch((err: Error) => {
        Utils.writeLog(`[CLICK ERR] ${err.message}`);
        const isTimeout =
          err.message.includes("BOT_RESPONSE_TIMEOUT") ||
          err.message.includes("BotResponseTimeoutError");
        if (isTimeout && retriesLeft > 0) {
          this.clickButton(ctx, msg, btn, 500, retriesLeft - 1);
        }
      });
    }, delay);
  }

  static handleAfkMode(
    ctx: ClickCtx,
    msg: MessagePayload,
    buttons: ButtonPayload[],
  ) {
    if (!Cache.get(`begins`)) return;
    if (!Cache.get(`night`)) return;

    const roleList = String(Cache.get(`role`));
    const nameList = String(Cache.get(`roleNames`));

    const hasDoctor = has(roleList, "doctor", "dokter");
    const hasDon = has(roleList, "don", "boss lana");
    const hasManiac = has(roleList, "maniac", "gila");
    if (!hasDoctor && !hasDon && !hasManiac) return;

    const target = this.getTarget(roleList, nameList);
    if (String(Cache.get("mode")) !== "afkmode") return;
    if (Cache.get(`allroleAfk`)) return;

    const doctor = String(Cache.get(`doctor`));
    const callbacks = buttons.filter(isCallback);
    const withTarget = () =>
      target ? callbacks.find((b) => b.text?.includes(target)) : undefined;
    const notDoctor = () => callbacks.filter((b) => !b.text?.includes(doctor));
    const random = () => pickRandom(callbacks);

    const rules: AfkRule[] = [
      {
        triggers: ["act!", "bertindak!"],
        enabled: () => !!Cache.get(`afkmodeDet`),
        pick: () => buttons[0],
      },
      {
        triggers: [
          "Who will you heal",
          "Siapa yang akan kamu sembuhkan",
          "Siapa yang akan Anda sembuhkan",
        ],
        pick: withTarget,
      },
      {
        triggers: [
          "Who will you protect from justice",
          "Siapa yang akan Anda lindungi dari keadilan",
        ],
        pick: withTarget,
      },
      {
        triggers: ["Who are you gonna", "Siapa yang akan Anda gedor"],
        enabled: () => !!Cache.get(`afkmodeHook`),
        pick: () => pickRandom(notDoctor()),
      },
      {
        triggers: [
          "Who are you taking a bullet",
          "Siapa yang akan Anda lindungi",
        ],
        pick: () =>
          pickRandom(
            callbacks.filter((b) => !target || !b.text?.includes(target)),
          ),
      },
      {
        triggers: ["Time to seek the guilty", "Saatnya mencari yang bersalah"],
        enabled: () => String(Cache.get("useVote")) !== "no",
        pick: () => withTarget() ?? random(),
      },
      { triggers: ["Whose glass", "Botol kaca"], pick: random },
      { triggers: ["Who's today's", "Tentang siapa"], pick: random },
      {
        triggers: ["The Mafia is voting", "Mafia memilih korban"],
        pick: withTarget,
      },
      {
        triggers: [
          "Who will you kill",
          "Siapa yang akan kamu bunuh",
          "Siapa yang akan Anda bunuh",
        ],
        enabled: () => !!Cache.get(`afkmodeMani`),
        pick: withTarget,
      },
      {
        triggers: [
          "Who is getting the gifts",
          "Siapa yang akan mendapatkan hadiah",
        ],
        enabled: () => !!Cache.get(`afkmodeSanta`),
        pick: random,
      },
      {
        triggers: ["Who shall we look", "Siapa yang kita selidiki"],
        enabled: () => !!Cache.get(`afkmodeDonCh`),
        pick: random,
      },
    ];

    const rule = rules.find(
      (r) => has(msg.text, ...r.triggers) && (r.enabled?.() ?? true),
    );
    if (rule) this.clickButton(ctx, msg, rule.pick());
  }

  private static roleUpdateQueue: Promise<void> = Promise.resolve();
  static updateRoleCache(
    userId: string,
    fullName: string,
    role: string | undefined,
  ) {
    this.roleUpdateQueue = this.roleUpdateQueue.then(() => {
      upsertCsv(`role`, userId, String(role));
      upsertCsv(`roleNames`, userId, fullName);
    });
    return this.roleUpdateQueue;
  }

  private static deadUpdateQueue: Promise<void> = Promise.resolve();
  static incrementDead(
    delta: number,
    fullName: string,
    userId: string,
    bot: Bot,
    type: "killed" | "lynch" | "idle" | null,
  ) {
    this.deadUpdateQueue = this.deadUpdateQueue.then(() => {
      Cache.set(`dead`, Number(Cache.get(`dead`) ?? 0) + delta);

      if (!type) return;

      const target = Cache.get(`target`);
      if (
        !fullName.includes(String(target)) &&
        !Cache.get(`hasSentKill_${userId}`)
      ) {
        Cache.set(`hasSentKill_${userId}`, true);
        const text = {
          killed: "telah dibunuh dalam permainan.",
          lynch: "telah digantung.",
          idle: "dibunuh karena afk.",
        }[type];
        Utils.sendMessageToAdmin(
          bot,
          `☠️ <b>Dead!</b>\nUserbot <a href='tg://user?id=${userId}'>${fullName}</a> ${text}`,
        );
      }
    });
    return this.deadUpdateQueue;
  }

  static clearSmode() {
    [
      "afkmodeHook",
      "afkmodeDet",
      "afkmodeMani",
      "afkmodeSanta",
      "afkmodeDonCh",
      "useVote",
      "mode",
      "target",
      "afkmodeDur",
      "continu",
      "allroleAfk",
      "join",
    ].forEach((k) => Cache.del(k));
  }

  static clearAll(type?: string) {
    Cache.del(`role`);
    Cache.del(`begins`);
    if (!Cache.get(`continu`)) {
      this.clearSmode();
    } else if (!Cache.get(`join`) && type === "1") {
      Cache.set(`join`, "direct");
    }
    [
      "roleNames",
      "dead",
      "hasSent",
      "hasSentGame",
      "target",
      "roleSepaDon",
      "hasSentWarnDoc",
      "hasSentWarnKill",
      "doctor",
      "dayNow",
      "night",
      "registrationHandled",
    ].forEach((k) => Cache.del(k));

    String(process.env["USERBOT"])
      .split(",")
      .forEach((id) => Cache.del(`hasSentKill_${id}`));
  }
}
