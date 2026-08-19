use std::path::Path;

fn main() {
    let dist = Path::new("web/dist");

    if !dist.exists() || !dist.join("index.html").exists() {
        println!("cargo:warning=web/dist not found. Run `cd web && npm run build` first.");
        println!("cargo:warning=Continuing without embedded frontend (Phase 1 placeholder).");
    } else {
        println!("cargo:rerun-if-changed=web/dist");
    }
}
