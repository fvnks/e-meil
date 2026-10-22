import type { MailMessage } from './types';

/** UI-only fixtures. Replace with a repository implementation before real accounts. */
export const demoMessages: MailMessage[] = [
  { id: 'demo-1', accountId: 'demo-account', folderId: 'inbox', fromName: 'Sofía Martínez', fromAddress: 'sofia.martinez@estudio.co', subject: 'Propuesta visual — identidad de marca', preview: 'Hola, te comparto la primera versión del sistema visual. He incluido algunas alternativas de color para que podamos revisarlas…', receivedAt: '2026-10-19T10:42:00-03:00', unread: true, starred: true, hasAttachments: true },
  { id: 'demo-2', accountId: 'demo-account', folderId: 'inbox', fromName: 'El equipo de Linear', fromAddress: 'updates@linear.app', subject: 'Tu resumen semanal está listo', preview: 'Esta semana el equipo completó 8 tareas y abrió 3 nuevos proyectos. Mira las novedades que te esperan en tu espacio…', receivedAt: '2026-10-19T09:18:00-03:00', unread: true, starred: false, hasAttachments: false },
];
