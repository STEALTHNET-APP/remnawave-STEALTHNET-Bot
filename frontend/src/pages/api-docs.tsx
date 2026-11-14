import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Code, Key, Shield, Server, Users, CreditCard, Smartphone, AlertTriangle } from "lucide-react";

const base = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "https://your-domain.tld/api/v1";

type Field = { name: string; type: string; req?: boolean; desc: string };
type Endpoint = {
  method: string;
  path: string;
  desc: string;
  auth: "API Key" | "Client JWT";
  query?: Field[];
  body?: Field[];
  res: string;
};
type Category = { category: string; icon: React.ReactNode; items: Endpoint[] };

const CLIENT_OBJ = `{
  "id": "cmq7dz...",
  "email": "user@example.com",
  "telegramId": null,
  "telegramUsername": null,
  "preferredLang": "ru",
  "preferredCurrency": "RUB",
  "balance": 150.0,
  "referralCode": "AB12CD",
  "referralPercent": null,
  "remnawaveUuid": "6f0e...-uuid",
  "trialUsed": false,
  "isBlocked": false,
  "totpEnabled": false,
  "createdAt": "2026-07-02T10:00:00.000Z",
  "autoRenewEnabled": false,
  "autoRenewTariffId": null
}`;

const endpoints: Category[] = [
  {
    category: "Аутентификация",
    icon: <Shield className="h-4 w-4" />,
    items: [
      {
        method: "POST",
        path: "/auth/login",
        desc: "Вход клиента по email и паролю. Если у клиента включён 2FA — вернёт tempToken для шага /auth/2fa.",
        auth: "API Key",
        body: [
          { name: "email", type: "string", req: true, desc: "Email клиента" },
          { name: "password", type: "string", req: true, desc: "Пароль" },
        ],
        res: `// без 2FA:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": ${CLIENT_OBJ.split("\n").join("\n  ")}
}

// если включён 2FA:
{ "requires2FA": true, "tempToken": "eyJ..." }`,
      },
      {
        method: "POST",
        path: "/auth/2fa",
        desc: "Подтверждение входа кодом 2FA (после /auth/login с requires2FA).",
        auth: "API Key",
        body: [
          { name: "tempToken", type: "string", req: true, desc: "Из ответа /auth/login" },
          { name: "code", type: "string", req: true, desc: "6-значный код из приложения-аутентификатора" },
        ],
        res: `{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": { ... }
}`,
      },
      {
        method: "POST",
        path: "/auth/register",
        desc: "Регистрация нового клиента. Возвращает готовый Client JWT (без подтверждения почты).",
        auth: "API Key",
        body: [
          { name: "email", type: "string", req: true, desc: "Email" },
          { name: "password", type: "string", req: true, desc: "Пароль, минимум 6 символов" },
          { name: "referralCode", type: "string", desc: "Реферальный код пригласившего (опц.)" },
          { name: "preferredLang", type: "string", desc: "Язык, по умолчанию \"ru\"" },
          { name: "preferredCurrency", type: "string", desc: "Валюта, по умолчанию \"RUB\"" },
        ],
        res: `// 201 Created
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": { ... }
}`,
      },
    ],
  },
  {
    category: "Профиль клиента",
    icon: <Users className="h-4 w-4" />,
    items: [
      {
        method: "GET",
        path: "/client/profile",
        desc: "Профиль авторизованного клиента.",
        auth: "Client JWT",
        res: CLIENT_OBJ,
      },
      {
        method: "PATCH",
        path: "/client/profile",
        desc: "Обновить язык и/или валюту клиента.",
        auth: "Client JWT",
        body: [
          { name: "preferredLang", type: "string", desc: "Новый язык (опц.)" },
          { name: "preferredCurrency", type: "string", desc: "Новая валюта (опц.)" },
        ],
        res: "// обновлённый объект client (как в GET /client/profile)",
      },
      {
        method: "GET",
        path: "/client/referrals",
        desc: "Реферальный код, процент, число рефералов и суммарный заработок.",
        auth: "Client JWT",
        res: `{
  "referralCode": "AB12CD",
  "referralPercent": 10,
  "referralsCount": 3,
  "totalEarnings": 240.0
}`,
      },
    ],
  },
  {
    category: "Финансы",
    icon: <CreditCard className="h-4 w-4" />,
    items: [
      {
        method: "GET",
        path: "/client/balance",
        desc: "Текущий баланс клиента.",
        auth: "Client JWT",
        res: `{ "balance": 150.0 }`,
      },
      {
        method: "GET",
        path: "/client/payments",
        desc: "История платежей клиента (по убыванию даты).",
        auth: "Client JWT",
        query: [
          { name: "limit", type: "number", desc: "Сколько вернуть, 1–100 (по умолч. 50)" },
          { name: "offset", type: "number", desc: "Смещение для пагинации (по умолч. 0)" },
        ],
        res: `{
  "payments": [
    {
      "id": "cmq...",
      "orderId": "ORD-123",
      "amount": 200.0,
      "currency": "RUB",
      "status": "PAID",
      "provider": "platega",
      "tariffId": "cmq...",
      "createdAt": "2026-07-01T12:00:00.000Z",
      "paidAt": "2026-07-01T12:01:30.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}`,
      },
    ],
  },
  {
    category: "Подписка и услуги",
    icon: <Smartphone className="h-4 w-4" />,
    items: [
      {
        method: "GET",
        path: "/client/subscription",
        desc: "Данные подписки клиента из Remnawave (сквады, срок, трафик, ссылка).",
        auth: "Client JWT",
        res: `// есть подписка:
{ "active": true, "subscription": { /* объект Remnawave user */ } }

// нет подписки:
{ "active": false, "message": "No subscription" }`,
      },
      {
        method: "GET",
        path: "/client/devices",
        desc: "Список устройств (HWID), привязанных к подписке.",
        auth: "Client JWT",
        res: `{
  "total": 2,
  "devices": [ { /* устройство Remnawave HWID */ } ]
}`,
      },
      {
        method: "GET",
        path: "/client/proxy-slots",
        desc: "Активные прокси-слоты клиента (хост, логин/пароль, трафик, лимиты).",
        auth: "Client JWT",
        res: `[
  {
    "id": "cmq...",
    "host": "proxy.example.com",
    "login": "u123",
    "password": "p456",
    "expiresAt": "2026-08-01T00:00:00.000Z",
    "trafficUsedBytes": 1048576,
    "trafficLimitBytes": null,
    "connectionLimit": 5,
    "currentConnections": 1,
    "status": "ACTIVE",
    "createdAt": "2026-07-01T00:00:00.000Z"
  }
]`,
      },
      {
        method: "GET",
        path: "/client/singbox-slots",
        desc: "Активные sing-box слоты клиента.",
        auth: "Client JWT",
        res: `[
  {
    "id": "cmq...",
    "userIdentifier": "sb_user_123",
    "expiresAt": "2026-08-01T00:00:00.000Z",
    "trafficUsedBytes": 1048576,
    "trafficLimitBytes": null,
    "currentConnections": 0,
    "status": "ACTIVE",
    "createdAt": "2026-07-01T00:00:00.000Z"
  }
]`,
      },
    ],
  },
  {
    category: "Публичные данные (без Client JWT)",
    icon: <BookOpen className="h-4 w-4" />,
    items: [
      {
        method: "GET",
        path: "/tariffs",
        desc: "Каталог VPN-тарифов, сгруппированных по категориям.",
        auth: "API Key",
        res: `[
  {
    "id": "cat_1",
    "name": "Основные",
    "tariffs": [
      {
        "id": "cmq...",
        "name": "1 месяц",
        "description": "Безлимит",
        "durationDays": 30,
        "trafficLimitBytes": null,
        "trafficResetMode": "MONTH",
        "deviceLimit": 3,
        "price": 200.0,
        "currency": "RUB"
      }
    ]
  }
]`,
      },
      {
        method: "GET",
        path: "/proxy-tariffs",
        desc: "Каталог прокси-тарифов (только включённые), по категориям.",
        auth: "API Key",
        res: `[ { "id": "...", "name": "...", "tariffs": [ /* прокси-тарифы */ ] } ]`,
      },
      {
        method: "GET",
        path: "/singbox-tariffs",
        desc: "Каталог sing-box тарифов (только включённые), по категориям.",
        auth: "API Key",
        res: `[ { "id": "...", "name": "...", "tariffs": [ /* sing-box тарифы */ ] } ]`,
      },
      {
        method: "GET",
        path: "/config",
        desc: "Публичная конфигурация проекта (название, логотип, валюта, включённые платёжные методы, флаги функций и т.п.).",
        auth: "API Key",
        res: `{
  "serviceName": "STEALTHNET",
  "cabinetDesign": "stealth",
  "multiSubscriptionsEnabled": true,
  "passwordResetEnabled": true,
  "smtpConfigured": true,
  ...
}`,
      },
    ],
  },
];

