mod accounts;
mod cache;
mod credentials;
mod imap_client;
mod oauth;
mod pop3_client;
mod smtp_client;
mod graph;
mod graph_actions;
mod graph_send;
use oauth::OAuthState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthState::default())
        .plugin(tauri_plugin_dialog::init())
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
            pop3_client::test_pop3_connection,
            pop3_client::list_pop3_messages,
            pop3_client::read_pop3_message,
            oauth::start_microsoft_oauth,
            oauth::poll_microsoft_oauth,
            pop3_client::delete_pop3_message,
            smtp_client::send_smtp_mail,
            smtp_client::inspect_attachment,
            graph::list_graph_messages,
            graph_actions::mark_graph_message,
            graph_actions::archive_graph_message,
            graph_actions::delete_graph_message,
            graph_send::send_graph_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running e-Meil");
}
