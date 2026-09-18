import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A LOG FILE, because `console.error` on a double-clicked app goes nowhere.
 *
 * Every startup failure this product can have — no OS keyring, a damaged
 * `client.json`, an encrypted database it cannot open, a licence it cannot
 * verify — was written to a console that a shop owner launching from the Dock
 * or the Start menu never sees, and then the process exited. The support call
 * that follows is «البرنامج لا يفتح», with nothing on either end of the phone
 * to go on. The audit put that first in expected ticket volume.
 *
 * This is deliberately thirty lines rather than a dependency: appending a line
 * to a file and rotating it at a size is the whole requirement, and a logging
 * framework in the main process would be a second thing to keep working on the
 * one machine holding the books.
 */

/** Rotate at 1 MB, keeping one previous file. Two files is enough to read back. */
const MAX_BYTES = 1_000_000;

export interface FileLogger {
  (message: string): void;
  readonly filePath: string;
}

export function createFileLogger(logsDir: string, fileName = "mezan.log"): FileLogger {
  const filePath = path.join(logsDir, fileName);
  const previous = path.join(logsDir, `${path.parse(fileName).name}.1.log`);

  const write = (message: string): void => {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      mkdirSync(logsDir, { recursive: true });
      try {
        if (statSync(filePath).size > MAX_BYTES) renameSync(filePath, previous);
      } catch {
        // No file yet, or the rename raced another process. Append anyway.
      }
      appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
    } catch {
      // A log write must NEVER be the reason the app fails to start.
    }
    // Still to the console: `pnpm start` and CI read it there.
    console.log(message);
  };

  return Object.assign(write, { filePath });
}
