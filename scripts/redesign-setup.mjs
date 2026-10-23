/**
 * Rediseño del asistente "Conecta tu correo" (sesión 14).
 * - Markup: lomo de marca (split-panel) + pasos 01/02 + tiles con SVG.
 * - CSS: reemplazo del bloque setup completo (de .setup-window a .sidebar).
 * Uso: node scripts/redesign-setup.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const appFile = new URL('../src/App.svelte', import.meta.url);
const cssFile = new URL('../src/styles.css', import.meta.url);
let app = readFileSync(appFile, 'utf8');
let css = readFileSync(cssFile, 'utf8');

// ---------- 1. Nuevo markup del asistente ----------
const MS_SVG = `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="2" width="7.5" height="7.5" rx="1.6"/><rect x="2" y="10.5" width="7.5" height="7.5" rx="1.6"/><rect x="10.5" y="10.5" width="7.5" height="7.5" rx="1.6"/></svg>`;
const IMAP_SVG = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2.5"/><path d="M3.5 6.5 10 11l6.5-4.5"/></svg>`;
const POP_SVG = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3.5" width="12.5" height="9.5" rx="2"/><path d="M3.5 5.5 8.25 9l4.75-3.5"/><path d="M16 8.5v7M13.5 13l2.5 2.5 2.5-2.5"/></svg>`;
const BRAND_SVG = `<svg width="22" height="19" viewBox="0 0 24 20" fill="none" aria-hidden="true"><path d="M3 5.5 12 12l9-6.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const NEW_SETUP = `{#if setupOpen}<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) setupOpen = false; }}><section class="setup-window" aria-label={t('setup.windowLabel')}><aside class="setup-brand"><div class="setup-brand-mark">${BRAND_SVG}</div><span class="setup-brand-name">e-meil</span><p class="setup-brand-tagline">{t('setup.tagline')}</p><ol class="setup-steps"><li class:active={setupStep === 'provider'} class:done={setupStep !== 'provider'}><span>01</span>{t('setup.step1')}</li><li class:active={setupStep === 'details'}><span>02</span>{t('setup.step2')}</li></ol><span class="setup-brand-version">v0.1.0 · MIT</span></aside><div class="setup-main"><header class="setup-header"><div><span class="setup-kicker">{t('setup.title')}</span><h2>{setupStep === 'provider' ? t('setup.pickTitle') : t('setup.detailsTitle')}</h2><p>{setupStep === 'provider' ? t('setup.pickSub') : t('setup.detailsSub')}</p></div><button class="setup-close" type="button" onclick={() => setupOpen = false} aria-label={t('common.close')}>×</button></header>{#if setupStep === 'provider'}<div class="provider-options"><button class="provider-choice" onclick={() => chooseProvider('microsoft-graph')}><span class="provider-mark">${MS_SVG}</span><strong>{t('setup.providerMs')}</strong><small>{t('setup.msLogin')}</small></button><button class="provider-choice" onclick={() => chooseProvider('imap')}><span class="provider-mark">${IMAP_SVG}</span><strong>IMAP</strong><small>{t('setup.imapDesc')}</small></button><button class="provider-choice" onclick={() => chooseProvider('pop3')}><span class="provider-mark">${POP_SVG}</span><strong>POP3</strong><small>{t('setup.pop3Desc')}</small></button></div><p class="setup-note">{t('setup.note')}</p>{:else}<form class="account-form" onsubmit={saveAccount}><button type="button" class="back-link" onclick={() => setupStep = 'provider'}>{t('setup.changeType')}</button><div class="provider-badge">{#if setup.provider === 'microsoft-graph'}${MS_SVG}{t('setup.badgeMs')}{:else if setup.provider === 'imap'}${IMAP_SVG}IMAP · {t('setup.badgeManual')}{:else}${POP_SVG}POP3 · {t('setup.badgeManual')}{/if}</div><div class="setup-grid"><label>{t('setup.displayName')}<input bind:value={setup.displayName} placeholder="Mi cuenta personal"/></label><label>{t('setup.email')}<input type="email" bind:value={setup.emailAddress} placeholder="nombre@ejemplo.com" required onblur={applySuggestions}/></label></div>{#if setup.provider !== 'microsoft-graph'}<div class="server-block"><h3>{t('setup.incomingServer', { provider: setup.provider.toUpperCase() })}</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.incoming.host} placeholder="imap.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.incoming.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.incoming.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label><h3>{t('setup.outgoing')}</h3><div class="server-fields"><label>{t('setup.server')}<input bind:value={setup.outgoing!.host} placeholder="smtp.ejemplo.com" required/></label><label>{t('setup.port')}<input type="number" bind:value={setup.outgoing!.port} required/></label></div><label>{t('setup.security')}<select bind:value={setup.outgoing!.security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label></div><div class="setup-grid"><label>{t('setup.user')}<input bind:value={setup.incoming.username} placeholder="Normalmente tu dirección de correo"/></label><label>{t('setup.password')}<input type="password" bind:value={setup.secret} autocomplete="new-password" placeholder={t('setup.passwordPlaceholder')}/></label></div><p class="security-hint">{t('setup.passwordHint')}</p>{:else}<div class="oauth-explainer"><span>${MS_SVG}</span><div><strong>{t('setup.secureLogin')}</strong><p>{t('setup.msOauthExplainer')}</p><label>Client ID de Microsoft Entra ID<input bind:value={microsoftClientId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label><button type="button" class="oauth-button" onclick={startMicrosoftLogin} disabled={oauthBusy}>{oauthBusy ? t('common.loading') : t('setup.msLoginButton')}</button></div></div>{/if}{#if setupError}<p class="setup-error">{setupError}</p>{/if}{#if setupInfo}<p class="setup-message">{setupInfo}</p>{/if}<footer class="setup-footer"><button type="button" class="cancel-setup" onclick={() => setupStep = 'provider'}>{t('setup.changeType')}</button>{#if setup.provider === 'imap' || setup.provider === 'pop3'}<button type="button" class="cancel-setup" onclick={testConnection} disabled={testingConnection}>{testingConnection ? t('common.loading') : t('setup.testConnection')}</button>{/if}<button type="button" class="cancel-setup" onclick={() => setupOpen = false}>{t('common.cancel')}</button><button class="setup-submit" type="submit">{setup.provider === 'microsoft-graph' ? t('setup.msContinue') : t('setup.addAccount')}</button></footer></form>{/if}</div></section></div>{/if}
`;

const i = app.indexOf('{#if setupOpen}');
const j = app.indexOf('{#if contextMenu}', i);
if (i < 0 || j < 0) throw new Error('No se encontró el bloque del asistente');
app = app.slice(0, i) + NEW_SETUP + '\n' + app.slice(j);
writeFileSync(appFile, app);
console.log('markup del asistente reemplazado (' + (j - i) + ' → ' + NEW_SETUP.length + ' chars)');

// ---------- 2. Nuevo CSS del asistente ----------
const NEW_CSS = `/* --- Asistente de cuentas: tarjeta dividida (lomo de marca + pasos) --- */
.setup-window{width:min(760px,94vw);max-height:92vh;background:var(--paper);border-radius:14px;box-shadow:0 32px 80px #0006;display:grid;grid-template-columns:218px 1fr;animation:panel-enter .22s ease both;overflow:hidden}
.setup-brand{background:#212227;color:#e8e9ec;display:flex;flex-direction:column;align-items:flex-start;padding:26px 20px;gap:6px}
.setup-brand-mark{width:42px;height:38px;border-radius:12px;background:#6557d9;display:grid;place-items:center;transform:rotate(-6deg);box-shadow:0 6px 18px #6557d955;margin-bottom:12px}
.setup-brand-mark svg{transform:rotate(6deg)}
.setup-brand-name{font-family:Manrope,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.8px}
.setup-brand-tagline{margin:0;font-size:10.5px;color:#9aa0ab;line-height:1.55}
.setup-steps{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:14px;width:100%}
.setup-steps li{display:flex;align-items:center;gap:9px;font-size:9.5px;color:#8b90a0;letter-spacing:.5px;text-transform:uppercase;font-weight:600}
.setup-steps li span{width:22px;height:22px;border-radius:50%;border:1px solid #3a3b42;display:grid;place-items:center;font-size:9px;flex:none}
.setup-steps li.active{color:#e8e9ec}
.setup-steps li.active span{background:#6557d9;border-color:#6557d9;color:#fff}
.setup-steps li.done span{border-color:#6557d9;color:#a89df8;background:transparent}
.setup-brand-version{margin-top:auto;font-size:9px;color:#6a6d78;letter-spacing:.6px}
.setup-main{display:flex;flex-direction:column;min-width:0;overflow:auto;max-height:92vh}
.setup-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:26px 26px 0}
.setup-header h2{font-family:Manrope,sans-serif;font-size:21px;letter-spacing:-.6px;margin:4px 0 0;color:var(--ink)}
.setup-header p{font-size:11px;color:var(--muted);margin:6px 0 0;line-height:1.5}
.setup-kicker{font-size:9px;letter-spacing:1.6px;color:var(--accent-ink);font-weight:700}
.setup-close{border:0;background:transparent;color:var(--muted);width:28px;height:28px;border-radius:50%;font-size:16px;cursor:pointer;flex:none}
.setup-close:hover{background:var(--surface-input);color:var(--ink)}
.provider-options{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:20px 26px 0}
.provider-choice{border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:16px 13px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:10px;cursor:pointer;text-align:left;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease}
.provider-choice:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 10px 24px #0000000d}
.provider-mark{width:34px;height:34px;border-radius:9px;background:var(--surface-input);color:var(--ink);display:grid;place-items:center;transition:background .15s ease,color .15s ease}
.provider-choice:hover .provider-mark{background:var(--accent-soft);color:var(--accent-ink)}
.provider-choice strong{font-size:11.5px;font-weight:700;color:var(--ink);line-height:1.25}
.provider-choice small{font-size:9.5px;color:var(--muted);line-height:1.45}
.setup-note{margin:16px 26px 24px;padding:10px 12px;background:var(--surface);border-radius:8px;font-size:9.5px;line-height:1.6;color:var(--muted)}
.account-form{display:flex;flex-direction:column;gap:12px;padding:18px 26px 22px}
.back-link{border:0;background:none;color:var(--accent-ink);font-size:10px;font-weight:600;text-align:left;padding:0;width:fit-content;cursor:pointer}
.back-link:hover{text-decoration:underline}
.provider-badge{display:inline-flex;align-items:center;gap:8px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px 10px;align-self:flex-start}
.provider-badge svg{color:var(--accent-ink)}
.account-form>label,.server-block>label,.server-fields label,.setup-grid label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase}
.setup-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.account-form input,.server-block input,.account-form select,.oauth-explainer input{height:36px;border:1px solid var(--line);border-radius:7px;padding:0 11px;background:var(--paper);color:var(--ink);outline:none;font:inherit;font-size:11.5px;transition:border-color .15s ease,box-shadow .15s ease}
.account-form input:focus,.account-form select:focus,.oauth-explainer input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.account-form input::placeholder,.oauth-explainer input::placeholder{color:var(--muted)}
.server-block{border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:12px;background:var(--surface)}
.server-block h3{margin:0;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:700}
.server-fields{display:grid;grid-template-columns:1fr 88px;gap:10px}
.security-hint{margin:0;font-size:9.5px;line-height:1.55;color:var(--muted);padding-left:2px}
.oauth-explainer{display:flex;gap:14px;padding:16px;background:var(--accent-soft);border-radius:10px}
.oauth-explainer>span{width:34px;height:34px;flex:none;border-radius:9px;background:var(--paper);color:var(--accent-ink);display:grid;place-items:center}
.oauth-explainer strong{font-size:12px;font-family:Manrope,sans-serif;display:block;color:var(--ink)}
.oauth-explainer p{margin:4px 0 10px;font-size:10px;line-height:1.55;color:var(--muted)}
.oauth-explainer label{display:flex;flex-direction:column;gap:5px;font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}
.oauth-explainer input{width:100%}
.oauth-button{margin-top:10px;height:36px;border:0;border-radius:7px;background:var(--accent);color:#fff;font-weight:600;font-size:11.5px;cursor:pointer}
.oauth-button:hover{filter:brightness(1.06)}
.oauth-button:disabled{opacity:.6;cursor:wait}
.setup-error{font-size:10px;line-height:1.5;color:var(--danger-ink);background:var(--danger-soft);border-radius:6px;padding:8px 10px;margin:0}
.setup-message{font-size:10px;line-height:1.5;color:var(--muted);margin:0}
.setup-footer{margin-top:auto;border-top:1px solid var(--line);padding:13px 26px;display:flex;gap:8px;align-items:center}
.setup-footer .back-link{margin-right:auto}
.cancel-setup{height:32px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:7px;padding:0 13px;font-size:10.5px;font-weight:600;cursor:pointer}
.cancel-setup:hover{background:var(--surface-input)}
.cancel-setup:disabled{opacity:.55;cursor:wait}
.setup-submit{height:32px;border:0;border-radius:7px;background:var(--accent);color:#fff;padding:0 16px;font-size:10.5px;font-weight:600;cursor:pointer}
.setup-submit:hover{filter:brightness(1.06)}
`;

const cssStart = css.indexOf('.setup-window{');
const cssEnd = css.indexOf('.sidebar{', cssStart);
if (cssStart < 0 || cssEnd < 0) throw new Error('No se encontró el bloque CSS del asistente');
css = css.slice(0, cssStart) + NEW_CSS + css.slice(cssEnd);
writeFileSync(cssFile, css);
console.log('CSS del asistente reemplazado (' + (cssEnd - cssStart) + ' → ' + NEW_CSS.length + ' chars)');

// ---------- 3. Ajustes móviles del asistente ----------
const MOBILE_ANCHOR = '  .calendar-header{flex-wrap:wrap;gap:8px}';
const MOBILE_ADD = `  .setup-window{grid-template-columns:1fr}
  .setup-brand{display:none}
  .setup-header{padding:18px 16px 0}
  .provider-options{grid-template-columns:1fr;padding:14px 16px 0}
  .setup-note{margin:14px 16px 16px}
  .account-form{padding:14px 16px 18px}
  .setup-grid{grid-template-columns:1fr}
  .setup-footer{padding:12px 16px;flex-wrap:wrap}
  .calendar-header{flex-wrap:wrap;gap:8px}`;
if (css.includes(MOBILE_ANCHOR)) {
  css = css.replace(MOBILE_ANCHOR, MOBILE_ADD);
  writeFileSync(cssFile, css);
  console.log('reglas móviles del asistente agregadas');
} else {
  console.log('WARN: no se encontró el ancla móvil (.calendar-header en media query)');
}
