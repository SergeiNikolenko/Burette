if(NOT DEFINED BURRETE_CONFORMER_SOURCE_DIR)
    message(FATAL_ERROR "BURRETE_CONFORMER_SOURCE_DIR is required")
endif()

add_executable(Burrete_rdkit_conformer
    "${BURRETE_CONFORMER_SOURCE_DIR}/jswrapper.cpp"
    "${BURRETE_CONFORMER_SOURCE_DIR}/conformer_binary.cpp"
    "${BURRETE_CONFORMER_SOURCE_DIR}/conformer_extractor.cpp")
target_include_directories(Burrete_rdkit_conformer PRIVATE
    "${BURRETE_CONFORMER_SOURCE_DIR}")
target_link_libraries(Burrete_rdkit_conformer
    DistGeomHelpers
    ForceFieldHelpers
    DistGeometry
    ForceField
    FileParsers
    SmilesParse
    GraphMol
    RDGeometryLib
    RDGeneral)
set_target_properties(Burrete_rdkit_conformer PROPERTIES LINK_FLAGS "--bind")
