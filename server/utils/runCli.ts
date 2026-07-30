// import { execFile } from "node:child_process";
// import { promisify } from "node:util";

// const execFileAsync = promisify(execFile);

// const isWindows = process.platform === "win32";


// export async function runCliWithStdin(
//   bin: string,
//   args: string[],
//   prompt: string,
//   opts: { timeoutMs?: number; maxBuffer?: number } = {}
// ): Promise<{ stdout: string; stderr: string }> {
//   const finalArgs = isWindows ? args.map(quoteWinArg) : args;
//   const child = execFileAsync(bin, finalArgs, {
//     shell: isWindows,
//     windowsHide: true,
//     maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
//     timeout: opts.timeoutMs ?? 180_000,
//   });
//   child.child.stdin?.end(prompt);
//   return child;
// }


// function quoteWinArg(arg: string): string {
//   return /[\s"&|<>^()%!]/.test(arg) ? `"${arg}"` : arg;
// }


// export function isCliMissing(err: unknown): boolean {
//   const e = err as { code?: string; stderr?: string; message?: string } | undefined;
//   if (e?.code === "ENOENT") return true;
//   const text = String(e?.stderr || e?.message || "");
//   return /is not recognized|command not found|cannot find the (path|file)|no such file/i.test(text);
// }




import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export class CliExecutionError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "CliExecutionError";
  }
}

function withoutCertificateWarnings(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => !/ignoring extra certs|NODE_EXTRA_CA_CERTS/i.test(line))
    .join("\n")
    .trim();
}

function failureMessage(stdout: string, stderr: string, code: number | null): string {
  return (
    withoutCertificateWarnings(stderr) ||
    withoutCertificateWarnings(stdout) ||
    `Claude CLI exited with code ${code ?? "unknown"}.`
  );
}

function quoteWindowsArg(arg: string): string {
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function runCliWithStdin(
  bin: string,
  args: string[],
  prompt: string,
  opts: {
    timeoutMs?: number;
    maxBuffer?: number;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    const extraCertPath = childEnv.NODE_EXTRA_CA_CERTS;
    if (extraCertPath && !existsSync(extraCertPath)) {
      delete childEnv.NODE_EXTRA_CA_CERTS;
    }

    const isWindows = process.platform === "win32";
    const command = isWindows
      ? [bin, ...args].map(quoteWindowsArg).join(" ")
      : bin;
    const child = spawn(command, isWindows ? [] : args, {
      shell: isWindows,
      windowsHide: true,
      env: childEnv,
    });
 
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTooLarge = false;
    const maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024;
 
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length + stderr.length > maxBuffer) {
        outputTooLarge = true;
        child.kill();
      }
    });
 
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stdout.length + stderr.length > maxBuffer) {
        outputTooLarge = true;
        child.kill();
      }
    });
 
    child.on("error", reject);
 
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const message = timedOut
          ? `Claude CLI timed out after ${opts.timeoutMs}ms.`
          : outputTooLarge
            ? `Claude CLI output exceeded ${maxBuffer} bytes.`
            : failureMessage(stdout, stderr, code);
        reject(new CliExecutionError(message, code, stdout, stderr));
      }
    });
 
    child.stdin.write(prompt);
    child.stdin.end();
 
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : undefined;
  });
}
 
