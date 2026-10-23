<script lang="ts">
  /**
   * Sistema de iconos de e-Meil: SVG de trazo uniforme (1.7px, extremos
   * redondeados) sobre una grilla de 20×20, coloreados con `currentColor`
   * para heredar estado (reposo/hover/activo/acentos del tema).
   */
  interface Props { name: string; size?: number; }
  let { name, size = 16 }: Props = $props();

  const ICONS: Record<string, string> = {
    mail: '<rect x="2.5" y="4" width="15" height="11.5" rx="2.2"/><path d="M4 6.2 10 10.7l6-4.5"/>',
    calendar: '<rect x="2.5" y="3.5" width="15" height="14" rx="2.2"/><path d="M2.5 7.5h15"/><path d="M6.5 2v3M13.5 2v3"/>',
    contacts: '<circle cx="10" cy="6.3" r="3.2"/><path d="M4 16.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/>',
    sliders: '<path d="M4 5.5h12M4 10h12M4 14.5h12"/><circle cx="8" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12.5" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="6.5" cy="14.5" r="1.6" fill="currentColor" stroke="none"/>',
    grid: '<rect x="2.5" y="2.5" width="6.6" height="6.6" rx="1.5"/><rect x="10.9" y="2.5" width="6.6" height="6.6" rx="1.5"/><rect x="2.5" y="10.9" width="6.6" height="6.6" rx="1.5"/><rect x="10.9" y="10.9" width="6.6" height="6.6" rx="1.5"/>',
    search: '<circle cx="9" cy="9" r="5.2"/><path d="M13 13l4.5 4.5"/>',
    help: '<circle cx="10" cy="10" r="7.5"/><path d="M8 8a2.4 2.4 0 1 1 3.6 2c-.9.6-1.1 1-1.1 2"/><path d="M10 14.6h.01"/>',
    palette: '<path d="M10 2.5a7.5 7.5 0 1 0 0 15c1.4 0 1.8-1 1.2-1.9-.8-1.2 0-2.4 1.4-2.4h2A3.9 3.9 0 0 0 17.5 9.5 7.8 7.8 0 0 0 10 2.5z"/><circle cx="7" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="12.8" cy="6.4" r=".9" fill="currentColor" stroke="none"/><circle cx="6.4" cy="11.8" r=".9" fill="currentColor" stroke="none"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    inbox: '<path d="M3.5 11v4a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4"/><path d="M2.8 11h4l1.3 2.3h3.8L13.2 11h4"/><path d="M5.3 5.6a2 2 0 0 1 1.9-1.1h5.6a2 2 0 0 1 1.9 1.1l2.5 5.4"/>',
    star: '<path d="M10 3.2l2.3 4.7 5.2.8-3.7 3.6.9 5.1-4.7-2.5-4.7 2.5.9-5.1-3.7-3.6 5.2-.8z"/>',
    dots: '<circle cx="4.8" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.2" cy="10" r="1.4" fill="currentColor" stroke="none"/>',
    sort: '<path d="M6.5 4v12M6.5 16l-2.2-2.2M6.5 16l2.2-2.2"/><path d="M13.5 16V4M13.5 4l-2.2 2.2M13.5 4l2.2 2.2"/>',
    refresh: '<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.8 2.6v3.2h-3.2"/>',
    funnel: '<path d="M3 4.5h14l-5.4 6.3v4.7l-3.2 1.8v-6.5z"/>',
    back: '<path d="M16.5 10H4"/><path d="M8.5 5.5 4 10l4.5 4.5"/>',
    archive: '<rect x="3" y="4" width="14" height="4" rx="1.2"/><path d="M4.5 8v7.5A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V8"/><path d="M8.5 11h3"/>',
    trash: '<path d="M4 5.5h12"/><path d="M8 5.5V4a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 12 4v1.5"/><path d="M5.5 5.5l.7 10a2 2 0 0 0 2 1.9h3.6a2 2 0 0 0 2-1.9l.7-10"/><path d="M8.5 9v5M11.5 9v5"/>',
    seen: '<path d="M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10s-3 5.5-7.5 5.5S2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.4"/>',
    move: '<path d="M10 13.5V4"/><path d="M6.5 7.5 10 4l3.5 3.5"/><path d="M4 13.5v2A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
    reply: '<path d="M8 5.5 3.5 10 8 14.5"/><path d="M3.5 10h8.5a4.5 4.5 0 0 1 4.5 4.5V16"/>',
    forward: '<path d="M12 5.5 16.5 10 12 14.5"/><path d="M16.5 10H8a4.5 4.5 0 0 0-4.5 4.5V16"/>',
    react: '<circle cx="10" cy="10" r="7.5"/><path d="M7 8.2h.01M13 8.2h.01" stroke-width="2.2"/><path d="M7 12.6a4.5 4.5 0 0 0 6 0"/>',
    'chevron-down': '<path d="M6 8l4 4 4-4"/>',
    paperclip: '<path d="M16.2 8.4l-6.9 6.9a3.7 3.7 0 0 1-5.2-5.2l7.4-7.4a2.5 2.5 0 0 1 3.5 3.5l-7.3 7.4a1.3 1.3 0 0 1-1.8-1.8l6.5-6.5"/>',
    list: '<path d="M4 5.5h.01M4 10h.01M4 14.5h.01" stroke-width="2.8"/><path d="M7.5 5.5h8.5M7.5 10h8.5M7.5 14.5h8.5"/>',
    align: '<path d="M4 5.5h12M4 10h8M4 14.5h10"/>',
    pen: '<path d="M4 16l1-3.5L14.5 3a1.8 1.8 0 0 1 2.5 2.5L7.5 15z"/><path d="M13 6l1.5 1.5"/>',
    undo: '<path d="M8 5.5 4 9.5l4 4"/><path d="M4 9.5h7.5a4.5 4.5 0 0 1 4.5 4.5v1"/>',
    redo: '<path d="M12 5.5l4 4-4 4"/><path d="M16 9.5H8.5A4.5 4.5 0 0 0 4 14v1"/>',
    download: '<path d="M10 3.5V12"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 13v2.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V13"/>',
    check: '<path d="M4 10.5l4 4 8-9"/>',
    save: '<path d="M4.5 3.5h10L17 6v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M7 3.5V8h5V3.5"/><path d="M7 13.5h6"/>',
    send: '<path d="M17.5 3 2.5 9.5l6 2.5 2.5 6z"/><path d="M17.5 3 8.5 12"/>',
  };
</script>

<svg
  class="emeil-icon"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>{@html ICONS[name] ?? ''}</svg>
