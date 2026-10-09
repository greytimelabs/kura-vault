import { clsx } from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;

export interface ZoomHandle {
  zoomBy(factor: number): void;
  reset(): void;
}

interface ZoomableImageProps {
  /** Full-quality image, once decrypted. */
  src: string | undefined;
  /** Low-resolution stand-in shown until `src` is ready. */
  placeholderSrc: string | undefined;
  alt: string;
}

// Safari reports trackpad pinches through its own gesture events rather than ctrl+wheel
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Image with wheel / pinch / double-click zoom and drag-to-pan.
 * Mount with a `key` per photo so each one starts unzoomed.
 */
export const ZoomableImage = forwardRef<ZoomHandle, ZoomableImageProps>(function ZoomableImage(
  { src, placeholderSrc, alt },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const controls = useRef<ZoomHandle>({ zoomBy: () => undefined, reset: () => undefined });

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => controls.current.zoomBy(factor),
    reset: () => controls.current.reset(),
  }));

  useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return;

    const apply = (animate = false) => {
      const { scale, x, y } = view.current;
      layer.style.transition = animate ? 'transform 160ms ease-out' : 'none';
      layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      stage.style.cursor = scale > 1 ? 'grab' : 'default';
    };

    // Keep the image from being dragged off the stage
    const clamp = () => {
      const v = view.current;
      const maxX = (stage.clientWidth * (v.scale - 1)) / 2;
      const maxY = (stage.clientHeight * (v.scale - 1)) / 2;
      v.x = Math.min(maxX, Math.max(-maxX, v.x));
      v.y = Math.min(maxY, Math.max(-maxY, v.y));
    };

    /** Zoom to `nextScale`, keeping the point under (clientX, clientY) where it is. */
    const zoomTo = (nextScale: number, clientX?: number, clientY?: number, animate = false) => {
      const v = view.current;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const rect = stage.getBoundingClientRect();
      const px = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
      const py = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
      const ratio = scale / v.scale;
      v.x = px - (px - v.x) * ratio;
      v.y = py - (py - v.y) * ratio;
      v.scale = scale;
      if (scale === 1) {
        v.x = 0;
        v.y = 0;
      }
      clamp();
      apply(animate);
    };

    controls.current = {
      zoomBy: (factor) => zoomTo(view.current.scale * factor, undefined, undefined, true),
      reset: () => zoomTo(1, undefined, undefined, true),
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Firefox reports mouse wheels in lines, not pixels
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const delta = event.deltaY * unit;
      // ctrlKey marks a trackpad pinch in Chrome and Firefox; its deltas are much smaller
      const sensitivity = event.ctrlKey ? 0.01 : 0.0015;
      zoomTo(view.current.scale * Math.exp(-delta * sensitivity), event.clientX, event.clientY);
    };

    let gestureStartScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartScale = view.current.scale;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEvent;
      zoomTo(gestureStartScale * gesture.scale, gesture.clientX, gesture.clientY);
    };

    const onDoubleClick = (event: MouseEvent) => {
      zoomTo(view.current.scale > 1 ? 1 : DOUBLE_CLICK_SCALE, event.clientX, event.clientY, true);
    };

    let drag: { id: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (view.current.scale <= 1 || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.style.cursor = 'grabbing';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      view.current.x += event.clientX - drag.x;
      view.current.y += event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      clamp();
      apply();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      apply();
    };

    const onResize = () => {
      clamp();
      apply();
    };

    // passive: false so the page itself does not scroll or zoom underneath
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('gesturestart', onGestureStart);
    stage.addEventListener('gesturechange', onGestureChange);
    stage.addEventListener('dblclick', onDoubleClick);
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);
    apply();

    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('gesturestart', onGestureStart);
      stage.removeEventListener('gesturechange', onGestureChange);
      stage.removeEventListener('dblclick', onDoubleClick);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div ref={stageRef} className="absolute inset-0 touch-none overflow-hidden" data-testid="viewer-stage">
      <div ref={layerRef} className="absolute inset-0 will-change-transform">
        {placeholderSrc && (
          <img
            src={placeholderSrc}
            alt=""
            aria-hidden
            draggable={false}
            className={clsx(
              'absolute inset-0 size-full object-contain blur-md transition-opacity duration-200',
              src ? 'opacity-0' : 'opacity-100',
            )}
          />
        )}
        {src && (
          <img
            src={src}
            alt={alt}
            draggable={false}
            data-testid="viewer-image"
            className="fade-in absolute inset-0 size-full object-contain"
          />
        )}
      </div>
    </div>
  );
});
