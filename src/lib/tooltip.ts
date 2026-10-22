/**
 * Acción `tooltip` para e-Meil: tooltip accesible para Svelte 5.
 *
 * Uso:
 *   <button use:tooltip("Abrir mensaje")>…</button>
 *   <span use:tooltip="Guardar borrador" tooltip:placement="bottom">…</span>
 *
 * Garantías de accesibilidad:
 *  - `role="tooltip"` en el elemento emergente.
 *  - El disparador recibe `aria-describedby` con el id del tooltip.
 *  - Se muestra con `mouseenter` y `focus` (foco accesible), y se oculta
 *    con `mouseleave`, `blur` y `Escape`.
 *  - Posicionamiento con `position: fixed` ajustado al viewport.
 *  - Respeto de `prefers-reduced-motion`.
 */

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipOptions {
  placement?: Placement;
  showDelay?: number;
  hideDelay?: number;
}

export function tooltip(node: HTMLElement, text: string, options: TooltipOptions = {}): {
  update(params: string): void;
  destroy(): void;
} {
  const { placement = 'top', showDelay = 300, hideDelay = 150 } = options;

  let currentText = text;
  let tooltipEl: HTMLDivElement | null = null;
  let tooltipId = '';
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;

  const GAP = 8;
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureTooltip(): HTMLDivElement | null {
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;

    tooltipId = `tooltip-${Math.random().toString(36).slice(2, 9)}`;
    const el = document.createElement('div');
    el.id = tooltipId;
    el.className = 'emeil-tooltip';
    el.setAttribute('role', 'tooltip');
    el.style.display = 'none';
    el.style.cssText += [
      'position:fixed',
      'z-index:9999',
      'max-width:280px',
      'padding:6px 10px',
      'background:var(--ink,#292b30)',
      'color:#fff',
      'font-size:11px',
      'line-height:1.45',
      'font-family:inherit',
      'border-radius:6px',
      'box-shadow:0 8px 24px #0004',
      'pointer-events:none',
      reducedMotion ? '' : 'animation:emeil-tooltip-in .12s ease both'
    ]
      .filter(Boolean)
      .join(';');
    el.textContent = currentText;
    document.body.appendChild(el);
    tooltipEl = el;

    if (!document.getElementById('emeil-tooltip-style')) {
      const style = document.createElement('style');
      style.id = 'emeil-tooltip-style';
      style.textContent = [
        '@keyframes emeil-tooltip-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}',
        '@media (prefers-reduced-motion: reduce){[id^=emeil-tooltip-style]}'
      ].join('\n');
      document.head.appendChild(style);
    }

    node.setAttribute('aria-describedby', tooltipId);
    return el;
  }

  function position(el: HTMLDivElement) {
    const triggerRect = node.getBoundingClientRect();
    const tooltipRect = el.getBoundingClientRect();
    const view = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - GAP;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        if (top < view.top) top = triggerRect.bottom + GAP;
        break;
      case 'bottom':
        top = triggerRect.bottom + GAP;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        if (top + tooltipRect.height > view.bottom) top = triggerRect.top - tooltipRect.height - GAP;
        break;
      case 'left':
        left = triggerRect.left - tooltipRect.width - GAP;
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        if (left < view.left) left = triggerRect.right + GAP;
        break;
      case 'right':
        left = triggerRect.right + GAP;
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        if (left + tooltipRect.width > view.right) left = triggerRect.left - tooltipRect.width - GAP;
        break;
    }

    left = Math.min(Math.max(left, view.left + GAP), view.right - tooltipRect.width - GAP);
    top = Math.min(Math.max(top, view.top + GAP), view.bottom - tooltipRect.height - GAP);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function show() {
    const el = ensureTooltip();
    if (!el) return;
    el.style.display = 'block';
    position(el);
    visible = true;
  }

  function hide() {
    if (!tooltipEl) return;
    tooltipEl.style.display = 'none';
    visible = false;
  }

  function scheduleShow() {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    openTimer = setTimeout(show, showDelay);
  }

  function scheduleHide() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, hideDelay);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && visible) {
      clearTimeout(openTimer);
      hide();
    }
  }

  const onScrollOrResize = () => {
    if (visible && tooltipEl) position(tooltipEl);
  };

  node.addEventListener('mouseenter', scheduleShow);
  node.addEventListener('mouseleave', scheduleHide);
  node.addEventListener('focus', scheduleShow);
  node.addEventListener('blur', scheduleHide);
  node.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);

  return {
    update(newText: string) {
      currentText = newText;
      if (tooltipEl) tooltipEl.textContent = newText;
    },
    destroy() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      node.removeEventListener('mouseenter', scheduleShow);
      node.removeEventListener('mouseleave', scheduleHide);
      node.removeEventListener('focus', scheduleShow);
      node.removeEventListener('blur', scheduleHide);
      node.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      node.removeAttribute('aria-describedby');
      tooltipEl?.remove();
      tooltipEl = null;
      visible = false;
    }
  };
}
