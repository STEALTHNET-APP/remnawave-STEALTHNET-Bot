import { PromoCodeForm } from "@/components/cabinet/promo-code-form";
import { useTranslation } from "react-i18next";
import { StealthModal } from "./stealth-modal";

interface Props {
  open: boolean;
  onClose: () => void;
  onActivated?: () => void;
}

export function StealthPromocodeModal({ open, onClose, onActivated }: Props) {
  const { t } = useTranslation();
  return (
    <StealthModal open={open} onClose={onClose} title={t("homePromo.title")}>
      {open && <PromoCodeForm onActivated={onActivated} />}
    </StealthModal>
  );
}
