import { createElement, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { Toast } from "./Toast";
import {
  PrimeBus,
  PrimeServicesContext,
  usePrimeServices,
  type Confirmation,
  type DynamicDialogComponentProps,
  type DynamicDialogConfig,
  type DynamicDialogRef,
  type PrimeServicesValue,
  type ToastMessage,
} from "./primeServicesContext";

export type { Confirmation, DynamicDialogComponentProps, DynamicDialogConfig, DynamicDialogRef, ToastMessage } from "./primeServicesContext";

interface OpenDialog {
  id: number;
  component: (props: DynamicDialogComponentProps<any, any>) => ReactNode;
  config: DynamicDialogConfig;
  ref: DynamicDialogRef<any>;
  visible: boolean;
}

let dlgSeq = 0;

function DynamicDialogHost({ dlg, onClose, onRemoved }: { dlg: OpenDialog; onClose: (id: number, result?: unknown) => void; onRemoved: (id: number) => void }) {
  const { config, component: C, ref } = dlg;
  const style = { width: config.width, height: config.height, ...config.style };
  return createPortal(
    createElement(
      "p-dynamicdialog",
      { "data-pc-section": "root", "data-pc-name": "dynamicdialog" },
      <Dialog
        visible={dlg.visible}
        onHide={() => onClose(dlg.id)}
        onAfterHide={() => onRemoved(dlg.id)}
        hostName="DynamicDialog"
        pcName="pcdialog"
        header={config.header}
        footer={config.footer ? <div>{config.footer}</div> : undefined}
        modal={config.modal !== false}
        closable={config.closable ?? false}
        closeOnEscape={config.closeOnEscape !== false}
        dismissableMask={config.dismissableMask ?? false}
        draggable={config.draggable !== false}
        resizable={config.resizable !== false}
        maximizable={config.maximizable ?? false}
        showHeader={config.showHeader !== false}
        focusOnShow={config.focusOnShow !== false}
        focusTrap={config.focusTrap !== false}
        keepInViewport={config.keepInViewport ?? false}
        position={config.position}
        baseZIndex={config.baseZIndex ?? 0}
        className={config.className}
        style={style}
        contentStyle={config.contentStyle}
        maskClassName={config.maskStyleClass}
        breakpoints={config.breakpoints}
        closeAriaLabel={config.closeAriaLabel ?? "Close"}
      >
        <C data={config.data} dialogRef={ref} config={config} />
      </Dialog>,
    ),
    document.body,
  );
}

/**
 * Mount once near the app root (inside the Router if dialog components use router hooks - dynamic dialogs render from here,
 * so they inherit every provider ABOVE this component). Renders the default root <Toast/> (key-less, top-right),
 * the default key-less <ConfirmDialog/> and all dynamic dialogs opened through useDialogService().
 */
export function PrimeServicesProvider({ children }: { children?: ReactNode }) {
  const bus = useMemo(() => new PrimeBus(), []);
  const [dialogs, setDialogs] = useState<OpenDialog[]>([]);
  const dialogsRef = useRef<OpenDialog[]>([]);
  dialogsRef.current = dialogs;
  const resolvers = useRef(new Map<number, { close: (r?: unknown) => void; destroy: () => void }>());

  const onClose = useCallback((id: number, result?: unknown) => {
    resolvers.current.get(id)?.close(result);
  }, []);
  const onRemoved = useCallback((id: number) => {
    resolvers.current.get(id)?.destroy();
    resolvers.current.delete(id);
    setDialogs((d) => d.filter((x) => x.id !== id));
  }, []);

  const openDialog = useCallback<PrimeServicesValue["openDialog"]>(
    (component, config = {}) => {
      if (!config.duplicate && dialogsRef.current.some((d) => d.component === component)) return null;
      const id = ++dlgSeq;
      let resolveClose!: (v: unknown) => void;
      let resolveDestroy!: () => void;
      const onCloseP = new Promise<unknown>((r) => (resolveClose = r));
      const onDestroyP = new Promise<void>((r) => (resolveDestroy = r));
      let closed = false;
      const ref: DynamicDialogRef<any> = {
        onClose: onCloseP,
        onDestroy: onDestroyP,
        close: (result) => {
          if (closed) return;
          closed = true;
          resolveClose(result);
          setDialogs((d) => d.map((x) => (x.id === id ? { ...x, visible: false } : x)));
        },
        destroy: () => {
          if (!closed) {
            closed = true;
            resolveClose(undefined);
          }
          resolveDestroy();
          resolvers.current.delete(id);
          setDialogs((d) => d.filter((x) => x.id !== id));
        },
      };
      resolvers.current.set(id, { close: (r) => ref.close(r), destroy: resolveDestroy });
      setDialogs((d) => [...d, { id, component, config, ref, visible: true }]);
      return ref;
    },
    [],
  );

  const value = useMemo(() => ({ bus, openDialog }), [bus, openDialog]);

  return (
    <PrimeServicesContext.Provider value={value}>
      <Toast />
      {children}
      <ConfirmDialog />
      {dialogs.map((d) => (
        <DynamicDialogHost key={d.id} dlg={d} onClose={onClose} onRemoved={onRemoved} />
      ))}
    </PrimeServicesContext.Provider>
  );
}

/** MessageService equivalent. `add({ severity, summary, detail, life, sticky, key, ... })`, `addAll([...])`, `clear(key?)`, `remove(id)`. */
export function useToast() {
  const { bus } = usePrimeServices();
  return useMemo(
    () => ({
      add: (m: ToastMessage) => bus.add(m),
      addAll: (m: ToastMessage[]) => bus.add(m),
      clear: (key?: string) => bus.clear(key),
      remove: (id: unknown) => bus.remove(id),
    }),
    [bus],
  );
}

/** ConfirmationService equivalent. `confirm({ header, message, icon, acceptLabel, rejectLabel, acceptButtonStyleClass, rejectButtonStyleClass, accept, reject, key })`. */
export function useConfirm() {
  const { bus } = usePrimeServices();
  return useMemo(
    () => ({
      confirm: (c: Confirmation) => bus.confirm(c),
      close: () => bus.confirm(null),
    }),
    [bus],
  );
}

/** DialogService equivalent: `open(Component, { header, width, modal, dismissableMask, closable, data, ... })` -> `{ close, onClose }` (or null when the same component is already open). */
export function useDialogService() {
  const { openDialog } = usePrimeServices();
  return useMemo(
    () => ({
      open: <D = any, R = unknown>(component: (props: DynamicDialogComponentProps<D, R>) => ReactNode, config?: DynamicDialogConfig) =>
        openDialog<D, R>(component, config),
    }),
    [openDialog],
  );
}
