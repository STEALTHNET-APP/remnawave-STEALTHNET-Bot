/** Account state comes from the server; device-local registration hints are only a fallback. */
export type OnboardingStep = "welcome" | "email" | "password" | "2fa" | "done";
type Account = { email?: string | null; hasPassword?: boolean; totpEnabled?: boolean; onboardingCompleted?: boolean };
const ORDER: OnboardingStep[] = ["welcome", "email", "password", "2fa", "done"];
export function needsClientOnboarding(account: Account | null | undefined, newUser: boolean): boolean {
  return typeof account?.onboardingCompleted === "boolean" ? !account.onboardingCompleted : newUser;
}
export function onboardingSteps(account: Account | null | undefined): OnboardingStep[] {
  return ORDER.filter(step => step === "email" ? !account?.email : step === "password" ? account?.hasPassword === false : step === "2fa" ? !account?.totpEnabled : true);
}
export function nextOnboardingStep(current: OnboardingStep, steps: OnboardingStep[]): OnboardingStep {
  return ORDER.slice(ORDER.indexOf(current) + 1).find(step => steps.includes(step)) || "done";
}
