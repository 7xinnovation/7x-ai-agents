import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13.5px] font-semibold transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
  {
    variants: {
      variant: {
        // Solid 7X blue — flat & crisp (Stripe/Vercel style)
        default: "bg-brand text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)]",
        // White with hairline border + xs shadow (Untitled secondary)
        outline: "border border-[var(--color-line)] bg-surface text-ink-2 shadow-[var(--shadow-xs)] hover:bg-[var(--color-canvas)]",
        ghost: "text-muted hover:bg-[var(--color-line-soft)] hover:text-ink",
      },
      size: { default: "px-3.5 [height:38px]", sm: "px-3 text-[13px] [height:32px]", icon: "[height:38px] w-[38px]" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
);
Button.displayName = "Button";
