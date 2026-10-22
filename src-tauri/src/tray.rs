use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Construye el ícono de bandeja con menú: Abrir, Redactar, Sincronizar, Salir.
/// El clic izquierdo muestra la ventana principal; cerrar la ventana la
/// oculta en la bandeja (Salir del menú termina la app, como Outlook).
pub(crate) fn build_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Abrir e-Meil", true, None::<&str>)?;
    let compose = MenuItem::with_id(app, "compose", "Redactar mensaje", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizar ahora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &compose, &sync, &quit])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("e-Meil")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "compose" => {
                show_main(app);
                let _ = app.emit("tray-action", "compose");
            }
            "sync" => {
                show_main(app);
                let _ = app.emit("tray-action", "sync");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. }) {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Actualiza el tooltip de la bandeja con el total de no leídos de la cuenta
/// activa (el badge numérico sobre el ícono no es portable; el tooltip sí).
#[tauri::command]
pub fn set_tray_badge(app: AppHandle, unread: Option<u32>) -> Result<(), String> {
    let tray = app.tray_by_id("main-tray").ok_or("La bandeja no está disponible")?;
    let tooltip = match unread {
        Some(0) | None => "e-Meil".to_string(),
        Some(count) => format!("e-Meil — {count} sin leer"),
    };
    tray.set_tooltip(Some(tooltip)).map_err(|e| format!("No se pudo actualizar la bandeja: {e}"))
}
