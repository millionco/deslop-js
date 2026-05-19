import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DESLOP_PACKAGE_DIR } from "../constants.js";

export const buildDeslop = async (): Promise<{ ok: boolean; logTail: string }> => {
  return new Promise((resolvePromise) => {
    const child = spawn("pnpm", ["build"], {
      cwd: resolve(DESLOP_PACKAGE_DIR, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
    }, 240_000);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      const combined =
        Buffer.concat(stdoutChunks).toString("utf-8") +
        Buffer.concat(stderrChunks).toString("utf-8");
      const tail = combined.split("\n").slice(-25).join("\n");
      resolvePromise({ ok: exitCode === 0, logTail: tail });
    });
    child.on("error", (childError) => {
      clearTimeout(timeoutHandle);
      resolvePromise({ ok: false, logTail: String(childError) });
    });
  });
};
