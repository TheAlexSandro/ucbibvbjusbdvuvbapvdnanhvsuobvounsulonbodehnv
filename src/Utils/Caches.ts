import NodeCache from "node-cache";

export const Cache = new NodeCache({
  useClones: false,
});
