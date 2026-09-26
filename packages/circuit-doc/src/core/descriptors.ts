// "./descriptors" export: the isomorphic v1 descriptor contract shared by the
// generator (encode) and the MDX components / islands (decode). No node:*
// imports anywhere in this closure — it is bundled into the island client chunk.
export * from "./model-descriptor.ts";
export * from "./reference-descriptor.ts";
