import { parentPort, workerData } from "worker_threads";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage, EditedMessage } from "teleproto/events/index.js";
import { generateRandomBigInt } from "teleproto/Helpers.js";
import { LogLevel } from "teleproto/extensions/Logger.js";
import { getPeerId } from "teleproto/Utils.js";
import type {
  ButtonPayload,
  CommandArgs,
  CommandAction,
  CommandResults,
  MainToWorker,
  MessagePayload,
  SharedState,
  WorkerToMain,
} from "../Types/types";

const { sessionStrings, apiId, apiHash, mafiaBotId, trueMafia } =
  workerData as {
    sessionStrings: string[];
    apiId: number;
    apiHash: string;
    mafiaBotId: string;
    trueMafia: string;
  };

interface Slot {
  client: TelegramClient;
  userId: string;
  mafiaEntity: any | null;
}

const port = parentPort!;
const slots: Slot[] = [];
const peerCache = new Map<string, any>();

let state: SharedState = {
  groupTarget: "",
  joinMode: "",
  disabledIds: [],
  registrationHandled: false,
};
let disabledSet = new Set<string>();

const send = (m: WorkerToMain) => port.postMessage(m);
const log = (text: string) => send({ type: "log", text });

const serializeButtons = (msg: any): ButtonPayload[] | null => {
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return null;
  return msg.replyMarkup.rows.flatMap((row: any) =>
    row.buttons.map((b: any): ButtonPayload => ({
      text: b.text,
      type: b.type && {
        className: b.type.className,
        data: b.type.data ? Array.from(b.type.data as Uint8Array) : undefined,
        url: b.type.url,
      },
    })),
  );
};

const serializeMsg = (msg: any): MessagePayload => {
  const chatId = String(msg.chatId);
  if (msg.peerId) {
    if (peerCache.size > 500) peerCache.clear();
    peerCache.set(chatId, msg.peerId);
  }
  return {
    id: msg.id,
    chatId,
    senderId: String(msg.senderId),
    text: msg.text ?? "",
    out: Boolean(msg.out),
    isPrivate: Boolean(msg.isPrivate),
    date: Number(msg.date),
    buttons: serializeButtons(msg),
  };
};

const botUsername = trueMafia.replace(/^@/, "").toLowerCase();
const handledRegistrations = new Set<string>();
const handledAttention = new Set<string>();

const remember = (set: Set<string>, key: string) => {
  set.add(key);
  if (set.size > 100) set.delete(set.values().next().value as string);
};

