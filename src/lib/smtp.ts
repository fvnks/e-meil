import { invoke, isTauri } from '@tauri-apps/api/core';

export interface SendAttachment { path: string; filename: string; contentType: string; }
export interface SentCopyInput { host: string; port: number; security: string; username: string; mailbox: string; }
export interface SendMailInput { accountId: string; host: string; port: number; security: string; username: string; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; attachments: SendAttachment[]; sentCopy?: SentCopyInput; }
export interface AttachmentInfo { name: string; size: number; contentType: string; }
export interface SendSmtpResult { delivered: boolean; sentCopySaved: boolean | null; sentCopyError: string | null; }
export async function inspectAttachment(path: string): Promise<AttachmentInfo> { if (!isTauri()) throw new Error('Los adjuntos requieren la aplicación de escritorio.'); return invoke('inspect_attachment', { path }); }
export async function sendSmtpMail(input: SendMailInput): Promise<SendSmtpResult> { if (!isTauri()) throw new Error('El envío real solo está disponible en la aplicación de escritorio.'); return invoke<SendSmtpResult>('send_smtp_mail', { input }); }
