import { useKiosk } from "../lib/config.tsx";

/**
 * The publication's horizontal logo. It comes from settings, so official
 * artwork can be swapped in from the dashboard without touching layouts.
 */
export function BrandLogo({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" | "hero" }) {
  const { config } = useKiosk();
  const logo = config?.branding.logoUrl ?? "/brand/weekly-wildcat-wide-logo.svg";
  const name = config?.branding.publicationName ?? "The Weekly Wildcat";
  return <img className={`brand-logo brand-logo-${size}`} src={logo} alt={name} />;
}
