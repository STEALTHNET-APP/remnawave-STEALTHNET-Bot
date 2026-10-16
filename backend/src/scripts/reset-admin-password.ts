import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { prisma } from "../db.js";
import { resetAdminPassword, validateRecoveryPassword } from "../modules/auth/reset-admin-password.js";

function question(prompt: string, secret = false): Promise<string> {
  const output = secret ? new Writable({ write(_chunk, _encoding, callback) { callback(); } }) : process.stdout;
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.on("SIGINT", () => { rl.close(); });
    rl.on("close", () => { if (!answered) reject(new Error("Отменено")); });
    rl.question("", answer => {
      answered = true;
      rl.close();
      if (secret) process.stdout.write("\n");
      resolve(answer);
    });
    process.stdout.write(prompt);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Сброс пароля администратора: node dist/scripts/reset-admin-password.js [--email admin@example.com]");
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--email" || !args[1])) throw new Error("Допустим только параметр --email. Пароль вводится интерактивно.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Запустите команду в терминале: docker compose exec api node dist/scripts/reset-admin-password.js");
  const email = args[1] ?? await question("Email администратора: ");
  const password = await question("Новый пароль (ввод скрыт): ", true);
  validateRecoveryPassword(password);
  const confirmation = await question("Повторите пароль: ", true);
  if (password !== confirmation) throw new Error("Пароли не совпадают. Изменения не внесены.");
  const admin = await resetAdminPassword(email, password);
  console.log(`Пароль изменён для ${admin.email}.`);
  console.log("Токены продления сеансов удалены. Уже выданные access-токены действуют до истечения своего срока.");
  if (admin.totpEnabled) console.log("Двухфакторная аутентификация сохранена: при входе потребуется код 2FA.");
}

main().catch(error => {
  console.error(error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "Не удалось сбросить пароль. Проверьте подключение к базе.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
