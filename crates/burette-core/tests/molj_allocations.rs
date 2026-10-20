use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    static TRACK: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

struct CountingAllocator;

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if TRACK.try_with(Cell::get).unwrap_or(false) {
            ALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout);
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if TRACK.try_with(Cell::get).unwrap_or(false) {
            ALLOCATIONS.with(|count| count.set(count.get() + 1));
        }
        System.realloc(pointer, layout, size)
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn classification_allocates_no_heap_for_long_strings_numbers_or_collections() {
    // Build input before measuring, on the same thread as the real classifier.
    for payload in [
        format!(
            r#"{{"{}":"{}","entries":[]}}"#,
            "\\u0061".repeat(100_000),
            "b".repeat(100_000)
        ),
        format!(r#"{{"ignored":1.{},"entries":[]}}"#, "1".repeat(100_000)),
        format!(r#"{{"entries":[{}{{}}]}}"#, "{},".repeat(100_000)),
    ] {
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        let result = burette_core::molj::is_mesoscale_molj(payload.as_bytes());
        TRACK.with(|track| track.set(false));
        assert!(!result);
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
}
