fn main() {
    if let Err(error) = burrete_lib::run_compute_dev_backend() {
        eprintln!("Burrete native compute dev backend failed: {error}");
        std::process::exit(1);
    }
}
