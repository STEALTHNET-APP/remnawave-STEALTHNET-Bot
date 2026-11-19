export function paymentLabelHasIcon(label: string): boolean {
  return /\p{Extended_Pictographic}/u.test(label);
}
