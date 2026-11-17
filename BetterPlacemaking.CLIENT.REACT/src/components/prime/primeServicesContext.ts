import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** Internal: shared context between PrimeServicesProvider (services.tsx), Toast and ConfirmDialog. */

export type ToastSeverity = "success" | "info" | "warn" | "error" | "secondary" | "contrast";

export interface ToastMessage {
  severity?: ToastSeverity;
  summary?: string;
  detail?: string;
  /** ms; overrides the <Toast life> (default 3000). */
  life?: number;
  /** Never auto-dismiss. */
  sticky?: boolean;
  /** Only the <Toast key=...> / <Toast toastKey=...> with the same key shows it (undefined -> the root toast). */
  key?: string;
  closable?: boolean;
  /** Custom icon class (replaces the severity svg). */
  icon?: string;
  closeIcon?: string;
  styleClass?: string;
  contentStyleClass?: string;
  id?: unknown;
  data?: unknown;
}

export interface Confirmation {
  key?: string;
  header?: string;
  /** HTML string (PrimeNG renders it with innerHTML). */
  message?: string;
  icon?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptIcon?: string;
  rejectIcon?: string;
  acceptVisible?: boolean;
  rejectVisible?: boolean;
  acceptButtonStyleClass?: string;
  rejectButtonStyleClass?: string;
  defaultFocus?: "accept" | "reject" | "close" | "none";
  closeOnEscape?: boolean;
  dismissableMask?: boolean;
  blockScroll?: boolean;
  closable?: boolean;
  accept?: () => void;
  reject?: () => void;
}

type Listener<T> = (v: T) => void;

export class PrimeBus {
  private msg = new Set<Listener<ToastMessage[]>>();
  private clr = new Set<Listener<string | undefined>>();
  private conf = new Set<Listener<Confirmation | null>>();
  private rem = new Set<Listener<unknown>>();
  onMessage(fn: Listener<ToastMessage[]>) {
    this.msg.add(fn);
    return () => void this.msg.delete(fn);
  }
  onClear(fn: Listener<string | undefined>) {
    this.clr.add(fn);
    return () => void this.clr.delete(fn);
  }
  onRemove(fn: Listener<unknown>) {
    this.rem.add(fn);
    return () => void this.rem.delete(fn);
  }
  onConfirm(fn: Listener<Confirmation | null>) {
    this.conf.add(fn);
    return () => void this.conf.delete(fn);
  }
  add(m: ToastMessage | ToastMessage[]) {
    const arr = Array.isArray(m) ? m : [m];
    this.msg.forEach((f) => f(arr));
  }
  clear(key?: string) {
    this.clr.forEach((f) => f(key));
  }
  /** Removes the messages added with this `id`, such as a sticky one whose wait is over. */
  remove(id: unknown) {
    this.rem.forEach((f) => f(id));
  }
  confirm(c: Confirmation | null) {
    this.conf.forEach((f) => f(c));
  }
}

export interface DynamicDialogConfig {
  data?: any;
  header?: string;
  footer?: string;
  width?: string;
  height?: string;
  modal?: boolean;
  dismissableMask?: boolean;
  closable?: boolean;
  closeOnEscape?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  maximizable?: boolean;
  showHeader?: boolean;
  focusOnShow?: boolean;
  focusTrap?: boolean;
  keepInViewport?: boolean;
  baseZIndex?: number;
  position?: "center" | "top" | "bottom" | "left" | "right" | "topleft" | "topright" | "bottomleft" | "bottomright";
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  /** PrimeNG `styleClass`. */
  className?: string;
  maskStyleClass?: string;
  breakpoints?: Record<string, string>;
  closeAriaLabel?: string;
  /** Allow opening the same component while it is already open (PrimeNG `duplicate`, default false -> open() returns null). */
  duplicate?: boolean;
}

export interface DynamicDialogRef<R = unknown> {
  /** Close the dialog; resolves `onClose` with `result` (undefined when closed via X / Escape / mask). */
  close: (result?: R) => void;
  /** Resolves once with the close result (Angular: `ref.onClose.subscribe`). Use `.then(...)` / `await`. */
  onClose: Promise<R | undefined>;
  /** Resolves after the dialog has been removed from the DOM. */
  onDestroy: Promise<void>;
  /** Remove immediately without animation. */
  destroy: () => void;
}

export interface DynamicDialogComponentProps<D = any, R = unknown> {
  /** `config.data` (Angular `DynamicDialogConfig.data`). */
  data: D;
  /** Angular `DynamicDialogRef`. */
  dialogRef: DynamicDialogRef<R>;
  /** The full config (Angular `DynamicDialogConfig`). */
  config: DynamicDialogConfig;
}

export interface PrimeServicesValue {
  bus: PrimeBus;
  openDialog: <D, R>(component: (props: DynamicDialogComponentProps<D, R>) => ReactNode, config?: DynamicDialogConfig) => DynamicDialogRef<R> | null;
}

export const PrimeServicesContext = createContext<PrimeServicesValue | null>(null);

export function usePrimeServices(): PrimeServicesValue {
  const v = useContext(PrimeServicesContext);
  if (!v) throw new Error("PrimeServicesProvider is missing: wrap the app in <PrimeServicesProvider>.");
  return v;
}
