import { Buffer as BufferPolyfill } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BufferPolyfill;
}
