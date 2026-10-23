//! Sistema de actualización de e-Meil contra GitHub Releases.
//!
//! La configuración de firma y endpoint vive en `tauri.conf.json`
//! (`plugins.updater`); las llaves se generaron con `tauri signer generate`.
//! La clave privada solo existe en el equipo local durante la compilación:
//! nunca va al repositorio. Windows se actualiza con NSIS/MSI y Linux con
//! AppImage; el paquete .deb se actualiza con apt, como toda la vida.
use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// La descarga completa se retiene entre comandos para que instalar no reconsulte.
/// El objeto `Update` del plugin es clonable y Send+Sync.
pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: String,
    pub notes: String,
}

/// Consulta el canal de releases (`releases/latest/download/latest.json`).
/// Si hay versión nueva, la deja en espera para `install_app_update`.
#[tauri::command]
pub async fn check_app_update(app: AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| format!("No se pudo preparar el actualizador: {e}"))?;
    let update = updater.check().await.map_err(|e| format!("No se pudo consultar la actualización: {e}"))?;
    let current_version = app.package_info().version.to_string();
    let info = match update {
        None => UpdateInfo { available: false, current_version, version: String::new(), notes: String::new() },
        Some(update) => {
            let info = UpdateInfo { available: true, current_version: current_version.clone(), version: update.version.clone(), notes: update.body.clone().unwrap_or_default() };
            *pending.0.lock().map_err(|_| "No se pudo registrar la actualización".to_string())? = Some(update);
            info
        }
    };
    Ok(info)
}

/// Descarga el paquete firmado, lo verifica contra la llave pública y
/// reinicia la aplicación con la versión nueva.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|_| "No se pudo leer la actualización".to_string())?.take();
    let Some(update) = update else { return Err("Busca actualizaciones primero: no hay un paquete en espera.".into()) };
    update
        .download_and_install(
            |_chunk: usize, _content_length: Option<u64>| {},
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo instalar la actualización: {e}"))?;
    // El reinicio corta el proceso: si llega aquí, no regresa.
    app.restart();
    // Never type: restart() corta el proceso. Rasgo defensivo por si cambia:
    #[allow(unreachable_code)]
    Ok(())
}

/// Descarta la actualización pendiente sin instalarla.
#[tauri::command]
pub async fn dismiss_app_update(pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    *pending.0.lock().map_err(|_| "No se pudo registrar la actualización".to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estructura_update_info_expone_campos_correctos() {
        let json = serde_json::to_string(&UpdateInfo { available: true, current_version: "0.1.0".into(), version: "0.2.0".into(), notes: "novedades".into() }).unwrap();
        assert!(json.contains("\"available\":true"), "{json}");
        assert!(json.contains("\"currentVersion\":\"0.1.0\""), "{json}");
        assert!(json.contains("\"version\":\"0.2.0\""), "{json}");
        assert!(json.contains("\"notes\":\"novedades\""), "{json}");
    }
}
