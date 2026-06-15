import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97] outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
  {
    variants: {
      variant: {
        default:
          "text-white bg-[linear-gradient(140deg,var(--color-brand-2),var(--color-brand))] shadow-[0_10px_24px_-6px_rgba(79,70,229,.5)] hover:-translate-y-px",
        outline: "border border-[var(--color-line)] bg-surface text-ink hover:bg-bg",
        ghost: "text-muted hover:bg-bg hover:text-ink",
        subtle: "bg-bg text-ink hover:bg-[color-mix(in_srgb,var(--color-brand)_8%,var(--color-bg))]",
      },
      size: { default: "h-10 px-4", sm: "h-9 px-3 text-[13px]", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
