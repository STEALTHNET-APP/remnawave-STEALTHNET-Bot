import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium leading-none align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:self-center [&_svg]:align-middle",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.45),inset_0_1px_0_0_hsl(0_0%_100%/0.18)] hover:bg-primary/90 hover:shadow-[0_6px_20px_-4px_hsl(var(--primary)/0.55),inset_0_1px_0_0_hsl(0_0%_100%/0.2)] active:shadow-none",
        destructive: "bg-destructive text-white shadow-[0_4px_16px_-4px_hsl(var(--destructive)/0.45)] hover:bg-destructive/90",
        outline: "border border-border/80 bg-transparent hover:bg-accent/60 hover:border-border text-foreground",
        secondary: "rounded-lg border border-border bg-card text-foreground hover:bg-accent/50",
        ghost: "hover:bg-accent/60 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-[13px] py-2 rounded-lg",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-xl px-8 text-sm",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, children, ...props }, ref) => {
    const compClassName = cn(buttonVariants({ variant, size, className }));
    if (asChild && React.Children.count(children) === 1 && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string; ref?: React.Ref<unknown> }>;
      return React.cloneElement(child, {
        ...props,
        className: cn(compClassName, child.props?.className),
        ref,
      });
    }
    return (
      <button
        className={compClassName}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
