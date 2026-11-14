import { clientMenuReturnTo } from "@/lib/client-menu-return";
import { PasswordHint } from "@/components/password-hint";
import { onboardingSteps, nextOnboardingStep, type OnboardingStep } from "@/lib/client-onboarding";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Shield, Check, Eye, EyeOff, Loader2, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useCabinetDesign } from "@/lib/use-cabinet-design";
import "./cabinet-onboarding.css";

type Step = OnboardingStep;

export function ClientOnboardingPage() {
  const { state, refreshProfile, clearNewTelegramUser } = useClientAuth();
  const config = useCabinetConfig();
  const design = useCabinetDesign();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (design === "classic" && !config?.liteMode) document.body.dataset.cabinetUi = "minimal";
    else delete document.body.dataset.cabinetUi;
    return () => { delete document.body.dataset.cabinetUi; };
  }, [design, config?.liteMode]);
  const navigate = useNavigate();
  const location = useLocation();
  const token = state.token;
  const client = state.client;
  // T-onb-email (27.05.2026, WolfVPN): нужна ли верификация email через письмо.
  // Если SMTP не настроен ИЛИ админ выключил верификацию — пользуем direct-привязку.
  const emailVerificationRequired = Boolean(config?.smtpConfigured && !config?.skipEmailVerification);

  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState(1);

  // Email step (T-onb-email 26.05.2026, WolfVPN)
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);

  // Password step
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // 2FA step
  const [twoFaData, setTwoFaData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaSetupLoading, setTwoFaSetupLoading] = useState(false);

  const [profileLoading, setProfileLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    refreshProfile().finally(() => { if (alive) setProfileLoading(false); });
    return () => { alive = false; };
  }, [refreshProfile]);
  const STEPS = useMemo(() => onboardingSteps(client), [client?.email, client?.hasPassword, client?.totpEnabled]);
  useEffect(() => {
    if (!profileLoading && !STEPS.includes(step)) setStep(nextOnboardingStep(step, STEPS));
  }, [profileLoading, STEPS, step]);

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    const nextIndex = STEPS.indexOf(next);
    setDirection(nextIndex > stepIndex ? 1 : -1);
    setStep(next);
  }

  // Следующий шаг после welcome — email если нужен, иначе password.
  // Аналогично после email → password.
  function nextStepAfter(current: Step): Step {
    return nextOnboardingStep(current, STEPS);
  }

  // Load 2FA setup when entering that step
  useEffect(() => {
    if (!profileLoading && step === "2fa" && !client?.totpEnabled && !twoFaData && token) {
      setTwoFaSetupLoading(true);
      api.client2FASetup(token)
        .then(data => setTwoFaData(data))
        .catch(() => {})
        .finally(() => setTwoFaSetupLoading(false));
    }
  }, [step, twoFaData, token, profileLoading, client?.totpEnabled]);

  const [finishError, setFinishError] = useState("");

  const [doneLoading, setDoneLoading] = useState(false);

  async function handleFinishOnboarding() {
    if (!token) return;
    setDoneLoading(true);
    setFinishError("");
    try {
      await api.clientCompleteOnboarding(token);
      await refreshProfile();
      clearNewTelegramUser();
      navigate(clientMenuReturnTo(location.state?.returnTo), { replace: true });
    } catch {
      setFinishError("Не удалось завершить настройку. Попробуйте ещё раз.");
      setDoneLoading(false);
    }
  }

  async function handleSetPassword() {
    if (!token) return;
    if (newPassword.length < 6) {
      setPasswordError("Минимум 6 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Пароли не совпадают");
      return;
    }
    setPasswordError("");
    setPasswordLoading(true);
    try {
      const fresh = await api.clientMe(token);
      if (fresh.hasPassword !== true) await api.clientSetPassword(token, { newPassword });
      await refreshProfile();
      setNewPassword("");
      setConfirmPassword("");
      goTo(nextStepAfter("password"));
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleConfirm2FA() {
    if (!token || twoFaCode.length !== 6) return;
    setTwoFaError("");
    setTwoFaLoading(true);
    try {
      await api.client2FAConfirm(token, twoFaCode);
      goTo("done");
    } catch (e) {
      setTwoFaError(e instanceof Error ? e.message : "Неверный код");
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleSkip2FA() {
    goTo("done");
  }

  // T-onb-email (26.05.2026, WolfVPN): отправка ссылки или мгновенная привязка.
  // Если верификация требуется → /link-email-request (письмо со ссылкой).
  // Если нет (SMTP не настроен или skipEmailVerification=true) → /link-email-direct
  // (привязка мгновенная, юзер сразу идёт дальше).
  async function handleSubmitEmail() {
    if (!token) return;
    const value = emailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError("Введите корректный email");
      return;
    }
    if (!agreedToPrivacy) {
      setEmailError("Необходимо согласие с Политикой обработки персональных данных");
      return;
    }
    setEmailError("");
    setEmailLoading(true);
    try {
      if (emailVerificationRequired) {
        await api.clientLinkEmailRequest(token, { email: value });
        setEmailSent(true);
      } else {
        try {
          await api.clientLinkEmailDirect(token, { email: value });
          await refreshProfile();
          goTo(nextStepAfter("email"));
        } catch (e) {
          // страховка от рассинхрона с бэком: если direct
          // отвечает «Требуется верификация» (конфиг SMTP изменился / закэширован),
          // не показываем юзеру тупик — переключаемся на письмо со ссылкой.
          if (e instanceof Error && /верификац/i.test(e.message)) {
            await api.clientLinkEmailRequest(token, { email: value });
            setEmailSent(true);
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Не удалось сохранить email");
    } finally {
      setEmailLoading(false);
    }
  }

  const progressSteps = STEPS.filter(s => s !== "welcome" && s !== "done");
  const stepLabels: Record<Step, string> = { welcome: "Начало", email: "Email", password: "Пароль", "2fa": "Защита", done: "Готово" };
  const headings: Record<Step, string> = { welcome: "Добро пожаловать", email: "Добавьте email", password: "Создайте пароль", "2fa": "Защитите аккаунт", done: "Всё готово" };
  const descriptions: Record<Step, string> = {
    welcome: "Настройте способы входа и восстановление доступа к аккаунту.",
    email: "Для входа по почте и восстановления доступа.",
    password: "Используйте его вместе с email для входа в кабинет.",
    "2fa": "Дополнительный код при входе. Этот шаг можно пропустить.",
    done: "Теперь можно выбрать подписку и подключить свои устройства.",
  };

  return <main className="classic-auth cabinet-onboarding">
    <div className="onboarding-shell">
      <div className="onboarding-brand"><Shield size={22} aria-hidden="true" /><span>{config?.serviceName || "Личный кабинет"}</span></div>
      {profileLoading ? <div className="onboarding-card" role="status"><Loader2 size={20} className="animate-spin" /> Загружаем аккаунт…</div> : <>
        {progressSteps.length > 0 && <ol className="onboarding-progress" aria-label="Этапы настройки">
          {progressSteps.map((s, i) => <li key={s} aria-current={s === step ? "step" : undefined} data-complete={stepIndex > STEPS.indexOf(s)}>
            <span className="onboarding-step-number">{stepIndex > STEPS.indexOf(s) ? <Check size={14} aria-hidden="true" /> : i + 1}</span><span>{stepLabels[s]}</span>
          </li>)}
        </ol>}
        <section className="onboarding-card" aria-labelledby="onboarding-title">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: reducedMotion ? 0 : direction * 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : direction * -6 }} transition={{ duration: reducedMotion ? 0 : 0.16 }}>
              <header className="onboarding-heading"><h1 id="onboarding-title">{headings[step]}</h1><p>{descriptions[step]}</p></header>
              {step === "welcome" && <>
                <div className="onboarding-account"><Check size={18} aria-hidden="true" /><div><p>{client?.telegramId ? "Вход через Telegram выполнен" : "Аккаунт создан"}</p>{(client?.telegramUsername || client?.email) && <span>{client.telegramUsername ? `@${client.telegramUsername}` : client.email}</span>}</div></div>
                <Button className="onboarding-primary" onClick={() => goTo(nextStepAfter("welcome"))}>Настроить аккаунт <ChevronRight size={18} /></Button>
              </>}
              {step === "email" && (!emailSent ? <form onSubmit={e => { e.preventDefault(); void handleSubmitEmail(); }} className="onboarding-form">
                <div><label htmlFor="onboarding-email">Email</label><Input id="onboarding-email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={emailInput} onChange={e => { setEmailInput(e.target.value); setEmailError(""); }} disabled={emailLoading} aria-invalid={!!emailError} aria-describedby={emailError ? "onboarding-email-error" : undefined} /></div>
                <div className="onboarding-consent"><Checkbox id="agree-privacy-onb" checked={agreedToPrivacy} onCheckedChange={v => setAgreedToPrivacy(v === true)} disabled={emailLoading} /><label htmlFor="agree-privacy-onb">Я согласен с <Link to="/cabinet/documents/privacy" target="_blank" rel="noopener noreferrer">политикой обработки персональных данных</Link>.</label></div>
                {emailError && <p id="onboarding-email-error" role="alert" className="onboarding-error">{emailError}</p>}
                <Button type="submit" className="onboarding-primary" disabled={emailLoading || !emailInput.trim() || !agreedToPrivacy}>{emailLoading ? <Loader2 size={18} className="animate-spin" /> : <>{emailVerificationRequired ? "Отправить ссылку" : "Продолжить"}<ChevronRight size={18} /></>}</Button>
                {!config?.onboardingEmailRequired && <Button type="button" variant="ghost" className="onboarding-secondary" disabled={emailLoading} onClick={() => { setEmailError(""); goTo(nextStepAfter("email")); }}>Добавить email позже</Button>}
              </form> : <div className="onboarding-form"><div className="onboarding-notice" role="status"><Check size={18} /><div><strong>Письмо отправлено</strong><p>Откройте ссылку в письме на {emailInput}, чтобы подтвердить адрес.</p></div></div><Button className="onboarding-primary" onClick={() => goTo(nextStepAfter("email"))}>Продолжить <ChevronRight size={18} /></Button></div>)}
              {step === "password" && <form className="onboarding-form" onSubmit={e => { e.preventDefault(); void handleSetPassword(); }}>
                <div><label htmlFor="onboarding-password">Новый пароль</label><div className="onboarding-password"><Input id="onboarding-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={6} aria-describedby="onboarding-password-hint" value={newPassword} onChange={e => { setNewPassword(e.target.value); setPasswordError(""); }} disabled={passwordLoading} /><button type="button" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><PasswordHint id="onboarding-password-hint" minLength={6} /></div>
                <div><label htmlFor="onboarding-password-confirm">Повторите пароль</label><Input id="onboarding-password-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setPasswordError(""); }} disabled={passwordLoading} /></div>
                {passwordError && <p role="alert" className="onboarding-error">{passwordError}</p>}
                <Button type="submit" className="onboarding-primary" disabled={passwordLoading || !newPassword || !confirmPassword}>{passwordLoading ? <Loader2 size={18} className="animate-spin" /> : <>Сохранить пароль <ChevronRight size={18} /></>}</Button>
              </form>}
              {step === "2fa" && <div className="onboarding-form">
                <p className="onboarding-help">Отсканируйте QR-код в приложении для одноразовых кодов, например Google Authenticator.</p>
                {twoFaSetupLoading ? <div className="onboarding-loading" role="status"><Loader2 size={22} className="animate-spin" /><span>Готовим QR-код…</span></div> : twoFaData ? <form className="onboarding-form" onSubmit={e => { e.preventDefault(); void handleConfirm2FA(); }}>
                  <div className="onboarding-qr"><QRCodeSVG value={twoFaData.otpauthUrl} size={160} /></div>
                  <details className="onboarding-manual"><summary>Ввести ключ вручную</summary><code>{twoFaData.secret}</code></details>
                  <div><label htmlFor="onboarding-2fa">Код из приложения</label><Input id="onboarding-2fa" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} value={twoFaCode} onChange={e => { setTwoFaCode(e.target.value.replace(/\D/g, "")); setTwoFaError(""); }} disabled={twoFaLoading} /></div>
                  {twoFaError && <p role="alert" className="onboarding-error">{twoFaError}</p>}
                  <Button type="submit" className="onboarding-primary" disabled={twoFaLoading || twoFaCode.length !== 6}>{twoFaLoading ? <Loader2 size={18} className="animate-spin" /> : "Включить защиту"}</Button>
                </form> : <p role="alert" className="onboarding-error">Не удалось загрузить QR-код. Настроить защиту можно позже в профиле.</p>}
                <Button variant="ghost" className="onboarding-secondary" onClick={handleSkip2FA} disabled={twoFaLoading}>Настроить позже</Button>
              </div>}
              {step === "done" && <div className="onboarding-form">
                {finishError && <p role="alert" className="onboarding-error">{finishError}</p>}
                <Button className="onboarding-primary" onClick={handleFinishOnboarding} disabled={doneLoading}>{doneLoading ? <Loader2 size={18} className="animate-spin" /> : <>Перейти в кабинет <ChevronRight size={18} /></>}</Button>
              </div>}
            </motion.div>
          </AnimatePresence>
        </section>
      </>}
    </div>
  </main>;
}
