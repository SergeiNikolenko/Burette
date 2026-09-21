fn main() {
    if let Err(error) = burette_lib::run_compute_dev_backend() {
        eprintln!("Burette native compute dev backend failed: {error}");
        std::process::exit(1);
    }
}
