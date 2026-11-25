export function paymentLabelHasIcon(label: string): boolean {
  return /[\p{Extended_Pictographic}\p{Sc}]/u.test(label);
}
