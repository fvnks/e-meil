mod accounts;
mod cache;
mod credentials;
mod imap_client;
mod oauth;
mod pop3_client;
mod smtp_client;
mod tray;
mod updater;
mod graph;
mod graph_actions;
mod graph_send;
use oauth::OAuthState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            credentials::save_credential,
            credentials::delete_credential,
            credentials::credential_backend_status,
            accounts::list_accounts,
            accounts::save_account,
            accounts::delete_account,
            cache::list_cached_messages,
            cache::upsert_cached_messages,
            cache::update_cached_message_state,
            imap_client::test_imap_connection,
            imap_client::list_imap_folders,
            imap_client::list_imap_messages,
            imap_client::list_imap_messages_incremental,
            imap_client::set_imap_seen,
            imap_client::download_imap_attachment,
            imap_client::move_imap_message,
            imap_client::delete_imap_message,
            imap_client::append_imap_sent_message,
            imap_client::read_imap_message,
            imap_client::search_imap_messages,
            imap_client::save_imap_draft,
            pop3_client::test_pop3_connection,
            pop3_client::list_pop3_messages,
            pop3_client::read_pop3_message,
            pop3_client::delete_pop3_message,
            oauth::start_microsoft_oauth,
            oauth::start_microsoft_oauth_window,
            oauth::poll_microsoft_oauth,
            oauth::start_google_oauth,
            oauth::poll_google_oauth,
            smtp_client::send_smtp_mail,
            smtp_client::inspect_attachment,
            graph::list_graph_messages,
            graph_actions::mark_graph_message,
            graph_actions::archive_graph_message,
            graph_actions::delete_graph_message,
            graph_send::send_graph_message,
            graph_send::create_graph_draft,
            tray::set_tray_badge,
            updater::check_app_update,
            updater::install_app_update
        ])
        .setup(|app| {
            // Ícono de bandeja con menú (Abrir / Redactar / Sincronizar / Salir).
            tray::build_tray(app.handle())?;
            // En desarrollo no existe instalador que registre el esquema:
            // mailto: se registra en el registro de Windows al vuelo.
            #[cfg(debug_assertions)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Como Outlook: cerrar la ventana principal la oculta en la bandeja;
            // "Salir" del menú de la bandeja es lo que termina la app.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running e-Meil");
}
