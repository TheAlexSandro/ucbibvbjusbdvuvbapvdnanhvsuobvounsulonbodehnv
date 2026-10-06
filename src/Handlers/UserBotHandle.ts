import type { Bot } from "grammy";
import { Cache } from "../Utils/Caches";
import { Utils } from "../Utils/Utils";
import { UserBots, type ClickCtx } from "../Utils/UserBots";
import type {
  ClientRef,
  MessagePayload,
  UserInfo,
  WorkerManager,
} from "../Workers/WorkerManager";

const has = (text: string, ...phrases: string[]) =>
  phrases.some((p) => text.includes(p));

const isCallback = (b: { type?: { className?: string; data?: number[] } }) =>
  b.type?.className === "InlineButtonTypeCallback" && !!b.type?.data;

const EMOJI_ROLE_REGEX =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u{200D}\u{FE0F}\u{FE0E}]+\s*([A-Za-z]+(?:\s[A-Za-z]+)*)/u;

export class UserBotHandle {
  private readonly info: UserInfo;
  private readonly ctx: ClickCtx;
  private readonly mafiaBotId = Number(process.env["MAFIA_BOT_ID"]);

  constructor(
    private readonly msg: MessagePayload,
    ref: ClientRef,
    manager: WorkerManager,
    private readonly bot: Bot,
  ) {
    this.info = manager.getUser(ref.userId) ?? {
      id: ref.userId,
      firstName: ref.userId,
      fullName: ref.userId,
    };
    this.ctx = { manager, ref };
  }

  private get fromMafiaBot() {
    return Number(this.msg.senderId) === this.mafiaBotId;
  }

  private get isDisabled() {
    return Boolean(Cache.get(`userbot_${this.info.id}_disabled`));
  }

  private notifyAdmin(text: string) {
    Utils.sendMessageToAdmin(this.bot, text);
  }

  private get mention() {
    return `<a href='tg://user?id=${Number(this.info.id)}'>${this.info.fullName}</a>`;
  }

  public handle() {
    if (this.isDisabled || this.msg.out || !this.fromMafiaBot) return;

    if (String(this.msg.chatId) === String(Cache.get(`groupTarget`))) {
      this.handleGroupMessage();
    }
    if (this.msg.isPrivate) {
      this.handlePrivateMessage();
    }
  }

  private handleGroupMessage() {
    const { text } = this.msg;

    this.handleLynchConfirm();
    this.trackTotal(text);
    this.trackDay(text);

    if (has(text, "The game begins", "Permainan dimulai")) {
      this.markGameBegins();
      if (Cache.get(`join`) && !Cache.get(`continu`)) Cache.del(`join`);
    }

    if (
      has(
        text,
        "The Night Falls",
        "Malam yang mengerikan",
        "It's mob justice time",
        "Saatnya mafia",
      )
    ) {
      this.markGameBegins();
      Cache.set(`night`, true);
      Cache.set(`roleSepaDon`, true);
      Cache.del(`hasSent`);
      Cache.del(`hasSentWarnKill`);
      String(process.env["USERBOT"])
        .split(",")
        .forEach((id) => Cache.del(`hasSentKill_${id}`));
    }

    if (has(text, "Game canceled", "Permainan dibatalkan")) {
      UserBots.clearAll("1");
    }

    if (
      has(
        text,
        "#ADVERTISING",
        "Game over",
        "Permainan telah berakhir",
        "Permainan berakhir",
      ) &&
      Cache.get(`role`)
    ) {
      UserBots.clearAll();
    }
  }

  private markGameBegins() {
    if (Cache.get(`begins`)) return;
    Cache.set(`begins`, true);
    Cache.del(`registrationHandled`);
    Cache.del(`hasSentGame`);
  }

  private handleLynchConfirm() {
    const { text, buttons } = this.msg;
    if (!buttons) return;
    if (
      !has(text, "Are you sure about lynching", "Anda yakin ingin menggantung")
    )
      return;
    if (!text.includes(String(Cache.get(`target`)))) return;
    if (Cache.get(`useVote`) !== "yes") return;

    const btn = buttons.find((b) => b.text?.includes("👎") && isCallback(b));
    UserBots.clickButton(this.ctx, this.msg, btn);
  }

