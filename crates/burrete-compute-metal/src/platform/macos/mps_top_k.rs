use metal::{BufferRef, CommandQueueRef, DeviceRef, MTLResourceOptions};
use objc::{class, msg_send, runtime::Object, sel, sel_impl};

use crate::MetalRuntimeError;

const MPS_DATA_TYPE_FLOAT32: u32 = 0x1000_0020;
const MPS_DATA_TYPE_UINT32: u32 = 32;
const MPS_FIND_TOP_K_LIMIT: usize = 16;

#[derive(Debug, PartialEq)]
pub(super) struct MpsTopKResult {
    pub(super) indices: Vec<u32>,
    pub(super) gpu_time_seconds: f64,
}

pub(super) fn find_top_k(
    device: &DeviceRef,
    queue: &CommandQueueRef,
    input_buffer: &BufferRef,
    rows: usize,
    columns: usize,
    input_row_bytes: u64,
    neighbor_count: usize,
) -> Result<MpsTopKResult, MetalRuntimeError> {
    validate_shape(input_buffer, rows, columns, input_row_bytes, neighbor_count)?;

    objc::rc::autoreleasepool(|| unsafe {
        let descriptor_class = class!(MPSMatrixDescriptor);
        let matrix_class = class!(MPSMatrix);
        let top_k_class = class!(MPSMatrixFindTopK);

        let result_value_row_bytes: u64 = msg_send![
            descriptor_class,
            rowBytesForColumns: neighbor_count as u64
            dataType: MPS_DATA_TYPE_FLOAT32
        ];
        let result_index_row_bytes: u64 = msg_send![
            descriptor_class,
            rowBytesForColumns: neighbor_count as u64
            dataType: MPS_DATA_TYPE_UINT32
        ];

        let result_value_count = buffer_element_count(rows, result_value_row_bytes, "value")?;
        let result_index_count = buffer_element_count(rows, result_index_row_bytes, "index")?;
        let result_value_buffer = device.new_buffer(
            (result_value_count * size_of::<f32>()) as u64,
            MTLResourceOptions::StorageModeShared,
        );
        let result_index_buffer = device.new_buffer(
            (result_index_count * size_of::<u32>()) as u64,
            MTLResourceOptions::StorageModeShared,
        );

        let input_descriptor: *mut Object = msg_send![
            descriptor_class,
            matrixDescriptorWithRows: rows as u64
            columns: columns as u64
            rowBytes: input_row_bytes
            dataType: MPS_DATA_TYPE_FLOAT32
        ];
        let result_value_descriptor: *mut Object = msg_send![
            descriptor_class,
            matrixDescriptorWithRows: rows as u64
            columns: neighbor_count as u64
            rowBytes: result_value_row_bytes
            dataType: MPS_DATA_TYPE_FLOAT32
        ];
        let result_index_descriptor: *mut Object = msg_send![
            descriptor_class,
            matrixDescriptorWithRows: rows as u64
            columns: neighbor_count as u64
            rowBytes: result_index_row_bytes
            dataType: MPS_DATA_TYPE_UINT32
        ];

        if input_descriptor.is_null()
            || result_value_descriptor.is_null()
            || result_index_descriptor.is_null()
        {
            return Err(MetalRuntimeError::KernelUnavailable(
                "Metal Performance Shaders could not create matrix descriptors".into(),
            ));
        }

        let input_matrix = new_matrix(matrix_class, input_buffer, input_descriptor)?;
        let result_value_matrix =
            new_matrix(matrix_class, &result_value_buffer, result_value_descriptor)?;
        let result_index_matrix =
            new_matrix(matrix_class, &result_index_buffer, result_index_descriptor)?;
        let kernel: *mut Object = msg_send![top_k_class, alloc];
        let kernel: *mut Object = msg_send![
            kernel,
            initWithDevice: device
            numberOfTopKValues: neighbor_count as u64
        ];
        if kernel.is_null() {
            release_matrices(&[input_matrix, result_value_matrix, result_index_matrix]);
            return Err(MetalRuntimeError::KernelUnavailable(
                "MPSMatrixFindTopK is unavailable for the selected Metal device".into(),
            ));
        }

        let command = queue.new_command_buffer();
        let _: () = msg_send![
            kernel,
            encodeToCommandBuffer: command
            inputMatrix: input_matrix
            resultIndexMatrix: result_index_matrix
            resultValueMatrix: result_value_matrix
        ];
        command.commit();
        command.wait_until_completed();

        let result = if command.status() == metal::MTLCommandBufferStatus::Completed {
            let mut result = read_results(
                &result_index_buffer,
                rows,
                neighbor_count,
                result_index_row_bytes,
            )?;
            result.gpu_time_seconds = super::completed_gpu_time(command)?;
            Ok(result)
        } else {
            Err(MetalRuntimeError::Dispatch(format!(
                "MPSMatrixFindTopK command ended with {:?}",
                command.status()
            )))
        };

        let _: () = msg_send![kernel, release];
        release_matrices(&[input_matrix, result_value_matrix, result_index_matrix]);
        result
    })
}

