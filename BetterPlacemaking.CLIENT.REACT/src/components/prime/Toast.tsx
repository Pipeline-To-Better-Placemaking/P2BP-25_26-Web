import { createElement, useEffect, useRef, useState, type CSSProperties } from "react";
import { PrimeSvgIcon } from "./PrimeSvgIcon";
import { usePrimeServices, type ToastMessage } from "./primeServicesContext";
import { pushZIndex, releaseZIndex } from "./primeOverlayUtils";

export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right" | "center";

export interface ToastProps {
  /** PrimeNG `key`: only messages added with the same key are shown (omit for the default toast). */
  toastKey?: string;
  /** default "top-right". */
  position?: ToastPosition;
  /** default life in ms (3000). */
  life?: number;
  className?: string;
  style?: CSSProperties;
  onClose?: (message: ToastMessage) => void;
  preventDuplicates?: boolean;
  autoZIndex?: boolean;
  baseZIndex?: number;
}

const ICON: Record<string, string> = {
  success: "check",
  info: "info-circle",
  error: "times-circle",
  warn: "exclamation-triangle",
};

interface Item extends ToastMessage {
  _id: number;
}
let seq = 0;

function ToastItem({ message, life, onRemove }: { message: Item; life: number; onRemove: (m: Item) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const removing = useRef(false);

  const remove = () => {
    if (removing.current) return;
    removing.current = true;
    const el = ref.current;
    const h = el?.getBoundingClientRect().height ?? 0;
    const a = el?.animate(
      [
        { height: `${h}px`, opacity: 1, transform: "translateY(0)" },
        { height: "0px", opacity: 0, transform: "translateY(-100%)", margin: 0, padding: 0 },
      ],
      { duration: 250, easing: "ease-in", fill: "forwards" },
    );
    if (a) a.onfinish = () => onRemove(message);
    else onRemove(message);
  };
  const start = () => {
    if (message.sticky) return;
    timer.current = window.setTimeout(remove, message.life || life);
  };
  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
  };

  useEffect(() => {
    ref.current?.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 300, easing: "ease-out" });
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iconCls = "p-toast-message-icon";
  return createElement(
    "p-toastitem",
    null,
    <div
      ref={ref}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      id={message.id != null ? String(message.id) : undefined}
      className={["p-toast-message", `p-toast-message-${message.severity ?? "info"}`, message.styleClass].filter(Boolean).join(" ")}
      data-pc-section="message"
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      <div className={["p-toast-message-content", message.contentStyleClass].filter(Boolean).join(" ")} data-pc-section="messagecontent">
        {message.icon ? (
          <span className={`${iconCls} ${message.icon}`} data-pc-section="messageicon" />
        ) : (
          <PrimeSvgIcon name={ICON[message.severity ?? ""] ?? "info-circle"} className={iconCls} aria-hidden="true" data-pc-section="messageicon" />
        )}
        <div className="p-toast-message-text" data-pc-section="messagetext">
          <div className="p-toast-summary" data-pc-section="summary">
            {` ${message.summary ?? ""} `}
          </div>
          <div className="p-toast-detail" data-pc-section="detail">
            {message.detail}
          </div>
        </div>
        {message.closable !== false ? (
          <div>
            <button
              type="button"
              className="p-toast-close-button"
              aria-label="Close"
              data-pc-section="closebutton"
              onClick={(e) => {
                e.preventDefault();
                stop();
                remove();
              }}
            >
              {message.closeIcon ? (
                <span className={`p-toast-close-icon ${message.closeIcon}`} data-pc-section="closeicon" />
              ) : (
                <PrimeSvgIcon name="times" className="p-toast-close-icon" aria-hidden="true" data-pc-section="closeicon" />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
  );
}

/** PrimeNG `<p-toast>`. The provider mounts the default one; add `<Toast toastKey="x" position="bottom-right" />` on pages that target a key. */
export function Toast({ toastKey, position = "top-right", life = 3000, className, style, onClose, preventDuplicates, autoZIndex = true, baseZIndex = 0 }: ToastProps) {
  const { bus } = usePrimeServices();
  const [items, setItems] = useState<Item[]>([]);
  const [z, setZ] = useState<number | undefined>();
  const zRef = useRef<number | null>(null);

  useEffect(() => {
    const off1 = bus.onMessage((msgs) => {
      const mine = msgs.filter((m) => m.key === toastKey);
      if (!mine.length) return;
      setItems((cur) => {
        let add = mine.map((m) => ({ ...m, _id: ++seq }));
        if (preventDuplicates) add = add.filter((m) => !cur.some((c) => c.severity === m.severity && c.summary === m.summary && c.detail === m.detail));
        return [...cur, ...add];
      });
    });
    const off2 = bus.onClear((key) => {
      if (key === undefined || key === toastKey) setItems([]);
    });
    const off3 = bus.onRemove((id) => {
      setItems((cur) => (cur.some((m) => m.id === id) ? cur.filter((m) => m.id !== id) : cur));
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }, [bus, toastKey, preventDuplicates]);

  useEffect(() => {
    if (!autoZIndex) return;
    if (items.length && zRef.current == null) {
      zRef.current = pushZIndex(baseZIndex);
      setZ(zRef.current);
    } else if (!items.length && zRef.current != null) {
      releaseZIndex(zRef.current);
      zRef.current = null;
      setZ(undefined);
    }
  }, [items.length, autoZIndex, baseZIndex]);

  const top = position === "top-right" || position === "top-left" || position === "top-center" ? "20px" : position === "center" ? "50%" : undefined;
  const right = position === "top-right" || position === "bottom-right" ? "20px" : undefined;
  const bottom = position === "bottom-left" || position === "bottom-right" || position === "bottom-center" ? "20px" : undefined;
  const left = position === "top-left" || position === "bottom-left" ? "20px" : position === "center" || position === "top-center" || position === "bottom-center" ? "50%" : undefined;

  return createElement(
    "p-toast",
    {
      className: ["p-toast p-component", `p-toast-${position}`, className].filter(Boolean).join(" "),
      "data-pc-section": "root",
      "data-pc-name": "toast",
      style: { position: "fixed", top, right, bottom, left, zIndex: z, ...style },
    },
    items.map((m) => (
      <ToastItem
        key={m._id}
        message={m}
        life={life}
        onRemove={(mm) => {
          setItems((cur) => cur.filter((c) => c._id !== mm._id));
          onClose?.(mm);
        }}
      />
    )),
  );
}
