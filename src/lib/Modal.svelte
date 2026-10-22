<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Controla la visibilidad del modal. */
    open: boolean;
    /** Texto visible del encabezado; se enlaza con `aria-labelledby`. */
    title: string;
    /** Callback invocado al cerrar (ESC, clic en el fondo o botón de cierre). */
    onclose: () => void;
    /** Clases extra para el panel interior del modal. */
    class?: string;
    /** Contenido del modal. */
    children: Snippet;
  }

  let { open, title, onclose, class: className = '', children }: Props = $props();

  let dialogEl: HTMLElement | undefined = $state();
  let previousFocus: HTMLElement | null = null;

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  function getFocusable(): HTMLElement[] {
    const el = untrack(() => dialogEl);
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (node) => node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!untrack(() => open)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusable();
    const el = untrack(() => dialogEl);
    if (!focusable.length) {
      event.preventDefault();
      el?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && (active === first || active === el || !el?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !el?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open) return;

    previousFocus = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', handleKeydown, true);

    tick().then(() => {
      const focusable = getFocusable();
      const target = focusable[0] ?? untrack(() => dialogEl);
      target?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeydown, true);
      const restore = previousFocus;
      previousFocus = null;
      restore?.focus?.();
    };
  });
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}
  >
    <div
      class="modal {className}"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      bind:this={dialogEl}
    >
      <h3 id={titleId}>{title}</h3>
      {@render children()}
    </div>
  </div>
{/if}
