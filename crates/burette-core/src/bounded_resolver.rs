//! Deadline-bound DNS waits with admission retained until the OS lookup exits.

use std::io;
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::Instant;

const MAX_LOOKUPS: usize = 4;
const MAX_ADDRESSES: usize = 64;
static RESOLVER: OnceLock<Resolver> = OnceLock::new();

#[derive(Default)]
struct Resolver(Arc<AtomicUsize>);

struct Permit(Arc<AtomicUsize>);

impl Drop for Permit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn timeout() -> io::Error {
    io::Error::new(
        io::ErrorKind::TimedOut,
        "request deadline expired during DNS",
    )
}

impl Resolver {
    fn lookup(
        &self,
        deadline: Instant,
        lookup: impl FnOnce() -> io::Result<Vec<IpAddr>> + Send + 'static,
    ) -> io::Result<Vec<IpAddr>> {
        if Instant::now() >= deadline {
            return Err(timeout());
        }
        self.0
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < MAX_LOOKUPS).then_some(active + 1)
            })
            .map_err(|_| {
                io::Error::new(io::ErrorKind::WouldBlock, "DNS lookup capacity is busy")
            })?;
        let permit = Permit(Arc::clone(&self.0));
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("burette-dns".into())
            .spawn(move || {
                let _permit = permit;
                let result = if Instant::now() >= deadline {
                    Err(timeout())
                } else {
                    lookup()
                };
                // A timed-out caller drops its receiver. Never perform network
                // requests here or free admission while the OS is still resolving.
                let _ = sender.send(result);
            })?;
        let result = receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => timeout(),
                mpsc::RecvTimeoutError::Disconnected => io::Error::other("DNS worker failed"),
            })?;
        if Instant::now() >= deadline {
            return Err(timeout());
        }
        result
    }
}

/// Resolve with no queue and at most four active OS lookups process-wide. A
/// timed-out OS lookup cannot be cancelled, so it retains its slot until exit.
/// All returned addresses must still be validated and pinned by the caller.
pub fn resolve(host: &str, port: u16, deadline: Instant) -> io::Result<Vec<IpAddr>> {
    let host = host.to_owned();
    RESOLVER
        .get_or_init(Resolver::default)
        .lookup(deadline, move || {
            let addresses = (host.as_str(), port)
                .to_socket_addrs()?
                .take(MAX_ADDRESSES + 1)
                .map(|address| address.ip())
                .collect::<Vec<_>>();
            if addresses.len() > MAX_ADDRESSES {
                return Err(io::Error::other("Remote host has too many addresses"));
            }
            Ok(addresses)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn stalled_lookups_keep_their_slots_after_callers_time_out() {
        let resolver = Resolver::default();
        let mut releases = Vec::new();
        for _ in 0..MAX_LOOKUPS {
            let (release, wait) = mpsc::channel();
            let (started, entered) = mpsc::channel();
            let active = Resolver(Arc::clone(&resolver.0));
            let caller = std::thread::spawn(move || {
                active.lookup(Instant::now() + Duration::from_millis(150), move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                    Ok(vec!["8.8.8.8".parse().unwrap()])
                })
            });
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            assert_eq!(
                caller.join().unwrap().unwrap_err().kind(),
                io::ErrorKind::TimedOut
            );
            releases.push(release);
        }
        assert_eq!(resolver.0.load(Ordering::Acquire), MAX_LOOKUPS);
        assert_eq!(
            resolver
                .lookup(Instant::now() + Duration::from_secs(1), || panic!(
                    "over capacity"
                ))
                .unwrap_err()
                .kind(),
            io::ErrorKind::WouldBlock
        );
        for release in releases {
            release.send(()).unwrap();
        }
        let end = Instant::now() + Duration::from_secs(2);
        while resolver.0.load(Ordering::Acquire) != 0 {
            assert!(Instant::now() < end);
            std::thread::yield_now();
        }
        assert_eq!(
            resolver
                .lookup(end, || Ok(vec!["8.8.8.8".parse().unwrap()]))
                .unwrap(),
            vec!["8.8.8.8".parse::<IpAddr>().unwrap()]
        );
    }

    #[test]
    fn expired_deadlines_do_not_start_work_and_errors_survive() {
        let resolver = Resolver::default();
        assert_eq!(
            resolver
                .lookup(Instant::now(), || panic!("expired"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(resolver.0.load(Ordering::Acquire), 0);
        let error = resolver
            .lookup(Instant::now() + Duration::from_secs(1), || {
                Err(io::Error::new(io::ErrorKind::NotFound, "no such host"))
            })
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(error.to_string(), "no such host");
    }

    #[test]
    fn sequential_lookups_share_the_original_deadline() {
        let resolver = Resolver::default();
        let deadline = Instant::now() + Duration::from_millis(200);
        let (release, wait) = mpsc::channel();
        let timer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            release.send(()).unwrap();
        });
        resolver
            .lookup(deadline, move || {
                wait.recv().unwrap();
                Ok(Vec::new())
            })
            .unwrap();
        timer.join().unwrap();
        let (release, wait) = mpsc::channel();
        let error = resolver
            .lookup(deadline, move || {
                wait.recv().unwrap();
                Ok(Vec::new())
            })
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(Instant::now() >= deadline);
        // A late completion only releases capacity; it cannot return data to
        // the caller which has already failed or initiate the next HTTP hop.
        let _ = release.send(());
    }

    #[test]
    fn system_resolver_returns_addresses_within_the_deadline() {
        let addresses = resolve("localhost", 443, Instant::now() + Duration::from_secs(2)).unwrap();
        assert!(!addresses.is_empty());
        assert!(addresses.iter().all(IpAddr::is_loopback));
    }
}
