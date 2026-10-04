import { Api, TelegramClient } from "teleproto";
import { Cache } from "./Caches";
import { Utils } from "./Utils";
import type { Bot } from "grammy";
import { Entity } from "teleproto/define";

export class UserBots {
  private static getTarget(roleList: string, nameList: string): string[] {
    const parsedRoles = Object.fromEntries(
      roleList.split(",").map((pair: string) => {
        const [id, role] = pair.split(":");
        return [id.trim(), role.trim()];
      }),
    );
    const parsedNames = Object.fromEntries(
      nameList.split(",").map((pair: string) => {
        const [id, name] = pair.split(":");
        return [id.trim(), name.trim()];
      }),
    );

    const excluded = [
      // EN
      "doctor",
      "don",
      "hooker",
      "hobo",
      "maniac",
      "lawyer",
      "kamikaze",
      "mafia",
      "detective",
      "sergeant",
      "journalist",
      "bodyguard",
      // ID
      "dokter",
      "boss lana",
      "pelacur",
      "gelandangan",
      "gila",
      "pengacara",
      "kamikaze",
      "mafia",
      "detektif",
      "sersan",
      "wartawan",
      "pengawal",
    ];

    const result = Object.entries(parsedRoles)
      .filter(([, value]) => {
        const v = value.toLocaleLowerCase();
        return !excluded.some((ex) => v.includes(ex));
      })
      .map(([id]) => parsedNames[id])
      .filter(Boolean);

    return result;
  }