const findJoinUrl = (msg: any): string | null => {
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return null;
  for (const row of msg.replyMarkup.rows) {
    for (const b of row.buttons) {
      const url: string | undefined =
        b.type?.className === "InlineButtonTypeUrl" ? b.type.url : undefined;
      if (!url || !/^https:\/\/t\.me\//i.test(url) || !url.includes("start="))
        continue;
      if (!/^\d+$/.test(botUsername)) {
        const name = new URL(url).pathname.replace(/^\//, "").toLowerCase();
        if (name !== botUsername) continue;
      }
      return url;
    }
  }
  return null;
};

const handleRegistrationJoin = (
  chatId: string,
  url: string,
) => {
  if (chatId !== state.groupTarget) return;

  const startParam = new URL(url).searchParams.get("start");
  if (!startParam) return;

  const key = `${chatId}:${startParam}`;
  if (handledRegistrations.has(key)) return;

  remember(handledRegistrations, key);
  send({ type: "joined" });
  for (const slot of slots) {
    if (!slot || disabledSet.has(slot.userId) || !slot.mafiaEntity) continue;

    slot.client
      .invoke(
        new Api.messages.SendMessage({
          peer: slot.mafiaEntity,
          message: `/start ${startParam}`,
          randomId: generateRandomBigInt(),
        }),
      )
      .catch(() => {});
    // slot.client
    //   .invoke(
    //     new Api.messages.StartBot({
    //       bot: slot.mafiaEntity,
    //       peer: slot.mafiaEntity,
    //       randomId: generateRandomBigInt(),
    //       startParam,
    //     }),
    //   )
    //   .catch(() => {});
  }
};

const handleAttentionJoin = (idx: number, msg: any) => {
  const slot = slots[idx];
  if (!slot || state.joinMode !== "next") return;
  if (msg.peerId?.className !== "PeerUser") return;
  if (disabledSet.has(slot.userId)) return;

  const text: string = msg.message ?? msg.text ?? "";
  if (!text.includes("Attention!") && !text.includes("Perhatian!")) return;
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return;

  const btn = msg.replyMarkup.rows
    .flatMap((r: any) => r.buttons)
    .find(
      (b: any) =>
        (b.text?.includes("Join") || b.text?.includes("Gabung")) &&
        b.type?.className === "InlineButtonTypeCallback" &&
        b.type?.data,
    );
  if (!btn) return;

  slot.client
    .invoke(
      new Api.messages.GetBotCallbackAnswer({
        peer: msg.peerId,
        msgId: msg.id,
        data: btn.type.data,
      }),
    )
    .catch(() => send({ type: "joinFailed", clientIndex: idx }));
};

const botNumericId = /^\d+$/.test(String(mafiaBotId))
  ? String(mafiaBotId)
  : null;

const senderIdOf = (m: any): string | null => {
  if (m.fromId?.userId != null) return String(m.fromId.userId);
  if (m.peerId?.className === "PeerUser") return String(m.peerId.userId);
  return null;
};

const peekRaw = (update: any, idx: number, noDispatch?: boolean) => {
  if (noDispatch) return;
  if (!["direct", "next"].includes(state.joinMode)) return;
  const t0 = performance.now();

  const list: any[] =
    update instanceof Api.Updates || update instanceof Api.UpdatesCombined
      ? update.updates
      : update instanceof Api.UpdateShort
        ? [update.update]
        : [update];

  for (const u of list) {
    const c = u?.className;
    if (c !== "UpdateNewMessage" && c !== "UpdateNewChannelMessage") continue;

    const m = u.message;
    if (!m || m.className !== "Message" || m.out) continue;
    if (Date.now() / 1000 - (m.editDate ?? m.date) > 60) continue;
    if (botNumericId && senderIdOf(m) !== botNumericId) continue;

    if (state.joinMode === "next") handleAttentionJoin(idx, m);

    const url = findJoinUrl(m);
    if (!url || !m.peerId) continue;

    handleRegistrationJoin(String(getPeerId(m.peerId)), url);
    return;
  }
};

const measurePing = async (client: TelegramClient, n = 3) => {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await client.invoke(new Api.Ping({ pingId: generateRandomBigInt() }));
    samples.push(performance.now() - t);
  }
  return Math.min(...samples);
};

const clients = new Map<number, TelegramClient>();
let shuttingDown = false;
let initDone: Promise<unknown> = Promise.resolve();
const initClient = async (ss: string, idx: number) => {
  const client = new TelegramClient(new StringSession(ss), apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });
  clients.set(idx, client);

  const um = (client as any).updateManager;
  const origOnUpdates = um.onUpdates.bind(um);
  um.onUpdates = (u: any, noDispatch?: boolean) => {
    try {
      peekRaw(u, idx, noDispatch);
    } catch {}
    return origOnUpdates(u, noDispatch);
  };

  await client.connect();
  if (shuttingDown) return;
  const me: any = await client.getMe();
  await client.invoke(new Api.updates.GetState()).catch(() => {});
  const mafiaEntity = await client.getEntity(trueMafia).catch(() => null);
  client.setLogLevel(LogLevel.NONE);
  slots[idx] = { client, userId: String(me.id), mafiaEntity };
  const ping = await measurePing(client).catch(() => -1);
  log(
    `[init] ${me.id} (${me.firstName}) dc=${(client.session as any).dcId} ping=${ping.toFixed(0)}ms workerClient=${idx}`,
  );

  client.addEventHandler(
    (event: any) => {
      const msg = event.message;
      if (msg.out) return;
      send({ type: "message", clientIndex: idx, payload: serializeMsg(msg) });
    },
    new NewMessage({ fromUsers: [mafiaBotId] }),
  );

  client.addEventHandler(
    (event: any) => {
      const msg = event.message;
      if (msg.out) return;
      send({
        type: "editedMessage",
        clientIndex: idx,
        payload: serializeMsg(msg),
      });
    },
    new EditedMessage({ fromUsers: [mafiaBotId] }),
  );

  const firstName = me.firstName ?? "";
  const lastName = me.lastName ?? undefined;
  send({
    type: "connected",
    clientIndex: idx,
    user: {
      id: String(me.id),
      firstName,
      lastName,
      username: me.username ?? undefined,
      fullName: lastName ? `${firstName} ${lastName}` : firstName,
    },
  });
};

