import { motion, type HTMLMotionProps } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { spring } from "../lib/motion.ts";
import { sfx } from "../lib/sound.ts";

/**
 * The arcade button: a chunky, ink-outlined block with a hard "printed"
 * shadow that compresses when pressed. Variants share one shape.
 */

type Variant = "ink" | "paper" | "color" | "ghost";
type Size = "sm" | "md" | "lg" | "xl";

export interface BtnProps extends Omit<HTMLMotionProps<"button">, "children" | "color"> {
  variant?: Variant;
  size?: Size;
  /** Background for the "color" variant (a CSS color or var). */
  color?: string;
  icon?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}

export function Btn({ variant = "paper", size = "md", color, icon, children, wide, className = "", style, onPointerDown, ...rest }: BtnProps) {
  return (
    <motion.button
      type="button"
      className={`btn btn-${variant} btn-${size} ${wide ? "btn-wide" : ""} ${className}`}
      style={{ ...(color ? ({ "--c": color } as CSSProperties) : {}), ...(style as CSSProperties) }}
      whileTap={rest.disabled ? undefined : { y: 3, scale: 0.98 }}
      transition={spring.tap}
      onPointerDown={(e) => {
        if (!rest.disabled) sfx.tap();
        onPointerDown?.(e);
      }}
      {...rest}
    >
      {icon ? <span className="btn-icon" aria-hidden="true">{icon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
    </motion.button>
  );
}
