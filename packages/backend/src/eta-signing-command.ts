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
export const runExternalSigningCommand: EtaCommandRunner = (command, args, stdin) =>
  new Promise<EtaCommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin, "utf8");
  });