  private trackTotal(text: string) {
    const match = text.match(/Total:\s*(\d+)/);
    if (!Cache.get(`total`)) Cache.set(`total`, match ? Number(match[1]) : 0);
  }

  private trackDay(text: string) {
    const match = text.match(/(?:Day|Hari)\s+(\d+)/i);
    if (!match) return; // jangan timpa dayNow dengan null
    const day = Number(match[1]);

    if (day !== Number(Cache.get(`dayNow`) ?? 0)) Cache.set(`dayNow`, day);

    if (day === Number(Cache.get(`afkmodeDur`)) && !Cache.get(`hasSent`)) {
      Cache.set(`hasSent`, true);
      const continuous = Cache.get(`continu`);
      if (!continuous) UserBots.clearSmode();
      this.notifyAdmin(
        `⚠️ <b>Perhatian!</b>\nSuck mode telah mencapai durasi yang ditentukan - ${day} hari.${continuous ? "\n🔁 Continuous sedang aktif, userbot tidak akan berhenti." : ""}`,
      );
    }
  }

  private handlePrivateMessage() {
    const { text, buttons } = this.msg;

    if (buttons) {
      UserBots.handleAfkMode(this.ctx, this.msg, buttons);
    }

    if (
      has(
        text,
        "Couldn't join the game",
        "Tidak dapat bergabung",
        "Anda baru saja keluar",
        "You just",
      )
    ) {
      this.notifyAdmin(`🤚 ${this.mention} tidak dapat bergabung.`);
    }

    if (
      has(
        text,
        "You're",
        "You are",
        "is a new",
        "Anda adalah",
        "Anda sekarang",
        "baru",
      )
    ) {
      if (this.handleRoleMessage()) return;
    }

    if (
      has(
        text,
        "You have been killed",
        "Congrats on winning",
        "You stayed idle",
        "Anda dibunuh",
        "Selamat, Anda telah",
        "Anda tetap menganggur",
      )
    ) {
      const type = has(text, "You have been killed", "Anda dibunuh")
        ? "killed"
        : has(text, "Congrats on winning", "Selamat, Anda telah")
          ? "lynch"
          : "idle";
      this.dead(1, type);
    }

    if (has(text, "patched you up", "menyembukan Anda")) {
      this.dead(-1, null);
    }
  }

  private dead(delta: number, type: "killed" | "lynch" | "idle" | null) {
    UserBots.incrementDead(
      delta,
      this.info.fullName,
      this.info.id,
      this.bot,
      type,
    );
  }

  private handleRoleMessage(): boolean {
    const { text } = this.msg;
    const fullName = this.info.fullName;

    if (
      has(
        text,
        "you're already in the game",
        "Anda sudah dalam game",
        "Anda baru saja keluar",
        "You just",
      )
    )
      return true;

    const match = text.match(EMOJI_ROLE_REGEX);
    const role = match?.[1]?.toLowerCase();
    Cache.set(`roleEmot${role}`, match?.[0]);

    if (role === "doctor" || role === "dokter") Cache.set(`doctor`, fullName);

    if (has(text, "is a new", "Lana baru") && !text.includes(fullName))
      return true;

    const becomes = has(text, "is a new", "You are the new", "baru")
      ? "sekarang adalah"
      : "-";
    this.notifyAdmin(`${this.mention} ${becomes} ${match?.[0]}`);
    UserBots.updateRoleCache(this.info.id, fullName, role);
    return false;
  }

  public editedMessageHandle() {
    if (this.isDisabled || this.msg.out) return;
    if (!this.msg.isPrivate || !this.fromMafiaBot) return;
    if (String(Cache.get("mode")) !== "afkmode") return;
    if (Cache.get(`allroleAfk`)) return;

    const { text, buttons } = this.msg;
    if (!buttons) return;

    const doctor = String(Cache.get(`doctor`));
    const candidates = buttons.filter(
      (b) => !b.text?.includes(doctor) && isCallback(b),
    );
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    const isDetectiveCheck =
      has(text, "Who will you check", "Siapa yang akan Anda periksa") &&
      Cache.get(`afkmodeDet`);

    if (isDetectiveCheck || has(text, "subject", "subjek")) {
      UserBots.clickButton(this.ctx, this.msg, pick);
    }
  }
}
