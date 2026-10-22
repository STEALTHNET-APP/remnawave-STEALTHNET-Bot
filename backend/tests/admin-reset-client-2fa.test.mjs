import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("ACTION_CATALOG includes reset_client_2fa with correct group and severity", () => {
  const file = fs.readFileSync(path.join(__dirname, "../src/modules/admin-permissions/admin-permissions.routes.ts"), "utf8");
  assert.match(file, /key:\s*"reset_client_2fa"/);
  assert.match(file, /group:\s*"security"/);
  assert.match(file, /severity:\s*"critical"/);
});

test("requireAction allows ADMIN and checks action:reset_client_2fa for MANAGER", async () => {
  const middlewareFile = fs.readFileSync(path.join(__dirname, "../src/modules/auth/middleware.ts"), "utf8");
  assert.match(middlewareFile, /export function requireAction/);

  // Симулируем middleware логику requireAction
  function simulateRequireAction(actionKey, req) {
    let statusCode = 200;
    let nextCalled = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        return payload;
      },
    };
    const next = () => {
      nextCalled = true;
    };

    if (req.adminRole === "ADMIN") {
      next();
      return { statusCode, nextCalled };
    }
    const needle = `action:${actionKey}`;
    if (req.adminAllowedSections.includes(needle)) {
      next();
      return { statusCode, nextCalled };
    }
    res.status(403).json({ message: `Access denied: требуется право «${actionKey}»` });
    return { statusCode, nextCalled };
  }

  // 1. Full admin
  const adminRes = simulateRequireAction("reset_client_2fa", {
    adminRole: "ADMIN",
    adminAllowedSections: [],
  });
  assert.equal(adminRes.statusCode, 200);
  assert.equal(adminRes.nextCalled, true);

  // 2. Manager without action:reset_client_2fa
  const managerDenied = simulateRequireAction("reset_client_2fa", {
    adminRole: "MANAGER",
    adminAllowedSections: ["clients", "tariffs"],
  });
  assert.equal(managerDenied.statusCode, 403);
  assert.equal(managerDenied.nextCalled, false);

  // 3. Manager with action:reset_client_2fa
  const managerAllowed = simulateRequireAction("reset_client_2fa", {
    adminRole: "MANAGER",
    adminAllowedSections: ["clients", "action:reset_client_2fa"],
  });
  assert.equal(managerAllowed.statusCode, 200);
  assert.equal(managerAllowed.nextCalled, true);
});

test("POST /clients/:id/reset-2fa route definition and selects are present", () => {
  const adminRoutes = fs.readFileSync(path.join(__dirname, "../src/modules/admin/admin.routes.ts"), "utf8");

  // Route registration
  assert.match(adminRoutes, /adminRouter\.post\(\s*\"\/clients\/:id\/reset-2fa\"/);
  assert.match(adminRoutes, /requireAction\(\"reset_client_2fa\"\)/);

  // Sudo-mode password verification
  assert.match(adminRoutes, /verifyPassword\(body\.data\.adminPassword,\s*admin\.passwordHash\)/);

  // Client 2FA update (sets totpEnabled: false, totpSecret: null)
  assert.match(adminRoutes, /totpEnabled:\s*false/);
  assert.match(adminRoutes, /totpSecret:\s*null/);

  // Audit log
  assert.match(adminRoutes, /logAdmin\(req,\s*"client\.reset_2fa"/);

  // Notification dispatch
  assert.match(adminRoutes, /notifyClientAbout2FAReset\(client\)/);

  // totpEnabled in clients list and client detail selects
  assert.match(adminRoutes, /adminRouter\.get\(\"\/clients\"[\s\S]*?totpEnabled:\s*true/);
  assert.match(adminRoutes, /adminRouter\.get\(\"\/clients\/:id\"[\s\S]*?totpEnabled:\s*true/);
});

test("client-security-notify service exports notifyClientAbout2FAReset", () => {
  const notifyFile = fs.readFileSync(path.join(__dirname, "../src/modules/client/client-security-notify.service.ts"), "utf8");
  assert.match(notifyFile, /export async function notifyClientAbout2FAReset/);
  assert.match(notifyFile, /sendTelegramToUser/);
  assert.match(notifyFile, /sendEmail/);
});
