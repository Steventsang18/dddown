use std::path::Path;

fn main() {
    // release 构建嵌入 web/dist，目录变化时触发重编译
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    println!("cargo:rerun-if-changed={}", dist.display());

    // Windows 产物嵌入应用图标（CI 在 Windows runner 上构建时生效）
    #[cfg(target_os = "windows")]
    winresource::WindowsResource::new()
        .set_icon("../../packaging/dddown.ico")
        .compile()
        .expect("embed windows icon failed");
}
