import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { UserPlus, Shield, Mail } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import type { PublicConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TelegramSignIn } from "@/components/telegram-sign-in";
import { getPublicConfigCached } from "@/lib/public-config";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const UTM_STORAGE_KEY = "stealthnet_utm";

function getUtmFromSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = searchParams.get(k)?.trim();
    if (v) out[k] = v;
  }
  return out;
}

function getStoredUtm(): Record<string, string> {
  try {
    const raw = localStorage.getItem(UTM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    for (const k of keys) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function storeUtm(utm: Record<string, string>) {
  if (Object.keys(utm).length === 0) return;
  try {
    localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utm));
  } catch {
    // ignore
  }
}

/** UTM из URL с приоритетом, при наличии — сохраняем в localStorage для последующей регистрации */
function useUtmCapture(searchParams: URLSearchParams) {
  const fromUrl = getUtmFromSearchParams(searchParams);
  if (Object.keys(fromUrl).length > 0) storeUtm(fromUrl);
  const fromStorage = getStoredUtm();
  return { ...fromStorage, ...fromUrl };
}

declare global {
  interface Window {
    TelegramLoginWidget?: {
      dataOnauth: (user: { id: number; first_name?: string; username?: string }) => void;
    };
  }
}

export function ClientRegisterPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
    const [emailError, setEmailError] = useState("");
    const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const [defaults, setDefaults] = useState<{ lang: string; currency: string }>({ lang: "ru", currency: "usd" });
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [publicAppUrl, setPublicAppUrl] = useState<string | null>(null);
  const [appleEnabled, setAppleEnabled] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref")?.trim() || undefined;
  const utm = useUtmCapture(searchParams);
  const { register, loginByGoogle, loginByApple } = useClientAuth();
  const navigate = useNavigate();

  function validateEmail(value: string): string {
    if (!value.trim()) return t("cabinet.register.email_required");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return t("cabinet.register.email_invalid");
    return "";
  }

  
  function handleEmailBlur() {
    setEmailError(validateEmail(email));
  }

  
  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
    if (emailError) setEmailError("");
  }

  
  function validateAll(): boolean {
    const emailErr = validateEmail(email);
    setEmailError(emailErr);
    if (!agreedToPrivacy) {
      setError("Необходимо согласие с Политикой обработки персональных данных");
      return false;
    }
    return !emailErr;
  }

  useEffect(() => {
    getPublicConfigCached()
      .then((c: PublicConfig) => {
        setBrand({ serviceName: c.serviceName ?? "", logo: c.logo ?? null });
        setDefaults({
          lang: c.defaultLanguage || "ru",
          currency: (c.defaultCurrency || "usd").toLowerCase(),
        });
        setTelegramBotUsername(c.telegramBotUsername ?? null);
        setGoogleEnabled(!!c.googleLoginEnabled);
        setGoogleClientId(c.googleClientId ?? null);
        setPublicAppUrl(c.publicAppUrl ?? null);
        setAppleEnabled(!!c.appleLoginEnabled);
      })
      .catch(() => {});
  }, []);

  const handleGoogleLogin = useCallback(() => {
    if (!googleEnabled || !googleClientId) return;
    setError("");
    const state = "google_" + Math.random().toString(36).slice(2);
    const nonce = Math.random().toString(36).slice(2);
    try {
      sessionStorage.setItem("stealthnet_google_oauth_state", state);
      sessionStorage.setItem("stealthnet_google_oauth_nonce", nonce);
    } catch {
      // ignore
    }
    const baseUrl = (publicAppUrl ?? "").trim().replace(/\/$/, "") || window.location.origin;
    const redirectUri = baseUrl + "/cabinet/register";
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", googleClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("state", state);
    window.location.href = url.toString();
  }, [googleEnabled, googleClientId, publicAppUrl]);

  useEffect(() => {
    const hash = window.location.hash?.replace("#", "") || "";
    const params = new URLSearchParams(hash);
    const state = params.get("state") || "";
    if (!state.startsWith("google_") || !params.get("id_token")) return;
    const idToken = params.get("id_token");
    if (!idToken) return;
    try {
      const saved = sessionStorage.getItem("stealthnet_google_oauth_state");
      if (saved !== state) return;
      sessionStorage.removeItem("stealthnet_google_oauth_state");
      sessionStorage.removeItem("stealthnet_google_oauth_nonce");
    } catch {
      /* ignore */
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLoading(true);
    loginByGoogle(idToken)
      .then(() => navigate("/cabinet/dashboard", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t("cabinet.login.error_google")))
      .finally(() => setLoading(false));
  }, [loginByGoogle, navigate, t]);

  const handleAppleLogin = useCallback(async () => {
    if (!appleEnabled) return;
    setError("");
    setLoading(true);
    try {
      const cfg = await getPublicConfigCached();
      const appleClientIdVal = cfg.appleClientId;
      if (!appleClientIdVal) throw new Error("Apple Sign In not configured");
      const baseUrl = (cfg.publicAppUrl ?? "").trim().replace(/\/$/, "") || window.location.origin;
      const redirectUri = baseUrl + "/cabinet/register";
      const state = Math.random().toString(36).slice(2);
      const url = new URL("https://appleid.apple.com/auth/authorize");
      url.searchParams.set("client_id", appleClientIdVal);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code id_token");
      url.searchParams.set("response_mode", "fragment");
      url.searchParams.set("scope", "email");
      url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.login.error_apple"));
      setLoading(false);
    }
  }, [appleEnabled, t]);

  useEffect(() => {
    const hash = window.location.hash?.replace("#", "") || "";
    const params = new URLSearchParams(hash);
    if (params.get("state")?.startsWith("google_")) return;
    if (!params.get("id_token")) return;
    const idToken = params.get("id_token");
    if (!idToken) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLoading(true);
    loginByApple(idToken)
      .then(() => navigate("/cabinet/dashboard", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t("cabinet.login.error_apple")))
      .finally(() => setLoading(false));
  }, [loginByApple, navigate, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setEmailSent(false);
    
    if (!validateAll()) {
      return;
    }
    
    setLoading(true);
    try {
      const result = await register({
        // #200: пароль не отправляем — клиент задаст его на шаге онбординга «Пароль»
        email,
        preferredLang: defaults.lang,
        preferredCurrency: defaults.currency,
        referralCode: refCode,
        ...utm,
      });
      if (result?.requiresVerification) {
        setEmailSent(true);
      } else {
        navigate("/cabinet/onboarding", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cabinet.register.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cabinet-auth-page min-h-svh flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-6 min-h-[2.5rem]">
          {brand.logo ? (
            <span className="flex items-center justify-center h-11 px-3">
              <img src={brand.logo} alt="" className="h-8 max-w-[140px] object-contain" />
            </span>
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
              <Shield className="h-6 w-6" />
            </span>
          )}
          {brand.serviceName ? <span className="font-semibold text-xl">{brand.serviceName}</span> : null}
        </div>
        <div className="cabinet-auth-card relative rounded-[2.5rem] border border-white/10 dark:border-white/5 bg-background/40 backdrop-blur-2xl shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="p-8 sm:p-10 relative z-10">

          
            <div className="space-y-1 text-center mb-8">

            <div className="flex justify-center mb-2">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 border border-primary/20 mb-2">
                <UserPlus className="h-10 w-10 text-primary" />
              </div>
            </div>
            
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t("cabinet.register.title")}</h2>

            <p className="text-muted-foreground text-sm">{t("cabinet.register.subtitle")}</p>
          
            </div>

          
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Скрытое поле: iOS/Safari реже выводит панель автозаполнения на каждый символ */}
              <input type="text" name="prevent_autofill" autoComplete="off" tabIndex={-1} className="absolute opacity-0 pointer-events-none h-0 w-0 overflow-hidden" aria-hidden />
              {error && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email"
                  type="email"
                  name="register_email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={handleEmailChange}
                  onBlur={handleEmailBlur}
                  required
                  autoComplete="off"
                  data-form-type="other"
                   className={cn("h-12 rounded-xl bg-card border-muted-foreground/75 text-base shadow-sm dark:bg-background/50 dark:border-white/15 focus-visible:ring-primary/50 transition-all", emailError ? "border-destructive dark:border-destructive focus-visible:ring-destructive" : "")}
                />
                {emailError && <p className="text-xs text-destructive">{emailError}</p>}
              </div>
              
              {emailSent && (
                <div className="rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-sm p-3 flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0" />
                  {t("cabinet.register.email_sent")}
                </div>
              )}
              {/* Согласие с обработкой персональных данных (обязательно при регистрации) */}
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card/60 dark:bg-background/30 p-3">
                <Checkbox id="agree-privacy" checked={agreedToPrivacy} onCheckedChange={(v) => setAgreedToPrivacy(v === true)} className="mt-0.5 shrink-0 border-muted-foreground/75 bg-card dark:border-white/50 dark:bg-white/10 data-[state=checked]:bg-fuchsia-500 data-[state=checked]:border-fuchsia-500 data-[state=checked]:text-white" />
                <Label htmlFor="agree-privacy" className="text-xs font-normal leading-relaxed text-muted-foreground cursor-pointer">
                  Регистрируясь, я подтверждаю, что ознакомился и согласен с{" "}
                  <Link to="/cabinet/documents/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Политикой обработки персональных данных</Link>.
                </Label>
              </div>
              <Button type="submit" className="w-full h-14 rounded-2xl text-base font-bold shadow-xl hover:scale-[1.02] transition-all gap-2" disabled={loading || !email || !agreedToPrivacy}>
                {loading ? t("cabinet.register.submit_loading") : "Продолжить"}
              </Button>
              {(telegramBotUsername || googleEnabled || appleEnabled) && (
                <div className="space-y-3">
                  <div className="relative flex items-center gap-2">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-xs text-muted-foreground px-2">{t("cabinet.login.or")}</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                  {googleEnabled && googleClientId && (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        title={t("cabinet.register.google_title")}
                        className={cn(
                          "h-11 w-11 shrink-0 rounded-full flex items-center justify-center",
                          "border border-border bg-muted/50 hover:bg-muted transition-colors",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        )}
                      >
                        <GoogleIcon className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                  {appleEnabled && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11 gap-2"
                      onClick={handleAppleLogin}
                      disabled={loading}
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                      {t("cabinet.register.apple")}
                    </Button>
                  )}
                  {telegramBotUsername && <TelegramSignIn botUsername={telegramBotUsername} disabled={loading} registration />}
                </div>
              )}
              <p className="text-center text-sm text-muted-foreground">
                {t("cabinet.register.has_account")}{" "}
                <Link to="/cabinet/login" className="text-primary hover:underline">
                  {t("cabinet.register.login_link")}
                </Link>
              </p>
            </form>
          
        
          </div>
        </div>
      </motion.div>
    </div>
  );
}
