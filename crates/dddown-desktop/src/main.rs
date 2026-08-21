// Windows release 隐藏控制台（debug 保留以便看日志）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rand::Rng;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

/// server 子进程句柄，app 退出时回收
static SERVER_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
/// 自启菜单项句柄，点击后更新勾选状态
static AUTOSTART_ITEM: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>> = Mutex::new(None);

fn main() {
    tauri::Builder::default()
        // single-instance 必须在 setup 之前注册：第二个实例在 run() 入口即被拦截，
        // 不会走到 setup，也就不会白启动 server 子进程
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 重复启动时把已有窗口带到前台
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let url = launch_server();
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url),
            )
            .title("DDDown")
            .inner_size(1200.0, 800.0)
            .build()?;

            setup_tray(app.handle())?;
            Ok(())
        })
        // 托盘常驻模型：关窗只隐藏窗口，server 继续跑；
        // 真正退出只走托盘「退出」→ exit(0) → RunEvent::Exit 回收子进程
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(|_app, event| {
            // exit() 会直接终止事件循环，main 后续代码不执行；
            // 子进程回收必须放在 RunEvent::Exit 钩子里
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = SERVER_CHILD.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

/// 托盘：单击恢复窗口；右键菜单含 显示 / 开机时启动 / 退出
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示 DDDown").build(app)?;
    let autostart = app.autolaunch();
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机时启动",
        true,
        autostart.is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    *AUTOSTART_ITEM.lock().unwrap() = Some(autostart_item.clone());
    let quit = MenuItemBuilder::with_id("quit", "退出 DDDown").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&autostart_item)
        .separator()
        .item(&quit)
        .build()?;

    // 托盘专用图标：透明底、去白底、圆润饱满（编译期嵌入）
    let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
    let tray_icon = tauri::image::Image::from_bytes(tray_icon_bytes)
        .expect("failed to load tray icon");

    TrayIconBuilder::with_id("dddown-tray")
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "autostart" => {
                let autostart = app.autolaunch();
                let enabled = autostart.is_enabled().unwrap_or(false);
                let result = if enabled {
                    autostart.disable()
                } else {
                    autostart.enable()
                };
                // 只有系统注册成功才更新勾选状态
                match result {
                    Ok(()) => {
                        // enable/disable 后立即复查，暴露静默失败
                        let recheck = autostart.is_enabled();
                        eprintln!(
                            "[autostart] {} -> Ok, recheck is_enabled={:?}, exe={:?}",
                            if enabled { "disable" } else { "enable" },
                            recheck,
                            std::env::current_exe()
                        );
                        if let Some(item) = AUTOSTART_ITEM.lock().unwrap().as_ref() {
                            let _ = item.set_checked(!enabled);
                        }
                    }
                    Err(e) => eprintln!("autostart toggle failed: {e}"),
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 单击/双击图标都恢复窗口
            if matches!(event, tauri::tray::TrayIconEvent::Click { .. }) {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 启动 dddown-server 子进程并等待就绪，返回带 token 的访问 URL
fn launch_server() -> url::Url {
    // 预留随机端口（先 bind 再 drop，系统不会立即复用）
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("failed to find free port");
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let token = generate_token();
    let server_bin = resolve_server_bin();

    let child = std::process::Command::new(&server_bin)
        .env("MD_PORT", port.to_string())
        .env("MD_TOKEN", &token)
        .env("MD_NO_BROWSER", "1")
        .spawn()
        .unwrap_or_else(|_| panic!("failed to start server at {}", server_bin.display()));
    *SERVER_CHILD.lock().unwrap() = Some(child);

    wait_for_ready(&format!("127.0.0.1:{port}"));

    format!("http://127.0.0.1:{port}/?token={token}")
        .parse()
        .unwrap()
}

/// 16 字节随机 hex，与 server 的 generate_token 规则一致
fn generate_token() -> String {
    let mut rng = rand::rng();
    let bytes: [u8; 16] = rng.random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 按顺序探测 server 二进制：
/// 1. 同目录 sidecar（打包后带 target-triple 后缀，或手动放置的 dddown）
/// 2. 开发环境回退：target/debug → target/release
fn resolve_server_bin() -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(dir) = &exe_dir {
        // Tauri sidecar 打包后保留 target-triple 后缀
        let sidecar_name = if cfg!(target_arch = "aarch64") {
            "dddown-aarch64-apple-darwin"
        } else {
            "dddown-x86_64-apple-darwin"
        };
        candidates.push(dir.join(sidecar_name));
        candidates.push(dir.join("dddown"));
    }
    candidates.push(std::path::PathBuf::from("target/debug/dddown"));
    candidates.push(std::path::PathBuf::from("target/release/dddown"));

    candidates
        .into_iter()
        .find(|p| p.is_file())
        .unwrap_or_else(|| std::path::PathBuf::from("target/debug/dddown"))
}

/// TCP 连接探测，成功即返回
fn wait_for_ready(host_port: &str) {
    for _ in 0..50 {
        if std::net::TcpStream::connect(host_port).is_ok() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    eprintln!("warning: server did not respond on {host_port} within 5s");
}
