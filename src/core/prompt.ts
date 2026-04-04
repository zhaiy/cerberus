import * as readline from "node:readline";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isTty = process.stdin.isTTY;
    if (isTty) {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
    }

    let value = "";

    const onData = (char: Buffer) => {
      for (const byte of char) {
        // Enter
        if (byte === 0x0d || byte === 0x0a) {
          if (isTty) {
            process.stdin.setRawMode(false);
          }
          process.stdout.write("\n");
          process.stdin.removeListener("data", onData);
          resolve(value);
          return;
        }
        // Ctrl+C
        if (byte === 0x03) {
          if (isTty) {
            process.stdin.setRawMode(false);
          }
          process.stdin.removeListener("data", onData);
          reject(new Error("Aborted"));
          return;
        }
        // Backspace / Delete
        if (byte === 0x7f || byte === 0x08) {
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };

    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

export async function promptPassword(field: string): Promise<string> {
  return readHidden(`${field}: `);
}

async function readAllFromStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

async function readStdinLines(expectedLines: number): Promise<string[]> {
  const raw = await readAllFromStdin();
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length < expectedLines) {
    throw new Error("Missing password input on stdin.");
  }
  return lines.slice(0, expectedLines);
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    readStdinLines(1).then(
      ([line]) => resolve(line),
      (error) => reject(error),
    );
  });
}

export function promptLine(field: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${field}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptPasswordWithConfirmation(): Promise<string> {
  const password = await readHidden("Master password: ");
  validateMasterPassword(password);
  const confirm = await readHidden("Confirm master password: ");
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }
  return password;
}

export function validateMasterPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Master password must be at least 8 characters.");
  }
}

export async function readPasswordFromStdin(): Promise<string> {
  return readLineFromStdin();
}

export async function readPasswordWithConfirmationFromStdin(): Promise<string> {
  const [password, confirm] = await readStdinLines(2);
  validateMasterPassword(password);
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }
  return password;
}