const runCommand = async <A extends CommandAction>(
  slot: Slot,
  action: A,
  args: CommandArgs[A],
): Promise<CommandResults[A]> => {
  switch (action) {
    case "clickButton": {
      const a = args as CommandArgs["clickButton"];
      const peer = peerCache.get(a.chatId);
      if (!peer) throw new Error(`Peer untuk chat ${a.chatId} tidak ditemukan`);
      await slot.client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer,
          msgId: a.msgId,
          data: Buffer.from(a.data),
        }),
      );
      return undefined as CommandResults[A];
    }
    case "sendMessage": {
      const a = args as CommandArgs["sendMessage"];
      const entity = await slot.client.getEntity(a.target);
      await slot.client.sendMessage(entity, { message: a.message });
      return undefined as CommandResults[A];
    }
    case "getGroupInfo": {
      const a = args as CommandArgs["getGroupInfo"];
      const entity: any = await slot.client.getEntity(a.target);
      const participants = await slot.client.getParticipants(entity, {
        limit: 0,
      });
      return {
        id: String(entity.id),
        title: entity.title,
        username: entity.username,
        total: participants.total,
      } as CommandResults[A];
    }
    default:
      throw new Error(`Action tidak dikenal: ${String(action)}`);
  }
};

port.on("message", async (msg: MainToWorker) => {
  switch (msg.type) {
    case "init": {
      initDone = Promise.allSettled(
        sessionStrings.map((ss, i) => initClient(ss, i)),
      ).then((results) => {
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            log(`Gagal init userbot #${i}: ${r.reason?.message ?? r.reason}`);
            clients
              .get(i)
              ?.destroy()
              .catch(() => {});
          }
        });
      });
      await initDone;
      return;
    }

    case "shutdown": {
      shuttingDown = true;
      initDone
        .then(() =>
          Promise.allSettled([...clients.values()].map((c) => c.destroy())),
        )
        .then(() => send({ type: "shutdownDone" }));
      return;
    }

    case "updateState": {
      const next = msg.state;
      state = next;
      disabledSet = new Set(next.disabledIds);
      return;
    }

    case "command": {
      const slot = slots[msg.clientIndex];
      if (!slot || shuttingDown) throw new Error("Client belum terhubung");
      try {
        if (!slot) throw new Error("Client belum terhubung");
        const data = await runCommand(slot, msg.action, msg.args as any);
        send({ type: "commandResult", cmdId: msg.cmdId, ok: true, data });
      } catch (err: any) {
        send({
          type: "commandResult",
          cmdId: msg.cmdId,
          ok: false,
          error:
            [err?.errorMessage, err?.message].filter(Boolean).join(" | ") ||
            String(err),
        });
      }
      return;
    }
  }
});

process.on("unhandledRejection", (err: any) =>
  log(`[worker] unhandledRejection: ${err?.message ?? err}`),
);
