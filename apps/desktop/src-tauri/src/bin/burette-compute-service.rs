fn main() {
    if let Err(error) = burette_lib::run_compute_service() {
        eprintln!("Burette compute service failed: {error}");
        std::process::exit(1);
    }
}
