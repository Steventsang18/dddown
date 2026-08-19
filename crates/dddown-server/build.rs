use std::path::Path;

fn main() {
    // release 构建嵌入 web/dist，目录变化时触发重编译
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
}
