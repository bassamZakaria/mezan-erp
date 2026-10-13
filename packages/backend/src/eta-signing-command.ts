import { spawn } from "node:child_process";
import type { EtaCommandResult, EtaCommandRunner } from "@mezan/domain";

/**
 * Runs the operator's CAdES-BES signing program: canonical JSON on stdin, the
 * signature value on stdout.
 *
 * SECURITY: spawned WITHOUT a shell and with the argument vector the operator
 * configured, so a signing command containing shell metacharacters cannot turn
 * into a second command. The document being signed never touches a temp file.
 */
const SIGNING_TIMEOUT_MS = 60_000;
const TIMED_OUT_EXIT_CODE = -1;

export function createSigningCommandRunner(timeoutMs: number = SIGNING_TIMEOUT_MS): EtaCommandRunner {
  return (command, args, stdin) =>
    new Promise<EtaCommandResult>((resolve, reject) => {
      const child = spawn(command, [...args], { shell: false, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          const seconds = Math.ceil(timeoutMs / 1000);
          resolve({ code: TIMED_OUT_EXIT_CODE, stdout: "", stderr: `لم ينتهِ برنامج التوقيع خلال ${seconds} ثانية فأُوقف.` });
          return;
        }
        resolve({ code: code ?? TIMED_OUT_EXIT_CODE, stdout, stderr });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(stdin, "utf8");
    });
}

export const runExternalSigningCommand: EtaCommandRunner = createSigningCommandRunner();
