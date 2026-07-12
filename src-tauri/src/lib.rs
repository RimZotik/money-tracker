mod commands;
mod db;
mod models;

use db::Db;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let conn = db::init(dir)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::adjust_balance,
            commands::list_categories,
            commands::list_categories_usage,
            commands::save_category,
            commands::delete_category,
            commands::list_projects,
            commands::save_project,
            commands::delete_project,
            commands::list_credits,
            commands::save_credit,
            commands::delete_credit,
            commands::list_transactions,
            commands::count_transactions,
            commands::save_transaction,
            commands::delete_transaction,
            commands::summary,
            commands::category_stats,
            commands::period_stats,
            commands::balance_at,
            commands::net_worth_series,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