fn validate_shape(
    input_buffer: &BufferRef,
    rows: usize,
    columns: usize,
    input_row_bytes: u64,
    neighbor_count: usize,
) -> Result<(), MetalRuntimeError> {
    if rows == 0 || columns == 0 {
        return Err(MetalRuntimeError::ResourceLimit(
            "MPS top-K requires a non-empty matrix".into(),
        ));
    }
    if neighbor_count == 0 || neighbor_count > columns || neighbor_count > MPS_FIND_TOP_K_LIMIT {
        return Err(MetalRuntimeError::ResourceLimit(format!(
            "MPS top-K neighbor count must be between 1 and {} and not exceed the column count",
            MPS_FIND_TOP_K_LIMIT
        )));
    }
    if columns > u32::MAX as usize {
        return Err(MetalRuntimeError::ResourceLimit(
            "MPS top-K column count exceeds UInt32 index capacity".into(),
        ));
    }
    let minimum_row_bytes = columns
        .checked_mul(size_of::<f32>())
        .ok_or_else(|| MetalRuntimeError::ResourceLimit("MPS top-K row size overflow".into()))?;
    if input_row_bytes < minimum_row_bytes as u64
        || !input_row_bytes.is_multiple_of(size_of::<f32>() as u64)
    {
        return Err(MetalRuntimeError::ResourceLimit(format!(
            "MPS top-K input row stride {input_row_bytes} is invalid"
        )));
    }
    let expected_bytes = rows
        .checked_mul(input_row_bytes as usize)
        .ok_or_else(|| MetalRuntimeError::ResourceLimit("MPS top-K matrix size overflow".into()))?;
    if input_buffer.length() < expected_bytes as u64 {
        return Err(MetalRuntimeError::ResourceLimit(format!(
            "MPS top-K input buffer has {} bytes, expected at least {expected_bytes}",
            input_buffer.length()
        )));
    }
    Ok(())
}

fn buffer_element_count(
    rows: usize,
    row_bytes: u64,
    label: &str,
) -> Result<usize, MetalRuntimeError> {
    let row_bytes = usize::try_from(row_bytes).map_err(|_| {
        MetalRuntimeError::ResourceLimit(format!("MPS {label} row stride is too large"))
    })?;
    let bytes = rows.checked_mul(row_bytes).ok_or_else(|| {
        MetalRuntimeError::ResourceLimit(format!("MPS {label} buffer size overflow"))
    })?;
    if bytes % size_of::<u32>() != 0 {
        return Err(MetalRuntimeError::ResourceLimit(format!(
            "MPS {label} row stride is invalid"
        )));
    }
    Ok(bytes / size_of::<u32>())
}

unsafe fn new_matrix(
    matrix_class: &'static objc::runtime::Class,
    buffer: &metal::BufferRef,
    descriptor: *mut Object,
) -> Result<*mut Object, MetalRuntimeError> {
    let matrix: *mut Object = msg_send![matrix_class, alloc];
    let matrix: *mut Object = msg_send![matrix, initWithBuffer: buffer descriptor: descriptor];
    if matrix.is_null() {
        Err(MetalRuntimeError::KernelUnavailable(
            "Metal Performance Shaders could not create a matrix".into(),
        ))
    } else {
        Ok(matrix)
    }
}

unsafe fn release_matrices(matrices: &[*mut Object]) {
    for matrix in matrices {
        let _: () = msg_send![*matrix, release];
    }
}

fn read_results(
    index_buffer: &metal::BufferRef,
    rows: usize,
    neighbor_count: usize,
    index_row_bytes: u64,
) -> Result<MpsTopKResult, MetalRuntimeError> {
    if index_buffer.contents().is_null() {
        return Err(MetalRuntimeError::Dispatch(
            "MPS top-K returned an unmapped result buffer".into(),
        ));
    }
    let index_stride = index_row_bytes as usize / size_of::<u32>();
    let raw_indices = unsafe {
        std::slice::from_raw_parts(index_buffer.contents().cast::<u32>(), rows * index_stride)
    };
    let mut indices = Vec::with_capacity(rows * neighbor_count);
    for row in 0..rows {
        let mut selected =
            raw_indices[row * index_stride..row * index_stride + neighbor_count].to_vec();
        selected.sort_unstable();
        indices.extend(selected);
    }
    Ok(MpsTopKResult {
        indices,
        gpu_time_seconds: 0.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_neighbors_above_the_documented_mps_limit() {
        let device = metal::Device::system_default();
        if device.is_none() {
            return;
        }
        let buffer = device
            .as_ref()
            .expect("checked")
            .new_buffer(17 * 4, MTLResourceOptions::StorageModeShared);
        let error = validate_shape(&buffer, 1, 17, 17 * 4, 17).expect_err("limit enforced");
        assert!(matches!(error, MetalRuntimeError::ResourceLimit(_)));
    }

    #[test]
    #[ignore = "manual real-GPU MPS smoke"]
    fn finds_sorted_top_k_values_on_the_real_gpu() {
        let device = metal::Device::system_default().expect("Metal device");
        if !metal::mps::mps_supports_device(&device) {
            return;
        }
        let queue = device.new_command_queue();
        let scores = [0.2, 0.9, 0.1, 0.7, 0.4, 0.3, 0.6, 0.8];
        let buffer = device.new_buffer_with_data(
            scores.as_ptr().cast(),
            size_of_val(&scores) as u64,
            MTLResourceOptions::StorageModeShared,
        );
        let result = find_top_k(&device, &queue, &buffer, 2, 4, 16, 2).expect("MPS top-K");
        assert_eq!(result.indices, vec![1, 3, 2, 3]);
        assert!(result.gpu_time_seconds >= 0.0);
    }
}
