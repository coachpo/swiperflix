
import { useToast } from "./use-toast";
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <ToastProvider swipeDirection="down" duration={2000}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props} onOpenChange={(open) => !open && dismiss(id)}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
