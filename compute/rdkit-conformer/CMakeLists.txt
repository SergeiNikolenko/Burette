if(NOT DEFINED BURETTE_CONFORMER_SOURCE_DIR)
    message(FATAL_ERROR "BURETTE_CONFORMER_SOURCE_DIR is required")
endif()

add_executable(Burette_rdkit_conformer
    "${BURETTE_CONFORMER_SOURCE_DIR}/jswrapper.cpp"
    "${BURETTE_CONFORMER_SOURCE_DIR}/conformer_binary.cpp"
    "${BURETTE_CONFORMER_SOURCE_DIR}/conformer_extractor.cpp"
    "${BURETTE_CONFORMER_SOURCE_DIR}/mmff_binary.cpp"
    "${BURETTE_CONFORMER_SOURCE_DIR}/mmff_extractor.cpp")
target_include_directories(Burette_rdkit_conformer PRIVATE
    "${BURETTE_CONFORMER_SOURCE_DIR}")
target_link_libraries(Burette_rdkit_conformer
    DistGeomHelpers
    ForceFieldHelpers
    DistGeometry
    ForceField
    FileParsers
    SmilesParse
    GraphMol
    RDGeometryLib
    RDGeneral)
set_target_properties(Burette_rdkit_conformer PROPERTIES LINK_FLAGS "--bind")
