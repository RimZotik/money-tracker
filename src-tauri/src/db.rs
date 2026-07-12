use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

/// Открывает базу рядом с данными приложения, создаёт схему при первом запуске.
pub fn init(app_dir: PathBuf) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(&app_dir).ok();
    let path = app_dir.join("money.db");

    let is_fresh = !path.exists();
    let conn = Connection::open(path)?;

    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;

    conn.execute_batch(include_str!("schema.sql"))?;

    // Категории и правила заливаем только в пустую базу, чтобы не затирать
    // изменения пользователя при следующих запусках.
    if is_fresh {
        conn.execute_batch(include_str!("seed.sql"))?;
    }

    Ok(conn)
}
