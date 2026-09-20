import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        // Inline styles so toasts always match the dark app — the Tailwind
        // variable classes alone can resolve to white on some builds.
        style: {
          background: "#111418",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#ffffff",
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        },
        classNames: {
          toast: "group toast group-[.toaster]:text-white",
          description: "group-[.toast]:text-white/70",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