  static clickButton(
    client: TelegramClient,
    msg: Api.Message,
    btn: any,
    delay = 1000,
  ) {
    setTimeout(() => {
      client
        .invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: msg.peerId,
            msgId: msg.id,
            data: btn.type.data,
          }),
        )
        .catch(() => {});
    }, delay);
  }

  static handleAfkMode(
    client: TelegramClient,
    msg: Api.Message,
    buttons: Api.KeyboardInlineButton[],
  ) {
    if (!Cache.get(`begins`)) return;
    if (!Cache.get(`night`)) return;
    const getRoleList = String(Cache.get(`role`));
    const getNameList = String(Cache.get(`roleNames`));

    const hasDoctor =
      getRoleList.includes("doctor") || getRoleList.includes("dokter");
    const hasDon =
      getRoleList.includes("don") || getRoleList.includes("boss lana");
    const hasManiac =
      getRoleList.includes("maniac") || getRoleList.includes("gila");

    if (!hasDoctor && !hasDon && !hasManiac) return;
    let target;
    if (!Cache.get(`target`)) {
      target = this.getTarget(getRoleList, getNameList)[0];
      Cache.set(`target`, target);
    } else {
      target = String(Cache.get(`target`));
    }
    if (String(Cache.get("mode")) !== "afkmode") return;
    if (Cache.get(`allroleAfk`)) return;

    // --- DETECTIVE ---
    if (
      (msg.text.includes("act") || msg.text.includes("bertindak")) &&
      Cache.get(`afkmodeDet`)
    ) {
      const btn = buttons.find((b: any) => {
        return (
          (b.text?.includes("Check") || b.text?.includes("Memeriksa")) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      this.clickButton(client, msg, btn);
    }

    // --- DOCTOR ----
    if (
      msg.text.includes("Who will you heal") ||
      msg.text.includes("Siapa yang akan kamu sembuhkan") ||
      msg.text.includes("Siapa yang akan Anda sembuhkan")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- LAWYER ----
    if (
      msg.text.includes("Who will you protect from justice") ||
      msg.text.includes("Siapa yang akan Anda lindungi dari keadilan")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- HOOKER ---
    if (
      (msg.text.includes("Who are you gonna") ||
        msg.text.includes("Siapa yang akan Anda gedor")) &&
      Cache.get(`afkmodeHook`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return (
          !b.text?.includes(String(Cache.get(`doctor`))) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- BODYGUARD ---
    if (
      msg.text.includes("Who are you taking a bullet") ||
      msg.text.includes("Siapa yang akan Anda lindungi")
    ) {
      const btnList = buttons.filter((b: any) => {
        return (
          !b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- LYNCH ---
    if (
      (msg.text.includes("Time to seek the guilty") ||
        msg.text.includes("Saatnya mencari yang bersalah")) &&
      String(Cache.get("useVote")) !== "no"
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) {
        this.clickButton(client, msg, btn);
      } else {
        const btn = buttons.find((b: any) => {
          return (
            !b.text?.includes(String(Cache.get(`doctor`))) &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });
        if (btn) this.clickButton(client, msg, btn);
      }
    }

    // --- HOBO ---
    if (msg.text.includes("Whose glass") || msg.text.includes("Botol kaca")) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // ---JOURNALIST ---
    if (
      msg.text.includes("Who's today's") ||
      msg.text.includes("Tentang siapa")
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // --- MAFIA ---
    if (
      msg.text.includes("The Mafia is voting") ||
      msg.text.includes("Mafia memilih korban")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- MANIAC ---
    if (
      (msg.text.includes("Who will you kill") ||
        msg.text.includes("Siapa yang akan kamu bunuh") ||
        msg.text.includes("Siapa yang akan Anda bunuh")) &&
      Cache.get(`afkmodeMani`)
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- SANTA ---
    if (
      (msg.text.includes("Who is getting the gifts") ||
        msg.text.includes("Siapa yang akan mendapatkan hadiah")) &&
      Cache.get(`afkmodeSanta`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // --- DON INVESTIGATE ---
    if (
      (msg.text.includes("Who shall we look") ||
        msg.text.includes("Siapa yang kita selidiki")) &&
      Cache.get(`afkmodeDonCh`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }
  }

  static updateRoleCache(
    userId: string,
    fullName: string,
    role: string | undefined,
  ) {
    let roleUpdateQueue: Promise<void> = Promise.resolve();
    roleUpdateQueue = roleUpdateQueue.then(() => {
      const getRoleList = Cache.get(`role`);
      const roleRegex = new RegExp(`(^|,)${userId}:[^,]*`);
      if (!getRoleList) {
        Cache.set(`role`, `${userId}:${role}`);
      } else if (roleRegex.test(String(getRoleList))) {
        Cache.set(
          `role`,
          String(getRoleList).replace(roleRegex, `$1${userId}:${role}`),
        );
      } else {
        Cache.set(`role`, `${getRoleList},${userId}:${role}`);
      }

      const getNameList = Cache.get(`roleNames`);
      const nameRegex = new RegExp(`(^|,)${userId}:[^,]*`);
      if (!getNameList) {
        Cache.set(`roleNames`, `${userId}:${fullName}`);
      } else if (nameRegex.test(String(getNameList))) {
        Cache.set(
          `roleNames`,
          String(getNameList).replace(nameRegex, `$1${userId}:${fullName}`),
        );
      } else {
        Cache.set(`roleNames`, `${getNameList},${userId}:${fullName}`);
      }
    });
    return roleUpdateQueue;
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
      const getDead = Cache.get(`dead`);
      const target = Cache.get(`target`);
      const current = getDead ? Number(getDead) : 0;
      Cache.set(`dead`, current + delta);

      if (
        !fullName.includes(String(target)) &&
        !Cache.get(`hasSentKill_${userId}`)
      ) {
        Cache.set(`hasSentKill_${userId}`, true);
        const msg = {
          killed: "telah dibunuh dalam permainan.",
          lynch: "telah digantung.",
          idle: "dibunuh karena afk.",
        };
        Utils.sendMessageToAdmin(
          bot,
          `☠️ <b>Dead!</b>\nUserbot <a href='tg://user?id=${userId}'>${fullName}</a> ${msg[type!]}`,
        );
      }
    });
    return this.deadUpdateQueue;
  }

  static clearSmode() {
    Cache.del(`afkmodeHook`);
    Cache.del(`afkmodeDet`);
    Cache.del(`afkmodeMani`);
    Cache.del(`afkmodeSanta`);
    Cache.del(`afkmodeDonCh`);
    Cache.del(`useVote`);
    Cache.del(`mode`);
    Cache.del(`target`);
    Cache.del(`afkmodeDur`);
    Cache.del(`continu`);
    Cache.del(`allroleAfk`);
    Cache.del(`join`);
  }

  static clearAll(type?: string) {
    Cache.del(`role`);
    Cache.del(`begins`);
    if (!Cache.get(`continu`)) {
      this.clearSmode();
    } else {
      if (!Cache.get(`join`) && type === "1") {
        Cache.set(`join`, "direct");
      }
    }
    Cache.del(`roleNames`);
    Cache.del(`dead`);
    Cache.del(`hasSent`);
    Cache.del(`hasSentGame`);
    Cache.del(`target`);
    Cache.del(`roleSepaDon`);
    Cache.del(`hasSentWarnDoc`);
    Cache.del(`hasSentWarnKill`);
    Cache.del(`doctor`);
    Cache.del(`dayNow`);
    Cache.del(`night`);
    Cache.del(`registrationHandled`);
    const getUbot = String(process.env["USERBOT"]).split(",");
    getUbot.map((id: string) => {
      Cache.del(`hasSentKill_${id}`);
    });
  }

  static setMafiaEntity(client: TelegramClient, id: string) {
    client.getEntity(String(process.env["TRUE_MAFIA"])).then((entity) => {
      Cache.set(`mafiaEntity_${id}`, entity);
    });
  }

  static getMafiaEntity(
    client: TelegramClient,
    id: string,
    callback: (result: Entity) => void,
  ) {
    const getEnt = Cache.get(`mafiaEntity_${id}`);
    if (!getEnt) {
      client.getEntity(String(process.env["TRUE_MAFIA"])).then((entity) => {
        Cache.set(`mafiaEntity_${id}`, entity);
        return callback(entity);
      });
    } else {
      return callback(getEnt as Entity);
    }
  }
}
