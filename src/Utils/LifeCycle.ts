type Handler = (restart: boolean) => void;
let handler: Handler | undefined;

export const Lifecycle = {
  register(fn: Handler) {
    handler = fn;
  },
  restart() {
    if (handler) handler(true);
    else process.exit(0);
  },
};
