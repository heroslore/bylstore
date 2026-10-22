// Registra o loader que troca @netlify/blobs por um store em memória e define o global Netlify.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./loader.mjs", pathToFileURL(new URL(".", import.meta.url).pathname + "/"));
globalThis.__env = { SYNC_KEY: "senha-teste" };
globalThis.Netlify = { env: { get: (k) => globalThis.__env[k] } };
