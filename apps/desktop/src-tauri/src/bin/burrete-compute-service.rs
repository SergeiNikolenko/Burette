fn main() {
    if let Err(error) = burrete_lib::run_compute_service() {
        eprintln!("Burrete compute service failed: {error}");
        std::process::exit(1);
    }
}
