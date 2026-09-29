import { EventEmitter } from "events";

export const GameLoopEvents = new EventEmitter();

interface Candidate {
  id: string;
  respond: () => Promise<any>;
}

let candidates: Candidate[] = [];
let cursor = 0;
let intervalId: NodeJS.Timeout | null = null;
let attempts = 0;
let consecutiveFailures = 0;

const MAX_ATTEMPTS = 150;
const MAX_CONSECUTIVE_FAILURES = 3;
const INTERVAL_MS = 2000;

const resetLoopState = () => {
  candidates = [];
  cursor = 0;
  attempts = 0;
  consecutiveFailures = 0;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

const tick = () => {
  attempts++;
  if (attempts > MAX_ATTEMPTS) {
    resetLoopState();
    GameLoopEvents.emit("gameLoopGaveUp");
    return;
  }

  const current = candidates[cursor];
  if (!current) return;

  current
    .respond()
    .then(() => {
      consecutiveFailures = 0;
    })
    .catch(() => {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        GameLoopEvents.emit("candidateFailed", current.id);
        consecutiveFailures = 0;
        cursor++;
      }
    });
};

GameLoopEvents.on(
  "gameOverDetected",
  (id: string, respond: () => Promise<any>) => {
    if (candidates.some((c) => c.id === id)) return;

    candidates.push({ id, respond });

    if (!intervalId) {
      intervalId = setInterval(tick, INTERVAL_MS);
      tick();
    }
  },
);

GameLoopEvents.on("registrationDetected", () => {
  resetLoopState();
});
