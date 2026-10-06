import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

import type {
  ClientRef,
  CommandAction,
  CommandArgs,
  CommandResults,
  GroupInfo,
  MainToWorker,
  MessagePayload,
  SharedState,
  UserInfo,
  WorkerToMain,
  ButtonPayload,
} from "../Types/types";

export type { ClientRef, UserInfo, MessagePayload, ButtonPayload, GroupInfo };

export interface WorkerManagerOptions {
  sessionStrings: string[];
  apiId: number;
  apiHash: string;
  workerCount: number;
  mafiaBotId: string;
  trueMafia: string;
  commandTimeoutMs?: number;
  onMessage: (ref: ClientRef, payload: MessagePayload) => void;
  onEditedMessage: (ref: ClientRef, payload: MessagePayload) => void;
  onConnected: (ref: ClientRef, user: UserInfo) => void;
  onJoinFailed: (ref: ClientRef, user: UserInfo | undefined) => void;
}

interface Pending {
  workerIndex: number;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const refKey = (w: number, c: number) => `${w}:${c}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FILE = import.meta.url.endsWith(".ts")
  ? "UserBotWorker.ts"
  : "UserBotWorker.js";

export class WorkerManager {
  private workers: Worker[] = [];
  private refs = new Map<string, ClientRef>();
  private users = new Map<string, UserInfo>();
  private pending = new Map<string, Pending>();
  private cmdCounter = 0;
  private lastState: SharedState = {
    groupTarget: "",
    joinMode: "",
    disabledIds: [],
    registrationHandled: false,
  };
  private lastStateJson = "";
  private readonly timeoutMs: number;

  constructor(private readonly opts: WorkerManagerOptions) {
    this.timeoutMs = opts.commandTimeoutMs ?? 30_000;

    const { sessionStrings } = opts;
    if (sessionStrings.length === 0) return;

    const workerCount = Math.max(
      1,
      Math.min(opts.workerCount, sessionStrings.length),
    );
    const chunkSize = Math.ceil(sessionStrings.length / workerCount);

    for (let w = 0; w * chunkSize < sessionStrings.length; w++) {
      this.spawn(w, sessionStrings.slice(w * chunkSize, (w + 1) * chunkSize));
    }
  }

  private spawn(w: number, chunk: string[]) {
    const worker = new Worker(path.join(__dirname, WORKER_FILE), {
      workerData: {
        sessionStrings: chunk,
        apiId: this.opts.apiId,
        apiHash: this.opts.apiHash,
        mafiaBotId: this.opts.mafiaBotId,
        trueMafia: this.opts.trueMafia,
      },
    });

    worker.on("message", (msg: WorkerToMain) => this.onWorkerMessage(w, msg));
    worker.on("error", (err) => {
      console.error(`[WORKER ${w}] error:`, err);
    });
    worker.on("exit", (code) => {
      console.error(`[WORKER ${w}] exit dengan kode ${code}`);
      this.rejectPendingOf(w, new Error(`Worker ${w} berhenti (code ${code})`));
    });

    this.post(worker, { type: "init" });
    this.post(worker, { type: "updateState", state: this.lastState });
    this.workers.push(worker);
  }

  private post(worker: Worker, msg: MainToWorker) {
    worker.postMessage(msg);
  }

  private onWorkerMessage(w: number, msg: WorkerToMain) {
    switch (msg.type) {
      case "connected": {
        const ref: ClientRef = {
          workerIndex: w,
          clientIndex: msg.clientIndex,
          userId: msg.user.id,
        };
        this.refs.set(refKey(w, msg.clientIndex), ref);
        this.users.set(msg.user.id, msg.user);
        this.opts.onConnected(ref, msg.user);
        return;
      }
      case "message":
      case "editedMessage": {
        const ref = this.refs.get(refKey(w, msg.clientIndex));
        if (!ref) return;
        if (msg.type === "message") this.opts.onMessage(ref, msg.payload);
        else this.opts.onEditedMessage(ref, msg.payload);
        return;
      }
      case "commandResult": {
        const p = this.pending.get(msg.cmdId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.cmdId);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "Command gagal"));
        return;
      }
      case "joinFailed": {
        const ref = this.refs.get(refKey(w, msg.clientIndex));
        if (ref) this.opts.onJoinFailed(ref, this.users.get(ref.userId));
        return;
      }
      case "log":
        console.log(msg.text);
        return;
    }
  }

  private rejectPendingOf(workerIndex: number, err: Error) {
    for (const [id, p] of this.pending) {
      if (p.workerIndex !== workerIndex) continue;
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  async shutdown() {
    await Promise.allSettled(this.workers.map((w) => w.terminate()));
  }

  getRefs(): ClientRef[] {
    return [...this.refs.values()].sort(
      (a, b) => a.workerIndex - b.workerIndex || a.clientIndex - b.clientIndex,
    );
  }

  getUser(userId: string): UserInfo | undefined {
    return this.users.get(userId);
  }

  getUsers(): UserInfo[] {
    return this.getRefs()
      .map((r) => this.users.get(r.userId))
      .filter((u): u is UserInfo => Boolean(u));
  }

  syncState(state: SharedState) {
    const json = JSON.stringify(state);
    if (json === this.lastStateJson) return;
    this.lastStateJson = json;
    this.lastState = state;
    this.workers.forEach((w) => this.post(w, { type: "updateState", state }));
  }

  call<A extends CommandAction>(
    ref: ClientRef,
    action: A,
    args: CommandArgs[A],
  ): Promise<CommandResults[A]> {
    const worker = this.workers[ref.workerIndex];
    if (!worker) return Promise.reject(new Error("Worker tidak ditemukan"));

    const cmdId = `cmd_${this.cmdCounter++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId);
        reject(new Error(`Command ${action} timeout`));
      }, this.timeoutMs);

      this.pending.set(cmdId, {
        workerIndex: ref.workerIndex,
        resolve,
        reject,
        timer,
      });
      this.post(worker, {
        type: "command",
        cmdId,
        clientIndex: ref.clientIndex,
        action,
        args,
      });
    });
  }

  clickButton(ref: ClientRef, msg: MessagePayload, btn: ButtonPayload) {
    if (!btn.type?.data) return Promise.reject(new Error("Tombol tanpa data"));
    return this.call(ref, "clickButton", {
      chatId: msg.chatId,
      msgId: msg.id,
      data: btn.type.data,
    });
  }

  sendMessage(ref: ClientRef, target: string, message: string) {
    return this.call(ref, "sendMessage", { target, message });
  }

  getGroupInfo(ref: ClientRef, target: string) {
    return this.call(ref, "getGroupInfo", { target });
  }

  async firstSuccess<T>(fn: (ref: ClientRef) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const ref of this.getRefs()) {
      try {
        return await fn(ref);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("Tidak ada userbot yang terhubung");
  }
}