const errorCodes = [
  { code: "400", desc: "Некорректный запрос (ошибка валидации тела/параметров)" },
  { code: "401", desc: "Не передан/неверный API Key или Client JWT (истёк, невалиден)" },
  { code: "403", desc: "Аккаунт клиента заблокирован" },
  { code: "404", desc: "Ресурс не найден (клиент, эндпоинт)" },
  { code: "409", desc: "Конфликт (например, email уже зарегистрирован)" },
  { code: "429", desc: "Слишком много запросов (rate limit)" },
  { code: "5xx", desc: "Внутренняя ошибка сервера / внешний сервис недоступен" },
];

function MethodBadge({ method }: { method: string }) {
  const cls =
    method === "GET"
      ? "bg-secondary text-secondary-foreground"
      : method === "POST"
      ? "bg-primary text-primary-foreground"
      : method === "PATCH"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
      : "border bg-transparent";
  return (
    <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded text-xs font-semibold w-16 shrink-0 ${cls}`}>
      {method}
    </span>
  );
}

function FieldsTable({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="rounded-lg border divide-y overflow-hidden">
        {fields.map((f) => (
          <div key={f.name} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-[180px]">
              <code className="font-semibold">{f.name}</code>
              <span className="text-[11px] text-muted-foreground">{f.type}</span>
              {f.req && <span className="text-[10px] font-semibold text-red-500 uppercase">required</span>}
            </div>
            <div className="flex-1 text-muted-foreground text-xs sm:text-sm">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApiDocsPage() {
  const [tab, setTab] = useState("endpoints");

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-primary/10 text-primary rounded-xl">
          <Code className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-[13.5px] font-bold">External API v1</h1>
          <p className="text-sm text-muted-foreground">
            Документация для интеграции с мобильными приложениями и внешними сервисами
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Авторизация
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <div>
              <p className="font-medium mb-1">1. API Key (обязательно для всех запросов)</p>
              <p className="text-muted-foreground mb-2">
                Создаётся в разделе <a href="/admin/api-keys" className="text-primary underline">API-ключи</a>. Передаётся в заголовке каждого запроса.
              </p>
              <code className="block bg-muted/50 p-2 rounded border text-xs">X-Api-Key: sk_...</code>
            </div>
            <div>
              <p className="font-medium mb-1">2. Client JWT (для эндпоинтов /client/*)</p>
              <p className="text-muted-foreground mb-2">Выдаётся при логине/регистрации. Плюс к API Key.</p>
              <code className="block bg-muted/50 p-2 rounded border text-xs">Authorization: Bearer &lt;client_jwt&gt;</code>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5" />
              Базовый URL
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <p className="text-muted-foreground">Все запросы отправляются на базовый URL вашего сервера:</p>
            <code className="block bg-muted/50 p-3 rounded border text-sm font-mono text-primary break-all">
              {base}
            </code>
            <div className="pt-2">
              <p className="font-medium mb-1">Формат данных</p>
              <p className="text-muted-foreground">Запросы и ответы — <code>application/json</code>. Ошибки: <code>{"{ \"error\": \"...\" }"}</code>.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap w-full max-w-[560px]">
          <TabsTrigger value="endpoints">Эндпоинты</TabsTrigger>
          <TabsTrigger value="examples">Примеры (cURL)</TabsTrigger>
          <TabsTrigger value="errors">Ошибки</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-6 space-y-6">
          {endpoints.map((category, i) => (
            <Card key={i} className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  {category.icon}
                  {category.category}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {category.items.map((item, j) => (
                    <div key={j} className="p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-3 min-w-[260px]">
                          <MethodBadge method={item.method} />
                          <code className="text-sm font-semibold break-all">{item.path}</code>
                        </div>
                        <div className="flex-1" />
                        <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${item.auth === "Client JWT" ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground"}`}>
                          {item.auth}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                      {item.query && <FieldsTable title="Query-параметры" fields={item.query} />}
                      {item.body && <FieldsTable title="Тело запроса" fields={item.body} />}
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ответ</p>
                        <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-3 font-mono leading-relaxed">
{item.res}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="examples" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Регистрация клиента</CardTitle>
              <CardDescription>Создать клиента и сразу получить Client JWT</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X POST ${base}/auth/register \\
  -H "X-Api-Key: sk_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com",
    "password": "secret_password",
    "preferredLang": "ru",
    "preferredCurrency": "RUB"
  }'`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Логин клиента</CardTitle>
              <CardDescription>Получение Client JWT по email и паролю</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X POST ${base}/auth/login \\
  -H "X-Api-Key: sk_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com",
    "password": "secret_password"
  }'`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Профиль клиента</CardTitle>
              <CardDescription>Запрос защищённого эндпоинта (нужен Client JWT)</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X GET ${base}/client/profile \\
  -H "X-Api-Key: sk_your_api_key_here" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Каталог тарифов</CardTitle>
              <CardDescription>Публичный эндпоинт — нужен только API Key</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X GET ${base}/tariffs \\
  -H "X-Api-Key: sk_your_api_key_here"`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="mt-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Коды ответов
              </CardTitle>
              <CardDescription>Ошибки возвращаются в формате <code>{"{ \"error\": \"описание\" }"}</code></CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {errorCodes.map((e) => (
                  <div key={e.code} className="flex items-baseline gap-4 px-4 py-2.5 text-sm">
                    <code className="font-bold w-12 shrink-0">{e.code}</code>
                    <span className="text-muted-foreground">{e.desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
